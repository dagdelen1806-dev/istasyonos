import {
  randomBytes,
  randomUUID,
  scrypt as scryptCallback,
  timingSafeEqual,
  createHash,
} from "node:crypto";
import { promisify } from "node:util";
import type { Express, Request, Response } from "express";
import { parse } from "cookie";
import type { RowDataPacket, ResultSetHeader } from "mysql2/promise";
import type { User } from "../drizzle/schema";
import { getStationPool, withTransaction } from "./stationos/db";
import { originIsSame } from "./stationos/domain";
import { getSessionCookieOptions } from "./_core/cookies";
import { COOKIE_NAME } from "../shared/const";
import { formatDbUtc } from "../shared/datetime";

const scrypt = promisify(scryptCallback);
const digest = (value: string) =>
  createHash("sha256").update(value).digest("hex");
const lifetime = 12 * 60 * 60 * 1000;
// A single-process limiter for the standalone server. Deployments with multiple
// instances must put a shared limiter at their ingress.
const attempts = new Map<string, { count: number; until: number }>();
const passwordAttempts = new Map<number, { count: number; until: number }>();

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString("hex");
  const key = (await scrypt(password, salt, 64)) as Buffer;
  return `scrypt:${salt}:${key.toString("hex")}`;
}

export async function verifyPassword(
  password: string,
  stored: string
): Promise<boolean> {
  const [kind, salt, encoded] = stored.split(":");
  if (
    kind !== "scrypt" ||
    !/^[a-f0-9]{32}$/.test(salt ?? "") ||
    !/^[a-f0-9]{128}$/.test(encoded ?? "")
  )
    return false;
  const key = (await scrypt(password, salt, 64)) as Buffer;
  return timingSafeEqual(key, Buffer.from(encoded, "hex"));
}

function tokenOf(req: Request): string | undefined {
  return parse(req.headers.cookie ?? "")[COOKIE_NAME];
}

export async function authenticateLocal(req: Request): Promise<User> {
  const token = tokenOf(req);
  if (!token || !/^[a-f0-9]{64}$/.test(token))
    throw new Error("UNAUTHENTICATED");
  const [users] = await getStationPool().execute<RowDataPacket[]>(
    `SELECT u.* FROM users u JOIN st_auth_sessions s ON s.user_id=u.id
     WHERE s.token_hash=? AND s.expires_at>UTC_TIMESTAMP(3)`,
    [digest(token)]
  );
  if (!users[0]) throw new Error("UNAUTHENTICATED");
  return users[0] as User;
}

export async function revokeLocalSession(req: Request): Promise<void> {
  const token = tokenOf(req);
  if (token)
    await getStationPool().execute(
      "DELETE FROM st_auth_sessions WHERE token_hash=?",
      [digest(token)]
    );
}

function reject(res: Response, status: number, message: string) {
  res.status(status).json({ ok: false, error: { message } });
}

export function registerLocalAuth(app: Express): void {
  for (const action of ["register", "login"] as const) {
    app.post(`/api/auth/${action}`, async (req, res) => {
      res.set("Cache-Control", "no-store");
      if (
        !originIsSame(req) ||
        req.get("X-Stationos-Request") !== "1" ||
        !req.is("application/json")
      ) {
        reject(res, 403, "İstek doğrulanamadı.");
        return;
      }
      const now = Date.now();
      for (const [key, value] of attempts)
        if (value.until <= now) attempts.delete(key);
      const ip = req.socket.remoteAddress ?? "unknown";
      const limit = attempts.get(ip) ?? {
        count: 0,
        until: now + 15 * 60 * 1000,
      };
      if (limit.count >= 20 || attempts.size >= 10000) {
        res.set("Retry-After", "900");
        reject(
          res,
          429,
          "Çok fazla giriş denemesi. 15 dakika sonra tekrar deneyin."
        );
        return;
      }
      limit.count++;
      attempts.set(ip, limit);
      const email =
        typeof req.body?.email === "string"
          ? req.body.email.trim().toLowerCase()
          : "";
      const password = req.body?.password;
      const name =
        typeof req.body?.name === "string" ? req.body.name.trim() : "";
      if (
        !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
        email.length > 254 ||
        typeof password !== "string" ||
        password.length > 128 ||
        password.length < 12 ||
        (action === "register" && (!name || name.length > 100))
      ) {
        reject(
          res,
          400,
          "Geçerli e-posta, ad ve 12–128 karakterlik parola kullanın."
        );
        return;
      }
      try {
        const passwordHash =
          action === "register" ? await hashPassword(password) : null;
        const token = randomBytes(32).toString("hex");
        await withTransaction(async connection => {
          let userId: number;
          if (action === "register") {
            const [insert] = await connection.execute<ResultSetHeader>(
              "INSERT INTO users (openId,name,email,loginMethod,role) VALUES (?,?,?,'local','user')",
              [`local_${randomUUID()}`, name, email]
            );
            await connection.execute(
              "INSERT INTO st_auth_credentials (user_id,email,password_hash) VALUES (?,?,?)",
              [insert.insertId, email, passwordHash]
            );
            userId = insert.insertId;
          } else {
            // Serialize credential verification and session issuance with password
            // changes, so an old password cannot mint a session after revocation.
            const [rows] = await connection.execute<RowDataPacket[]>(
              "SELECT user_id,password_hash FROM st_auth_credentials WHERE email=? FOR UPDATE",
              [email]
            );
            // Use the same expensive comparison for unknown accounts.
            const stored =
              rows[0]?.password_hash ??
              `scrypt:${"0".repeat(32)}:${"0".repeat(128)}`;
            const valid = await verifyPassword(password, stored);
            if (!rows[0] || !valid) throw new Error("INVALID_LOGIN");
            userId = Number(rows[0].user_id);
          }
          await connection.execute(
            "INSERT INTO st_auth_sessions (token_hash,user_id,expires_at) VALUES (?,?,?)",
            [
              digest(token),
              userId,
              formatDbUtc(new Date(Date.now() + lifetime)),
            ]
          );
          await connection.execute(
            "UPDATE users SET lastSignedIn=UTC_TIMESTAMP() WHERE id=?",
            [userId]
          );
          // Rotate the current browser's session on login, including account switches.
          const previous = tokenOf(req);
          if (previous)
            await connection.execute(
              "DELETE FROM st_auth_sessions WHERE token_hash=?",
              [digest(previous)]
            );
        });
        res.cookie(COOKIE_NAME, token, {
          ...getSessionCookieOptions(req),
          maxAge: lifetime,
        });
        res.status(action === "register" ? 201 : 200).json({ ok: true });
      } catch (error) {
        if (error instanceof Error && error.message === "INVALID_LOGIN") {
          reject(res, 401, "E-posta veya parola hatalı.");
          return;
        }
        if ((error as { code?: string }).code === "ER_DUP_ENTRY") {
          reject(
            res,
            409,
            "Bu e-posta ile kayıt yapılamadı. Giriş yapmayı deneyin."
          );
          return;
        }
        console.error(
          "[LocalAuth] operation failed",
          (error as { code?: string }).code ?? "internal"
        );
        reject(
          res,
          503,
          "Kimlik hizmeti kullanılamıyor. Lütfen tekrar deneyin."
        );
      }
    });
  }

  app.post("/api/auth/change-password", async (req, res) => {
    res.set("Cache-Control", "no-store");
    if (
      !originIsSame(req) ||
      req.get("X-Stationos-Request") !== "1" ||
      !req.is("application/json")
    ) {
      reject(res, 403, "İstek doğrulanamadı.");
      return;
    }
    let user: User;
    try {
      user = await authenticateLocal(req);
    } catch {
      reject(res, 401, "Oturumunuz sona erdi. Yeniden giriş yapın.");
      return;
    }
    const now = Date.now();
    for (const [id, attempt] of passwordAttempts)
      if (attempt.until <= now) passwordAttempts.delete(id);
    const limit = passwordAttempts.get(user.id) ?? {
      count: 0,
      until: now + 15 * 60 * 1000,
    };
    if (limit.count >= 5 || passwordAttempts.size >= 10000) {
      res.set("Retry-After", "900");
      reject(
        res,
        429,
        "Çok fazla şifre değiştirme denemesi. 15 dakika sonra tekrar deneyin."
      );
      return;
    }
    limit.count++;
    passwordAttempts.set(user.id, limit);
    const { currentPassword, newPassword } = req.body ?? {};
    if (
      typeof currentPassword !== "string" ||
      currentPassword.length < 12 ||
      currentPassword.length > 128 ||
      typeof newPassword !== "string" ||
      newPassword.length < 12 ||
      newPassword.length > 128
    ) {
      reject(res, 400, "Mevcut ve yeni şifre 12–128 karakter olmalıdır.");
      return;
    }
    if (currentPassword === newPassword) {
      reject(res, 400, "Yeni şifre mevcut şifreden farklı olmalıdır.");
      return;
    }
    try {
      const nextHash = await hashPassword(newPassword);
      await withTransaction(async connection => {
        const [credentials] = await connection.execute<RowDataPacket[]>(
          "SELECT password_hash FROM st_auth_credentials WHERE user_id=? FOR UPDATE",
          [user.id]
        );
        const [sessions] = await connection.execute<RowDataPacket[]>(
          "SELECT user_id FROM st_auth_sessions WHERE token_hash=? AND user_id=? AND expires_at>UTC_TIMESTAMP(3) FOR UPDATE",
          [digest(tokenOf(req)!), user.id]
        );
        if (!sessions[0]) throw new Error("SESSION_EXPIRED");
        if (
          !credentials[0] ||
          !(await verifyPassword(currentPassword, credentials[0].password_hash))
        )
          throw new Error("CURRENT_PASSWORD_INVALID");
        await connection.execute(
          "UPDATE st_auth_credentials SET password_hash=? WHERE user_id=?",
          [nextHash, user.id]
        );
        await connection.execute(
          "DELETE FROM st_auth_sessions WHERE user_id=? AND token_hash<>?",
          [user.id, digest(tokenOf(req)!)]
        );
      });
      res.json({ ok: true });
    } catch (error) {
      if (
        error instanceof Error &&
        error.message === "CURRENT_PASSWORD_INVALID"
      ) {
        reject(res, 400, "Mevcut şifre doğru değil.");
        return;
      }
      if (error instanceof Error && error.message === "SESSION_EXPIRED") {
        reject(res, 401, "Oturumunuz sona erdi. Yeniden giriş yapın.");
        return;
      }
      reject(
        res,
        503,
        "Şifre değişikliğinin sonucu doğrulanamadı. Mevcut oturumunuzu koruyun; yeni şifreyle giriş durumunu kontrol edin."
      );
    }
  });
}

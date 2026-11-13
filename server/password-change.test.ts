import { beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import type { Express } from "express";

const fake = vi.hoisted(() => ({
  hash: "",
  sessions: new Map<string, number>(),
  writes: [] as string[],
  failDelete: false,
  tail: Promise.resolve() as Promise<unknown>,
}));
vi.mock("./stationos/db", () => {
  async function execute(sql: string, params: any[]) {
    if (sql.includes("SELECT u.*"))
      return [
        fake.sessions.has(params[0])
          ? [{ id: fake.sessions.get(params[0]) }]
          : [],
      ];
    if (sql.includes("SELECT user_id,password_hash"))
      return [[{ user_id: userNumber, password_hash: fake.hash }]];
    if (sql.includes("SELECT password_hash"))
      return [[{ password_hash: fake.hash }]];
    if (sql.includes("SELECT user_id FROM st_auth_sessions"))
      return [
        fake.sessions.get(params[0]) === params[1]
          ? [{ user_id: params[1] }]
          : [],
      ];
    if (sql.includes("UPDATE st_auth_credentials")) {
      fake.hash = params[0];
      fake.writes.push("password");
      return [{}];
    }
    if (sql.includes("DELETE FROM st_auth_sessions WHERE user_id")) {
      if (fake.failDelete) throw new Error("DELETE_FAILED");
      for (const [token, user] of fake.sessions)
        if (user === params[0] && token !== params[1])
          fake.sessions.delete(token);
      fake.writes.push("revoke");
      return [{}];
    }
    if (sql.includes("INSERT INTO st_auth_sessions")) {
      fake.sessions.set(params[0], params[1]);
      return [{}];
    }
    if (sql.includes("UPDATE users SET lastSignedIn")) return [{}];
    if (sql.includes("DELETE FROM st_auth_sessions WHERE token_hash")) {
      fake.sessions.delete(params[0]);
      return [{}];
    }
    throw new Error(`Unexpected SQL: ${sql}`);
  }
  return {
    getStationPool: () => ({ execute }),
    withTransaction: (fn: (connection: any) => Promise<unknown>) => {
      const operation = fake.tail.then(async () => {
        const snapshot = {
          hash: fake.hash,
          sessions: new Map(fake.sessions),
          writes: [...fake.writes],
        };
        try {
          return await fn({ execute });
        } catch (error) {
          Object.assign(fake, snapshot);
          throw error;
        }
      });
      fake.tail = operation.catch(() => undefined);
      return operation;
    },
  };
});
import { hashPassword, verifyPassword, registerLocalAuth } from "./local-auth";
const routes = new Map<string, (req: any, res: any) => Promise<void>>();
const token = "a".repeat(64),
  other = "b".repeat(64),
  foreign = "c".repeat(64);
const digest = (text: string) =>
  createHash("sha256").update(text).digest("hex");
const current = "current-test-password-123",
  next = "new-test-password-456";
let userNumber = 100;
async function call(
  body: object,
  options: {
    origin?: string;
    header?: string;
    token?: string;
    path?: string;
  } = {}
) {
  const headers: Record<string, string> = {
    origin: options.origin ?? "https://local.test",
    host: "local.test",
    "x-stationos-request": options.header ?? "1",
    cookie: `webdev_app_session=${options.token ?? token}`,
  };
  const req = {
    secure: true,
    body,
    headers,
    socket: { remoteAddress: `test-${userNumber}` },
    get: (name: string) => headers[name.toLowerCase()],
    is: () => true,
  };
  let status = 200,
    data: any;
  const res: any = {
    set: () => res,
    cookie: () => res,
    status: (value: number) => {
      status = value;
      return res;
    },
    json: (value: any) => {
      data = value;
      return res;
    },
  };
  await routes.get(options.path ?? "/api/auth/change-password")!(req, res);
  return { status, data };
}
beforeEach(async () => {
  fake.hash = await hashPassword(current);
  fake.sessions.clear();
  fake.writes = [];
  fake.failDelete = false;
  fake.tail = Promise.resolve();
  // Isolate per-user rate limiting between tests.
  userNumber++;
  fake.sessions.set(digest(token), userNumber);
  fake.sessions.set(digest(other), userNumber);
  fake.sessions.set(digest(foreign), -1);
  routes.clear();
  registerLocalAuth({
    post: (path: string, fn: any) => routes.set(path, fn),
  } as unknown as Express);
});
describe("Şifre değiştirme güvenliği ve transaction sınırı", () => {
  it("yalnız mevcut kullanıcıyı değiştirir; diğer kullanıcıya ve mevcut oturuma dokunmaz", async () => {
    expect(
      (
        await call({
          currentPassword: current,
          newPassword: next,
          userId: -1,
          role: "OWNER",
        })
      ).status
    ).toBe(200);
    expect(await verifyPassword(next, fake.hash)).toBe(true);
    expect(await verifyPassword(current, fake.hash)).toBe(false);
    expect(fake.sessions.has(digest(token))).toBe(true);
    expect(fake.sessions.has(digest(other))).toBe(false);
    expect(fake.sessions.has(digest(foreign))).toBe(true);
    expect(fake.writes).toEqual(["password", "revoke"]);
  });
  it("yanlış mevcut şifrede hiçbir yazım yapmaz", async () => {
    expect(
      (
        await call({
          currentPassword: "wrong-test-password-123",
          newPassword: next,
        })
      ).status
    ).toBe(400);
    expect(fake.writes).toEqual([]);
    expect(fake.sessions.size).toBe(3);
  });
  it.each([{ origin: "https://foreign.test" }, { header: "" }])(
    "yabancı origin veya eksik koruma başlığını reddeder",
    async options => {
      expect(
        (await call({ currentPassword: current, newPassword: next }, options))
          .status
      ).toBe(403);
      expect(fake.writes).toEqual([]);
    }
  );
  it("geçersiz oturumu reddeder", async () => {
    expect(
      (
        await call(
          { currentPassword: current, newPassword: next },
          { token: "invalid" }
        )
      ).status
    ).toBe(401);
    expect(fake.writes).toEqual([]);
  });
  it.each(["short", "x".repeat(129), current])(
    "geçersiz veya aynı yeni şifreyi reddeder",
    async newPassword => {
      expect(
        (await call({ currentPassword: current, newPassword })).status
      ).toBe(400);
      expect(fake.writes).toEqual([]);
    }
  );
  it("diğer oturumlar silinemezse parola değişikliğini de geri alır", async () => {
    fake.failDelete = true;
    const before = fake.hash;
    expect(
      (await call({ currentPassword: current, newPassword: next })).status
    ).toBe(503);
    expect(fake.hash).toBe(before);
    expect(fake.sessions.size).toBe(3);
    expect(fake.writes).toEqual([]);
  });
  it("beş hatalı denemeden sonra yeni denemeyi sınırlar", async () => {
    for (let n = 0; n < 5; n++)
      expect(
        (
          await call({
            currentPassword: "incorrect-password-123",
            newPassword: next,
          })
        ).status
      ).toBe(400);
    expect(
      (await call({ currentPassword: current, newPassword: next })).status
    ).toBe(429);
    expect(fake.writes).toEqual([]);
  });
  it("iki eşzamanlı değişiklikten yalnız biri eski şifreyi kullanabilir", async () => {
    const replies = await Promise.all([
      call({ currentPassword: current, newPassword: next }),
      call({ currentPassword: current, newPassword: "another-password-789" }),
    ]);
    expect(replies.map(r => r.status).sort()).toEqual([200, 400]);
    expect(fake.writes).toEqual(["password", "revoke"]);
  });
  it("eski şifreyle yarışan giriş değişiklikten sonra geçerli oturum bırakamaz", async () => {
    const [changed, login] = await Promise.all([
      call({ currentPassword: current, newPassword: next }),
      call(
        { email: "unit@example.invalid", password: current },
        { path: "/api/auth/login", token: other }
      ),
    ]);
    expect(changed.status).toBe(200);
    expect([200, 401]).toContain(login.status);
    expect(
      [...fake.sessions.entries()].filter(([, id]) => id === userNumber)
    ).toEqual([[digest(token), userNumber]]);
    expect(await verifyPassword(next, fake.hash)).toBe(true);
  });
});

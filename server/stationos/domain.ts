import { createHash, createHmac, randomBytes } from "node:crypto";
import type { Request } from "express";
import { ENV } from "../_core/env";
import { StationError, type AccountTotals } from "./types";

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function requireString(
  value: unknown,
  field: string,
  options: { min?: number; max?: number } = {}
): string {
  if (typeof value !== "string")
    throw new StationError("INVALID_INPUT", `${field} metin olmalıdır.`);
  const result = value.trim();
  if (
    result.length < (options.min ?? 1) ||
    result.length > (options.max ?? 255)
  ) {
    throw new StationError(
      "INVALID_INPUT",
      `${field} geçerli uzunlukta değil.`
    );
  }
  return result;
}

export function optionalString(
  value: unknown,
  field: string,
  max = 255
): string | null {
  if (value === undefined || value === null || value === "") return null;
  return requireString(value, field, { max });
}

export function requireBoolean(value: unknown, field: string): boolean {
  if (typeof value !== "boolean")
    throw new StationError("INVALID_INPUT", `${field} boolean olmalıdır.`);
  return value;
}

export function requireId(value: unknown, field: string): string {
  const result = requireString(value, field, { max: 64 });
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      result
    )
  ) {
    throw new StationError(
      "INVALID_INPUT",
      `${field} geçerli bir UUID olmalıdır.`
    );
  }
  return result;
}

export function requireRequestId(body: Record<string, unknown>): string {
  return requireId(body.requestId, "requestId");
}

export function requireMoney(
  value: unknown,
  field: string,
  options: { allowZero?: boolean } = {}
): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    throw new StationError(
      "INVALID_MONEY",
      `${field} güvenli bir kuruş tamsayısı olmalıdır.`
    );
  }
  if (value < 0 || (!options.allowZero && value === 0)) {
    throw new StationError(
      "INVALID_MONEY",
      `${field} negatif veya sıfır olamaz.`
    );
  }
  return value;
}

export function requireInteger(
  value: unknown,
  field: string,
  options: { allowNegative?: boolean; allowZero?: boolean } = {}
): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    throw new StationError(
      "INVALID_INPUT",
      `${field} güvenli bir tamsayı olmalıdır.`
    );
  }
  if (!options.allowNegative && value < 0)
    throw new StationError("INVALID_INPUT", `${field} negatif olamaz.`);
  if (!options.allowZero && value === 0)
    throw new StationError("INVALID_INPUT", `${field} sıfır olamaz.`);
  return value;
}

export function requireEnum<T extends string>(
  value: unknown,
  field: string,
  allowed: readonly T[]
): T {
  if (typeof value !== "string" || !allowed.includes(value as T)) {
    throw new StationError(
      "INVALID_INPUT",
      `${field} geçerli bir seçenek olmalıdır.`
    );
  }
  return value as T;
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (isRecord(value)) {
    return Object.keys(value)
      .sort()
      .reduce<Record<string, unknown>>((result, key) => {
        result[key] = canonicalize(value[key]);
        return result;
      }, {});
  }
  return value;
}

export function payloadHash(value: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(canonicalize(value)))
    .digest("hex");
}

export function randomInvitationCode(): string {
  return randomBytes(32).toString("base64url");
}

export function invitationHash(code: string): string {
  return createHash("sha256").update(code).digest("hex");
}

export function csrfToken(actor: { id: number; openId: string }): string {
  if (!ENV.cookieSecret)
    throw new StationError(
      "AUTH_UNAVAILABLE",
      "Güvenli oturum anahtarı yapılandırılmamış.",
      503
    );
  return createHmac("sha256", ENV.cookieSecret)
    .update(`${ENV.appId}:${actor.id}:${actor.openId}`)
    .digest("base64url");
}

export function isValidCsrf(
  actor: { id: number; openId: string },
  token: unknown
): boolean {
  if (typeof token !== "string") return false;
  const expected = csrfToken(actor);
  return (
    token.length === expected.length &&
    createHash("sha256").update(token).digest("hex") ===
      createHash("sha256").update(expected).digest("hex")
  );
}

export function originIsSame(req: Request): boolean {
  const origin = req.get("origin");
  if (!origin) return true;
  try {
    const parsed = new URL(origin);
    const forwardedHost = req.get("x-forwarded-host")?.split(",")[0]?.trim();
    const host = forwardedHost || req.get("host");
    if (!host || parsed.host !== host) return false;
    const forwarded = req.get("x-forwarded-proto");
    const protocol =
      forwarded?.split(",")[0]?.trim() || (req.secure ? "https" : "http");
    if (protocol === "https" && parsed.protocol !== "https:") return false;
    return parsed.protocol === `${protocol}:`;
  } catch {
    return false;
  }
}

export function accountTotals(input: {
  cashSalesMinor: number;
  cardTotalMinor: number;
  ibanMinor: number;
  debtMinor: number;
  arCollectionMinor: number;
  sourceSalesMinor: number | null;
}): AccountTotals {
  const sourceTotalMinor =
    input.cashSalesMinor +
    input.cardTotalMinor +
    input.ibanMinor +
    input.debtMinor;
  return {
    cashSalesMinor: input.cashSalesMinor,
    cardTotalMinor: input.cardTotalMinor,
    ibanMinor: input.ibanMinor,
    debtMinor: input.debtMinor,
    arCollectionMinor: input.arCollectionMinor,
    expectedCashMinor: input.cashSalesMinor + input.arCollectionMinor,
    sourceTotalMinor,
  };
}

export function recommendationStatus(
  availableCreditMinor: number,
  recommendedQty: number,
  costMinor: number,
  stockQty: number
): "CREDIT_BLOCKED" | "STOCKOUT" | "READY" {
  if (recommendedQty <= 0) return "READY";
  if (costMinor > availableCreditMinor) return "CREDIT_BLOCKED";
  if (stockQty <= 0) return "STOCKOUT";
  return "READY";
}

export function safeDate(value: unknown, field: string): Date {
  const text = requireString(value, field, { max: 64 });
  const date = new Date(text);
  if (Number.isNaN(date.getTime()))
    throw new StationError(
      "INVALID_INPUT",
      `${field} geçerli bir tarih olmalıdır.`
    );
  return date;
}

export function mysqlDate(date: Date): string {
  return date.toISOString().slice(0, 23).replace("T", " ");
}

export function dbErrorCode(error: unknown): string | undefined {
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string"
  )
    return error.code;
  return undefined;
}

export function mapDbError(error: unknown): StationError {
  const code = dbErrorCode(error);
  if (code === "ER_DUP_ENTRY")
    return new StationError("CONFLICT", "Bu kayıt zaten mevcut.", 409);
  if (code === "ER_NO_REFERENCED_ROW_2")
    return new StationError("NOT_FOUND", "Bağlı kayıt bulunamadı.", 404);
  if (code === "ER_DATA_TOO_LONG" || code === "ER_TRUNCATED_WRONG_VALUE")
    return new StationError("INVALID_INPUT", "Girilen veri geçerli değil.");
  return new StationError(
    "DATABASE_ERROR",
    "İşlem veritabanında tamamlanamadı.",
    500
  );
}

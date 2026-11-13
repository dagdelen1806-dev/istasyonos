import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PoolConnection } from "mysql2/promise";

const fake = vi.hoisted(() => ({
  row: null as Record<string, any> | null,
  saved: null as Record<string, any> | null,
  writes: vi.fn(),
  rollback: false,
  reservationFailures: 0,
}));
vi.mock("./db", () => ({
  first: async (_c: unknown, sql: string, params: unknown[]) => {
    if (sql.includes("st_request_tracking")) {
      return fake.row?.actor_user_id === params[0] &&
        fake.row?.request_id === params[1]
        ? fake.row
        : null;
    }
    return fake.saved;
  },
  execute: async (_c: unknown, sql: string, params: unknown[]) => {
    fake.writes(sql, params);
    if (
      sql.includes("INSERT INTO st_request_tracking") &&
      fake.reservationFailures-- > 0
    )
      throw Object.assign(new Error("deadlock"), { code: "ER_LOCK_DEADLOCK" });
    return { affectedRows: 1 };
  },
  withTransaction: async (fn: (c: unknown) => unknown) => fn({}),
  transactionRollbackConfirmed: () => fake.rollback,
}));
import {
  createRequestContext,
  requestScopeHash,
  readRequestStatus,
  lockRequest,
  reserveRequest,
  recordRequestFailure,
} from "./request-recovery";
import { OPERATION_VERSION } from "../../shared/operation-recovery";
import { StationError } from "./types";

const context = createRequestContext(
  {
    actorId: 7,
    tenantId: "tenant-one",
    requestId: "request-one",
    operation: "/payment",
    scopeHash: requestScopeHash("OWNER", ["station"]),
  },
  { amountMinor: 100 }
);
const connection = {} as PoolConnection;
const decode = vi.fn(async (text: string) => JSON.parse(text));
const status = (overrides = {}) =>
  readRequestStatus(connection, { ...context, ...overrides }, decode);
beforeEach(() => {
  fake.writes.mockClear();
  decode.mockClear();
  fake.rollback = false;
  fake.reservationFailures = 0;
  fake.saved = null;
  fake.row = {
    actor_user_id: context.actorId,
    request_id: context.requestId,
    tenant_id: context.tenantId,
    operation: context.operation,
    schema_version: OPERATION_VERSION,
    scope_hash: context.scopeHash,
    payload_hash: context.payloadHash,
    binding_hash: context.bindingHash,
    state: "PROCESSING",
    created_at: new Date().toISOString().replace("T", " ").slice(0, 23),
    recovery_now: new Date().toISOString().replace("T", " ").slice(0, 23),
  };
});
describe("Sunucu kalıcı işlem durumları ve bağlam doğrulama", () => {
  it("kanıtlı deadlock rollback sonrası yalnız niyet rezervasyonunu tekrarlar", async () => {
    fake.rollback = true;
    fake.reservationFailures = 2;
    await expect(reserveRequest(context)).resolves.toEqual({ legacy: false });
    expect(fake.writes).toHaveBeenCalledTimes(3);
  });
  it("rollback kanıtı yoksa rezervasyonu tekrar etmez", async () => {
    fake.reservationFailures = 1;
    await expect(reserveRequest(context)).rejects.toMatchObject({
      code: "ER_LOCK_DEADLOCK",
    });
    expect(fake.writes).toHaveBeenCalledTimes(1);
  });
  it("sürekli deadlock için beş denemeden sonra durur", async () => {
    fake.rollback = true;
    fake.reservationFailures = 10;
    await expect(reserveRequest(context)).rejects.toMatchObject({
      code: "ER_LOCK_DEADLOCK",
    });
    expect(fake.writes).toHaveBeenCalledTimes(5);
  });
  it("normalize edilmiş UTC anları ve nesne anahtar sırası aynı hash üretir", () => {
    const input = { ...context, operation: "/shift" as const };
    const a = createRequestContext(input, {
      requestId: "a",
      startsAt: "2026-10-28T15:00:00+03:00",
      x: 1,
    });
    const b = createRequestContext(input, {
      x: 1,
      startsAt: "2026-10-28T12:00:00Z",
      requestId: "b",
    });
    expect(a.bindingHash).toBe(b.bindingHash);
    for (const override of [
      { actorId: 8 },
      { tenantId: "other" },
      { operation: "/slip" as const },
      { scopeHash: "other" },
    ]) {
      expect(
        createRequestContext(
          { ...input, ...override },
          { x: 1, startsAt: "2026-10-28T12:00:00Z" }
        ).bindingHash
      ).not.toBe(a.bindingHash);
    }
    expect(requestScopeHash("OWNER", ["b", "a"])).toBe(
      requestScopeHash("OWNER", ["a", "b"])
    );
  });
  it("yakın tarihli niyet işlem sürüyor demektir, tamamlanma değildir", async () => {
    expect((await status()).state).toBe("IN_PROGRESS");
    expect((await status()).response).toBeUndefined();
  });
  it("uygulama saati farklı olsa da niyet yaşını DB saatiyle ölçer", async () => {
    fake.row!.created_at = "2026-11-04 12:00:00.000";
    fake.row!.recovery_now = "2026-11-04 12:00:01.000";
    expect((await status()).state).toBe("IN_PROGRESS");
    await expect(lockRequest(connection, context)).resolves.toBeTruthy();
    fake.row!.recovery_now = "2026-11-04 12:00:31.000";
    expect((await status()).state).toBe("UNCERTAIN");
    await expect(lockRequest(connection, context)).rejects.toMatchObject({
      code: "REQUEST_REVIEW_REQUIRED",
    });
  });
  it.each(["2000-01-01 00:00:00.000", "2999-01-01 00:00:00.000", "broken"])(
    "süreç durması / saat bozukluğu belirsizdir: %s",
    async created_at => {
      fake.row!.created_at = created_at;
      expect((await status()).state).toBe("UNCERTAIN");
      await expect(lockRequest(connection, context)).rejects.toMatchObject({
        code: "REQUEST_REVIEW_REQUIRED",
      });
    }
  );
  it("yalnız atomik tamamlanmış ve hash eşleşen sonucu açıklar", async () => {
    fake.row!.state = "COMPLETED";
    fake.saved = {
      payload_hash: context.bindingHash,
      response_json: JSON.stringify({ ok: true, result: { id: "saved" } }),
    };
    expect((await status()).response?.result.id).toBe("saved");
    fake.saved.payload_hash = "wrong";
    expect((await status()).state).toBe("UNCERTAIN");
  });
  it.each([null, "broken", '{"ok":false}', '{"ok":true,"result":null}'])(
    "bozuk veya eksik sonuç başarılı sayılmaz: %s",
    async response_json => {
      fake.row!.state = "COMPLETED";
      fake.saved = { payload_hash: context.bindingHash, response_json };
      expect((await status()).state).toBe("UNCERTAIN");
    }
  );
  it.each([
    { actorId: 8 },
    { tenantId: "other" },
    { operation: "/slip" },
    { scopeHash: "other" },
  ])("başka kapsam bulunamadı ile aynı yanıtı alır: %j", async overrides => {
    const hidden = await status(overrides);
    fake.row = null;
    expect(hidden).toEqual(await status());
    expect(hidden.state).toBe("NOT_FOUND");
    expect(decode).not.toHaveBeenCalled();
  });
  it("eski sürümdeki ve takipsiz kayıtlar varlık sızdırmaz", async () => {
    fake.row!.schema_version = 1;
    expect((await status()).state).toBe("NOT_FOUND");
    fake.row = null;
    fake.saved = { payload_hash: "old", response_json: "private" };
    expect((await status()).state).toBe("NOT_FOUND");
  });
  it("aynı kimlik farklı payload veya işlemde reddedilir", async () => {
    await expect(
      reserveRequest({ ...context, payloadHash: "different" })
    ).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
    await expect(
      reserveRequest({ ...context, operation: "/slip" })
    ).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
  });
  it("eski mali sonuca otomatik baseline/backfill yapmaz", async () => {
    fake.saved = { payload_hash: "legacy", response_json: "old result" };
    await expect(reserveRequest(context)).rejects.toMatchObject({
      code: "LEGACY_REQUEST_REVIEW_REQUIRED",
    });
    expect(
      fake.writes.mock.calls.every(
        ([sql]) => !String(sql).includes("UPDATE st_requests")
      )
    ).toBe(true);
  });
  it("rollback kanıtı olmadan başarısızlık kaydetmez", async () => {
    await recordRequestFailure(
      context,
      new Error("lost commit acknowledgement")
    );
    expect(fake.writes).not.toHaveBeenCalled();
  });
  it("doğrulanmış rollback yalnız güvenli hata kodu saklar", async () => {
    fake.rollback = true;
    await recordRequestFailure(
      context,
      new StationError("INVALID_INPUT", "sensitive payload", 400)
    );
    expect(fake.writes).toHaveBeenCalledWith(
      expect.stringContaining("state='FAILED'"),
      ["INVALID_INPUT", context.actorId, context.requestId, context.bindingHash]
    );
    expect(JSON.stringify(fake.writes.mock.calls)).not.toContain(
      "sensitive payload"
    );
  });
  it("gecikmiş başarısızlık yazımı eşzamanlı başarıyı ezmez", async () => {
    fake.rollback = true;
    fake.row!.state = "COMPLETED";
    await recordRequestFailure(context, new Error("rollback"));
    expect(fake.writes).not.toHaveBeenCalled();
  });
  it("çelişkili başarısızlık ve mali sonuç inceleme gerektirir", async () => {
    fake.row!.state = "FAILED";
    expect((await status()).state).toBe("FAILED");
    fake.saved = { response_json: "result" };
    expect((await status()).state).toBe("UNCERTAIN");
    await expect(lockRequest(connection, context)).rejects.toMatchObject({
      code: "REQUEST_PREVIOUSLY_FAILED",
    });
  });
});

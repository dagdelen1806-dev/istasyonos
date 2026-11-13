import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import {
  OPERATION_VERSION,
  operationStatus,
  type OperationStatus,
  type RecoverableOperation,
} from "../../shared/operation-recovery";
import { parseDbUtc } from "../../shared/datetime";
import {
  execute,
  first,
  withTransaction,
  transactionRollbackConfirmed,
} from "./db";
import { payloadHash, safeDate } from "./domain";
import { StationError, fail } from "./types";

type Row = RowDataPacket & Record<string, any>;
function isRecentIntent(value: unknown, databaseNow: unknown): boolean {
  try {
    // Compare timestamps from the same DB clock, including on separate hosts.
    const age =
      parseDbUtc(String(databaseNow)).getTime() -
      parseDbUtc(String(value)).getTime();
    return age >= 0 && age <= 30000;
  } catch {
    return false;
  }
}
export type RequestContext = {
  actorId: number;
  tenantId: string;
  requestId: string;
  operation: RecoverableOperation;
  scopeHash: string;
  payloadHash: string;
  bindingHash: string;
};
export function requestScopeHash(role: string, stationIds: string[]): string {
  return payloadHash({ role, stations: [...stationIds].sort() });
}
export function createRequestContext(
  input: Omit<RequestContext, "payloadHash" | "bindingHash">,
  body: Record<string, unknown>
): RequestContext {
  const normalized = Object.fromEntries(
    Object.entries(body).filter(([key]) => key !== "requestId")
  );
  for (const field of ["startsAt", "endsAt", "transactionAt"]) {
    if (
      normalized[field] !== undefined &&
      normalized[field] !== null &&
      normalized[field] !== ""
    )
      normalized[field] = safeDate(normalized[field], field).toISOString();
  }
  const hash = payloadHash(normalized);
  return {
    ...input,
    payloadHash: hash,
    bindingHash: payloadHash({
      version: OPERATION_VERSION,
      actor: input.actorId,
      tenant: input.tenantId,
      operation: input.operation,
      scope: input.scopeHash,
      payload: hash,
    }),
  };
}
function sameContext(row: Row, context: RequestContext): boolean {
  return (
    row.tenant_id === context.tenantId &&
    row.operation === context.operation &&
    Number(row.schema_version) === OPERATION_VERSION &&
    row.scope_hash === context.scopeHash &&
    row.payload_hash === context.payloadHash &&
    row.binding_hash === context.bindingHash
  );
}

/** An intent commits before business work. It never contains the financial payload. */
export async function reserveRequest(
  context: RequestContext
): Promise<{ legacy: boolean }> {
  // FK checks can hold users/tenant locks while the business transaction holds
  // tracking locks. Retry only this metadata transaction after a proven rollback;
  // never replay business work or retry a lost commit acknowledgement.
  for (let attempt = 0; ; attempt++) {
    try {
      return await reserveRequestOnce(context);
    } catch (error) {
      if (
        attempt >= 4 ||
        !transactionRollbackConfirmed(error) ||
        (error as { code?: string } | null)?.code !== "ER_LOCK_DEADLOCK"
      )
        throw error;
    }
  }
}

async function reserveRequestOnce(
  context: RequestContext
): Promise<{ legacy: boolean }> {
  return withTransaction(async connection => {
    // Duplicate reservations take an exclusive lock immediately. INSERT IGNORE
    // would take shared locks that can deadlock on the FOR UPDATE upgrade.
    // No payload/result is stored here.
    await execute(
      connection,
      `INSERT INTO st_request_tracking
      (actor_user_id,request_id,tenant_id,operation,schema_version,scope_hash,payload_hash,binding_hash)
      VALUES (?,?,?,?,?,?,?,?)
      ON DUPLICATE KEY UPDATE request_id=st_request_tracking.request_id`,
      [
        context.actorId,
        context.requestId,
        context.tenantId,
        context.operation,
        OPERATION_VERSION,
        context.scopeHash,
        context.payloadHash,
        context.bindingHash,
      ]
    );
    const row = await first<Row>(
      connection,
      "SELECT * FROM st_request_tracking WHERE actor_user_id=? AND request_id=? FOR UPDATE",
      [context.actorId, context.requestId]
    );
    if (
      row &&
      (row.tenant_id !== context.tenantId ||
        row.scope_hash !== context.scopeHash)
    )
      fail(
        "REQUEST_SCOPE_CHANGED",
        "İşlem için güncel yetki kapsamı eşleşmiyor.",
        403
      );
    if (!row || !sameContext(row, context))
      fail(
        "IDEMPOTENCY_CONFLICT",
        "İşlem kimliği farklı kullanıcı kapsamı, işlem türü, sürüm veya içerikle kullanılamaz.",
        409
      );
    const old = await first<Row>(
      connection,
      "SELECT payload_hash,response_json FROM st_requests WHERE actor_user_id=? AND request_id=?",
      [context.actorId, context.requestId]
    );
    // Existing legacy success cannot be attributed to a tenant/operation from a body hash alone.
    if (old && old.payload_hash !== context.bindingHash) {
      if (old.response_json == null)
        fail(
          "REQUEST_REVIEW_REQUIRED",
          "Eski işlemin sonucu doğrulanamıyor; yönetici incelemesi gerekli.",
          409
        );
      // Roll back this newly inserted reservation; do not backfill legacy records.
      throw new StationError(
        "LEGACY_REQUEST_REVIEW_REQUIRED",
        "Eski işlem kaydının tenant ve işlem türü doğrulanamıyor. Yeni kayıt oluşturmayın; yönetici incelemesi gerekli.",
        409
      );
    }
    return { legacy: false };
  });
}

export async function lockRequest(
  connection: PoolConnection,
  context: RequestContext
): Promise<Row> {
  const row = await first<Row>(
    connection,
    "SELECT *, UTC_TIMESTAMP(3) AS recovery_now FROM st_request_tracking WHERE actor_user_id=? AND request_id=? FOR UPDATE",
    [context.actorId, context.requestId]
  );
  if (!row || !sameContext(row, context))
    fail("IDEMPOTENCY_CONFLICT", "İşlem kapsamı veya içeriği eşleşmiyor.", 409);
  if (row.state === "FAILED")
    fail(
      "REQUEST_PREVIOUSLY_FAILED",
      "Bu işlem başarısız olarak sonuçlandı; aynı kimlikle yeniden mali kayıt oluşturulmaz.",
      409
    );
  if (
    row.state === "UNCERTAIN" ||
    (row.state === "PROCESSING" &&
      !isRecentIntent(row.created_at, row.recovery_now))
  )
    fail(
      "REQUEST_REVIEW_REQUIRED",
      "İşlem sonucu belirsiz; yeni kayıt oluşturmadan yönetici incelemesi isteyin.",
      409
    );
  return row;
}
export async function completeRequest(
  connection: PoolConnection,
  context: RequestContext
): Promise<void> {
  const result = await execute(
    connection,
    "UPDATE st_request_tracking SET state='COMPLETED',completed_at=UTC_TIMESTAMP(3),error_code=NULL WHERE actor_user_id=? AND request_id=? AND binding_hash=? AND state='PROCESSING'",
    [context.actorId, context.requestId, context.bindingHash]
  );
  if (result.affectedRows !== 1)
    fail(
      "REQUEST_REVIEW_REQUIRED",
      "İşlem tamamlanma kaydı doğrulanamadı; mali transaction geri alınacak.",
      500
    );
}
export async function recordRequestFailure(
  context: RequestContext,
  error: unknown
): Promise<void> {
  if (!transactionRollbackConfirmed(error)) return;
  try {
    await withTransaction(async connection => {
      const row = await first<Row>(
        connection,
        "SELECT * FROM st_request_tracking WHERE actor_user_id=? AND request_id=? FOR UPDATE",
        [context.actorId, context.requestId]
      );
      if (!row || !sameContext(row, context) || row.state !== "PROCESSING")
        return;
      const saved = await first<Row>(
        connection,
        "SELECT payload_hash,response_json FROM st_requests WHERE actor_user_id=? AND request_id=?",
        [context.actorId, context.requestId]
      );
      if (saved?.response_json != null) return;
      await execute(
        connection,
        "UPDATE st_request_tracking SET state='FAILED',completed_at=UTC_TIMESTAMP(3),error_code=? WHERE actor_user_id=? AND request_id=? AND binding_hash=? AND state='PROCESSING'",
        [
          error instanceof StationError ? error.code : "DATABASE_ERROR",
          context.actorId,
          context.requestId,
          context.bindingHash,
        ]
      );
    });
  } catch {
    /* Metadata write failure is uncertainty, never evidence of success/failure. */
  }
}

export async function readRequestStatus(
  connection: PoolConnection,
  lookup: Pick<
    RequestContext,
    "actorId" | "tenantId" | "requestId" | "operation" | "scopeHash"
  >,
  decode: (stored: string, bindingHash: string) => Promise<Record<string, any>>
): Promise<OperationStatus> {
  const row = await first<Row>(
    connection,
    "SELECT *, UTC_TIMESTAMP(3) AS recovery_now FROM st_request_tracking WHERE actor_user_id=? AND request_id=?",
    [lookup.actorId, lookup.requestId]
  );
  if (
    !row ||
    row.tenant_id !== lookup.tenantId ||
    row.operation !== lookup.operation ||
    Number(row.schema_version) !== OPERATION_VERSION ||
    row.scope_hash !== lookup.scopeHash
  )
    return operationStatus("NOT_FOUND");
  const saved = await first<Row>(
    connection,
    "SELECT payload_hash,response_json FROM st_requests WHERE actor_user_id=? AND request_id=?",
    [lookup.actorId, lookup.requestId]
  );
  if (row.state === "COMPLETED") {
    if (!saved?.response_json || saved.payload_hash !== row.binding_hash)
      return operationStatus("UNCERTAIN");
    try {
      const response = await decode(
        String(saved.response_json),
        String(row.binding_hash)
      );
      if (
        response.ok !== true ||
        !response.result ||
        typeof response.result !== "object" ||
        Array.isArray(response.result)
      )
        return operationStatus("UNCERTAIN");
      return {
        ...operationStatus("COMPLETED"),
        response: response as OperationStatus["response"],
      };
    } catch {
      return operationStatus("UNCERTAIN");
    }
  }
  if (saved?.response_json != null) return operationStatus("UNCERTAIN");
  if (row.state === "FAILED")
    return {
      ...operationStatus("FAILED"),
      errorCode: String(row.error_code ?? "REQUEST_FAILED"),
    };
  if (row.state !== "PROCESSING") return operationStatus("UNCERTAIN");
  return operationStatus(
    isRecentIntent(row.created_at, row.recovery_now)
      ? "IN_PROGRESS"
      : "UNCERTAIN"
  );
}

import { registerMarketAccountingRoutes } from "./market-accounting";
import { stationErrorLog } from "./error-log";
import { lockMarketBook } from "./market-accounting-ledger";
import { registerMarketPosRoutes } from "./market-pos";
import {
  anonymousSummary,
  classifyQuestion,
  explainSummary,
} from "./assistant";
import type { AppState } from "../../shared/station";
import { safeAdd, rejectCardData, recommendationQuantity } from "./safety";
import { randomUUID } from "node:crypto";
import type { Express, NextFunction, Request, Response } from "express";
import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import { sdk, type AuthenticatedUser } from "../_core/sdk";
import { ENV } from "../_core/env";
import { execute, first, query, rows, withTransaction } from "./db";
import {
  accountTotals,
  csrfToken,
  invitationHash,
  isRecord,
  isValidCsrf,
  mapDbError,
  mysqlDate,
  originIsSame,
  payloadHash,
  randomInvitationCode,
  requireBoolean,
  requireEnum,
  requireId,
  requireInteger,
  requireMoney,
  optionalString,
  requireRequestId,
  requireString,
  safeDate,
} from "./domain";
import {
  fail,
  StationError,
  type AccountTotals,
  type BusinessUnit,
  type PaymentKind,
  type StationActor,
  type StationMember,
  type StationRole,
  type StockKind,
  type TerminalKind,
} from "./types";

const PAYMENT_KINDS = ["CASH", "IBAN", "DEBT", "AR_COLLECTION"] as const;
const BUSINESS_UNITS = ["FUEL", "MARKET"] as const;
const STOCK_KINDS = ["RECEIPT", "SALE", "ADJUSTMENT"] as const;
const TERMINAL_KINDS = ["DESKTOP", "MOBILE"] as const;
const INVITE_ROLES = [
  "MANAGER",
  "ACCOUNTANT",
  "FUEL_STAFF",
  "MARKET_STAFF",
  "PURCHASER",
] as const;
const DEBTOR_TYPES = ["PERSON", "COMPANY"] as const;
const ACCOUNT_MUTABLE = ["OPEN", "SUBMITTED", "IN_REVIEW"] as const;

type StationRequest = Request & { stationActor?: StationActor };
type DbRow = RowDataPacket & Record<string, unknown>;
type Scope = { tenantId: string; member: StationMember; stationIds: string[] };
type AccountRow = DbRow & {
  id: string;
  tenant_id: string;
  station_id: string;
  shift_id: string;
  user_id: number;
  business_unit: BusinessUnit;
  opening_float_minor: number | string;
  source_sales_minor: number | string | null;
  source_ref: string | null;
  counted_cash_minor: number | string | null;
  difference_minor: number | string | null;
  cash_received_minor: number | string | null;
  cash_receiver_user_id: number | null;
  status: string;
  revision: number;
  cycle_no: number;
  user_name: string | null;
  cash_sales_minor: number | string;
  card_total_minor: number | string;
  iban_minor: number | string;
  debt_minor: number | string;
  ar_collection_minor: number | string;
  signature_count: number | string;
};

type AccountTotalsInput = Pick<
  AccountRow,
  | "cash_sales_minor"
  | "card_total_minor"
  | "iban_minor"
  | "debt_minor"
  | "ar_collection_minor"
  | "source_sales_minor"
>;

function n(value: unknown): number {
  const result = typeof value === "number" ? value : Number(value ?? 0);
  if (!Number.isSafeInteger(result))
    throw new StationError(
      "INVALID_MONEY",
      "Veritabanı tutarı güvenli tamsayı sınırını aşıyor.",
      500
    );
  return result;
}

function stationActor(req: StationRequest): StationActor {
  if (!req.stationActor)
    throw new StationError(
      "UNAUTHENTICATED",
      "Geçerli kullanıcı oturumu gerekli.",
      401
    );
  return req.stationActor;
}

function responseError(res: Response, error: unknown): void {
  const mapped = error instanceof StationError ? error : mapDbError(error);
  if (!(error instanceof StationError))
    console.error(stationErrorLog(error, res.req));
  res
    .status(mapped.status)
    .json({ ok: false, error: { code: mapped.code, message: mapped.message } });
}

function bodyOf(req: Request): Record<string, unknown> {
  if (!isRecord(req.body)) fail("INVALID_INPUT", "JSON nesnesi gerekli.");
  return req.body;
}

function assertMutationRequest(req: Request, actor: StationActor): void {
  if (!originIsSame(req))
    fail("ORIGIN_REJECTED", "Yabancı origin isteği reddedildi.", 403);
  if (
    req.get("content-type")?.toLowerCase().split(";")[0] !== "application/json"
  ) {
    fail("JSON_REQUIRED", "Mutasyonlar application/json olmalıdır.", 415);
  }
  if (req.get("X-Stationos-Request") !== "1")
    fail(
      "REQUEST_HEADER_REQUIRED",
      "X-Stationos-Request: 1 başlığı gerekli.",
      400
    );
  if (
    !isValidCsrf(actor, req.get("X-CSRF-Token") ?? req.get("X-Stationos-CSRF"))
  )
    fail("CSRF_REJECTED", "CSRF doğrulaması başarısız.", 403);
}

async function scopeFor(
  connection: PoolConnection,
  actorId: number
): Promise<Scope | null> {
  const member = await first<DbRow>(
    connection,
    `SELECT tenant_id, user_id, role FROM st_members WHERE user_id = ? ORDER BY created_at ASC LIMIT 1`,
    [actorId]
  );
  if (!member) return null;
  const tenantId = String(member.tenant_id);
  const role = String(member.role) as StationRole;
  let stationRows: DbRow[];
  if (role === "OWNER") {
    stationRows = await rows<DbRow[]>(
      connection,
      `SELECT id FROM st_stations WHERE tenant_id = ? ORDER BY created_at ASC`,
      [tenantId]
    );
  } else {
    stationRows = await rows<DbRow[]>(
      connection,
      `SELECT station_id AS id FROM st_member_stations WHERE tenant_id = ? AND user_id = ? ORDER BY station_id`,
      [tenantId, actorId]
    );
  }
  return {
    tenantId,
    member: {
      tenantId,
      userId: actorId,
      role,
      stationIds: stationRows.map(row => String(row.id)),
    },
    stationIds: stationRows.map(row => String(row.id)),
  };
}

async function requireScope(
  connection: PoolConnection,
  actor: StationActor,
  roles?: readonly StationRole[]
): Promise<Scope> {
  const scope = await scopeFor(connection, actor.id);
  if (!scope)
    fail("NOT_MEMBER", "Bu kullanıcı henüz bir istasyona atanmadı.", 403);
  if (roles && !roles.includes(scope.member.role))
    fail("ROLE_FORBIDDEN", "Bu işlem için rolünüzün yetkisi yok.", 403);
  return scope;
}

async function requireStation(
  connection: PoolConnection,
  actor: StationActor,
  stationId: string,
  roles?: readonly StationRole[]
): Promise<{ scope: Scope; station: DbRow }> {
  const scope = await requireScope(connection, actor, roles);
  if (!scope.stationIds.includes(stationId))
    fail("STATION_FORBIDDEN", "Bu istasyon kapsamınızda değil.", 403);
  const station = await first<DbRow>(
    connection,
    `SELECT id, tenant_id, company_id, name, code, address FROM st_stations WHERE id = ? AND tenant_id = ?`,
    [stationId, scope.tenantId]
  );
  if (!station) fail("NOT_FOUND", "İstasyon bulunamadı.", 404);
  return { scope, station };
}

async function audit(
  connection: PoolConnection,
  tenantId: string,
  stationId: string | null,
  actorId: number,
  action: string,
  entityId: string | null
): Promise<void> {
  await execute(
    connection,
    `INSERT INTO st_audit (tenant_id, station_id, actor_user_id, action, entity_id) VALUES (?, ?, ?, ?, ?)`,
    [tenantId, stationId, actorId, action, entityId]
  );
}

async function mutation<T>(
  actor: StationActor,
  body: Record<string, unknown>,
  fn: (connection: PoolConnection) => Promise<T>
): Promise<{ ok: true; result: T }> {
  const requestId = requireRequestId(body);
  const hash = payloadHash(body);
  return withTransaction(async connection => {
    await execute(
      connection,
      `INSERT IGNORE INTO st_requests (actor_user_id, request_id, payload_hash) VALUES (?, ?, ?)`,
      [actor.id, requestId, hash]
    );
    const saved = await first<DbRow>(
      connection,
      `SELECT payload_hash, response_json FROM st_requests WHERE actor_user_id = ? AND request_id = ? FOR UPDATE`,
      [actor.id, requestId]
    );
    if (!saved) fail("IDEMPOTENCY_ERROR", "İstek durumu okunamadı.", 500);
    if (String(saved.payload_hash) !== hash)
      fail(
        "IDEMPOTENCY_CONFLICT",
        "requestId farklı bir içerikle tekrar kullanıldı.",
        409
      );
    if (saved.response_json !== null) {
      try {
        return JSON.parse(String(saved.response_json)) as {
          ok: true;
          result: T;
        };
      } catch {
        fail("IDEMPOTENCY_ERROR", "Önceki isteğin sonucu okunamadı.", 500);
      }
    }
    const result = await fn(connection);
    const response = { ok: true as const, result };
    await execute(
      connection,
      `UPDATE st_requests SET response_json = ? WHERE actor_user_id = ? AND request_id = ?`,
      [JSON.stringify(response), actor.id, requestId]
    );
    return response;
  });
}

function accountInput(account: AccountRow): AccountTotals {
  return accountTotals({
    cashSalesMinor: n(account.cash_sales_minor),
    cardTotalMinor: n(account.card_total_minor),
    ibanMinor: n(account.iban_minor),
    debtMinor: n(account.debt_minor),
    arCollectionMinor: n(account.ar_collection_minor),
    sourceSalesMinor:
      account.source_sales_minor === null
        ? null
        : n(account.source_sales_minor),
  });
}

export const ACCOUNT_TOTAL_COLUMNS = `
  COALESCE((SELECT SUM(p.amount_minor) FROM st_payments p WHERE p.account_id = a.id AND p.kind = 'CASH' AND p.status = 'POSTED'),0) AS cash_sales_minor,
  COALESCE((SELECT SUM(p.amount_minor) FROM st_payments p WHERE p.account_id = a.id AND p.kind = 'IBAN' AND p.status = 'POSTED'),0) AS iban_minor,
  COALESCE((SELECT SUM(p.amount_minor) FROM st_payments p WHERE p.account_id = a.id AND p.kind = 'DEBT' AND p.status = 'POSTED'),0) AS debt_minor,
  COALESCE((SELECT SUM(p.amount_minor) FROM st_payments p WHERE p.account_id = a.id AND p.kind = 'AR_COLLECTION' AND p.status = 'POSTED'),0) AS ar_collection_minor,
  COALESCE((SELECT SUM(s.amount_minor) FROM st_slips s WHERE s.account_id = a.id AND s.status = 'VERIFIED'),0) AS card_total_minor,
  (SELECT COUNT(*) FROM st_account_signatures sig WHERE sig.account_id = a.id AND sig.cycle_no = a.cycle_no AND sig.kind = 'APPROVAL') AS signature_count`;

async function lockedAccount(
  connection: PoolConnection,
  accountId: string
): Promise<AccountRow> {
  const account = await first<AccountRow>(
    connection,
    `SELECT a.*, u.name AS user_name, ${ACCOUNT_TOTAL_COLUMNS}
     FROM st_accounts a JOIN users u ON u.id = a.user_id WHERE a.id = ? FOR UPDATE`,
    [accountId]
  );
  if (!account) fail("NOT_FOUND", "Vardiya hesabı bulunamadı.", 404);
  return account;
}

function checkRevision(account: AccountRow, expected: unknown): number {
  const revision = requireInteger(expected, "expectedRevision");
  if (revision !== n(account.revision))
    fail(
      "REVISION_CONFLICT",
      "Hesap başka bir işlemle değişti; güncel durumu yenileyin.",
      409
    );
  return revision;
}

function checkAccountOwner(account: AccountRow, actor: StationActor): void {
  if (n(account.user_id) !== actor.id)
    fail("ACCOUNT_FORBIDDEN", "Bu hesap size ait değil.", 403);
}

function checkNotAccountOwner(account: AccountRow, actor: StationActor): void {
  if (n(account.user_id) === actor.id)
    fail(
      "SELF_APPROVAL_FORBIDDEN",
      "Kendi hesabınızı teslim alamaz veya onaylayamazsınız.",
      403
    );
}

async function stationFromAccount(
  connection: PoolConnection,
  actor: StationActor,
  account: AccountRow,
  roles?: readonly StationRole[]
): Promise<Scope> {
  return (
    await requireStation(connection, actor, String(account.station_id), roles)
  ).scope;
}

async function accountEvent(
  connection: PoolConnection,
  account: AccountRow,
  actor: StationActor,
  eventType: string,
  revision: number,
  payload: Record<string, unknown>
) {
  await execute(
    connection,
    `INSERT INTO st_account_events (id, account_id, actor_user_id, cycle_no, revision, event_type, payload_json) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      randomUUID(),
      account.id,
      actor.id,
      n(account.cycle_no),
      revision,
      eventType,
      JSON.stringify(payload),
    ]
  );
}

async function ensureDeviceLease(
  connection: PoolConnection,
  actor: StationActor,
  account: AccountRow,
  body: Record<string, unknown>
): Promise<void> {
  const meta = (body as any).__stationDevice;
  const deviceId = requireId(meta?.id, "X-Stationos-Device-Id");
  const detectedKind = /Android|iPhone|iPad|iPod|Mobile/i.test(
    meta.userAgent || ""
  )
    ? "MOBILE"
    : "DESKTOP";
  if (meta.kind !== detectedKind)
    fail(
      "DEVICE_KIND_MISMATCH",
      "Tarayıcı türü cihaz bildirimiyle eşleşmiyor.",
      400
    );
  const kind = requireEnum(
    meta?.kind,
    "X-Stationos-Device-Kind",
    TERMINAL_KINDS
  );
  if (kind === "DESKTOP") {
    const active = await first<DbRow>(
      connection,
      `SELECT COUNT(*) AS count FROM st_terminal_leases WHERE account_id = ? AND device_id <> ? AND kind = 'DESKTOP' AND expires_at > CURRENT_TIMESTAMP(3)`,
      [account.id, deviceId]
    );
    if (n(active?.count) >= 5)
      fail(
        "TERMINAL_LIMIT",
        "Bu vardiya hesabında beş masaüstü terminal zaten etkin.",
        409
      );
  }
  const expiry = mysqlDate(new Date(Date.now() + 5 * 60 * 1000));
  await execute(
    connection,
    `INSERT INTO st_terminal_leases (account_id, device_id, kind, acquired_by_user_id, expires_at) VALUES (?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE kind=VALUES(kind), acquired_by_user_id=VALUES(acquired_by_user_id), expires_at=VALUES(expires_at)`,
    [account.id, deviceId, kind, actor.id, expiry]
  );
}

async function stateFor(
  actor: StationActor,
  stationFilter: string | null
): Promise<Record<string, unknown>> {
  const connection = await (await import("./db"))
    .getStationPool()
    .getConnection();
  try {
    await connection.beginTransaction();
    const scope = await scopeFor(connection, actor.id);
    const canSetup =
      !scope &&
      (!ENV.ownerOpenId ||
        ENV.ownerOpenId === actor.openId ||
        actor.role === "admin");
    const empty = {
      user: { id: actor.id, name: actor.name ?? "", email: actor.email },
      canSetup,
      tenant: null,
      member: null,
      csrfToken: csrfToken(actor),
      companies: [],
      stations: [],
      members: [],
      shifts: [],
      accounts: [],
      payments: [],
      slips: [],
      debtors: [],
      products: [],
      suppliers: [],
      payables: [],
      recommendations: [],
      audit: [],
      integrationStatus: {
        turpak: "DISABLED",
        ocr: "DISABLED",
        bank: "DISABLED",
      },
    };
    if (!scope) return empty;
    if (stationFilter && !scope.stationIds.includes(stationFilter))
      fail("STATION_FORBIDDEN", "Bu istasyon kapsamınızda değil.", 403);
    const stationIds = stationFilter ? [stationFilter] : scope.stationIds;
    if (stationIds.length === 0) {
      return {
        ...empty,
        canSetup: false,
        tenant: null,
        member: { role: scope.member.role, stationIds: [] },
      };
    }
    const placeholders = stationIds.map(() => "?").join(",");
    const tenant = await rows<DbRow[]>(
      connection,
      `SELECT id, name, is_demo FROM st_tenants WHERE id = ? LIMIT 1`,
      [scope.tenantId]
    );
    const companyRows = ["OWNER"].includes(scope.member.role)
      ? await rows<DbRow[]>(
          connection,
          `SELECT id,name,tax_number FROM st_companies WHERE tenant_id=? ORDER BY name`,
          [scope.tenantId]
        )
      : await rows<DbRow[]>(
          connection,
          `SELECT DISTINCT c.id,c.name,c.tax_number FROM st_companies c JOIN st_stations s ON s.company_id=c.id WHERE c.tenant_id=? AND s.id IN (${placeholders}) ORDER BY c.name`,
          [scope.tenantId, ...stationIds]
        );
    const stations = await rows<DbRow[]>(
      connection,
      `SELECT id, company_id, name, code, address FROM st_stations WHERE tenant_id = ? AND id IN (${placeholders}) ORDER BY name`,
      [scope.tenantId, ...stationIds]
    );
    const memberRows = await rows<DbRow[]>(
      connection,
      `SELECT DISTINCT m.user_id, u.name, u.email, m.role, ms.station_id FROM st_members m JOIN users u ON u.id = m.user_id LEFT JOIN st_member_stations ms ON ms.tenant_id = m.tenant_id AND ms.user_id = m.user_id WHERE m.tenant_id = ? AND (m.role = 'OWNER' OR ms.station_id IN (${placeholders})) ORDER BY u.name`,
      [scope.tenantId, ...stationIds]
    );
    const membersById = new Map<
      number,
      {
        userId: number;
        name: string;
        email: string | null;
        role: string;
        stationIds: string[];
      }
    >();
    for (const row of memberRows) {
      const id = n(row.user_id);
      const current = membersById.get(id) ?? {
        userId: id,
        name: String(row.name ?? ""),
        email: row.email === null ? null : String(row.email),
        role: String(row.role),
        stationIds: [],
      };
      if (
        row.station_id &&
        !current.stationIds.includes(String(row.station_id))
      )
        current.stationIds.push(String(row.station_id));
      if (current.role === "OWNER") current.stationIds = [...stationIds];
      membersById.set(id, current);
    }
    const shiftRows = await rows<DbRow[]>(
      connection,
      `SELECT id, station_id, label, starts_at, ends_at, status FROM st_shifts WHERE tenant_id = ? AND station_id IN (${placeholders}) ORDER BY starts_at DESC`,
      [scope.tenantId, ...stationIds]
    );
    const isStaff = ["FUEL_STAFF", "MARKET_STAFF", "PURCHASER"].includes(
      scope.member.role
    );
    const accountRows = await rows<AccountRow[]>(
      connection,
      `SELECT a.*, u.name AS user_name, ${ACCOUNT_TOTAL_COLUMNS}
      FROM st_accounts a JOIN users u ON u.id = a.user_id
      WHERE a.tenant_id = ? AND a.station_id IN (${placeholders}) ${isStaff ? "AND a.user_id = ?" : ""}
      ORDER BY a.created_at DESC`,
      [scope.tenantId, ...stationIds, ...(isStaff ? [actor.id] : [])]
    );
    const accountIds = accountRows.map(row => String(row.id));
    const accountPlaceholder = accountIds.length
      ? accountIds.map(() => "?").join(",")
      : "''";
    const paymentRows = await rows<DbRow[]>(
      connection,
      `SELECT id, account_id, kind, amount_minor, debtor_id, reference, status FROM st_payments WHERE tenant_id = ? AND station_id IN (${placeholders}) ${isStaff ? `AND account_id IN (${accountPlaceholder})` : ""} ORDER BY created_at DESC`,
      [scope.tenantId, ...stationIds, ...(isStaff ? accountIds : [])]
    );
    const slipRows = accountIds.length
      ? await rows<DbRow[]>(
          connection,
          `SELECT id, account_id, amount_minor, reference, terminal_id, transaction_at, status, method, note FROM st_slips WHERE station_id IN (${placeholders}) AND account_id IN (${accountPlaceholder}) ORDER BY transaction_at DESC`,
          [...stationIds, ...accountIds]
        )
      : [];
    const sensitive = ["OWNER", "MANAGER", "ACCOUNTANT"].includes(
      scope.member.role
    );
    const debtorRows =
      scope.member.role === "PURCHASER"
        ? []
        : await rows<DbRow[]>(
            connection,
            `SELECT id, name, type, balance_minor FROM st_debtors WHERE tenant_id = ? AND station_id IN (${placeholders}) ORDER BY name`,
            [scope.tenantId, ...stationIds]
          );
    const productRows = await rows<DbRow[]>(
      connection,
      `SELECT id, station_id, name, barcode, stock_qty, minimum_qty, purchase_price_minor, sale_price_minor, supplier_id FROM st_products WHERE tenant_id = ? AND station_id IN (${placeholders}) ORDER BY name`,
      [scope.tenantId, ...stationIds]
    );
    const supplierRows =
      sensitive || scope.member.role === "PURCHASER"
        ? await rows<DbRow[]>(
            connection,
            `SELECT s.id, s.name, s.credit_limit_minor, COALESCE(SUM(CASE WHEN p.status = 'OPEN' THEN p.amount_minor ELSE 0 END),0) AS balance_minor, COALESCE(SUM(CASE WHEN p.status = 'OPEN' AND p.due_date <= CURRENT_DATE THEN p.amount_minor ELSE 0 END),0) AS due_minor FROM st_suppliers s LEFT JOIN st_payables p ON p.supplier_id = s.id WHERE s.tenant_id = ? AND s.station_id IN (${placeholders}) GROUP BY s.id ORDER BY s.name`,
            [scope.tenantId, ...stationIds]
          )
        : [];
    const payableRows =
      sensitive || scope.member.role === "PURCHASER"
        ? await rows<DbRow[]>(
            connection,
            `SELECT p.id, p.supplier_id, s.name AS supplier_name, p.amount_minor, p.due_date, p.status FROM st_payables p JOIN st_suppliers s ON s.id = p.supplier_id WHERE p.tenant_id = ? AND p.station_id IN (${placeholders}) ORDER BY p.due_date`,
            [scope.tenantId, ...stationIds]
          )
        : [];
    const mayRecommend = ["OWNER", "MANAGER", "PURCHASER"].includes(
      scope.member.role
    );
    const saleTotals = mayRecommend
      ? await rows<DbRow[]>(
          connection,
          `SELECT product_id, SUM(CASE WHEN kind='SALE' THEN quantity ELSE -quantity END) AS quantity28 FROM st_stock_movements
       WHERE tenant_id = ? AND station_id IN (${placeholders}) AND kind IN ('SALE','SALE_RETURN')
       AND created_at >= DATE_SUB(CURRENT_TIMESTAMP(3), INTERVAL 28 DAY)
       GROUP BY product_id`,
          [scope.tenantId, ...stationIds]
        )
      : [];
    const salesByProduct = new Map(
      saleTotals.map(row => [String(row.product_id), n(row.quantity28)])
    );
    const suppliersById = new Map(
      supplierRows.map(row => [String(row.id), row])
    );
    const remainingCredit = new Map(
      supplierRows.map(row => [
        String(row.id),
        Math.max(0, n(row.credit_limit_minor) - n(row.balance_minor)),
      ])
    );
    const recommendations = mayRecommend
      ? productRows
          .map(product => {
            const averageDaily =
              Math.max(0, salesByProduct.get(String(product.id)) || 0) / 28;
            const stockQty = n(product.stock_qty);
            const recommendedQty = recommendationQuantity(
              stockQty,
              n(product.minimum_qty),
              averageDaily
            );
            const costMinor = n(
              recommendedQty * n(product.purchase_price_minor)
            );
            return {
              productId: String(product.id),
              productName: String(product.name),
              supplierId:
                product.supplier_id === null
                  ? null
                  : String(product.supplier_id),
              averageDaily,
              stockQty,
              daysCover: averageDaily > 0 ? stockQty / averageDaily : null,
              recommendedQty,
              costMinor,
            };
          })
          .sort(
            (a, b) =>
              (a.daysCover ?? Number.MAX_SAFE_INTEGER) -
              (b.daysCover ?? Number.MAX_SAFE_INTEGER)
          )
          .map(row => {
            const supplier = row.supplierId
              ? suppliersById.get(row.supplierId)
              : undefined;
            const availableCreditMinor =
              row.supplierId && supplier
                ? remainingCredit.get(row.supplierId)!
                : null;
            const status =
              row.recommendedQty === 0
                ? "NO_ORDER"
                : !supplier
                  ? "NO_SUPPLIER"
                  : row.costMinor > (availableCreditMinor ?? 0)
                    ? "CREDIT_BLOCKED"
                    : (row.daysCover !== null && row.daysCover < 3) ||
                        row.stockQty === 0
                      ? "STOCKOUT"
                      : "READY";
            if (
              row.supplierId &&
              supplier &&
              ["READY", "STOCKOUT"].includes(status)
            )
              remainingCredit.set(
                row.supplierId,
                (availableCreditMinor ?? 0) - row.costMinor
              );
            return {
              ...row,
              supplierName: supplier ? String(supplier.name) : null,
              availableCreditMinor,
              status,
            };
          })
      : [];
    const eventRows = accountIds.length
      ? await rows<DbRow[]>(
          connection,
          `SELECT e.*, u.name AS actor_name FROM st_account_events e JOIN users u ON u.id = e.actor_user_id WHERE e.account_id IN (${accountPlaceholder}) ORDER BY e.created_at DESC LIMIT 100`,
          accountIds
        )
      : [];
    const auditRows = await rows<DbRow[]>(
      connection,
      `SELECT a.id, a.actor_user_id, u.name AS actor_name, a.action, a.entity_id, a.created_at FROM st_audit a JOIN users u ON u.id = a.actor_user_id WHERE a.tenant_id = ? AND (a.station_id IS NULL OR a.station_id IN (${placeholders})) ORDER BY a.created_at DESC LIMIT 100`,
      [scope.tenantId, ...stationIds]
    );
    return {
      user: { id: actor.id, name: actor.name ?? "", email: actor.email },
      canSetup: false,
      tenant: tenant[0]
        ? {
            id: String(tenant[0].id),
            name: String(tenant[0].name),
            isDemo: Boolean(tenant[0].is_demo),
          }
        : null,
      member: { role: scope.member.role, stationIds },
      csrfToken: csrfToken(actor),
      companies: companyRows.map(row => ({
        id: String(row.id),
        name: String(row.name),
        taxNumber:
          isStaff || row.tax_number === null ? null : String(row.tax_number),
      })),
      stations: stations.map(row => ({
        id: String(row.id),
        companyId: String(row.company_id),
        name: String(row.name),
        code: String(row.code),
        address: row.address === null ? null : String(row.address),
      })),
      members: isStaff
        ? [...membersById.values()].filter(m => m.userId === actor.id)
        : [...membersById.values()],
      shifts: shiftRows.map(row => ({
        id: String(row.id),
        stationId: String(row.station_id),
        label: String(row.label),
        startsAt: new Date(String(row.starts_at)).toISOString(),
        endsAt: row.ends_at
          ? new Date(String(row.ends_at)).toISOString()
          : null,
        status: String(row.status),
      })),
      accounts: accountRows.map(row => {
        const totals = accountInput(row);
        const own = n(row.user_id) === actor.id;
        return {
          id: String(row.id),
          stationId: String(row.station_id),
          shiftId: String(row.shift_id),
          userId: n(row.user_id),
          userName: String(row.user_name ?? ""),
          status: String(row.status),
          revision: n(row.revision),
          businessUnit: row.business_unit,
          openingFloatMinor: n(row.opening_float_minor),
          sourceSalesMinor:
            row.source_sales_minor === null ? null : n(row.source_sales_minor),
          sourceRef: row.source_ref,
          cardTotalMinor: totals.cardTotalMinor,
          cashSalesMinor: totals.cashSalesMinor,
          ibanMinor: totals.ibanMinor,
          debtMinor: own || sensitive ? totals.debtMinor : null,
          arCollectionMinor: totals.arCollectionMinor,
          expectedCashMinor: totals.expectedCashMinor,
          countedCashMinor:
            row.counted_cash_minor === null ? null : n(row.counted_cash_minor),
          differenceMinor:
            row.difference_minor === null ? null : n(row.difference_minor),
          cashReceiverUserId:
            row.cash_receiver_user_id === null
              ? null
              : n(row.cash_receiver_user_id),
          signatureCount: n(row.signature_count),
        };
      }),
      payments: paymentRows.map(row => ({
        id: String(row.id),
        accountId: row.account_id === null ? null : String(row.account_id),
        kind: String(row.kind),
        amountMinor: n(row.amount_minor),
        debtorId: row.debtor_id === null ? null : String(row.debtor_id),
        reference: row.reference === null ? null : String(row.reference),
        status: String(row.status),
      })),
      slips: slipRows.map(row => ({
        id: String(row.id),
        accountId: String(row.account_id),
        amountMinor: n(row.amount_minor),
        reference: String(row.reference),
        terminalId: String(row.terminal_id),
        transactionAt: new Date(String(row.transaction_at)).toISOString(),
        status: String(row.status),
        method: String(row.method),
        note: row.note === null ? null : String(row.note),
      })),
      debtors: debtorRows.map(row => ({
        id: String(row.id),
        name: String(row.name),
        type: String(row.type),
        balanceMinor: sensitive ? n(row.balance_minor) : null,
      })),
      products: productRows.map(row => ({
        id: String(row.id),
        stationId: String(row.station_id),
        name: String(row.name),
        barcode: String(row.barcode),
        stockQty: n(row.stock_qty),
        minimumQty: n(row.minimum_qty),
        purchasePriceMinor:
          sensitive || scope.member.role === "PURCHASER"
            ? n(row.purchase_price_minor)
            : null,
        salePriceMinor: n(row.sale_price_minor),
        supplierId: row.supplier_id === null ? null : String(row.supplier_id),
      })),
      suppliers: supplierRows.map(row => ({
        id: String(row.id),
        name: String(row.name),
        creditLimitMinor: n(row.credit_limit_minor),
        balanceMinor: n(row.balance_minor),
        dueMinor: n(row.due_minor),
      })),
      payables: payableRows.map(row => ({
        id: String(row.id),
        supplierId: String(row.supplier_id),
        supplierName: String(row.supplier_name),
        amountMinor: n(row.amount_minor),
        dueDate: String(row.due_date),
        status: String(row.status),
      })),
      recommendations,
      audit: (isStaff
        ? auditRows.filter(row => n(row.actor_user_id) === actor.id)
        : auditRows
      ).map(row => ({
        id: n(row.id),
        actorName: String(row.actor_name ?? ""),
        action: String(row.action),
        entityId: row.entity_id === null ? null : String(row.entity_id),
        createdAt: new Date(String(row.created_at)).toISOString(),
      })),
      accountEvents: eventRows.map(row => ({
        id: String(row.id),
        accountId: String(row.account_id),
        actorName: String(row.actor_name ?? ""),
        eventType: String(row.event_type),
        revision: n(row.revision),
        createdAt: new Date(String(row.created_at)).toISOString(),
        payload: JSON.parse(String(row.payload_json)),
      })),
      integrationStatus: {
        turpak: "DISABLED",
        ocr: "DISABLED",
        bank: "DISABLED",
      },
    };
  } finally {
    await connection.rollback();
    connection.release();
  }
}

async function authenticated(
  req: StationRequest,
  _res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const user = await sdk.authenticateRequest(req);
    if (user.isCron || user.id < 0)
      throw new StationError(
        "UNAUTHENTICATED",
        "Kullanıcı oturumu gerekli.",
        401
      );
    req.stationActor = {
      id: user.id,
      openId: user.openId,
      name: user.name ?? null,
      email: user.email ?? null,
      role: user.role,
    };
    next();
  } catch (error) {
    responseError(
      _res,
      error instanceof StationError
        ? error
        : new StationError(
            "UNAUTHENTICATED",
            "Geçerli kullanıcı oturumu gerekli.",
            401
          )
    );
  }
}

function handler(fn: (req: StationRequest, res: Response) => Promise<void>) {
  return async (req: StationRequest, res: Response): Promise<void> => {
    try {
      await fn(req, res);
    } catch (error) {
      responseError(res, error);
    }
  };
}

function mutationHandler(
  fn: (actor: StationActor, body: Record<string, unknown>) => Promise<unknown>
) {
  return handler(async (req, res) => {
    const actor = stationActor(req);
    assertMutationRequest(req, actor);
    const body = bodyOf(req);
    Object.defineProperty(body, "__stationDevice", {
      value: {
        id: req.get("X-Stationos-Device-Id"),
        kind: req.get("X-Stationos-Device-Kind"),
        userAgent: req.get("user-agent") || "",
      },
      enumerable: false,
    });
    res.json(await fn(actor, body));
  });
}

async function setup(
  actor: StationActor,
  body: Record<string, unknown>
): Promise<unknown> {
  const companyName = requireString(body.companyName, "companyName", {
    max: 190,
  });
  const taxNumber =
    body.taxNumber === null ||
    body.taxNumber === undefined ||
    body.taxNumber === ""
      ? null
      : requireString(body.taxNumber, "taxNumber", { max: 64 });
  const stationName = requireString(body.stationName, "stationName", {
    max: 190,
  });
  const stationCode = requireString(body.stationCode, "stationCode", {
    max: 64,
  });
  const address =
    body.address === undefined || body.address === null || body.address === ""
      ? null
      : requireString(body.address, "address", { max: 500 });
  if (typeof body.isDemo !== "boolean")
    fail("INVALID_INPUT", "isDemo açıkça true veya false olmalıdır.");
  const isDemo = requireBoolean(body.isDemo, "isDemo");
  return mutation(actor, body, async connection => {
    if (
      ENV.ownerOpenId &&
      ENV.ownerOpenId !== actor.openId &&
      actor.role !== "admin"
    )
      fail(
        "SETUP_FORBIDDEN",
        "Firma kurulumu yalnızca doğrulanmış proje sahibi/admin tarafından yapılabilir.",
        403
      );
    await first<DbRow>(
      connection,
      `SELECT id FROM users WHERE id = ? FOR UPDATE`,
      [actor.id]
    );
    const existing = await first<DbRow>(
      connection,
      `SELECT tenant_id FROM st_members WHERE user_id = ? LIMIT 1 FOR UPDATE`,
      [actor.id]
    );
    if (existing)
      fail(
        "ALREADY_ASSIGNED",
        "Bu kullanıcı zaten bir çalışma alanına atanmış.",
        409
      );
    const tenantId = randomUUID();
    const companyId = randomUUID();
    const stationId = randomUUID();
    await execute(
      connection,
      `INSERT INTO st_tenants (id, name, is_demo, created_by_user_id) VALUES (?, ?, ?, ?)`,
      [tenantId, companyName, isDemo, actor.id]
    );
    await execute(
      connection,
      `INSERT INTO st_companies (id, tenant_id, name, tax_number) VALUES (?, ?, ?, ?)`,
      [companyId, tenantId, companyName, taxNumber]
    );
    await execute(
      connection,
      `INSERT INTO st_stations (id, tenant_id, company_id, name, code, address) VALUES (?, ?, ?, ?, ?, ?)`,
      [stationId, tenantId, companyId, stationName, stationCode, address]
    );
    await execute(
      connection,
      `INSERT INTO st_members (tenant_id, user_id, role) VALUES (?, ?, 'OWNER')`,
      [tenantId, actor.id]
    );
    await execute(
      connection,
      `INSERT INTO st_member_stations (tenant_id, user_id, station_id) VALUES (?, ?, ?)`,
      [tenantId, actor.id, stationId]
    );
    if (isDemo) {
      const supplierId = randomUUID();
      const productId = randomUUID();
      const shiftId = randomUUID();
      await execute(
        connection,
        `INSERT INTO st_suppliers (id, tenant_id, station_id, name, credit_limit_minor, created_by_user_id) VALUES (?, ?, ?, 'DEMO - Örnek Tedarikçi', 1000000, ?)`,
        [supplierId, tenantId, stationId, actor.id]
      );
      await execute(
        connection,
        `INSERT INTO st_products (id, tenant_id, station_id, name, barcode, minimum_qty, purchase_price_minor, sale_price_minor, supplier_id, created_by_user_id) VALUES (?, ?, ?, 'DEMO - Örnek Ürün', ?, 10, 1000, 1500, ?, ?)`,
        [
          productId,
          tenantId,
          stationId,
          `DEMO-${stationCode}`,
          supplierId,
          actor.id,
        ]
      );
      await execute(
        connection,
        `INSERT INTO st_shifts (id, tenant_id, station_id, label, starts_at, status) VALUES (?, ?, ?, 'DEMO - Örnek Vardiya', CURRENT_TIMESTAMP(3), 'OPEN')`,
        [shiftId, tenantId, stationId]
      );
    }
    await audit(
      connection,
      tenantId,
      stationId,
      actor.id,
      isDemo ? "SETUP_DEMO" : "SETUP",
      tenantId
    );
    return { tenantId, companyId, stationId };
  });
}

export function registerStationRoutes(app: Express): void {
  app.use("/api/stationos", authenticated);
  registerMarketPosRoutes(app, {
    actor: stationActor,
    assertMutation: assertMutationRequest,
    error: responseError,
    requireStation,
    mutation,
    audit,
  });
  registerMarketAccountingRoutes(app, {
    actor: stationActor,
    assertMutation: assertMutationRequest,
    error: responseError,
    requireStation,
    mutation,
    audit,
  });
  app.get(
    "/api/stationos/state",
    handler(async (req, res) => {
      const actor = stationActor(req);
      const filter =
        typeof req.query.stationId === "string"
          ? requireId(req.query.stationId, "stationId")
          : null;
      res.json(await stateFor(actor, filter));
    })
  );
  app.post(
    "/api/stationos/assistant",
    handler(async (req, res) => {
      const actor = stationActor(req);
      assertMutationRequest(req, actor);
      const body = bodyOf(req);
      const requestId = requireRequestId(body);
      const question = requireString(body.question, "question", { max: 1500 });
      rejectCardData(question);
      const stationId = body.stationId
        ? requireId(body.stationId, "stationId")
        : null;
      const state = (await stateFor(actor, stationId)) as unknown as AppState;
      if (!state.member)
        fail("NOT_MEMBER", "Asistan için firma üyeliği gerekli.", 403);
      const topic = classifyQuestion(question);
      const scopeHash = payloadHash({
        role: state.member.role,
        stations: [...state.member.stationIds].sort(),
      });
      const hash = payloadHash({ question, stationId });
      const cached = await withTransaction(async connection => {
        await first<DbRow>(
          connection,
          `SELECT id FROM users WHERE id=? FOR UPDATE`,
          [actor.id]
        );
        const saved = await first<DbRow>(
          connection,
          `SELECT * FROM st_assistant_requests WHERE actor_user_id=? AND request_id=? FOR UPDATE`,
          [actor.id, requestId]
        );
        if (saved) {
          if (saved.payload_hash !== hash)
            fail(
              "IDEMPOTENCY_CONFLICT",
              "Asistan işlem kimliği başka soruyla kullanılamaz.",
              409
            );
          if (saved.scope_hash !== scopeHash)
            fail(
              "SCOPE_CHANGED",
              "Önceki yanıtın yetki kapsamı artık aynı değil.",
              403
            );
          if (saved.status === "DONE" && saved.response_json)
            return JSON.parse(String(saved.response_json));
          if (saved.status === "PROCESSING")
            fail(
              "AI_PROCESSING",
              "Önceki asistan isteği işleniyor; daha sonra aynı istekle deneyin.",
              409
            );
          fail(
            "AI_UNAVAILABLE",
            "Önceki yanıt üretilemedi; yeni bir soruyla tekrar deneyebilirsiniz.",
            503
          );
        }
        const recent = await first<DbRow>(
          connection,
          `SELECT COUNT(*) AS count FROM st_assistant_requests WHERE actor_user_id=? AND created_at>=DATE_SUB(CURRENT_TIMESTAMP(3),INTERVAL 1 MINUTE)`,
          [actor.id]
        );
        if (n(recent?.count) >= 3)
          fail(
            "AI_RATE_LIMIT",
            "Asistan için dakikada üç istek sınırı var. Kısa süre sonra tekrar deneyin.",
            429
          );
        await execute(
          connection,
          `INSERT INTO st_assistant_requests(actor_user_id,request_id,payload_hash,scope_hash,topic) VALUES (?,?,?,?,?)`,
          [actor.id, requestId, hash, scopeHash, topic]
        );
        return null;
      });
      if (cached) {
        res.json(cached);
        return;
      }
      try {
        const text = await explainSummary(anonymousSummary(state, topic));
        const result = {
          ok: true,
          result: {
            text,
            topic,
            role: state.member.role,
            generatedAt: new Date().toISOString(),
            sources: [
              "Yetkili vardiya/ödeme kayıtları",
              "Market stok hareketleri",
              "Cari alacaklar ve açık toptancı borçları",
            ],
            privacy:
              ENV.authProvider === "local"
                ? "Yerel kural tabanlı özet üretildi. Haricî AI servisine veri gönderilmedi."
                : "Ham soru, kişi/ad/IBAN/ref ve slip görselleri dış modele gönderilmedi; yalnız anonim sayısal özet kullanıldı.",
          },
        };
        await query(
          `UPDATE st_assistant_requests SET status='DONE',response_json=? WHERE actor_user_id=? AND request_id=?`,
          [JSON.stringify(result), actor.id, requestId]
        );
        res.json(result);
      } catch {
        await query(
          `UPDATE st_assistant_requests SET status='FAILED' WHERE actor_user_id=? AND request_id=?`,
          [actor.id, requestId]
        );
        fail(
          "AI_UNAVAILABLE",
          "Asistan şu anda yanıt üretemedi. Hiçbir finansal işlem yapılmadı.",
          503
        );
      }
    })
  );
  app.post("/api/stationos/setup", mutationHandler(setup));

  app.post(
    "/api/stationos/company",
    mutationHandler(async (actor, body) =>
      mutation(actor, body, async connection => {
        const scope = await requireScope(connection, actor, [
          "OWNER",
          "MANAGER",
        ]);
        const name = requireString(body.name, "name", { max: 190 });
        const taxNumber = optionalString(body.taxNumber, "taxNumber", 64);
        const id = randomUUID();
        await execute(
          connection,
          `INSERT INTO st_companies (id, tenant_id, name, tax_number) VALUES (?, ?, ?, ?)`,
          [id, scope.tenantId, name, taxNumber]
        );
        await audit(
          connection,
          scope.tenantId,
          null,
          actor.id,
          "COMPANY_CREATE",
          id
        );
        return { id };
      })
    )
  );
  app.post(
    "/api/stationos/station",
    mutationHandler(async (actor, body) =>
      mutation(actor, body, async connection => {
        const scope = await requireScope(connection, actor, [
          "OWNER",
          "MANAGER",
        ]);
        const companyId = requireId(body.companyId, "companyId");
        const company = await first<DbRow>(
          connection,
          `SELECT id FROM st_companies WHERE id = ? AND tenant_id = ?`,
          [companyId, scope.tenantId]
        );
        if (!company) fail("NOT_FOUND", "Şirket bulunamadı.", 404);
        const name = requireString(body.name, "name", { max: 190 });
        const code = requireString(body.code, "code", { max: 64 });
        const address = optionalString(body.address, "address", 500);
        const id = randomUUID();
        await execute(
          connection,
          `INSERT INTO st_stations (id, tenant_id, company_id, name, code, address) VALUES (?, ?, ?, ?, ?, ?)`,
          [id, scope.tenantId, companyId, name, code, address]
        );
        if (scope.member.role !== "OWNER")
          await execute(
            connection,
            `INSERT INTO st_member_stations (tenant_id, user_id, station_id) VALUES (?, ?, ?)`,
            [scope.tenantId, actor.id, id]
          );
        await audit(
          connection,
          scope.tenantId,
          id,
          actor.id,
          "STATION_CREATE",
          id
        );
        return { id };
      })
    )
  );
  app.post(
    "/api/stationos/invite",
    mutationHandler(async (actor, body) =>
      mutation(actor, body, async connection => {
        const scope = await requireScope(connection, actor, [
          "OWNER",
          "MANAGER",
        ]);
        const role = requireEnum(body.role, "role", INVITE_ROLES);
        if (
          scope.member.role === "MANAGER" &&
          ["MANAGER", "ACCOUNTANT"].includes(role)
        )
          fail(
            "ROLE_GRANT_FORBIDDEN",
            "Yönetici ve mali onay rollerini yalnız firma sahibi atayabilir.",
            403
          );
        if (!Array.isArray(body.stationIds) || body.stationIds.length < 1)
          fail("INVALID_INPUT", "En az bir istasyon seçilmelidir.");
        const stationIds = [
          ...new Set(
            body.stationIds.map(value => requireId(value, "stationIds"))
          ),
        ];
        if (stationIds.some(id => !scope.stationIds.includes(id)))
          fail("STATION_FORBIDDEN", "Davet istasyon kapsamınızı aşıyor.", 403);
        const code = randomInvitationCode();
        const id = randomUUID();
        const expires = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
        await execute(
          connection,
          `INSERT INTO st_invitations (id, tenant_id, code_hash, role, expires_at, invited_by_user_id) VALUES (?, ?, ?, ?, ?, ?)`,
          [
            id,
            scope.tenantId,
            invitationHash(code),
            role,
            mysqlDate(expires),
            actor.id,
          ]
        );
        for (const stationId of stationIds)
          await execute(
            connection,
            `INSERT INTO st_invitation_stations (invitation_id, station_id) VALUES (?, ?)`,
            [id, stationId]
          );
        await audit(
          connection,
          scope.tenantId,
          stationIds[0] ?? null,
          actor.id,
          "INVITE_CREATE",
          id
        );
        return { code, expiresAt: expires.toISOString() };
      })
    )
  );
  app.post(
    "/api/stationos/join",
    mutationHandler(async (actor, body) =>
      mutation(actor, body, async connection => {
        await first<DbRow>(
          connection,
          `SELECT id FROM users WHERE id = ? FOR UPDATE`,
          [actor.id]
        );
        const existing = await first<DbRow>(
          connection,
          `SELECT tenant_id FROM st_members WHERE user_id = ? LIMIT 1 FOR UPDATE`,
          [actor.id]
        );
        if (existing)
          fail("ALREADY_ASSIGNED", "Bu kullanıcı zaten atanmış.", 409);
        const code = requireString(body.code, "code", { min: 20, max: 128 });
        const invitation = await first<DbRow>(
          connection,
          `SELECT id, tenant_id, role, expires_at, used_at FROM st_invitations WHERE code_hash = ? FOR UPDATE`,
          [invitationHash(code)]
        );
        if (
          !invitation ||
          invitation.used_at ||
          new Date(String(invitation.expires_at)).getTime() <= Date.now()
        )
          fail(
            "INVITATION_INVALID",
            "Davet kodu geçersiz, kullanılmış veya süresi dolmuş.",
            400
          );
        const stationRows = await rows<DbRow[]>(
          connection,
          `SELECT station_id FROM st_invitation_stations WHERE invitation_id = ?`,
          [String(invitation.id)]
        );
        if (!stationRows.length)
          fail("INVITATION_INVALID", "Davet istasyon kapsamı yok.", 400);
        await execute(
          connection,
          `INSERT INTO st_members (tenant_id, user_id, role) VALUES (?, ?, ?)`,
          [String(invitation.tenant_id), actor.id, String(invitation.role)]
        );
        for (const station of stationRows)
          await execute(
            connection,
            `INSERT INTO st_member_stations (tenant_id, user_id, station_id) VALUES (?, ?, ?)`,
            [String(invitation.tenant_id), actor.id, String(station.station_id)]
          );
        await execute(
          connection,
          `UPDATE st_invitations SET used_at = CURRENT_TIMESTAMP(3) WHERE id = ?`,
          [String(invitation.id)]
        );
        await audit(
          connection,
          String(invitation.tenant_id),
          String(stationRows[0]?.station_id),
          actor.id,
          "INVITE_JOIN",
          String(invitation.id)
        );
        return {
          tenantId: String(invitation.tenant_id),
          role: String(invitation.role),
          stationIds: stationRows.map(row => String(row.station_id)),
        };
      })
    )
  );
  app.post(
    "/api/stationos/shift",
    mutationHandler(async (actor, body) =>
      mutation(actor, body, async connection => {
        const stationId = requireId(body.stationId, "stationId");
        const { scope } = await requireStation(connection, actor, stationId, [
          "OWNER",
          "MANAGER",
        ]);
        const label = requireString(body.label, "label", { max: 190 });
        const startsAt = safeDate(body.startsAt, "startsAt");
        const endsAt =
          body.endsAt === null ||
          body.endsAt === undefined ||
          body.endsAt === ""
            ? null
            : safeDate(body.endsAt, "endsAt");
        if (endsAt && endsAt <= startsAt)
          fail("INVALID_INPUT", "Vardiya bitişi başlangıçtan sonra olmalıdır.");
        const id = randomUUID();
        await execute(
          connection,
          `INSERT INTO st_shifts (id, tenant_id, station_id, label, starts_at, ends_at) VALUES (?, ?, ?, ?, ?, ?)`,
          [
            id,
            scope.tenantId,
            stationId,
            label,
            mysqlDate(startsAt),
            endsAt ? mysqlDate(endsAt) : null,
          ]
        );
        await audit(
          connection,
          scope.tenantId,
          stationId,
          actor.id,
          "SHIFT_CREATE",
          id
        );
        return { id };
      })
    )
  );
  app.post(
    "/api/stationos/account/open",
    mutationHandler(async (actor, body) =>
      mutation(actor, body, async connection => {
        const stationId = requireId(body.stationId, "stationId");
        const { scope } = await requireStation(connection, actor, stationId, [
          "OWNER",
          "MANAGER",
          "FUEL_STAFF",
          "MARKET_STAFF",
        ]);
        const shiftId = requireId(body.shiftId, "shiftId");
        const shift = await first<DbRow>(
          connection,
          `SELECT id FROM st_shifts WHERE id = ? AND tenant_id = ? AND station_id = ? AND status = 'OPEN'`,
          [shiftId, scope.tenantId, stationId]
        );
        if (!shift) fail("NOT_FOUND", "Vardiya bulunamadı.", 404);
        const businessUnit = requireEnum(
          body.businessUnit,
          "businessUnit",
          BUSINESS_UNITS
        );
        if (
          (scope.member.role === "FUEL_STAFF" && businessUnit !== "FUEL") ||
          (scope.member.role === "MARKET_STAFF" && businessUnit !== "MARKET")
        )
          fail(
            "UNIT_FORBIDDEN",
            "Satış rolünüz bu iş alanına izin vermiyor.",
            403
          );
        if (
          businessUnit === "MARKET" &&
          (await lockMarketBook(connection, scope.tenantId, stationId, true))
        )
          fail(
            "MARKET_ACCOUNTING_ACTIVE",
            "Market işlemleri için Satış kasası ve Market muhasebesi modüllerini kullanın.",
            409
          );
        const openingFloatMinor = requireMoney(
          body.openingFloatMinor,
          "openingFloatMinor",
          { allowZero: true }
        );
        const existing = await first<DbRow>(
          connection,
          `SELECT id FROM st_accounts WHERE station_id = ? AND shift_id = ? AND user_id = ? AND business_unit = ? AND status NOT IN ('ACCEPTED','ACCEPTED_WITH_PENDING') LIMIT 1`,
          [stationId, shiftId, actor.id, businessUnit]
        );
        if (existing)
          fail(
            "CONFLICT",
            "Bu vardiya ve birim için açık hesap zaten var.",
            409
          );
        const id = randomUUID();
        await execute(
          connection,
          `INSERT INTO st_accounts (id, tenant_id, station_id, shift_id, user_id, business_unit, opening_float_minor) VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [
            id,
            scope.tenantId,
            stationId,
            shiftId,
            actor.id,
            businessUnit,
            openingFloatMinor,
          ]
        );
        await audit(
          connection,
          scope.tenantId,
          stationId,
          actor.id,
          "ACCOUNT_OPEN",
          id
        );
        return { id, revision: 1 };
      })
    )
  );
  app.post(
    "/api/stationos/payment",
    mutationHandler(async (actor, body) =>
      mutation(actor, body, async connection => {
        const accountId = requireId(body.accountId, "accountId");
        const account = await lockedAccount(connection, accountId);
        checkRevision(account, body.expectedRevision);
        checkAccountOwner(account, actor);
        await ensureDeviceLease(connection, actor, account, body);
        if (account.status !== "OPEN")
          fail("ACCOUNT_LOCKED", "Hesap artık düzenlenemez.", 409);
        const kind = requireEnum(body.kind, "kind", PAYMENT_KINDS);
        if (
          kind === "AR_COLLECTION" &&
          !["OWNER", "ACCOUNTANT"].includes(
            (await requireScope(connection, actor)).member.role
          )
        )
          fail(
            "ROLE_FORBIDDEN",
            "Cari tahsilatı yalnızca yetkili mali rol yapabilir.",
            403
          );
        const amountMinor = requireMoney(body.amountMinor, "amountMinor");
        const currentTotals = accountInput(account);
        safeAdd(
          currentTotals.sourceTotalMinor,
          kind === "AR_COLLECTION" ? 0 : amountMinor
        );
        safeAdd(
          currentTotals.expectedCashMinor,
          amountMinor,
          n(account.opening_float_minor)
        );
        const reference = optionalString(body.reference, "reference", 190);
        const debtorId =
          body.debtorId === undefined || body.debtorId === null
            ? null
            : requireId(body.debtorId, "debtorId");
        const scope = await stationFromAccount(connection, actor, account);
        if (debtorId) {
          const debtor = await first<DbRow>(
            connection,
            `SELECT id, balance_minor FROM st_debtors WHERE id = ? AND tenant_id = ? AND station_id = ? FOR UPDATE`,
            [debtorId, scope.tenantId, account.station_id]
          );
          if (!debtor) fail("NOT_FOUND", "Cari hesap bulunamadı.", 404);
          if (kind === "DEBT") safeAdd(n(debtor.balance_minor), amountMinor);
          if (kind === "AR_COLLECTION" && amountMinor > n(debtor.balance_minor))
            fail("AR_OVER_COLLECTION", "Tahsilat mevcut alacağı aşamaz.", 409);
        } else if (kind === "DEBT" || kind === "AR_COLLECTION")
          fail(
            "DEBTOR_REQUIRED",
            "Borç ve cari tahsilat için debtorId gereklidir."
          );
        if (kind !== "DEBT" && kind !== "AR_COLLECTION" && debtorId)
          fail("INVALID_INPUT", "Bu ödeme türünde debtorId kullanılamaz.");
        const paymentId = randomUUID();
        await execute(
          connection,
          `INSERT INTO st_payments (id, tenant_id, station_id, account_id, debtor_id, kind, amount_minor, reference, created_by_user_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            paymentId,
            scope.tenantId,
            account.station_id,
            accountId,
            debtorId,
            kind,
            amountMinor,
            reference,
            actor.id,
          ]
        );
        if (debtorId && kind === "DEBT") {
          await execute(
            connection,
            `UPDATE st_debtors SET balance_minor = balance_minor + ? WHERE id = ?`,
            [amountMinor, debtorId]
          );
          await execute(
            connection,
            `INSERT INTO st_debtor_ledger (id, tenant_id, station_id, debtor_id, payment_id, direction, amount_minor, created_by_user_id) VALUES (?, ?, ?, ?, ?, 'DEBT', ?, ?)`,
            [
              randomUUID(),
              scope.tenantId,
              account.station_id,
              debtorId,
              paymentId,
              amountMinor,
              actor.id,
            ]
          );
        }
        if (debtorId && kind === "AR_COLLECTION") {
          await execute(
            connection,
            `UPDATE st_debtors SET balance_minor = balance_minor - ? WHERE id = ? AND balance_minor >= ?`,
            [amountMinor, debtorId, amountMinor]
          );
          await execute(
            connection,
            `INSERT INTO st_debtor_ledger (id, tenant_id, station_id, debtor_id, payment_id, direction, amount_minor, created_by_user_id) VALUES (?, ?, ?, ?, ?, 'AR_COLLECTION', ?, ?)`,
            [
              randomUUID(),
              scope.tenantId,
              account.station_id,
              debtorId,
              paymentId,
              amountMinor,
              actor.id,
            ]
          );
        }
        await execute(
          connection,
          `UPDATE st_accounts SET revision = revision + 1 WHERE id = ?`,
          [accountId]
        );
        await audit(
          connection,
          scope.tenantId,
          String(account.station_id),
          actor.id,
          `PAYMENT_${kind}`,
          paymentId
        );
        return { id: paymentId, accountId, revision: n(account.revision) + 1 };
      })
    )
  );
  app.post(
    "/api/stationos/slip",
    mutationHandler(async (actor, body) =>
      mutation(actor, body, async connection => {
        const accountId = requireId(body.accountId, "accountId");
        const account = await lockedAccount(connection, accountId);
        checkRevision(account, body.expectedRevision);
        checkAccountOwner(account, actor);
        await ensureDeviceLease(connection, actor, account, body);
        if (account.status !== "OPEN")
          fail("ACCOUNT_LOCKED", "Hesap artık düzenlenemez.", 409);
        const amountMinor = requireMoney(body.amountMinor, "amountMinor");
        const reference = requireString(body.reference, "reference", {
          max: 190,
        });
        const terminalId = requireString(body.terminalId, "terminalId", {
          max: 190,
        });
        const transactionAt = safeDate(body.transactionAt, "transactionAt");
        const note = optionalString(body.note, "note", 500);
        rejectCardData(reference, terminalId, note);
        safeAdd(accountInput(account).sourceTotalMinor, amountMinor);
        const scope = await stationFromAccount(connection, actor, account);
        const id = randomUUID();
        await execute(
          connection,
          `INSERT INTO st_slips (id, tenant_id, station_id, account_id, amount_minor, reference, terminal_id, transaction_at, note, created_by_user_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            id,
            scope.tenantId,
            account.station_id,
            accountId,
            amountMinor,
            reference,
            terminalId,
            mysqlDate(transactionAt),
            note,
            actor.id,
          ]
        );
        await execute(
          connection,
          `UPDATE st_accounts SET revision = revision + 1 WHERE id = ?`,
          [accountId]
        );
        await audit(
          connection,
          scope.tenantId,
          String(account.station_id),
          actor.id,
          "SLIP_VERIFY_MANUAL",
          id
        );
        return { id, revision: n(account.revision) + 1 };
      })
    )
  );
  app.post(
    "/api/stationos/account/source",
    mutationHandler(async (actor, body) =>
      mutation(actor, body, async connection => {
        const accountId = requireId(body.accountId, "accountId");
        const account = await lockedAccount(connection, accountId);
        checkRevision(account, body.expectedRevision);
        if (
          !["OWNER", "MANAGER"].includes(
            (await stationFromAccount(connection, actor, account)).member.role
          )
        )
          fail(
            "ROLE_FORBIDDEN",
            "Kaynak toplamı yönetici tarafından girilebilir.",
            403
          );
        if (account.status !== "OPEN")
          fail("ACCOUNT_LOCKED", "Hesap kaynak toplamı için açık değil.", 409);
        const sourceSalesMinor = requireMoney(
          body.sourceSalesMinor,
          "sourceSalesMinor",
          { allowZero: true }
        );
        const sourceRef = requireString(body.sourceRef, "sourceRef", {
          max: 190,
        });
        rejectCardData(sourceRef);
        await accountEvent(
          connection,
          account,
          actor,
          "SOURCE_SET",
          n(account.revision) + 1,
          {
            previousSalesMinor:
              account.source_sales_minor === null
                ? null
                : n(account.source_sales_minor),
            previousRef: account.source_ref,
            sourceSalesMinor,
            sourceRef,
          }
        );

        const scope = await stationFromAccount(connection, actor, account);
        await execute(
          connection,
          `UPDATE st_accounts SET source_sales_minor = ?, source_ref = ?, revision = revision + 1 WHERE id = ?`,
          [sourceSalesMinor, sourceRef, accountId]
        );
        await audit(
          connection,
          scope.tenantId,
          String(account.station_id),
          actor.id,
          "ACCOUNT_SOURCE",
          accountId
        );
        return { id: accountId, revision: n(account.revision) + 1 };
      })
    )
  );
  app.post(
    "/api/stationos/account/submit",
    mutationHandler(async (actor, body) =>
      mutation(actor, body, async connection => {
        const accountId = requireId(body.accountId, "accountId");
        const account = await lockedAccount(connection, accountId);
        checkRevision(account, body.expectedRevision);
        checkAccountOwner(account, actor);
        await ensureDeviceLease(connection, actor, account, body);
        if (!["OPEN"].includes(account.status))
          fail("ACCOUNT_LOCKED", "Hesap teslim için açık değil.", 409);
        const countedCashMinor = requireMoney(
          body.countedCashMinor,
          "countedCashMinor",
          { allowZero: true }
        );
        const totals = accountInput(account);
        if (account.source_sales_minor === null || !account.source_ref)
          fail(
            "SOURCE_REQUIRED",
            "Kaynak toplamı ve referansı girilmeden teslim edilemez.",
            409
          );
        if (n(account.source_sales_minor) !== totals.sourceTotalMinor)
          fail(
            "SOURCE_MISMATCH",
            "Kaynak toplamı ödeme ve slip kanıtlarıyla eşleşmiyor.",
            409
          );
        const physicalExpectedMinor =
          totals.expectedCashMinor + n(account.opening_float_minor);
        if (countedCashMinor !== physicalExpectedMinor)
          fail(
            "CASH_DISCREPANCY",
            "Fizikî nakit farkı açıklanmadan teslim edilemez.",
            409
          );
        const scope = await stationFromAccount(connection, actor, account);
        await execute(
          connection,
          `UPDATE st_accounts SET counted_cash_minor = ?, difference_minor = ?, status = 'SUBMITTED', submitted_at = CURRENT_TIMESTAMP(3), revision = revision + 1 WHERE id = ?`,
          [
            countedCashMinor,
            countedCashMinor - physicalExpectedMinor,
            accountId,
          ]
        );
        await audit(
          connection,
          scope.tenantId,
          String(account.station_id),
          actor.id,
          "ACCOUNT_SUBMIT",
          accountId
        );
        return {
          id: accountId,
          revision: n(account.revision) + 1,
          status: "SUBMITTED",
        };
      })
    )
  );
  app.post(
    "/api/stationos/account/cash-receive",
    mutationHandler(async (actor, body) =>
      mutation(actor, body, async connection => {
        const accountId = requireId(body.accountId, "accountId");
        const account = await lockedAccount(connection, accountId);
        checkRevision(account, body.expectedRevision);
        const scope = await stationFromAccount(connection, actor, account, [
          "OWNER",
          "MANAGER",
          "ACCOUNTANT",
        ]);
        checkNotAccountOwner(account, actor);
        if (!["SUBMITTED", "IN_REVIEW"].includes(account.status))
          fail("ACCOUNT_LOCKED", "Hesap fizikî teslim için hazır değil.", 409);
        if (account.cash_receiver_user_id !== null)
          fail(
            "CASH_ALREADY_RECEIVED",
            "Bu hesapta fizikî teslim zaten teyitli.",
            409
          );
        const receivedMinor = requireMoney(
          body.receivedMinor,
          "receivedMinor",
          { allowZero: true }
        );
        const note = optionalString(body.note, "note", 500);
        const totals = accountInput(account);
        if (
          account.counted_cash_minor === null ||
          n(account.difference_minor) !== 0 ||
          receivedMinor !== totals.expectedCashMinor
        )
          fail(
            "CASH_DISCREPANCY",
            "Fizikî nakit farkı olan hesap teslim alınamaz.",
            409
          );
        const newRevision = n(account.revision) + 1;
        await execute(
          connection,
          `UPDATE st_accounts SET cash_received_minor = ?, cash_receiver_user_id = ?, status = 'IN_REVIEW', revision = ? WHERE id = ?`,
          [receivedMinor, actor.id, newRevision, accountId]
        );
        await execute(
          connection,
          `INSERT INTO st_account_signatures (id, account_id, cycle_no, revision, kind, user_id, snapshot_json) VALUES (?, ?, ?, ?, 'CASH_RECEIVE', ?, ?)`,
          [
            randomUUID(),
            accountId,
            n(account.cycle_no),
            newRevision,
            actor.id,
            JSON.stringify({
              receivedMinor,
              note,
              expectedCashMinor: totals.expectedCashMinor,
            }),
          ]
        );
        await audit(
          connection,
          scope.tenantId,
          String(account.station_id),
          actor.id,
          "ACCOUNT_CASH_RECEIVE",
          accountId
        );
        return { id: accountId, revision: newRevision, status: "IN_REVIEW" };
      })
    )
  );
  app.post(
    "/api/stationos/account/approve",
    mutationHandler(async (actor, body) =>
      mutation(actor, body, async connection => {
        const accountId = requireId(body.accountId, "accountId");
        const account = await lockedAccount(connection, accountId);
        checkRevision(account, body.expectedRevision);
        const scope = await stationFromAccount(connection, actor, account, [
          "OWNER",
          "ACCOUNTANT",
        ]);
        checkNotAccountOwner(account, actor);
        if (!["IN_REVIEW", "SUBMITTED"].includes(account.status))
          fail("ACCOUNT_LOCKED", "Hesap onay için hazır değil.", 409);
        const totals = accountInput(account);
        if (
          account.cash_received_minor === null ||
          n(account.difference_minor) !== 0 ||
          account.source_sales_minor === null ||
          n(account.source_sales_minor) !== totals.sourceTotalMinor
        )
          fail(
            "ACCOUNT_INCOMPLETE",
            "Kaynak, ödeme ve fizikî teslim doğrulanmadan onaylanamaz.",
            409
          );
        const existingApproval = await first<DbRow>(
          connection,
          `SELECT user_id FROM st_account_signatures WHERE account_id = ? AND cycle_no = ? AND kind = 'APPROVAL' AND user_id = ?`,
          [accountId, n(account.cycle_no), actor.id]
        );
        if (existingApproval)
          fail(
            "DUPLICATE_APPROVAL",
            "Bu kullanıcı bu sürüm döngüsüne zaten mali imza verdi.",
            409
          );
        const approvals = await first<DbRow>(
          connection,
          `SELECT COUNT(DISTINCT user_id) AS count FROM st_account_signatures WHERE account_id = ? AND cycle_no = ? AND kind = 'APPROVAL'`,
          [accountId, n(account.cycle_no)]
        );
        const note = optionalString(body.note, "note", 500);
        const newRevision = n(account.revision) + 1;
        const status =
          n(approvals?.count) + 1 < 2
            ? "IN_REVIEW"
            : totals.ibanMinor > 0
              ? "ACCEPTED_WITH_PENDING"
              : "ACCEPTED";
        await execute(
          connection,
          `UPDATE st_accounts SET status = ?, revision = ? WHERE id = ?`,
          [status, newRevision, accountId]
        );
        await execute(
          connection,
          `INSERT INTO st_account_signatures (id, account_id, cycle_no, revision, kind, user_id, snapshot_json) VALUES (?, ?, ?, ?, 'APPROVAL', ?, ?)`,
          [
            randomUUID(),
            accountId,
            n(account.cycle_no),
            newRevision,
            actor.id,
            JSON.stringify({ status, note, totals }),
          ]
        );
        await audit(
          connection,
          scope.tenantId,
          String(account.station_id),
          actor.id,
          status === "ACCEPTED"
            ? "ACCOUNT_APPROVE"
            : "ACCOUNT_APPROVE_PENDING_IBAN",
          accountId
        );
        return { id: accountId, revision: newRevision, status };
      })
    )
  );
  app.post(
    "/api/stationos/account/return",
    mutationHandler(async (actor, body) =>
      mutation(actor, body, async connection => {
        const accountId = requireId(body.accountId, "accountId");
        const account = await lockedAccount(connection, accountId);
        checkRevision(account, body.expectedRevision);
        const scope = await stationFromAccount(connection, actor, account, [
          "OWNER",
          "ACCOUNTANT",
        ]);
        checkNotAccountOwner(account, actor);
        if (
          ![
            "SUBMITTED",
            "IN_REVIEW",
            "ACCEPTED",
            "ACCEPTED_WITH_PENDING",
          ].includes(account.status)
        )
          fail("ACCOUNT_LOCKED", "Hesap iade akışı için uygun değil.", 409);
        const note = requireString(body.note, "note", { max: 500 });
        const newRevision = n(account.revision) + 1;
        rejectCardData(note);
        await accountEvent(
          connection,
          account,
          actor,
          "RETURN_FOR_CORRECTION",
          newRevision,
          { note, previousStatus: account.status }
        );
        await execute(
          connection,
          `UPDATE st_accounts SET status = 'OPEN', counted_cash_minor = NULL, difference_minor = NULL, cash_received_minor = NULL, cash_receiver_user_id = NULL, cycle_no = cycle_no + 1, revision = ? WHERE id = ?`,
          [newRevision, accountId]
        );
        await audit(
          connection,
          scope.tenantId,
          String(account.station_id),
          actor.id,
          "ACCOUNT_RETURN",
          accountId
        );
        return { id: accountId, revision: newRevision, status: "OPEN", note };
      })
    )
  );
  app.post(
    "/api/stationos/debtor",
    mutationHandler(async (actor, body) =>
      mutation(actor, body, async connection => {
        const stationId = requireId(body.stationId, "stationId");
        const { scope } = await requireStation(connection, actor, stationId, [
          "OWNER",
          "MANAGER",
          "ACCOUNTANT",
          "FUEL_STAFF",
          "MARKET_STAFF",
        ]);
        const name = requireString(body.name, "name", { max: 190 });
        const type = requireEnum(body.type, "type", DEBTOR_TYPES);
        const id = randomUUID();
        await execute(
          connection,
          `INSERT INTO st_debtors (id, tenant_id, station_id, name, type, created_by_user_id) VALUES (?, ?, ?, ?, ?, ?)`,
          [id, scope.tenantId, stationId, name, type, actor.id]
        );
        await audit(
          connection,
          scope.tenantId,
          stationId,
          actor.id,
          "DEBTOR_CREATE",
          id
        );
        return { id };
      })
    )
  );
  app.post(
    "/api/stationos/collection",
    mutationHandler(async (actor, body) =>
      mutation(actor, body, async connection => {
        const stationId = requireId(body.stationId, "stationId");
        const { scope } = await requireStation(connection, actor, stationId, [
          "OWNER",
          "ACCOUNTANT",
        ]);
        const debtorId = requireId(body.debtorId, "debtorId");
        const amountMinor = requireMoney(body.amountMinor, "amountMinor");
        const reference = requireString(body.reference, "reference", {
          max: 190,
        });
        const debtor = await first<DbRow>(
          connection,
          `SELECT id, balance_minor FROM st_debtors WHERE id = ? AND tenant_id = ? AND station_id = ? FOR UPDATE`,
          [debtorId, scope.tenantId, stationId]
        );
        if (!debtor) fail("NOT_FOUND", "Cari hesap bulunamadı.", 404);
        if (amountMinor > n(debtor.balance_minor))
          fail("AR_OVER_COLLECTION", "Tahsilat mevcut alacağı aşamaz.", 409);
        const paymentId = randomUUID();
        await execute(
          connection,
          `INSERT INTO st_payments (id, tenant_id, station_id, account_id, debtor_id, kind, amount_minor, reference, created_by_user_id) VALUES (?, ?, ?, NULL, ?, 'AR_COLLECTION', ?, ?, ?)`,
          [
            paymentId,
            scope.tenantId,
            stationId,
            debtorId,
            amountMinor,
            reference,
            actor.id,
          ]
        );
        await execute(
          connection,
          `UPDATE st_debtors SET balance_minor = balance_minor - ? WHERE id = ? AND balance_minor >= ?`,
          [amountMinor, debtorId, amountMinor]
        );
        await execute(
          connection,
          `INSERT INTO st_debtor_ledger (id, tenant_id, station_id, debtor_id, payment_id, direction, amount_minor, created_by_user_id) VALUES (?, ?, ?, ?, ?, 'AR_COLLECTION', ?, ?)`,
          [
            randomUUID(),
            scope.tenantId,
            stationId,
            debtorId,
            paymentId,
            amountMinor,
            actor.id,
          ]
        );
        await audit(
          connection,
          scope.tenantId,
          stationId,
          actor.id,
          "AR_COLLECTION",
          paymentId
        );
        return { id: paymentId, debtorId, amountMinor };
      })
    )
  );
  app.post(
    "/api/stationos/product",
    mutationHandler(async (actor, body) =>
      mutation(actor, body, async connection => {
        const stationId = requireId(body.stationId, "stationId");
        const { scope } = await requireStation(connection, actor, stationId, [
          "OWNER",
          "MANAGER",
          "PURCHASER",
        ]);
        await first<DbRow>(
          connection,
          `SELECT id FROM st_stations WHERE id=? FOR UPDATE`,
          [stationId]
        );
        const capacity = await first<DbRow>(
          connection,
          `SELECT COUNT(*) AS count FROM st_products WHERE station_id=?`,
          [stationId]
        );
        if (n(capacity?.count) >= 5000)
          fail(
            "SKU_LIMIT",
            "Bir markette 5.000 ürün kartı sınırına ulaşıldı.",
            409
          );
        const name = requireString(body.name, "name", { max: 190 });
        const barcode = requireString(body.barcode, "barcode", { max: 190 });
        const minimumQty = requireInteger(body.minimumQty, "minimumQty", {
          allowZero: true,
        });
        const purchasePriceMinor = requireMoney(
          body.purchasePriceMinor,
          "purchasePriceMinor",
          { allowZero: true }
        );
        const salePriceMinor = requireMoney(
          body.salePriceMinor,
          "salePriceMinor",
          { allowZero: true }
        );
        const supplierId =
          body.supplierId === null || body.supplierId === undefined
            ? null
            : requireId(body.supplierId, "supplierId");
        if (supplierId) {
          const supplier = await first<DbRow>(
            connection,
            `SELECT id FROM st_suppliers WHERE id = ? AND tenant_id = ? AND station_id = ?`,
            [supplierId, scope.tenantId, stationId]
          );
          if (!supplier) fail("NOT_FOUND", "Tedarikçi bulunamadı.", 404);
        }
        const id = randomUUID();
        await execute(
          connection,
          `INSERT INTO st_products (id, tenant_id, station_id, name, barcode, minimum_qty, purchase_price_minor, sale_price_minor, supplier_id, created_by_user_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            id,
            scope.tenantId,
            stationId,
            name,
            barcode,
            minimumQty,
            purchasePriceMinor,
            salePriceMinor,
            supplierId,
            actor.id,
          ]
        );
        await audit(
          connection,
          scope.tenantId,
          stationId,
          actor.id,
          "PRODUCT_CREATE",
          id
        );
        return { id };
      })
    )
  );
  app.post(
    "/api/stationos/stock",
    mutationHandler(async (actor, body) =>
      mutation(actor, body, async connection => {
        const stationId = requireId(body.stationId, "stationId");
        const kind = requireEnum(body.kind, "kind", STOCK_KINDS);
        const roles: StationRole[] =
          kind === "SALE"
            ? ["OWNER", "MANAGER", "MARKET_STAFF"]
            : ["OWNER", "MANAGER", "PURCHASER"];
        const { scope } = await requireStation(
          connection,
          actor,
          stationId,
          roles
        );
        if (await lockMarketBook(connection, scope.tenantId, stationId, true))
          fail(
            "MARKET_ACCOUNTING_ACTIVE",
            "Stok hareketini Market muhasebesi / Alış veya Stok sayımı ekranından kaydedin.",
            409
          );
        const productId = requireId(body.productId, "productId");
        const product = await first<DbRow>(
          connection,
          `SELECT id, stock_qty, sale_price_minor FROM st_products WHERE id = ? AND tenant_id = ? AND station_id = ? FOR UPDATE`,
          [productId, scope.tenantId, stationId]
        );
        if (!product) fail("NOT_FOUND", "Ürün bulunamadı.", 404);
        const quantity = requireInteger(body.quantity, "quantity", {
          allowNegative: kind === "ADJUSTMENT",
          allowZero: false,
        });
        const reference = optionalString(body.reference, "reference", 190);
        const delta =
          kind === "RECEIPT"
            ? quantity
            : kind === "SALE"
              ? -quantity
              : quantity;
        const nextStock = safeAdd(n(product.stock_qty), delta);
        if (nextStock < 0)
          fail("NEGATIVE_INVENTORY", "Stok negatif olamaz.", 409);
        const id = randomUUID();
        const unitPrice = kind === "SALE" ? n(product.sale_price_minor) : 0;
        await execute(
          connection,
          `INSERT INTO st_stock_movements (id, tenant_id, station_id, product_id, kind, quantity, unit_price_minor, reference, created_by_user_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            id,
            scope.tenantId,
            stationId,
            productId,
            kind,
            quantity,
            unitPrice,
            reference,
            actor.id,
          ]
        );
        await execute(
          connection,
          `UPDATE st_products SET stock_qty = ? WHERE id = ?`,
          [nextStock, productId]
        );
        await audit(
          connection,
          scope.tenantId,
          stationId,
          actor.id,
          `STOCK_${kind}`,
          id
        );
        return { id, productId, stockQty: nextStock };
      })
    )
  );
  app.post(
    "/api/stationos/supplier",
    mutationHandler(async (actor, body) =>
      mutation(actor, body, async connection => {
        const stationId = requireId(body.stationId, "stationId");
        const { scope } = await requireStation(connection, actor, stationId, [
          "OWNER",
          "PURCHASER",
        ]);
        const name = requireString(body.name, "name", { max: 190 });
        const creditLimitMinor = requireMoney(
          body.creditLimitMinor,
          "creditLimitMinor",
          { allowZero: true }
        );
        const id = randomUUID();
        await execute(
          connection,
          `INSERT INTO st_suppliers (id, tenant_id, station_id, name, credit_limit_minor, created_by_user_id) VALUES (?, ?, ?, ?, ?, ?)`,
          [id, scope.tenantId, stationId, name, creditLimitMinor, actor.id]
        );
        await audit(
          connection,
          scope.tenantId,
          stationId,
          actor.id,
          "SUPPLIER_CREATE",
          id
        );
        return { id };
      })
    )
  );
  app.post(
    "/api/stationos/payable",
    mutationHandler(async (actor, body) =>
      mutation(actor, body, async connection => {
        const stationId = requireId(body.stationId, "stationId");
        const { scope } = await requireStation(connection, actor, stationId, [
          "OWNER",
          "ACCOUNTANT",
          "PURCHASER",
        ]);
        if (await lockMarketBook(connection, scope.tenantId, stationId, true))
          fail(
            "MARKET_ACCOUNTING_ACTIVE",
            "Market borçlarını Market muhasebesi / Cariler ve Alış ekranından kaydedin.",
            409
          );
        const supplierId = requireId(body.supplierId, "supplierId");
        const supplier = await first<DbRow>(
          connection,
          `SELECT id FROM st_suppliers WHERE id = ? AND tenant_id = ? AND station_id = ?`,
          [supplierId, scope.tenantId, stationId]
        );
        if (!supplier) fail("NOT_FOUND", "Tedarikçi bulunamadı.", 404);
        const amountMinor = requireMoney(body.amountMinor, "amountMinor");
        const dueDate = requireString(body.dueDate, "dueDate", { max: 10 });
        if (!/^\d{4}-\d{2}-\d{2}$/.test(dueDate))
          fail("INVALID_INPUT", "dueDate YYYY-AA-GG olmalıdır.");
        const reference = optionalString(body.reference, "reference", 190);
        const id = randomUUID();
        await execute(
          connection,
          `INSERT INTO st_payables (id, tenant_id, station_id, supplier_id, amount_minor, due_date, reference, created_by_user_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            id,
            scope.tenantId,
            stationId,
            supplierId,
            amountMinor,
            dueDate,
            reference,
            actor.id,
          ]
        );
        await audit(
          connection,
          scope.tenantId,
          stationId,
          actor.id,
          "PAYABLE_CREATE",
          id
        );
        return { id };
      })
    )
  );
  app.post(
    "/api/stationos/terminal",
    mutationHandler(async (actor, body) =>
      mutation(actor, body, async connection => {
        const accountId = requireId(body.accountId, "accountId");
        const account = await lockedAccount(connection, accountId);
        checkAccountOwner(account, actor);
        const stationId = String(account.station_id);
        const { scope } = await requireStation(connection, actor, stationId);
        const deviceId = requireString(body.deviceId, "deviceId", { max: 190 });
        const kind = requireEnum(body.kind, "kind", TERMINAL_KINDS);
        const action = requireEnum(body.action, "action", [
          "ACQUIRE",
          "RELEASE",
        ] as const);
        const existing = await first<DbRow>(
          connection,
          `SELECT account_id, device_id, kind, acquired_by_user_id, expires_at FROM st_terminal_leases WHERE account_id = ? AND device_id = ? FOR UPDATE`,
          [accountId, deviceId]
        );
        const now = new Date();
        const expiry = new Date(Date.now() + 5 * 60 * 1000);
        if (action === "RELEASE") {
          if (existing)
            await execute(
              connection,
              `UPDATE st_terminal_leases SET expires_at = ? WHERE account_id = ? AND device_id = ?`,
              [mysqlDate(now), accountId, deviceId]
            );
          await audit(
            connection,
            scope.tenantId,
            stationId,
            actor.id,
            "TERMINAL_RELEASE",
            accountId
          );
          return { accountId, deviceId, action: "RELEASE" };
        }
        if (kind === "DESKTOP") {
          const active = await first<DbRow>(
            connection,
            `SELECT COUNT(*) AS count FROM st_terminal_leases WHERE account_id = ? AND device_id <> ? AND kind = 'DESKTOP' AND expires_at > CURRENT_TIMESTAMP(3) FOR UPDATE`,
            [accountId, deviceId]
          );
          if (n(active?.count) >= 5)
            fail(
              "TERMINAL_LIMIT",
              "Bir vardiya hesabında en fazla beş masaüstü terminal olabilir.",
              409
            );
        }
        if (existing)
          await execute(
            connection,
            `UPDATE st_terminal_leases SET kind = ?, acquired_by_user_id = ?, expires_at = ? WHERE account_id = ? AND device_id = ?`,
            [kind, actor.id, mysqlDate(expiry), accountId, deviceId]
          );
        else
          await execute(
            connection,
            `INSERT INTO st_terminal_leases (account_id, device_id, kind, acquired_by_user_id, expires_at) VALUES (?, ?, ?, ?, ?)`,
            [accountId, deviceId, kind, actor.id, mysqlDate(expiry)]
          );
        await audit(
          connection,
          scope.tenantId,
          stationId,
          actor.id,
          "TERMINAL_ACQUIRE",
          accountId
        );
        return {
          accountId,
          deviceId,
          kind,
          action: "ACQUIRE",
          expiresAt: expiry.toISOString(),
        };
      })
    )
  );
}

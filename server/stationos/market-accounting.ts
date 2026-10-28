import { registerPartyDues } from "./party-dues-reports";
import { registerLotControl } from "./lot-control-reports";
import { registerSalesAnalysis } from "./sales-analysis";
import { registerStockHealthReports } from "./stock-health-reports";
import { registerCancellationReports } from "./cancellation-reports";
import { registerSalesReports } from "./sales-reports";
import { registerShelfLabels } from "./shelf-labels";
import { registerPurchaseOrders } from "./purchase-orders";
import { registerInventoryCountReports } from "./inventory-count-reports";
import { registerInventoryReports } from "./inventory-reports";
import { registerCatalogImport } from "./catalog-import";
import { registerInventoryLots } from "./inventory-lots";
import { buildMarketDaily } from "./market-report-domain";
import { recordMarketPurchase } from "./market-purchase";
import { registerInventory } from "./market-inventory";
import { registerInventoryTerminal } from "./inventory-terminal";
import { registerMarketStatement } from "./market-accounting-statement";
import { registerMarketReturns } from "./market-returns";
import { randomUUID } from "node:crypto";
import type { Express, Request, Response } from "express";
import type { PoolConnection } from "mysql2/promise";
import type { Services, Scope, Row } from "./market-pos";
import type { StationActor, StationRole } from "./types";
import type {
  MarketAccountingState,
  MarketAccount,
  MarketDaily,
  MarketJournal,
} from "../../shared/market-accounting";
import { execute, first, rows, withTransaction } from "./db";
import { fail } from "./types";
import {
  requireId,
  requireMoney,
  requireInteger,
  requireString,
  requireEnum,
  optionalString,
  isRecord,
  payloadHash,
} from "./domain";
import { safeAdd, rejectCardData } from "./safety";
import { posLineTotal } from "./pos-domain";
import {
  businessToday,
  calendarDate,
  integer,
  netTax,
  ratioRound,
  stockCost,
  vatRate,
  type LedgerLine,
} from "./market-accounting-domain";
import {
  lockMarketBook,
  ledgerEntry,
  accountBalance,
  inventoryRow,
} from "./market-accounting-ledger";

const READ: StationRole[] = ["OWNER", "MANAGER", "ACCOUNTANT"];
const CLOSE: StationRole[] = ["OWNER", "ACCOUNTANT"];
const parse = <T>(x: unknown): T =>
  (typeof x === "string" ? JSON.parse(x) : x) as T;
const note = (x: unknown, label = "Açıklama", min = 5) => {
  const n = requireString(x, label, { min, max: 500 });
  rejectCardData(n);
  return n;
};
async function balances(c: PoolConnection, station: string) {
  const r = await rows<Row[]>(
    c,
    "SELECT account_code,SUM(balance_minor) AS amount FROM st_market_balances WHERE station_id=? GROUP BY account_code ORDER BY account_code",
    [station]
  );
  return Object.fromEntries(
    r.map(x => [x.account_code, integer(x.amount)])
  ) as Partial<Record<MarketAccount, number>>;
}
export async function dailyReport(
  c: PoolConnection,
  station: string,
  date: string
): Promise<MarketDaily> {
  const r = await rows<Row[]>(
    c,
    "SELECT l.account_code,SUM(l.debit_minor-l.credit_minor) AS amount FROM st_market_lines l JOIN st_market_entries e ON e.id=l.entry_id WHERE e.station_id=? AND e.business_date=? GROUP BY l.account_code",
    [station, date]
  );
  const b = Object.fromEntries(r.map(x => [x.account_code, integer(x.amount)]));
  const totals = await first<Row>(
    c,
    `SELECT
 COALESCE(SUM(CASE WHEN e.kind='PURCHASE' AND l.account_code='INVENTORY' THEN l.debit_minor-l.credit_minor ELSE 0 END),0) AS purchase,
 COALESCE(SUM(CASE WHEN (e.kind='COLLECTION' OR (e.kind='REVERSAL' AND JSON_UNQUOTE(JSON_EXTRACT(e.payload_json,'$.reversesKind'))='COLLECTION')) AND l.account_code='RECEIVABLE' THEN l.credit_minor-l.debit_minor ELSE 0 END),0) AS collection,
 COALESCE(SUM(CASE WHEN (e.kind='PAYMENT' OR (e.kind='REVERSAL' AND JSON_UNQUOTE(JSON_EXTRACT(e.payload_json,'$.reversesKind'))='PAYMENT')) AND l.account_code='PAYABLE' THEN l.debit_minor-l.credit_minor ELSE 0 END),0) AS payment
 FROM st_market_entries e LEFT JOIN st_market_lines l ON l.entry_id=e.id WHERE e.station_id=? AND e.business_date=?`,
    [station, date]
  );
  const count = await first<Row>(
    c,
    "SELECT COUNT(*) AS n FROM st_market_entries WHERE station_id=? AND business_date=? AND kind='POS_SALE'",
    [station, date]
  );
  const returns = await first<Row>(
    c,
    "SELECT COALESCE(SUM(CASE WHEN r.kind='SALE_RETURN' THEN r.gross_minor ELSE 0 END),0) AS sale_gross,COALESCE(SUM(CASE WHEN r.kind='PURCHASE_RETURN' THEN r.gross_minor ELSE 0 END),0) AS purchase_gross,COALESCE(SUM(CASE WHEN r.kind='PURCHASE_RETURN' THEN r.net_minor ELSE 0 END),0) AS purchase_net,COALESCE(SUM(r.kind='SALE_RETURN'),0) AS sale_count FROM st_market_returns r JOIN st_market_entries e ON e.id=r.entry_id WHERE r.station_id=? AND e.business_date=?",
    [station, date]
  );
  return buildMarketDaily(date, b, totals ?? {}, count ?? {}, returns ?? {});
}

async function party(
  c: PoolConnection,
  scope: Scope,
  station: string,
  value: unknown,
  side?: "CUSTOMER" | "SUPPLIER"
) {
  const p = await first<Row>(
    c,
    "SELECT * FROM st_market_parties WHERE id=? AND tenant_id=? AND station_id=?",
    [requireId(value, "partyId"), scope.tenantId, station]
  );
  if (!p || (side && p.kind !== side && p.kind !== "BOTH"))
    fail("NOT_FOUND", "Bu istasyonda uygun market carisi bulunamadı.", 404);
  return p;
}
async function spend(
  c: PoolConnection,
  book: Row,
  wallet: "CASH_SAFE" | "BANK",
  amount: number
) {
  if ((await accountBalance(c, book.station_id, wallet)) < amount)
    fail(
      "INSUFFICIENT_BALANCE",
      "Seçilen kasa/banka kayıt bakiyesi yetersiz.",
      409
    );
}
async function document(
  c: PoolConnection,
  book: Row,
  partyId: string,
  entryId: string,
  kind: string,
  reference: string,
  due: string,
  total: number
) {
  if (!total) return;
  await execute(
    c,
    "INSERT INTO st_market_documents (id,tenant_id,station_id,party_id,entry_id,kind,reference,due_date,total_minor) VALUES (?,?,?,?,?,?,?,?,?)",
    [
      randomUUID(),
      book.tenant_id,
      book.station_id,
      partyId,
      entryId,
      kind,
      reference,
      due,
      total,
    ]
  );
}
export function registerMarketAccountingRoutes(
  app: Express,
  services: Services
) {
  registerMarketStatement(app, services);
  const handle =
    (fn: (req: Request, res: Response) => Promise<void>) =>
    async (req: Request, res: Response) => {
      try {
        await fn(req, res);
      } catch (e) {
        services.error(res, e);
      }
    };
  type Handler = (
    c: PoolConnection,
    actor: StationActor,
    body: Record<string, unknown>,
    scope: Scope,
    station: string,
    book: Row | null
  ) => Promise<unknown>;
  function post(
    path: string,
    roles: StationRole[],
    fn: Handler,
    needsBook = true,
    allowClosed = false
  ) {
    app.post(
      `/api/stationos/market-accounting/${path}`,
      handle(async (req, res) => {
        const actor = services.actor(req);
        services.assertMutation(req, actor);
        const body = req.body as Record<string, unknown>,
          station = requireId(body?.stationId, "stationId");
        Object.defineProperty(body, "__stationDevice", {
          value: req.get("X-Stationos-Device-Id"),
          enumerable: false,
        });
        await withTransaction(c =>
          services.requireStation(c, actor, station, roles)
        );
        for (let attempt = 0; attempt < 3; attempt++)
          try {
            const result = await services.mutation(
              actor,
              {
                ...body,
                _marketAction: path,
                ...(path.startsWith("inventory/")
                  ? { _inventoryDevice: body.__stationDevice ?? null }
                  : {}),
              },
              async c => {
                const { scope } = await services.requireStation(
                  c,
                  actor,
                  station,
                  roles
                );
                const book = await lockMarketBook(
                  c,
                  scope.tenantId,
                  station,
                  allowClosed
                );
                if (needsBook && !book)
                  fail(
                    "MARKET_ACCOUNTING_REQUIRED",
                    "Önce market muhasebesi açılışını yapın.",
                    409
                  );
                const out = await fn(c, actor, body, scope, station, book);
                await services.audit(
                  c,
                  scope.tenantId,
                  station,
                  actor.id,
                  `MARKET_${path.toUpperCase().replaceAll("/", "_")}`,
                  isRecord(out) && typeof out.id === "string" ? out.id : station
                );
                return out;
              }
            );
            res.json(result);
            return;
          } catch (e) {
            if (
              ![
                "ER_CHECKREAD",
                "ER_LOCK_DEADLOCK",
                "ER_LOCK_WAIT_TIMEOUT",
              ].includes((e as { code?: string }).code ?? "")
            )
              throw e;
            if (attempt === 2)
              fail(
                "MARKET_BUSY",
                "Muhasebe kaydı çakıştı; aynı işlem kimliğiyle tekrar deneyin.",
                409
              );
          }
      })
    );
  }
  registerMarketReturns(app, services, post);
  registerInventory(app, services, post);
  registerCancellationReports(app, services);
  registerStockHealthReports(app, services);
  registerLotControl(app, services);
  registerPartyDues(app, services);
  registerSalesAnalysis(app, services);
  registerSalesReports(app, services);
  registerShelfLabels(app, services, post);
  registerPurchaseOrders(app, services, post);
  registerInventoryTerminal(app, services, post);
  registerInventoryReports(app, services);
  registerInventoryCountReports(app, services);
  registerCatalogImport(app, services, post);
  registerInventoryLots(app, services, post);
  app.get(
    "/api/stationos/market-accounting",
    handle(async (req, res) => {
      const actor = services.actor(req),
        station = requireId(req.query.stationId, "stationId"),
        today = businessToday(),
        date = req.query.date ? calendarDate(req.query.date) : today;
      const result = await withTransaction(async c => {
        const { scope } = await services.requireStation(
          c,
          actor,
          station,
          READ
        );
        const book = await first<Row>(
          c,
          "SELECT * FROM st_market_books WHERE station_id=? AND tenant_id=?",
          [station, scope.tenantId]
        );
        const products = await rows<Row[]>(
          c,
          "SELECT p.*,i.quantity AS ledger_qty,i.value_minor FROM st_products p LEFT JOIN st_market_inventory i ON i.product_id=p.id WHERE p.tenant_id=? AND p.station_id=? ORDER BY p.name LIMIT 5000",
          [scope.tenantId, station]
        );
        let opening = 0,
          value = 0,
          unvalued = 0;
        const stock = products.map(p => {
          const quantity = integer(p.stock_qty),
            v = book
              ? integer(p.value_minor)
              : posLineTotal(
                  integer(p.purchase_price_minor),
                  Math.max(1, quantity)
                ) * (quantity === 0 ? 0 : 1);
          opening = safeAdd(
            opening,
            posLineTotal(
              integer(p.purchase_price_minor),
              Math.max(1, quantity)
            ) * (quantity === 0 ? 0 : 1)
          );
          value = safeAdd(value, v);
          if (quantity > 0 && v === 0) unvalued++;
          return {
            id: p.id,
            name: p.name,
            barcode: p.barcode,
            quantity,
            lotTracking: !!p.lot_tracking,
            valueMinor: v,
            averageCostMinor: quantity
              ? ratioRound(v, 1, quantity)
              : integer(p.purchase_price_minor),
            minimumQty: integer(p.minimum_qty),
            salePriceMinor: integer(p.sale_price_minor),
            vatBps:
              p.market_vat_bps === null ? null : integer(p.market_vat_bps),
          };
        });
        const b = await balances(c, station);
        const ps = await rows<Row[]>(
          c,
          `SELECT p.*,COALESCE(ar.balance_minor,0) AS ar,COALESCE(ap.balance_minor,0) AS ap,
    COALESCE((SELECT SUM(total_minor-settled_minor-credited_minor) FROM st_market_documents WHERE party_id=p.id AND kind IN ('CREDIT_SALE','OPENING_AR') AND due_date<?),0) AS overdue_ar,
    COALESCE((SELECT SUM(total_minor-settled_minor-credited_minor) FROM st_market_documents WHERE party_id=p.id AND kind IN ('PURCHASE','OPENING_AP') AND due_date<?),0) AS overdue_ap
    FROM st_market_parties p LEFT JOIN st_market_balances ar ON ar.station_id=p.station_id AND ar.account_code='RECEIVABLE' AND ar.party_key=p.id AND ar.register_key='' LEFT JOIN st_market_balances ap ON ap.station_id=p.station_id AND ap.account_code='PAYABLE' AND ap.party_key=p.id AND ap.register_key='' WHERE p.tenant_id=? AND p.station_id=? ORDER BY p.name LIMIT 5000`,
          [today, today, scope.tenantId, station]
        );
        const docs = await rows<Row[]>(
          c,
          "SELECT d.*,p.name AS party_name FROM st_market_documents d JOIN st_market_parties p ON p.id=d.party_id WHERE d.tenant_id=? AND d.station_id=? ORDER BY d.settled_minor+d.credited_minor<d.total_minor DESC,d.due_date,d.id LIMIT 200",
          [scope.tenantId, station]
        );
        const entries = await rows<Row[]>(
          c,
          "SELECT e.*,u.name AS actor_name,EXISTS(SELECT 1 FROM st_market_entries rev WHERE rev.station_id=e.station_id AND rev.kind='REVERSAL' AND rev.source_id=e.id) AS reversed FROM st_market_entries e JOIN users u ON u.id=e.actor_user_id WHERE e.tenant_id=? AND e.station_id=? AND e.business_date=? ORDER BY e.seq DESC LIMIT 100",
          [scope.tenantId, station, date]
        );
        const lines = entries.length
          ? await rows<Row[]>(
              c,
              `SELECT l.*,p.name AS party_name FROM st_market_lines l LEFT JOIN st_market_parties p ON p.id=l.party_id WHERE l.entry_id IN (${entries.map(() => "?").join(",")}) ORDER BY l.id`,
              entries.map(e => e.id)
            )
          : [];
        const closes = await rows<Row[]>(
          c,
          "SELECT * FROM st_market_day_closes WHERE tenant_id=? AND station_id=? ORDER BY business_date DESC LIMIT 31",
          [scope.tenantId, station]
        );
        const open = await first<Row>(
          c,
          "SELECT COUNT(*) AS n FROM st_pos_sessions WHERE tenant_id=? AND station_id=? AND closed_at IS NULL",
          [scope.tenantId, station]
        );
        const returns = await rows<Row[]>(
          c,
          "SELECT r.*,e.business_date,s.reference AS source_reference FROM st_market_returns r JOIN st_market_entries e ON e.id=r.entry_id JOIN st_market_entries s ON s.id=r.source_entry_id WHERE r.tenant_id=? AND r.station_id=? ORDER BY e.seq DESC LIMIT 50",
          [scope.tenantId, station]
        );
        return {
          today,
          reportDate: date,
          enabled: !!book,
          revision: integer(book?.revision),
          closedToday:
            !!book?.closed_through && String(book.closed_through) >= today,
          startedOn: book?.started_on ?? null,
          openingInventoryMinor: opening,
          unvaluedStockCount: unvalued,
          balances: b,
          daily: await dailyReport(c, station, date),
          stock,
          stockValueMinor: value,
          openRegisterCount: integer(open?.n),
          trialDifferenceMinor: Object.values(b).reduce(
            (s, n) => safeAdd(s, n ?? 0),
            0
          ),
          parties: ps.map(p => ({
            id: p.id,
            name: p.name,
            kind: p.kind,
            taxNumber: p.tax_number,
            receivableLimitMinor: integer(p.receivable_limit_minor),
            payableLimitMinor:
              p.payable_limit_minor === null
                ? null
                : integer(p.payable_limit_minor),
            termDays: integer(p.term_days),
            receivableMinor: integer(p.ar),
            payableMinor: -integer(p.ap),
            overdueReceivableMinor: integer(p.overdue_ar),
            overduePayableMinor: integer(p.overdue_ap),
          })),
          documents: docs.map(d => ({
            id: d.id,
            partyId: d.party_id,
            partyName: d.party_name,
            kind: d.kind,
            reference: d.reference,
            dueDate: d.due_date,
            totalMinor: integer(d.total_minor),
            settledMinor: integer(d.settled_minor),
            creditedMinor: integer(d.credited_minor),
          })),
          returns: returns.map(r => ({
            id: r.id,
            date: r.business_date,
            kind: r.kind,
            reference: r.reference,
            sourceEntryId: r.source_entry_id,
            sourceReference: r.source_reference,
            reason: r.reason,
            grossMinor: integer(r.gross_minor),
            creditedMinor: integer(r.credited_minor),
            refundMinor: integer(r.refund_minor),
            wallet: r.wallet,
          })),
          journal: entries.map(
            e =>
              ({
                id: e.id,
                number: integer(e.seq),
                date: e.business_date,
                kind: e.kind,
                description: e.description,
                reference: e.reference,
                createdAt: e.created_at,
                actorName: e.actor_name,
                reversed: Boolean(integer(e.reversed)),
                lines: lines
                  .filter(l => l.entry_id === e.id)
                  .map(l => ({
                    account: l.account_code,
                    partyId: l.party_id,
                    partyName: l.party_name,
                    registerId: l.register_id,
                    debitMinor: integer(l.debit_minor),
                    creditMinor: integer(l.credit_minor),
                  })),
              }) satisfies MarketJournal
          ),
          closes: closes.map(d => ({
            id: d.id,
            date: d.business_date,
            expectedCashMinor: integer(d.expected_cash_minor),
            countedCashMinor: integer(d.counted_cash_minor),
            differenceMinor: integer(d.difference_minor),
            note: d.note,
            hash: d.snapshot_hash,
            createdAt: d.created_at,
            snapshot: parse(d.snapshot_json),
          })),
        } satisfies MarketAccountingState;
      });
      res.json(result);
    })
  );
  post(
    "start",
    ["OWNER"],
    async (c, actor, body, scope, station, existing) => {
      if (existing)
        fail("ALREADY_STARTED", "Market muhasebesi zaten açık.", 409);
      const open = await first<Row>(
        c,
        "SELECT id FROM st_pos_sessions WHERE station_id=? AND closed_at IS NULL LIMIT 1 FOR UPDATE",
        [station]
      );
      const pendingShift = await first<Row>(
        c,
        "SELECT id FROM st_accounts WHERE station_id=? AND business_unit='MARKET' AND status NOT IN ('ACCEPTED','ACCEPTED_WITH_PENDING') LIMIT 1 FOR UPDATE",
        [station]
      );
      if (pendingShift)
        fail(
          "MARKET_SHIFT_OPEN",
          "Önce eski market vardiya hesaplarının teslim ve mali onaylarını tamamlayın.",
          409
        );
      if (open)
        fail(
          "REGISTER_IN_USE",
          "Açılıştan önce tüm satış kasalarını kapatın.",
          409
        );
      if (body.openingStockAccepted !== true)
        fail(
          "OPENING_CONFIRMATION",
          "Mevcut adet ve alış fiyatlarının KDV hariç açılış maliyeti olduğunu teyit edin.",
          409
        );
      const cash = requireMoney(body.cashMinor, "Merkez kasa", {
          allowZero: true,
        }),
        bank = requireMoney(body.bankMinor, "Banka", { allowZero: true }),
        card = requireMoney(body.cardMinor, "Devreden kart alacağı", {
          allowZero: true,
        }),
        expected = requireMoney(
          body.expectedInventoryMinor,
          "Açılış stok toplamı",
          { allowZero: true }
        );
      const p = await rows<Row[]>(
        c,
        "SELECT id,stock_qty,purchase_price_minor FROM st_products WHERE tenant_id=? AND station_id=? ORDER BY id FOR UPDATE",
        [scope.tenantId, station]
      );
      let inventory = 0;
      for (const x of p)
        inventory = safeAdd(
          inventory,
          integer(x.stock_qty) === 0
            ? 0
            : posLineTotal(
                integer(x.purchase_price_minor),
                integer(x.stock_qty)
              )
        );
      if (inventory !== expected)
        fail(
          "OPENING_CHANGED",
          "Açılış stok değeri değişmiş; önizlemeyi yenileyin.",
          409
        );
      await execute(
        c,
        "INSERT INTO st_market_books (station_id,tenant_id,started_on,created_by_user_id) VALUES (?,?,?,?)",
        [station, scope.tenantId, businessToday(), actor.id]
      );
      const book = (await first<Row>(
        c,
        "SELECT * FROM st_market_books WHERE station_id=?",
        [station]
      ))!;
      for (const x of p)
        await execute(
          c,
          "INSERT INTO st_market_inventory (product_id,station_id,quantity,value_minor) VALUES (?,?,?,?)",
          [
            x.id,
            station,
            x.stock_qty,
            integer(x.stock_qty) === 0
              ? 0
              : posLineTotal(
                  integer(x.purchase_price_minor),
                  integer(x.stock_qty)
                ),
          ]
        );
      const id = await ledgerEntry(
        c,
        book,
        actor.id,
        "OPENING",
        station,
        "Market ön muhasebe açılışı",
        [
          { account: "CASH_SAFE", debit: cash },
          { account: "BANK", debit: bank },
          { account: "CARD_CLEARING", debit: card },
          { account: "INVENTORY", debit: inventory },
          { account: "OPENING", credit: safeAdd(cash, bank, card, inventory) },
        ],
        { openingStockAccepted: true, inventory, cash, bank, card }
      );
      return { id, inventoryMinor: inventory };
    },
    false,
    true
  );
  post(
    "party-update",
    READ,
    async (c, actor, body, scope, station) => {
      const p = await party(c, scope, station, body.partyId),
        name = requireString(body.name, "Cari adı", { max: 190 }),
        ar = requireMoney(body.receivableLimitMinor, "Müşteri limiti", {
          allowZero: true,
        }),
        ap =
          body.payableLimitMinor == null
            ? null
            : requireMoney(body.payableLimitMinor, "Tedarikçi limiti", {
                allowZero: true,
              }),
        term = requireInteger(body.termDays, "Vade günü", { allowZero: true });
      if (term > 365) fail("INVALID_INPUT", "Vade en fazla 365 gün olabilir.");
      await execute(
        c,
        "UPDATE st_market_parties SET name=?,receivable_limit_minor=?,payable_limit_minor=?,term_days=?,tax_number=? WHERE id=?",
        [
          name,
          ar,
          ap,
          term,
          optionalString(body.taxNumber, "Vergi no", 32),
          p.id,
        ]
      );
      return { id: p.id };
    },
    true,
    true
  );
  post("party", READ, async (c, actor, body, scope, station, book) => {
    const name = requireString(body.name, "Cari adı", { max: 190 }),
      kind = requireEnum(body.kind, "kind", [
        "CUSTOMER",
        "SUPPLIER",
        "BOTH",
      ] as const),
      tax = optionalString(body.taxNumber, "Vergi no", 32);
    const receivableLimit = requireMoney(
        body.receivableLimitMinor ?? 0,
        "Müşteri limiti",
        { allowZero: true }
      ),
      payableLimit =
        body.payableLimitMinor == null
          ? null
          : requireMoney(body.payableLimitMinor, "Tedarikçi limiti", {
              allowZero: true,
            }),
      term = requireInteger(body.termDays ?? 0, "Vade günü", {
        allowZero: true,
      });
    if (term > 365) fail("INVALID_INPUT", "Vade en fazla 365 gün olabilir.");
    const ar = requireMoney(
        body.openingReceivableMinor ?? 0,
        "Açılış alacağı",
        { allowZero: true }
      ),
      ap = requireMoney(body.openingPayableMinor ?? 0, "Açılış borcu", {
        allowZero: true,
      });
    if ((kind === "SUPPLIER" && ar) || (kind === "CUSTOMER" && ap))
      fail("INVALID_INPUT", "Açılış bakiyesi cari türüyle uyuşmuyor.");
    const capacity = await first<Row>(
      c,
      "SELECT COUNT(*) AS n FROM st_market_parties WHERE station_id=?",
      [station]
    );
    if (integer(capacity?.n) >= 5000)
      fail(
        "PARTY_LIMIT",
        "Bir market defterinde en fazla 5.000 cari kartı olabilir.",
        409
      );
    const id = randomUUID();
    await execute(
      c,
      "INSERT INTO st_market_parties (id,tenant_id,station_id,name,kind,tax_number,receivable_limit_minor,payable_limit_minor,term_days) VALUES (?,?,?,?,?,?,?,?,?)",
      [
        id,
        scope.tenantId,
        station,
        name,
        kind,
        tax,
        receivableLimit,
        payableLimit,
        term,
      ]
    );
    if (ar || ap) {
      if (!CLOSE.includes(scope.member.role))
        fail(
          "ROLE_FORBIDDEN",
          "Cari açılış bakiyesini firma sahibi veya muhasebeci kaydedebilir.",
          403
        );
      const desc = note(body.openingNote, "Açılış açıklaması");
      const entry = await ledgerEntry(
        c,
        book!,
        actor.id,
        "PARTY_OPENING",
        id,
        desc,
        [
          { account: "RECEIVABLE", partyId: id, debit: ar },
          { account: "OPENING", credit: ar },
          { account: "OPENING", debit: ap },
          { account: "PAYABLE", partyId: id, credit: ap },
        ],
        { partyId: id, ar, ap }
      );
      await document(
        c,
        book!,
        id,
        entry,
        "OPENING_AR",
        `ACILIS:${id}`,
        businessToday(),
        ar
      );
      await document(
        c,
        book!,
        id,
        entry,
        "OPENING_AP",
        `ACILIS:${id}`,
        businessToday(),
        ap
      );
    }
    return { id };
  });
  post(
    "product",
    READ,
    async (c, actor, body, scope, station) => {
      const id = requireId(body.productId, "productId"),
        vat = vatRate(body.vatBps),
        price = requireMoney(body.salePriceMinor, "Satış fiyatı", {
          allowZero: true,
        });
      const p = await first<Row>(
        c,
        "SELECT id,sale_price_minor FROM st_products WHERE id=? AND tenant_id=? AND station_id=? FOR UPDATE",
        [id, scope.tenantId, station]
      );
      if (!p) fail("NOT_FOUND", "Ürün bulunamadı.", 404);
      if (integer(p.sale_price_minor) !== price)
        await execute(
          c,
          "INSERT INTO st_market_price_history(station_id,product_id,list_id,old_minor,new_minor,actor_user_id) VALUES (?,?,NULL,?,?,?)",
          [station, id, p.sale_price_minor, price, actor.id]
        );
      await execute(
        c,
        "UPDATE st_products SET market_vat_bps=?,sale_price_minor=? WHERE id=?",
        [vat, price, id]
      );
      return { id };
    },
    true,
    true
  );
  post("purchase", READ, recordMarketPurchase);
  post("settlement", CLOSE, async (c, actor, body, scope, station, book) => {
    const direction = requireEnum(body.direction, "direction", [
        "COLLECTION",
        "PAYMENT",
      ] as const),
      p = await party(
        c,
        scope,
        station,
        body.partyId,
        direction === "COLLECTION" ? "CUSTOMER" : "SUPPLIER"
      ),
      amount = requireMoney(body.amountMinor, "Tutar"),
      wallet = requireEnum(body.wallet, "wallet", [
        "CASH_SAFE",
        "BANK",
      ] as const),
      ref = optionalString(body.reference, "Referans", 150),
      description = note(body.description);
    const account = direction === "COLLECTION" ? "RECEIVABLE" : "PAYABLE",
      balance =
        (direction === "COLLECTION" ? 1 : -1) *
        (await accountBalance(c, station, account, p.id));
    if (amount > balance)
      fail("OVER_SETTLEMENT", "Tutar açık cari bakiyesini aşamaz.", 409);
    if (direction === "PAYMENT") await spend(c, book!, wallet, amount);
    const kinds =
      direction === "COLLECTION"
        ? "'CREDIT_SALE','OPENING_AR'"
        : "'PURCHASE','OPENING_AP'";
    const docs = await rows<Row[]>(
      c,
      `SELECT * FROM st_market_documents WHERE station_id=? AND party_id=? AND kind IN (${kinds}) AND settled_minor+credited_minor<total_minor ORDER BY due_date,created_at,id FOR UPDATE`,
      [station, p.id]
    );
    if (
      docs.reduce(
        (s, d) =>
          safeAdd(
            s,
            integer(d.total_minor),
            -integer(d.settled_minor),
            -integer(d.credited_minor)
          ),
        0
      ) !== balance
    )
      fail(
        "MARKET_PARTY_MISMATCH",
        "Cari belge ve defter bakiyesi uyuşmuyor.",
        409
      );
    const id = randomUUID(),
      entry = await ledgerEntry(
        c,
        book!,
        actor.id,
        direction,
        id,
        description,
        direction === "COLLECTION"
          ? [
              { account: wallet, debit: amount },
              { account: "RECEIVABLE", partyId: p.id, credit: amount },
            ]
          : [
              { account: "PAYABLE", partyId: p.id, debit: amount },
              { account: wallet, credit: amount },
            ],
        { partyId: p.id, wallet, amount },
        ref
      );
    let left = amount;
    for (const d of docs) {
      if (!left) break;
      const paid = Math.min(
        left,
        safeAdd(
          integer(d.total_minor),
          -integer(d.settled_minor),
          -integer(d.credited_minor)
        )
      );
      await execute(
        c,
        "UPDATE st_market_documents SET settled_minor=settled_minor+? WHERE id=?",
        [paid, d.id]
      );
      await execute(
        c,
        "INSERT INTO st_market_allocations (id,document_id,entry_id,amount_minor) VALUES (?,?,?,?)",
        [randomUUID(), d.id, entry, paid]
      );
      left -= paid;
    }
    return { id: entry };
  });
  post("expense", CLOSE, async (c, actor, body, _scope, _station, book) => {
    const net = requireMoney(body.netMinor, "KDV hariç gider"),
      vat = netTax(net, vatRate(body.vatBps)),
      gross = safeAdd(net, vat),
      wallet = requireEnum(body.wallet, "wallet", [
        "CASH_SAFE",
        "BANK",
      ] as const),
      description = note(body.description),
      ref = optionalString(body.reference, "Referans", 150);
    await spend(c, book!, wallet, gross);
    const id = await ledgerEntry(
      c,
      book!,
      actor.id,
      "EXPENSE",
      requireId(body.requestId, "requestId"),
      description,
      [
        { account: "EXPENSE", debit: net },
        { account: "INPUT_VAT", debit: vat },
        { account: wallet, credit: gross },
      ],
      { net, vat, gross, wallet },
      ref
    );
    return { id };
  });
  post("transfer", CLOSE, async (c, actor, body, _scope, _station, book) => {
    const from = requireEnum(body.from, "from", ["CASH_SAFE", "BANK"] as const),
      to = from === "BANK" ? "CASH_SAFE" : "BANK",
      amount = requireMoney(body.amountMinor, "Tutar"),
      description = note(body.description);
    await spend(c, book!, from, amount);
    const id = await ledgerEntry(
      c,
      book!,
      actor.id,
      "TRANSFER",
      requireId(body.requestId, "requestId"),
      description,
      [
        { account: to, debit: amount },
        { account: from, credit: amount },
      ],
      { from, to, amount }
    );
    return { id };
  });
  post("capital", ["OWNER"], async (c, actor, body, _scope, _station, book) => {
    const amount = requireMoney(body.amountMinor, "Tutar"),
      wallet = requireEnum(body.wallet, "wallet", [
        "CASH_SAFE",
        "BANK",
      ] as const),
      description = note(body.description);
    return {
      id: await ledgerEntry(
        c,
        book!,
        actor.id,
        "CAPITAL",
        requireId(body.requestId, "requestId"),
        description,
        [
          { account: wallet, debit: amount },
          { account: "OPENING", credit: amount },
        ],
        { amount, wallet }
      ),
    };
  });
  post(
    "bank-settlement",
    CLOSE,
    async (c, actor, body, _scope, station, book) => {
      const gross = requireMoney(body.grossMinor, "Brüt kart tutarı"),
        fee = requireMoney(body.feeMinor, "Komisyon", { allowZero: true }),
        ref = requireString(body.reference, "Banka işlem referansı", {
          min: 3,
          max: 150,
        });
      if (fee > gross) fail("INVALID_INPUT", "Komisyon brüt tutarı aşamaz.");
      if ((await accountBalance(c, station, "CARD_CLEARING")) < gross)
        fail("OVER_SETTLEMENT", "Tutar açık kart alacağını aşamaz.", 409);
      const id = await ledgerEntry(
        c,
        book!,
        actor.id,
        "BANK_SETTLEMENT",
        requireId(body.requestId, "requestId"),
        "Kart alacağının bankaya geçişi · manuel beyan",
        [
          { account: "BANK", debit: gross - fee },
          { account: "BANK_FEES", debit: fee },
          { account: "CARD_CLEARING", credit: gross },
        ],
        { gross, fee, net: gross - fee, manualDeclaration: true },
        ref,
        `BANK:${ref}`
      );
      return { id };
    }
  );
  post("stock-adjust", READ, async (c, actor, body, scope, station, book) => {
    const id = requireId(body.productId, "productId"),
      counted = requireInteger(body.countedQty, "Sayılan adet", {
        allowZero: true,
      }),
      expected = requireInteger(body.expectedQty, "Beklenen adet", {
        allowZero: true,
      }),
      description = note(body.description);
    const p = await first<Row>(
      c,
      "SELECT * FROM st_products WHERE id=? AND tenant_id=? AND station_id=? FOR UPDATE",
      [id, scope.tenantId, station]
    );
    if (!p) fail("NOT_FOUND", "Ürün bulunamadı.", 404);
    if (p.lot_tracking)
      fail(
        "LOT_COUNT_REQUIRED",
        "Bu ürünün sayım farkını Lot / SKT ekranında parti bazında işleyin.",
        409
      );
    if (integer(p.stock_qty) !== expected)
      fail("STOCK_CHANGED", "Stok değişmiş; sayımı yenileyin.", 409);
    const inv = await inventoryRow(c, book!, p),
      delta = counted - expected;
    if (!delta) fail("NO_CHANGE", "Sayımda fark yok.", 409);
    const amount =
        delta > 0
          ? posLineTotal(
              requireMoney(body.unitNetMinor, "Fazla stok birim maliyeti", {
                allowZero: true,
              }),
              delta
            )
          : stockCost(integer(inv.value_minor), expected, -delta),
      value = safeAdd(integer(inv.value_minor), delta > 0 ? amount : -amount);
    await execute(
      c,
      "UPDATE st_products SET stock_qty=?,stock_version=stock_version+1 WHERE id=?",
      [counted, id]
    );
    await execute(
      c,
      "UPDATE st_market_inventory SET quantity=?,value_minor=? WHERE product_id=?",
      [counted, value, id]
    );
    const entry = await ledgerEntry(
      c,
      book!,
      actor.id,
      "STOCK_ADJUST",
      requireId(body.requestId, "requestId"),
      description,
      delta > 0
        ? [
            { account: "INVENTORY", debit: amount },
            { account: "STOCK_GAIN", credit: amount },
          ]
        : [
            { account: "STOCK_LOSS", debit: amount },
            { account: "INVENTORY", credit: amount },
          ],
      { productId: id, before: expected, after: counted, valueMinor: amount }
    );
    await execute(
      c,
      "INSERT INTO st_stock_movements (id,tenant_id,station_id,product_id,kind,quantity,unit_price_minor,reference,created_by_user_id) VALUES (?,?,?,?,'ADJUSTMENT',?,?,?,?)",
      [
        randomUUID(),
        scope.tenantId,
        station,
        id,
        delta,
        0,
        `MARKET:${entry}`,
        actor.id,
      ]
    );
    return { id: entry };
  });
  post("reverse", CLOSE, async (c, actor, body, scope, station, book) => {
    const source = requireId(body.entryId, "entryId"),
      reason = note(body.reason, "Ters kayıt açıklaması"),
      entry = await first<Row>(
        c,
        "SELECT * FROM st_market_entries WHERE id=? AND tenant_id=? AND station_id=? FOR UPDATE",
        [source, scope.tenantId, station]
      );
    if (
      !entry ||
      ![
        "COLLECTION",
        "PAYMENT",
        "EXPENSE",
        "TRANSFER",
        "BANK_SETTLEMENT",
        "CAPITAL",
      ].includes(entry.kind)
    )
      fail(
        "REVERSAL_UNSUPPORTED",
        "Bu kayıt için stok/iade belgesi gerekir; genel ters kayıt kullanılamaz.",
        409
      );
    const old = await rows<Row[]>(
      c,
      "SELECT * FROM st_market_lines WHERE entry_id=? ORDER BY id",
      [source]
    );
    for (const l of old)
      if (
        ["CASH_SAFE", "BANK", "CARD_CLEARING"].includes(l.account_code) &&
        integer(l.debit_minor) > integer(l.credit_minor)
      ) {
        const n = await accountBalance(c, station, l.account_code);
        if (safeAdd(n, integer(l.credit_minor), -integer(l.debit_minor)) < 0)
          fail(
            "INSUFFICIENT_BALANCE",
            "Ters kayıt için hesap bakiyesi yetersiz.",
            409
          );
      }
    const id = await ledgerEntry(
      c,
      book!,
      actor.id,
      "REVERSAL",
      source,
      `Ters kayıt: ${reason}`,
      old.map(l => ({
        account: l.account_code,
        debit: integer(l.credit_minor),
        credit: integer(l.debit_minor),
        partyId: l.party_id ?? undefined,
        registerId: l.register_id ?? undefined,
      })),
      { reversesKind: entry.kind, entryId: source, reason }
    );
    const allocations = await rows<Row[]>(
      c,
      "SELECT * FROM st_market_allocations WHERE entry_id=?",
      [source]
    );
    for (const a of allocations) {
      const d = await first<Row>(
        c,
        "SELECT settled_minor FROM st_market_documents WHERE id=? FOR UPDATE",
        [a.document_id]
      );
      if (integer(d?.settled_minor) < integer(a.amount_minor))
        fail("MARKET_PARTY_MISMATCH", "Belge ödeme dağılımı uyuşmuyor.", 409);
      await execute(
        c,
        "UPDATE st_market_documents SET settled_minor=settled_minor-? WHERE id=?",
        [a.amount_minor, a.document_id]
      );
    }
    return { id };
  });
  post("day-close", CLOSE, async (c, actor, body, scope, station, book) => {
    const counted = requireMoney(body.countedCashMinor, "Sayılan merkez kasa", {
      allowZero: true,
    });
    if (
      requireInteger(body.expectedRevision, "Defter sürümü", {
        allowZero: true,
      }) !== integer(book!.revision)
    )
      fail(
        "REPORT_CHANGED",
        "Yeni hareket kaydedilmiş; gün sonu önizlemesini yenileyin.",
        409
      );
    const open = await first<Row>(
      c,
      "SELECT id FROM st_pos_sessions WHERE tenant_id=? AND station_id=? AND closed_at IS NULL LIMIT 1 FOR UPDATE",
      [scope.tenantId, station]
    );
    if (open)
      fail(
        "REGISTER_IN_USE",
        "Gün sonundan önce bütün satış kasalarını kapatın.",
        409
      );
    const physicalMismatch = await first<Row>(
      c,
      "SELECT p.id FROM st_products p LEFT JOIN st_market_inventory i ON i.product_id=p.id WHERE p.station_id=? AND p.stock_qty<>COALESCE(i.quantity,0) LIMIT 1",
      [station]
    );
    if (physicalMismatch)
      fail(
        "MARKET_STOCK_MISMATCH",
        "Fiziksel stok ve maliyet adetleri uyuşmuyor.",
        409
      );
    const lotMismatch = await first<Row>(
      c,
      "SELECT p.id FROM st_products p LEFT JOIN (SELECT product_id,SUM(quantity) AS qty FROM st_inventory_lots GROUP BY product_id) l ON l.product_id=p.id WHERE p.station_id=? AND p.lot_tracking=TRUE AND p.stock_qty<>COALESCE(l.qty,0) LIMIT 1",
      [station]
    );
    if (lotMismatch)
      fail(
        "LOT_STOCK_MISMATCH",
        "Parti toplamı ile ürün stoğu uyuşmuyor; gün sonu kaydedilmedi.",
        409
      );
    const b = await balances(c, station);
    if ((b.CASH_DRAWER ?? 0) !== 0)
      fail("MARKET_CASH_MISMATCH", "Satış çekmecesi devri eksik.", 409);
    const inv = await first<Row>(
      c,
      "SELECT COALESCE(SUM(value_minor),0) AS total FROM st_market_inventory WHERE station_id=?",
      [station]
    );
    if (integer(inv?.total) !== (b.INVENTORY ?? 0))
      fail(
        "MARKET_STOCK_MISMATCH",
        "Stok maliyeti ile defter toplamı uyuşmuyor.",
        409
      );
    if (Object.values(b).reduce((s, n) => safeAdd(s, n ?? 0), 0) !== 0)
      fail("LEDGER_UNBALANCED", "Defter mutabakatı bozuk.", 409);
    const expected = b.CASH_SAFE ?? 0,
      diff = safeAdd(counted, -expected),
      why = optionalString(body.note, "Sayım açıklaması", 500);
    rejectCardData(why);
    if (diff && (!why || why.length < 5))
      fail(
        "CLOSE_NOTE_REQUIRED",
        "Kasa farkı için en az beş karakter açıklama girin.",
        409
      );
    const id = randomUUID();
    if (diff)
      await ledgerEntry(
        c,
        book!,
        actor.id,
        "DAY_VARIANCE",
        id,
        "Gün sonu merkez kasa sayım farkı",
        diff > 0
          ? [
              { account: "CASH_SAFE", debit: diff },
              { account: "CASH_GAIN", credit: diff },
            ]
          : [
              { account: "CASH_LOSS", debit: -diff },
              { account: "CASH_SAFE", credit: -diff },
            ],
        { expected, counted, difference: diff, note: why }
      );
    const snapshot = {
        daily: await dailyReport(c, station, businessToday()),
        balances: await balances(c, station),
        revision: integer(book!.revision),
      },
      hash = payloadHash(snapshot);
    await execute(
      c,
      "INSERT INTO st_market_day_closes (id,tenant_id,station_id,business_date,actor_user_id,expected_cash_minor,counted_cash_minor,difference_minor,note,snapshot_json,snapshot_hash) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
      [
        id,
        scope.tenantId,
        station,
        businessToday(),
        actor.id,
        expected,
        counted,
        diff,
        why,
        JSON.stringify(snapshot),
        hash,
      ]
    );
    await execute(
      c,
      "UPDATE st_market_books SET closed_through=?,revision=revision+1 WHERE station_id=?",
      [businessToday(), station]
    );
    return { id, hash, differenceMinor: diff };
  });
}

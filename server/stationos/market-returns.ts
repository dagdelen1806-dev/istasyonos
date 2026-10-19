import { returnLots } from "./lot-stock";
import { randomUUID } from "node:crypto";
import type { Express } from "express";
import type { PoolConnection } from "mysql2/promise";
import type {
  MarketReturnSource,
  MarketReturnSummary,
} from "../../shared/market-accounting";
import { returnAmounts } from "../../shared/market-return-math";
import type { Services, Scope, Row } from "./market-pos";
import type { StationActor, StationRole } from "./types";
import { fail } from "./types";
import { execute, first, rows, withTransaction } from "./db";
import {
  isRecord,
  optionalString,
  requireEnum,
  requireId,
  requireInteger,
  requireMoney,
  requireString,
} from "./domain";
import { safeAdd, rejectCardData } from "./safety";
import {
  businessToday,
  calendarDate,
  integer,
  ratioRound,
  stockCost,
  type LedgerLine,
} from "./market-accounting-domain";
import {
  accountBalance,
  inventoryRow,
  ledgerEntry,
} from "./market-accounting-ledger";

type ReturnHandler = (
  c: PoolConnection,
  actor: StationActor,
  body: Record<string, unknown>,
  scope: Scope,
  station: string,
  book: Row | null
) => Promise<unknown>;
type Post = (
  path: string,
  roles: StationRole[],
  handler: ReturnHandler
) => void;
const READ: StationRole[] = ["OWNER", "MANAGER", "ACCOUNTANT"];
const parse = (value: unknown) =>
  typeof value === "string" ? JSON.parse(value) : value;

async function sourceDetails(
  c: PoolConnection,
  tenant: string,
  station: string,
  id: string,
  locked = false
) {
  const lock = locked ? " FOR UPDATE" : "";
  const e = await first<Row>(
    c,
    "SELECT * FROM st_market_entries WHERE id=? AND tenant_id=? AND station_id=? AND kind IN ('POS_SALE','PURCHASE')" +
      lock,
    [id, tenant, station]
  );
  if (!e)
    fail(
      "NOT_FOUND",
      "Bu istasyonda iadeye uygun kaynak belge bulunamadı.",
      404
    );
  const payload = parse(e.payload_json);
  if (
    !isRecord(payload) ||
    !Array.isArray(payload.items) ||
    !payload.items.length ||
    payload.items.length > 100
  )
    fail(
      "RETURN_SOURCE_UNSUPPORTED",
      "Kaynak belgenin maliyet/KDV satırları eksik; otomatik iade yapılamaz.",
      409
    );
  const doc = await first<Row>(
    c,
    "SELECT d.*,p.name AS party_name FROM st_market_documents d JOIN st_market_parties p ON p.id=d.party_id WHERE d.entry_id=? AND d.station_id=? AND d.tenant_id=? AND d.kind IN ('PURCHASE','CREDIT_SALE')" +
      lock,
    [id, station, tenant]
  );
  if (e.kind === "PURCHASE" && !doc)
    fail(
      "MARKET_PARTY_MISMATCH",
      "Kaynak alışın cari belgesi bulunamadı.",
      409
    );
  const previous = await rows<Row[]>(
    c,
    "SELECT l.* FROM st_market_return_lines l JOIN st_market_returns r ON r.id=l.return_id WHERE r.station_id=? AND r.source_entry_id=?" +
      lock,
    [station, id]
  );
  const seen = new Set<string>();
  const items: MarketReturnSource["items"] = [];
  for (const raw of [...payload.items].sort((a, b) =>
    String(a?.productId).localeCompare(String(b?.productId))
  )) {
    if (!isRecord(raw))
      fail("RETURN_SOURCE_UNSUPPORTED", "Kaynak satır okunamadı.", 409);
    const productId = requireId(raw.productId, "productId");
    if (seen.has(productId))
      fail(
        "RETURN_SOURCE_UNSUPPORTED",
        "Kaynak belgede ürün satırı tekrarlanıyor.",
        409
      );
    seen.add(productId);
    const p = await first<Row>(
      c,
      "SELECT p.*,i.quantity AS valued_qty,i.value_minor FROM st_products p LEFT JOIN st_market_inventory i ON i.product_id=p.id WHERE p.id=? AND p.tenant_id=? AND p.station_id=?" +
        lock,
      [productId, tenant, station]
    );
    if (!p) fail("NOT_FOUND", "Kaynak belgenin ürün kartı bulunamadı.", 404);
    const prior = previous.filter(l => l.product_id === productId);
    const sum = (key: string) =>
      prior.reduce((n, l) => safeAdd(n, integer(l[key])), 0);
    const net = requireMoney(raw.netMinor, "Kaynak net tutarı", {
      allowZero: true,
    });
    const vat = requireMoney(raw.vatMinor, "Kaynak KDV", { allowZero: true });
    items.push({
      productId,
      name: typeof raw.name === "string" ? raw.name : p.name,
      barcode: p.barcode,
      quantity: requireInteger(raw.quantity, "Kaynak adet"),
      grossMinor: safeAdd(net, vat),
      netMinor: net,
      costMinor:
        e.kind === "POS_SALE"
          ? requireMoney(raw.costMinor, "Kaynak maliyet", { allowZero: true })
          : net,
      returnedQuantity: sum("quantity"),
      returnedGrossMinor: sum("gross_minor"),
      returnedNetMinor: sum("net_minor"),
      returnedCostMinor: sum("cost_minor"),
      stockQuantity: integer(p.stock_qty),
      stockValueMinor: integer(p.value_minor),
      lotTracking: !!p.lot_tracking,
      lots: p.lot_tracking
        ? (
            await rows<Row[]>(
              c,
              "SELECT id,code,expiry_date,quantity,status FROM st_inventory_lots WHERE product_id=? AND station_id=? AND quantity>0 ORDER BY expiry_date,id",
              [p.id, station]
            )
          ).map(l => ({
            id: l.id,
            code: l.code,
            expiryDate: l.expiry_date,
            quantity: integer(l.quantity),
            status: l.status,
          }))
        : [],
    });
  }
  const summary: MarketReturnSummary = {
    id: e.id,
    number: integer(e.seq),
    date: e.business_date,
    kind: e.kind,
    reference: e.reference,
    partyName: doc?.party_name ?? null,
    grossMinor: items.reduce((s, l) => safeAdd(s, l.grossMinor), 0),
  };
  return {
    summary,
    items,
    document: doc,
    openDocumentMinor: doc
      ? safeAdd(
          integer(doc.total_minor),
          -integer(doc.settled_minor),
          -integer(doc.credited_minor)
        )
      : 0,
  };
}

export function registerMarketReturns(
  app: Express,
  services: Services,
  post: Post
) {
  app.get(
    "/api/stationos/market-accounting/return-sources",
    async (req, res) => {
      try {
        const actor = services.actor(req),
          station = requireId(req.query.stationId, "stationId");
        const kind = requireEnum(req.query.kind, "kind", [
          "POS_SALE",
          "PURCHASE",
        ] as const);
        const from = calendarDate(req.query.from ?? "2000-01-01"),
          to = calendarDate(req.query.to ?? businessToday());
        if (from > to)
          fail("INVALID_DATE", "Başlangıç tarihi bitişten sonra olamaz.");
        const q = optionalString(req.query.q, "Belge arama", 100) ?? "";
        const cursor = requireInteger(Number(req.query.cursor ?? 0), "cursor", {
          allowZero: true,
        });
        res.json(
          await withTransaction(async c => {
            const { scope } = await services.requireStation(
              c,
              actor,
              station,
              READ
            );
            const found = await rows<Row[]>(
              c,
              `SELECT e.*,p.name AS party_name,d.total_minor,
          (SELECT COALESCE(SUM(l.debit_minor),0) FROM st_market_lines l WHERE l.entry_id=e.id AND l.account_code IN ('CASH_DRAWER','CARD_CLEARING','RECEIVABLE')) AS sale_gross
          FROM st_market_entries e LEFT JOIN st_market_documents d ON d.entry_id=e.id AND d.kind IN ('PURCHASE','CREDIT_SALE')
          LEFT JOIN st_market_parties p ON p.id=d.party_id
          WHERE e.tenant_id=? AND e.station_id=? AND e.kind=? AND e.business_date BETWEEN ? AND ?
          AND (?=0 OR e.seq<?) AND (?='' OR LOCATE(?,CONCAT_WS(' ',e.reference,e.source_id,e.id,p.name))>0)
          ORDER BY e.seq DESC LIMIT 51`,
              [scope.tenantId, station, kind, from, to, cursor, cursor, q, q]
            );
            const selected = found.slice(0, 50);
            return {
              rows: selected.map(
                e =>
                  ({
                    id: e.id,
                    number: integer(e.seq),
                    date: e.business_date,
                    kind: e.kind,
                    reference: e.reference,
                    partyName: e.party_name ?? null,
                    grossMinor: integer(
                      e.kind === "PURCHASE" ? e.total_minor : e.sale_gross
                    ),
                  }) satisfies MarketReturnSummary
              ),
              nextCursor:
                found.length > 50 ? integer(selected.at(-1)!.seq) : null,
            };
          })
        );
      } catch (e) {
        services.error(res, e);
      }
    }
  );
  app.get(
    "/api/stationos/market-accounting/return-source",
    async (req, res) => {
      try {
        const actor = services.actor(req),
          station = requireId(req.query.stationId, "stationId"),
          id = requireId(req.query.entryId, "entryId");
        res.json(
          await withTransaction(async c => {
            const { scope } = await services.requireStation(
              c,
              actor,
              station,
              READ
            );
            const book = await first<Row>(
              c,
              "SELECT revision FROM st_market_books WHERE station_id=? AND tenant_id=?",
              [station, scope.tenantId]
            );
            if (!book)
              fail(
                "MARKET_ACCOUNTING_REQUIRED",
                "Önce market muhasebesini başlatın.",
                409
              );
            const source = await sourceDetails(c, scope.tenantId, station, id);
            return {
              ...source.summary,
              revision: integer(book.revision),
              openDocumentMinor: source.openDocumentMinor,
              items: source.items,
            } satisfies MarketReturnSource;
          })
        );
      } catch (e) {
        services.error(res, e);
      }
    }
  );

  post(
    "return",
    ["OWNER", "ACCOUNTANT"],
    async (c, actor, body, scope, station, book) => {
      if (
        requireInteger(body.expectedRevision, "Önizleme sürümü", {
          allowZero: true,
        }) !== integer(book!.revision)
      )
        fail(
          "RETURN_PREVIEW_CHANGED",
          "Bakiyeler veya stok değişti. İade belgesini yeniden yükleyin.",
          409
        );
      const source = await sourceDetails(
        c,
        scope.tenantId,
        station,
        requireId(body.sourceEntryId, "sourceEntryId"),
        true
      );
      const sale = source.summary.kind === "POS_SALE",
        kind = sale ? "SALE_RETURN" : "PURCHASE_RETURN";
      const reference = requireString(body.reference, "İade belge no", {
        max: 100,
      });
      const reason = requireString(body.reason, "İade açıklaması", {
        min: 5,
        max: 500,
      });
      rejectCardData(reference);
      rejectCardData(reason);
      if (
        await first(
          c,
          "SELECT id FROM st_market_returns WHERE station_id=? AND reference=? FOR UPDATE",
          [station, reference]
        )
      )
        fail(
          "RETURN_REFERENCE_EXISTS",
          "Bu iade belge numarası zaten kullanılmış. Mevcut iadeyi kontrol edin.",
          409
        );
      if (
        !Array.isArray(body.lines) ||
        !body.lines.length ||
        body.lines.length > 100
      )
        fail("INVALID_INPUT", "İade 1–100 ürün satırı içermelidir.");
      const selected = new Set<string>();
      const lines = body.lines
        .map(raw => {
          if (!isRecord(raw)) fail("INVALID_INPUT", "İade satırı geçersiz.");
          const productId = requireId(raw.productId, "productId"),
            quantity = requireInteger(raw.quantity, "İade adedi");
          if (selected.has(productId))
            fail("INVALID_INPUT", "Aynı ürün iki kez seçilemez.");
          selected.add(productId);
          const item = source.items.find(l => l.productId === productId);
          if (!item) fail("NOT_FOUND", "Ürün bu kaynak belgede yok.", 404);
          if (quantity > item.quantity - item.returnedQuantity)
            fail(
              "RETURN_QUANTITY_EXCEEDED",
              "İade adedi kaynak belgede kalan adedi aşamaz.",
              409
            );
          if (!sale && quantity > item.stockQuantity)
            fail(
              "NEGATIVE_INVENTORY",
              "Tedarikçiye iade için mevcut stok yetersiz.",
              409
            );
          const amount = returnAmounts(
            item,
            {
              quantity: item.returnedQuantity,
              grossMinor: item.returnedGrossMinor,
              netMinor: item.returnedNetMinor,
            },
            quantity
          );
          const costMinor = sale
            ? safeAdd(
                ratioRound(
                  item.costMinor,
                  item.returnedQuantity + quantity,
                  item.quantity
                ),
                -item.returnedCostMinor
              )
            : stockCost(item.stockValueMinor, item.stockQuantity, quantity);
          requireMoney(costMinor, "İade stok maliyeti", { allowZero: true });
          return { productId, quantity, ...amount, costMinor, lots: raw.lots };
        })
        .sort((a, b) => a.productId.localeCompare(b.productId));
      const sum = (key: "grossMinor" | "netMinor" | "vatMinor" | "costMinor") =>
        lines.reduce((s, l) => safeAdd(s, l[key]), 0);
      const gross = sum("grossMinor"),
        net = sum("netMinor"),
        vat = sum("vatMinor"),
        cost = sum("costMinor");
      const credited = Math.min(gross, source.openDocumentMinor),
        refund = gross - credited;
      if (
        requireMoney(body.expectedTotalMinor, "Önizleme toplamı", {
          allowZero: true,
        }) !== gross ||
        requireMoney(body.expectedCreditedMinor, "Önizleme cari mahsubu", {
          allowZero: true,
        }) !== credited ||
        requireMoney(body.expectedCostMinor, "Önizleme maliyeti", {
          allowZero: true,
        }) !== cost
      )
        fail(
          "RETURN_TOTAL_CHANGED",
          "İade tutarı veya maliyet önizlemesi değişmiş; belgeyi yenileyin.",
          409
        );
      const wallet = refund
        ? requireEnum(body.wallet, "İade hesabı", [
            "CASH_SAFE",
            "BANK",
          ] as const)
        : null;
      if (refund && body.moneyConfirmed !== true)
        fail(
          "REFUND_CONFIRMATION_REQUIRED",
          sale
            ? "Para iadesini gerçekleştirdiğinizi teyit edin."
            : "Tedarikçiden iade parasını aldığınızı teyit edin.",
          409
        );
      if (
        sale &&
        refund &&
        (await accountBalance(c, station, wallet!)) < refund
      )
        fail(
          "INSUFFICIENT_BALANCE",
          "Para iadesi için seçilen merkez kasa/banka bakiyesi yetersiz.",
          409
        );
      const doc = source.document;
      if (
        credited &&
        (!doc ||
          (sale
            ? await accountBalance(c, station, "RECEIVABLE", doc.party_id)
            : -(await accountBalance(c, station, "PAYABLE", doc.party_id))) <
            credited)
      )
        fail(
          "MARKET_PARTY_MISMATCH",
          "Cari belge ve defter bakiyesi uyuşmuyor.",
          409
        );
      const id = randomUUID();
      for (const l of lines) {
        const product = (await first<Row>(
          c,
          "SELECT * FROM st_products WHERE id=? AND station_id=? AND tenant_id=? FOR UPDATE",
          [l.productId, station, scope.tenantId]
        ))!;
        const inv = await inventoryRow(c, book!, product),
          sign = sale ? 1 : -1;
        await returnLots(c, product, l.quantity, id, actor.id, sale, l.lots);
        const quantity = safeAdd(integer(inv.quantity), sign * l.quantity),
          value = safeAdd(integer(inv.value_minor), sign * l.costMinor);
        if (quantity < 0 || value < 0)
          fail("NEGATIVE_INVENTORY", "İade stok maliyetini aşıyor.", 409);
        await execute(
          c,
          "UPDATE st_market_inventory SET quantity=?,value_minor=? WHERE product_id=?",
          [quantity, value, l.productId]
        );
        await execute(
          c,
          "UPDATE st_products SET stock_qty=?,purchase_price_minor=?,stock_version=stock_version+1 WHERE id=?",
          [quantity, quantity ? ratioRound(value, 1, quantity) : 0, l.productId]
        );
        await execute(
          c,
          "INSERT INTO st_stock_movements(id,tenant_id,station_id,product_id,kind,quantity,unit_price_minor,reference,created_by_user_id) VALUES (?,?,?,?,?,?,?,?,?)",
          [
            randomUUID(),
            scope.tenantId,
            station,
            l.productId,
            kind,
            l.quantity,
            0,
            `MARKET-RETURN:${id}`,
            actor.id,
          ]
        );
      }
      const ledger: LedgerLine[] = sale
        ? [
            { account: "SALES_RETURNS", debit: net },
            { account: "OUTPUT_VAT", debit: vat },
            { account: "RECEIVABLE", partyId: doc?.party_id, credit: credited },
            ...(wallet ? [{ account: wallet, credit: refund }] : []),
            { account: "INVENTORY", debit: cost },
            { account: "COGS", credit: cost },
          ]
        : [
            { account: "PAYABLE", partyId: doc?.party_id, debit: credited },
            ...(wallet ? [{ account: wallet, debit: refund }] : []),
            { account: "INVENTORY", credit: cost },
            { account: "INPUT_VAT", credit: vat },
            {
              account: "PURCHASE_RETURN_VARIANCE",
              debit: Math.max(0, cost - net),
              credit: Math.max(0, net - cost),
            },
          ];
      const entry = await ledgerEntry(
        c,
        book!,
        actor.id,
        kind,
        id,
        reason,
        ledger,
        {
          sourceEntryId: source.summary.id,
          sourceReference: source.summary.reference,
          items: lines,
          netMinor: net,
          vatMinor: vat,
          creditedMinor: credited,
          refundMinor: refund,
          wallet,
        },
        reference
      );
      if (credited)
        await execute(
          c,
          "UPDATE st_market_documents SET credited_minor=credited_minor+? WHERE id=?",
          [credited, doc!.id]
        );
      await execute(
        c,
        "INSERT INTO st_market_returns(id,tenant_id,station_id,source_entry_id,entry_id,document_id,kind,reference,reason,net_minor,vat_minor,gross_minor,cost_minor,credited_minor,refund_minor,wallet) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        [
          id,
          scope.tenantId,
          station,
          source.summary.id,
          entry,
          doc?.id ?? null,
          kind,
          reference,
          reason,
          net,
          vat,
          gross,
          cost,
          credited,
          refund,
          wallet,
        ]
      );
      for (const l of lines)
        await execute(
          c,
          "INSERT INTO st_market_return_lines(return_id,product_id,quantity,gross_minor,net_minor,vat_minor,cost_minor) VALUES (?,?,?,?,?,?,?)",
          [
            id,
            l.productId,
            l.quantity,
            l.grossMinor,
            l.netMinor,
            l.vatMinor,
            l.costMinor,
          ]
        );
      return {
        id,
        entryId: entry,
        totalMinor: gross,
        creditedMinor: credited,
        refundMinor: refund,
      };
    }
  );
}

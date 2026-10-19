import { randomUUID } from "node:crypto";
import type { Express } from "express";
import type { MarketPost } from "./market-route-types";
import type { Services, Row } from "./market-pos";
import type { PoolConnection } from "mysql2/promise";
import { first, rows, execute, withTransaction } from "./db";
import {
  requireId,
  requireInteger,
  requireMoney,
  requireString,
  requireEnum,
} from "./domain";
import {
  businessToday,
  integer,
  calendarDate,
  stockCost,
  ratioRound,
} from "./market-accounting-domain";
import { inventoryRow, ledgerEntry } from "./market-accounting-ledger";
import { lotInput } from "./lot-domain";
import { lockedLots, addLot, lotEvent } from "./lot-stock";
import { safeAdd, rejectCardData } from "./safety";
import { fail, type StationRole } from "./types";
import type { LotState } from "../../shared/lots";
const READ: StationRole[] = ["OWNER", "MANAGER", "ACCOUNTANT"];
const prefix = "/api/stationos/market-accounting/inventory/lots";
async function product(
  c: PoolConnection,
  station: string,
  body: Record<string, unknown>,
  book: Row
) {
  if (
    requireInteger(body.expectedRevision, "Defter sürümü", {
      allowZero: true,
    }) !== integer(book.revision)
  )
    fail("REPORT_CHANGED", "Defter değişti; önizlemeyi yenileyin.", 409);
  const p = await first<Row>(
    c,
    "SELECT * FROM st_products WHERE id=? AND station_id=? FOR UPDATE",
    [requireId(body.productId, "productId"), station]
  );
  if (!p) fail("NOT_FOUND", "Ürün bulunamadı.", 404);
  if (
    requireInteger(body.expectedVersion, "Stok sürümü", { allowZero: true }) !==
    integer(p.stock_version)
  )
    fail("STOCK_CHANGED", "Stok/parti değişti; önizlemeyi yenileyin.", 409);
  return p;
}
const reason = (body: Record<string, unknown>) => {
  const text = requireString(body.reason, "Açıklama", { min: 5, max: 500 });
  rejectCardData(text);
  return text;
};
export function registerInventoryLots(
  app: Express,
  services: Services,
  post: MarketPost
) {
  app.get(prefix, async (req, res) => {
    try {
      const actor = services.actor(req),
        station = requireId(req.query.stationId, "stationId"),
        selected = req.query.productId
          ? requireId(req.query.productId, "productId")
          : null,
        offset = req.query.offset === undefined ? 0 : Number(req.query.offset);
      if (!Number.isSafeInteger(offset) || offset < 0 || offset > 1000000)
        fail("INVALID_INPUT", "Sayfa geçersiz.");
      res.json(
        await withTransaction(async c => {
          const { scope } = await services.requireStation(
              c,
              actor,
              station,
              READ
            ),
            today = businessToday();
          const book = await first<Row>(
            c,
            "SELECT * FROM st_market_books WHERE station_id=? AND tenant_id=?",
            [station, scope.tenantId]
          );
          const products = await rows<Row[]>(
            c,
            `SELECT p.*,i.value_minor,COALESCE(a.saleable,0) AS saleable FROM st_products p LEFT JOIN st_market_inventory i ON i.product_id=p.id LEFT JOIN (SELECT product_id,SUM(CASE WHEN status='AVAILABLE' AND expiry_date>=? THEN quantity ELSE 0 END) AS saleable FROM st_inventory_lots WHERE station_id=? GROUP BY product_id) a ON a.product_id=p.id WHERE p.station_id=? AND p.tenant_id=? ORDER BY p.name LIMIT 5000`,
            [today, station, station, scope.tenantId]
          );
          if (selected && !products.some(p => p.id === selected))
            fail("NOT_FOUND", "Ürün bu istasyonda yok.", 404);
          const filter = selected ? " AND l.product_id=?" : "",
            params = selected ? [station, selected] : [station];
          const sums = await first<Row>(
            c,
            `SELECT COUNT(*) AS n,COALESCE(SUM(CASE WHEN l.expiry_date<? THEN l.quantity ELSE 0 END),0) AS expired,COALESCE(SUM(CASE WHEN l.status='AVAILABLE' AND l.expiry_date>=? AND l.expiry_date<=DATE_ADD(?,INTERVAL 30 DAY) THEN l.quantity ELSE 0 END),0) AS near_qty,COALESCE(SUM(CASE WHEN l.status='QUARANTINE' THEN l.quantity ELSE 0 END),0) AS quarantine FROM st_inventory_lots l WHERE l.station_id=?${filter}`,
            [today, today, today, ...params]
          );
          const lots = await rows<Row[]>(
            c,
            `SELECT l.*,p.name AS product_name FROM st_inventory_lots l JOIN st_products p ON p.id=l.product_id WHERE l.station_id=?${filter} ORDER BY l.quantity>0 DESC,l.expiry_date IS NULL,l.expiry_date,l.received_at,l.id LIMIT 200 OFFSET ${offset}`,
            params
          );
          const events = await rows<Row[]>(
            c,
            `SELECT e.*,p.name AS product_name,u.name AS actor_name FROM st_inventory_lot_events e JOIN st_products p ON p.id=e.product_id JOIN users u ON u.id=e.actor_user_id WHERE e.station_id=?${selected ? " AND e.product_id=?" : ""} ORDER BY e.id DESC LIMIT 100`,
            params
          );
          return {
            today,
            revision: integer(book?.revision),
            closedToday:
              !!book?.closed_through && String(book.closed_through) >= today,
            enabled: !!book,
            total: integer(sums?.n),
            offset,
            limit: 200,
            expiredQty: integer(sums?.expired),
            nearQty: integer(sums?.near_qty),
            quarantineQty: integer(sums?.quarantine),
            products: products.map(p => ({
              id: p.id,
              name: p.name,
              barcode: p.barcode,
              quantity: integer(p.stock_qty),
              valueMinor: integer(p.value_minor),
              stockVersion: integer(p.stock_version),
              tracking: !!p.lot_tracking,
              saleableQty: p.lot_tracking
                ? integer(p.saleable)
                : integer(p.stock_qty),
            })),
            lots: lots.map(l => ({
              id: l.id,
              productId: l.product_id,
              productName: l.product_name,
              code: l.code,
              expiryDate: l.expiry_date,
              status: l.status,
              quantity: integer(l.quantity),
              receivedAt: l.received_at,
              originKind: l.origin_kind,
              originId: l.origin_id,
              saleable:
                l.status === "AVAILABLE" &&
                !!l.expiry_date &&
                l.expiry_date >= today,
              daysLeft: l.expiry_date
                ? Math.round(
                    (Date.parse(l.expiry_date + "T12:00:00Z") -
                      Date.parse(today + "T12:00:00Z")) /
                      86400000
                  )
                : null,
            })),
            events: events.map(e => {
              const d =
                typeof e.detail_json === "string"
                  ? JSON.parse(e.detail_json)
                  : e.detail_json;
              const label = (x: any) =>
                x && typeof x === "object" && typeof x.code === "string"
                  ? `${x.code} · SKT ${x.expiryDate ?? "bilinmiyor"} · ${x.status === "AVAILABLE" ? "Satışa açık" : "Karantina"}`
                  : null;
              return {
                id: integer(e.id),
                lotId: e.lot_id,
                sourceId: e.source_id,
                productName: e.product_name,
                kind: e.kind,
                delta: integer(e.delta),
                actorName: e.actor_name,
                createdAt: e.created_at,
                note: d?.reason ?? null,
                beforeLabel: label(d?.before),
                afterLabel: label(d?.after ?? d),
              };
            }),
          } satisfies LotState;
        })
      );
    } catch (e) {
      services.error(res, e);
    }
  });
  post(
    "inventory/lot-enable",
    READ,
    async (c, actor, body, _scope, station, book) => {
      const p = await product(c, station, body, book!);
      if (p.lot_tracking)
        fail("LOT_ALREADY_ENABLED", "Parti takibi zaten açık.", 409);
      await inventoryRow(c, book!, p);
      const note = reason(body);
      await lotEvent(
        c,
        p,
        null,
        "ENABLE",
        requireId(body.requestId, "requestId"),
        0,
        actor.id,
        { reason: note }
      );
      for (const l of lotInput(
        body.lots,
        integer(p.stock_qty),
        businessToday(),
        true
      ))
        await addLot(
          c,
          p,
          l,
          "OPENING",
          requireId(body.requestId, "requestId"),
          actor.id
        );
      await execute(
        c,
        "UPDATE st_products SET lot_tracking=TRUE,stock_version=stock_version+1 WHERE id=?",
        [p.id]
      );
      await lotRevision(c, book!);
      return { id: p.id, note };
    }
  );
  post(
    "inventory/lot-status",
    READ,
    async (c, actor, body, _scope, station, book) => {
      const p = await product(c, station, body, book!);
      if (!p.lot_tracking)
        fail("LOT_TRACKING_DISABLED", "Parti takibi kapalı.", 409);
      const lots = await lockedLots(c, p),
        id = requireId(body.lotId, "lotId"),
        l = lots.find(l => l.id === id);
      if (!l || !integer(l.quantity))
        fail("NOT_FOUND", "Stoklu parti bulunamadı.", 404);
      const note = reason(body),
        status = requireEnum(body.status, "Parti durumu", [
          "AVAILABLE",
          "QUARANTINE",
        ] as const),
        code = requireString(body.code, "Parti kodu", { max: 100 }),
        expiry = body.expiryDate ? calendarDate(body.expiryDate, "SKT") : null;
      if (status === "AVAILABLE" && (!expiry || expiry < businessToday()))
        fail(
          "LOT_EXPIRY_REQUIRED",
          "Satışa açmak için geçerli SKT ve fizikî kontrol gerekir."
        );
      if (body.inspectionAccepted !== true)
        fail(
          "LOT_INSPECTION_REQUIRED",
          "Parti etiketi ve fizikî uygunluk kontrolünü teyit edin.",
          409
        );
      await execute(
        c,
        "UPDATE st_inventory_lots SET code=?,expiry_date=?,status=? WHERE id=?",
        [code, expiry, status, id]
      );
      await execute(
        c,
        "UPDATE st_products SET stock_version=stock_version+1 WHERE id=?",
        [p.id]
      );
      await lotRevision(c, book!);
      await lotEvent(
        c,
        p,
        id,
        "STATUS",
        requireId(body.requestId, "requestId"),
        0,
        actor.id,
        {
          reason: note,
          inspectionAccepted: true,
          before: { code: l.code, expiryDate: l.expiry_date, status: l.status },
          after: { code, expiryDate: expiry, status },
        }
      );
      return { id };
    }
  );
  post(
    "inventory/lot-adjust",
    READ,
    async (c, actor, body, scope, station, book) => {
      const p = await product(c, station, body, book!);
      if (!p.lot_tracking)
        fail("LOT_TRACKING_DISABLED", "Parti takibi kapalı.", 409);
      const lots = await lockedLots(c, p),
        id = requireId(body.lotId, "lotId"),
        l = lots.find(l => l.id === id);
      if (!l) fail("NOT_FOUND", "Parti bulunamadı.", 404);
      const mode = requireEnum(body.mode, "İşlem", [
          "COUNT",
          "WRITE_OFF",
        ] as const),
        note = reason(body),
        before = integer(l.quantity),
        after =
          mode === "COUNT"
            ? requireInteger(body.countedQty, "Sayılan parti adedi", {
                allowZero: true,
              })
            : before - requireInteger(body.quantity, "Fire adedi");
      if (after < 0 || after > 1000000000)
        fail(
          "LOT_QUANTITY_LIMIT",
          "Parti adedi mevcut stoğu/sınırı aşıyor.",
          409
        );
      const delta = after - before;
      if (!delta) fail("NO_CHANGE", "Parti sayımında fark yok.", 409);
      const inv = await inventoryRow(c, book!, p),
        unit =
          delta > 0
            ? requireMoney(body.unitNetMinor, "Fazla stok net maliyeti", {
                allowZero: true,
              })
            : 0;
      if (delta > 0 && unit === 0 && body.zeroCostAccepted !== true)
        fail(
          "ZERO_COST_CONFIRMATION",
          "Sıfır maliyetli fazlalığı teyit edin.",
          409
        );
      const amount =
        delta > 0
          ? delta * unit
          : stockCost(integer(inv.value_minor), integer(inv.quantity), -delta);
      requireMoney(amount, "Parti farkı maliyeti", { allowZero: true });
      if (
        requireMoney(body.expectedCostMinor, "Maliyet önizleme", {
          allowZero: true,
        }) !== amount
      )
        fail("COUNT_TOTAL_CHANGED", "Maliyet önizlemesi değişti.", 409);
      const qty = safeAdd(integer(p.stock_qty), delta),
        value = safeAdd(integer(inv.value_minor), delta > 0 ? amount : -amount);
      await execute(c, "UPDATE st_inventory_lots SET quantity=? WHERE id=?", [
        after,
        id,
      ]);
      await execute(
        c,
        "UPDATE st_products SET stock_qty=?,purchase_price_minor=?,stock_version=stock_version+1 WHERE id=?",
        [qty, qty ? ratioRound(value, 1, qty) : 0, p.id]
      );
      await execute(
        c,
        "UPDATE st_market_inventory SET quantity=?,value_minor=? WHERE product_id=?",
        [qty, value, p.id]
      );
      const source = requireId(body.requestId, "requestId"),
        kind = mode === "COUNT" ? "LOT_COUNT" : "LOT_WRITE_OFF";
      const entry = await ledgerEntry(
        c,
        book!,
        actor.id,
        kind,
        source,
        note,
        delta > 0
          ? [
              { account: "INVENTORY", debit: amount },
              { account: "STOCK_GAIN", credit: amount },
            ]
          : [
              { account: "STOCK_LOSS", debit: amount },
              { account: "INVENTORY", credit: amount },
            ],
        { productId: p.id, lotId: id, before, after, valueMinor: amount }
      );
      await execute(
        c,
        "INSERT INTO st_stock_movements(id,tenant_id,station_id,product_id,kind,quantity,unit_price_minor,reference,created_by_user_id) VALUES (?,?,?,?,'ADJUSTMENT',?,0,?,?)",
        [
          randomUUID(),
          scope.tenantId,
          station,
          p.id,
          delta,
          "LOT:" + entry,
          actor.id,
        ]
      );
      await lotEvent(c, p, id, kind, source, delta, actor.id, {
        reason: note,
        before,
        after,
        valueMinor: amount,
      });
      return { id: entry };
    }
  );
}
async function lotRevision(c: PoolConnection, book: Row) {
  await execute(
    c,
    "UPDATE st_market_books SET revision=revision+1 WHERE station_id=?",
    [book.station_id]
  );
}

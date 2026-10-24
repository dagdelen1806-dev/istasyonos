import { randomUUID } from "node:crypto";
import type { Express } from "express";
import type { PoolConnection } from "mysql2/promise";
import type { Services, Row } from "./market-pos";
import type { MarketPost } from "./market-route-types";
import { execute, rows, first, withTransaction } from "./db";
import {
  isRecord,
  requireId,
  requireString,
  requireInteger,
  requireMoney,
  requireEnum,
} from "./domain";
import {
  businessToday,
  calendarDate,
  integer,
  vatRate,
} from "./market-accounting-domain";
import { fail, type StationRole } from "./types";
import { rejectCardData } from "./safety";
import { recordMarketPurchase } from "./market-purchase";
import {
  orderTotals,
  type OrderSummary,
  type OrderDetail,
  type OrderPage,
} from "../../shared/purchase-order";
const READ: StationRole[] = ["OWNER", "MANAGER", "ACCOUNTANT"],
  APPROVE: StationRole[] = ["OWNER", "MANAGER"];
const parse = (v: any) => (typeof v === "string" ? JSON.parse(v) : v);
const total = (
  lines: { quantity: number; unitNetMinor: number; vatBps: number }[]
) => {
  try {
    return orderTotals(lines);
  } catch (e) {
    fail("INVALID_ORDER", (e as Error).message);
  }
};
const note = (v: unknown) => {
  const n = requireString(v, "Açıklama", { min: 5, max: 500 });
  rejectCardData(n);
  return n;
};
async function supplier(c: PoolConnection, station: string, value: unknown) {
  const id = requireId(value, "supplierId"),
    p = await first<Row>(
      c,
      "SELECT * FROM st_market_parties WHERE id=? AND station_id=? AND kind IN ('SUPPLIER','BOTH')",
      [id, station]
    );
  if (!p)
    fail("NOT_FOUND", "Sipariş tedarikçisi bu istasyonda bulunamadı.", 404);
  return p;
}
async function lockedOrder(
  c: PoolConnection,
  station: string,
  body: Record<string, unknown>
) {
  const id = requireId(body.orderId, "orderId"),
    o = await first<Row>(
      c,
      "SELECT * FROM st_purchase_orders WHERE id=? AND station_id=? FOR UPDATE",
      [id, station]
    );
  if (!o) fail("NOT_FOUND", "Sipariş bu istasyonda bulunamadı.", 404);
  if (
    integer(o.version) !==
    requireInteger(body.orderVersion, "Sipariş sürümü", { allowZero: true })
  )
    fail("ORDER_CHANGED", "Sipariş değişti; güncel siparişi yenileyin.", 409);
  return o;
}
async function orderLines(c: PoolConnection, id: string, lock = false) {
  return rows<Row[]>(
    c,
    "SELECT * FROM st_purchase_order_lines WHERE order_id=? ORDER BY product_id" +
      (lock ? " FOR UPDATE" : ""),
    [id]
  );
}
async function event(
  c: PoolConnection,
  id: string,
  actor: number,
  kind: string,
  detail: unknown
) {
  await execute(
    c,
    "INSERT INTO st_purchase_order_events(order_id,kind,actor_user_id,detail_json) VALUES (?,?,?,?)",
    [id, kind, actor, JSON.stringify(detail)]
  );
}
async function touch(c: PoolConnection, id: string, status?: string) {
  await execute(
    c,
    "UPDATE st_purchase_orders SET version=version+1,updated_at=UTC_TIMESTAMP(3)" +
      (status ? ",status=?" : "") +
      " WHERE id=?",
    status ? [status, id] : [id]
  );
}
async function plan(c: PoolConnection, station: string, input: unknown) {
  if (!Array.isArray(input) || !input.length || input.length > 100)
    fail("INVALID_ORDER", "Sipariş 1–100 ürün satırı içermeli.");
  const seen = new Set<string>(),
    items = [];
  for (const raw of input) {
    if (!isRecord(raw)) fail("INVALID_ORDER", "Sipariş satırı geçersiz.");
    const productId = requireId(raw.productId, "productId"),
      quantity = requireInteger(raw.quantity, "Sipariş miktarı"),
      unitNetMinor = requireMoney(raw.unitNetMinor, "Net sipariş fiyatı", {
        allowZero: true,
      }),
      vatBps = vatRate(raw.vatBps);
    if (quantity > 1000000000 || seen.has(productId))
      fail(
        "INVALID_ORDER",
        "Sipariş ürünü tekrarlı veya miktar sınırı aşılmış."
      );
    seen.add(productId);
    const p = await first<Row>(
      c,
      "SELECT id,name,barcode,base_unit FROM st_products WHERE id=? AND station_id=?",
      [productId, station]
    );
    if (!p) fail("NOT_FOUND", "Sipariş ürünü bu istasyonda bulunamadı.", 404);
    items.push({
      productId,
      name: p.name,
      barcode: p.barcode,
      unit: p.base_unit,
      quantity,
      unitNetMinor,
      vatBps,
    });
  }
  if (!total(items).grossMinor)
    fail("INVALID_ORDER", "Sipariş toplamı sıfır olamaz.");
  return items.sort((a, b) => a.productId.localeCompare(b.productId));
}
async function saveLines(
  c: PoolConnection,
  id: string,
  items: Awaited<ReturnType<typeof plan>>
) {
  await execute(c, "DELETE FROM st_purchase_order_lines WHERE order_id=?", [
    id,
  ]);
  for (const l of items)
    await execute(
      c,
      "INSERT INTO st_purchase_order_lines(order_id,product_id,product_name,barcode,base_unit,ordered_qty,unit_net_minor,vat_bps) VALUES (?,?,?,?,?,?,?,?)",
      [
        id,
        l.productId,
        l.name,
        l.barcode,
        l.unit,
        l.quantity,
        l.unitNetMinor,
        l.vatBps,
      ]
    );
}
async function summary(c: PoolConnection, o: Row): Promise<OrderSummary> {
  const ls = await orderLines(c, o.id),
    pending = ls.map(l => ({
      quantity: integer(l.ordered_qty) - integer(l.received_qty),
      unitNetMinor: integer(l.unit_net_minor),
      vatBps: integer(l.vat_bps),
    })),
    active = ["APPROVED", "PARTIAL"].includes(o.status);
  return {
    id: o.id,
    number: String(o.seq),
    label: o.label,
    supplierId: o.supplier_id,
    supplierName: o.supplier_name,
    expectedDate: o.expected_date,
    status: o.status,
    version: integer(o.version),
    orderedQty: ls.reduce((n, l) => n + integer(l.ordered_qty), 0),
    receivedQty: ls.reduce((n, l) => n + integer(l.received_qty), 0),
    remainingQty: pending.reduce((n, l) => n + l.quantity, 0),
    remainingGrossMinor: total(pending).grossMinor,
    overdue: active && o.expected_date < businessToday(),
    createdAt: o.created_at,
    updatedAt: o.updated_at,
  };
}
export function registerPurchaseOrders(
  app: Express,
  services: Services,
  post: MarketPost
) {
  app.get(
    "/api/stationos/market-accounting/inventory/orders",
    async (req, res) => {
      try {
        const actor = services.actor(req),
          station = requireId(req.query.stationId, "stationId"),
          status = requireEnum(req.query.status ?? "OPEN", "status", [
            "OPEN",
            "ALL",
            "DRAFT",
            "APPROVED",
            "PARTIAL",
            "RECEIVED",
            "CLOSED",
            "CANCELLED",
          ] as const);
        let cursor: string | null = null;
        if (req.query.cursor) {
          cursor = requireString(req.query.cursor, "cursor", { max: 20 });
          if (
            !/^[1-9]\d{0,19}$/.test(cursor) ||
            BigInt(cursor) > 18446744073709551615n
          )
            fail("INVALID_CURSOR", "Sipariş imleci geçersiz.");
        }
        res.json(
          await withTransaction(async c => {
            const { scope } = await services.requireStation(
              c,
              actor,
              station,
              READ
            );
            const selected = await rows<Row[]>(
              c,
              `SELECT * FROM st_purchase_orders WHERE tenant_id=? AND station_id=? ${status === "OPEN" ? "AND status IN ('DRAFT','APPROVED','PARTIAL')" : status === "ALL" ? "" : "AND status=?"} ${cursor ? "AND seq<?" : ""} ORDER BY seq DESC LIMIT 51`,
              [
                scope.tenantId,
                station,
                ...(!["OPEN", "ALL"].includes(status) ? [status] : []),
                ...(cursor ? [cursor] : []),
              ]
            );
            const page = selected.slice(0, 50);
            return {
              rows: await Promise.all(page.map(o => summary(c, o))),
              nextCursor:
                selected.length > 50 ? String(page.at(-1)!.seq) : null,
            } satisfies OrderPage;
          })
        );
      } catch (e) {
        services.error(res, e);
      }
    }
  );
  app.get(
    "/api/stationos/market-accounting/inventory/orders/:orderId",
    async (req, res) => {
      try {
        const actor = services.actor(req),
          station = requireId(req.query.stationId, "stationId"),
          id = requireId(req.params.orderId, "orderId");
        res.json(
          await withTransaction(async c => {
            const { scope } = await services.requireStation(
                c,
                actor,
                station,
                READ
              ),
              o = await first<Row>(
                c,
                "SELECT o.*,u.name AS creator_name,a.name AS approver_name FROM st_purchase_orders o JOIN users u ON u.id=o.created_by_user_id LEFT JOIN users a ON a.id=o.approved_by_user_id WHERE o.id=? AND o.station_id=? AND o.tenant_id=?",
                [id, station, scope.tenantId]
              );
            if (!o) fail("NOT_FOUND", "Sipariş bu istasyonda bulunamadı.", 404);
            const ls = await rows<Row[]>(
                c,
                "SELECT l.*,p.lot_tracking FROM st_purchase_order_lines l JOIN st_products p ON p.id=l.product_id WHERE l.order_id=? ORDER BY l.product_name",
                [id]
              ),
              receipts = await rows<Row[]>(
                c,
                "SELECT r.*,u.name AS actor_name FROM st_purchase_order_receipts r JOIN users u ON u.id=r.received_by_user_id WHERE r.order_id=? ORDER BY r.created_at DESC,r.purchase_id DESC LIMIT 100",
                [id]
              ),
              count = await first<Row>(
                c,
                "SELECT COUNT(*) AS n FROM st_purchase_order_receipts WHERE order_id=?",
                [id]
              ),
              events = await rows<Row[]>(
                c,
                "SELECT e.*,u.name AS actor_name FROM st_purchase_order_events e JOIN users u ON u.id=e.actor_user_id WHERE e.order_id=? ORDER BY e.id DESC LIMIT 100",
                [id]
              );
            return {
              ...(await summary(c, o)),
              createdBy: o.creator_name,
              approvedBy: o.approver_name ?? null,
              lines: ls.map(l => ({
                productId: l.product_id,
                name: l.product_name,
                barcode: l.barcode,
                unit: l.base_unit,
                orderedQty: integer(l.ordered_qty),
                receivedQty: integer(l.received_qty),
                remainingQty: integer(l.ordered_qty) - integer(l.received_qty),
                unitNetMinor: integer(l.unit_net_minor),
                vatBps: integer(l.vat_bps),
                lotTracking: !!l.lot_tracking,
              })),
              receiptCount: integer(count?.n),
              receipts: receipts.map(r => ({
                purchaseId: r.purchase_id,
                entryId: r.entry_id,
                approvedVersion: integer(r.approved_version),
                reference: r.reference,
                dueDate: r.due_date,
                totalMinor: integer(r.total_minor),
                receivedBy: r.actor_name,
                createdAt: r.created_at,
                items: parse(r.items_json),
              })),
              events: events.map(e => ({
                id: integer(e.id),
                kind: e.kind,
                actorName: e.actor_name,
                createdAt: e.created_at,
                reason: parse(e.detail_json).reason ?? null,
              })),
            } satisfies OrderDetail;
          })
        );
      } catch (e) {
        services.error(res, e);
      }
    }
  );
  post(
    "inventory/order-save",
    READ,
    async (c, actor, body, scope, station) => {
      const old = body.orderId ? await lockedOrder(c, station, body) : null;
      if (old && old.status !== "DRAFT")
        fail("ORDER_NOT_DRAFT", "Yalnız taslak sipariş düzenlenebilir.", 409);
      const p = await supplier(c, station, body.supplierId),
        items = await plan(c, station, body.lines),
        label = requireString(body.label, "Sipariş adı", { max: 100 }),
        date = calendarDate(body.expectedDate, "Beklenen teslim"),
        id =
          old?.id ??
          (body.newOrderId
            ? requireId(body.newOrderId, "newOrderId")
            : randomUUID());
      const before = old
        ? { header: old, lines: await orderLines(c, id) }
        : null;
      if (!old) {
        const count = await first<Row>(
          c,
          "SELECT COUNT(*) AS n FROM st_purchase_orders WHERE station_id=? AND status IN ('DRAFT','APPROVED','PARTIAL')",
          [station]
        );
        if (integer(count?.n) >= 1000)
          fail("ORDER_LIMIT", "1.000 açık sipariş sınırı dolu.", 409);
        await execute(
          c,
          "INSERT INTO st_purchase_orders(id,tenant_id,station_id,supplier_id,supplier_name,label,expected_date,created_by_user_id) VALUES (?,?,?,?,?,?,?,?)",
          [id, scope.tenantId, station, p.id, p.name, label, date, actor.id]
        );
      } else {
        await execute(
          c,
          "UPDATE st_purchase_orders SET supplier_id=?,supplier_name=?,label=?,expected_date=? WHERE id=?",
          [p.id, p.name, label, date, id]
        );
        await touch(c, id);
      }
      await saveLines(c, id, items);
      await event(c, id, actor.id, old ? "EDIT" : "CREATE", {
        before,
        after: {
          supplierId: p.id,
          supplierName: p.name,
          label,
          expectedDate: date,
          items,
        },
      });
      return { id };
    },
    true,
    true
  );
  post(
    "inventory/order-approve",
    APPROVE,
    async (c, actor, body, _scope, station) => {
      const o = await lockedOrder(c, station, body);
      if (o.status !== "DRAFT")
        fail("ORDER_NOT_DRAFT", "Yalnız taslak sipariş onaylanabilir.", 409);
      await supplier(c, station, o.supplier_id);
      const lines = await orderLines(c, o.id, true),
        expected = total(
          lines.map(l => ({
            quantity: integer(l.ordered_qty),
            unitNetMinor: integer(l.unit_net_minor),
            vatBps: integer(l.vat_bps),
          }))
        ).grossMinor;
      if (
        requireMoney(body.expectedTotalMinor, "Sipariş onay toplamı") !==
        expected
      )
        fail("ORDER_TOTAL_CHANGED", "Sipariş onay toplamı değişti.", 409);
      const reason = note(body.reason);
      await execute(
        c,
        "UPDATE st_purchase_orders SET approved_by_user_id=? WHERE id=?",
        [actor.id, o.id]
      );
      await touch(c, o.id, "APPROVED");
      await event(c, o.id, actor.id, "APPROVE", {
        reason,
        version: integer(o.version),
        expectedTotalMinor: expected,
        lines,
      });
      return { id: o.id };
    },
    true,
    true
  );
  post(
    "inventory/order-reprice",
    APPROVE,
    async (c, actor, body, _scope, station) => {
      const o = await lockedOrder(c, station, body);
      if (!["APPROVED", "PARTIAL"].includes(o.status))
        fail(
          "ORDER_NOT_OPEN",
          "Yalnız teslimatı beklenen onaylı sipariş revize edilebilir.",
          409
        );
      const reason = note(body.reason),
        ls = await orderLines(c, o.id, true),
        remaining = ls.filter(
          l => integer(l.ordered_qty) > integer(l.received_qty)
        );
      if (!Array.isArray(body.lines) || body.lines.length !== remaining.length)
        fail(
          "ORDER_LINES_CHANGED",
          "Kalan bütün sipariş satırlarının fiyatını tamamlayın.",
          409
        );
      const seen = new Set<string>(),
        after = [];
      for (const raw of body.lines) {
        if (!isRecord(raw)) fail("INVALID_INPUT", "Fiyat satırı geçersiz.");
        const id = requireId(raw.productId, "productId"),
          l = remaining.find(l => l.product_id === id);
        if (!l || seen.has(id))
          fail(
            "ORDER_LINES_CHANGED",
            "Fiyat satırı tekrarlı veya teslimatı tamamlanmış."
          );
        seen.add(id);
        const unitNetMinor = requireMoney(raw.unitNetMinor, "Yeni net fiyat", {
            allowZero: true,
          }),
          vatBps = vatRate(raw.vatBps);
        after.push({
          productId: id,
          quantity: integer(l.ordered_qty) - integer(l.received_qty),
          unitNetMinor,
          vatBps,
        });
      }
      if (
        requireMoney(body.expectedTotalMinor, "Kalan sipariş toplamı") !==
        total(after).grossMinor
      )
        fail("ORDER_TOTAL_CHANGED", "Kalan sipariş toplamı değişti.", 409);
      for (const l of after)
        await execute(
          c,
          "UPDATE st_purchase_order_lines SET unit_net_minor=?,vat_bps=? WHERE order_id=? AND product_id=?",
          [l.unitNetMinor, l.vatBps, o.id, l.productId]
        );
      const date = calendarDate(body.expectedDate, "Beklenen teslim");
      await execute(
        c,
        "UPDATE st_purchase_orders SET expected_date=? WHERE id=?",
        [date, o.id]
      );
      await touch(c, o.id);
      await event(c, o.id, actor.id, "REPRICE", {
        reason,
        before: ls,
        after,
        expectedDate: date,
        version: integer(o.version),
      });
      return { id: o.id };
    },
    true,
    true
  );
  post(
    "inventory/order-close",
    APPROVE,
    async (c, actor, body, _scope, station) => {
      const o = await lockedOrder(c, station, body);
      if (!["DRAFT", "APPROVED", "PARTIAL"].includes(o.status))
        fail("ORDER_NOT_OPEN", "Sipariş zaten kapalı.", 409);
      const reason = note(body.reason);
      await touch(c, o.id, o.status === "PARTIAL" ? "CLOSED" : "CANCELLED");
      await event(c, o.id, actor.id, "CLOSE", {
        reason,
        previousStatus: o.status,
        lines: await orderLines(c, o.id),
      });
      return { id: o.id };
    },
    true,
    true
  );
  post(
    "inventory/order-receive",
    READ,
    async (c, actor, body, scope, station, book) => {
      const o = await lockedOrder(c, station, body);
      if (!["APPROVED", "PARTIAL"].includes(o.status))
        fail(
          "ORDER_NOT_APPROVED",
          "Mal kabul için açık ve onaylı sipariş gerekir.",
          409
        );
      if (
        requireInteger(body.expectedRevision, "Defter sürümü", {
          allowZero: true,
        }) !== integer(book!.revision)
      )
        fail(
          "REPORT_CHANGED",
          "Mali defter değişti; kabul önizlemesini yenileyin.",
          409
        );
      if (
        !Array.isArray(body.lines) ||
        !body.lines.length ||
        body.lines.length > 100
      )
        fail("INVALID_ORDER", "Teslimat 1–100 ürün satırı içermeli.");
      if (body.deliveryAccepted !== true)
        fail(
          "DELIVERY_CONFIRMATION",
          "Teslim alınan gerçek adet ve belgeyi teyit edin.",
          409
        );
      const ls = await orderLines(c, o.id, true),
        seen = new Set<string>(),
        received = [];
      for (const raw of body.lines) {
        if (!isRecord(raw)) fail("INVALID_INPUT", "Teslimat satırı geçersiz.");
        const id = requireId(raw.productId, "productId"),
          l = ls.find(l => l.product_id === id),
          qty = requireInteger(raw.quantity, "Teslim alınan adet");
        if (
          !l ||
          seen.has(id) ||
          qty > integer(l.ordered_qty) - integer(l.received_qty) ||
          qty > 10000
        )
          fail(
            "ORDER_QUANTITY",
            "Teslimat kalan siparişi aşıyor, tekrarlı veya farklı ürüne ait.",
            409
          );
        seen.add(id);
        if (
          requireMoney(raw.unitNetMinor, "Fatura net maliyeti", {
            allowZero: true,
          }) !== integer(l.unit_net_minor) ||
          vatRate(raw.vatBps) !== integer(l.vat_bps)
        )
          fail(
            "ORDER_PRICE_CHANGED",
            "Fatura fiyatı/KDV onaylı kalan plandan farklı; yönetici fiyat revizyonunu onaylamalı.",
            409
          );
        received.push({
          productId: id,
          name: l.product_name,
          quantity: qty,
          unitNetMinor: integer(l.unit_net_minor),
          vatBps: integer(l.vat_bps),
          lots: raw.lots,
        });
      }
      const reference = requireString(body.reference, "Belge no", { max: 100 }),
        dueDate = calendarDate(body.dueDate, "Vade");
      const result = await recordMarketPurchase(
        c,
        actor,
        {
          ...body,
          reference,
          dueDate,
          partyId: o.supplier_id,
          lines: received,
        },
        scope,
        station,
        book
      );
      if (!isRecord(result) || typeof result.id !== "string")
        fail("INTERNAL_ERROR", "Mal kabul sonucu okunamadı.", 500);
      const entry = await first<Row>(
        c,
        "SELECT id FROM st_market_entries WHERE station_id=? AND kind='PURCHASE' AND source_id=?",
        [station, result.id]
      );
      for (const l of received)
        await execute(
          c,
          "UPDATE st_purchase_order_lines SET received_qty=received_qty+? WHERE order_id=? AND product_id=?",
          [l.quantity, o.id, l.productId]
        );
      const done = (await orderLines(c, o.id)).every(
        l => integer(l.ordered_qty) === integer(l.received_qty)
      );
      await execute(
        c,
        "INSERT INTO st_purchase_order_receipts(purchase_id,order_id,entry_id,approved_version,reference,due_date,total_minor,items_json,received_by_user_id) VALUES (?,?,?,?,?,?,?,?,?)",
        [
          result.id,
          o.id,
          entry!.id,
          o.version,
          reference,
          dueDate,
          result.totalMinor,
          JSON.stringify(received),
          actor.id,
        ]
      );
      await touch(c, o.id, done ? "RECEIVED" : "PARTIAL");
      await event(c, o.id, actor.id, "RECEIVE", {
        purchaseId: result.id,
        version: integer(o.version),
        items: received,
        totalMinor: result.totalMinor,
      });
      return { id: o.id, purchaseId: result.id, totalMinor: result.totalMinor };
    }
  );
}

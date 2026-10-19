import { randomUUID } from "node:crypto";
import type { PoolConnection } from "mysql2/promise";
import type { Row } from "./market-pos";
import { execute, rows } from "./db";
import { businessToday, integer } from "./market-accounting-domain";
import { isRecord, requireId, requireInteger } from "./domain";
import { allocateFefo, lotInput } from "./lot-domain";
import { safeAdd } from "./safety";
import { fail } from "./types";
export async function lockedLots(c: PoolConnection, p: Row) {
  const result = await rows<Row[]>(
    c,
    "SELECT * FROM st_inventory_lots WHERE product_id=? AND station_id=? ORDER BY expiry_date,received_at,id FOR UPDATE",
    [p.id, p.station_id]
  );
  if (
    result.reduce((n, l) => safeAdd(n, integer(l.quantity)), 0) !==
    integer(p.stock_qty)
  )
    fail(
      "LOT_STOCK_MISMATCH",
      "Parti toplamı ve ürün stoğu uyuşmuyor. İşlem yapılmadı.",
      409
    );
  return result;
}
export async function lotEvent(
  c: PoolConnection,
  p: Row,
  lot: string | null,
  kind: string,
  source: string,
  delta: number,
  actor: number,
  detail: Record<string, unknown> = {}
) {
  await execute(
    c,
    "INSERT INTO st_inventory_lot_events(station_id,product_id,lot_id,kind,source_id,delta,actor_user_id,detail_json) VALUES (?,?,?,?,?,?,?,?)",
    [
      p.station_id,
      p.id,
      lot,
      kind,
      source,
      delta,
      actor,
      JSON.stringify(detail),
    ]
  );
}
export async function addLot(
  c: PoolConnection,
  p: Row,
  input: {
    code: string;
    expiryDate: string | null;
    status: string;
    quantity: number;
  },
  kind: string,
  source: string,
  actor: number
) {
  const id = randomUUID();
  await execute(
    c,
    "INSERT INTO st_inventory_lots(id,tenant_id,station_id,product_id,code,expiry_date,status,quantity,origin_kind,origin_id) VALUES (?,?,?,?,?,?,?,?,?,?)",
    [
      id,
      p.tenant_id,
      p.station_id,
      p.id,
      input.code,
      input.expiryDate,
      input.status,
      input.quantity,
      kind,
      source,
    ]
  );
  await lotEvent(c, p, id, kind, source, input.quantity, actor, {
    code: input.code,
    expiryDate: input.expiryDate,
    status: input.status,
  });
  return id;
}
export async function receiveLots(
  c: PoolConnection,
  p: Row,
  input: unknown,
  qty: number,
  source: string,
  actor: number
) {
  if (!p.lot_tracking) {
    if (input !== undefined && (!Array.isArray(input) || input.length))
      fail("LOT_TRACKING_DISABLED", "Önce ürün için lot takibini açın.", 409);
    return;
  }
  await lockedLots(c, p);
  for (const l of lotInput(input, qty, businessToday()))
    await addLot(c, p, l, "PURCHASE", source, actor);
}
export async function sellLots(
  c: PoolConnection,
  p: Row,
  qty: number,
  source: string,
  actor: number
) {
  if (!p.lot_tracking) return;
  const lots = await lockedLots(c, p),
    allocations = allocateFefo(
      lots.map(l => ({
        id: l.id,
        quantity: integer(l.quantity),
        expiryDate: l.expiry_date,
        status: l.status,
      })),
      qty,
      businessToday()
    );
  for (const a of allocations) {
    await execute(
      c,
      "UPDATE st_inventory_lots SET quantity=quantity-? WHERE id=?",
      [a.quantity, a.lotId]
    );
    await lotEvent(c, p, a.lotId, "SALE", source, -a.quantity, actor);
  }
}
export async function returnLots(
  c: PoolConnection,
  p: Row,
  qty: number,
  source: string,
  actor: number,
  sale: boolean,
  input: unknown
) {
  if (!p.lot_tracking) return;
  const lots = await lockedLots(c, p);
  if (sale) {
    await addLot(
      c,
      p,
      {
        code: "IADE-" + source.slice(0, 8),
        expiryDate: null,
        status: "QUARANTINE",
        quantity: qty,
      },
      "SALE_RETURN",
      source,
      actor
    );
    return;
  }
  if (!Array.isArray(input) || !input.length || input.length > 50)
    fail(
      "RETURN_LOT_REQUIRED",
      "Tedarikçiye iade edilecek gerçek partileri seçin."
    );
  const seen = new Set<string>();
  let total = 0;
  for (const raw of input) {
    if (!isRecord(raw)) fail("INVALID_INPUT", "İade partisi geçersiz.");
    const id = requireId(raw.lotId, "lotId"),
      q = requireInteger(raw.quantity, "Parti iade adedi");
    if (seen.has(id)) fail("INVALID_INPUT", "Parti tekrarlanamaz.");
    seen.add(id);
    const l = lots.find(l => l.id === id);
    if (!l || integer(l.quantity) < q)
      fail(
        "RETURN_LOT_UNAVAILABLE",
        "Seçilen partinin mevcut adedi yetersiz.",
        409
      );
    total = safeAdd(total, q);
    await execute(
      c,
      "UPDATE st_inventory_lots SET quantity=quantity-? WHERE id=?",
      [q, id]
    );
    await lotEvent(c, p, id, "PURCHASE_RETURN", source, -q, actor);
  }
  if (total !== qty)
    fail(
      "LOT_QUANTITY_MISMATCH",
      "İade parti toplamı ürün iadesine eşit olmalı.",
      409
    );
}

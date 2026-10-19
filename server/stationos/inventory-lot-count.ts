import { randomUUID } from "node:crypto";
import type { PoolConnection } from "mysql2/promise";
import type { Row } from "./market-pos";
import { execute, rows } from "./db";
import { integer, ratioRound } from "./market-accounting-domain";
import { lockedLots, lotEvent } from "./lot-stock";
import { lotCountPlan } from "../../shared/lot-count";
import { fail } from "./types";
export async function snapshotCountLots(
  c: PoolConnection,
  draft: string,
  station: string,
  product?: string
) {
  // Products/station are already locked by the calling inventory mutation.
  await execute(
    c,
    `INSERT INTO st_inventory_draft_lots(draft_id,product_id,lot_id,code,expiry_date,status,baseline_qty)
    SELECT d.draft_id,l.product_id,l.id,l.code,l.expiry_date,l.status,l.quantity FROM st_inventory_draft_lines d
    JOIN st_inventory_lots l ON l.product_id=d.product_id AND l.station_id=?
    WHERE d.draft_id=? AND d.lot_counting=TRUE ${product ? "AND d.product_id=?" : ""}`,
    [station, draft, ...(product ? [product] : [])]
  );
}
export async function postCountLots(
  c: PoolConnection,
  p: Row,
  draft: string,
  actor: number,
  reason: string,
  unit: number | undefined,
  zeroAccepted: unknown,
  value: number
) {
  const lots = await lockedLots(c, p),
    snapshots = await rows<Row[]>(
      c,
      "SELECT * FROM st_inventory_draft_lots WHERE draft_id=? AND product_id=? ORDER BY lot_id FOR UPDATE",
      [draft, p.id]
    );
  if (
    lots.length !== snapshots.length ||
    snapshots.some(
      s =>
        !lots.some(
          l =>
            l.id === s.lot_id && integer(l.quantity) === integer(s.baseline_qty)
        )
    )
  )
    fail(
      "COUNT_STOCK_CHANGED",
      "Partiler sayım sırasında değişti; ürünü yeniden sayın.",
      409
    );
  let plan;
  try {
    plan = lotCountPlan(
      integer(p.stock_qty),
      value,
      snapshots.map(s => ({
        before: integer(s.baseline_qty),
        after: s.counted_qty === null ? null : integer(s.counted_qty),
      })),
      unit
    );
  } catch (e) {
    fail("INVALID_LOT_COUNT", (e as Error).message, 409);
  }
  if (plan.gainQty && unit === 0 && zeroAccepted !== true)
    fail(
      "ZERO_COST_CONFIRMATION",
      "Sıfır maliyetli parti fazlasını açıkça teyit edin.",
      409
    );
  let changed = false;
  for (const s of snapshots) {
    if (s.counted_qty === null) continue;
    const delta = integer(s.counted_qty) - integer(s.baseline_qty);
    if (!delta) continue;
    changed = true;
    await execute(c, "UPDATE st_inventory_lots SET quantity=? WHERE id=?", [
      s.counted_qty,
      s.lot_id,
    ]);
    await lotEvent(c, p, s.lot_id, "TERMINAL_COUNT", draft, delta, actor, {
      reason,
      before: integer(s.baseline_qty),
      after: integer(s.counted_qty),
      countedByUserId: s.counted_by_user_id,
      deviceId: s.device_id,
    });
    await execute(
      c,
      "INSERT INTO st_stock_movements(id,tenant_id,station_id,product_id,kind,quantity,unit_price_minor,reference,created_by_user_id) VALUES (?,?,?,?,'ADJUSTMENT',?,0,?,?)",
      [
        randomUUID(),
        p.tenant_id,
        p.station_id,
        p.id,
        delta,
        `LOTCOUNT:${draft}:${s.lot_id}`,
        actor,
      ]
    );
  }
  if (changed) {
    await execute(
      c,
      "UPDATE st_market_inventory SET quantity=?,value_minor=? WHERE product_id=?",
      [plan.quantity, plan.valueMinor, p.id]
    );
    await execute(
      c,
      "UPDATE st_products SET stock_qty=?,purchase_price_minor=?,stock_version=stock_version+1 WHERE id=?",
      [
        plan.quantity,
        plan.quantity ? ratioRound(plan.valueMinor, 1, plan.quantity) : 0,
        p.id,
      ]
    );
  }
  return {
    ...plan,
    lots: snapshots
      .filter(s => s.counted_qty !== null)
      .map(s => ({
        id: s.lot_id,
        code: s.code,
        expiryDate: s.expiry_date,
        status: s.status,
        before: integer(s.baseline_qty),
        after: integer(s.counted_qty),
      })),
  };
}

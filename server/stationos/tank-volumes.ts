import { randomUUID } from "node:crypto";
import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import { first, rows, execute } from "./db";
import { requireId, requireInteger, requireEnum } from "./domain";
import { fail } from "./types";
import {
  lockDemoTankStation,
  lockTankCard,
  checkTankRevision,
  tankProof,
} from "./tank";
import { volumeVariance } from "../../shared/tank-volumes";
import { parseDbUtc } from "../../shared/datetime";
type Row = RowDataPacket & Record<string, any>;
type Scope = { tenantId: string; stationId: string };
async function latest(c: PoolConnection, tankId: string) {
  return first<Row>(
    c,
    `SELECT * FROM st_tank_volume_readings WHERE tank_id=? ORDER BY sequence_index DESC LIMIT 1 FOR UPDATE`,
    [tankId]
  );
}
async function baseline(c: PoolConnection, tankId: string) {
  return first<Row>(
    c,
    `SELECT r.* FROM st_tank_variance_resets r JOIN st_tank_volume_readings v ON v.id=r.reading_id WHERE r.tank_id=? AND r.status='APPROVED' ORDER BY v.sequence_index DESC LIMIT 1 FOR UPDATE`,
    [tankId]
  );
}
export async function recordDualVolumes(
  c: PoolConnection,
  scope: Scope,
  actorId: number,
  body: Record<string, unknown>
) {
  await lockDemoTankStation(c, scope);
  const card = await lockTankCard(c, scope, body.tankId);
  checkTankRevision(card, body.expectedRevision);
  const productMl = requireInteger(body.productMl, "productMl", {
      allowZero: true,
    }),
    netMl = requireInteger(body.netMl, "netMl", { allowZero: true }),
    p = tankProof(body);
  if (productMl > Number(card.capacity_ml))
    fail("STOCK_BOUNDS", "Ürün hacmi tank kapasitesini aşıyor.", 409);
  const previous = await latest(c, card.tank_id);
  const expected = body.expectedReadingId
    ? requireId(body.expectedReadingId, "expectedReadingId")
    : null;
  if ((previous?.id ?? null) !== expected)
    fail(
      "REVISION_CONFLICT",
      "Ürün/net ölçümü değişti; güncel okumayı yenileyin.",
      409
    );
  const id = randomUUID();
  await execute(
    c,
    `INSERT INTO st_tank_volume_readings (id,tank_id,sequence_index,product_ml,net_ml,stock_revision,note,evidence,actor_id) VALUES (?,?,?,?,?,?,?,?,?)`,
    [
      id,
      card.tank_id,
      Number(previous?.sequence_index ?? 0) + 1,
      productMl,
      netMl,
      card.revision,
      p.note,
      p.evidence,
      actorId,
    ]
  );
  return {
    id,
    tankId: card.tank_id,
    ...volumeVariance(productMl, netMl, null),
    ...p,
    stockApplied: false,
  };
}
export async function requestVarianceReset(
  c: PoolConnection,
  scope: Scope,
  actorId: number,
  body: Record<string, unknown>
) {
  await lockDemoTankStation(c, scope);
  const card = await lockTankCard(c, scope, body.tankId);
  checkTankRevision(card, body.expectedRevision);
  const reading = await latest(c, card.tank_id);
  if (
    !reading ||
    reading.id !== body.readingId ||
    Number(reading.stock_revision) !== Number(card.revision)
  )
    fail(
      "READING_STALE",
      "Dönem kapatma için güncel ürün/net ölçümü gerekli.",
      409
    );
  const previous = await baseline(c, card.tank_id),
    p = tankProof(body),
    v = volumeVariance(
      Number(reading.product_ml),
      Number(reading.net_ml),
      previous ? Number(previous.baseline_spread_ml) : null
    ),
    id = randomUUID();
  await execute(
    c,
    `INSERT INTO st_tank_variance_resets (id,tank_id,reading_id,previous_reset_id,previous_spread_ml,baseline_spread_ml,closed_difference_ml,note,evidence,created_by) VALUES (?,?,?,?,?,?,?,?,?,?)`,
    [
      id,
      card.tank_id,
      reading.id,
      previous?.id ?? null,
      v.baselineSpreadMl,
      v.spreadMl,
      v.periodDifferenceMl,
      p.note,
      p.evidence,
      actorId,
    ]
  );
  return { id, tankId: card.tank_id, ...v, ...p, stockApplied: false };
}
export async function reviewVarianceReset(
  c: PoolConnection,
  scope: Scope,
  actorId: number,
  body: Record<string, unknown>
) {
  await lockDemoTankStation(c, scope);
  const card = await lockTankCard(c, scope, body.tankId),
    request = await first<Row>(
      c,
      `SELECT * FROM st_tank_variance_resets WHERE id=? AND tank_id=? FOR UPDATE`,
      [requireId(body.varianceResetId, "varianceResetId"), card.tank_id]
    );
  if (!request || request.status !== "PENDING")
    fail("RESET_LOCKED", "Dönem kapatma talebi artık beklemiyor.", 409);
  if (Number(request.created_by) === actorId)
    fail(
      "SELF_APPROVAL_FORBIDDEN",
      "Kendi fark kapatma talebinizi onaylayamazsınız.",
      403
    );
  const decision = requireEnum(body.decision, "decision", [
      "APPROVE",
      "REJECT",
    ] as const),
    p = tankProof(body);
  if (decision === "APPROVE") {
    checkTankRevision(card, body.expectedRevision);
    const reading = await latest(c, card.tank_id),
      previous = await baseline(c, card.tank_id);
    if (
      !reading ||
      reading.id !== request.reading_id ||
      Number(reading.stock_revision) !== Number(card.revision) ||
      (previous?.id ?? null) !== request.previous_reset_id
    )
      fail(
        "RESET_STALE",
        "Ölçüm, stok veya önceki dönem değişti; talep reddedilip güncel ölçümle hazırlanmalı.",
        409
      );
  }
  await execute(
    c,
    `UPDATE st_tank_variance_resets SET status=?,reviewer_id=?,review_note=?,review_evidence=?,reviewed_at=CURRENT_TIMESTAMP(3) WHERE id=?`,
    [
      decision === "APPROVE" ? "APPROVED" : "REJECTED",
      actorId,
      p.note,
      p.evidence,
      request.id,
    ]
  );
  return {
    id: request.id,
    tankId: card.tank_id,
    decision,
    ...p,
    stockApplied: false,
  };
}
export async function tankVolumesReport(c: PoolConnection, scope: Scope) {
  const cards = await rows<Row[]>(
    c,
    `SELECT tank_id,tank_number,revision FROM st_tank_cards WHERE station_id=? AND tenant_id=?`,
    [scope.stationId, scope.tenantId]
  );
  const readingRows = await rows<Row[]>(
    c,
    `SELECT r.* FROM st_tank_volume_readings r JOIN st_tank_cards c ON c.tank_id=r.tank_id WHERE c.station_id=? AND c.tenant_id=? ORDER BY r.sequence_index DESC LIMIT 1001`,
    [scope.stationId, scope.tenantId]
  );
  const resetRows = await rows<Row[]>(
    c,
    `SELECT r.* FROM st_tank_variance_resets r JOIN st_tank_cards c ON c.tank_id=r.tank_id JOIN st_tank_volume_readings v ON v.id=r.reading_id WHERE c.station_id=? AND c.tenant_id=? ORDER BY v.sequence_index DESC,r.created_at DESC LIMIT 1001`,
    [scope.stationId, scope.tenantId]
  );
  if (readingRows.length > 1000 || resetRows.length > 1000)
    fail(
      "REPORT_RANGE_REQUIRED",
      "Ürün/net geçmişi 1000 satır sınırını aşıyor; arşiv raporu gerekli."
    );
  const states = cards.map(card => {
    const r = readingRows.find(r => r.tank_id === card.tank_id),
      b = resetRows.find(
        r => r.tank_id === card.tank_id && r.status === "APPROVED"
      ),
      fresh = !!r && Number(r.stock_revision) === Number(card.revision);
    const v = r
      ? volumeVariance(
          Number(r.product_ml),
          Number(r.net_ml),
          b ? Number(b.baseline_spread_ml) : null
        )
      : null;
    return {
      tankId: card.tank_id,
      number: card.tank_number,
      productMl: v?.productMl ?? null,
      netMl: v?.netMl ?? null,
      spreadMl: v?.spreadMl ?? null,
      baselineSpreadMl: v?.baselineSpreadMl ?? null,
      periodDifferenceMl: fresh ? (v?.periodDifferenceMl ?? null) : null,
      fresh,
      readingId: r?.id ?? null,
      baselineId: b?.id ?? null,
    };
  });
  return {
    states,
    readings: readingRows.map(r => ({
      id: r.id,
      tankId: r.tank_id,
      sequence: Number(r.sequence_index),
      productMl: Number(r.product_ml),
      netMl: Number(r.net_ml),
      spreadMl: Number(r.product_ml) - Number(r.net_ml),
      stockRevision: Number(r.stock_revision),
      note: r.note,
      evidence: r.evidence,
      createdAt: parseDbUtc(String(r.created_at)).toISOString(),
    })),
    resets: resetRows.map(r => ({
      id: r.id,
      tankId: r.tank_id,
      readingId: r.reading_id,
      previousResetId: r.previous_reset_id,
      previousSpreadMl:
        r.previous_spread_ml === null ? null : Number(r.previous_spread_ml),
      baselineSpreadMl: Number(r.baseline_spread_ml),
      closedDifferenceMl:
        r.closed_difference_ml === null ? null : Number(r.closed_difference_ml),
      status: r.status,
      note: r.note,
      evidence: r.evidence,
      createdBy: Number(r.created_by),
      createdAt: parseDbUtc(String(r.created_at)).toISOString(),
      reviewedAt:
        r.reviewed_at === null
          ? null
          : parseDbUtc(String(r.reviewed_at)).toISOString(),
    })),
  };
}

import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import { first, execute, rows } from "./db";
import { requireId, safeDate, mysqlDate } from "./domain";
import { parseDbUtc } from "../../shared/datetime";
import { fail } from "./types";
export function assertShiftClosable(
  accounts: { status: string; approvals: number }[]
) {
  if (!accounts.length)
    fail("SHIFT_EMPTY", "Hesabı olmayan vardiya kapatılamaz.", 409);
  if (
    accounts.some(
      a =>
        !["ACCEPTED", "ACCEPTED_WITH_PENDING"].includes(a.status) ||
        a.approvals < 2
    )
  )
    fail(
      "SHIFT_APPROVAL_REQUIRED",
      "Bütün vardiya hesapları iki bağımsız onayla kapanmış olmalı.",
      409
    );
}
export async function closeShift(
  c: PoolConnection,
  scope: { tenantId: string; stationId: string },
  body: Record<string, unknown>
) {
  const id = requireId(body.shiftId, "shiftId"),
    shift = await first<RowDataPacket>(
      c,
      "SELECT * FROM st_shifts WHERE id=? AND tenant_id=? AND station_id=? FOR UPDATE",
      [id, scope.tenantId, scope.stationId]
    );
  if (!shift) fail("SHIFT_NOT_FOUND", "Vardiya bu istasyona ait değil.", 404);
  if (shift.status !== "OPEN")
    fail("SHIFT_CLOSED", "Vardiya zaten kapalı.", 409);
  const end = safeDate(body.endsAt, "endsAt");
  if (end.getTime() > Date.now() || end <= parseDbUtc(String(shift.starts_at)))
    fail(
      "SHIFT_END_INVALID",
      "Kapanış başlangıçtan sonra ve gelecekte olmayan bir zaman olmalı.",
      409
    );
  const accounts = await rows<RowDataPacket[]>(
    c,
    "SELECT a.id,a.status,(SELECT COUNT(DISTINCT s.user_id) FROM st_account_signatures s WHERE s.account_id=a.id AND s.cycle_no=a.cycle_no AND s.kind='APPROVAL' AND s.user_id<>a.user_id) AS approvals FROM st_accounts a WHERE a.shift_id=? AND a.tenant_id=? AND a.station_id=? FOR UPDATE",
    [id, scope.tenantId, scope.stationId]
  );
  assertShiftClosable(
    accounts.map(a => ({ status: a.status, approvals: Number(a.approvals) }))
  );
  const latest = await first<RowDataPacket>(
    c,
    "SELECT MAX(r.reading_at) AS reading_at FROM st_fuel_readings r JOIN st_accounts a ON a.id=r.account_id WHERE a.shift_id=? AND a.tenant_id=? AND a.station_id=?",
    [id, scope.tenantId, scope.stationId]
  );
  if (latest?.reading_at && end < parseDbUtc(String(latest.reading_at)))
    fail(
      "SHIFT_END_BEFORE_READING",
      "Vardiya kapanışı son sayaç okumasından önce olamaz.",
      409
    );
  await execute(
    c,
    "UPDATE st_shifts SET status='CLOSED',ends_at=? WHERE id=?",
    [mysqlDate(end), id]
  );
  return { id, status: "CLOSED", financialPosted: false };
}

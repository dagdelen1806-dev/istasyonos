import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import { rows, first } from "./db";
import { safeCalendarDate } from "./domain";
import { fail } from "./types";
import { turkeyToday } from "../../shared/datetime";
import type { Dashboard } from "../../shared/dashboard";
import { safeAdd } from "./safety";
export function dashboardInteger(value: unknown) {
  const n = Number(value ?? 0);
  if (!Number.isSafeInteger(n))
    fail(
      "DASHBOARD_TOTAL_OVERFLOW",
      "Gösterge toplamı güvenli tamsayı sınırında değil.",
      500
    );
  return n;
}
export function dashboardDates(from: unknown, to: unknown) {
  const end =
      to === undefined ? turkeyToday() : safeCalendarDate(to, "Bitiş günü"),
    start =
      from === undefined
        ? new Date(Date.parse(end + "T12:00:00Z") - 59 * 86400000)
            .toISOString()
            .slice(0, 10)
        : safeCalendarDate(from, "Başlangıç günü");
  if (start > end || Date.parse(end) - Date.parse(start) > 366 * 86400000)
    fail(
      "DASHBOARD_DATE_RANGE",
      "En fazla 366 günlük geçerli tarih aralığı seçin."
    );
  return { from: start, to: end };
}
export async function operationalDashboard(
  c: PoolConnection,
  tenantId: string,
  stationIds: string[],
  from: unknown,
  to: unknown
): Promise<Dashboard> {
  const dates = dashboardDates(from, to);
  if (!stationIds.length)
    fail("STATION_FORBIDDEN", "Yetkili istasyon gerekli.", 403);
  const marks = stationIds.map(() => "?").join(","),
    scope = [tenantId, ...stationIds];
  const records = await rows<RowDataPacket[]>(
    c,
    `SELECT DATE_FORMAT(DATE_ADD(s.starts_at,INTERVAL 3 HOUR),'%Y-%m-%d') AS day,COALESCE(SUM(a.source_sales_minor),0) AS revenueMinor,COALESCE(SUM((SELECT SUM(CASE WHEN r.kind='CLOSE' THEN r.meter_ml WHEN r.kind='OPEN' THEN -r.meter_ml ELSE 0 END) FROM st_fuel_readings r WHERE r.account_id=a.id)),0) AS litresMl,COALESCE(SUM((SELECT SUM(p.amount_minor) FROM st_payments p WHERE p.account_id=a.id AND p.kind='CASH' AND p.status='POSTED')),0) AS cashMinor,COALESCE(SUM((SELECT SUM(p.amount_minor) FROM st_slips p WHERE p.account_id=a.id AND p.status='VERIFIED')),0) AS cardMinor,COALESCE(SUM((SELECT SUM(p.amount_minor) FROM st_payments p WHERE p.account_id=a.id AND p.kind='DEBT' AND p.status='POSTED')),0) AS debtMinor,COALESCE(SUM((SELECT SUM(p.amount_minor) FROM st_payments p WHERE p.account_id=a.id AND p.kind='IBAN' AND p.status='POSTED')),0) AS ibanMinor,COALESCE(SUM((SELECT SUM(p.amount_minor) FROM st_payments p WHERE p.account_id=a.id AND p.kind='FAST' AND p.status='POSTED')),0) AS fastMinor FROM st_accounts a JOIN st_shifts s ON s.id=a.shift_id WHERE a.tenant_id=? AND a.station_id IN (${marks}) AND a.status IN ('ACCEPTED','ACCEPTED_WITH_PENDING') AND DATE(DATE_ADD(s.starts_at,INTERVAL 3 HOUR)) BETWEEN ? AND ? GROUP BY day ORDER BY day`,
    [...scope, dates.from, dates.to]
  );
  const days = records.map(r =>
    Object.fromEntries(
      Object.entries(r).map(([k, v]) => [
        k,
        k === "day" ? String(v) : dashboardInteger(v),
      ])
    )
  ) as Dashboard["days"];
  const totals = {
    revenueMinor: 0,
    litresMl: 0,
    cashMinor: 0,
    cardMinor: 0,
    debtMinor: 0,
    ibanMinor: 0,
    fastMinor: 0,
  };
  for (const d of days)
    for (const key of Object.keys(totals) as (keyof typeof totals)[])
      totals[key] = safeAdd(totals[key], d[key]);
  const stock = await first<RowDataPacket>(
    c,
    `SELECT COALESCE(SUM(c.stock_ml),0) AS stockMl,COALESCE(SUM(c.stock_ml IS NULL),0) AS unknownTanks,COALESCE(SUM(CASE WHEN m.revision=c.revision AND c.stock_ml IS NOT NULL THEN ABS(m.measured_ml-c.stock_ml) ELSE 0 END),0) AS differenceMl,COALESCE(SUM(m.id IS NULL OR m.revision<>c.revision),0) AS unknownMeasurements FROM st_tank_cards c LEFT JOIN st_tank_measurements m ON m.id=(SELECT v.id FROM st_tank_measurements v WHERE v.tank_id=c.tank_id ORDER BY v.created_at DESC,v.id DESC LIMIT 1) WHERE c.tenant_id=? AND c.station_id IN (${marks})`,
    scope
  );
  const shifts = await first<RowDataPacket>(
    c,
    `SELECT COUNT(*) AS count FROM st_shifts WHERE tenant_id=? AND station_id IN (${marks}) AND status='OPEN'`,
    scope
  );
  const cash = await first<RowDataPacket>(
    c,
    `SELECT COALESCE(SUM(a.opening_float_minor+COALESCE((SELECT SUM(p.amount_minor) FROM st_payments p WHERE p.account_id=a.id AND p.kind='CASH' AND p.status='POSTED'),0)),0) AS amount FROM st_accounts a WHERE a.tenant_id=? AND a.station_id IN (${marks}) AND a.status='OPEN'`,
    scope
  );
  const debt = await first<RowDataPacket>(
    c,
    `SELECT COALESCE(SUM(balance_minor),0) AS amount FROM st_debtors WHERE tenant_id=? AND station_id IN (${marks})`,
    scope
  );
  const pending = await first<RowDataPacket>(
    c,
    `SELECT COUNT(*) AS count,COALESCE(SUM(ABS(COALESCE(difference_minor,0))),0) AS difference FROM st_accounts WHERE tenant_id=? AND station_id IN (${marks}) AND status IN ('SUBMITTED','IN_REVIEW')`,
    scope
  );
  const tankPending = await first<RowDataPacket>(
    c,
    `SELECT COUNT(*) AS count FROM st_tank_requests WHERE tenant_id=? AND station_id IN (${marks}) AND status='PENDING'`,
    scope
  );
  const drafts = await first<RowDataPacket>(
    c,
    `SELECT COUNT(*) AS count FROM st_shift_special_operations WHERE tenant_id=? AND station_id IN (${marks}) AND status IN ('DRAFT','PENDING')`,
    scope
  );
  return {
    ...dates,
    days,
    totals,
    current: {
      stockMl: dashboardInteger(stock?.stockMl ?? 0),
      unknownTanks: dashboardInteger(stock?.unknownTanks ?? 0),
      absoluteStockDifferenceMl: dashboardInteger(stock?.differenceMl ?? 0),
      unknownMeasurements: dashboardInteger(stock?.unknownMeasurements ?? 0),
      activeShifts: dashboardInteger(shifts?.count ?? 0),
      cashMinor: dashboardInteger(cash?.amount ?? 0),
      receivableMinor: dashboardInteger(debt?.amount ?? 0),
      pendingAccounts: dashboardInteger(pending?.count ?? 0),
      pendingTankRequests: dashboardInteger(tankPending?.count ?? 0),
      draftOperations: dashboardInteger(drafts?.count ?? 0),
      differenceMinor: dashboardInteger(pending?.difference ?? 0),
    },
  };
}

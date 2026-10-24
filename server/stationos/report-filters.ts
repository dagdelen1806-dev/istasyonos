import type { PoolConnection } from "mysql2/promise";
import type { Row } from "./market-pos";
import { first, rows } from "./db";
import { requireId } from "./domain";
import { fail } from "./types";
import type { ReportFilters, ReportOptions } from "../../shared/market-reports";
export function reportFilters(query: Record<string, unknown>): ReportFilters {
  const registerId =
    query.registerId === undefined || query.registerId === ""
      ? ""
      : requireId(query.registerId, "Kasa");
  const value = query.userId;
  if (
    value !== undefined &&
    value !== "" &&
    (typeof value !== "string" ||
      !/^[1-9]\d{0,9}$/.test(value) ||
      Number(value) > 2147483647)
  )
    fail("INVALID_FILTER", "Kullanıcı filtresi geçersiz.");
  return { registerId, userId: (value ?? "") as string };
}
export function saleFilter(alias: string, f: ReportFilters) {
  return {
    sql: `${f.registerId ? ` AND ${alias}.register_id=?` : ""}${f.userId ? ` AND ${alias}.user_id=?` : ""}`,
    params: [
      ...(f.registerId ? [f.registerId] : []),
      ...(f.userId ? [f.userId] : []),
    ],
  };
}
export async function reportOptions(
  c: PoolConnection,
  tenant: string,
  station: string
): Promise<ReportOptions> {
  const registers = await rows<Row[]>(
    c,
    "SELECT id,name FROM st_pos_registers WHERE tenant_id=? AND station_id=? ORDER BY name,id",
    [tenant, station]
  );
  const users = await rows<Row[]>(
    c,
    `SELECT u.id,u.name FROM users u JOIN (SELECT s.user_id FROM st_market_entries e JOIN st_pos_sales s ON s.id=e.source_id WHERE e.tenant_id=? AND e.station_id=? AND e.kind='POS_SALE' UNION SELECT actor_user_id user_id FROM st_pos_cart_events WHERE tenant_id=? AND station_id=?) x ON x.user_id=u.id ORDER BY u.name,u.id`,
    [tenant, station, tenant, station]
  );
  return {
    registers: registers.map(r => ({ id: r.id, name: r.name })),
    users: users.map(r => ({ id: String(r.id), name: r.name })),
  };
}
export async function validateReportFilters(
  c: PoolConnection,
  tenant: string,
  station: string,
  f: ReportFilters
) {
  if (
    f.registerId &&
    !(await first(
      c,
      "SELECT id FROM st_pos_registers WHERE id=? AND tenant_id=? AND station_id=?",
      [f.registerId, tenant, station]
    ))
  )
    fail("NOT_FOUND", "Kasa bu istasyonda bulunamadı.", 404);
  if (f.userId) {
    const options = await reportOptions(c, tenant, station);
    if (!options.users.some(u => u.id === f.userId))
      fail("NOT_FOUND", "Kullanıcının bu istasyonda rapor kaydı yok.", 404);
  }
}

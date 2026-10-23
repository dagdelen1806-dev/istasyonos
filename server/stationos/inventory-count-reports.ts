import type { Express } from "express";
import type { Services, Row } from "./market-pos";
import { first, rows, withTransaction } from "./db";
import { requireId, requireString } from "./domain";
import {
  businessToday,
  calendarDate,
  integer,
} from "./market-accounting-domain";
import { safeAdd } from "./safety";
import { fail, type StationRole } from "./types";
import { countReportItems } from "./count-report-domain";
import type {
  CountReportSummary,
  CountReportPage,
  CountReportDetail,
} from "../../shared/count-report";
const READ: StationRole[] = ["OWNER", "MANAGER", "ACCOUNTANT"];
const prefix = "/api/stationos/market-accounting/inventory/count-reports";
const sums = `COALESCE(SUM(CASE WHEN l.account_code='STOCK_GAIN' THEN l.credit_minor-l.debit_minor ELSE 0 END),0) AS gain_minor,COALESCE(SUM(CASE WHEN l.account_code='STOCK_LOSS' THEN l.debit_minor-l.credit_minor ELSE 0 END),0) AS loss_minor`;
const entryColumns =
  "e.id,e.seq,e.source_id,e.business_date,e.created_at,e.description,e.actor_user_id,d.label,u.name AS actor_name";
const entrySums =
  "(SELECT COALESCE(SUM(l.credit_minor-l.debit_minor),0) FROM st_market_lines l WHERE l.entry_id=e.id AND l.account_code='STOCK_GAIN') AS gain_minor,(SELECT COALESCE(SUM(l.debit_minor-l.credit_minor),0) FROM st_market_lines l WHERE l.entry_id=e.id AND l.account_code='STOCK_LOSS') AS loss_minor";
const summary = (r: Row): CountReportSummary => ({
  id: r.id,
  sequence: String(r.seq),
  draftId: r.source_id,
  label: r.label ?? "Eski sayım",
  date: r.business_date,
  postedAt: r.created_at,
  reason: r.description,
  approvedBy: { id: integer(r.actor_user_id), name: r.actor_name },
  gainMinor: integer(r.gain_minor),
  lossMinor: integer(r.loss_minor),
  netMinor: safeAdd(integer(r.gain_minor), -integer(r.loss_minor)),
});
export function registerInventoryCountReports(
  app: Express,
  services: Services
) {
  app.get(prefix, async (req, res) => {
    try {
      const actor = services.actor(req),
        station = requireId(req.query.stationId, "stationId"),
        today = businessToday(),
        from = calendarDate(req.query.from ?? today.slice(0, 7) + "-01"),
        to = calendarDate(req.query.to ?? today);
      if (from > to || (Date.parse(to) - Date.parse(from)) / 86400000 > 365)
        fail("INVALID_DATE", "Sayım raporu aralığı en fazla 366 gün olmalı.");
      let cursor: string | null = null;
      if (req.query.cursor) {
        cursor = requireString(req.query.cursor, "cursor", { max: 20 });
        if (
          !/^[1-9]\d{0,19}$/.test(cursor) ||
          BigInt(cursor) > 18446744073709551615n
        )
          fail("INVALID_CURSOR", "Sayım raporu imleci geçersiz.");
      }
      res.json(
        await withTransaction(async c => {
          const { scope } = await services.requireStation(
              c,
              actor,
              station,
              READ
            ),
            params = [scope.tenantId, station, from, to];
          const totals = await first<Row>(
            c,
            `SELECT COUNT(DISTINCT e.id) AS reports,${sums} FROM st_market_entries e LEFT JOIN st_market_lines l ON l.entry_id=e.id WHERE e.tenant_id=? AND e.station_id=? AND e.kind='STOCK_COUNT' AND e.business_date BETWEEN ? AND ?`,
            params
          );
          const selected = await rows<Row[]>(
            c,
            `SELECT ${entryColumns},${entrySums} FROM st_market_entries e JOIN users u ON u.id=e.actor_user_id LEFT JOIN st_inventory_drafts d ON d.id=e.source_id AND d.station_id=e.station_id WHERE e.tenant_id=? AND e.station_id=? AND e.kind='STOCK_COUNT' AND e.business_date BETWEEN ? AND ? ${cursor ? "AND e.seq<?" : ""} ORDER BY e.seq DESC LIMIT 51`,
            [...params, ...(cursor ? [cursor] : [])]
          );
          const page = selected.slice(0, 50);
          return {
            from,
            to,
            nextCursor: selected.length > 50 ? String(page.at(-1)!.seq) : null,
            totals: {
              reports: integer(totals?.reports),
              gainMinor: integer(totals?.gain_minor),
              lossMinor: integer(totals?.loss_minor),
              netMinor: safeAdd(
                integer(totals?.gain_minor),
                -integer(totals?.loss_minor)
              ),
            },
            rows: page.map(summary),
          } satisfies CountReportPage;
        })
      );
    } catch (e) {
      services.error(res, e);
    }
  });
  app.get(prefix + "/:entryId", async (req, res) => {
    try {
      const actor = services.actor(req),
        station = requireId(req.query.stationId, "stationId"),
        entry = requireId(req.params.entryId, "entryId");
      res.json(
        await withTransaction(async c => {
          const { scope } = await services.requireStation(
            c,
            actor,
            station,
            READ
          );
          const r = await first<Row>(
            c,
            `SELECT ${entryColumns},e.payload_json,${entrySums} FROM st_market_entries e JOIN users u ON u.id=e.actor_user_id LEFT JOIN st_inventory_drafts d ON d.id=e.source_id AND d.station_id=e.station_id WHERE e.id=? AND e.tenant_id=? AND e.station_id=? AND e.kind='STOCK_COUNT'`,
            [entry, scope.tenantId, station]
          );
          if (!r)
            fail(
              "NOT_FOUND",
              "Onaylanmış sayım raporu bu istasyonda bulunamadı.",
              404
            );
          const s = summary(r),
            decoded = countReportItems(r.payload_json, s);
          const products = await rows<Row[]>(
            c,
            "SELECT p.id,p.name,p.barcode,p.base_unit,s.counted_by_user_id,s.device_id FROM st_inventory_draft_lines s JOIN st_products p ON p.id=s.product_id WHERE s.draft_id=? AND p.station_id=? AND p.tenant_id=?",
            [s.draftId, station, scope.tenantId]
          );
          const lotSources = await rows<Row[]>(
            c,
            "SELECT lot_id,counted_by_user_id,device_id FROM st_inventory_draft_lots WHERE draft_id=?",
            [s.draftId]
          );
          const lotCollectors = new Map(lotSources.map(l => [l.lot_id, l]));
          const collectors = await rows<Row[]>(
            c,
            "SELECT DISTINCT u.id,u.name FROM users u JOIN st_members m ON m.user_id=u.id WHERE m.tenant_id=?",
            [scope.tenantId]
          );
          const names = new Map(
            collectors.map(u => [integer(u.id), u.name as string])
          );
          const named = (id: number | null) =>
            id ? { id, name: names.get(id) ?? `Kullanıcı #${id}` } : null;
          const post = await first<Row>(
            c,
            "SELECT device_id FROM st_inventory_draft_events WHERE draft_id=? AND action='POST' ORDER BY id DESC LIMIT 1",
            [s.draftId]
          );
          return {
            ...s,
            snapshotVersion: decoded.version,
            approvedDeviceId: post?.device_id ?? null,
            items: decoded.items.map(item => {
              const p = products.find(p => p.id === item.productId);
              return {
                productId: item.productId,
                name: item.label?.name ?? p?.name ?? item.productId,
                barcode: item.label?.barcode ?? p?.barcode ?? "",
                unit: item.label?.unit ?? p?.base_unit ?? "",
                labelSource: item.label
                  ? "SNAPSHOT"
                  : p
                    ? "CURRENT_CARD"
                    : "UNAVAILABLE",
                before: item.before,
                after: item.after,
                delta: item.delta,
                gainMinor: item.gainMinor,
                lossMinor: item.lossMinor,
                netMinor: item.netMinor,
                countedBy: named(
                  item.countedByUserId ??
                    (p?.counted_by_user_id
                      ? integer(p.counted_by_user_id)
                      : null)
                ),
                deviceId: item.deviceId ?? p?.device_id ?? null,
                lots: item.lots.map(l => ({
                  ...l,
                  countedBy: named(
                    l.countedByUserId ??
                      (lotCollectors.get(l.id)?.counted_by_user_id
                        ? integer(lotCollectors.get(l.id)!.counted_by_user_id)
                        : null)
                  ),
                  deviceId:
                    l.deviceId ?? lotCollectors.get(l.id)?.device_id ?? null,
                })),
              };
            }),
          } satisfies CountReportDetail;
        })
      );
    } catch (e) {
      services.error(res, e);
    }
  });
}

import type { Express } from "express";
import { first, rows, withTransaction } from "./db";
import { requireId } from "./domain";
import { businessToday, integer, plusDays } from "./market-accounting-domain";
import { reportRange, reportSequence } from "./sales-report-domain";
import { reportFilters, validateReportFilters } from "./report-filters";
import {
  cancellationLines,
  eventPosition,
  encodeEventPosition,
} from "./cancellation-report-domain";
import { fail } from "./types";
import { safeAdd } from "./safety";
import type { Services, Row } from "./market-pos";
import type { CancellationReport } from "../../shared/market-reports";
const utc = (d: string) =>
  new Date(d + "T00:00:00+03:00").toISOString().slice(0, 23).replace("T", " ");
export function registerCancellationReports(app: Express, services: Services) {
  app.get(
    "/api/stationos/market-accounting/reports/cancellations",
    async (req, res) => {
      try {
        const actor = services.actor(req),
          station = requireId(req.query.stationId, "stationId"),
          today = businessToday(),
          range = reportRange(req.query.from ?? today, req.query.to ?? today),
          filters = reportFilters(req.query);
        const cursor = req.query.cursor
            ? eventPosition(req.query.cursor)
            : null,
          asOf = req.query.asOf ? reportSequence(req.query.asOf) : null;
        if (cursor && !asOf)
          fail("INVALID_CURSOR", "İptal sayfalaması kayıt sınırı ister.");
        res.json(
          await withTransaction(async c => {
            const { scope } = await services.requireStation(c, actor, station, [
              "OWNER",
              "MANAGER",
              "ACCOUNTANT",
            ]);
            await validateReportFilters(c, scope.tenantId, station, filters);
            const last = await first<Row>(
              c,
              "SELECT COALESCE(MAX(seq),0) seq FROM st_pos_cart_events WHERE tenant_id=? AND station_id=?",
              [scope.tenantId, station]
            );
            const boundary = asOf ?? String(last!.seq);
            if (BigInt(boundary) > BigInt(last!.seq))
              fail(
                "INVALID_CURSOR",
                "İptal kayıt sınırı mevcut kayıtlardan ileride."
              );
            const selected = await rows<Row[]>(
              c,
              `SELECT e.*,u.name actor_name,g.name register_name FROM st_pos_cart_events e JOIN st_pos_carts c ON c.id=e.cart_id AND c.station_id=e.station_id JOIN st_pos_sessions s ON s.id=c.session_id JOIN st_pos_registers g ON g.id=s.register_id JOIN users u ON u.id=e.actor_user_id WHERE e.tenant_id=? AND e.station_id=? AND e.action IN ('REDUCE','CANCEL') AND e.created_at>=? AND e.created_at<? AND e.seq<=? ${filters.registerId ? "AND s.register_id=?" : ""} ${filters.userId ? "AND e.actor_user_id=?" : ""} ORDER BY e.created_at DESC,e.id DESC LIMIT 5001`,
              [
                scope.tenantId,
                station,
                utc(range.from),
                utc(plusDays(range.to, 1)),
                boundary,
                ...(filters.registerId ? [filters.registerId] : []),
                ...(filters.userId ? [filters.userId] : []),
              ]
            );
            if (selected.length > 5000)
              fail(
                "REPORT_LIMIT",
                "İptal raporu en fazla 5.000 olay içerir; tarih aralığını daraltın.",
                409
              );
            const decoded: (Row & ReturnType<typeof cancellationLines>)[] =
              selected.map(r => ({
                ...r,
                ...cancellationLines(
                  r.before_lines_json,
                  r.after_lines_json,
                  r.action
                ),
              }));
            const page = decoded
              .filter(
                r =>
                  !cursor ||
                  r.created_at < cursor.time ||
                  (r.created_at === cursor.time && r.id < cursor.id)
              )
              .slice(0, 51);
            return {
              from: range.from,
              to: range.to,
              filters,
              asOf: boundary,
              nextCursor:
                page.length > 50
                  ? encodeEventPosition({
                      time: page[49].created_at,
                      id: page[49].id,
                    })
                  : null,
              totals: {
                events: decoded.length,
                reductions: decoded.filter(r => r.action === "REDUCE").length,
                cancellations: decoded.filter(r => r.action === "CANCEL")
                  .length,
                removedMinor: decoded.reduce(
                  (s, r) => safeAdd(s, r.removedMinor),
                  0
                ),
              },
              rows: page.slice(0, 50).map(r => ({
                id: r.id,
                cartId: r.cart_id,
                version: integer(r.cart_version),
                date: r.created_at,
                actorName: r.actor_name,
                registerName: r.register_name,
                deviceId: r.device_id,
                action: r.action,
                reason: r.reason,
                removedMinor: r.removedMinor,
                lines: r.lines,
              })),
            } satisfies CancellationReport;
          })
        );
      } catch (e) {
        services.error(res, e);
      }
    }
  );
}

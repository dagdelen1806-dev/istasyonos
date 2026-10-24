import type { Express } from "express";
import type { Row, Services } from "./market-pos";
import { first, rows, withTransaction } from "./db";
import { requireId } from "./domain";
import { businessToday, integer } from "./market-accounting-domain";
import { reportRange, reportSequence } from "./sales-report-domain";
import {
  reportFilters,
  saleFilter,
  validateReportFilters,
} from "./report-filters";
import { salesReportMetrics } from "./sales-reports";
import {
  analysisAmounts,
  categoryIdentity,
  hourAnalysis,
  totalAnalysis,
} from "./sales-analysis-domain";
import { safeAdd } from "./safety";
import { fail } from "./types";
import type { SalesAnalysis } from "../../shared/sales-analysis";
const aggregates = `COUNT(DISTINCT CASE WHEN kind='SALE' THEN event_id END) saleCount,COUNT(DISTINCT CASE WHEN kind='RETURN' THEN event_id END) returnCount,SUM(kind='SALE') saleLines,SUM(kind='RETURN') returnLines,SUM(sales_gross) salesGrossMinor,SUM(sales_net) salesNetMinor,SUM(sales_vat) salesVatMinor,SUM(sales_cost) salesCostMinor,SUM(returns_gross) returnsGrossMinor,SUM(returns_net) returnsNetMinor,SUM(returns_vat) returnsVatMinor,SUM(returns_cost) returnsCostMinor,SUM(invalid) invalid`;
export function registerSalesAnalysis(app: Express, services: Services) {
  app.get(
    "/api/stationos/market-accounting/reports/sales-analysis",
    async (req, res) => {
      try {
        const actor = services.actor(req),
          station = requireId(req.query.stationId, "stationId"),
          today = businessToday(),
          range = reportRange(
            req.query.from ?? today.slice(0, 7) + "-01",
            req.query.to ?? today
          ),
          filters = reportFilters(req.query);
        res.json(
          await withTransaction(async c => {
            const { scope } = await services.requireStation(c, actor, station, [
              "OWNER",
              "MANAGER",
              "ACCOUNTANT",
            ]);
            await validateReportFilters(c, scope.tenantId, station, filters);
            const boundary = await first<Row>(
              c,
              "SELECT COALESCE(MAX(seq),0) seq FROM st_market_entries WHERE tenant_id=? AND station_id=?",
              [scope.tenantId, station]
            );
            const asOf =
              req.query.asOf === undefined
                ? String(boundary!.seq)
                : reportSequence(req.query.asOf);
            if (BigInt(asOf) > BigInt(boundary!.seq))
              fail(
                "INVALID_CURSOR",
                "Analiz kayıt sınırı mevcut kayıtlardan ileride."
              );
            const sf = saleFilter("s", filters),
              p = [scope.tenantId, station, range.from, range.to, asOf],
              params = [...p, ...sf.params, ...p, ...sf.params];
            const where =
              "e.tenant_id=? AND e.station_id=? AND e.business_date BETWEEN ? AND ? AND e.seq<=?";
            // Each source line appears once. Source-sale user/register also scopes returns.
            const source = `SELECT 'SALE' kind,s.id event_id,s.created_at event_time,l.category_snapshot category,l.total_minor sales_gross,l.net_total_minor sales_net,l.vat_minor sales_vat,l.cost_total_minor sales_cost,0 returns_gross,0 returns_net,0 returns_vat,0 returns_cost,(l.net_total_minor IS NULL OR l.vat_minor IS NULL OR l.cost_total_minor IS NULL OR l.net_total_minor<0 OR l.cost_total_minor<0 OR l.total_minor<>l.net_total_minor+l.vat_minor) invalid FROM st_market_entries e JOIN st_pos_sales s ON s.id=e.source_id AND s.station_id=e.station_id JOIN st_pos_sale_lines l ON l.sale_id=s.id WHERE ${where} AND e.kind='POS_SALE' ${sf.sql}
    UNION ALL SELECT 'RETURN',r.id,r.created_at,sl.category_snapshot,0,0,0,0,l.gross_minor,l.net_minor,l.vat_minor,l.cost_minor,(sl.id IS NULL) invalid FROM st_market_entries e JOIN st_market_returns r ON r.entry_id=e.id AND r.station_id=e.station_id JOIN st_market_entries oe ON oe.id=r.source_entry_id AND oe.kind='POS_SALE' JOIN st_pos_sales s ON s.id=oe.source_id AND s.station_id=e.station_id JOIN st_market_return_lines l ON l.return_id=r.id LEFT JOIN st_pos_sale_lines sl ON sl.sale_id=s.id AND sl.product_id=l.product_id WHERE ${where} AND e.kind='SALE_RETURN' ${sf.sql}`;
            const cs = await rows<Row[]>(
              c,
              `SELECT MAX(category) category,${aggregates} FROM (${source}) x GROUP BY CAST(category AS BINARY) ORDER BY CAST(category AS BINARY) LIMIT 5001`,
              params
            );
            if (cs.length > 5000)
              fail(
                "REPORT_LIMIT",
                "Analiz en fazla 5.000 kategori destekler; aralığı daraltın.",
                409
              );
            const hs = await rows<Row[]>(
              c,
              `SELECT DATE_FORMAT(event_time,'%Y-%m-%d %H:00:00') utcHour,${aggregates} FROM (${source}) x GROUP BY DATE_FORMAT(event_time,'%Y-%m-%d %H:00:00') ORDER BY utcHour LIMIT 10001`,
              params
            );
            if (hs.length > 10000)
              fail(
                "REPORT_LIMIT",
                "Analiz saat kaydı sınırı aşıldı; aralığı daraltın.",
                409
              );
            if ([...cs, ...hs].some(r => integer(r.invalid) > 0))
              fail(
                "REPORT_INCONSISTENT",
                "Satış/iade snapshotı eksik veya tutarsız; bugünkü karttan tamamlanmadı.",
                409
              );
            const categories = cs.map(r => ({
                ...categoryIdentity(r.category),
                ...analysisAmounts(r),
              })),
              hours = hourAnalysis(hs.map(r => ({ ...r, utcHour: r.utcHour }))),
              totals = totalAnalysis(hours);
            const metrics = await salesReportMetrics(c, p, filters);
            const sum = (
              key:
                | "netSalesMinor"
                | "cogsMinor"
                | "salesGrossMinor"
                | "returnsGrossMinor"
            ) => categories.reduce((s, r) => safeAdd(s, r[key]), 0);
            if (
              totals.netSalesMinor !== metrics.netSalesMinor ||
              totals.cogsMinor !== metrics.cogsMinor ||
              totals.saleCount !== metrics.saleCount ||
              totals.returnCount !== metrics.returns.count ||
              totals.salesGrossMinor !== metrics.salesGrossMinor ||
              totals.returnsGrossMinor !== metrics.returnsGrossMinor ||
              sum("netSalesMinor") !== totals.netSalesMinor ||
              sum("cogsMinor") !== totals.cogsMinor ||
              sum("salesGrossMinor") !== totals.salesGrossMinor ||
              sum("returnsGrossMinor") !== totals.returnsGrossMinor
            )
              fail(
                "REPORT_INCONSISTENT",
                "Kategori/saat toplamları satış ve mali defterle uyuşmuyor.",
                409
              );
            return {
              from: range.from,
              to: range.to,
              asOf,
              generatedAt: new Date().toISOString(),
              filters,
              totals,
              categories,
              hours,
            } satisfies SalesAnalysis;
          })
        );
      } catch (e) {
        services.error(res, e);
      }
    }
  );
}

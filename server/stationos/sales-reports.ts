import {
  reportFilters,
  saleFilter,
  validateReportFilters,
  reportOptions,
} from "./report-filters";
import type { ReportFilters } from "../../shared/market-reports";
import type { Express } from "express";
import type { PoolConnection } from "mysql2/promise";
import type { Services, Row } from "./market-pos";
import { first, rows, withTransaction } from "./db";
import { requireId } from "./domain";
import { businessToday, integer } from "./market-accounting-domain";
import { safeAdd } from "./safety";
import { fail, type StationRole } from "./types";
import {
  reportRange,
  reportSequence,
  salesMetrics,
  validateReportSale,
} from "./sales-report-domain";
import type {
  ReportSale,
  ReportSaleDetail,
  SalesReport,
  SalesProducts,
} from "../../shared/market-reports";
const READ: StationRole[] = ["OWNER", "MANAGER", "ACCOUNTANT"];
const prefix = "/api/stationos/market-accounting/reports/sales";
const where =
  "e.tenant_id=? AND e.station_id=? AND e.business_date BETWEEN ? AND ? AND e.seq<=?";
const saleFrom =
  "FROM st_market_entries e JOIN st_pos_sales s ON s.id=e.source_id AND s.station_id=e.station_id AND s.tenant_id=e.tenant_id";
export async function salesReportMetrics(c: PoolConnection, p: unknown[], f: ReportFilters) {
  const sf = saleFilter("s", f),
    lf = saleFilter("fs", f),
    filtered = !!(f.registerId || f.userId);
  const ledgerFilter = filtered
    ? ` AND ((e.kind='POS_SALE' AND EXISTS(SELECT 1 FROM st_pos_sales fs WHERE fs.id=e.source_id AND fs.station_id=e.station_id ${lf.sql})) OR (e.kind='SALE_RETURN' AND EXISTS(SELECT 1 FROM st_market_returns fr JOIN st_market_entries oe ON oe.id=fr.source_entry_id AND oe.kind='POS_SALE' JOIN st_pos_sales fs ON fs.id=oe.source_id WHERE fr.entry_id=e.id AND fs.station_id=e.station_id ${lf.sql})))`
    : "";
  const b = await rows<Row[]>(
    c,
    `SELECT l.account_code,SUM(l.debit_minor-l.credit_minor) amount FROM st_market_entries e JOIN st_market_lines l ON l.entry_id=e.id WHERE ${where} ${ledgerFilter} GROUP BY l.account_code`,
    [...p, ...(filtered ? [...lf.params, ...lf.params] : [])]
  );
  const s = await first<Row>(
    c,
    `SELECT COUNT(*) n,COALESCE(SUM(s.total_minor),0) gross,COALESCE(SUM(s.cash_amount_minor),0) cash,COALESCE(SUM(s.card_amount_minor),0) card,COALESCE(SUM(s.receivable_amount_minor),0) credit ${saleFrom} WHERE ${where} AND e.kind='POS_SALE' ${sf.sql}`,
    [...p, ...sf.params]
  );
  const r = await first<Row>(
    c,
    `SELECT COUNT(*) n,COALESCE(SUM(r.gross_minor),0) gross,COALESCE(SUM(CASE WHEN r.wallet='CASH_SAFE' THEN r.refund_minor ELSE 0 END),0) cash,COALESCE(SUM(CASE WHEN r.wallet='BANK' THEN r.refund_minor ELSE 0 END),0) bank,COALESCE(SUM(r.credited_minor),0) credit FROM st_market_entries e JOIN st_market_returns r ON r.entry_id=e.id AND r.station_id=e.station_id JOIN st_market_entries oe ON oe.id=r.source_entry_id AND oe.kind='POS_SALE' JOIN st_pos_sales s ON s.id=oe.source_id AND s.station_id=e.station_id WHERE ${where} AND e.kind='SALE_RETURN' ${sf.sql}`,
    [...p, ...sf.params]
  );
  return salesMetrics(
    Object.fromEntries(b.map(x => [x.account_code, integer(x.amount)])),
    s ?? {},
    r ?? {}
  );
}
const sale = (r: Row): ReportSale => ({
  id: r.id,
  entryId: r.entry_id,
  sequence: String(r.seq),
  date: r.business_date,
  createdAt: r.created_at,
  registerName: r.register_name,
  actorName: r.actor_name,
  paymentKind: r.payment_kind,
  totalMinor: integer(r.total_minor),
  cashMinor: integer(r.cash_amount_minor),
  cardMinor: integer(r.card_amount_minor),
  creditMinor: integer(r.receivable_amount_minor),
});
const saleSelect = `SELECT s.*,e.id entry_id,e.seq,e.business_date,u.name actor_name,g.name register_name ${saleFrom} JOIN users u ON u.id=s.user_id JOIN st_pos_registers g ON g.id=s.register_id`;
export function registerSalesReports(app: Express, services: Services) {
  app.get(
    "/api/stationos/market-accounting/reports/options",
    async (req, res) => {
      try {
        const actor = services.actor(req),
          station = requireId(req.query.stationId, "stationId");
        res.json(
          await withTransaction(async c => {
            const { scope } = await services.requireStation(
              c,
              actor,
              station,
              READ
            );
            return reportOptions(c, scope.tenantId, station);
          })
        );
      } catch (e) {
        services.error(res, e);
      }
    }
  );
  app.get(prefix, async (req, res) => {
    try {
      const actor = services.actor(req),
        station = requireId(req.query.stationId, "stationId"),
        today = businessToday();
      const filters = reportFilters(req.query);
      const range = reportRange(
        req.query.from ?? today.slice(0, 7) + "-01",
        req.query.to ?? today
      );
      const cursor =
        req.query.cursor === undefined || req.query.cursor === ""
          ? null
          : reportSequence(req.query.cursor);
      if (cursor && req.query.asOf === undefined)
        fail("INVALID_CURSOR", "Sayfalama için rapor kayıt sınırı gerekli.");
      res.json(
        await withTransaction(async c => {
          const { scope } = await services.requireStation(
            c,
            actor,
            station,
            READ
          );
          await validateReportFilters(c, scope.tenantId, station, filters);
          const sf = saleFilter("s", filters);
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
              "Rapor kayıt sınırı mevcut kayıtlardan ileride."
            );
          const p = [scope.tenantId, station, range.from, range.to, asOf];
          const totals = await salesReportMetrics(c, p, filters),
            previous = await salesReportMetrics(
              c,
              [
                scope.tenantId,
                station,
                range.previousFrom,
                range.previousTo,
                asOf,
              ],
              filters
            );
          const selected = await rows<Row[]>(
            c,
            `${saleSelect} WHERE ${where} AND e.kind='POS_SALE' ${sf.sql} ${cursor ? "AND e.seq<?" : ""} ORDER BY e.seq DESC LIMIT 51`,
            [...p, ...sf.params, ...(cursor ? [cursor] : [])]
          );
          const book = await first<Row>(
            c,
            "SELECT started_on FROM st_market_books WHERE tenant_id=? AND station_id=?",
            [scope.tenantId, station]
          );
          const closes = await first<Row>(
            c,
            "SELECT COUNT(*) n FROM st_market_day_closes WHERE tenant_id=? AND station_id=? AND business_date BETWEEN ? AND ?",
            p.slice(0, 4)
          );
          return {
            filters,
            salesOnly: !!(filters.registerId || filters.userId),
            from: range.from,
            to: range.to,
            previousFrom: range.previousFrom,
            previousTo: range.previousTo,
            asOf,
            generatedAt: new Date().toISOString(),
            startedOn: book?.started_on ?? null,
            closedDays: integer(closes?.n),
            totalDays: range.days,
            totals,
            previous,
            rows: selected.slice(0, 50).map(sale),
            nextCursor: selected.length > 50 ? String(selected[49].seq) : null,
          } satisfies SalesReport;
        })
      );
    } catch (e) {
      services.error(res, e);
    }
  });
  app.get(prefix + "/products", async (req, res) => {
    try {
      const actor = services.actor(req),
        station = requireId(req.query.stationId, "stationId"),
        range = reportRange(req.query.from, req.query.to),
        asOf = reportSequence(req.query.asOf);
      const filters = reportFilters(req.query),
        sf = saleFilter("s", filters);
      const cursor = req.query.cursor
        ? requireId(req.query.cursor, "cursor")
        : null;
      res.json(
        await withTransaction(async c => {
          const { scope } = await services.requireStation(
              c,
              actor,
              station,
              READ
            ),
            p = [scope.tenantId, station, range.from, range.to, asOf];
          await validateReportFilters(c, scope.tenantId, station, filters);
          const result = await rows<Row[]>(
            c,
            `SELECT x.product_id,p.name,p.barcode,SUM(x.sold) sold,SUM(x.returned) returned,SUM(x.net) net,SUM(x.cost) cost,SUM(x.missing) missing FROM (
          SELECT l.product_id,l.quantity sold,0 returned,l.net_total_minor net,l.cost_total_minor cost,(l.net_total_minor IS NULL OR l.cost_total_minor IS NULL) missing ${saleFrom} JOIN st_pos_sale_lines l ON l.sale_id=s.id WHERE ${where} AND e.kind='POS_SALE' ${sf.sql}
          UNION ALL SELECT l.product_id,0 sold,l.quantity returned,-l.net_minor net,-l.cost_minor cost,0 missing FROM st_market_entries e JOIN st_market_returns r ON r.entry_id=e.id AND r.station_id=e.station_id JOIN st_market_entries oe ON oe.id=r.source_entry_id AND oe.kind='POS_SALE' JOIN st_pos_sales s ON s.id=oe.source_id AND s.station_id=e.station_id JOIN st_market_return_lines l ON l.return_id=r.id WHERE ${where} AND e.kind='SALE_RETURN' ${sf.sql}
        ) x JOIN st_products p ON p.id=x.product_id ${cursor ? "WHERE x.product_id>?" : ""} GROUP BY x.product_id,p.name,p.barcode ORDER BY x.product_id LIMIT 51`,
            [
              ...p,
              ...sf.params,
              ...p,
              ...sf.params,
              ...(cursor ? [cursor] : []),
            ]
          );
          if (result.some(r => integer(r.missing) > 0))
            fail(
              "REPORT_INCONSISTENT",
              "Ürün satış maliyeti anlık görüntüsü eksik.",
              409
            );
          return {
            asOf,
            rows: result.slice(0, 50).map(r => ({
              id: r.product_id,
              name: r.name,
              barcode: r.barcode,
              soldQty: integer(r.sold),
              returnedQty: integer(r.returned),
              netSalesMinor: integer(r.net),
              cogsMinor: integer(r.cost),
              profitMinor: safeAdd(integer(r.net), -integer(r.cost)),
            })),
            nextCursor: result.length > 50 ? result[49].product_id : null,
          } satisfies SalesProducts;
        })
      );
    } catch (e) {
      services.error(res, e);
    }
  });
  app.get(prefix + "/:saleId", async (req, res) => {
    try {
      const actor = services.actor(req),
        station = requireId(req.query.stationId, "stationId"),
        id = requireId(req.params.saleId, "saleId"),
        asOf = reportSequence(req.query.asOf);
      res.json(
        await withTransaction(async c => {
          const { scope } = await services.requireStation(
            c,
            actor,
            station,
            READ
          );
          const s = await first<Row>(
            c,
            `${saleSelect} WHERE e.tenant_id=? AND e.station_id=? AND e.kind='POS_SALE' AND s.id=? AND e.seq<=?`,
            [scope.tenantId, station, id, asOf]
          );
          if (!s)
            fail(
              "NOT_FOUND",
              "Satış fişi bu rapor kapsamında bulunamadı.",
              404
            );
          const ls = await rows<Row[]>(
            c,
            "SELECT * FROM st_pos_sale_lines WHERE sale_id=? ORDER BY product_name,product_id",
            [id]
          );
          if (
            ls.some(
              l =>
                l.net_total_minor === null ||
                l.vat_minor === null ||
                l.cost_total_minor === null
            )
          )
            fail(
              "REPORT_INCONSISTENT",
              "Fişin mali anlık görüntüsü eksik.",
              409
            );
          const b = await first<Row>(
            c,
            "SELECT COALESCE(SUM(CASE WHEN account_code='SALES' THEN credit_minor-debit_minor ELSE 0 END),0) net,COALESCE(SUM(CASE WHEN account_code='OUTPUT_VAT' THEN credit_minor-debit_minor ELSE 0 END),0) vat,COALESCE(SUM(CASE WHEN account_code='COGS' THEN debit_minor-credit_minor ELSE 0 END),0) cost FROM st_market_lines WHERE entry_id=?",
            [s.entry_id]
          );
          const returns = await rows<Row[]>(
            c,
            "SELECT r.*,e.business_date FROM st_market_returns r JOIN st_market_entries e ON e.id=r.entry_id WHERE r.tenant_id=? AND r.station_id=? AND r.source_entry_id=? AND r.kind='SALE_RETURN' AND e.seq<=? ORDER BY e.seq",
            [scope.tenantId, station, s.entry_id, asOf]
          );
          return validateReportSale({
            ...sale(s),
            deviceId: s.device_id ?? null,
            sessionId: s.session_id,
            netMinor: integer(b?.net),
            vatMinor: integer(b?.vat),
            costMinor: integer(b?.cost),
            lines: ls.map(l => ({
              productId: l.product_id,
              name: l.product_name,
              barcode: l.barcode,
              quantity: integer(l.quantity),
              unitPriceMinor: integer(l.unit_price_minor),
              grossMinor: integer(l.total_minor),
              netMinor: integer(l.net_total_minor),
              vatMinor: integer(l.vat_minor),
              costMinor: integer(l.cost_total_minor),
            })),
            returns: returns.map(r => ({
              id: r.id,
              date: r.business_date,
              reference: r.reference,
              grossMinor: integer(r.gross_minor),
              refundMinor: integer(r.refund_minor),
              creditedMinor: integer(r.credited_minor),
              wallet: r.wallet,
            })),
          } satisfies ReportSaleDetail);
        })
      );
    } catch (e) {
      services.error(res, e);
    }
  });
}

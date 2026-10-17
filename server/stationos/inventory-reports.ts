import type { Express } from "express";
import type { Services, Row } from "./market-pos";
import { first, rows, withTransaction } from "./db";
import { requireId, requireString } from "./domain";
import {
  businessToday,
  calendarDate,
  integer,
} from "./market-accounting-domain";
import { monthRange } from "./inventory-domain";
import { buildMarketDaily } from "./market-report-domain";
import { safeAdd } from "./safety";
import { fail, type StationRole } from "./types";
import type { InventoryMovements, MonthlyReport } from "../../shared/inventory";
const READ: StationRole[] = ["OWNER", "MANAGER", "ACCOUNTANT"];
const signed =
  "CASE WHEN kind IN ('SALE','PURCHASE_RETURN') THEN -quantity ELSE quantity END";
const utc = (date: string) =>
  new Date(date + "T00:00:00+03:00")
    .toISOString()
    .slice(0, 23)
    .replace("T", " ");
const nextDay = (date: string) => {
  const d = new Date(date + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
};
export function registerInventoryReports(app: Express, services: Services) {
  app.get(
    "/api/stationos/market-accounting/inventory/movements",
    async (req, res) => {
      try {
        const actor = services.actor(req),
          station = requireId(req.query.stationId, "stationId"),
          product = requireId(req.query.productId, "productId"),
          from = calendarDate(req.query.from ?? "2000-01-01"),
          to = calendarDate(req.query.to ?? businessToday());
        if (from > to) fail("INVALID_DATE", "Tarih aralığı geçersiz.");
        let cursor: { time: string; id: string } | null = null;
        if (req.query.cursor) {
          try {
            const parsed = JSON.parse(
              Buffer.from(
                requireString(req.query.cursor, "cursor", { max: 512 }),
                "base64url"
              ).toString()
            );
            if (
              typeof parsed.time !== "string" ||
              !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(\.\d{1,3})?$/.test(
                parsed.time
              )
            )
              throw Error();
            cursor = {
              time: parsed.time,
              id: requireId(parsed.id, "cursorId"),
            };
          } catch {
            fail("INVALID_CURSOR", "Hareket imleci geçersiz.");
          }
        }
        res.json(
          await withTransaction(async c => {
            const { scope } = await services.requireStation(
              c,
              actor,
              station,
              READ
            );
            const p = await first<Row>(
              c,
              "SELECT id,name,base_unit,stock_qty FROM st_products WHERE id=? AND station_id=? AND tenant_id=?",
              [product, station, scope.tenantId]
            );
            if (!p) fail("NOT_FOUND", "Ürün bulunamadı.", 404);
            const sums = await first<Row>(
              c,
              `SELECT COALESCE(SUM(CASE WHEN created_at>=? THEN ${signed} ELSE 0 END),0) AS after_from,COALESCE(SUM(CASE WHEN created_at>=? THEN ${signed} ELSE 0 END),0) AS after_to FROM st_stock_movements WHERE station_id=? AND product_id=?`,
              [utc(from), utc(nextDay(to)), station, product]
            );
            const params: unknown[] = [
              station,
              product,
              utc(from),
              utc(nextDay(to)),
            ];
            if (cursor) params.push(cursor.time, cursor.time, cursor.id);
            const selected = await rows<Row[]>(
              c,
              `SELECT m.*,u.name AS actor_name FROM st_stock_movements m JOIN users u ON u.id=m.created_by_user_id WHERE m.station_id=? AND m.product_id=? AND m.created_at>=? AND m.created_at<? ${cursor ? "AND (m.created_at<? OR (m.created_at=? AND m.id<?))" : ""} ORDER BY m.created_at DESC,m.id DESC LIMIT 101`,
              params
            );
            const page = selected.slice(0, 100),
              last = page.at(-1);
            return {
              product: { id: p.id, name: p.name, unit: p.base_unit },
              from,
              to,
              openingQty: safeAdd(
                integer(p.stock_qty),
                -integer(sums?.after_from)
              ),
              closingQty: safeAdd(
                integer(p.stock_qty),
                -integer(sums?.after_to)
              ),
              currentQty: integer(p.stock_qty),
              nextCursor:
                selected.length > 100
                  ? Buffer.from(
                      JSON.stringify({ time: last!.created_at, id: last!.id })
                    ).toString("base64url")
                  : null,
              rows: page.map(m => ({
                id: m.id,
                date: m.created_at,
                kind: m.kind,
                quantity:
                  integer(m.quantity) *
                  (["SALE", "PURCHASE_RETURN"].includes(m.kind) ? -1 : 1),
                reference: m.reference,
                actorName: m.actor_name,
              })),
            } satisfies InventoryMovements;
          })
        );
      } catch (e) {
        services.error(res, e);
      }
    }
  );
  app.get("/api/stationos/market-accounting/monthly", async (req, res) => {
    try {
      const actor = services.actor(req),
        station = requireId(req.query.stationId, "stationId"),
        month = requireString(
          req.query.month ?? businessToday().slice(0, 7),
          "Ay",
          { max: 7 }
        ),
        range = monthRange(month),
        prev = {
          from: range.previousMonth + "-01",
          to: new Date(Date.parse(range.from + "T12:00:00Z") - 86400000)
            .toISOString()
            .slice(0, 10),
        };
      res.json(
        await withTransaction(async c => {
          const { scope } = await services.requireStation(
            c,
            actor,
            station,
            READ
          );
          const book = await first<Row>(
            c,
            "SELECT started_on FROM st_market_books WHERE station_id=? AND tenant_id=?",
            [station, scope.tenantId]
          );
          const amounts = await rows<Row[]>(
            c,
            "SELECT e.business_date AS date,l.account_code,SUM(l.debit_minor-l.credit_minor) AS amount FROM st_market_entries e JOIN st_market_lines l ON l.entry_id=e.id WHERE e.station_id=? AND e.business_date BETWEEN ? AND ? GROUP BY e.business_date,l.account_code",
            [station, prev.from, range.to]
          );
          const stats = await rows<Row[]>(
            c,
            `SELECT e.business_date AS date,COUNT(DISTINCT CASE WHEN e.kind='POS_SALE' THEN e.id END) AS sale_count,
      COALESCE(SUM(CASE WHEN e.kind='PURCHASE' AND l.account_code='INVENTORY' THEN l.debit_minor-l.credit_minor ELSE 0 END),0) AS purchase,
      COALESCE(SUM(CASE WHEN (e.kind='COLLECTION' OR (e.kind='REVERSAL' AND JSON_UNQUOTE(JSON_EXTRACT(e.payload_json,'$.reversesKind'))='COLLECTION')) AND l.account_code='RECEIVABLE' THEN l.credit_minor-l.debit_minor ELSE 0 END),0) AS collection,
      COALESCE(SUM(CASE WHEN (e.kind='PAYMENT' OR (e.kind='REVERSAL' AND JSON_UNQUOTE(JSON_EXTRACT(e.payload_json,'$.reversesKind'))='PAYMENT')) AND l.account_code='PAYABLE' THEN l.debit_minor-l.credit_minor ELSE 0 END),0) AS payment
      FROM st_market_entries e LEFT JOIN st_market_lines l ON l.entry_id=e.id WHERE e.station_id=? AND e.business_date BETWEEN ? AND ? GROUP BY e.business_date`,
            [station, prev.from, range.to]
          );
          const returns = await rows<Row[]>(
            c,
            "SELECT e.business_date AS date,SUM(CASE WHEN r.kind='SALE_RETURN' THEN r.gross_minor ELSE 0 END) AS sale_gross,SUM(CASE WHEN r.kind='PURCHASE_RETURN' THEN r.gross_minor ELSE 0 END) AS purchase_gross,SUM(CASE WHEN r.kind='PURCHASE_RETURN' THEN r.net_minor ELSE 0 END) AS purchase_net,SUM(r.kind='SALE_RETURN') AS sale_count FROM st_market_returns r JOIN st_market_entries e ON e.id=r.entry_id WHERE r.station_id=? AND e.business_date BETWEEN ? AND ? GROUP BY e.business_date",
            [station, prev.from, range.to]
          );
          const daily = (from: string, to: string) => {
            const result = [];
            for (let date = from; date <= to; date = nextDay(date)) {
              const b = Object.fromEntries(
                amounts
                  .filter(a => a.date === date)
                  .map(a => [a.account_code, integer(a.amount)])
              );
              result.push(
                buildMarketDaily(
                  date,
                  b,
                  stats.find(s => s.date === date) ?? {},
                  { n: stats.find(s => s.date === date)?.sale_count ?? 0 },
                  returns.find(r => r.date === date) ?? {}
                )
              );
            }
            return result;
          };
          const current = daily(range.from, range.to),
            previous = daily(prev.from, prev.to);
          const totals = (days: ReturnType<typeof daily>) => {
            const sum = (key: keyof (typeof days)[number]) =>
              days.reduce((s, d) => safeAdd(s, integer(d[key])), 0);
            return {
              netSalesMinor: sum("salesNetMinor"),
              grossSalesMinor: sum("salesGrossMinor"),
              salesReturnsMinor: sum("salesReturnsGrossMinor"),
              cogsMinor: sum("cogsMinor"),
              grossProfitMinor: sum("grossProfitMinor"),
              expensesMinor: sum("expensesMinor"),
              gainsMinor: sum("gainsMinor"),
              resultMinor: sum("operatingResultMinor"),
              netPurchasesMinor: sum("purchasesNetMinor"),
              inputVatMinor: sum("inputVatMinor"),
              outputVatMinor: sum("outputVatMinor"),
              collectionsMinor: sum("collectionsMinor"),
              paymentsMinor: sum("supplierPaymentsMinor"),
              saleCount: sum("saleCount"),
            };
          };
          const balances = await rows<Row[]>(
            c,
            "SELECT l.account_code,SUM(l.debit_minor-l.credit_minor) AS amount FROM st_market_lines l JOIN st_market_entries e ON e.id=l.entry_id WHERE e.station_id=? AND e.business_date<=? GROUP BY l.account_code",
            [station, range.to]
          );
          const closes = await first<Row>(
            c,
            "SELECT COUNT(*) AS n FROM st_market_day_closes WHERE station_id=? AND business_date BETWEEN ? AND ?",
            [station, range.from, range.to]
          );
          const productRows = await rows<Row[]>(
            c,
            `SELECT x.product_id,p.name,SUM(x.qty) AS qty,SUM(x.net) AS net,SUM(x.cost) AS cost FROM (
      SELECT l.product_id,l.quantity AS qty,l.net_total_minor AS net,l.cost_total_minor AS cost FROM st_pos_sale_lines l JOIN st_pos_sales s ON s.id=l.sale_id JOIN st_market_entries e ON e.source_id=s.id AND e.kind='POS_SALE' AND e.station_id=s.station_id WHERE e.station_id=? AND e.business_date BETWEEN ? AND ?
      UNION ALL SELECT l.product_id,-l.quantity,-l.net_minor,-l.cost_minor FROM st_market_return_lines l JOIN st_market_returns r ON r.id=l.return_id JOIN st_market_entries e ON e.id=r.entry_id WHERE r.station_id=? AND r.kind='SALE_RETURN' AND e.business_date BETWEEN ? AND ?
      ) x JOIN st_products p ON p.id=x.product_id GROUP BY x.product_id,p.name ORDER BY SUM(x.net-x.cost) DESC,p.name LIMIT 100`,
            [station, range.from, range.to, station, range.from, range.to]
          );
          return {
            startedOn: book?.started_on ?? null,
            month,
            from: range.from,
            to: range.to,
            previousMonth: range.previousMonth,
            closedDays: integer(closes?.n),
            totalDays: range.totalDays,
            totals: totals(current),
            previous: totals(previous),
            days: current.map(d => ({
              date: d.date,
              netSalesMinor: d.salesNetMinor,
              cogsMinor: d.cogsMinor,
              expensesMinor: d.expensesMinor,
              resultMinor: d.operatingResultMinor,
            })),
            balances: Object.fromEntries(
              balances.map(b => [b.account_code, integer(b.amount)])
            ),
            products: productRows.map(p => ({
              id: p.product_id,
              name: p.name,
              quantity: integer(p.qty),
              netSalesMinor: integer(p.net),
              costMinor: integer(p.cost),
              profitMinor: safeAdd(integer(p.net), -integer(p.cost)),
            })),
          } satisfies MonthlyReport;
        })
      );
    } catch (e) {
      services.error(res, e);
    }
  });
}

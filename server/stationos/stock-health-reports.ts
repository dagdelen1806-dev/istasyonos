import { createHash } from "node:crypto";
import type { Express } from "express";
import type { Services, Row } from "./market-pos";
import { first, rows, withTransaction } from "./db";
import { requireId, requireEnum, requireString } from "./domain";
import { businessToday, integer } from "./market-accounting-domain";
import { fail } from "./types";
import { safeAdd } from "./safety";
import { inactivity, validateStock, marginItem } from "./stock-health-domain";
import { reportRange, reportSequence } from "./sales-report-domain";
import type {
  StockHealthReport,
  StockHealthItem,
  MarginReport,
  MarginMode,
} from "../../shared/stock-health";
const prefix = "/api/stationos/market-accounting/reports";
export function registerStockHealthReports(app: Express, services: Services) {
  app.get(prefix + "/stock-health", async (req, res) => {
    try {
      const actor = services.actor(req),
        station = requireId(req.query.stationId, "stationId"),
        today = businessToday();
      const age = Number(
          requireEnum(req.query.ageDays ?? "30", "Satışsız gün", [
            "30",
            "60",
            "90",
          ] as const)
        ),
        mode = requireEnum(req.query.mode ?? "ALL", "Stok görünümü", [
          "ALL",
          "INACTIVE",
          "UNOBSERVED",
          "NO_STOCK",
        ] as const);
      const search =
          req.query.search === undefined || req.query.search === ""
            ? ""
            : requireString(req.query.search, "Arama", { max: 190 }),
        cursor = req.query.cursor
          ? requireId(req.query.cursor, "cursor")
          : null;
      const expected = req.query.snapshot
        ? requireString(req.query.snapshot, "Stok görüntüsü", { max: 64 })
        : null;
      if (cursor && !expected)
        fail("INVALID_CURSOR", "Stok sayfalaması görüntü kimliği ister.");
      res.json(
        await withTransaction(async c => {
          const { scope } = await services.requireStation(c, actor, station, [
            "OWNER",
            "MANAGER",
            "ACCOUNTANT",
          ]);
          const book = await first<Row>(
            c,
            "SELECT started_on,revision FROM st_market_books WHERE tenant_id=? AND station_id=?",
            [scope.tenantId, station]
          );
          if (!book)
            fail(
              "MARKET_BOOK_REQUIRED",
              "Stok değer raporu için önce market ticari defterini açın.",
              409
            );
          const records = await rows<Row[]>(
            c,
            `SELECT p.id,p.name,p.barcode,p.base_unit,p.category,p.stock_qty,p.lot_tracking,DATE(DATE_ADD(p.created_at,INTERVAL 3 HOUR)) created_on,i.quantity inventory_qty,i.value_minor,COALESCE(l.qty,0) lot_qty,COALESCE(l.saleable,0) saleable,s.last_sale FROM st_products p LEFT JOIN st_market_inventory i ON i.product_id=p.id AND i.station_id=p.station_id LEFT JOIN (SELECT product_id,SUM(quantity) qty,SUM(CASE WHEN status='AVAILABLE' AND expiry_date>=? THEN quantity ELSE 0 END) saleable FROM st_inventory_lots WHERE station_id=? GROUP BY product_id) l ON l.product_id=p.id LEFT JOIN (SELECT sl.product_id,MAX(e.business_date) last_sale FROM st_market_entries e JOIN st_pos_sales ps ON ps.id=e.source_id AND ps.station_id=e.station_id JOIN st_pos_sale_lines sl ON sl.sale_id=ps.id WHERE e.tenant_id=? AND e.station_id=? AND e.kind='POS_SALE' AND e.business_date<=? GROUP BY sl.product_id) s ON s.product_id=p.id WHERE p.tenant_id=? AND p.station_id=? ORDER BY p.id LIMIT 5001`,
            [
              today,
              station,
              scope.tenantId,
              station,
              today,
              scope.tenantId,
              station,
            ]
          );
          if (records.length > 5000)
            fail(
              "REPORT_LIMIT",
              "Stok analizi en fazla 5.000 ürün destekler; katalog kesilerek gösterilmedi.",
              409
            );
          const items: StockHealthItem[] = records.map(p => {
            const quantity = integer(p.stock_qty),
              valueMinor = integer(p.value_minor),
              saleableQty = p.lot_tracking ? integer(p.saleable) : quantity;
            validateStock(
              quantity,
              valueMinor,
              integer(p.inventory_qty),
              saleableQty,
              p.lot_tracking ? integer(p.lot_qty) : null
            );
            return {
              id: p.id,
              name: p.name,
              barcode: p.barcode,
              unit: p.base_unit,
              category: p.category,
              quantity,
              valueMinor,
              saleableQty,
              blockedQty: quantity - saleableQty,
              lastSaleDate: p.last_sale ?? null,
              ...inactivity(
                today,
                book.started_on,
                p.created_on,
                p.last_sale ?? null,
                quantity,
                age
              ),
            };
          });
          const valueMinor = items.reduce(
            (s, p) => safeAdd(s, p.valueMinor),
            0
          );
          const balance = await first<Row>(
            c,
            "SELECT COALESCE(SUM(balance_minor),0) amount FROM st_market_balances WHERE station_id=? AND account_code='INVENTORY'",
            [station]
          );
          if (valueMinor !== integer(balance?.amount))
            fail(
              "REPORT_INCONSISTENT",
              "Mali stok değeri ile defter stok bakiyesi uyuşmuyor.",
              409
            );
          // The hash excludes display filtering so page changes cannot mix live catalog states.
          const snapshot = createHash("sha256")
            .update(
              JSON.stringify({
                station,
                today,
                revision: book.revision,
                items: items.map(({ status, ...p }) => p),
              })
            )
            .digest("hex");
          if (expected && expected !== snapshot)
            fail(
              "REPORT_CHANGED",
              "Stok veya ürün bilgisi değişti; raporu ilk sayfadan yenileyin.",
              409
            );
          const totals: StockHealthReport["totals"] = {
            catalogProducts: items.length,
            stockedProducts: items.filter(p => p.quantity > 0).length,
            valueMinor,
            blockedProducts: items.filter(p => p.blockedQty > 0).length,
            inactive30: 0,
            inactive30Minor: 0,
            inactive60: 0,
            inactive60Minor: 0,
            inactive90: 0,
            inactive90Minor: 0,
          };
          for (const n of [30, 60, 90] as const) {
            const set = items.filter(
              p => p.quantity > 0 && p.observedDays >= n && p.noSaleDays >= n
            );
            totals[`inactive${n}`] = set.length;
            totals[`inactive${n}Minor`] = set.reduce(
              (s, p) => safeAdd(s, p.valueMinor),
              0
            );
          }
          const matching = items.filter(
            p =>
              (mode === "ALL" || p.status === mode) &&
              (!search ||
                `${p.name} ${p.barcode} ${p.category}`
                  .toLocaleLowerCase("tr-TR")
                  .includes(search.toLocaleLowerCase("tr-TR")))
          );
          const page = matching
            .filter(p => !cursor || p.id > cursor)
            .slice(0, 51);
          return {
            today,
            generatedAt: new Date().toISOString(),
            startedOn: book.started_on,
            bookRevision: integer(book.revision),
            snapshot,
            ageDays: age,
            mode,
            search,
            totals,
            matched: {
              products: matching.length,
              valueMinor: matching.reduce(
                (s, p) => safeAdd(s, p.valueMinor),
                0
              ),
            },
            rows: page.slice(0, 50),
            nextCursor: page.length > 50 ? page[49].id : null,
          } satisfies StockHealthReport;
        })
      );
    } catch (e) {
      services.error(res, e);
    }
  });
  app.get(prefix + "/margin-alerts", async (req, res) => {
    try {
      const actor = services.actor(req),
        station = requireId(req.query.stationId, "stationId"),
        today = businessToday(),
        range = reportRange(
          req.query.from ?? today.slice(0, 7) + "-01",
          req.query.to ?? today
        );
      const raw = req.query.thresholdBps ?? "1000";
      if (
        typeof raw !== "string" ||
        !/^\d{1,5}$/.test(raw) ||
        Number(raw) > 10000
      )
        fail("INVALID_FILTER", "Marj eşiği 0–10000 baz puan olmalı.");
      const threshold = Number(raw);
      const mode = requireEnum(req.query.mode ?? "ALERTS", "Marj görünümü", [
          "ALL",
          "ALERTS",
          "LOSS",
        ] as const) as MarginMode,
        cursor = req.query.cursor
          ? requireId(req.query.cursor, "cursor")
          : null;
      if (cursor && !req.query.asOf)
        fail("INVALID_CURSOR", "Marj sayfalaması kayıt sınırı ister.");
      res.json(
        await withTransaction(async c => {
          const { scope } = await services.requireStation(c, actor, station, [
            "OWNER",
            "MANAGER",
            "ACCOUNTANT",
          ]);
          const boundary = await first<Row>(
            c,
            "SELECT COALESCE(MAX(seq),0) seq FROM st_market_entries WHERE tenant_id=? AND station_id=?",
            [scope.tenantId, station]
          );
          const asOf = req.query.asOf
            ? reportSequence(req.query.asOf)
            : String(boundary!.seq);
          if (BigInt(asOf) > BigInt(boundary!.seq))
            fail(
              "INVALID_CURSOR",
              "Marj kayıt sınırı mevcut kayıtlardan ileride."
            );
          const p = [scope.tenantId, station, range.from, range.to, asOf];
          const records = await rows<Row[]>(
            c,
            `SELECT x.product_id,p.name,p.barcode,p.base_unit,SUM(x.sold_qty) sold_qty,SUM(x.returned_qty) returned_qty,SUM(x.sales_net) sales_net,SUM(x.sales_cost) sales_cost,SUM(x.return_net) return_net,SUM(x.return_cost) return_cost,SUM(x.missing) missing,SUM(x.loss_lines) loss_lines,SUM(x.low_lines) low_lines,MIN(x.loss_sale) loss_sale FROM (
      SELECT l.product_id,l.quantity sold_qty,0 returned_qty,l.net_total_minor sales_net,l.cost_total_minor sales_cost,0 return_net,0 return_cost,(l.net_total_minor IS NULL OR l.cost_total_minor IS NULL) missing,(l.net_total_minor<l.cost_total_minor) loss_lines,(l.net_total_minor>0 AND l.net_total_minor>=l.cost_total_minor AND CAST(l.net_total_minor-l.cost_total_minor AS DECIMAL(38,0))*10000<CAST(l.net_total_minor AS DECIMAL(38,0))*?) low_lines,CASE WHEN l.net_total_minor<l.cost_total_minor THEN s.id ELSE NULL END loss_sale FROM st_market_entries e JOIN st_pos_sales s ON s.id=e.source_id AND s.station_id=e.station_id JOIN st_pos_sale_lines l ON l.sale_id=s.id WHERE e.tenant_id=? AND e.station_id=? AND e.business_date BETWEEN ? AND ? AND e.seq<=? AND e.kind='POS_SALE'
      UNION ALL SELECT l.product_id,0 sold_qty,l.quantity returned_qty,0 sales_net,0 sales_cost,l.net_minor return_net,l.cost_minor return_cost,0 missing,0 loss_lines,0 low_lines,NULL loss_sale FROM st_market_entries e JOIN st_market_returns r ON r.entry_id=e.id AND r.station_id=e.station_id JOIN st_market_return_lines l ON l.return_id=r.id WHERE e.tenant_id=? AND e.station_id=? AND e.business_date BETWEEN ? AND ? AND e.seq<=? AND e.kind='SALE_RETURN'
    ) x JOIN st_products p ON p.id=x.product_id GROUP BY x.product_id,p.name,p.barcode,p.base_unit ORDER BY x.product_id LIMIT 5001`,
            [threshold, ...p, ...p]
          );
          if (records.length > 5000)
            fail(
              "REPORT_LIMIT",
              "Marj analizi en fazla 5.000 ürün destekler; tarih aralığını daraltın.",
              409
            );
          if (records.some(r => integer(r.missing) > 0))
            fail(
              "REPORT_INCONSISTENT",
              "Satışın kayıtlı net tutarı/maliyeti eksik; bugünkü maliyetten tamamlanmadı.",
              409
            );
          const items = records.map(r =>
            marginItem(
              {
                id: r.product_id,
                name: r.name,
                barcode: r.barcode,
                unit: r.base_unit,
                soldQty: integer(r.sold_qty),
                returnedQty: integer(r.returned_qty),
                salesNetMinor: integer(r.sales_net),
                salesCostMinor: integer(r.sales_cost),
                returnsNetMinor: integer(r.return_net),
                returnsCostMinor: integer(r.return_cost),
                lossLines: integer(r.loss_lines),
                lowLines: integer(r.low_lines),
                sampleLossSaleId: r.loss_sale ?? null,
              },
              threshold
            )
          );
          const matching = items.filter(
              p =>
                mode === "ALL" ||
                (mode === "LOSS"
                  ? p.status === "LOSS"
                  : ["LOSS", "LOW"].includes(p.status))
            ),
            page = matching.filter(p => !cursor || p.id > cursor).slice(0, 51);
          const sum = (
            key:
              | "netSalesMinor"
              | "cogsMinor"
              | "grossProfitMinor"
              | "lossLines"
              | "lowLines"
          ) => items.reduce((s, p) => safeAdd(s, p[key]), 0);
          const ledger = await first<Row>(
            c,
            "SELECT COALESCE(SUM(CASE WHEN l.account_code IN ('SALES','SALES_RETURNS') THEN l.credit_minor-l.debit_minor ELSE 0 END),0) net,COALESCE(SUM(CASE WHEN l.account_code='COGS' THEN l.debit_minor-l.credit_minor ELSE 0 END),0) cost FROM st_market_entries e JOIN st_market_lines l ON l.entry_id=e.id WHERE e.tenant_id=? AND e.station_id=? AND e.business_date BETWEEN ? AND ? AND e.seq<=?",
            p
          );
          if (
            sum("netSalesMinor") !== integer(ledger?.net) ||
            sum("cogsMinor") !== integer(ledger?.cost)
          )
            fail(
              "REPORT_INCONSISTENT",
              "Marj kaynakları ile mali defter uyuşmuyor; bugünkü maliyetten tamamlanmadı.",
              409
            );

          return {
            from: range.from,
            to: range.to,
            generatedAt: new Date().toISOString(),
            asOf,
            thresholdBps: threshold,
            mode,
            totals: {
              products: items.length,
              lossProducts: items.filter(p => p.status === "LOSS").length,
              lowProducts: items.filter(p => p.status === "LOW").length,
              lossLines: sum("lossLines"),
              lowLines: sum("lowLines"),
              netSalesMinor: sum("netSalesMinor"),
              cogsMinor: sum("cogsMinor"),
              grossProfitMinor: sum("grossProfitMinor"),
            },
            matched: matching.length,
            rows: page.slice(0, 50),
            nextCursor: page.length > 50 ? page[49].id : null,
          } satisfies MarginReport;
        })
      );
    } catch (e) {
      services.error(res, e);
    }
  });
}

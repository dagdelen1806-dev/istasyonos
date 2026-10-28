import { createHash } from "node:crypto";
import type { Express } from "express";
import type { Row, Services } from "./market-pos";
import { first, rows, withTransaction } from "./db";
import { requireId, requireString, requireEnum } from "./domain";
import { businessToday, integer } from "./market-accounting-domain";
import { safeAdd } from "./safety";
import { fail } from "./types";
import { reportRange, reportSequence } from "./sales-report-domain";
import { lotRisk, lossItems } from "./lot-control-domain";
import type {
  LotControl,
  ControlLot,
  LossReport,
  LossRow,
} from "../../shared/lot-control";
const prefix = "/api/stationos/market-accounting/reports";
export function registerLotControl(app: Express, services: Services) {
  app.get(prefix + "/lot-control", async (req, res) => {
    try {
      const actor = services.actor(req),
        station = requireId(req.query.stationId, "stationId"),
        today = businessToday(),
        horizon = Number(
          requireEnum(req.query.horizon ?? "7", "SKT ufku", [
            "7",
            "15",
            "30",
          ] as const)
        ),
        mode = requireEnum(req.query.mode ?? "ALL", "Parti görünümü", [
          "ALL",
          "NEAR",
          "EXPIRED",
          "QUARANTINE",
          "UNKNOWN",
        ] as const);
      const search = req.query.search
          ? requireString(req.query.search, "Parti araması", { max: 190 })
          : "",
        productId = req.query.productId
          ? requireId(req.query.productId, "Ürün")
          : "",
        cursor = req.query.cursor
          ? requireId(req.query.cursor, "cursor")
          : null,
        expected = req.query.snapshot
          ? requireString(req.query.snapshot, "Görüntü", { max: 64 })
          : null;
      if (cursor && !expected)
        fail("INVALID_CURSOR", "Parti sayfalaması görüntü kimliği ister.");
      res.json(
        await withTransaction(async c => {
          const { scope } = await services.requireStation(c, actor, station, [
            "OWNER",
            "MANAGER",
            "ACCOUNTANT",
          ]);
          const products = await rows<Row[]>(
            c,
            "SELECT p.id,p.name,p.barcode,p.base_unit,p.stock_qty,p.stock_version,i.quantity inventory_qty FROM st_products p LEFT JOIN st_market_inventory i ON i.product_id=p.id AND i.station_id=p.station_id WHERE p.tenant_id=? AND p.station_id=? AND p.lot_tracking=TRUE ORDER BY p.id LIMIT 5001",
            [scope.tenantId, station]
          );
          if (products.length > 5000)
            fail(
              "REPORT_LIMIT",
              "Parti kontrolü en fazla 5.000 takipli ürün destekler.",
              409
            );
          const pm = new Map(products.map(p => [p.id, p]));
          if (productId && !pm.has(productId))
            fail("NOT_FOUND", "Takipli ürün bu istasyonda bulunamadı.", 404);
          const ls = await rows<Row[]>(
            c,
            `SELECT l.*,u.name status_actor,e.created_at status_time,e.detail_json status_detail FROM st_inventory_lots l JOIN st_products p ON p.id=l.product_id AND p.station_id=l.station_id LEFT JOIN (SELECT lot_id,MAX(id) id FROM st_inventory_lot_events WHERE station_id=? AND kind='STATUS' GROUP BY lot_id) x ON x.lot_id=l.id LEFT JOIN st_inventory_lot_events e ON e.id=x.id LEFT JOIN users u ON u.id=e.actor_user_id WHERE l.tenant_id=? AND l.station_id=? AND p.lot_tracking=TRUE AND l.quantity>0 ORDER BY l.id LIMIT 10001`,
            [station, scope.tenantId, station]
          );
          if (ls.length > 10000)
            fail(
              "REPORT_LIMIT",
              "Parti kontrolü en fazla 10.000 stoklu parti destekler.",
              409
            );
          const qty = new Map<string, number>();
          const items: ControlLot[] = ls.map(l => {
            const p = pm.get(l.product_id);
            if (!p)
              fail(
                "REPORT_INCONSISTENT",
                "Parti ürünü rapor kapsamında yok.",
                409
              );
            const quantity = integer(l.quantity);
            qty.set(
              l.product_id,
              safeAdd(qty.get(l.product_id) ?? 0, quantity)
            );
            let detail: any = null;
            try {
              detail =
                typeof l.status_detail === "string"
                  ? JSON.parse(l.status_detail)
                  : l.status_detail;
            } catch {}
            const r = lotRisk(today, l.expiry_date, l.status);
            return {
              id: l.id,
              productId: l.product_id,
              name: p.name,
              barcode: p.barcode,
              unit: p.base_unit,
              code: l.code,
              expiryDate: l.expiry_date,
              daysLeft: r.daysLeft,
              status: l.status,
              quantity,
              saleable: r.saleable,
              lastStatusAt: l.status_time ?? null,
              lastStatusBy: l.status_actor ?? null,
              lastStatusReason:
                typeof detail?.reason === "string" ? detail.reason : null,
            };
          });
          for (const p of products)
            if (
              integer(p.stock_qty) !== (qty.get(p.id) ?? 0) ||
              integer(p.stock_qty) !== integer(p.inventory_qty)
            )
              fail(
                "REPORT_INCONSISTENT",
                "Parti, ürün ve mali stok miktarları uyuşmuyor.",
                409
              );
          const book = await first<Row>(
            c,
            "SELECT revision FROM st_market_books WHERE tenant_id=? AND station_id=?",
            [scope.tenantId, station]
          );
          const snapshot = createHash("sha256")
            .update(
              JSON.stringify({
                station,
                today,
                revision: book?.revision ?? null,
                products,
                items,
              })
            )
            .digest("hex");
          if (expected && snapshot !== expected)
            fail(
              "REPORT_CHANGED",
              "Parti veya ürün durumu değişti; raporu ilk sayfadan yenileyin.",
              409
            );
          const near = (l: ControlLot, n: number) =>
            l.saleable && l.daysLeft !== null && l.daysLeft <= n;
          const totals = {
            lots: items.length,
            products: new Set(items.map(l => l.productId)).size,
            near7: items.filter(l => near(l, 7)).length,
            near15: items.filter(l => near(l, 15)).length,
            near30: items.filter(l => near(l, 30)).length,
            expired: items.filter(l => l.daysLeft !== null && l.daysLeft < 0)
              .length,
            quarantine: items.filter(l => l.status === "QUARANTINE").length,
            unknown: items.filter(l => l.expiryDate === null).length,
            blocked: items.filter(l => !l.saleable).length,
          };
          const matching = items
            .filter(
              l =>
                (!productId || l.productId === productId) &&
                (!search ||
                  `${l.name} ${l.barcode} ${l.code}`
                    .toLocaleLowerCase("tr-TR")
                    .includes(search.toLocaleLowerCase("tr-TR"))) &&
                (mode === "ALL" ||
                  (mode === "NEAR"
                    ? near(l, horizon)
                    : mode === "EXPIRED"
                      ? l.daysLeft !== null && l.daysLeft < 0
                      : mode === "QUARANTINE"
                        ? l.status === "QUARANTINE"
                        : l.expiryDate === null))
            )
            .sort(
              (a, b) =>
                (a.expiryDate ?? "9999-12-31").localeCompare(
                  b.expiryDate ?? "9999-12-31"
                ) || a.id.localeCompare(b.id)
            );
          const index = cursor ? matching.findIndex(l => l.id === cursor) : -1;
          if (cursor && index < 0)
            fail("INVALID_CURSOR", "Parti sayfası filtreyle uyuşmuyor.");
          const page = matching.slice(index + 1, index + 52);
          return {
            today,
            generatedAt: new Date().toISOString(),
            snapshot,
            horizon,
            mode,
            search,
            productId,
            products: products.map(p => ({ id: p.id, name: p.name })),
            totals,
            matched: matching.length,
            rows: page.slice(0, 50),
            nextCursor: page.length > 50 ? page[49].id : null,
          } satisfies LotControl;
        })
      );
    } catch (e) {
      services.error(res, e);
    }
  });
  app.get(prefix + "/inventory-losses", async (req, res) => {
    try {
      const actor = services.actor(req),
        station = requireId(req.query.stationId, "stationId"),
        today = businessToday(),
        range = reportRange(
          req.query.from ?? today.slice(0, 7) + "-01",
          req.query.to ?? today
        ),
        kind = requireEnum(req.query.kind ?? "ALL", "İşlem türü", [
          "ALL",
          "WRITE_OFF",
          "COUNT",
        ] as const),
        productId = req.query.productId
          ? requireId(req.query.productId, "Ürün")
          : "";
      let cursor: { seq: string; productId: string } | null = null;
      if (req.query.cursor) {
        try {
          if (
            typeof req.query.cursor !== "string" ||
            req.query.cursor.length > 256
          )
            throw Error();
          const v = JSON.parse(
            Buffer.from(req.query.cursor, "base64url").toString()
          );
          cursor = {
            seq: reportSequence(v.seq),
            productId: requireId(v.productId, "Ürün"),
          };
        } catch {
          fail("INVALID_CURSOR", "Fire/sayım imleci geçersiz.");
        }
        if (!req.query.asOf)
          fail("INVALID_CURSOR", "Sayfalama kayıt sınırı ister.");
      }
      res.json(
        await withTransaction(async c => {
          const { scope } = await services.requireStation(c, actor, station, [
            "OWNER",
            "MANAGER",
            "ACCOUNTANT",
          ]);
          if (
            productId &&
            !(await first(
              c,
              "SELECT id FROM st_products WHERE id=? AND tenant_id=? AND station_id=?",
              [productId, scope.tenantId, station]
            ))
          )
            fail("NOT_FOUND", "Ürün bu istasyonda yok.", 404);
          const boundary = await first<Row>(
            c,
            "SELECT COALESCE(MAX(seq),0) seq FROM st_market_entries WHERE tenant_id=? AND station_id=?",
            [scope.tenantId, station]
          );
          const asOf = req.query.asOf
            ? reportSequence(req.query.asOf)
            : String(boundary!.seq);
          if (BigInt(asOf) > BigInt(boundary!.seq))
            fail("INVALID_CURSOR", "Kayıt sınırı mevcut kayıtlardan ileride.");
          const es = await rows<Row[]>(
            c,
            `SELECT e.*,u.name actor_name,(SELECT COALESCE(SUM(l.credit_minor-l.debit_minor),0) FROM st_market_lines l WHERE l.entry_id=e.id AND l.account_code='STOCK_GAIN') gain_minor,(SELECT COALESCE(SUM(l.debit_minor-l.credit_minor),0) FROM st_market_lines l WHERE l.entry_id=e.id AND l.account_code='STOCK_LOSS') loss_minor FROM st_market_entries e JOIN users u ON u.id=e.actor_user_id WHERE e.tenant_id=? AND e.station_id=? AND e.business_date BETWEEN ? AND ? AND e.seq<=? AND e.kind IN ('LOT_WRITE_OFF','LOT_COUNT','STOCK_ADJUST','STOCK_COUNT') ${kind === "WRITE_OFF" ? "AND e.kind='LOT_WRITE_OFF'" : kind === "COUNT" ? "AND e.kind<>'LOT_WRITE_OFF'" : ""} ORDER BY e.seq DESC LIMIT 1001`,
            [scope.tenantId, station, range.from, range.to, asOf]
          );
          if (es.length > 1000)
            fail(
              "REPORT_LIMIT",
              "Fire/sayım raporu en fazla 1.000 fiş destekler; aralığı daraltın.",
              409
            );
          const decoded: { e: Row; items: ReturnType<typeof lossItems> }[] = [];
          let decodedRows = 0;
          for (const e of es) {
            const items = lossItems(
              e.kind,
              e.payload_json,
              integer(e.gain_minor),
              integer(e.loss_minor)
            );
            decodedRows += items.length;
            if (decodedRows > 20000)
              fail(
                "REPORT_LIMIT",
                "Fire/sayım ürün ayrıntısı sınırı aşıldı.",
                409
              );
            decoded.push({ e, items });
          }
          const ids = [
              ...new Set(decoded.flatMap(d => d.items.map(p => p.productId))),
            ],
            lids = [
              ...new Set(
                decoded.flatMap(d =>
                  d.items.flatMap(p => p.lots.map(l => l.id))
                )
              ),
            ];
          if (
            ids.length > 20000 ||
            lids.length > 20000 ||
            decoded.reduce((n, d) => n + d.items.length, 0) > 20000
          )
            fail(
              "REPORT_LIMIT",
              "Fire/sayım ürün ayrıntısı sınırı aşıldı.",
              409
            );
          const ps = ids.length
              ? await rows<Row[]>(
                  c,
                  `SELECT id,name,barcode,base_unit FROM st_products WHERE station_id=? AND id IN (${ids.map(() => "?").join(",")})`,
                  [station, ...ids]
                )
              : [],
            ls = lids.length
              ? await rows<Row[]>(
                  c,
                  `SELECT id,code,expiry_date,status FROM st_inventory_lots WHERE station_id=? AND id IN (${lids.map(() => "?").join(",")})`,
                  [station, ...lids]
                )
              : [];
          const pm = new Map(ps.map(p => [p.id, p])),
            lm = new Map(ls.map(l => [l.id, l]));
          const all: LossRow[] = decoded.flatMap(({ e, items }) =>
            items
              .filter(p => !productId || p.productId === productId)
              .sort((a, b) => a.productId.localeCompare(b.productId))
              .map(p => {
                const card = pm.get(p.productId);
                return {
                  entryId: e.id,
                  sequence: String(e.seq),
                  date: e.business_date,
                  recordedAt: e.created_at,
                  kind: e.kind,
                  reason: e.description,
                  actorName: e.actor_name,
                  productId: p.productId,
                  name: p.label?.name ?? card?.name ?? p.productId,
                  barcode: p.label?.barcode ?? card?.barcode ?? "",
                  unit: p.label?.unit ?? card?.base_unit ?? "",
                  labelSource: p.label
                    ? "SNAPSHOT"
                    : card
                      ? "CURRENT_CARD"
                      : "UNAVAILABLE",
                  before: p.before,
                  after: p.after,
                  delta: p.delta,
                  gainMinor: p.gainMinor,
                  lossMinor: p.lossMinor,
                  lots: p.lots.map(l => {
                    const live = lm.get(l.id);
                    return {
                      id: l.id,
                      code: l.historical ? l.code! : (live?.code ?? l.id),
                      expiryDate: l.historical
                        ? l.expiryDate
                        : (live?.expiry_date ?? null),
                      status: l.historical ? l.status : (live?.status ?? null),
                      before: l.before,
                      after: l.after,
                      delta: l.delta,
                      labelSource: l.historical
                        ? "SNAPSHOT"
                        : live
                          ? "CURRENT_CARD"
                          : "UNAVAILABLE",
                    };
                  }),
                };
              })
          );
          const page = all
            .filter(
              p =>
                !cursor ||
                BigInt(p.sequence) < BigInt(cursor.seq) ||
                (p.sequence === cursor.seq && p.productId > cursor.productId)
            )
            .slice(0, 51);
          return {
            from: range.from,
            to: range.to,
            asOf,
            kind,
            productId,
            products: ids.map(id => ({ id, name: pm.get(id)?.name ?? id })),
            totals: {
              entries: new Set(all.map(p => p.entryId)).size,
              productRows: all.length,
              writeOffMinor: all
                .filter(p => p.kind === "LOT_WRITE_OFF")
                .reduce((n, p) => safeAdd(n, p.lossMinor), 0),
              countGainMinor: all
                .filter(p => p.kind !== "LOT_WRITE_OFF")
                .reduce((n, p) => safeAdd(n, p.gainMinor), 0),
              countLossMinor: all
                .filter(p => p.kind !== "LOT_WRITE_OFF")
                .reduce((n, p) => safeAdd(n, p.lossMinor), 0),
            },
            rows: page.slice(0, 50),
            nextCursor:
              page.length > 50
                ? Buffer.from(
                    JSON.stringify({
                      seq: page[49].sequence,
                      productId: page[49].productId,
                    })
                  ).toString("base64url")
                : null,
          } satisfies LossReport;
        })
      );
    } catch (e) {
      services.error(res, e);
    }
  });
}

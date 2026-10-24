import { randomUUID } from "node:crypto";
import type { Express } from "express";
import type { MarketPost } from "./market-route-types";
import type { Services, Row } from "./market-pos";
import { execute, first, rows, withTransaction } from "./db";
import {
  requireId,
  requireString,
  requireInteger,
  requireMoney,
  requireBoolean,
  optionalString,
} from "./domain";
import {
  businessToday,
  integer,
  vatRate,
  ratioRound,
} from "./market-accounting-domain";
import { stockSuggestion, estimateOrder } from "./inventory-domain";
import { safeAdd } from "./safety";
import { fail, type StationRole } from "./types";
import type { InventoryState, InventoryItem } from "../../shared/inventory";
const READ: StationRole[] = ["OWNER", "MANAGER", "ACCOUNTANT"];

export function registerInventory(
  app: Express,
  services: Services,
  post: MarketPost
) {
  app.get("/api/stationos/market-accounting/inventory", async (req, res) => {
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
          const products = await rows<Row[]>(
            c,
            "SELECT p.*,mb.station_id AS book_id,i.value_minor,(SELECT COALESCE(SUM(ol.ordered_qty-ol.received_qty),0) FROM st_purchase_order_lines ol JOIN st_purchase_orders o ON o.id=ol.order_id WHERE ol.product_id=p.id AND o.station_id=p.station_id AND o.status IN ('APPROVED','PARTIAL')) AS on_order_qty,(SELECT COALESCE(SUM(l.quantity),0) FROM st_inventory_lots l WHERE l.product_id=p.id AND l.status='AVAILABLE' AND l.expiry_date>=?) AS saleable_qty,s.name AS supplier_name,s.payable_limit_minor,COALESCE(b.balance_minor,0) AS supplier_balance FROM st_products p LEFT JOIN st_market_books mb ON mb.station_id=p.station_id LEFT JOIN st_market_inventory i ON i.product_id=p.id LEFT JOIN st_market_parties s ON s.id=p.market_supplier_id LEFT JOIN st_market_balances b ON b.station_id=p.station_id AND b.account_code='PAYABLE' AND b.party_key=s.id AND b.register_key='' WHERE p.tenant_id=? AND p.station_id=? ORDER BY p.name LIMIT 5000",
            [businessToday(), scope.tenantId, station]
          );
          const sold = await rows<Row[]>(
            c,
            "SELECT product_id,SUM(CASE WHEN kind='SALE' THEN quantity ELSE -quantity END) AS qty FROM st_stock_movements WHERE station_id=? AND kind IN ('SALE','SALE_RETURN') AND created_at>=DATE_SUB(UTC_TIMESTAMP(3),INTERVAL 28 DAY) GROUP BY product_id",
            [station]
          );
          const saleMap = new Map(
            sold.map(x => [x.product_id, integer(x.qty)])
          );
          const remaining = new Map<string, number | null>();
          const items = products
            .map(p => {
              const quantity = integer(p.stock_qty),
                value = p.book_id
                  ? integer(p.value_minor)
                  : ratioRound(integer(p.purchase_price_minor), quantity, 1),
                sales = Math.max(0, saleMap.get(p.id) ?? 0);
              const s = stockSuggestion(
                p.lot_tracking ? integer(p.saleable_qty) : quantity,
                integer(p.minimum_qty),
                integer(p.maximum_qty),
                sales,
                integer(p.lead_days),
                integer(p.review_days),
                integer(p.safety_days),
                integer(p.order_pack_qty)
              );
              const planned = stockSuggestion(
                safeAdd(
                  p.lot_tracking ? integer(p.saleable_qty) : quantity,
                  integer(p.on_order_qty)
                ),
                integer(p.minimum_qty),
                integer(p.maximum_qty),
                sales,
                integer(p.lead_days),
                integer(p.review_days),
                integer(p.safety_days),
                integer(p.order_pack_qty)
              );
              const unit =
                p.last_purchase_net_minor === null
                  ? quantity
                    ? ratioRound(value, 1, quantity)
                    : integer(p.purchase_price_minor)
                  : integer(p.last_purchase_net_minor);
              const estimate = estimateOrder(
                planned.quantity,
                unit,
                p.purchase_vat_bps === null ? null : integer(p.purchase_vat_bps)
              );
              if (p.market_supplier_id && !remaining.has(p.market_supplier_id))
                remaining.set(
                  p.market_supplier_id,
                  p.payable_limit_minor === null
                    ? null
                    : Math.max(
                        0,
                        safeAdd(
                          integer(p.payable_limit_minor),
                          integer(p.supplier_balance)
                        )
                      )
                );
              return {
                id: p.id,
                catalogCode: p.catalog_code ?? null,
                name: p.name,
                barcode: p.barcode,
                category: p.category,
                brand: p.brand,
                unit: p.base_unit,
                shelf: p.shelf,
                quantity,
                onOrderQty: integer(p.on_order_qty),
                lotTracking: !!p.lot_tracking,
                saleableQty: p.lot_tracking
                  ? integer(p.saleable_qty)
                  : quantity,
                blockedQty: p.lot_tracking
                  ? quantity - integer(p.saleable_qty)
                  : 0,
                valueMinor: value,
                averageCostMinor: quantity
                  ? ratioRound(value, 1, quantity)
                  : integer(p.purchase_price_minor),
                salePriceMinor: integer(p.sale_price_minor),
                vatBps:
                  p.market_vat_bps === null ? null : integer(p.market_vat_bps),
                purchaseVatBps:
                  p.purchase_vat_bps === null
                    ? null
                    : integer(p.purchase_vat_bps),
                lastPurchaseMinor:
                  p.last_purchase_net_minor === null
                    ? null
                    : integer(p.last_purchase_net_minor),
                minimumQty: integer(p.minimum_qty),
                maximumQty: integer(p.maximum_qty),
                leadDays: integer(p.lead_days),
                reviewDays: integer(p.review_days),
                safetyDays: integer(p.safety_days),
                orderPackQty: integer(p.order_pack_qty),
                supplierId: p.market_supplier_id,
                supplierName: p.supplier_name ?? null,
                sold28: sales,
                dailySales: s.daily,
                coverDays: s.coverDays,
                suggestedQty: planned.quantity,
                estimatedNetMinor: estimate.net,
                estimatedGrossMinor: estimate.gross,
                creditStatus: "REVIEW",
                critical: s.critical,
                stagnant: s.stagnant,
              } as InventoryItem;
            })
            .sort(
              (a, b) =>
                Number(b.critical) - Number(a.critical) ||
                (a.coverDays ?? Infinity) - (b.coverDays ?? Infinity) ||
                a.name.localeCompare(b.name)
            );
          for (const item of items) {
            if (!item.supplierId) item.creditStatus = "NO_SUPPLIER";
            else if (item.estimatedGrossMinor === null)
              item.creditStatus = "VAT_MISSING";
            else {
              const available = remaining.get(item.supplierId);
              if (available != null && item.estimatedGrossMinor > available)
                item.creditStatus = "CREDIT_BLOCKED";
              else if (available != null)
                remaining.set(
                  item.supplierId,
                  available - item.estimatedGrossMinor
                );
            }
          }
          const aliases = await rows<Row[]>(
            c,
            "SELECT * FROM st_product_barcodes WHERE station_id=?",
            [station]
          );
          const lists = await rows<Row[]>(
            c,
            "SELECT * FROM st_market_price_lists WHERE station_id=? ORDER BY name",
            [station]
          );
          const prices = await rows<Row[]>(
            c,
            "SELECT p.* FROM st_market_prices p JOIN st_market_price_lists l ON l.id=p.list_id WHERE l.station_id=?",
            [station]
          );
          const history = await rows<Row[]>(
            c,
            "SELECT h.*,l.name AS list_name,u.name AS actor_name FROM st_market_price_history h LEFT JOIN st_market_price_lists l ON l.id=h.list_id JOIN users u ON u.id=h.actor_user_id WHERE h.station_id=? ORDER BY h.id DESC LIMIT 100",
            [station]
          );
          return {
            items,
            barcodes: aliases.map(b => ({
              barcode: b.barcode,
              productId: b.product_id,
              packQty: integer(b.pack_qty),
              label: b.label,
            })),
            priceLists: lists.map(l => ({
              id: l.id,
              name: l.name,
              active: !!l.active,
              staffEnabled: !!l.staff_enabled,
            })),
            prices: prices.map(p => ({
              productId: p.product_id,
              listId: p.list_id,
              unitPriceMinor: integer(p.unit_price_minor),
            })),
            priceHistory: history.map(h => ({
              id: integer(h.id),
              productId: h.product_id,
              listName: h.list_name ?? null,
              oldMinor: h.old_minor === null ? null : integer(h.old_minor),
              newMinor: integer(h.new_minor),
              actorName: h.actor_name,
              createdAt: h.created_at,
            })),
          } satisfies InventoryState;
        })
      );
    } catch (e) {
      services.error(res, e);
    }
  });
  post(
    "inventory/product",
    READ,
    async (c, _actor, body, scope, station) => {
      const id = requireId(body.productId, "productId"),
        name = requireString(body.name, "Ürün adı", { max: 190 }),
        minimum = requireInteger(body.minimumQty, "Minimum stok", {
          allowZero: true,
        }),
        maximum = requireInteger(body.maximumQty, "Maksimum stok", {
          allowZero: true,
        });
      if (maximum && maximum < minimum)
        fail("INVALID_STOCK_RULE", "Maksimum stok minimumdan küçük olamaz.");
      const days = (key: string, min: number, max: number) => {
        const n = requireInteger(body[key], key, { allowZero: min === 0 });
        if (n < min || n > max)
          fail(
            "INVALID_STOCK_RULE",
            "Gün değerleri belirtilen sınırda olmalıdır."
          );
        return n;
      };
      const pack = days("orderPackQty", 1, 10000),
        lead = days("leadDays", 0, 365),
        review = days("reviewDays", 1, 365),
        safety = days("safetyDays", 0, 365);
      const supplier = body.supplierId
        ? requireId(body.supplierId, "Tedarikçi")
        : null;
      if (
        supplier &&
        !(await first(
          c,
          "SELECT id FROM st_market_parties WHERE id=? AND station_id=? AND kind IN ('SUPPLIER','BOTH')",
          [supplier, station]
        ))
      )
        fail("NOT_FOUND", "Market tedarikçisi bulunamadı.", 404);
      const p = await first<Row>(
        c,
        "SELECT id FROM st_products WHERE id=? AND station_id=? AND tenant_id=? FOR UPDATE",
        [id, station, scope.tenantId]
      );
      if (!p) fail("NOT_FOUND", "Ürün bulunamadı.", 404);
      const text = (key: string, max: number) =>
        optionalString(body[key], key, max) ?? "";
      await execute(
        c,
        "UPDATE st_products SET name=?,category=?,brand=?,base_unit=?,shelf=?,minimum_qty=?,maximum_qty=?,lead_days=?,review_days=?,safety_days=?,order_pack_qty=?,market_supplier_id=?,purchase_vat_bps=? WHERE id=?",
        [
          name,
          text("category", 100),
          text("brand", 100),
          requireString(body.unit, "Temel birim", { max: 32 }),
          text("shelf", 100),
          minimum,
          maximum,
          lead,
          review,
          safety,
          pack,
          supplier,
          body.purchaseVatBps == null ? null : vatRate(body.purchaseVatBps),
          id,
        ]
      );
      return { id };
    },
    true,
    true
  );
  post(
    "inventory/barcode",
    READ,
    async (c, _actor, body, scope, station) => {
      const product = requireId(body.productId, "productId"),
        barcode = requireString(body.barcode, "Barkod", { max: 190 }),
        pack = requireInteger(body.packQty, "Paket adedi");
      if (pack > 10000) fail("QUANTITY_LIMIT", "Paket adedi en fazla 10.000.");
      const p = await first<Row>(
        c,
        "SELECT id,barcode,barcode=? AS is_primary FROM st_products WHERE id=? AND station_id=? AND tenant_id=? FOR UPDATE",
        [barcode, product, station, scope.tenantId]
      );
      if (!p) fail("NOT_FOUND", "Ürün bulunamadı.", 404);
      if (p.is_primary && pack !== 1)
        fail(
          "PRIMARY_BARCODE",
          "Ana barkod temel birimi temsil eder. Koli için farklı barkod ekleyin."
        );
      const existing = await first<Row>(
        c,
        "SELECT product_id FROM st_product_barcodes WHERE station_id=? AND barcode=? FOR UPDATE",
        [station, barcode]
      );
      if (existing && existing.product_id !== product)
        fail(
          "BARCODE_IN_USE",
          "Bu barkod aynı istasyonda başka ürüne ait.",
          409
        );
      const count = await first<Row>(
        c,
        "SELECT COUNT(*) AS n FROM st_product_barcodes WHERE product_id=?",
        [product]
      );
      if (!existing && integer(count?.n) >= 20)
        fail(
          "BARCODE_LIMIT",
          "Ürün başına en fazla 20 barkod tanımlanabilir.",
          409
        );
      await execute(
        c,
        "INSERT INTO st_product_barcodes(station_id,barcode,product_id,pack_qty,label) VALUES (?,?,?,?,?) ON DUPLICATE KEY UPDATE pack_qty=VALUES(pack_qty),label=VALUES(label)",
        [
          station,
          barcode,
          product,
          pack,
          optionalString(body.label, "Etiket", 100) ?? "",
        ]
      );
      return { id: product };
    },
    true,
    true
  );
  post(
    "inventory/barcode-remove",
    READ,
    async (c, _actor, body, _scope, station) => {
      const barcode = requireString(body.barcode, "Barkod", { max: 190 });
      if (
        await first(
          c,
          "SELECT id FROM st_products WHERE station_id=? AND barcode=?",
          [station, barcode]
        )
      )
        fail("PRIMARY_BARCODE", "Ana barkod kaldırılamaz.");
      await execute(
        c,
        "DELETE FROM st_product_barcodes WHERE station_id=? AND barcode=?",
        [station, barcode]
      );
      return { id: station };
    },
    true,
    true
  );
  post(
    "inventory/price-list",
    READ,
    async (c, _actor, body, scope, station) => {
      const id = body.listId ? requireId(body.listId, "listId") : randomUUID(),
        name = requireString(body.name, "Liste adı", { max: 100 });
      const active = requireBoolean(body.active, "active"),
        staff = requireBoolean(body.staffEnabled, "staffEnabled");
      if (body.listId) {
        if (
          !(await first(
            c,
            "SELECT id FROM st_market_price_lists WHERE id=? AND station_id=? FOR UPDATE",
            [id, station]
          ))
        )
          fail("NOT_FOUND", "Liste bulunamadı.", 404);
        await execute(
          c,
          "UPDATE st_market_price_lists SET name=?,active=?,staff_enabled=? WHERE id=?",
          [name, active, staff, id]
        );
      } else {
        const count = await first<Row>(
          c,
          "SELECT COUNT(*) AS n FROM st_market_price_lists WHERE station_id=?",
          [station]
        );
        if (integer(count?.n) >= 20)
          fail(
            "PRICE_LIST_LIMIT",
            "En fazla 20 fiyat listesi tanımlanabilir.",
            409
          );
        await execute(
          c,
          "INSERT INTO st_market_price_lists(id,tenant_id,station_id,name,active,staff_enabled) VALUES (?,?,?,?,?,?)",
          [id, scope.tenantId, station, name, active, staff]
        );
      }
      return { id };
    },
    true,
    true
  );
  post(
    "inventory/price",
    READ,
    async (c, actor, body, scope, station) => {
      const product = requireId(body.productId, "productId"),
        list = requireId(body.listId, "listId"),
        price = requireMoney(body.unitPriceMinor, "KDV dahil fiyat", {
          allowZero: true,
        });
      if (
        !(await first(
          c,
          "SELECT id FROM st_products WHERE id=? AND station_id=? AND tenant_id=? FOR UPDATE",
          [product, station, scope.tenantId]
        ))
      )
        fail("NOT_FOUND", "Ürün bulunamadı.", 404);
      if (
        !(await first(
          c,
          "SELECT id FROM st_market_price_lists WHERE id=? AND station_id=? FOR UPDATE",
          [list, station]
        ))
      )
        fail("NOT_FOUND", "Liste bulunamadı.", 404);
      const old = await first<Row>(
        c,
        "SELECT unit_price_minor FROM st_market_prices WHERE list_id=? AND product_id=? FOR UPDATE",
        [list, product]
      );
      await execute(
        c,
        "INSERT INTO st_market_prices(list_id,product_id,unit_price_minor) VALUES (?,?,?) ON DUPLICATE KEY UPDATE unit_price_minor=VALUES(unit_price_minor)",
        [list, product, price]
      );
      if (!old || integer(old.unit_price_minor) !== price)
        await execute(
          c,
          "INSERT INTO st_market_price_history(station_id,product_id,list_id,old_minor,new_minor,actor_user_id) VALUES (?,?,?,?,?,?)",
          [
            station,
            product,
            list,
            old?.unit_price_minor ?? null,
            price,
            actor.id,
          ]
        );
      return { id: product };
    },
    true,
    true
  );
}

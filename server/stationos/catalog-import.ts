import { createHash, randomUUID } from "node:crypto";
import type { Express } from "express";
import type { PoolConnection } from "mysql2/promise";
import type { MarketPost } from "./market-route-types";
import type { Services, Row } from "./market-pos";
import { execute, first, rows, withTransaction } from "./db";
import { requireId, requireString } from "./domain";
import { businessToday, integer } from "./market-accounting-domain";
import { ledgerEntry, lockMarketBook } from "./market-accounting-ledger";
import { safeAdd } from "./safety";
import { fail, type StationRole } from "./types";
import {
  parseCatalog,
  catalogSettings,
  catalogOpening,
  type CatalogPreview,
  type CatalogHistory,
} from "../../shared/catalog-import";
const READ: StationRole[] = ["OWNER", "MANAGER", "ACCOUNTANT"],
  WRITE: StationRole[] = ["OWNER", "MANAGER"];
const hash = (value: unknown) =>
  createHash("sha256")
    .update(typeof value === "string" ? value : JSON.stringify(value))
    .digest("hex");
const key = (s: string) =>
  s.normalize("NFD").replace(/\p{M}/gu, "").toUpperCase();
async function preview(
  c: PoolConnection,
  station: string,
  text: unknown,
  options: unknown = undefined,
  locked = false
): Promise<CatalogPreview> {
  let parsed, settings;
  try {
    parsed = parseCatalog(text as string);
    settings = catalogSettings(options);
  } catch (e) {
    fail("INVALID_CATALOG", (e as Error).message);
  }
  const sourceHash = hash(text),
    prior = await first<Row>(
      c,
      "SELECT id,mode FROM st_catalog_imports WHERE station_id=? AND source_hash=?" +
        (locked ? " FOR UPDATE" : ""),
      [station, sourceHash]
    ),
    existing = await rows<Row[]>(
      c,
      "SELECT id,catalog_code FROM st_products WHERE station_id=? ORDER BY id" +
        (locked ? " FOR UPDATE" : ""),
      [station]
    ),
    aliases = await rows<Row[]>(
      c,
      "SELECT barcode,product_id FROM st_product_barcodes WHERE station_id=? ORDER BY barcode" +
        (locked ? " FOR UPDATE" : ""),
      [station]
    );
  const byCode = new Map(
      existing
        .filter(p => p.catalog_code !== null)
        .map(p => [key(p.catalog_code), p.id])
    ),
    byBarcode = new Map(aliases.map(b => [b.barcode, b.product_id]));
  const tenant = await first<Row>(
    c,
    "SELECT t.is_demo FROM st_tenants t JOIN st_stations s ON s.tenant_id=t.id WHERE s.id=?",
    [station]
  );
  const book = await first<Row>(
    c,
    "SELECT closed_through FROM st_market_books WHERE station_id=?",
    [station]
  );
  const result = parsed.map(r => {
    const barcode = byBarcode.get(r.barcode),
      code = byCode.get(key(r.code));
    return {
      ...r,
      ...(() => {
        try {
          return catalogOpening(r, settings);
        } catch (e) {
          fail("INVALID_CATALOG", (e as Error).message);
        }
      })(),
      status:
        code && code !== barcode ? "CONFLICT" : barcode ? "EXISTS" : "NEW",
      existingId: barcode ?? code ?? null,
    } as CatalogPreview["rows"][number];
  });
  const added = result.filter(r => r.status === "NEW").length,
    total = parsed.reduce((n, r) => n + BigInt(r.sourceQuantity), 0n);
  if (
    total > BigInt(Number.MAX_SAFE_INTEGER) ||
    total < BigInt(Number.MIN_SAFE_INTEGER)
  )
    fail("INVALID_CATALOG", "Kaynak miktar toplamı güvenli sınırı aşıyor.");
  let plannedQty = 0,
    plannedInventoryMinor = 0;
  for (const r of result.filter(r => r.status === "NEW")) {
    plannedQty = safeAdd(plannedQty, r.plannedQty);
    plannedInventoryMinor = safeAdd(plannedInventoryMinor, r.plannedValueMinor);
  }
  return {
    hash: hash({ sourceHash, existing, aliases, settings }),
    settings,
    priorMode: prior?.mode ?? null,
    missingVatGroups:
      settings.mode === "DEMO_OPENING_ABS"
        ? [
            ...new Set(
              result
                .filter(r => r.status === "NEW" && r.vatBps === null)
                .map(r => r.category)
            ),
          ].sort()
        : [],
    plannedQty,
    plannedInventoryMinor,
    isDemo: !!integer(tenant?.is_demo),
    closedToday:
      !!book?.closed_through && String(book.closed_through) >= businessToday(),
    sourceHash,
    alreadyImported: !!prior,
    added,
    skipped: result.filter(r => r.status === "EXISTS").length,
    conflicts: result.filter(r => r.status === "CONFLICT").length,
    negativeRows: parsed.filter(r => r.sourceQuantity < 0).length,
    sourceTotalQty: Number(total),
    capacityExceeded: existing.length + added > 5000,
    rows: result,
  };
}
export function registerCatalogImport(
  app: Express,
  services: Services,
  post: MarketPost
) {
  app.post(
    "/api/stationos/market-accounting/inventory/catalog-preview",
    async (req, res) => {
      try {
        const actor = services.actor(req);
        services.assertMutation(req, actor);
        const station = requireId(req.body?.stationId, "stationId");
        res.json(
          await withTransaction(async c => {
            await services.requireStation(c, actor, station, READ);
            return preview(c, station, req.body?.text, req.body?.settings);
          })
        );
      } catch (e) {
        services.error(res, e);
      }
    }
  );
  app.get(
    "/api/stationos/market-accounting/inventory/catalog-history",
    async (req, res) => {
      try {
        const actor = services.actor(req),
          station = requireId(req.query.stationId, "stationId");
        res.json(
          await withTransaction(async c => {
            await services.requireStation(c, actor, station, READ);
            const imports = await rows<Row[]>(
              c,
              "SELECT i.*,u.name AS actor_name FROM st_catalog_imports i JOIN users u ON u.id=i.created_by_user_id WHERE i.station_id=? ORDER BY i.created_at DESC,i.id DESC LIMIT 20",
              [station]
            );
            return imports.map(i => {
              const source =
                typeof i.source_rows_json === "string"
                  ? JSON.parse(i.source_rows_json)
                  : i.source_rows_json;
              return {
                id: i.id,
                label: i.source_label,
                added: integer(i.added_count),
                skipped: integer(i.skipped_count),
                rows: source.length,
                negativeRows: source.filter((r: any) => r.sourceQuantity < 0)
                  .length,
                sourceTotalQty: Number(
                  source.reduce(
                    (n: bigint, r: any) => n + BigInt(r.sourceQuantity),
                    0n
                  )
                ),
                createdAt: i.created_at,
                actorName: i.actor_name,
                mode: i.mode,
                inventoryMinor: integer(i.inventory_minor),
                openingQty: source.reduce(
                  (n: number, r: any) =>
                    n + (r.status === "NEW" ? (r.plannedQty ?? 0) : 0),
                  0
                ),
              } satisfies CatalogHistory;
            });
          })
        );
      } catch (e) {
        services.error(res, e);
      }
    }
  );
  post(
    "inventory/catalog-import",
    WRITE,
    async (c, actor, body, scope, station, book) => {
      const label = requireString(body.label, "Liste adı", { max: 100 }),
        p = await preview(c, station, body.text, body.settings, true),
        opening = p.settings.mode === "DEMO_OPENING_ABS";
      if (opening) {
        if (!p.isDemo)
          fail(
            "DEMO_REQUIRED",
            "Artı başlangıç stoğu yalnız DEMO firmada kullanılabilir.",
            409
          );
        if (body.demoOpeningAccepted !== true || body.netCostsAccepted !== true)
          fail(
            "CATALOG_POLICY_REQUIRED",
            "Artı DEMO miktarlarını ve alış fiyatlarının KDV hariç net maliyet olduğunu teyit edin.",
            409
          );
      } else if (body.catalogOnlyAccepted !== true)
        fail(
          "CATALOG_POLICY_REQUIRED",
          "Yalnız yeni kart aktarımını ve kaynak stok/maliyetin işlenmeyeceğini teyit edin.",
          409
        );
      if (p.alreadyImported) {
        const old = (await first<Row>(
          c,
          "SELECT id,mode,settings_json,added_count,skipped_count FROM st_catalog_imports WHERE station_id=? AND source_hash=? FOR UPDATE",
          [station, p.sourceHash]
        ))!;
        const oldSettings =
          typeof old.settings_json === "string"
            ? JSON.parse(old.settings_json)
            : old.settings_json;
        if (
          old.mode !== p.settings.mode ||
          (oldSettings &&
            hash(catalogSettings(oldSettings)) !== hash(p.settings))
        )
          fail(
            "CATALOG_ALREADY_IMPORTED",
            "Bu liste farklı ayarlarla daha önce aktarıldı; mevcut stoklara tekrar eklenemez.",
            409
          );
        return {
          id: old.id,
          added: integer(old.added_count),
          skipped: integer(old.skipped_count),
          alreadyImported: true,
        };
      }
      if (body.expectedHash !== p.hash)
        fail(
          "CATALOG_CHANGED",
          "Ürün kartları değişti; aktarım önizlemesini yenileyin.",
          409
        );
      if (p.conflicts)
        fail(
          "CATALOG_CONFLICT",
          "Stok kodu başka barkoda ait; çakışmaları çözün.",
          409
        );
      if (p.capacityExceeded)
        fail("SKU_LIMIT", "5.000 ürün kartı sınırı aşılır.", 409);
      if (opening && p.missingVatGroups.length)
        fail(
          "CATALOG_VAT_REQUIRED",
          "Yeni ürünlerin tüm grupları için KDV seçin.",
          409
        );
      if (opening) await lockMarketBook(c, scope.tenantId, station);
      const id = randomUUID(),
        stored = [];
      for (const r of p.rows) {
        if (r.status !== "NEW") {
          stored.push({ ...r, productId: r.existingId });
          continue;
        }
        const productId = randomUUID();
        await execute(
          c,
          "INSERT INTO st_products(id,tenant_id,station_id,name,barcode,minimum_qty,purchase_price_minor,sale_price_minor,supplier_id,created_by_user_id,category,base_unit,catalog_code,stock_qty,market_vat_bps,purchase_vat_bps) VALUES (?,?,?,?,?,0,?,?,NULL,?,?,?,?,?,?,?)",
          [
            productId,
            scope.tenantId,
            station,
            r.name,
            r.barcode,
            opening ? r.sourcePurchaseMinor : 0,
            r.salePriceMinor,
            actor.id,
            r.category,
            r.unit,
            r.code,
            r.plannedQty,
            r.vatBps,
            r.vatBps,
          ]
        );
        await execute(
          c,
          "INSERT INTO st_product_barcodes(station_id,barcode,product_id,pack_qty,label) VALUES (?,?,?,1,'Ana barkod')",
          [station, r.barcode, productId]
        );
        if (book)
          await execute(
            c,
            "INSERT INTO st_market_inventory(product_id,station_id,quantity,value_minor) VALUES (?,?,?,?)",
            [productId, station, r.plannedQty, r.plannedValueMinor]
          );
        if (r.plannedQty)
          await execute(
            c,
            "INSERT INTO st_stock_movements(id,tenant_id,station_id,product_id,kind,quantity,unit_price_minor,reference,created_by_user_id) VALUES (?,?,?,?,'RECEIPT',?,?,?,?)",
            [
              randomUUID(),
              scope.tenantId,
              station,
              productId,
              r.plannedQty,
              r.sourcePurchaseMinor,
              `DEMO-CATALOG:${id}`,
              actor.id,
            ]
          );
        stored.push({ ...r, productId });
      }
      if (opening && book)
        await ledgerEntry(
          c,
          book,
          actor.id,
          "DEMO_CATALOG_OPENING",
          id,
          "DEMO liste başlangıç stoğu",
          [
            { account: "INVENTORY", debit: p.plannedInventoryMinor },
            { account: "OPENING", credit: p.plannedInventoryMinor },
          ],
          {
            catalogId: id,
            quantity: p.plannedQty,
            netCostsAccepted: true,
            settings: p.settings,
          }
        );
      await execute(
        c,
        "INSERT INTO st_catalog_imports(id,tenant_id,station_id,source_hash,source_label,added_count,skipped_count,source_rows_json,created_by_user_id,mode,settings_json,inventory_minor) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
        [
          id,
          scope.tenantId,
          station,
          p.sourceHash,
          label,
          p.added,
          p.skipped,
          JSON.stringify(stored),
          actor.id,
          p.settings.mode,
          JSON.stringify(p.settings),
          p.plannedInventoryMinor,
        ]
      );
      return {
        id,
        added: p.added,
        skipped: p.skipped,
        alreadyImported: false,
        mode: p.settings.mode,
        openingQty: p.plannedQty,
        inventoryMinor: p.plannedInventoryMinor,
      };
    },
    false,
    true
  );
}

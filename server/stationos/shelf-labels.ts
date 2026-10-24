import { randomUUID } from "node:crypto";
import type { Express } from "express";
import type { PoolConnection } from "mysql2/promise";
import type { MarketPost } from "./market-route-types";
import type { Services, Row } from "./market-pos";
import { first, rows, execute, withTransaction } from "./db";
import {
  requireId,
  requireString,
  requireInteger,
  requireMoney,
  isRecord,
} from "./domain";
import { integer } from "./market-accounting-domain";
import { fail, type StationRole } from "./types";
import { rejectCardData } from "./safety";
import { approvedDevice } from "./inventory-terminal";
import {
  shelfSnapshot,
  shelfHash,
  shelfIssue,
  shelfChanges,
} from "./shelf-label-domain";
import type {
  ShelfSnapshot,
  ShelfItem,
  ShelfBatch,
  ShelfState,
} from "../../shared/shelf-labels";
const READ: StationRole[] = ["OWNER", "MANAGER", "ACCOUNTANT"],
  CHECK: StationRole[] = [...READ, "MARKET_STAFF", "PURCHASER"];
const parse = <T>(v: unknown): T =>
  (typeof v === "string" ? JSON.parse(v) : v) as T;
async function current(
  c: PoolConnection,
  station: string,
  id: string,
  lock = false
) {
  const p = await first<Row>(
    c,
    "SELECT * FROM st_products WHERE id=? AND station_id=?" +
      (lock ? " FOR UPDATE" : ""),
    [id, station]
  );
  if (!p) fail("NOT_FOUND", "Etiket ürünü bu istasyonda bulunamadı.", 404);
  const h = await first<Row>(
    c,
    "SELECT id,created_at FROM st_market_price_history WHERE station_id=? AND product_id=? AND list_id IS NULL ORDER BY id DESC LIMIT 1" +
      (lock ? " FOR UPDATE" : ""),
    [station, id]
  );
  const snapshot = shelfSnapshot(p, h);
  return { snapshot, hash: shelfHash(snapshot) };
}
async function installed(c: PoolConnection, id: string, lock = false) {
  return first<Row>(
    c,
    "SELECT * FROM st_shelf_label_installs WHERE product_id=?" +
      (lock ? " FOR UPDATE" : ""),
    [id]
  );
}
function item(
  snapshot: ShelfSnapshot,
  hash: string,
  old: Row | null
): ShelfItem {
  const previous = old ? parse<ShelfSnapshot>(old.snapshot_json) : null;
  return {
    snapshot,
    hash,
    labelStatus: !old
      ? "UNRECORDED"
      : old.content_hash === hash
        ? "CURRENT"
        : "CHANGED",
    installedPriceMinor: previous?.priceMinor ?? null,
    installedAt: old?.installed_at ?? null,
    changedFields: shelfChanges(snapshot, previous),
    issue: shelfIssue(snapshot),
  };
}
async function lookup(
  c: PoolConnection,
  station: string,
  code: unknown,
  lock = false
) {
  const barcode = requireString(code, "Barkod", { max: 190 }),
    alias = await first<Row>(
      c,
      "SELECT product_id,pack_qty FROM st_product_barcodes WHERE station_id=? AND barcode=?" +
        (lock ? " FOR UPDATE" : ""),
      [station, barcode]
    );
  if (!alias) fail("NOT_FOUND", "Barkod bu istasyonda bulunamadı.", 404);
  if (integer(alias.pack_qty) !== 1)
    fail(
      "SHELF_BASE_BARCODE_REQUIRED",
      "Koli barkodu yerine ana/adet barkoduyla raf birim fiyatını kontrol edin.",
      409
    );
  const now = await current(c, station, alias.product_id, lock);
  return {
    barcode,
    ...item(now.snapshot, now.hash, await installed(c, alias.product_id, lock)),
  };
}
export function registerShelfLabels(
  app: Express,
  services: Services,
  post: MarketPost
) {
  app.get(
    "/api/stationos/market-accounting/inventory/shelf-labels",
    async (req, res) => {
      try {
        const actor = services.actor(req),
          station = requireId(req.query.stationId, "stationId");
        res.json(
          await withTransaction(async c => {
            await services.requireStation(c, actor, station, READ);
            const products = await rows<Row[]>(
              c,
              "SELECT * FROM st_products WHERE station_id=? ORDER BY name LIMIT 5000",
              [station]
            );
            const history = await rows<Row[]>(
              c,
              "SELECT h.product_id,h.id,h.created_at FROM st_market_price_history h JOIN (SELECT product_id,MAX(id) AS id FROM st_market_price_history WHERE station_id=? AND list_id IS NULL GROUP BY product_id) x ON x.id=h.id",
              [station]
            );
            const hm = new Map(history.map(h => [h.product_id, h]));
            const old = await rows<Row[]>(
                c,
                "SELECT * FROM st_shelf_label_installs WHERE station_id=?",
                [station]
              ),
              om = new Map(old.map(o => [o.product_id, o]));
            const batches = await rows<Row[]>(
                c,
                "SELECT b.*,u.name AS actor_name FROM st_shelf_label_batches b JOIN users u ON u.id=b.created_by_user_id WHERE b.station_id=? ORDER BY b.created_at DESC,b.id DESC LIMIT 20",
                [station]
              ),
              checks = await rows<Row[]>(
                c,
                "SELECT s.*,p.name AS product_name,u.name AS actor_name FROM st_shelf_price_checks s JOIN st_products p ON p.id=s.product_id JOIN users u ON u.id=s.actor_user_id WHERE s.station_id=? ORDER BY s.created_at DESC,s.id DESC LIMIT 50",
                [station]
              );
            return {
              items: products.map(p => {
                const s = shelfSnapshot(p, hm.get(p.id));
                return item(s, shelfHash(s), om.get(p.id) ?? null);
              }),
              batches: batches.map(b => ({
                id: b.id,
                label: b.label,
                createdAt: b.created_at,
                createdBy: b.actor_name,
              })),
              checks: checks.map(s => ({
                id: s.id,
                productName: s.product_name,
                barcode: s.barcode,
                observedMinor: integer(s.observed_minor),
                expectedMinor: integer(s.expected_minor),
                matches: !!s.matches_price,
                actorName: s.actor_name,
                reason: s.reason,
                createdAt: s.created_at,
              })),
            } satisfies ShelfState;
          })
        );
      } catch (e) {
        services.error(res, e);
      }
    }
  );
  app.get(
    "/api/stationos/market-accounting/inventory/shelf-batches/:batchId",
    async (req, res) => {
      try {
        const actor = services.actor(req),
          station = requireId(req.query.stationId, "stationId"),
          id = requireId(req.params.batchId, "batchId");
        res.json(
          await withTransaction(async c => {
            await services.requireStation(c, actor, station, READ);
            const b = await first<Row>(
              c,
              "SELECT b.*,u.name AS actor_name FROM st_shelf_label_batches b JOIN users u ON u.id=b.created_by_user_id WHERE b.id=? AND b.station_id=?",
              [id, station]
            );
            if (!b) fail("NOT_FOUND", "Etiket paketi bulunamadı.", 404);
            const ls = await rows<Row[]>(
              c,
              "SELECT * FROM st_shelf_label_items WHERE batch_id=? ORDER BY product_id",
              [id]
            );
            return {
              id: b.id,
              label: b.label,
              createdAt: b.created_at,
              createdBy: b.actor_name,
              items: await Promise.all(
                ls.map(async l => ({
                  snapshot: parse<ShelfSnapshot>(l.snapshot_json),
                  hash: l.content_hash,
                  copies: integer(l.copies),
                  isCurrent:
                    (await current(c, station, l.product_id)).hash ===
                    l.content_hash,
                  installedAt: l.installed_at,
                }))
              ),
            } satisfies ShelfBatch;
          })
        );
      } catch (e) {
        services.error(res, e);
      }
    }
  );
  app.get(
    "/api/stationos/market-accounting/inventory/shelf-check",
    async (req, res) => {
      try {
        const actor = services.actor(req),
          station = requireId(req.query.stationId, "stationId");
        res.json(
          await withTransaction(async c => {
            await services.requireStation(c, actor, station, CHECK);
            return lookup(c, station, req.query.barcode);
          })
        );
      } catch (e) {
        services.error(res, e);
      }
    }
  );
  post(
    "inventory/shelf-batch",
    READ,
    async (c, actor, body, scope, station) => {
      const id = requireId(body.batchId, "batchId"),
        label = requireString(body.label, "Paket adı", { max: 100 });
      if (
        !Array.isArray(body.items) ||
        !body.items.length ||
        body.items.length > 100
      )
        fail("SHELF_BATCH_LIMIT", "Paket 1–100 ürün içermeli.");
      const seen = new Set<string>();
      let copies = 0;
      const selected = body.items
        .map(raw => {
          if (!isRecord(raw)) fail("INVALID_INPUT", "Etiket satırı geçersiz.");
          const productId = requireId(raw.productId, "productId"),
            count = requireInteger(raw.copies, "Etiket kopyası");
          if (seen.has(productId) || count > 20)
            fail(
              "SHELF_BATCH_LIMIT",
              "Ürün tekrarlı veya 20 kopya sınırı aşılıyor."
            );
          seen.add(productId);
          copies += count;
          return {
            productId,
            copies: count,
            hash: requireString(raw.expectedHash, "Etiket önizlemesi", {
              max: 64,
            }),
          };
        })
        .sort((a, b) => a.productId.localeCompare(b.productId));
      if (copies > 500)
        fail("SHELF_BATCH_LIMIT", "Bir paket en fazla 500 etiket olabilir.");
      await execute(
        c,
        "INSERT INTO st_shelf_label_batches(id,tenant_id,station_id,label,created_by_user_id) VALUES (?,?,?,?,?)",
        [id, scope.tenantId, station, label, actor.id]
      );
      for (const l of selected) {
        const now = await current(c, station, l.productId, true),
          issue = shelfIssue(now.snapshot);
        if (issue) fail("SHELF_LABEL_INVALID", issue, 409);
        if (now.hash !== l.hash)
          fail(
            "SHELF_LABEL_CHANGED",
            "Etiket bilgisi değişti; önizlemeyi yenileyin.",
            409
          );
        await execute(
          c,
          "INSERT INTO st_shelf_label_items(batch_id,product_id,content_hash,snapshot_json,copies) VALUES (?,?,?,?,?)",
          [id, l.productId, now.hash, JSON.stringify(now.snapshot), l.copies]
        );
      }
      return { id, copies };
    },
    true,
    true
  );
  post(
    "inventory/shelf-install",
    READ,
    async (c, actor, body, _scope, station) => {
      const id = requireId(body.batchId, "batchId");
      if (body.placedAccepted !== true)
        fail(
          "SHELF_PLACEMENT_REQUIRED",
          "Seçili ürünlerin ilgili bütün raf etiketlerini yerleştirip kontrol ettiğinizi teyit edin.",
          409
        );
      const reason = requireString(body.reason, "Raf teyit açıklaması", {
        min: 5,
        max: 500,
      });
      rejectCardData(reason);
      if (
        !Array.isArray(body.productIds) ||
        !body.productIds.length ||
        body.productIds.length > 100
      )
        fail("SHELF_BATCH_LIMIT", "1–100 ürün seçin.");
      const ids = body.productIds.map(x => requireId(x, "productId")).sort();
      if (new Set(ids).size !== ids.length)
        fail("INVALID_INPUT", "Raf teyidinde ürün tekrarlanamaz.");
      if (
        !(await first(
          c,
          "SELECT id FROM st_shelf_label_batches WHERE id=? AND station_id=? FOR UPDATE",
          [id, station]
        ))
      )
        fail("NOT_FOUND", "Etiket paketi bulunamadı.", 404);
      for (const pid of ids) {
        const l = await first<Row>(
          c,
          "SELECT * FROM st_shelf_label_items WHERE batch_id=? AND product_id=? FOR UPDATE",
          [id, pid]
        );
        if (!l) fail("NOT_FOUND", "Ürün bu etiket paketinde yok.", 404);
        const now = await current(c, station, pid, true);
        if (now.hash !== l.content_hash)
          fail(
            "SHELF_LABEL_CHANGED",
            "Paketten sonra fiyat/etiket değişti; eski etiketi rafa teyit etmeyin.",
            409
          );
        await execute(
          c,
          "INSERT INTO st_shelf_label_installs(product_id,station_id,batch_id,content_hash,snapshot_json,installed_by_user_id,installed_at) VALUES (?,?,?,?,?,?,UTC_TIMESTAMP(3)) ON DUPLICATE KEY UPDATE batch_id=VALUES(batch_id),content_hash=VALUES(content_hash),snapshot_json=VALUES(snapshot_json),installed_by_user_id=VALUES(installed_by_user_id),installed_at=VALUES(installed_at)",
          [pid, station, id, l.content_hash, l.snapshot_json, actor.id]
        );
        await execute(
          c,
          "UPDATE st_shelf_label_items SET installed_at=UTC_TIMESTAMP(3),installed_by_user_id=? WHERE batch_id=? AND product_id=?",
          [actor.id, id, pid]
        );
        await execute(
          c,
          "INSERT INTO st_shelf_label_events(batch_id,product_id,actor_user_id,reason,content_hash) VALUES (?,?,?,?,?)",
          [id, pid, actor.id, reason, now.hash]
        );
      }
      await services.audit(
        c,
        _scope.tenantId,
        station,
        actor.id,
        "SHELF_PLACEMENT_CONFIRMATION",
        id
      );
      return { id, productIds: ids, reason };
    },
    true,
    true
  );
  post(
    "inventory/shelf-check",
    CHECK,
    async (c, actor, body, scope, station) => {
      const device = await approvedDevice(c, station, body),
        now = await lookup(c, station, body.barcode, true),
        observed = requireMoney(body.observedMinor, "Okunan raf fiyatı", {
          allowZero: true,
        });
      if (body.expectedHash !== now.hash)
        fail(
          "SHELF_LABEL_CHANGED",
          "Kasa fiyatı/etiketi değişti; ürünü yeniden okutun.",
          409
        );
      if (body.physicalChecked !== true)
        fail(
          "SHELF_CHECK_REQUIRED",
          "Fizikî raf fiyatını okuyup kontrol ettiğinizi teyit edin.",
          409
        );
      const matches = observed === now.snapshot.priceMinor,
        reason = matches
          ? null
          : requireString(body.reason, "Fiyat farkı açıklaması", {
              min: 5,
              max: 500,
            });
      if (reason) rejectCardData(reason);
      const old = await installed(c, now.snapshot.productId, true),
        id = randomUUID();
      await execute(
        c,
        "INSERT INTO st_shelf_price_checks(id,tenant_id,station_id,product_id,barcode,observed_minor,expected_minor,matches_price,content_hash,installed_hash,actor_user_id,device_id,reason) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
        [
          id,
          scope.tenantId,
          station,
          now.snapshot.productId,
          now.barcode,
          observed,
          now.snapshot.priceMinor,
          matches,
          now.hash,
          old?.content_hash ?? null,
          actor.id,
          device,
          reason,
        ]
      );
      return {
        id,
        matches,
        expectedMinor: now.snapshot.priceMinor,
        labelStatus: now.labelStatus,
      };
    },
    true,
    true
  );
}

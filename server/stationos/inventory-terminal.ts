import { randomUUID } from "node:crypto";
import type { Express } from "express";
import type { PoolConnection } from "mysql2/promise";
import type { MarketPost } from "./market-route-types";
import type { Services, Row } from "./market-pos";
import type { StationRole } from "./types";
import { execute, first, rows, withTransaction } from "./db";
import {
  requireId,
  requireInteger,
  requireString,
  requireEnum,
  requireMoney,
  requireBoolean,
  isRecord,
} from "./domain";
import {
  businessToday,
  integer,
  ratioRound,
  stockCost,
  type LedgerLine,
} from "./market-accounting-domain";
import { inventoryRow, ledgerEntry } from "./market-accounting-ledger";
import { recordMarketPurchase } from "./market-purchase";
import { packQuantity } from "./inventory-domain";
import { safeAdd, rejectCardData } from "./safety";
import { fail } from "./types";
import type { TerminalState, InventoryDraft } from "../../shared/inventory";
const SCAN: StationRole[] = [
  "OWNER",
  "MANAGER",
  "ACCOUNTANT",
  "MARKET_STAFF",
  "PURCHASER",
];
const POST: StationRole[] = ["OWNER", "MANAGER", "ACCOUNTANT"];
const MANAGE: StationRole[] = ["OWNER", "MANAGER"];
const full = (role: StationRole) => POST.includes(role);
const deviceId = (body: Record<string, unknown>) =>
  requireId(body.__stationDevice, "Cihaz kimliği");
async function approvedDevice(
  c: PoolConnection,
  station: string,
  body: Record<string, unknown>
) {
  const id = deviceId(body),
    d = await first<Row>(
      c,
      "SELECT enabled FROM st_inventory_devices WHERE station_id=? AND device_id=? FOR UPDATE",
      [station, id]
    );
  if (!d?.enabled)
    fail(
      "DEVICE_NOT_APPROVED",
      "Bu cihaz tanımlı/onaylı değil. Yönetici cihaz kaydını onaylamalı.",
      403
    );
  await execute(
    c,
    "UPDATE st_inventory_devices SET last_seen_at=UTC_TIMESTAMP(3) WHERE station_id=? AND device_id=?",
    [station, id]
  );
  return id;
}
async function draftRow(
  c: PoolConnection,
  station: string,
  body: Record<string, unknown>
) {
  const id = requireId(body.draftId, "draftId"),
    d = await first<Row>(
      c,
      "SELECT * FROM st_inventory_drafts WHERE id=? AND station_id=? FOR UPDATE",
      [id, station]
    );
  if (!d) fail("NOT_FOUND", "Taslak bulunamadı.", 404);
  if (d.status !== "DRAFT")
    fail("DRAFT_CLOSED", "Taslak zaten tamamlanmış veya iptal edilmiş.", 409);
  if (
    integer(d.version) !==
    requireInteger(body.draftVersion, "Taslak sürümü", { allowZero: true })
  )
    fail("DRAFT_CHANGED", "Taslak başka cihazda değişti; yenileyin.", 409);
  return d;
}
async function event(
  c: PoolConnection,
  draft: string,
  actor: number,
  device: string | null,
  action: string,
  product: string | null = null,
  before: number | null = null,
  after: number | null = null,
  note: string | null = null
) {
  await execute(
    c,
    "INSERT INTO st_inventory_draft_events(draft_id,actor_user_id,device_id,action,product_id,before_qty,after_qty,note) VALUES (?,?,?,?,?,?,?,?)",
    [draft, actor, device, action, product, before, after, note]
  );
}
async function touch(c: PoolConnection, id: string) {
  await execute(
    c,
    "UPDATE st_inventory_drafts SET version=version+1,updated_at=UTC_TIMESTAMP(3) WHERE id=?",
    [id]
  );
}
export function registerInventoryTerminal(
  app: Express,
  services: Services,
  post: MarketPost
) {
  app.get(
    "/api/stationos/market-accounting/inventory/terminal",
    async (req, res) => {
      try {
        const actor = services.actor(req),
          station = requireId(req.query.stationId, "stationId"),
          device = requireId(req.get("X-Stationos-Device-Id"), "deviceId");
        res.json(
          await withTransaction(async c => {
            const { scope } = await services.requireStation(
                c,
                actor,
                station,
                SCAN
              ),
              canPost = full(scope.member.role),
              canApprove = MANAGE.includes(scope.member.role);
            const book = await first<Row>(
              c,
              "SELECT * FROM st_market_books WHERE station_id=? AND tenant_id=?",
              [station, scope.tenantId]
            );
            const products = await rows<Row[]>(
              c,
              "SELECT p.*,i.value_minor FROM st_products p LEFT JOIN st_market_inventory i ON i.product_id=p.id WHERE p.station_id=? AND p.tenant_id=? ORDER BY p.name LIMIT 5000",
              [station, scope.tenantId]
            );
            const aliases = await rows<Row[]>(
              c,
              "SELECT * FROM st_product_barcodes WHERE station_id=?",
              [station]
            );
            const devices = await rows<Row[]>(
              c,
              `SELECT * FROM st_inventory_devices WHERE station_id=? ${canPost ? "" : "AND device_id=?"} ORDER BY name`,
              canPost ? [station] : [station, device]
            );
            const drafts = await rows<Row[]>(
              c,
              "SELECT d.*,COUNT(l.product_id) AS total,COALESCE(SUM(l.counted_qty IS NOT NULL),0) AS collected FROM st_inventory_drafts d LEFT JOIN st_inventory_draft_lines l ON l.draft_id=d.id WHERE d.station_id=? GROUP BY d.id ORDER BY d.status='DRAFT' DESC,d.updated_at DESC LIMIT 100",
              [station]
            );
            const suppliers = canPost
              ? await rows<Row[]>(
                  c,
                  "SELECT id,name FROM st_market_parties WHERE station_id=? AND kind IN ('SUPPLIER','BOTH') ORDER BY name LIMIT 5000",
                  [station]
                )
              : [];
            const mapDevice = (d: Row) => ({
              id: d.device_id,
              name: d.name,
              model: d.model,
              platform: d.platform,
              enabled: !!d.enabled,
              lastSeenAt: d.last_seen_at,
            });
            return {
              canApprove,
              canPost,
              enabled: !!book,
              revision: integer(book?.revision),
              today: businessToday(),
              closedToday:
                !!book?.closed_through &&
                String(book.closed_through) >= businessToday(),
              device: devices.find(d => d.device_id === device)
                ? mapDevice(devices.find(d => d.device_id === device)!)
                : null,
              devices: devices.map(mapDevice),
              drafts: drafts.map(d => ({
                id: d.id,
                kind: d.kind,
                status: d.status,
                label: d.label,
                version: integer(d.version),
                createdAt: d.created_at,
                updatedAt: d.updated_at,
                collected: integer(d.collected),
                total: integer(d.total),
              })),
              products: products.map(p => ({
                id: p.id,
                name: p.name,
                barcode: p.barcode,
                unit: p.base_unit,
                shelf: p.shelf,
                unitNetMinor: canPost
                  ? p.last_purchase_net_minor === null
                    ? integer(p.stock_qty)
                      ? ratioRound(
                          integer(p.value_minor),
                          1,
                          integer(p.stock_qty)
                        )
                      : integer(p.purchase_price_minor)
                    : integer(p.last_purchase_net_minor)
                  : null,
                vatBps: canPost
                  ? p.purchase_vat_bps === null
                    ? null
                    : integer(p.purchase_vat_bps)
                  : null,
              })),
              barcodes: aliases.map(b => ({
                barcode: b.barcode,
                productId: b.product_id,
                packQty: integer(b.pack_qty),
                label: b.label,
              })),
              suppliers: suppliers.map(s => ({ id: s.id, name: s.name })),
            } satisfies TerminalState;
          })
        );
      } catch (e) {
        services.error(res, e);
      }
    }
  );
  app.get(
    "/api/stationos/market-accounting/inventory/draft",
    async (req, res) => {
      try {
        const actor = services.actor(req),
          station = requireId(req.query.stationId, "stationId"),
          id = requireId(req.query.draftId, "draftId");
        res.json(
          await withTransaction(async c => {
            const { scope } = await services.requireStation(
                c,
                actor,
                station,
                SCAN
              ),
              financial = full(scope.member.role);
            const d = await first<Row>(
              c,
              "SELECT * FROM st_inventory_drafts WHERE id=? AND station_id=? AND tenant_id=?",
              [id, station, scope.tenantId]
            );
            if (!d) fail("NOT_FOUND", "Taslak bulunamadı.", 404);
            const book = await first<Row>(
              c,
              "SELECT revision FROM st_market_books WHERE station_id=?",
              [station]
            );
            const lines = await rows<Row[]>(
              c,
              "SELECT l.*,p.name,p.barcode,p.base_unit,p.stock_qty,p.stock_version,p.purchase_price_minor,i.value_minor,u.name AS counted_by FROM st_inventory_draft_lines l JOIN st_products p ON p.id=l.product_id LEFT JOIN st_market_inventory i ON i.product_id=p.id LEFT JOIN users u ON u.id=l.counted_by_user_id WHERE l.draft_id=? ORDER BY l.counted_qty IS NOT NULL DESC,p.name",
              [id]
            );
            const events = await rows<Row[]>(
              c,
              "SELECT e.*,u.name AS actor_name FROM st_inventory_draft_events e JOIN users u ON u.id=e.actor_user_id WHERE draft_id=? ORDER BY e.id DESC LIMIT 50",
              [id]
            );
            return {
              id: d.id,
              kind: d.kind,
              status: d.status,
              label: d.label,
              version: integer(d.version),
              revision: integer(book?.revision),
              lines: lines.map(l => ({
                productId: l.product_id,
                name: l.name,
                barcode: l.barcode,
                unit: l.base_unit,
                baselineQty: financial ? integer(l.baseline_qty) : null,
                countedQty:
                  l.counted_qty === null ? null : integer(l.counted_qty),
                currentQty: financial ? integer(l.stock_qty) : null,
                stockChanged:
                  integer(l.stock_version) !== integer(l.baseline_version),
                unitNetMinor: financial
                  ? integer(l.stock_qty)
                    ? ratioRound(
                        integer(l.value_minor),
                        1,
                        integer(l.stock_qty)
                      )
                    : integer(l.purchase_price_minor)
                  : null,
                currentValueMinor: financial ? integer(l.value_minor) : null,
                countedBy: l.counted_by ?? null,
                updatedAt: l.updated_at,
              })),
              events: events.map(e => ({
                id: integer(e.id),
                action: e.action,
                productId: e.product_id,
                beforeQty: e.before_qty === null ? null : integer(e.before_qty),
                afterQty: e.after_qty === null ? null : integer(e.after_qty),
                actorName: e.actor_name,
                note: e.note,
                createdAt: e.created_at,
              })),
            } satisfies InventoryDraft;
          })
        );
      } catch (e) {
        services.error(res, e);
      }
    }
  );
  post(
    "inventory/device-register",
    SCAN,
    async (c, actor, body, scope, station) => {
      const id = deviceId(body),
        name = requireString(body.name, "Cihaz adı", { max: 100 }),
        model = requireString(body.model, "Cihaz modeli", { max: 100 }),
        platform = requireEnum(body.platform, "platform", [
          "ANDROID",
          "WINDOWS",
          "OTHER",
        ] as const);
      const old = await first(
        c,
        "SELECT device_id FROM st_inventory_devices WHERE station_id=? AND device_id=? FOR UPDATE",
        [station, id]
      );
      if (!old) {
        const enabled = MANAGE.includes(scope.member.role);
        await execute(
          c,
          "INSERT INTO st_inventory_devices(station_id,device_id,name,model,platform,enabled,created_by_user_id,approved_by_user_id) VALUES (?,?,?,?,?,?,?,?)",
          [
            station,
            id,
            name,
            model,
            platform,
            enabled,
            actor.id,
            enabled ? actor.id : null,
          ]
        );
      }
      return { id };
    },
    true,
    true
  );
  post(
    "inventory/device-approve",
    MANAGE,
    async (c, actor, body, _scope, station) => {
      const id = requireId(body.deviceId, "deviceId"),
        enabled = requireBoolean(body.enabled, "enabled");
      if (
        !(await first(
          c,
          "SELECT device_id FROM st_inventory_devices WHERE station_id=? AND device_id=? FOR UPDATE",
          [station, id]
        ))
      )
        fail("NOT_FOUND", "Cihaz bulunamadı.", 404);
      await execute(
        c,
        "UPDATE st_inventory_devices SET enabled=?,approved_by_user_id=? WHERE station_id=? AND device_id=?",
        [enabled, actor.id, station, id]
      );
      return { id };
    },
    true,
    true
  );
  post(
    "inventory/draft-create",
    SCAN,
    async (c, actor, body, scope, station) => {
      const device = await approvedDevice(c, station, body),
        id = randomUUID(),
        kind = requireEnum(body.kind, "kind", ["COUNT", "RECEIPT"] as const),
        label = requireString(body.label, "Taslak adı", { max: 100 });
      const capacity = await first<Row>(
        c,
        "SELECT COUNT(*) AS n FROM st_inventory_drafts WHERE station_id=? AND status='DRAFT'",
        [station]
      );
      if (integer(capacity?.n) >= 50)
        fail("DRAFT_LIMIT", "İstasyonda 50 açık taslak sınırı dolu.", 409);
      await execute(
        c,
        "INSERT INTO st_inventory_drafts(id,tenant_id,station_id,kind,label,created_by_user_id) VALUES (?,?,?,?,?,?)",
        [id, scope.tenantId, station, kind, label, actor.id]
      );
      if (kind === "COUNT")
        await execute(
          c,
          "INSERT INTO st_inventory_draft_lines(draft_id,product_id,baseline_qty,baseline_version) SELECT ?,id,stock_qty,stock_version FROM st_products WHERE station_id=?",
          [id, station]
        );
      await event(c, id, actor.id, device, "CREATE");
      return { id };
    },
    true,
    true
  );
  post(
    "inventory/draft-scan",
    SCAN,
    async (c, actor, body, _scope, station) => {
      const device = await approvedDevice(c, station, body),
        d = await draftRow(c, station, body),
        barcode = requireString(body.barcode, "Barkod", { max: 190 }),
        mode = requireEnum(body.mode, "mode", ["ADD", "SET"] as const),
        qty = requireInteger(body.quantity, "Okutulan paket/adet", {
          allowZero: mode === "SET",
        });
      const p = await first<Row>(
        c,
        "SELECT p.*,b.pack_qty FROM st_product_barcodes b JOIN st_products p ON p.id=b.product_id WHERE b.station_id=? AND b.barcode=? FOR UPDATE",
        [station, barcode]
      );
      if (!p)
        fail("BARCODE_NOT_FOUND", "Barkod bu istasyonda bulunamadı.", 404);
      let line = await first<Row>(
        c,
        "SELECT * FROM st_inventory_draft_lines WHERE draft_id=? AND product_id=? FOR UPDATE",
        [d.id, p.id]
      );
      if (!line) {
        if (d.kind === "COUNT")
          fail(
            "NOT_IN_COUNT",
            "Ürün sayım başlangıcında yoktu; yeni sayım açın.",
            409
          );
        const count = await first<Row>(
          c,
          "SELECT COUNT(*) AS n FROM st_inventory_draft_lines WHERE draft_id=?",
          [d.id]
        );
        if (integer(count?.n) >= 100)
          fail(
            "DRAFT_LINE_LIMIT",
            "Mal kabul taslağı en fazla 100 ürün içerir.",
            409
          );
        await execute(
          c,
          "INSERT INTO st_inventory_draft_lines(draft_id,product_id,baseline_qty,baseline_version) VALUES (?,?,?,?)",
          [d.id, p.id, p.stock_qty, p.stock_version]
        );
        line = { baseline_version: p.stock_version, counted_qty: null } as Row;
      }
      if (
        d.kind === "COUNT" &&
        integer(line.baseline_version) !== integer(p.stock_version)
      )
        fail(
          "COUNT_STOCK_CHANGED",
          "Bu ürünün stoğu sayım sırasında değişti. Yeniden say ile satırı sıfırlayıp tekrar sayın.",
          409
        );
      const units =
          qty === 0
            ? 0
            : packQuantity(
                qty,
                integer(p.pack_qty),
                d.kind === "COUNT" ? 1000000000 : 10000
              ),
        before = line.counted_qty === null ? null : integer(line.counted_qty),
        after = mode === "SET" ? units : safeAdd(before ?? 0, units);
      if (after > (d.kind === "COUNT" ? 1000000000 : 10000))
        fail("QUANTITY_LIMIT", "Taslak ürün adedi sınırı aşıyor.");
      await execute(
        c,
        "UPDATE st_inventory_draft_lines SET counted_qty=?,counted_by_user_id=?,device_id=?,updated_at=UTC_TIMESTAMP(3) WHERE draft_id=? AND product_id=?",
        [after, actor.id, device, d.id, p.id]
      );
      await touch(c, d.id);
      await event(
        c,
        d.id,
        actor.id,
        device,
        mode === "ADD" ? "SCAN" : "SET",
        p.id,
        before,
        after,
        barcode
      );
      return { id: d.id, productId: p.id, quantity: after };
    },
    true,
    true
  );
  post(
    "inventory/draft-rebase",
    SCAN,
    async (c, actor, body, _scope, station) => {
      const device = await approvedDevice(c, station, body),
        d = await draftRow(c, station, body),
        id = requireId(body.productId, "productId"),
        reason = requireString(body.reason, "Yeniden sayım açıklaması", {
          min: 5,
          max: 500,
        });
      rejectCardData(reason);
      if (d.kind !== "COUNT")
        fail("INVALID_DRAFT", "Bu işlem sayım taslağı içindir.");
      const p = await first<Row>(
          c,
          "SELECT stock_qty,stock_version FROM st_products WHERE id=? AND station_id=? FOR UPDATE",
          [id, station]
        ),
        line = await first<Row>(
          c,
          "SELECT counted_qty FROM st_inventory_draft_lines WHERE draft_id=? AND product_id=? FOR UPDATE",
          [d.id, id]
        );
      if (!p || !line) fail("NOT_FOUND", "Sayım satırı bulunamadı.", 404);
      await execute(
        c,
        "UPDATE st_inventory_draft_lines SET baseline_qty=?,baseline_version=?,counted_qty=NULL,counted_by_user_id=NULL,device_id=NULL,updated_at=NULL WHERE draft_id=? AND product_id=?",
        [p.stock_qty, p.stock_version, d.id, id]
      );
      await touch(c, d.id);
      await event(
        c,
        d.id,
        actor.id,
        device,
        "REBASE",
        id,
        line.counted_qty === null ? null : integer(line.counted_qty),
        null,
        reason
      );
      return { id: d.id };
    },
    true,
    true
  );
  post(
    "inventory/draft-cancel",
    SCAN,
    async (c, actor, body, scope, station) => {
      const d = await draftRow(c, station, body),
        reason = requireString(body.reason, "İptal açıklaması", {
          min: 5,
          max: 500,
        });
      rejectCardData(reason);
      if (
        !full(scope.member.role) &&
        integer(d.created_by_user_id) !== actor.id
      )
        fail(
          "DRAFT_FORBIDDEN",
          "Yalnız kendi taslağınızı iptal edebilirsiniz.",
          403
        );
      await execute(
        c,
        "UPDATE st_inventory_drafts SET status='CANCELLED' WHERE id=?",
        [d.id]
      );
      await touch(c, d.id);
      await event(
        c,
        d.id,
        actor.id,
        deviceId(body),
        "CANCEL",
        null,
        null,
        null,
        reason
      );
      return { id: d.id };
    },
    true,
    true
  );
  post(
    "inventory/receipt-post",
    POST,
    async (c, actor, body, scope, station, book) => {
      const d = await draftRow(c, station, body);
      if (d.kind !== "RECEIPT")
        fail("INVALID_DRAFT", "Mal kabul taslağı seçin.");
      if (
        requireInteger(body.expectedRevision, "Defter sürümü", {
          allowZero: true,
        }) !== integer(book!.revision)
      )
        fail("REPORT_CHANGED", "Defter değişti; önizlemeyi yenileyin.", 409);
      const ls = await rows<Row[]>(
        c,
        "SELECT product_id,counted_qty FROM st_inventory_draft_lines WHERE draft_id=? AND counted_qty>0 ORDER BY product_id",
        [d.id]
      );
      if (
        !ls.length ||
        !Array.isArray(body.lines) ||
        body.lines.length !== ls.length
      )
        fail(
          "DRAFT_LINES_CHANGED",
          "Maliyetleri tüm mal kabul satırları için tamamlayın.",
          409
        );
      const seen = new Set<string>();
      for (const raw of body.lines) {
        if (!isRecord(raw)) fail("INVALID_INPUT", "Alış satırı geçersiz.");
        const id = requireId(raw.productId, "productId"),
          line = ls.find(l => l.product_id === id);
        if (
          seen.has(id) ||
          !line ||
          requireInteger(raw.quantity, "Adet") !== integer(line.counted_qty)
        )
          fail(
            "DRAFT_LINES_CHANGED",
            "Mal kabul adetleri okutulan taslakla uyuşmuyor.",
            409
          );
        seen.add(id);
      }
      const result = await recordMarketPurchase(
        c,
        actor,
        body,
        scope,
        station,
        book
      );
      if (!isRecord(result) || typeof result.id !== "string")
        fail("INTERNAL_ERROR", "Alış sonucu okunamadı.", 500);
      const entry = await first<Row>(
        c,
        "SELECT id FROM st_market_entries WHERE station_id=? AND kind='PURCHASE' AND source_id=?",
        [station, result.id]
      );
      await execute(
        c,
        "UPDATE st_inventory_drafts SET status='POSTED',posted_entry_id=? WHERE id=?",
        [entry!.id, d.id]
      );
      await touch(c, d.id);
      await event(c, d.id, actor.id, deviceId(body), "POST");
      return { ...result, draftId: d.id };
    }
  );
  post(
    "inventory/count-post",
    POST,
    async (c, actor, body, _scope, station, book) => {
      const d = await draftRow(c, station, body);
      if (d.kind !== "COUNT") fail("INVALID_DRAFT", "Sayım taslağı seçin.");
      if (
        requireInteger(body.expectedRevision, "Defter sürümü", {
          allowZero: true,
        }) !== integer(book!.revision)
      )
        fail(
          "REPORT_CHANGED",
          "Defter değişti; sayım önizlemesini yenileyin.",
          409
        );
      const reason = requireString(body.reason, "Sayım onay açıklaması", {
        min: 5,
        max: 500,
      });
      rejectCardData(reason);
      const ls = await rows<Row[]>(
        c,
        "SELECT * FROM st_inventory_draft_lines WHERE draft_id=? AND counted_qty IS NOT NULL ORDER BY product_id FOR UPDATE",
        [d.id]
      );
      if (!ls.length) fail("EMPTY_COUNT", "En az bir ürün sayılmalı.");
      const costs = new Map<string, number>();
      if (!Array.isArray(body.unitCosts))
        fail("INVALID_INPUT", "Fazla stok maliyetlerini tamamlayın.");
      for (const raw of body.unitCosts) {
        if (!isRecord(raw)) fail("INVALID_INPUT", "Maliyet satırı geçersiz.");
        const id = requireId(raw.productId, "productId");
        if (costs.has(id) || !ls.some(l => l.product_id === id))
          fail("INVALID_INPUT", "Maliyet satırı tekrarlı veya sayım dışında.");
        costs.set(
          id,
          requireMoney(raw.unitNetMinor, "Fazla stok maliyeti", {
            allowZero: true,
          })
        );
      }
      let gain = 0,
        loss = 0;
      const snapshots = [];
      for (const l of ls) {
        const p = (await first<Row>(
          c,
          "SELECT * FROM st_products WHERE id=? AND station_id=? FOR UPDATE",
          [l.product_id, station]
        ))!;
        if (integer(p.stock_version) !== integer(l.baseline_version))
          fail(
            "COUNT_STOCK_CHANGED",
            `${p.name}: stok sayım sırasında değişti; satırı yeniden sayın.`,
            409
          );
        const inv = await inventoryRow(c, book!, p),
          qty = integer(l.counted_qty),
          delta = qty - integer(p.stock_qty);
        const unit = costs.get(p.id);
        if (delta > 0 && unit === undefined)
          fail(
            "COUNT_COST_REQUIRED",
            `${p.name}: fazla stok için net birim maliyet girin.`
          );
        if (delta > 0 && unit === 0 && body.zeroCostAccepted !== true)
          fail(
            "ZERO_COST_CONFIRMATION",
            "Sıfır maliyetli stok fazlasını açıkça teyit edin.",
            409
          );
        const amount =
          delta > 0
            ? delta * unit!
            : delta < 0
              ? stockCost(
                  integer(inv.value_minor),
                  integer(inv.quantity),
                  -delta
                )
              : 0;
        requireMoney(amount, "Sayım farkı maliyeti", { allowZero: true });
        if (delta > 0) gain = safeAdd(gain, amount);
        else loss = safeAdd(loss, amount);
        if (delta) {
          const value = safeAdd(
            integer(inv.value_minor),
            delta > 0 ? amount : -amount
          );
          await execute(
            c,
            "UPDATE st_market_inventory SET quantity=?,value_minor=? WHERE product_id=?",
            [qty, value, p.id]
          );
          await execute(
            c,
            "UPDATE st_products SET stock_qty=?,purchase_price_minor=?,stock_version=stock_version+1 WHERE id=?",
            [qty, qty ? ratioRound(value, 1, qty) : 0, p.id]
          );
          await execute(
            c,
            "INSERT INTO st_stock_movements(id,tenant_id,station_id,product_id,kind,quantity,unit_price_minor,reference,created_by_user_id) VALUES (?,?,?,?,'ADJUSTMENT',?,0,?,?)",
            [
              randomUUID(),
              book!.tenant_id,
              station,
              p.id,
              delta,
              `COUNT:${d.id}`,
              actor.id,
            ]
          );
        }
        snapshots.push({
          productId: p.id,
          before: integer(p.stock_qty),
          after: qty,
          valueMinor: amount,
          delta,
        });
      }
      if (
        requireMoney(body.expectedGainMinor, "Stok fazlası önizleme", {
          allowZero: true,
        }) !== gain ||
        requireMoney(body.expectedLossMinor, "Stok eksiği önizleme", {
          allowZero: true,
        }) !== loss
      )
        fail("COUNT_TOTAL_CHANGED", "Sayım maliyet önizlemesi değişti.", 409);
      const lines: LedgerLine[] = [
        { account: "INVENTORY", debit: gain },
        { account: "STOCK_GAIN", credit: gain },
        { account: "STOCK_LOSS", debit: loss },
        { account: "INVENTORY", credit: loss },
      ];
      const entry = await ledgerEntry(
        c,
        book!,
        actor.id,
        "STOCK_COUNT",
        d.id,
        reason,
        lines,
        { draftId: d.id, items: snapshots }
      );
      await execute(
        c,
        "UPDATE st_inventory_drafts SET status='POSTED',posted_entry_id=? WHERE id=?",
        [entry, d.id]
      );
      await touch(c, d.id);
      await event(
        c,
        d.id,
        actor.id,
        deviceId(body),
        "POST",
        null,
        null,
        null,
        reason
      );
      return { id: entry, draftId: d.id };
    }
  );
}

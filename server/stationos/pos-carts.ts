import { randomUUID } from "node:crypto";
import type { Request } from "express";
import type { PoolConnection } from "mysql2/promise";
import type { PosCart, PosCartLine, PosCartEvent } from "../../shared/pos";
import type { Row, Scope, Services } from "./market-pos";
import type { StationActor } from "./types";
import { fail } from "./types";
import { execute, first, rows } from "./db";
import {
  requireId,
  requireInteger,
  requireString,
  optionalString,
} from "./domain";
import { normalizePosLines, posLineTotal } from "./pos-domain";
import { rejectCardData, safeAdd } from "./safety";

type Handler = (
  c: PoolConnection,
  actor: StationActor,
  body: Record<string, unknown>,
  scope: Scope,
  req: Request,
  stationId: string
) => Promise<unknown>;
type Session = (
  c: PoolConnection,
  actor: StationActor,
  body: Record<string, unknown>,
  scope: Scope,
  req: Request,
  stationId: string
) => Promise<Row>;
const device = (req: Request) =>
  requireId(req.get("X-Stationos-Device-Id"), "deviceId");
const json = <T>(value: unknown): T =>
  (typeof value === "string" ? JSON.parse(value) : value) as T;

export function cartFromRow(r: Row): PosCart {
  return {
    id: r.id,
    sessionId: r.session_id,
    ownerUserId: Number(r.owner_user_id),
    deviceId: r.device_id,
    status: r.status,
    version: Number(r.version),
    label: r.label,
    lines: json<PosCartLine[]>(r.lines_json),
    updatedAt: r.updated_at,
  };
}

export async function loadCartState(
  c: PoolConnection,
  actor: StationActor,
  scope: Scope,
  stationId: string,
  deviceId: string
) {
  const active = await first<Row>(
    c,
    "SELECT * FROM st_pos_carts WHERE tenant_id=? AND station_id=? AND owner_user_id=? AND active_device_id=?",
    [scope.tenantId, stationId, actor.id, deviceId]
  );
  const held = await rows<Row[]>(
    c,
    "SELECT * FROM st_pos_carts WHERE tenant_id=? AND station_id=? AND status='HELD' ORDER BY updated_at DESC,id LIMIT 100",
    [scope.tenantId, stationId]
  );
  const ownOnly = scope.member.role === "MARKET_STAFF";
  const events = await rows<Row[]>(
    c,
    `SELECT e.*,u.name AS actor_name FROM st_pos_cart_events e JOIN users u ON u.id=e.actor_user_id WHERE e.tenant_id=? AND e.station_id=? AND e.action IN ('REDUCE','CANCEL') ${ownOnly ? "AND e.actor_user_id=?" : ""} ORDER BY e.created_at DESC,e.id LIMIT 50`,
    ownOnly
      ? [scope.tenantId, stationId, actor.id]
      : [scope.tenantId, stationId]
  );
  return {
    activeCart: active ? cartFromRow(active) : null,
    heldCarts: held.map(cartFromRow),
    cancellations: events.map(
      e =>
        ({
          id: e.id,
          cartId: e.cart_id,
          action: e.action,
          reason: e.reason,
          actorName: e.actor_name,
          deviceId: e.device_id,
          createdAt: e.created_at,
          beforeLines: json<PosCartLine[]>(e.before_lines_json),
          afterLines: json<PosCartLine[]>(e.after_lines_json),
        }) satisfies PosCartEvent
    ),
  };
}

export async function lockCart(
  c: PoolConnection,
  actor: StationActor,
  body: Record<string, unknown>,
  scope: Scope,
  req: Request,
  stationId: string,
  held = false
) {
  const r = await first<Row>(
    c,
    "SELECT * FROM st_pos_carts WHERE id=? AND tenant_id=? AND station_id=? FOR UPDATE",
    [requireId(body.cartId, "cartId"), scope.tenantId, stationId]
  );
  if (!r) fail("NOT_FOUND", "Sepet bulunamadı.", 404);
  const cart = cartFromRow(r);
  if (cart.status !== (held ? "HELD" : "ACTIVE"))
    fail(
      "CART_STATE_CHANGED",
      "Sepetin durumu değişmiş; ekranı yenileyin.",
      409
    );
  if (!held && (cart.ownerUserId !== actor.id || cart.deviceId !== device(req)))
    fail(
      "CART_FORBIDDEN",
      "Bu aktif sepet başka kasiyer veya bilgisayarda.",
      403
    );
  if (cart.version !== requireInteger(body.cartVersion, "cartVersion"))
    fail(
      "CART_VERSION_CONFLICT",
      "Sepet başka bir işlemle değişmiş; güncel sepeti inceleyin.",
      409
    );
  return cart;
}

export async function saveCart(
  c: PoolConnection,
  services: Services,
  actor: StationActor,
  body: Record<string, unknown>,
  scope: Scope,
  req: Request,
  stationId: string,
  before: PosCart,
  next: PosCart,
  action:
    | "ADD"
    | "REDUCE"
    | "CANCEL"
    | "HOLD"
    | "RESUME"
    | "REPRICE"
    | "CHECKOUT",
  reason: string | null = null,
  saleId: string | null = null
) {
  next.version = before.version + 1;
  await execute(
    c,
    "UPDATE st_pos_carts SET session_id=?,owner_user_id=?,device_id=?,active_device_id=?,status=?,version=?,label=?,lines_json=?,sale_id=?,updated_at=UTC_TIMESTAMP(3) WHERE id=?",
    [
      next.sessionId,
      next.ownerUserId,
      next.deviceId,
      next.status === "ACTIVE" ? next.deviceId : null,
      next.status,
      next.version,
      next.label,
      JSON.stringify(next.lines),
      saleId,
      next.id,
    ]
  );
  await execute(
    c,
    "INSERT INTO st_pos_cart_events (id,cart_id,tenant_id,station_id,actor_user_id,device_id,request_id,action,reason,before_lines_json,after_lines_json,cart_version) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
    [
      randomUUID(),
      next.id,
      scope.tenantId,
      stationId,
      actor.id,
      device(req),
      body.requestId,
      action,
      reason,
      JSON.stringify(before.lines),
      JSON.stringify(next.lines),
      next.version,
    ]
  );
  await services.audit(
    c,
    scope.tenantId,
    stationId,
    actor.id,
    `POS_CART_${action}`,
    next.id
  );
  return cartFromRow(
    (await first<Row>(c, "SELECT * FROM st_pos_carts WHERE id=?", [next.id]))!
  );
}

export function registerCartRoutes(
  post: (path: string, fn: Handler) => void,
  ownedSession: Session,
  services: Services
) {
  const reason = (body: Record<string, unknown>) => {
    const s = requireString(body.reason, "İptal açıklaması", {
      min: 5,
      max: 500,
    });
    rejectCardData(s);
    return s;
  };
  post("cart/add", async (c, actor, body, scope, req, stationId) => {
    const session = await ownedSession(c, actor, body, scope, req, stationId);
    let cart: PosCart;
    if (body.cartId)
      cart = await lockCart(c, actor, body, scope, req, stationId);
    else {
      const existing = await first<Row>(
        c,
        "SELECT id FROM st_pos_carts WHERE station_id=? AND owner_user_id=? AND active_device_id=? FOR UPDATE",
        [stationId, actor.id, device(req)]
      );
      if (existing)
        fail(
          "CART_EXISTS",
          "Bu bilgisayarda kayıtlı sepet var; önce ekranı yenileyin.",
          409
        );
      const id = randomUUID();
      await execute(
        c,
        "INSERT INTO st_pos_carts (id,tenant_id,station_id,session_id,owner_user_id,device_id,active_device_id,status,version,lines_json) VALUES (?,?,?,?,?,?,?,'ACTIVE',0,'[]')",
        [
          id,
          scope.tenantId,
          stationId,
          session.id,
          actor.id,
          device(req),
          device(req),
        ]
      );
      cart = cartFromRow(
        (await first<Row>(c, "SELECT * FROM st_pos_carts WHERE id=?", [id]))!
      );
    }
    if (cart.sessionId !== session.id)
      fail(
        "CART_SESSION_CHANGED",
        "Sepet eski kasa oturumunda. Beklemeye alıp açık kasada çağırın.",
        409
      );
    const productId = requireId(body.productId, "productId"),
      quantity = requireInteger(body.quantity, "quantity");
    const p = await first<Row>(
      c,
      "SELECT id,name,barcode,stock_qty,sale_price_minor FROM st_products WHERE id=? AND tenant_id=? AND station_id=?",
      [productId, scope.tenantId, stationId]
    );
    if (!p) fail("NOT_FOUND", "Ürün bu istasyonda bulunamadı.", 404);
    const old = cart.lines.find(l => l.productId === productId);
    if (old && old.expectedUnitPriceMinor !== Number(p.sale_price_minor))
      fail("PRICE_CHANGED", "Fiyat değişmiş; önce güncel fiyatları alın.", 409);
    const merged = normalizePosLines(
      old
        ? cart.lines.map(l =>
            l.productId === productId
              ? { ...l, quantity: safeAdd(l.quantity, quantity) }
              : l
          )
        : [
            ...cart.lines,
            {
              productId,
              quantity,
              expectedUnitPriceMinor: Number(p.sale_price_minor),
            },
          ]
    );
    if (
      merged.find(l => l.productId === productId)!.quantity >
      Number(p.stock_qty)
    )
      fail("NEGATIVE_INVENTORY", `${p.name}: yeterli stok yok.`, 409);
    const lines = merged.map(l => ({
      ...l,
      productName:
        l.productId === productId
          ? p.name
          : cart.lines.find(x => x.productId === l.productId)!.productName,
      barcode:
        l.productId === productId
          ? p.barcode
          : cart.lines.find(x => x.productId === l.productId)!.barcode,
    }));
    lines.reduce(
      (sum, l) =>
        safeAdd(sum, posLineTotal(l.expectedUnitPriceMinor, l.quantity)),
      0
    );
    return {
      cart: await saveCart(
        c,
        services,
        actor,
        body,
        scope,
        req,
        stationId,
        cart,
        { ...cart, lines },
        "ADD"
      ),
    };
  });
  post("cart/reduce", async (c, actor, body, scope, req, stationId) => {
    const session = await ownedSession(c, actor, body, scope, req, stationId);
    const cart = await lockCart(c, actor, body, scope, req, stationId);
    if (cart.sessionId !== session.id)
      fail("CART_SESSION_CHANGED", "Sepet başka kasa oturumunda.", 409);
    const why = reason(body),
      productId = requireId(body.productId, "productId"),
      quantity = requireInteger(body.quantity, "quantity");
    const old = cart.lines.find(l => l.productId === productId);
    if (!old || quantity > old.quantity)
      fail("INVALID_CART", "İptal adedi sepet adedini aşamaz.", 409);
    const lines = cart.lines.flatMap(l =>
      l.productId !== productId
        ? [l]
        : l.quantity === quantity
          ? []
          : [{ ...l, quantity: l.quantity - quantity }]
    );
    return {
      cart: await saveCart(
        c,
        services,
        actor,
        body,
        scope,
        req,
        stationId,
        cart,
        { ...cart, lines },
        "REDUCE",
        why
      ),
    };
  });
  // These two operations remain available for an owned draft after its register closes.
  // They only lock the cart; never acquire a session lock after a cart lock.
  post("cart/hold", async (c, actor, body, scope, req, stationId) => {
    const cart = await lockCart(c, actor, body, scope, req, stationId);
    if (!cart.lines.length)
      fail("INVALID_CART", "Boş sepet beklemeye alınamaz.", 409);
    const label = optionalString(body.label, "Sepet etiketi", 100);
    rejectCardData(label);
    return {
      cart: await saveCart(
        c,
        services,
        actor,
        body,
        scope,
        req,
        stationId,
        cart,
        { ...cart, status: "HELD", label },
        "HOLD"
      ),
    };
  });
  post("cart/cancel", async (c, actor, body, scope, req, stationId) => {
    const cart = await lockCart(c, actor, body, scope, req, stationId);
    return {
      cart: await saveCart(
        c,
        services,
        actor,
        body,
        scope,
        req,
        stationId,
        cart,
        { ...cart, status: "CANCELLED", lines: [] },
        "CANCEL",
        reason(body)
      ),
    };
  });
  post("cart/resume", async (c, actor, body, scope, req, stationId) => {
    const session = await ownedSession(c, actor, body, scope, req, stationId);
    const existing = await first<Row>(
      c,
      "SELECT id FROM st_pos_carts WHERE station_id=? AND owner_user_id=? AND active_device_id=? FOR UPDATE",
      [stationId, actor.id, device(req)]
    );
    if (existing)
      fail(
        "CART_EXISTS",
        "Önce aktif sepetinizi bekletin veya açıklamayla iptal edin.",
        409
      );
    const cart = await lockCart(c, actor, body, scope, req, stationId, true);
    return {
      cart: await saveCart(
        c,
        services,
        actor,
        body,
        scope,
        req,
        stationId,
        cart,
        {
          ...cart,
          status: "ACTIVE",
          ownerUserId: actor.id,
          deviceId: device(req),
          sessionId: session.id,
        },
        "RESUME"
      ),
    };
  });
  post("cart/reprice", async (c, actor, body, scope, req, stationId) => {
    const session = await ownedSession(c, actor, body, scope, req, stationId);
    const cart = await lockCart(c, actor, body, scope, req, stationId);
    if (cart.sessionId !== session.id)
      fail("CART_SESSION_CHANGED", "Sepet başka kasa oturumunda.", 409);
    const lines: PosCartLine[] = [];
    for (const l of cart.lines) {
      const p = await first<Row>(
        c,
        "SELECT name,barcode,sale_price_minor FROM st_products WHERE id=? AND tenant_id=? AND station_id=?",
        [l.productId, scope.tenantId, stationId]
      );
      if (!p) fail("NOT_FOUND", "Sepetteki ürün bulunamadı.", 404);
      lines.push({
        ...l,
        productName: p.name,
        barcode: p.barcode,
        expectedUnitPriceMinor: Number(p.sale_price_minor),
      });
    }
    lines.reduce(
      (sum, l) =>
        safeAdd(sum, posLineTotal(l.expectedUnitPriceMinor, l.quantity)),
      0
    );
    return {
      cart: await saveCart(
        c,
        services,
        actor,
        body,
        scope,
        req,
        stationId,
        cart,
        { ...cart, lines },
        "REPRICE"
      ),
    };
  });
}

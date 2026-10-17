import { randomUUID } from "node:crypto";
import type { Express, Request, Response } from "express";
import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import type { PosState } from "../../shared/pos";
import { execute, first, rows, withTransaction } from "./db";
import {
  requireId,
  requireString,
  requireMoney,
  requireEnum,
  optionalString,
} from "./domain";
import { normalizePosLines, posLineTotal, posPayment } from "./pos-domain";
import {
  loadCartState,
  lockCart,
  saveCart,
  registerCartRoutes,
} from "./pos-carts";
import { safeAdd, rejectCardData } from "./safety";
import {
  fail,
  type StationActor,
  type StationMember,
  type StationRole,
} from "./types";

export type Row = RowDataPacket & Record<string, any>;
export type Scope = {
  tenantId: string;
  member: StationMember;
  stationIds: string[];
};
export type Services = {
  actor(req: Request): StationActor;
  assertMutation(req: Request, actor: StationActor): void;
  error(res: Response, error: unknown): void;
  requireStation(
    c: PoolConnection,
    actor: StationActor,
    id: string,
    roles?: readonly StationRole[]
  ): Promise<{ scope: Scope; station: RowDataPacket }>;
  mutation<T>(
    actor: StationActor,
    body: Record<string, unknown>,
    fn: (c: PoolConnection) => Promise<T>
  ): Promise<{ ok: true; result: T }>;
  audit(
    c: PoolConnection,
    tenant: string,
    station: string | null,
    actor: number,
    action: string,
    id: string | null
  ): Promise<void>;
};
const SELL: StationRole[] = ["OWNER", "MANAGER", "MARKET_STAFF"];
const READ: StationRole[] = [...SELL, "ACCOUNTANT"];
const MANAGE: StationRole[] = ["OWNER", "MANAGER"];
const number = (value: unknown) => {
  const n = Number(value ?? 0);
  if (!Number.isSafeInteger(n))
    fail("AMOUNT_OVERFLOW", "Kasa tutarı güvenli tamsayı olmalıdır.", 500);
  return n;
};
const device = (req: Request) =>
  requireId(req.get("X-Stationos-Device-Id"), "deviceId");

export function registerMarketPosRoutes(app: Express, services: Services) {
  const handle =
    (fn: (req: Request, res: Response) => Promise<void>) =>
    async (req: Request, res: Response) => {
      try {
        await fn(req, res);
      } catch (error) {
        services.error(res, error);
      }
    };
  const scoped = async (
    c: PoolConnection,
    actor: StationActor,
    stationId: string,
    roles = SELL
  ) => (await services.requireStation(c, actor, stationId, roles)).scope;
  function post(
    path: string,
    roles: StationRole[],
    fn: (
      c: PoolConnection,
      actor: StationActor,
      body: Record<string, unknown>,
      scope: Scope,
      req: Request,
      stationId: string
    ) => Promise<unknown>
  ) {
    app.post(
      `/api/stationos/pos/${path}`,
      handle(async (req, res) => {
        const actor = services.actor(req);
        services.assertMutation(req, actor);
        const body = req.body as Record<string, unknown>;
        const stationId = requireId(body?.stationId, "stationId");
        // Reauthorize even a cached idempotent response after membership changes.
        await withTransaction(c => scoped(c, actor, stationId, roles));
        // Only these DB-only POS operations are retried. withTransaction has
        // already rolled back; retain the original idempotency key and payload.
        // MariaDB snapshot isolation may raise ER_CHECKREAD on a concurrent row.
        for (let attempt = 0; attempt < 3; attempt++) {
          try {
            const result = await services.mutation(actor, body, async c =>
              fn(
                c,
                actor,
                body,
                await scoped(c, actor, stationId, roles),
                req,
                stationId
              )
            );
            res.json(result);
            return;
          } catch (error) {
            const code = (error as { code?: string }).code;
            if (
              ![
                "ER_CHECKREAD",
                "ER_LOCK_DEADLOCK",
                "ER_LOCK_WAIT_TIMEOUT",
              ].includes(code ?? "")
            )
              throw error;
            if (attempt === 2)
              fail(
                "REGISTER_BUSY",
                "Kasa kaydı başka işlemle çakıştı; aynı sepetle tekrar deneyin.",
                409
              );
            await new Promise(resolve =>
              setTimeout(resolve, 20 * (attempt + 1))
            );
          }
        }
      })
    );
  }
  async function ownedSession(
    c: PoolConnection,
    actor: StationActor,
    body: Record<string, unknown>,
    scope: Scope,
    req: Request,
    stationId: string
  ) {
    const id = requireId(body.sessionId, "sessionId");
    const session = await first<Row>(
      c,
      "SELECT * FROM st_pos_sessions WHERE id=? AND tenant_id=? AND station_id=? FOR UPDATE",
      [id, scope.tenantId, stationId]
    );
    if (!session) fail("NOT_FOUND", "Kasa oturumu bulunamadı.", 404);
    if (number(session.user_id) !== actor.id)
      fail("REGISTER_FORBIDDEN", "Bu kasa oturumu başka kullanıcıya ait.", 403);
    if (session.closed_at) fail("REGISTER_CLOSED", "Kasa oturumu kapalı.", 409);
    const binding = await first<Row>(
      c,
      "SELECT device_id FROM st_pos_session_devices WHERE session_id=? AND device_id=? AND user_id=?",
      [session.id, device(req), actor.id]
    );
    if (!binding)
      fail("REGISTER_FORBIDDEN", "Önce bu bilgisayarı açık kasaya katın.", 403);
    return session;
  }

  app.get(
    "/api/stationos/pos",
    handle(async (req, res) => {
      const actor = services.actor(req),
        stationId = requireId(req.query.stationId, "stationId");
      const state = await withTransaction(async c => {
        const scope = await scoped(c, actor, stationId, READ);
        const tenant = await first<Row>(
          c,
          "SELECT is_demo FROM st_tenants WHERE id=?",
          [scope.tenantId]
        );
        const registers = await rows<Row[]>(
          c,
          "SELECT id,name,code FROM st_pos_registers WHERE tenant_id=? AND station_id=? ORDER BY code",
          [scope.tenantId, stationId]
        );
        const ownOnly = scope.member.role === "MARKET_STAFF";
        const params = ownOnly
          ? [scope.tenantId, stationId, actor.id]
          : [scope.tenantId, stationId];
        const sessions = await rows<Row[]>(
          c,
          `SELECT s.*,
        COALESCE((SELECT SUM(cash_amount_minor) FROM st_pos_sales WHERE session_id=s.id),0) AS cash_sales,
        COALESCE((SELECT SUM(card_amount_minor) FROM st_pos_sales WHERE session_id=s.id),0) AS card_sales
        FROM st_pos_sessions s WHERE tenant_id=? AND station_id=? ${ownOnly ? "AND user_id=?" : ""}
        ORDER BY closed_at IS NULL DESC,opened_at DESC LIMIT 100`,
          params
        );
        const products = await rows<Row[]>(
          c,
          "SELECT id,station_id,name,barcode,stock_qty,minimum_qty,sale_price_minor,supplier_id FROM st_products WHERE tenant_id=? AND station_id=? ORDER BY name LIMIT 5000",
          [scope.tenantId, stationId]
        );
        const bindings = sessions.length
          ? await rows<Row[]>(
              c,
              `SELECT session_id,device_id FROM st_pos_session_devices WHERE session_id IN (${sessions.map(() => "?").join(",")})`,
              sessions.map(s => s.id)
            )
          : [];
        const sales = await rows<Row[]>(
          c,
          `SELECT id,session_id,register_id,device_id,total_minor,payment_kind,cash_amount_minor,card_amount_minor,created_at,fiscal_status FROM st_pos_sales WHERE tenant_id=? AND station_id=? ${ownOnly ? "AND user_id=?" : ""} ORDER BY created_at DESC,id LIMIT 50`,
          params
        );
        return {
          ...(await loadCartState(c, actor, scope, stationId, device(req))),
          isDemo: Boolean(number(tenant?.is_demo)),
          registers: registers.map(r => ({
            id: r.id,
            name: r.name,
            code: r.code,
          })),
          sessions: sessions.map(s => ({
            id: s.id,
            registerId: s.register_id,
            userId: number(s.user_id),
            deviceId: s.device_id,
            deviceIds: bindings
              .filter(d => d.session_id === s.id)
              .map(d => d.device_id),
            closedByDeviceId: s.closed_by_device_id ?? null,
            openedAt: s.opened_at,
            closedAt: s.closed_at,
            openingFloatMinor: number(s.opening_float_minor),
            cashSalesMinor: number(s.cash_sales),
            cardDeclaredMinor: number(s.card_sales),
            expectedCashMinor: s.closed_at
              ? number(s.expected_cash_minor)
              : safeAdd(number(s.opening_float_minor), number(s.cash_sales)),
            countedCashMinor:
              s.counted_cash_minor === null
                ? null
                : number(s.counted_cash_minor),
            differenceMinor:
              s.difference_minor === null ? null : number(s.difference_minor),
          })),
          products: products.map(p => ({
            id: p.id,
            stationId: p.station_id,
            name: p.name,
            barcode: p.barcode,
            stockQty: number(p.stock_qty),
            minimumQty: number(p.minimum_qty),
            purchasePriceMinor: null,
            salePriceMinor: number(p.sale_price_minor),
            supplierId: p.supplier_id,
          })),
          sales: sales.map(s => ({
            id: s.id,
            sessionId: s.session_id,
            registerId: s.register_id,
            deviceId: s.device_id,
            totalMinor: number(s.total_minor),
            paymentKind: s.payment_kind,
            cashAmountMinor: number(s.cash_amount_minor),
            cardAmountMinor: number(s.card_amount_minor),
            createdAt: s.created_at,
            fiscalStatus: s.fiscal_status,
          })),
          capabilities: {
            scanner: "KEYBOARD_INPUT",
            printer: "NOT_CONFIGURED",
            drawer: "NOT_CONFIGURED",
            bank: "MANUAL_DECLARATION",
            fiscal: "NOT_CONFIGURED",
            sync: "NOT_CONFIGURED",
          },
        } satisfies PosState;
      });
      res.json(state);
    })
  );

  post("register", MANAGE, async (c, actor, body, scope, _req, stationId) => {
    const name = requireString(body.name, "name", { max: 100 }),
      code = requireString(body.code, "code", { max: 32 }).toUpperCase();
    if (!/^[A-Z0-9][A-Z0-9_-]*$/.test(code))
      fail(
        "INVALID_INPUT",
        "Kasa kodunda A–Z, 0–9, tire ve alt çizgi kullanın."
      );
    const id = randomUUID();
    await execute(
      c,
      "INSERT INTO st_pos_registers (id,tenant_id,station_id,name,code,created_by_user_id) VALUES (?,?,?,?,?,?)",
      [id, scope.tenantId, stationId, name, code, actor.id]
    );
    await services.audit(
      c,
      scope.tenantId,
      stationId,
      actor.id,
      "POS_REGISTER_CREATE",
      id
    );
    return { id };
  });

  post("open", SELL, async (c, actor, body, scope, req, stationId) => {
    const registerId = requireId(body.registerId, "registerId"),
      deviceId = device(req);
    const openingFloatMinor = requireMoney(
      body.openingFloatMinor,
      "openingFloatMinor",
      { allowZero: true }
    );
    const register = await first<Row>(
      c,
      "SELECT id FROM st_pos_registers WHERE id=? AND tenant_id=? AND station_id=? FOR UPDATE",
      [registerId, scope.tenantId, stationId]
    );
    if (!register) fail("NOT_FOUND", "Kasa bulunamadı.", 404);
    const existing = await first<Row>(
      c,
      "SELECT id FROM st_pos_sessions WHERE register_id=? AND closed_at IS NULL FOR UPDATE",
      [registerId]
    );
    if (existing) fail("REGISTER_IN_USE", "Bu kasada açık oturum var.", 409);
    const id = randomUUID();
    await execute(
      c,
      "INSERT INTO st_pos_sessions (id,tenant_id,station_id,register_id,user_id,device_id,opening_float_minor,open_register_id) VALUES (?,?,?,?,?,?,?,?)",
      [
        id,
        scope.tenantId,
        stationId,
        registerId,
        actor.id,
        deviceId,
        openingFloatMinor,
        registerId,
      ]
    );
    await services.audit(
      c,
      scope.tenantId,
      stationId,
      actor.id,
      "POS_SESSION_OPEN",
      id
    );
    await execute(
      c,
      "INSERT INTO st_pos_session_devices (session_id,device_id,user_id) VALUES (?,?,?)",
      [id, deviceId, actor.id]
    );
    return { id };
  });

  post("join", SELL, async (c, actor, body, scope, req, stationId) => {
    const registerId = requireId(body.registerId, "registerId");
    const sessionId = requireId(body.sessionId, "sessionId");
    const register = await first<Row>(
      c,
      "SELECT id FROM st_pos_registers WHERE id=? AND tenant_id=? AND station_id=? FOR UPDATE",
      [registerId, scope.tenantId, stationId]
    );
    if (!register) fail("NOT_FOUND", "Kasa bulunamadı.", 404);
    const session = await first<Row>(
      c,
      "SELECT id,user_id,closed_at,opening_float_minor FROM st_pos_sessions WHERE id=? AND register_id=? AND tenant_id=? AND station_id=? FOR UPDATE",
      [sessionId, registerId, scope.tenantId, stationId]
    );
    if (!session) fail("NOT_FOUND", "Kasa oturumu bulunamadı.", 404);
    if (number(session.user_id) !== actor.id)
      fail(
        "REGISTER_FORBIDDEN",
        "Yalnız kendi kullanıcınızın açık kasasına katılabilirsiniz.",
        403
      );
    if (session.closed_at)
      fail("REGISTER_CLOSED", "Bu kasa kapanmış; ekranı yenileyin.", 409);
    const binding = await execute(
      c,
      "INSERT IGNORE INTO st_pos_session_devices (session_id,device_id,user_id) VALUES (?,?,?)",
      [session.id, device(req), actor.id]
    );
    if (binding.affectedRows > 0)
      await services.audit(
        c,
        scope.tenantId,
        stationId,
        actor.id,
        "POS_SESSION_JOIN",
        session.id
      );
    return {
      id: session.id,
      joined: true,
      openingFloatMinor: number(session.opening_float_minor),
    };
  });

  post("checkout", SELL, async (c, actor, body, scope, req, stationId) => {
    const session = await ownedSession(c, actor, body, scope, req, stationId);
    const tenant = await first<Row>(
      c,
      "SELECT is_demo FROM st_tenants WHERE id=?",
      [scope.tenantId]
    );
    if (!number(tenant?.is_demo))
      fail(
        "DEMO_ONLY",
        "Mali belge ve cihaz akışı doğrulanana kadar kasa satışı yalnız DEMO firmada kullanılabilir.",
        409
      );
    const cart = body.cartId
      ? await lockCart(c, actor, body, scope, req, stationId)
      : null;
    if (cart && cart.sessionId !== session.id)
      fail("CART_SESSION_CHANGED", "Sepet başka kasa oturumunda.", 409);
    if (cart && body.lines !== undefined)
      fail("INVALID_CART", "Kayıtlı sepetin satırları sunucudan alınır.", 409);
    // Keep older clients compatible, but never let a direct payload bypass an active V2 cart.
    if (
      !cart &&
      (await first<Row>(
        c,
        "SELECT id FROM st_pos_carts WHERE station_id=? AND owner_user_id=? AND active_device_id=?",
        [stationId, actor.id, device(req)]
      ))
    )
      fail(
        "CART_REQUIRED",
        "Satışı kayıtlı sepet kimliği ve sürümüyle tamamlayın.",
        409
      );
    const lines = normalizePosLines(cart ? cart.lines : body.lines);
    const snapshots = [];
    let total = 0;
    for (const line of lines) {
      const p = await first<Row>(
        c,
        "SELECT id,name,barcode,stock_qty,sale_price_minor FROM st_products WHERE id=? AND tenant_id=? AND station_id=? FOR UPDATE",
        [line.productId, scope.tenantId, stationId]
      );
      if (!p)
        fail("NOT_FOUND", "Sepetteki ürün bu istasyonda bulunamadı.", 404);
      if (number(p.sale_price_minor) !== line.expectedUnitPriceMinor)
        fail(
          "PRICE_CHANGED",
          "Ürün fiyatı değişti. Sepeti güncelleyip tekrar inceleyin.",
          409
        );
      if (number(p.stock_qty) < line.quantity)
        fail("NEGATIVE_INVENTORY", `${p.name}: yeterli stok yok.`, 409);
      const lineTotal = posLineTotal(number(p.sale_price_minor), line.quantity);
      total = safeAdd(total, lineTotal);
      snapshots.push({ ...line, name: p.name, barcode: p.barcode, lineTotal });
    }
    const payment = posPayment(body, total);
    const {
      paymentKind,
      cashAmountMinor,
      cardAmountMinor,
      tenderedMinor: tendered,
      changeMinor,
    } = payment;
    // Guard the future drawer total before any write as well as each sale total.
    const totals = await first<Row>(
      c,
      "SELECT COALESCE(SUM(cash_amount_minor),0) AS cash_total,COALESCE(SUM(card_amount_minor),0) AS card_total FROM st_pos_sales WHERE session_id=?",
      [session.id]
    );
    safeAdd(
      number(session.opening_float_minor),
      number(totals?.cash_total),
      cashAmountMinor
    );
    safeAdd(number(totals?.card_total), cardAmountMinor);
    const id = randomUUID();
    await execute(
      c,
      "INSERT INTO st_pos_sales (id,tenant_id,station_id,register_id,session_id,user_id,request_id,total_minor,payment_kind,payment_status,tendered_minor,change_minor,device_id,cash_amount_minor,card_amount_minor) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
      [
        id,
        scope.tenantId,
        stationId,
        session.register_id,
        session.id,
        actor.id,
        body.requestId,
        total,
        paymentKind,
        paymentKind === "CASH" ? "CASH_RECORDED" : "CASHIER_DECLARED",
        tendered,
        changeMinor,
        device(req),
        cashAmountMinor,
        cardAmountMinor,
      ]
    );
    for (const line of snapshots) {
      await execute(
        c,
        "INSERT INTO st_pos_sale_lines (id,sale_id,product_id,product_name,barcode,quantity,unit_price_minor,total_minor) VALUES (?,?,?,?,?,?,?,?)",
        [
          randomUUID(),
          id,
          line.productId,
          line.name,
          line.barcode,
          line.quantity,
          line.expectedUnitPriceMinor,
          line.lineTotal,
        ]
      );
      await execute(
        c,
        "UPDATE st_products SET stock_qty=stock_qty-? WHERE id=? AND tenant_id=? AND station_id=?",
        [line.quantity, line.productId, scope.tenantId, stationId]
      );
      await execute(
        c,
        "INSERT INTO st_stock_movements (id,tenant_id,station_id,product_id,kind,quantity,unit_price_minor,reference,created_by_user_id) VALUES (?,?,?,?,'SALE',?,?,?,?)",
        [
          randomUUID(),
          scope.tenantId,
          stationId,
          line.productId,
          line.quantity,
          line.expectedUnitPriceMinor,
          `POS-DEMO:${id}`,
          actor.id,
        ]
      );
    }
    await execute(
      c,
      "INSERT INTO st_pos_events(id,sale_id,event_type) VALUES (?,?,'DEMO_SALE_RECORDED')",
      [randomUUID(), id]
    );
    await services.audit(
      c,
      scope.tenantId,
      stationId,
      actor.id,
      "POS_DEMO_SALE",
      id
    );
    if (cart)
      await saveCart(
        c,
        services,
        actor,
        body,
        scope,
        req,
        stationId,
        cart,
        { ...cart, status: "CHECKED_OUT" },
        "CHECKOUT",
        null,
        id
      );
    return {
      id,
      sessionId: session.id,
      totalMinor: total,
      changeMinor,
      paymentKind,
      cashAmountMinor,
      cardAmountMinor,
      fiscalStatus: "NOT_ISSUED_DEMO",
      syncStatus: "NOT_CONFIGURED",
    };
  });

  post("close", SELL, async (c, actor, body, scope, req, stationId) => {
    const session = await ownedSession(c, actor, body, scope, req, stationId);
    const counted = requireMoney(body.countedCashMinor, "countedCashMinor", {
      allowZero: true,
    });
    const cash = await first<Row>(
      c,
      "SELECT COALESCE(SUM(cash_amount_minor),0) AS total FROM st_pos_sales WHERE session_id=?",
      [session.id]
    );
    const expected = safeAdd(
      number(session.opening_float_minor),
      number(cash?.total)
    );
    const difference = safeAdd(counted, -expected);
    const note = optionalString(body.note, "note", 500);
    rejectCardData(note);
    if (difference !== 0 && (!note || note.length < 5))
      fail(
        "CLOSE_NOTE_REQUIRED",
        "Nakit farkı için en az beş karakterlik açıklama girin.",
        409
      );
    await execute(
      c,
      "UPDATE st_pos_sessions SET closed_at=UTC_TIMESTAMP(3),open_register_id=NULL,counted_cash_minor=?,expected_cash_minor=?,difference_minor=?,close_note=?,closed_by_device_id=? WHERE id=?",
      [counted, expected, difference, note, device(req), session.id]
    );
    await services.audit(
      c,
      scope.tenantId,
      stationId,
      actor.id,
      "POS_SESSION_CLOSE",
      session.id
    );
    return {
      id: session.id,
      expectedCashMinor: expected,
      countedCashMinor: counted,
      differenceMinor: difference,
    };
  });
  registerCartRoutes(
    (path, fn) => post(path, SELL, fn),
    ownedSession,
    services
  );
}

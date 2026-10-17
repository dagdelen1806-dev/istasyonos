import { strict as assert } from "node:assert";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { randomUUID, randomBytes } from "node:crypto";
import mysql from "mysql2/promise";

if (process.env.SMOKE_TEST !== "1")
  throw new Error(
    "Writes DEMO fixtures; use only on the isolated local test database."
  );
const base = process.env.SMOKE_BASE_URL ?? "http://127.0.0.1:3301";
if (!["localhost", "127.0.0.1"].includes(new URL(base).hostname))
  throw new Error("Local test server required");
const dbUrl = new URL(process.env.DATABASE_URL ?? "");
if (
  dbUrl.pathname !== "/istasyonos_pos_v2_test" ||
  dbUrl.searchParams.get("socketPath") !== "/workspace/local-mysql/mysql.sock"
)
  throw new Error("Exact isolated V2 test database required");
const fixture = JSON.parse(
  await readFile(
    process.env.SMOKE_POS_FIXTURE ??
      "/workspace/pos-v2-test/legacy/fixture.json",
    "utf8"
  )
);
type Actor = { cookie: string; csrf: string; device: string };
const a: Actor = fixture.owner,
  b: Actor = { ...a, device: fixture.sharedDevice },
  station = fixture.station,
  sessionId = fixture.activeSession;
async function http(
  path: string,
  actor: Actor,
  body?: Record<string, unknown>
) {
  const r = await fetch(base + "/api/stationos" + path, {
    method: body ? "POST" : "GET",
    headers: {
      "Content-Type": "application/json",
      "X-Stationos-Request": "1",
      Origin: base,
      Cookie: actor.cookie,
      "X-CSRF-Token": actor.csrf,
      "X-Stationos-Device-Id": actor.device,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: r.status, data: await r.json() };
}
async function post(
  actor: Actor,
  path: string,
  body: Record<string, unknown>,
  status = 200
) {
  const r = await http(path, actor, {
    stationId: station,
    requestId: randomUUID(),
    ...body,
  });
  assert.equal(r.status, status, `${path}: ${JSON.stringify(r.data)}`);
  return r.data.result ?? r.data;
}
async function state(actor = a) {
  const r = await http(`/pos?stationId=${station}`, actor);
  assert.equal(r.status, 200);
  return r.data;
}
const cp = (c: any) => ({ cartId: c.id, cartVersion: c.version });
await post(b, "/pos/join", { registerId: fixture.registerA, sessionId });
const barcode = `v2-${randomUUID().slice(0, 8)}`;
const product = (
  await post(a, "/product", {
    name: "DEMO sepet ürünü",
    barcode,
    minimumQty: 0,
    purchasePriceMinor: 0,
    salePriceMinor: 250,
    supplierId: null,
  })
).id;
await post(a, "/stock", { productId: product, kind: "RECEIPT", quantity: 30 });
let cart = (
  await post(a, "/pos/cart/add", { sessionId, productId: product, quantity: 3 })
).cart;
assert.equal(cart.lines[0].quantity, 3);
assert.equal((await state()).activeCart.id, cart.id);
assert.equal(
  (await state()).products.find((p: any) => p.id === product).stockQty,
  30
);
await post(
  a,
  "/pos/checkout",
  {
    sessionId,
    lines: [{ productId: product, quantity: 1, expectedUnitPriceMinor: 250 }],
    paymentKind: "CASH",
    tenderedMinor: 1000,
  },
  409
);
await post(
  b,
  "/pos/cart/reduce",
  {
    sessionId,
    ...cp(cart),
    productId: product,
    quantity: 1,
    reason: "Başka cihaz denemesi",
  },
  403
);
await post(
  a,
  "/pos/cart/reduce",
  { sessionId, ...cp(cart), productId: product, quantity: 1, reason: "" },
  400
);
assert.equal((await state()).activeCart.version, cart.version);
const old = cart;
cart = (
  await post(a, "/pos/cart/reduce", {
    sessionId,
    ...cp(cart),
    productId: product,
    quantity: 1,
    reason: "Yanlış okutma düzeltildi",
  })
).cart;
assert.equal(cart.lines[0].quantity, 2);
let audit = (await state()).cancellations.find(
  (e: any) => e.cartId === cart.id
);
assert.equal(audit.reason, "Yanlış okutma düzeltildi");
assert.equal(audit.deviceId, a.device);
assert.equal(audit.beforeLines[0].quantity, 3);
assert.equal(audit.afterLines[0].quantity, 2);
await post(
  a,
  "/pos/cart/reduce",
  {
    sessionId,
    ...cp(old),
    productId: product,
    quantity: 1,
    reason: "Eski sürüm denemesi",
  },
  409
);
const heldRequest = {
  stationId: station,
  requestId: randomUUID(),
  ...cp(cart),
  label: "DEMO bekleyen sepet",
};
const holds = await Promise.all([
  http("/pos/cart/hold", a, heldRequest),
  http("/pos/cart/hold", a, heldRequest),
]);
assert.equal(holds[0].status, 200);
assert.equal(holds[1].status, 200);
assert.deepEqual(holds[0].data, holds[1].data);
cart = holds[0].data.result.cart;
assert.equal((await state()).activeCart, null);
assert.equal(
  (await state(b)).heldCarts.filter((c: any) => c.id === cart.id).length,
  1
);
const claims = await Promise.all([
  http("/pos/cart/resume", a, {
    stationId: station,
    requestId: randomUUID(),
    sessionId,
    ...cp(cart),
  }),
  http("/pos/cart/resume", b, {
    stationId: station,
    requestId: randomUUID(),
    sessionId,
    ...cp(cart),
  }),
]);
assert.deepEqual(claims.map(r => r.status).sort(), [200, 409]);
const index = claims.findIndex(r => r.status === 200),
  winner = index === 0 ? a : b,
  loser = index === 0 ? b : a;
cart = claims[index].data.result.cart;
assert.equal(cart.deviceId, winner.device);
await post(
  loser,
  "/pos/checkout",
  { sessionId, ...cp(cart), paymentKind: "CASH", tenderedMinor: 1000 },
  403
);
const sql = await mysql.createConnection({ uri: dbUrl.toString() });
await sql.execute(
  "UPDATE st_products SET sale_price_minor=300 WHERE id=? AND station_id=?",
  [product, station]
);
await post(
  winner,
  "/pos/checkout",
  { sessionId, ...cp(cart), paymentKind: "CASH", tenderedMinor: 1000 },
  409
);
assert.equal((await state(winner)).activeCart.version, cart.version);
cart = (await post(winner, "/pos/cart/reprice", { sessionId, ...cp(cart) }))
  .cart;
assert.equal(cart.lines[0].expectedUnitPriceMinor, 300);
await post(
  winner,
  "/pos/checkout",
  {
    sessionId,
    ...cp(cart),
    paymentKind: "MIXED",
    cashAmountMinor: 600,
    tenderedMinor: 600,
    cardConfirmed: true,
  },
  409
);
await post(
  winner,
  "/pos/checkout",
  {
    sessionId,
    ...cp(cart),
    paymentKind: "MIXED",
    cashAmountMinor: 200,
    tenderedMinor: 500,
    cardConfirmed: false,
  },
  409
);
const checkout = {
  stationId: station,
  requestId: randomUUID(),
  sessionId,
  ...cp(cart),
  paymentKind: "MIXED",
  cashAmountMinor: 200,
  tenderedMinor: 500,
  cardConfirmed: true,
};
const paid = await http("/pos/checkout", winner, checkout);
assert.equal(paid.status, 200, JSON.stringify(paid.data));
assert.deepEqual(
  (await http("/pos/checkout", winner, checkout)).data,
  paid.data
);
assert.equal(paid.data.result.totalMinor, 600);
assert.equal(paid.data.result.cashAmountMinor, 200);
assert.equal(paid.data.result.cardAmountMinor, 400);
assert.equal(paid.data.result.changeMinor, 300);
let current = await state(winner);
assert.equal(current.activeCart, null);
assert.equal(current.products.find((p: any) => p.id === product).stockQty, 28);
assert.equal(
  current.sales.filter((s: any) => s.id === paid.data.result.id).length,
  1
);
let session = current.sessions.find((s: any) => s.id === sessionId);
assert.equal(session.cashSalesMinor, 200);
assert.equal(session.cardDeclaredMinor, 400);
assert.equal(session.expectedCashMinor, 200);
cart = (
  await post(winner, "/pos/cart/add", {
    sessionId,
    productId: product,
    quantity: 1,
  })
).cart;
const cancel = {
  stationId: station,
  requestId: randomUUID(),
  ...cp(cart),
  reason: "Müşteri alışverişten vazgeçti",
};
await post(winner, "/pos/cart/cancel", { ...cp(cart), reason: "" }, 400);
const cancelled = await http("/pos/cart/cancel", winner, cancel);
assert.equal(cancelled.status, 200);
assert.deepEqual(
  (await http("/pos/cart/cancel", winner, cancel)).data,
  cancelled.data
);
current = await state(winner);
assert.equal(current.activeCart, null);
assert.equal(current.products.find((p: any) => p.id === product).stockQty, 28);
assert.equal(
  current.cancellations.filter(
    (e: any) => e.cartId === cart.id && e.action === "CANCEL"
  ).length,
  1
);
// A close on another device leaves a recoverable draft; hold and rebind it to a fresh session.
cart = (
  await post(a, "/pos/cart/add", { sessionId, productId: product, quantity: 1 })
).cart;
await post(b, "/pos/close", { sessionId, countedCashMinor: 200 });
await post(
  a,
  "/pos/cart/add",
  { sessionId, ...cp(cart), productId: product, quantity: 1 },
  409
);
cart = (
  await post(a, "/pos/cart/hold", { ...cp(cart), label: "Kapanıştan kalan" })
).cart;
const newSession = (
  await post(a, "/pos/open", {
    registerId: fixture.registerA,
    openingFloatMinor: 0,
  })
).id;
cart = (
  await post(a, "/pos/cart/resume", { sessionId: newSession, ...cp(cart) })
).cart;
assert.equal(cart.sessionId, newSession);
await post(a, "/pos/cart/cancel", {
  ...cp(cart),
  reason: "DEMO denemesi tamamlandı",
});
assert.deepEqual(
  (await http("/pos/checkout", winner, checkout)).data,
  paid.data
);
// Cross-company users cannot list or claim this station's held carts.
const auth = await fetch(base + "/api/auth/register", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "X-Stationos-Request": "1",
    Origin: base,
  },
  body: JSON.stringify({
    email: `cart-${randomUUID()}@example.invalid`,
    password: randomBytes(24).toString("hex"),
    name: "DEMO dış kullanıcı",
  }),
});
assert.equal(auth.status, 201);
const outsider: Actor = {
  cookie: auth.headers.get("set-cookie")!.split(";")[0],
  csrf: "",
  device: randomUUID(),
};
outsider.csrf = (await http("/state", outsider)).data.csrfToken;
assert.equal((await http(`/pos?stationId=${station}`, outsider)).status, 403);
await post(
  outsider,
  "/pos/cart/resume",
  { sessionId: newSession, ...cp(cart) },
  403
);
const [events]: any = await sql.query(
  "SELECT action,COUNT(*) AS n FROM st_pos_cart_events WHERE cart_id=? GROUP BY action",
  [cart.id]
);
assert.ok(events.some((e: any) => e.action === "HOLD"));
await sql.end();
const out = process.env.SMOKE_OUTPUT_DIR ?? "/workspace/pos-v2-test/carts";
await mkdir(out, { recursive: true, mode: 0o700 });
await writeFile(
  out + "/fixture.json",
  JSON.stringify(
    {
      ...fixture,
      product,
      barcode,
      activeSession: newSession,
      sharedDevice: b.device,
    },
    null,
    2
  ),
  { mode: 0o600 }
);
const checks = [
  "Kalıcı sepet ve yeniden yüklemede aynı kayıt",
  "Stok bekletmede ve iptalde düşmedi",
  "Açıklamasız iptal reddi; önce/sonra, kullanıcı ve cihaz izi",
  "Eski sürüm ve yanlış cihaz reddi",
  "Eşzamanlı aynı bekletme isteği tek kayıt",
  "İki cihazın sepet çağırma yarışında tek kazanan",
  "Fiyat değişimi reddi ve açık fiyat yenileme",
  "Karma ödeme, kart teyidi ve yalnız nakit payından para üstü",
  "Kayıp yanıtta aynı ödeme isteği tek satış ve stok hareketi",
  "Karma ödemenin ortak kasa özeti ve kapanışına doğru yansıması",
  "Tüm sepet iptali tekrarında tek açıklamalı kayıt",
  "Ortak kapanıştan kalan sepetin yeni oturuma alınması",
  "Başka şirketten listeleme ve çağırma reddi",
];
await writeFile(
  out + "/result.json",
  JSON.stringify({ ok: true, checks }, null, 2)
);
console.log(JSON.stringify({ ok: true, checks }, null, 2));

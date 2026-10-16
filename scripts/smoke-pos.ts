import { strict as assert } from "node:assert";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

if (process.env.SMOKE_TEST !== "1")
  throw new Error(
    "This writes DEMO fixtures; set SMOKE_TEST=1 only on an isolated local test server."
  );
const base = process.env.SMOKE_BASE_URL ?? "http://127.0.0.1:3301";
if (!["localhost", "127.0.0.1"].includes(new URL(base).hostname))
  throw new Error("Local test server required");
const tag = randomUUID().slice(0, 8);
type Actor = {
  cookie: string;
  csrf: string;
  device: string;
  email: string;
  password: string;
};
async function http(
  path: string,
  actor?: Actor,
  body?: Record<string, unknown>
) {
  const r = await fetch(base + path, {
    method: body ? "POST" : "GET",
    headers: {
      "Content-Type": "application/json",
      "X-Stationos-Request": "1",
      Origin: base,
      ...(actor
        ? {
            Cookie: actor.cookie,
            "X-CSRF-Token": actor.csrf,
            "X-Stationos-Device-Id": actor.device,
          }
        : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return {
    status: r.status,
    data: await r.json(),
    cookie: r.headers.get("set-cookie")?.split(";")[0] ?? "",
  };
}
async function ok(
  path: string,
  actor: Actor,
  body?: Record<string, unknown>,
  status = 200
) {
  const r = await http(path, actor, body);
  assert.equal(r.status, status, `${path}: ${JSON.stringify(r.data)}`);
  return r.data;
}
async function auth(label: string) {
  const a: Actor = {
    cookie: "",
    csrf: "",
    device: randomUUID(),
    email: `pos-${tag}-${label}@example.invalid`,
    password: randomBytes(24).toString("base64url"),
  };
  const r = await http("/api/auth/register", undefined, {
    email: a.email,
    password: a.password,
    name: `DEMO POS ${label}`,
  });
  assert.equal(r.status, 201);
  a.cookie = r.cookie;
  a.csrf = (await ok("/api/stationos/state", a)).csrfToken;
  return a;
}
const owner = await auth("owner"),
  outsider = await auth("outsider"),
  staff = await auth("staff"),
  fuel = await auth("fuel");
const station = (
  await ok("/api/stationos/setup", owner, {
    requestId: randomUUID(),
    companyName: `DEMO POS ${tag}`,
    stationName: "DEMO market",
    stationCode: tag,
    isDemo: true,
  })
).result.stationId;
const foreignStation = (
  await ok("/api/stationos/setup", outsider, {
    requestId: randomUUID(),
    companyName: `Isolated non-demo ${tag}`,
    stationName: "Isolated",
    stationCode: tag,
    isDemo: false,
  })
).result.stationId;
for (const [actor, role] of [
  [staff, "MARKET_STAFF"],
  [fuel, "FUEL_STAFF"],
] as const) {
  const inv = await ok("/api/stationos/invite", owner, {
    requestId: randomUUID(),
    role,
    stationIds: [station],
  });
  await ok("/api/stationos/join", actor, {
    requestId: randomUUID(),
    code: inv.result.code,
  });
}
const mutate = (
  a: Actor,
  path: string,
  body: Record<string, unknown>,
  status = 200
) =>
  ok(
    `/api/stationos${path}`,
    a,
    { requestId: randomUUID(), stationId: station, ...body },
    status
  );
const pos = (a: Actor = owner) =>
  ok(`/api/stationos/pos?stationId=${station}`, a);
await ok(`/api/stationos/pos?stationId=${station}`, outsider, undefined, 403);
await ok(`/api/stationos/pos?stationId=${station}`, fuel, undefined, 403);
await mutate(staff, "/pos/register", { name: "Forbidden", code: "NO" }, 403);
const ra = (
  await mutate(owner, "/pos/register", { name: "Ana kasa", code: `A-${tag}` })
).result.id;
const rb = (
  await mutate(owner, "/pos/register", {
    name: "İkinci kasa",
    code: `B-${tag}`,
  })
).result.id;
const a = owner,
  b = { ...owner, device: randomUUID() },
  otherDevice = { ...owner, device: randomUUID() };
const sa = (
  await mutate(a, "/pos/open", { registerId: ra, openingFloatMinor: 1000 })
).result.id;
const sb = (
  await mutate(b, "/pos/open", { registerId: rb, openingFloatMinor: 2000 })
).result.id;
await mutate(
  otherDevice,
  "/pos/open",
  { registerId: ra, openingFloatMinor: 0 },
  409
);
const createProduct = async (name: string, price: number, stock: number) => {
  const id = (
    await mutate(owner, "/product", {
      name,
      barcode: `${tag}-${name}`,
      minimumQty: 0,
      purchasePriceMinor: 0,
      salePriceMinor: price,
      supplierId: null,
    })
  ).result.id;
  await mutate(owner, "/stock", {
    productId: id,
    kind: "RECEIPT",
    quantity: stock,
  });
  return id;
};
const p = await createProduct("test-urun", 250, 5),
  q = await createProduct("son-urun", 100, 1);
const line = (productId: string, quantity = 1, price = 250) => ({
  productId,
  quantity,
  expectedUnitPriceMinor: price,
});
const sale = (
  sessionId = sa,
  lines = [line(p)],
  extra: Record<string, unknown> = {}
) => ({ sessionId, lines, paymentKind: "CASH", tenderedMinor: 1000, ...extra });
await mutate(a, "/pos/checkout", sale(sb), 403);
await mutate(a, "/pos/checkout", sale(sa, [line(p, 1, 249)]), 409);
await mutate(a, "/pos/checkout", sale(sa, [line(p), line(randomUUID())]), 404);
await mutate(
  a,
  "/pos/checkout",
  sale(sa, [line(p)], { paymentKind: "CARD_MANUAL", cardConfirmed: false }),
  409
);
await mutate(
  a,
  "/pos/checkout",
  sale(sa, [line(p, 2)], { tenderedMinor: 400 }),
  409
);
const paid = {
  ...sale(sa, [line(p, 2)]),
  stationId: station,
  requestId: randomUUID(),
};
const receipt = await ok("/api/stationos/pos/checkout", a, paid);
assert.equal(receipt.result.totalMinor, 500);
assert.equal(receipt.result.changeMinor, 500);
assert.deepEqual(await ok("/api/stationos/pos/checkout", a, paid), receipt);
await ok(
  "/api/stationos/pos/checkout",
  a,
  { ...paid, lines: [line(p, 1)] },
  409
);
await mutate(
  b,
  "/pos/checkout",
  sale(sb, [line(p)], { paymentKind: "CARD_MANUAL", cardConfirmed: true })
);
const race = await Promise.all([
  http("/api/stationos/pos/checkout", a, {
    ...sale(sa, [line(q, 1, 100)]),
    requestId: randomUUID(),
    stationId: station,
  }),
  http("/api/stationos/pos/checkout", b, {
    ...sale(sb, [line(q, 1, 100)]),
    requestId: randomUUID(),
    stationId: station,
  }),
]);
assert.deepEqual(race.map(r => r.status).sort(), [200, 409]);
assert.equal(
  race.find(r => r.status === 409)?.data.error.code,
  "NEGATIVE_INVENTORY"
);
const same = { ...sale(sa), stationId: station, requestId: randomUUID() };
const retries = await Promise.all([
  http("/api/stationos/pos/checkout", a, same),
  http("/api/stationos/pos/checkout", a, same),
]);
assert.equal(retries[0].status, 200);
assert.equal(retries[1].status, 200);
assert.deepEqual(retries[0].data, retries[1].data);
let state = await pos();
assert.equal(state.products.find((x: any) => x.id === p).stockQty, 1);
assert.equal(state.products.find((x: any) => x.id === q).stockQty, 0);
const sessionA = state.sessions.find((s: any) => s.id === sa),
  sessionB = state.sessions.find((s: any) => s.id === sb);
assert.equal(sessionB.cardDeclaredMinor, 250);
assert.equal(sessionA.cardDeclaredMinor, 0);
assert.equal(sessionA.cashSalesMinor + sessionB.cashSalesMinor, 850);
await mutate(
  a,
  "/pos/close",
  { sessionId: sa, countedCashMinor: sessionA.expectedCashMinor + 1 },
  409
);
const closed = await mutate(a, "/pos/close", {
  sessionId: sa,
  countedCashMinor: sessionA.expectedCashMinor + 1,
  note: "DEMO bir kuruş sayım farkı",
});
assert.equal(closed.result.differenceMinor, 1);
await mutate(a, "/pos/checkout", sale(), 409);
await mutate(b, "/pos/close", {
  sessionId: sb,
  countedCashMinor: sessionB.expectedCashMinor,
});
await mutate(a, "/pos/open", { registerId: ra, openingFloatMinor: 0 });
assert.deepEqual(await ok("/api/stationos/pos/checkout", a, paid), receipt);
// Non-DEMO checkouts stay blocked server-side even when valid own stock exists.
const foreignReg = (
  await mutate(outsider, "/pos/register", {
    stationId: foreignStation,
    name: "Isolated",
    code: "REAL",
  })
).result.id;
const foreignSession = (
  await mutate(outsider, "/pos/open", {
    stationId: foreignStation,
    registerId: foreignReg,
    openingFloatMinor: 0,
  })
).result.id;
const blocked = await mutate(
  outsider,
  "/pos/checkout",
  { stationId: foreignStation, ...sale(foreignSession) },
  409
);
assert.equal(blocked.error.code, "DEMO_ONLY");
const saved = await pos();
assert.equal(saved.sales.length, 4);
assert.equal(saved.capabilities.printer, "NOT_CONFIGURED");
assert.equal(saved.capabilities.sync, "NOT_CONFIGURED");
const output = process.env.SMOKE_OUTPUT_DIR ?? ".local/pos-smoke";
await mkdir(output, { recursive: true, mode: 0o700 });
await writeFile(
  join(output, "fixture.json"),
  JSON.stringify(
    {
      owner,
      station,
      registerA: ra,
      registerB: rb,
      product: p,
      barcode: `${tag}-test-urun`,
      saleId: receipt.result.id,
    },
    null,
    2
  ),
  { mode: 0o600 }
);
const checks = [
  "Aynı kullanıcı iki ayrı cihaz/kasada eşzamanlı oturum",
  "Tenant/rol ve tarayıcıya bağlı kasa kapsamı",
  "Sunucu fiyatı, stok ve nakit kontrolleri",
  "Tekrar istek ve eşzamanlı aynı istek tek satış",
  "İki kasanın son ürünü yarışında yalnız bir satış",
  "Kart beyanı çekmece nakdine eklenmedi",
  "Kapanış farkı kaydı, kapanmış kasa reddi ve yeniden açılış",
  "Gerçek firmada DEMO kapısı; cihaz/senkronizasyon durumları doğru",
];
await writeFile(
  join(output, "result.json"),
  JSON.stringify(
    { ok: true, station, saleId: receipt.result.id, checks },
    null,
    2
  )
);
console.log(JSON.stringify({ ok: true, checks }, null, 2));

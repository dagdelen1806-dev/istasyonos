import { strict as assert } from "node:assert";
import { randomUUID, randomBytes } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import mysql from "mysql2/promise";
if (process.env.SMOKE_TEST !== "1")
  throw Error("Explicit opt-in required; synthetic DEMO writes only.");
const base = process.env.SMOKE_BASE_URL ?? "http://127.0.0.1:3303";
if (!["localhost", "127.0.0.1"].includes(new URL(base).hostname))
  throw Error("Local server required");
const db = new URL(process.env.DATABASE_URL ?? "");
if (
  db.pathname !== "/istasyonos_pos_v2_test" ||
  db.searchParams.get("socketPath") !== "/workspace/local-mysql/mysql.sock"
)
  throw Error("Exact isolated test DB required");
type Actor = {
  cookie: string;
  csrf: string;
  device: string;
  email: string;
  password: string;
};
async function http(path: string, a?: Actor, body?: Record<string, unknown>) {
  const r = await fetch(base + path, {
    method: body ? "POST" : "GET",
    headers: {
      "Content-Type": "application/json",
      "X-Stationos-Request": "1",
      Origin: base,
      ...(a
        ? {
            Cookie: a.cookie,
            "X-CSRF-Token": a.csrf,
            "X-Stationos-Device-Id": a.device,
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
async function auth(label: string) {
  const a: Actor = {
    cookie: "",
    csrf: "",
    device: randomUUID(),
    email: `market-${randomUUID()}@example.invalid`,
    password: randomBytes(24).toString("hex"),
  };
  const r = await http("/api/auth/register", undefined, {
    email: a.email,
    password: a.password,
    name: `DEMO ${label}`,
  });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  a.cookie = r.cookie;
  a.csrf = (await http("/api/stationos/state", a)).data.csrfToken;
  return a;
}
const owner = await auth("market sahibi"),
  manager = await auth("market yöneticisi"),
  staff = await auth("market personeli"),
  outsider = await auth("dış kullanıcı");
async function raw(
  path: string,
  a = owner,
  body?: Record<string, unknown>,
  expected = 200
) {
  const r = await http("/api/stationos" + path, a, body);
  assert.equal(r.status, expected, `${path}: ${JSON.stringify(r.data)}`);
  return r.data;
}
const station = (
  await raw("/setup", owner, {
    requestId: randomUUID(),
    companyName: `DEMO raf etiket testi ${randomUUID().slice(0, 8)}`,
    stationName: "DEMO Muhasebe Market",
    stationCode: randomUUID().slice(0, 8),
    isDemo: true,
  })
).result.stationId;
const post = (
  path: string,
  body: Record<string, unknown>,
  expected = 200,
  a = owner
) =>
  raw(
    path,
    a,
    { stationId: station, requestId: randomUUID(), ...body },
    expected
  ).then(d => d.result ?? d);
const account = () => raw("/market-accounting?stationId=" + station),
  lotState = () =>
    raw("/market-accounting/inventory/lots?stationId=" + station),
  pos = () => raw("/pos?stationId=" + station);
const lp = (
  path: string,
  body: Record<string, unknown>,
  status = 200,
  a = owner
) => post("/market-accounting/inventory/" + path, body, status, a);
for (const [a, role] of [
  [staff, "MARKET_STAFF"],
  [manager, "MANAGER"],
] as const) {
  const code = (await post("/invite", { role, stationIds: [station] })).code;
  await raw("/join", a, { requestId: randomUUID(), code });
}
const p = (
  await post("/product", {
    name: "DEMO raf süt",
    barcode: "0012345678901",
    minimumQty: 0,
    purchasePriceMinor: 0,
    salePriceMinor: 1250,
    supplierId: null,
  })
).id;
const q = (
  await post("/product", {
    name: "DEMO raf su",
    barcode: "024354200763",
    minimumQty: 0,
    purchasePriceMinor: 0,
    salePriceMinor: 2500,
    supplierId: null,
  })
).id;
await post("/market-accounting/start", {
  openingStockAccepted: true,
  expectedInventoryMinor: (await account()).openingInventoryMinor,
  cashMinor: 0,
  bankMinor: 0,
  cardMinor: 0,
});
const today = (await account()).today;
const state = () =>
  raw("/market-accounting/inventory/shelf-labels?stationId=" + station);
const batch = (id: string, a = owner) =>
  raw(
    `/market-accounting/inventory/shelf-batches/${id}?stationId=${station}`,
    a
  );
const lookup = (barcode = "0012345678901", a = owner, status = 200) =>
  raw(
    `/market-accounting/inventory/shelf-check?stationId=${station}&barcode=${encodeURIComponent(barcode)}`,
    a,
    undefined,
    status
  );
const card = (s: any, id = p) =>
  s.items.find((i: any) => i.snapshot.productId === id);
const physical = (a: any) =>
  JSON.stringify({
    revision: a.revision,
    balances: a.balances,
    daily: a.daily,
    closes: a.closes,
    stockValueMinor: a.stockValueMinor,
    stock: a.stock
      .map((s: any) => ({
        id: s.id,
        quantity: s.quantity,
        valueMinor: s.valueMinor,
        averageCostMinor: s.averageCostMinor,
      }))
      .sort((a: any, b: any) => a.id.localeCompare(b.id)),
  });
const pricing = async (id: string, price: number, vat: number) =>
  post("/market-accounting/product", {
    productId: id,
    salePriceMinor: price,
    vatBps: vat,
  });
await pricing(p, 1250, 1000);
let s = await state();
assert.equal(card(s).labelStatus, "UNRECORDED");
assert.equal(card(s, q).issue.includes("KDV"), true);
await raw(
  "/market-accounting/inventory/shelf-labels?stationId=" + station,
  staff,
  undefined,
  403
);
await raw(
  "/market-accounting/inventory/shelf-labels?stationId=" + station,
  outsider,
  undefined,
  403
);
await lookup("0012345678901", staff);
await lookup("0012345678901", outsider, 403);
const row = (s: any, id = p) => ({
  productId: id,
  expectedHash: card(s, id).hash,
  copies: 1,
});
const create = (s: any, ids = [p, q], extra: Record<string, unknown> = {}) =>
  lp("shelf-batch", {
    batchId: randomUUID(),
    label: "DEMO raf paketi",
    items: ids.map(id => row(s, id)),
    ...extra,
  });
await lp(
  "shelf-batch",
  {
    batchId: randomUUID(),
    label: "DEMO bilinmeyen KDV",
    items: [row(s), row(s, q)],
  },
  409
);
assert.equal((await state()).batches.length, 0);
await pricing(q, 2500, 2000);
s = await state();
await lp(
  "shelf-batch",
  {
    batchId: randomUUID(),
    label: "DEMO çok kopya",
    items: [{ ...row(s), copies: 21 }],
  },
  400
);
await lp(
  "shelf-batch",
  { batchId: randomUUID(), label: "DEMO tekrar ürün", items: [row(s), row(s)] },
  400
);
await raw(
  "/market-accounting/inventory/shelf-batch",
  { ...owner, csrf: "" },
  {
    stationId: station,
    requestId: randomUUID(),
    batchId: randomUUID(),
    label: "DEMO CSRF",
    items: [row(s)],
  },
  403
);
const old = s;
await pricing(p, 1300, 1000);
await lp(
  "shelf-batch",
  { batchId: randomUUID(), label: "DEMO eski önizleme", items: [row(old)] },
  409
);
assert.equal((await state()).batches.length, 0);
s = await state();
const id = randomUUID(),
  request = {
    stationId: station,
    requestId: randomUUID(),
    batchId: id,
    label: "DEMO değişmeyecek paket",
    items: [{ ...row(s), copies: 2 }, row(s, q)],
  };
const created = await raw(
  "/market-accounting/inventory/shelf-batch",
  owner,
  request
);
assert.deepEqual(
  await raw("/market-accounting/inventory/shelf-batch", owner, request),
  created
);
await raw(
  "/market-accounting/inventory/shelf-batch",
  staff,
  { ...request, requestId: randomUUID(), batchId: randomUUID() },
  403
);
await raw(
  `/market-accounting/inventory/shelf-batches/${id}?stationId=${station}`,
  staff,
  undefined,
  403
);
const initial = await batch(id);
assert.equal(
  initial.items.reduce((n: number, i: any) => n + i.copies, 0),
  3
);
assert.equal(
  initial.items.every((i: any) => i.isCurrent && i.installedAt === null),
  true
);
const noPrintWrite = physical(await account());
await batch(id);
await state();
assert.equal(physical(await account()), noPrintWrite);
assert.equal(card(await state()).labelStatus, "UNRECORDED");
await lp("barcode", {
  productId: q,
  barcode: "DEMO-KOLI",
  packQty: 6,
  label: "DEMO koli",
});
await lp("barcode", {
  productId: q,
  barcode: "DEMO-ALIAS",
  packQty: 1,
  label: "DEMO adet",
});
await lookup("DEMO-KOLI", staff, 409);
assert.equal((await lookup("DEMO-ALIAS", staff)).snapshot.productId, q);
const minimal = await lookup("0012345678901", staff);
assert.equal("purchase_price_minor" in minimal.snapshot, false);
assert.equal("quantity" in minimal.snapshot, false);
assert.equal("unitNetMinor" in minimal.snapshot, false);
const check = (current: any, more: Record<string, unknown> = {}) => ({
  barcode: "0012345678901",
  expectedHash: current.hash,
  observedMinor: 1300,
  physicalChecked: true,
  ...more,
});
await lp("shelf-check", check(minimal), 403, staff);
await lp(
  "device-register",
  {
    name: "DEMO TC73 fiyat kontrol",
    model: "TC73 tarayıcı",
    platform: "ANDROID",
  },
  200,
  staff
);
await lp("shelf-check", check(minimal), 403, staff);
await lp("device-approve", { deviceId: staff.device, enabled: true });
await lp("shelf-check", check(minimal, { physicalChecked: false }), 409, staff);
await lp("shelf-check", check(minimal, { observedMinor: 1299 }), 400, staff);
await lp("shelf-check", check(minimal, { expectedHash: "old" }), 409, staff);
const checkRequest = {
    stationId: station,
    requestId: randomUUID(),
    ...check(minimal),
  },
  match = await raw(
    "/market-accounting/inventory/shelf-check",
    staff,
    checkRequest
  );
assert.equal(match.result.matches, true);
assert.equal(match.result.labelStatus, "UNRECORDED");
assert.deepEqual(
  await raw("/market-accounting/inventory/shelf-check", staff, checkRequest),
  match
);
await lp(
  "shelf-check",
  check(minimal, {
    observedMinor: 1299,
    reason: "DEMO rafta eski fiyat görüldü",
  }),
  200,
  staff
);
assert.equal(card(await state()).labelStatus, "UNRECORDED");
await lp(
  "shelf-install",
  {
    batchId: id,
    productIds: [q],
    placedAccepted: false,
    reason: "DEMO teyitsiz raf",
  },
  409
);
await lp(
  "shelf-install",
  {
    batchId: id,
    productIds: [q],
    placedAccepted: true,
    reason: "DEMO personel teyidi",
  },
  403,
  staff
);
const financialBefore = physical(await account());
await lp("shelf-install", {
  batchId: id,
  productIds: [q],
  placedAccepted: true,
  reason: "DEMO su rafı fizikî teyit",
});
assert.equal(card(await state(), q).labelStatus, "CURRENT");
assert.equal(physical(await account()), financialBefore);
await pricing(p, 1400, 1000);
await lp("shelf-check", check(minimal), 409, staff);
assert.deepEqual(
  await raw("/market-accounting/inventory/shelf-check", staff, checkRequest),
  match
);
const qBefore = card(await state(), q).installedAt;
await lp(
  "shelf-install",
  {
    batchId: id,
    productIds: [p, q],
    placedAccepted: true,
    reason: "DEMO eski paket reddi",
  },
  409
);
assert.equal(card(await state(), q).installedAt, qBefore);
assert.equal(card(await state()).labelStatus, "UNRECORDED");
const stale = await batch(id);
assert.equal(
  stale.items.find((i: any) => i.snapshot.productId === p).snapshot.priceMinor,
  1300
);
assert.equal(
  stale.items.find((i: any) => i.snapshot.productId === p).isCurrent,
  false
);
// A real stock/cost receipt and a named list change must not dirty the retail shelf label.
const vendor = (
  await post("/market-accounting/party", {
    name: "DEMO raf tedarikçisi",
    kind: "SUPPLIER",
    receivableLimitMinor: 0,
    payableLimitMinor: null,
    termDays: 0,
  })
).id;
await post("/market-accounting/purchase", {
  partyId: vendor,
  reference: "DEMO-SHELF-STOCK",
  dueDate: today,
  expectedTotalMinor: 1200,
  lines: [{ productId: q, quantity: 1, unitNetMinor: 1000, vatBps: 2000 }],
});
assert.equal(card(await state(), q).labelStatus, "CURRENT");
const list = (
  await lp("price-list", {
    name: "DEMO özel fiyat",
    active: true,
    staffEnabled: true,
  })
).id;
await lp("price", { productId: q, listId: list, unitPriceMinor: 999 });
assert.equal(card(await state(), q).labelStatus, "CURRENT");
await pricing(p, 1300, 1000);
assert.equal(
  (await batch(id)).items.find((i: any) => i.snapshot.productId === p)
    .isCurrent,
  false
); // same price, later price event
s = await state();
const next = (await create(s, [p])).id;
await lp("shelf-install", {
  batchId: next,
  productIds: [p],
  placedAccepted: true,
  reason: "DEMO yeni süt rafı teyidi",
});
assert.equal(card(await state()).labelStatus, "CURRENT");
const profile = async (name: string, shelf: string) =>
  lp("product", {
    productId: p,
    name,
    unit: "adet",
    shelf,
    minimumQty: 0,
    maximumQty: 0,
    leadDays: 3,
    reviewDays: 7,
    safetyDays: 2,
    orderPackQty: 1,
    supplierId: null,
    purchaseVatBps: null,
  });
await profile("DEMO raf süt yeni", "A-2");
s = await state();
assert.equal(card(s).labelStatus, "CHANGED");
assert.ok(card(s).changedFields.includes("Ürün adı"));
assert.ok(card(s).changedFields.includes("Raf"));
await profile("DEMO raf süt", "");
await pricing(p, 1500, 1000);
s = await state();
assert.equal(card(s).labelStatus, "CHANGED");
await lp("device-approve", { deviceId: staff.device, enabled: false });
await lp(
  "shelf-check",
  check(await lookup("0012345678901", staff), { observedMinor: 1500 }),
  403,
  staff
);
await lp("device-approve", { deviceId: staff.device, enabled: true });
const sql = await mysql.createConnection(process.env.DATABASE_URL!);
const [events]: any = await sql.query(
  "SELECT COUNT(*) n FROM st_shelf_label_events WHERE batch_id IN (?,?)",
  [id, next]
);
assert.equal(Number(events[0].n), 2);
const [storedChecks]: any = await sql.query(
  "SELECT COUNT(*) n FROM st_shelf_price_checks WHERE station_id=?",
  [station]
);
assert.equal(Number(storedChecks[0].n), 2);
await sql.end();
if (process.env.SMOKE_LEAVE_OPEN !== "1") {
  const a = await account();
  await post("/market-accounting/day-close", {
    expectedRevision: a.revision,
    countedCashMinor: 0,
  });
  const beforeClosed = physical(await account());
  const fresh = (await create(await state(), [p])).id;
  await lp("shelf-install", {
    batchId: fresh,
    productIds: [p],
    placedAccepted: true,
    reason: "DEMO kapalı günde raf teyidi",
  });
  await lp(
    "shelf-check",
    check(await lookup("0012345678901", staff), { observedMinor: 1500 }),
    200,
    staff
  );
  assert.equal(physical(await account()), beforeClosed);
}
const output =
  process.env.SMOKE_OUTPUT_DIR ?? "/workspace/shelf-label-test/dev";
await mkdir(output, { recursive: true, mode: 0o700 });
await writeFile(
  output + "/fixture.json",
  JSON.stringify({
    owner,
    manager,
    staff,
    outsider,
    station,
    p,
    q,
    oldBatch: id,
  }),
  { mode: 0o600 }
);
const checks = [
  "Rol/tenant/CSRF ve personelden maliyet/stok gizleyen tek ürün fiyat okuma",
  "Paket önizlemesi, kopya sınırı, eski hash reddi ve aynı-ID tek paket",
  "Paket okuma/basım hazırlığı rafı otomatik güncel saymadı",
  "Fizikî yerleştirme teyidi, eski pakette atomik reddetme ve olay izi",
  "Onaylı cihaz, koli barkodu reddi, adet alias, fiyat farkı açıklaması ve aynı-ID tek kontrol",
  "Stok/net maliyet ve özel fiyat listesi değişikliği raf etiketini kirletmedi",
  "Eski fiyata dönüşte yeni fiyat kaydı, ad/raf değişiminde yeniden etiket gereği",
  "Stok/defter/revizyon etkisiz raf işlemleri",
  ...(process.env.SMOKE_LEAVE_OPEN === "1"
    ? []
    : ["Kapalı günde paket/teyit/kontrol açık, mali kapanış değişmedi"]),
];
await writeFile(
  output + "/result.json",
  JSON.stringify({ ok: true, checks }, null, 2)
);
console.log(JSON.stringify({ ok: true, checks }, null, 2));

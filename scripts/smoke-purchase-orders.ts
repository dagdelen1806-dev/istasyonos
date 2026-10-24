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
    companyName: `DEMO satın alma sipariş testi ${randomUUID().slice(0, 8)}`,
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
const accountant = await auth("market muhasebecisi");
const invite = (
  await post("/invite", { role: "ACCOUNTANT", stationIds: [station] })
).code;
await raw("/join", accountant, { requestId: randomUUID(), code: invite });
const p = (
  await post("/product", {
    name: "DEMO sipariş süt",
    barcode: "001234560001",
    minimumQty: 10,
    purchasePriceMinor: 0,
    salePriceMinor: 300,
    supplierId: null,
  })
).id;
const q = (
  await post("/product", {
    name: "DEMO sipariş su",
    barcode: "001234560002",
    minimumQty: 5,
    purchasePriceMinor: 0,
    salePriceMinor: 500,
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
const vendor = (
  await post("/market-accounting/party", {
    name: "DEMO sipariş tedarikçisi",
    kind: "SUPPLIER",
    receivableLimitMinor: 0,
    payableLimitMinor: 100000,
    termDays: 7,
  })
).id;
const customer = (
  await post("/market-accounting/party", {
    name: "DEMO müşteri",
    kind: "CUSTOMER",
    receivableLimitMinor: 0,
    payableLimitMinor: null,
    termDays: 0,
  })
).id;
for (const [id, minimum, maximum, pack, vat] of [
  [p, 10, 12, 6, 1000],
  [q, 5, 6, 3, 2000],
])
  await lp("product", {
    productId: id,
    name: id === p ? "DEMO sipariş süt" : "DEMO sipariş su",
    unit: "adet",
    minimumQty: minimum,
    maximumQty: maximum,
    leadDays: 3,
    reviewDays: 7,
    safetyDays: 2,
    orderPackQty: pack,
    supplierId: vendor,
    purchaseVatBps: vat,
  });
let ls = await lotState();
await lp("lot-enable", {
  productId: p,
  expectedRevision: (await account()).revision,
  expectedVersion: ls.products.find((x: any) => x.id === p).stockVersion,
  reason: "DEMO siparişli ürün parti takibi",
  lots: [],
});
const inventory = () =>
    raw("/market-accounting/inventory?stationId=" + station),
  detail = (id: string, a = owner) =>
    raw(`/market-accounting/inventory/orders/${id}?stationId=${station}`, a);
const orders = (status = "ALL", cursor = "") =>
  raw(
    `/market-accounting/inventory/orders?stationId=${station}&status=${status}&cursor=${cursor}`
  );
const lines = [
    { productId: p, quantity: 12, unitNetMinor: 100, vatBps: 1000 },
    { productId: q, quantity: 6, unitNetMinor: 200, vatBps: 2000 },
  ],
  newId = randomUUID();
const draft = {
  newOrderId: newId,
  supplierId: vendor,
  label: "DEMO ana sipariş",
  expectedDate: today,
  lines,
};
const before = await account();
await raw(
  "/market-accounting/inventory/orders?stationId=" + station,
  staff,
  undefined,
  403
);
await raw(
  "/market-accounting/inventory/orders?stationId=" + station,
  outsider,
  undefined,
  403
);
await raw(
  "/market-accounting/inventory/order-save",
  { ...owner, csrf: "" },
  { stationId: station, requestId: randomUUID(), ...draft },
  403
);
await lp("order-save", { ...draft, supplierId: customer }, 404);
await lp("order-save", { ...draft, lines: [lines[0], lines[0]] }, 400);
await lp(
  "order-save",
  { ...draft, lines: [{ ...lines[0], quantity: 0 }] },
  400
);
await lp(
  "order-save",
  { ...draft, lines: [{ ...lines[0], vatBps: null }] },
  400
);
await lp("order-save", draft, 403, staff);
const createRequest = { stationId: station, requestId: randomUUID(), ...draft };
const created = await raw(
  "/market-accounting/inventory/order-save",
  accountant,
  createRequest
);
assert.equal(created.result.id, newId);
assert.deepEqual(
  await raw(
    "/market-accounting/inventory/order-save",
    accountant,
    createRequest
  ),
  created
);
let o = await detail(newId);
assert.equal(o.status, "DRAFT");
assert.equal(o.remainingGrossMinor, 2760);
assert.equal(
  (await inventory()).items.find((x: any) => x.id === p).onOrderQty,
  0
);
await lp("order-receive", { orderId: o.id, orderVersion: o.version }, 409);
await lp(
  "order-save",
  {
    orderId: o.id,
    orderVersion: o.version,
    supplierId: vendor,
    label: "DEMO güncel sipariş",
    expectedDate: today,
    lines,
  },
  200,
  accountant
);
await lp(
  "order-approve",
  {
    orderId: o.id,
    orderVersion: o.version,
    expectedTotalMinor: 2760,
    reason: "DEMO eski sürüm onayı reddi",
  },
  409
);
o = await detail(o.id);
await lp(
  "order-approve",
  {
    orderId: o.id,
    orderVersion: o.version,
    expectedTotalMinor: 2760,
    reason: "DEMO yetkisiz muhasebeci onayı",
  },
  403,
  accountant
);
await lp(
  "order-approve",
  {
    orderId: o.id,
    orderVersion: o.version,
    expectedTotalMinor: 2761,
    reason: "DEMO yanlış onay toplamı",
  },
  409
);
await lp(
  "order-approve",
  {
    orderId: o.id,
    orderVersion: o.version,
    expectedTotalMinor: 2760,
    reason: "DEMO yönetici sipariş onayı",
  },
  200,
  manager
);
o = await detail(o.id);
assert.equal(o.status, "APPROVED");
assert.deepEqual(await account(), before);
let inv = await inventory();
assert.equal(inv.items.find((x: any) => x.id === p).onOrderQty, 12);
assert.equal(inv.items.find((x: any) => x.id === p).suggestedQty, 0);
assert.equal(inv.items.find((x: any) => x.id === p).critical, true);
assert.equal(inv.items.find((x: any) => x.id === q).onOrderQty, 6);
await raw(
  `/market-accounting/inventory/orders/${o.id}?stationId=${station}`,
  outsider,
  undefined,
  403
);
await lp(
  "order-save",
  {
    orderId: o.id,
    orderVersion: o.version,
    supplierId: vendor,
    label: "DEMO onaylı taslak ezilmez",
    expectedDate: today,
    lines,
  },
  409
);
const receiving = async (
  order: any,
  reference: string = "DEMO-PO-1",
  xs: any[] = [
    {
      productId: p,
      quantity: 4,
      unitNetMinor: 100,
      vatBps: 1000,
      lots: [{ code: "DEMO-PO-A", expiryDate: today, quantity: 4 }],
    },
    { productId: q, quantity: 2, unitNetMinor: 200, vatBps: 2000 },
  ]
) => ({
  orderId: order.id,
  orderVersion: order.version,
  expectedRevision: (await account()).revision,
  reference,
  dueDate: today,
  expectedTotalMinor: 920,
  deliveryAccepted: true,
  lines: xs,
});
let receipt = await receiving(o);
await lp("order-receive", { ...receipt, deliveryAccepted: false }, 409);
await lp(
  "order-receive",
  { ...receipt, expectedRevision: receipt.expectedRevision - 1 },
  409
);
await lp("order-receive", { ...receipt, expectedTotalMinor: 921 }, 409);
await lp(
  "order-receive",
  { ...receipt, lines: [{ ...receipt.lines[0], quantity: 13 }] },
  409
);
await lp(
  "order-receive",
  { ...receipt, lines: [{ ...receipt.lines[0], unitNetMinor: 101 }] },
  409
);
await lp(
  "order-receive",
  { ...receipt, lines: [{ ...receipt.lines[0], lots: [] }, receipt.lines[1]] },
  400
);
assert.deepEqual(await account(), before);
assert.equal((await detail(o.id)).receivedQty, 0);
const receiptRequest = {
  stationId: station,
  requestId: randomUUID(),
  ...receipt,
};
const received = await raw(
  "/market-accounting/inventory/order-receive",
  accountant,
  receiptRequest
);
assert.deepEqual(
  await raw(
    "/market-accounting/inventory/order-receive",
    accountant,
    receiptRequest
  ),
  received
);
o = await detail(o.id);
assert.equal(o.status, "PARTIAL");
assert.equal(o.receivedQty, 6);
assert.equal(o.receipts.length, 1);
assert.equal(o.receipts[0].totalMinor, 920);
assert.equal(
  o.receipts[0].items.find((x: any) => x.productId === p).unitNetMinor,
  100
);
let a = await account();
assert.equal(a.stockValueMinor, 800);
assert.equal(a.balances.INPUT_VAT, 120);
assert.equal(a.balances.PAYABLE, -920);
inv = await inventory();
assert.equal(inv.items.find((x: any) => x.id === p).quantity, 4);
assert.equal(inv.items.find((x: any) => x.id === p).onOrderQty, 8);
assert.equal(inv.items.find((x: any) => x.id === p).suggestedQty, 0);
const frozen = await account(),
  oldOrder = JSON.stringify(o);
await lp("order-receive", await receiving(o), 409);
assert.deepEqual(await account(), frozen);
assert.equal(JSON.stringify(await detail(o.id)), oldOrder);
await post("/market-accounting/party-update", {
  partyId: vendor,
  name: "DEMO sipariş tedarikçisi",
  receivableLimitMinor: 0,
  payableLimitMinor: 1000,
  termDays: 7,
});
await lp("order-receive", await receiving(o, "DEMO-PO-LIMIT"), 409);
assert.equal((await detail(o.id)).receiptCount, 1);
assert.equal((await account()).stockValueMinor, 800);
await post("/market-accounting/party-update", {
  partyId: vendor,
  name: "DEMO sipariş tedarikçisi",
  receivableLimitMinor: 0,
  payableLimitMinor: 100000,
  termDays: 7,
});
await lp(
  "order-reprice",
  {
    orderId: o.id,
    orderVersion: o.version,
    expectedDate: today,
    reason: "DEMO muhasebeci revizyon yapamaz",
    expectedTotalMinor: 2280,
    lines: [
      { productId: p, unitNetMinor: 150, vatBps: 1000 },
      { productId: q, unitNetMinor: 200, vatBps: 2000 },
    ],
  },
  403,
  accountant
);
const repriceBefore = await account();
await lp(
  "order-reprice",
  {
    orderId: o.id,
    orderVersion: o.version,
    expectedDate: today,
    reason: "DEMO güncel fatura fiyatı onayı",
    expectedTotalMinor: 2280,
    lines: [
      { productId: p, unitNetMinor: 150, vatBps: 1000 },
      { productId: q, unitNetMinor: 200, vatBps: 2000 },
    ],
  },
  200,
  manager
);
o = await detail(o.id);
assert.equal(o.remainingGrossMinor, 2280);
assert.equal(
  o.receipts[0].items.find((x: any) => x.productId === p).unitNetMinor,
  100
);
assert.deepEqual(await account(), repriceBefore);
await lp(
  "order-receive",
  { ...(await receiving(o, "DEMO-PO-OLD-PRICE")) },
  409
);
// A partial delivery at revised price, followed by explicit closure of the undelivered remainder.
const second = {
  ...(await receiving(o, "DEMO-PO-2")),
  expectedTotalMinor: 1140,
  lines: [
    {
      productId: p,
      quantity: 4,
      unitNetMinor: 150,
      vatBps: 1000,
      lots: [
        { code: "DEMO-PO-B", expiryDate: today, quantity: 2 },
        { code: "DEMO-PO-C", expiryDate: today, quantity: 2 },
      ],
    },
    { productId: q, quantity: 2, unitNetMinor: 200, vatBps: 2000 },
  ],
};
await lp("order-receive", second, 200, accountant);
o = await detail(o.id);
assert.equal(o.receivedQty, 12);
assert.equal(o.receiptCount, 2);
assert.equal((await account()).stockValueMinor, 1800);
const closeBefore = await account();
await lp(
  "order-close",
  {
    orderId: o.id,
    orderVersion: o.version,
    reason: "DEMO gelmeyecek kalan sipariş kapatıldı",
  },
  200,
  manager
);
o = await detail(o.id);
assert.equal(o.status, "CLOSED");
assert.equal(o.receiptCount, 2);
assert.equal(o.remainingQty, 6);
assert.deepEqual(await account(), closeBefore);
inv = await inventory();
assert.equal(inv.items.find((x: any) => x.id === p).onOrderQty, 0);
assert.equal(inv.items.find((x: any) => x.id === p).suggestedQty, 6);
await lp("order-receive", await receiving(o, "DEMO-CLOSED"), 409);
// Concurrent final-unit acceptance: only one supplier debt and receipt can commit.
const finalId = (
  await lp("order-save", {
    supplierId: vendor,
    label: "DEMO son adet yarışı",
    expectedDate: today,
    lines: [{ productId: q, quantity: 1, unitNetMinor: 200, vatBps: 2000 }],
  })
).id;
let final = await detail(finalId);
await lp("order-approve", {
  orderId: finalId,
  orderVersion: final.version,
  expectedTotalMinor: 240,
  reason: "DEMO tek adet onayı",
});
final = await detail(finalId);
const last = {
  orderId: finalId,
  orderVersion: final.version,
  expectedRevision: (await account()).revision,
  dueDate: today,
  expectedTotalMinor: 240,
  deliveryAccepted: true,
  lines: [{ productId: q, quantity: 1, unitNetMinor: 200, vatBps: 2000 }],
};
const race = await Promise.all(
  [owner, accountant].map((actor, i) =>
    http("/api/stationos/market-accounting/inventory/order-receive", actor, {
      stationId: station,
      requestId: randomUUID(),
      reference: "DEMO-RACE-" + i,
      ...last,
    })
  )
);
assert.deepEqual(race.map(r => r.status).sort(), [200, 409]);
final = await detail(finalId);
assert.equal(final.status, "RECEIVED");
assert.equal(final.receiptCount, 1);
// Order creation/approval does not reserve credit; receiving still uses actual invoice rounding.
const pennyId = (
  await lp("order-save", {
    supplierId: vendor,
    label: "DEMO kuruşlu kısmi teslim",
    expectedDate: today,
    lines: [{ productId: q, quantity: 3, unitNetMinor: 1, vatBps: 2000 }],
  })
).id;
let penny = await detail(pennyId);
await lp("order-approve", {
  orderId: pennyId,
  orderVersion: penny.version,
  reason: "DEMO kuruş planı",
  expectedTotalMinor: 4,
});
for (let i = 0; i < 3; i++) {
  penny = await detail(pennyId);
  await lp("order-receive", {
    orderId: pennyId,
    orderVersion: penny.version,
    expectedRevision: (await account()).revision,
    reference: "DEMO-PENNY-" + i,
    dueDate: today,
    expectedTotalMinor: 1,
    deliveryAccepted: true,
    lines: [{ productId: q, quantity: 1, unitNetMinor: 1, vatBps: 2000 }],
  });
}
penny = await detail(pennyId);
assert.equal(penny.status, "RECEIVED");
assert.equal(
  penny.receipts.reduce((n: number, r: any) => n + r.totalMinor, 0),
  3
);
// The browser receives a fresh draft and an approved partially deliverable order.
const browserDraft = (
  await lp("order-save", {
    supplierId: vendor,
    label: "DEMO UI sipariş taslağı",
    expectedDate: today,
    lines: [
      { productId: p, quantity: 6, unitNetMinor: 150, vatBps: 1000 },
      { productId: q, quantity: 3, unitNetMinor: 200, vatBps: 2000 },
    ],
  })
).id;
const sql = await mysql.createConnection(process.env.DATABASE_URL!);
const [bad]: any = await sql.query(
  "SELECT p.id FROM st_products p JOIN st_market_inventory i ON i.product_id=p.id WHERE p.station_id=? AND (p.stock_qty<>i.quantity OR i.value_minor<0)",
  [station]
);
assert.equal(bad.length, 0);
const [balance]: any = await sql.query(
  "SELECT SUM(l.debit_minor-l.credit_minor) AS diff FROM st_market_lines l JOIN st_market_entries e ON e.id=l.entry_id WHERE e.station_id=?",
  [station]
);
assert.equal(Number(balance[0].diff), 0);
const [linked]: any = await sql.query(
  "SELECT COUNT(*) AS n FROM st_purchase_order_receipts r JOIN st_market_entries e ON e.id=r.entry_id WHERE e.station_id=? AND e.kind='PURCHASE'",
  [station]
);
assert.equal(Number(linked[0].n), 6);
await sql.end();
if (process.env.SMOKE_LEAVE_OPEN !== "1") {
  a = await account();
  await post("/market-accounting/day-close", {
    expectedRevision: a.revision,
    countedCashMinor: 0,
  });
  const closed = await account();
  let b = await detail(browserDraft);
  await lp("order-approve", {
    orderId: b.id,
    orderVersion: b.version,
    expectedTotalMinor: 1710,
    reason: "DEMO kapalı günde mali olmayan onay",
  });
  b = await detail(browserDraft);
  await lp(
    "order-receive",
    {
      orderId: b.id,
      orderVersion: b.version,
      expectedRevision: closed.revision,
      reference: "DEMO-DAY-CLOSED",
      dueDate: today,
      expectedTotalMinor: 240,
      deliveryAccepted: true,
      lines: [{ productId: q, quantity: 1, unitNetMinor: 200, vatBps: 2000 }],
    },
    409
  );
  assert.deepEqual((await account()).closes, closed.closes);
  assert.equal((await account()).revision, closed.revision);
}
assert.ok((await orders()).rows.some((r: any) => r.id === newId));
await raw(
  "/market-accounting/inventory/orders?stationId=" +
    station +
    "&cursor=invalid",
  owner,
  undefined,
  400
);
const output =
  process.env.SMOKE_OUTPUT_DIR ?? "/workspace/purchase-order-test/dev";
await mkdir(output, { recursive: true, mode: 0o700 });
await writeFile(
  output + "/fixture.json",
  JSON.stringify({
    owner,
    manager,
    accountant,
    staff,
    outsider,
    station,
    p,
    q,
    vendor,
    browserDraft,
  }),
  { mode: 0o600 }
);
const checks = [
  "Rol/tenant/CSRF; muhasebeci taslak/kabul, yalnız yönetici onay/revizyon/kapatma",
  "Taslak/onay/revizyon/kapatma bakiye/defter/stoğu değiştirmedi",
  "Onaylı açık sipariş stok önerisinden düşüldü, kritik fizikî stok uyarısı korundu",
  "Eski sipariş/defter sürümü, fazla adet, yanlış fiyat/KDV/önizleme ve teyitsiz kabul reddi",
  "Lot/SKT zorunluluğu, iki partili kabul ve mükerrer fatura/limit hatasında tam rollback",
  "Kısmi teslimler ortak mal kabul net stok/KDV/cari ve kaynak belgeye bağlandı",
  "Fiyat revizyonunda eski teslim bedeli korundu, kalan kapatılınca öneri geri geldi",
  "Aynı-ID tek kabul, son adet yarışında tek teslim/borç",
  "Kuruşlu kısmi belgeler kendi vergi yuvarlamasıyla kaydedildi",
  "Stok/maliyet ve dengeli defter mutabakatı",
  ...(process.env.SMOKE_LEAVE_OPEN === "1"
    ? []
    : [
        "Kapalı günde planlama/onay açık, mali kabul kapalı ve kapanış korundu",
      ]),
];
await writeFile(
  output + "/result.json",
  JSON.stringify({ ok: true, checks }, null, 2)
);
console.log(JSON.stringify({ ok: true, checks }, null, 2));

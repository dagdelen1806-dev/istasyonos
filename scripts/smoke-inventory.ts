import { strict as assert } from "node:assert";
import { randomUUID, randomBytes } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import mysql from "mysql2/promise";
import { query, closeStationPool } from "../server/stationos/db";
import { payloadHash } from "../server/stationos/domain";
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
    companyName: `DEMO stok testi ${randomUUID().slice(0, 8)}`,
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
const account = () => raw("/market-accounting?stationId=" + station);
const inventory = () =>
  raw("/market-accounting/inventory?stationId=" + station);
const terminal = (a = owner) =>
  raw("/market-accounting/inventory/terminal?stationId=" + station, a);
const detail = (id: string, a = owner) =>
  raw(
    `/market-accounting/inventory/draft?stationId=${station}&draftId=${id}`,
    a
  );
const pos = (a = owner) => raw("/pos?stationId=" + station, a);
const ipost = (
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
const initial = await pos();
for (const s of initial.sessions.filter((s: any) => !s.closedAt))
  await post("/pos/close", {
    sessionId: s.id,
    countedCashMinor: s.expectedCashMinor,
    expectedCashMinor: s.expectedCashMinor,
    reason: "DEMO eski oturum kapanışı",
  });
const p = (
  await post("/product", {
    name: "DEMO koli süt",
    barcode: "MILK-" + randomUUID().slice(0, 8),
    minimumQty: 2,
    purchasePriceMinor: 0,
    salePriceMinor: 1200,
    supplierId: null,
  })
).id;
const q = (
  await post("/product", {
    name: "DEMO koli su",
    barcode: "WATER-" + randomUUID().slice(0, 8),
    minimumQty: 2,
    purchasePriceMinor: 0,
    salePriceMinor: 600,
    supplierId: null,
  })
).id;
const beforeStart = await account();
await post("/market-accounting/start", {
  openingStockAccepted: true,
  expectedInventoryMinor: beforeStart.openingInventoryMinor,
  cashMinor: 100000,
  bankMinor: 100000,
  cardMinor: 0,
});
const today = (await account()).today;
const supplier = (
  await post("/market-accounting/party", {
    name: "DEMO stok tedarikçisi",
    kind: "SUPPLIER",
    receivableLimitMinor: 0,
    payableLimitMinor: null,
    termDays: 7,
  })
).id;
for (const [id, price] of [
  [p, 1200],
  [q, 600],
])
  await post("/market-accounting/product", {
    productId: id,
    salePriceMinor: price,
    vatBps: 2000,
  });
let inv = await inventory();
const primary = inv.items.find((x: any) => x.id === p).barcode,
  otherBarcode = inv.items.find((x: any) => x.id === q).barcode,
  packBarcode = "PACK-" + randomUUID().slice(0, 8);
await ipost("barcode", {
  productId: p,
  barcode: packBarcode,
  packQty: 6,
  label: "6lı koli",
});
await ipost("barcode", { productId: q, barcode: packBarcode, packQty: 1 }, 409);
await ipost(
  "barcode",
  { productId: p, barcode: primary.toLowerCase(), packQty: 2 },
  400
);
await ipost("barcode-remove", { barcode: primary }, 400);
await post(
  "/product",
  {
    name: "DEMO mükerrer alias",
    barcode: packBarcode,
    minimumQty: 0,
    purchasePriceMinor: 0,
    salePriceMinor: 1,
    supplierId: null,
  },
  409
);
await raw(
  "/market-accounting/inventory?stationId=" + station,
  staff,
  undefined,
  403
);
await raw(
  "/market-accounting/inventory?stationId=" + station,
  outsider,
  undefined,
  403
);
await ipost("device-register", {
  name: "DEMO masaüstü",
  model: "Windows tarayıcı",
  platform: "WINDOWS",
});
await ipost(
  "device-register",
  { name: "DEMO TC73", model: "Zebra TC73", platform: "ANDROID" },
  200,
  staff
);
assert.equal((await terminal(staff)).device.enabled, false);
await ipost(
  "draft-create",
  { kind: "RECEIPT", label: "DEMO engelli kabul" },
  403,
  staff
);
await ipost(
  "device-approve",
  { deviceId: staff.device, enabled: true },
  200,
  manager
);
const receipt = (
  await ipost(
    "draft-create",
    { kind: "RECEIPT", label: "DEMO 6lı kabul" },
    200,
    staff
  )
).id;
let d = await detail(receipt),
  scanId = randomUUID();
const scanPayload = {
  stationId: station,
  requestId: scanId,
  draftId: receipt,
  draftVersion: d.version,
  barcode: packBarcode,
  quantity: 2,
  mode: "ADD",
};
const firstScan = await raw(
  "/market-accounting/inventory/draft-scan",
  staff,
  scanPayload
);
assert.deepEqual(
  await raw("/market-accounting/inventory/draft-scan", staff, scanPayload),
  firstScan
);
d = await detail(receipt);
assert.equal(d.lines[0].countedQty, 12);
await ipost(
  "draft-scan",
  { ...scanPayload, requestId: randomUUID(), barcode: primary },
  409,
  owner
);
await ipost(
  "draft-scan",
  {
    draftId: receipt,
    draftVersion: d.version,
    barcode: otherBarcode,
    quantity: 3,
    mode: "ADD",
  },
  200,
  staff
);
d = await detail(receipt, staff);
assert.equal(d.lines[0].currentQty, null);
assert.equal(d.lines[0].unitNetMinor, null);
assert.equal((await terminal(staff)).suppliers.length, 0);
const receiptBody = () => ({
  draftId: receipt,
  draftVersion: d.version,
  expectedRevision: d.revision,
  partyId: supplier,
  reference: "DEMO-RECEIPT",
  dueDate: today,
  expectedTotalMinor: 8280,
  lines: [
    { productId: p, quantity: 12, unitNetMinor: 500, vatBps: 2000 },
    { productId: q, quantity: 3, unitNetMinor: 300, vatBps: 2000 },
  ],
});
await ipost("receipt-post", receiptBody(), 403, staff);
await ipost(
  "receipt-post",
  {
    ...receiptBody(),
    lines: [
      { productId: p, quantity: 13, unitNetMinor: 500, vatBps: 2000 },
      { productId: q, quantity: 3, unitNetMinor: 300, vatBps: 2000 },
    ],
  },
  409
);
await ipost(
  "receipt-post",
  { ...receiptBody(), expectedTotalMinor: 8281 },
  409
);
assert.equal(
  (await inventory()).items.find((x: any) => x.id === p).quantity,
  0
);
await ipost("receipt-post", receiptBody());
assert.equal((await detail(receipt)).status, "POSTED");
inv = await inventory();
assert.equal(inv.items.find((x: any) => x.id === p).quantity, 12);
assert.equal(inv.items.find((x: any) => x.id === p).lastPurchaseMinor, 500);
assert.equal(inv.items.find((x: any) => x.id === p).purchaseVatBps, 2000);
assert.equal((await account()).balances.PAYABLE, -8280);
await ipost("receipt-post", receiptBody(), 409);
const receipt2 = (
  await ipost("draft-create", { kind: "RECEIPT", label: "DEMO mükerrer belge" })
).id;
d = await detail(receipt2);
await ipost("draft-scan", {
  draftId: receipt2,
  draftVersion: d.version,
  barcode: primary,
  quantity: 1,
  mode: "ADD",
});
d = await detail(receipt2);
await ipost(
  "receipt-post",
  {
    draftId: receipt2,
    draftVersion: d.version,
    expectedRevision: d.revision,
    partyId: supplier,
    reference: "DEMO-RECEIPT",
    dueDate: today,
    expectedTotalMinor: 600,
    lines: [{ productId: p, quantity: 1, unitNetMinor: 500, vatBps: 2000 }],
  },
  409
);
assert.equal((await detail(receipt2)).status, "DRAFT");
assert.equal(
  (await inventory()).items.find((x: any) => x.id === p).quantity,
  12
);
// Two scanners send the same draft version; exactly one may advance it.
d = await detail(receipt2);
const race = await Promise.all(
  [owner, staff].map(a =>
    http("/api/stationos/market-accounting/inventory/draft-scan", a, {
      stationId: station,
      requestId: randomUUID(),
      draftId: receipt2,
      draftVersion: d.version,
      barcode: otherBarcode,
      quantity: 1,
      mode: "ADD",
    })
  )
);
assert.deepEqual(race.map(r => r.status).sort(), [200, 409]);
assert.equal(
  (await detail(receipt2)).lines.find((l: any) => l.productId === q).countedQty,
  1
);
const count = (
  await ipost("draft-create", { kind: "COUNT", label: "DEMO eşzamanlı sayım" })
).id;
d = await detail(count);
await ipost("draft-scan", {
  draftId: count,
  draftVersion: d.version,
  barcode: primary,
  quantity: 12,
  mode: "SET",
});
const register = (
  await post("/pos/register", { code: "STOK", name: "DEMO stok kasası" })
).id;
const session = (
  await post("/pos/open", { registerId: register, openingFloatMinor: 0 })
).id;
const list = (
  await ipost("price-list", {
    name: "DEMO toptan",
    active: true,
    staffEnabled: false,
  })
).id;
await ipost("price", { productId: p, listId: list, unitPriceMinor: 1100 });
await raw("/pos?stationId=" + station, staff);
assert.equal((await pos(staff)).priceLists.length, 0);
const staffRegister = (
  await post("/pos/register", {
    code: "STAF",
    name: "DEMO kasiyer fiyat yetkisi",
  })
).id;
const staffSession = (
  await post(
    "/pos/open",
    { registerId: staffRegister, openingFloatMinor: 0 },
    200,
    staff
  )
).id;
await post(
  "/pos/cart/add",
  { sessionId: staffSession, productId: p, quantity: 1, priceListId: list },
  403,
  staff
);
await post(
  "/pos/close",
  { sessionId: staffSession, countedCashMinor: 0, cashTransferred: true },
  200,
  staff
);
await ipost("price-list", {
  listId: list,
  name: "DEMO toptan",
  active: true,
  staffEnabled: true,
});
await post(
  "/pos/cart/add",
  { sessionId: session, productId: q, quantity: 1, priceListId: list },
  409
);
await post("/pos/cart/add", {
  sessionId: session,
  productId: p,
  quantity: 1,
  priceListId: list,
});
let cart = (await pos()).activeCart;
assert.equal(cart.lines[0].expectedUnitPriceMinor, 1100);
assert.equal(cart.lines[0].priceListId, list);
await post(
  "/pos/cart/add",
  {
    sessionId: session,
    cartId: cart.id,
    cartVersion: cart.version,
    productId: p,
    quantity: 1,
    priceListId: null,
  },
  409
);
await post("/pos/cart/hold", {
  cartId: cart.id,
  cartVersion: cart.version,
  label: "DEMO fiyatı koru",
});
await post("/pos/cart/resume", {
  sessionId: session,
  cartId: cart.id,
  cartVersion: cart.version + 1,
});
cart = (await pos()).activeCart;
assert.equal(cart.lines[0].priceListId, list);
await ipost("price", { productId: p, listId: list, unitPriceMinor: 1080 });
await post(
  "/pos/checkout",
  {
    sessionId: session,
    cartId: cart.id,
    cartVersion: cart.version,
    paymentKind: "CASH",
    tenderedMinor: 1100,
  },
  409
);
await post("/pos/cart/reprice", {
  sessionId: session,
  cartId: cart.id,
  cartVersion: cart.version,
});
cart = (await pos()).activeCart;
assert.equal(cart.lines[0].expectedUnitPriceMinor, 1080);
const sale = await post("/pos/checkout", {
  sessionId: session,
  cartId: cart.id,
  cartVersion: cart.version,
  paymentKind: "CASH",
  tenderedMinor: 1100,
});
d = await detail(count);
assert.equal(d.lines.find((l: any) => l.productId === p).stockChanged, true);
await ipost(
  "count-post",
  {
    draftId: count,
    draftVersion: d.version,
    expectedRevision: d.revision,
    reason: "DEMO eski sayım onayı",
    unitCosts: [],
    expectedGainMinor: 0,
    expectedLossMinor: 0,
  },
  409
);
await ipost(
  "draft-scan",
  {
    draftId: count,
    draftVersion: d.version,
    barcode: primary,
    quantity: 1,
    mode: "ADD",
  },
  409
);
// Return the sale: quantity is back to 12, but stock_version must still reject the old count.
const source = (
  await raw(
    `/market-accounting/return-sources?stationId=${station}&kind=POS_SALE&q=${sale.id}`
  )
).rows[0].id;
const src = await raw(
  `/market-accounting/return-source?stationId=${station}&entryId=${source}`
);
await post("/market-accounting/return", {
  sourceEntryId: source,
  expectedRevision: src.revision,
  reference: "DEMO-STOK-IADE",
  reason: "DEMO sayım sırasında satış iadesi",
  lines: [{ productId: p, quantity: 1 }],
  expectedTotalMinor: 1080,
  expectedCreditedMinor: 0,
  expectedCostMinor: 500,
  wallet: "CASH_SAFE",
  moneyConfirmed: true,
});
d = await detail(count);
assert.equal(d.lines.find((l: any) => l.productId === p).currentQty, 12);
assert.equal(d.lines.find((l: any) => l.productId === p).stockChanged, true);
await ipost(
  "count-post",
  {
    draftId: count,
    draftVersion: d.version,
    expectedRevision: d.revision,
    reason: "DEMO adet aynı eski sayım",
    unitCosts: [],
    expectedGainMinor: 0,
    expectedLossMinor: 0,
  },
  409
);
await ipost(
  "draft-rebase",
  {
    draftId: count,
    draftVersion: d.version,
    productId: p,
    reason: "DEMO satış ve iade sonrası tekrar sayım",
  },
  200,
  staff
);
d = await detail(count);
assert.equal(d.lines.find((l: any) => l.productId === p).countedQty, null);
assert.equal(d.lines.find((l: any) => l.productId === p).stockChanged, false);
await ipost(
  "draft-scan",
  {
    draftId: count,
    draftVersion: d.version,
    barcode: primary,
    quantity: 10,
    mode: "SET",
  },
  200,
  staff
);
d = await detail(count);
await ipost(
  "count-post",
  {
    draftId: count,
    draftVersion: d.version,
    expectedRevision: d.revision,
    reason: "DEMO raf sayım eksiği",
    unitCosts: [],
    expectedGainMinor: 0,
    expectedLossMinor: 999,
  },
  409
);
const countRequest = {
  stationId: station,
  requestId: randomUUID(),
  draftId: count,
  draftVersion: d.version,
  expectedRevision: d.revision,
  reason: "DEMO raf sayım eksiği",
  unitCosts: [],
  expectedGainMinor: 0,
  expectedLossMinor: 1000,
};
const postedCount = await raw(
  "/market-accounting/inventory/count-post",
  owner,
  countRequest
);
assert.deepEqual(
  await raw("/market-accounting/inventory/count-post", owner, countRequest),
  postedCount
);
inv = await inventory();
assert.equal(inv.items.find((x: any) => x.id === p).quantity, 10);
assert.equal(inv.items.find((x: any) => x.id === q).quantity, 3); // uncounted stays unchanged
const zeroCount = (
  await ipost("draft-create", {
    kind: "COUNT",
    label: "DEMO sıfır ve fazla stok",
  })
).id;
d = await detail(zeroCount);
await ipost("draft-scan", {
  draftId: zeroCount,
  draftVersion: d.version,
  barcode: otherBarcode,
  quantity: 0,
  mode: "SET",
});
d = await detail(zeroCount);
await ipost("draft-scan", {
  draftId: zeroCount,
  draftVersion: d.version,
  barcode: primary,
  quantity: 11,
  mode: "SET",
});
d = await detail(zeroCount);
const zeroBody = {
  draftId: zeroCount,
  draftVersion: d.version,
  expectedRevision: d.revision,
  reason: "DEMO sıfır maliyetli fazlalık",
  unitCosts: [{ productId: p, unitNetMinor: 0 }],
  expectedGainMinor: 0,
  expectedLossMinor: 900,
};
await ipost("count-post", zeroBody, 409);
await ipost("count-post", { ...zeroBody, zeroCostAccepted: true });
inv = await inventory();
assert.equal(inv.items.find((x: any) => x.id === p).quantity, 11);
assert.equal(inv.items.find((x: any) => x.id === q).quantity, 0);
for (const id of [p, q]) {
  const item = inv.items.find((x: any) => x.id === id);
  await ipost("product", {
    productId: id,
    name: item.name,
    category: "Süt / içecek",
    brand: "DEMO",
    unit: "adet",
    shelf: "A-1",
    minimumQty: 15,
    maximumQty: 20,
    leadDays: 3,
    reviewDays: 7,
    safetyDays: 2,
    orderPackQty: 6,
    supplierId: supplier,
    purchaseVatBps: 2000,
  });
}
await post("/market-accounting/party-update", {
  partyId: supplier,
  name: "DEMO stok tedarikçisi",
  receivableLimitMinor: 0,
  payableLimitMinor: 16000,
  termDays: 7,
});
inv = await inventory();
assert.equal(inv.items.find((x: any) => x.id === p).suggestedQty, 12);
assert.equal(inv.items.find((x: any) => x.id === q).suggestedQty, 24);
assert.equal(
  inv.items.filter(
    (x: any) => [p, q].includes(x.id) && x.creditStatus === "CREDIT_BLOCKED"
  ).length,
  1
); // shared supplier budget
await post("/market-accounting/expense", {
  wallet: "CASH_SAFE",
  netMinor: 1000,
  vatBps: 2000,
  description: "DEMO aylık gider",
});
await post("/market-accounting/capital", {
  wallet: "BANK",
  direction: "IN",
  amountMinor: 5000,
  description: "DEMO sermaye gelir değildir",
});
const monthly = await raw(
    `/market-accounting/monthly?stationId=${station}&month=${today.slice(0, 7)}`
  ),
  daily = (await account()).daily;
assert.equal(monthly.totals.netSalesMinor, daily.salesNetMinor);
assert.equal(monthly.totals.resultMinor, daily.operatingResultMinor);
assert.equal(monthly.totals.cogsMinor, 0);
assert.equal(monthly.totals.netSalesMinor, 0);
assert.equal(monthly.totals.expensesMinor, 2900);
assert.equal(monthly.totals.resultMinor, -2900);
assert.equal(monthly.totals.netPurchasesMinor, 6900);
assert.equal(monthly.totals.salesReturnsMinor, 1080);
assert.equal(monthly.previous.resultMinor, 0);
assert.equal(monthly.products.find((x: any) => x.id === p).profitMinor, 0);
assert.equal(
  (await raw(`/market-accounting/monthly?stationId=${station}&month=2000-01`))
    .previousMonth,
  "1999-12"
);
await raw(
  `/market-accounting/monthly?stationId=${station}&month=2026-13`,
  owner,
  undefined,
  400
);
await raw(
  `/market-accounting/monthly?stationId=${station}`,
  staff,
  undefined,
  403
);
await raw(
  `/market-accounting/inventory/movements?stationId=${station}&productId=${p}&from=${today}&to=${today}`,
  outsider,
  undefined,
  403
);
let moves = await raw(
  `/market-accounting/inventory/movements?stationId=${station}&productId=${p}&from=${today}&to=${today}`
);
assert.equal(moves.openingQty, 0);
assert.equal(moves.closingQty, 11);
assert.equal(
  moves.rows.reduce((s: number, l: any) => s + l.quantity, 0),
  11
);
assert.ok(moves.rows.some((l: any) => l.kind === "SALE" && l.quantity === -1));
const sql = await mysql.createConnection(process.env.DATABASE_URL!);
const [tz]: any = await query("SELECT @@session.time_zone AS tz");
assert.equal(tz.tz, "+00:00");
await closeStationPool();
const [saleLines]: any = await sql.query(
  "SELECT price_list_id,price_list_name,unit_price_minor FROM st_pos_sale_lines WHERE sale_id=?",
  [sale.id]
);
assert.equal(saleLines[0].price_list_id, list);
assert.equal(saleLines[0].unit_price_minor, 1080);
const [bad]: any = await sql.query(
  "SELECT p.id FROM st_products p JOIN st_market_inventory i ON i.product_id=p.id WHERE p.station_id=? AND p.stock_qty<>i.quantity",
  [station]
);
assert.equal(bad.length, 0);
const [unbalanced]: any = await sql.query(
  "SELECT e.id FROM st_market_entries e LEFT JOIN st_market_lines l ON l.entry_id=e.id WHERE e.station_id=? GROUP BY e.id HAVING COALESCE(SUM(l.debit_minor-l.credit_minor),0)<>0",
  [station]
);
assert.equal(unbalanced.length, 0);
await sql.end();
await ipost("device-approve", { deviceId: staff.device, enabled: false });
await ipost(
  "device-register",
  {
    name: "DEMO tekrar kayıtla onay denemesi",
    model: "TC73",
    platform: "ANDROID",
  },
  200,
  staff
);
assert.equal((await terminal(staff)).device.enabled, false);
await ipost(
  "draft-create",
  { kind: "COUNT", label: "DEMO devre dışı cihaz" },
  403,
  staff
);
const output = process.env.SMOKE_OUTPUT_DIR ?? "/workspace/inventory-test/dev";
await mkdir(output, { recursive: true, mode: 0o700 });
await writeFile(
  output + "/fixture.json",
  JSON.stringify({
    owner,
    staff,
    manager,
    outsider,
    station,
    p,
    q,
    primary,
    otherBarcode,
    packBarcode,
    supplier,
    register,
    session,
    list,
    receipt,
    count,
    today,
  }),
  { mode: 0o600 }
);
const checks = [
  "Tenant/rol ve gizli maliyet sınırları",
  "Ana/alternatif/koli barkodu çakışmaları",
  "TC73 türü cihaz kaydı, yönetici onayı ve devre dışı bırakma",
  "Ortak taslak, eski sürüm ve aynı kimlikle tek okutma",
  "Mal kabul taslağı adet-maliyet-KDV-cari atomik onayı ve mükerrer belge rollback",
  "Named fiyat listesi, eksik fiyat, sepet bekletme/çağırma/güncel fiyat ve satış anlık görüntüsü",
  "Satış ve iade sonrası adet aynı olsa bile sayımı eski stoktan koruma",
  "Açıklamalı yeniden sayım ve sayılmayanı sıfır saymama",
  "Sayım eksiği, sıfır sayım, sıfır maliyet fazlası ve aynı istekle tek fiş",
  "Kritik stok/koli yuvarlama ve ortak tedarikçi kredi bütçesi",
  "Aylık net satış/maliyet/iade/gider/sermaye ayrımı ve günlük mutabakat",
  "Tarihli işaretli stok hareketleri, UTC bağlantı ve dengeli defter",
];
await writeFile(
  output + "/result.json",
  JSON.stringify({ ok: true, checks }, null, 2)
);
console.log(JSON.stringify({ ok: true, checks }, null, 2));

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
    companyName: `DEMO lot testi ${randomUUID().slice(0, 8)}`,
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
    name: "DEMO SKT süt",
    barcode: "LOT-MILK-" + randomUUID().slice(0, 6),
    minimumQty: 0,
    purchasePriceMinor: 0,
    salePriceMinor: 1200,
    supplierId: null,
  })
).id;
const q = (
  await post("/product", {
    name: "DEMO eski partiler",
    barcode: "LOT-OLD-" + randomUUID().slice(0, 6),
    minimumQty: 0,
    purchasePriceMinor: 0,
    salePriceMinor: 600,
    supplierId: null,
  })
).id;
const r = (
  await post("/product", {
    name: "DEMO lot açılacak ürün",
    barcode: "LOT-NEW-" + randomUUID().slice(0, 6),
    minimumQty: 0,
    purchasePriceMinor: 0,
    salePriceMinor: 600,
    supplierId: null,
  })
).id;
await post("/market-accounting/start", {
  openingStockAccepted: true,
  expectedInventoryMinor: (await account()).openingInventoryMinor,
  cashMinor: 100000,
  bankMinor: 100000,
  cardMinor: 0,
});
const today = (await account()).today,
  day = (n: number) =>
    new Date(Date.parse(today + "T12:00:00Z") + n * 86400000)
      .toISOString()
      .slice(0, 10);
for (const [id, price] of [
  [p, 1200],
  [q, 600],
  [r, 600],
])
  await post("/market-accounting/product", {
    productId: id,
    salePriceMinor: price,
    vatBps: 2000,
  });
const supplier = (
  await post("/market-accounting/party", {
    name: "DEMO lot tedarikçisi",
    kind: "SUPPLIER",
    receivableLimitMinor: 0,
    payableLimitMinor: null,
    termDays: 0,
  })
).id;
const product = (s: any, id = p) => s.products.find((x: any) => x.id === id);
async function previewBase(id = p) {
  const s = await lotState();
  return {
    productId: id,
    expectedVersion: product(s, id).stockVersion,
    expectedRevision: s.revision,
    reason: "DEMO fizikî parti kontrolü",
  };
}
await raw(
  "/market-accounting/inventory/lots?stationId=" + station,
  staff,
  undefined,
  403
);
await raw(
  "/market-accounting/inventory/lots?stationId=" + station,
  outsider,
  undefined,
  403
);
await lp("lot-enable", { ...(await previewBase()), lots: [] }, 403, staff);
await lp("lot-enable", { ...(await previewBase()), lots: [] });
await lp("lot-enable", { ...(await previewBase()), lots: [] }, 409);
async function purchase(
  reference: string,
  id: string,
  quantity: number,
  cost: number,
  lots?: unknown,
  status = 200
) {
  return post(
    "/market-accounting/purchase",
    {
      partyId: supplier,
      reference,
      dueDate: today,
      expectedTotalMinor: quantity * cost * 1.2,
      lines: [
        {
          productId: id,
          quantity,
          unitNetMinor: cost,
          vatBps: 2000,
          ...(lots === undefined ? {} : { lots }),
        },
      ],
    },
    status
  );
}
await purchase("DEMO-MISSING", p, 5, 500, undefined, 400);
await purchase(
  "DEMO-BAD-SUM",
  p,
  5,
  500,
  [{ code: "A", quantity: 4, expiryDate: day(2) }],
  409
);
await purchase(
  "DEMO-BAD-EXPIRY",
  p,
  5,
  500,
  [{ code: "A", quantity: 5, expiryDate: day(-1) }],
  400
);
assert.equal(product(await lotState()).quantity, 0);
const buyA = await purchase("DEMO-LOT-A", p, 5, 500, [
  { code: "EARLY", quantity: 2, expiryDate: day(2) },
  { code: "LATE", quantity: 3, expiryDate: day(10) },
]);
await purchase(
  "DEMO-LOT-A",
  p,
  5,
  500,
  [{ code: "DUP", quantity: 5, expiryDate: day(1) }],
  409
);
assert.equal(
  (await lotState()).lots.filter((l: any) => l.productId === p).length,
  2
);
await purchase("DEMO-LOT-B", p, 3, 900, [
  { code: "NEAREST", quantity: 3, expiryDate: day(1) },
]);
await purchase("DEMO-LEGACY", q, 4, 100);
await lp(
  "lot-enable",
  {
    ...(await previewBase(q)),
    lots: [{ code: "BAD", quantity: 3, expiryDate: day(1) }],
  },
  409
);
assert.equal(product(await lotState(), q).tracking, false);
await lp("lot-enable", {
  ...(await previewBase(q)),
  lots: [
    { code: "UNKNOWN", quantity: 2, expiryDate: null },
    { code: "EXPIRED", quantity: 1, expiryDate: day(-1) },
    { code: "GOOD", quantity: 1, expiryDate: day(5) },
  ],
});
let s = await lotState();
const early = s.lots.find((l: any) => l.code === "EARLY"),
  late = s.lots.find((l: any) => l.code === "LATE"),
  expired = s.lots.find((l: any) => l.code === "EXPIRED");
assert.equal(product(s, q).saleableQty, 1);
assert.equal(s.expiredQty, 1);
assert.equal(s.quarantineQty, 3);
const stale = await previewBase();
await lp(
  "lot-status",
  {
    ...stale,
    lotId: early.id,
    code: "EARLY",
    expiryDate: early.expiryDate,
    status: "QUARANTINE",
    inspectionAccepted: false,
  },
  409
);
await lp(
  "lot-status",
  {
    ...stale,
    lotId: early.id,
    code: "EARLY",
    expiryDate: early.expiryDate,
    status: "QUARANTINE",
    inspectionAccepted: true,
  },
  200,
  manager
);
await lp(
  "lot-status",
  {
    ...stale,
    lotId: early.id,
    code: "EARLY",
    expiryDate: early.expiryDate,
    status: "AVAILABLE",
    inspectionAccepted: true,
  },
  409
);
const register = (
    await post("/pos/register", { code: "LOT", name: "DEMO FEFO kasası" })
  ).id,
  session = (
    await post("/pos/open", { registerId: register, openingFloatMinor: 0 })
  ).id;
async function sell(quantity: number, id = p, status = 200) {
  return post(
    "/pos/checkout",
    {
      sessionId: session,
      lines: [
        {
          productId: id,
          quantity,
          expectedUnitPriceMinor: id === p ? 1200 : 600,
        },
      ],
      paymentKind: "CASH",
      tenderedMinor: 100000,
    },
    status
  );
}
const sale = await sell(4);
s = await lotState();
assert.equal(s.lots.find((l: any) => l.code === "NEAREST").quantity, 0);
assert.equal(s.lots.find((l: any) => l.code === "EARLY").quantity, 2);
assert.equal(s.lots.find((l: any) => l.code === "LATE").quantity, 2);
assert.equal(product(s).quantity, 4);
assert.equal(product(s).valueMinor, 2600);
assert.equal((await pos()).products.find((x: any) => x.id === p).stockQty, 2);
await post(
  "/pos/cart/add",
  { sessionId: session, productId: p, quantity: 3 },
  409
);
await sell(3, p, 409);
assert.equal(product(await lotState()).quantity, 4);
const getSource = async (kind: string, id: string) =>
  (
    await raw(
      `/market-accounting/return-sources?stationId=${station}&kind=${kind}&q=${id}`
    )
  ).rows[0].id;
const saleSource = await getSource("POS_SALE", sale.id),
  source = await raw(
    `/market-accounting/return-source?stationId=${station}&entryId=${saleSource}`
  );
await post("/market-accounting/return", {
  sourceEntryId: saleSource,
  expectedRevision: source.revision,
  reference: "DEMO-LOT-SALE-RETURN",
  reason: "DEMO müşteri iadesi fizikî kontrol bekliyor",
  lines: [{ productId: p, quantity: 2 }],
  expectedTotalMinor: 2400,
  expectedCreditedMinor: 0,
  expectedCostMinor: 1300,
  wallet: "CASH_SAFE",
  moneyConfirmed: true,
});
s = await lotState();
const returned = s.lots.find((l: any) => l.originKind === "SALE_RETURN");
assert.equal(returned.status, "QUARANTINE");
assert.equal(returned.expiryDate, null);
assert.equal(product(s).saleableQty, 2);
await lp(
  "lot-status",
  {
    ...(await previewBase()),
    lotId: returned.id,
    code: "RETURN-CHECKED",
    expiryDate: null,
    status: "AVAILABLE",
    inspectionAccepted: true,
  },
  400
);
await lp(
  "lot-status",
  {
    ...(await previewBase()),
    lotId: returned.id,
    code: "RETURN-CHECKED",
    expiryDate: day(-1),
    status: "AVAILABLE",
    inspectionAccepted: true,
  },
  400
);
await lp("lot-status", {
  ...(await previewBase()),
  lotId: returned.id,
  code: "RETURN-CHECKED",
  expiryDate: day(3),
  status: "AVAILABLE",
  inspectionAccepted: true,
});
await sell(1);
s = await lotState();
assert.equal(s.lots.find((l: any) => l.id === returned.id).quantity, 1);
const purchaseSource = await getSource("PURCHASE", buyA.id);
let src = await raw(
  `/market-accounting/return-source?stationId=${station}&entryId=${purchaseSource}`
);
assert.equal(src.items[0].lotTracking, true);
const supplierReturn = {
  sourceEntryId: purchaseSource,
  expectedRevision: src.revision,
  reference: "DEMO-LOT-SUPPLIER-RETURN",
  reason: "DEMO karantina partisini tedarikçiye iade",
  lines: [{ productId: p, quantity: 1 }],
  expectedTotalMinor: 600,
  expectedCreditedMinor: 600,
  expectedCostMinor: 650,
};
await post("/market-accounting/return", supplierReturn, 400);
await post(
  "/market-accounting/return",
  {
    ...supplierReturn,
    lines: [
      { productId: p, quantity: 1, lots: [{ lotId: expired.id, quantity: 1 }] },
    ],
  },
  409
);
await post("/market-accounting/return", {
  ...supplierReturn,
  lines: [
    { productId: p, quantity: 1, lots: [{ lotId: early.id, quantity: 1 }] },
  ],
});
s = await lotState();
assert.equal(product(s).quantity, 4);
assert.equal(s.lots.find((l: any) => l.id === early.id).quantity, 1);
const fire = {
  stationId: station,
  requestId: randomUUID(),
  ...(await previewBase()),
  lotId: early.id,
  mode: "WRITE_OFF",
  quantity: 1,
  expectedCostMinor: 650,
};
const first = await raw("/market-accounting/inventory/lot-adjust", owner, fire);
assert.deepEqual(
  await raw("/market-accounting/inventory/lot-adjust", owner, fire),
  first
);
await lp(
  "lot-adjust",
  {
    ...(await previewBase()),
    lotId: early.id,
    mode: "WRITE_OFF",
    quantity: 1,
    expectedCostMinor: 650,
  },
  409
);
await lp(
  "lot-adjust",
  {
    ...(await previewBase()),
    lotId: late.id,
    mode: "COUNT",
    countedQty: 1,
    unitNetMinor: 0,
    expectedCostMinor: 649,
  },
  409
);
await lp("lot-adjust", {
  ...(await previewBase()),
  lotId: late.id,
  mode: "COUNT",
  countedQty: 1,
  unitNetMinor: 0,
  expectedCostMinor: 650,
});
await lp(
  "lot-adjust",
  {
    ...(await previewBase()),
    lotId: late.id,
    mode: "COUNT",
    countedQty: 2,
    unitNetMinor: 0,
    expectedCostMinor: 0,
  },
  409
);
await lp("lot-adjust", {
  ...(await previewBase()),
  lotId: late.id,
  mode: "COUNT",
  countedQty: 3,
  unitNetMinor: 400,
  expectedCostMinor: 800,
});
await sell(1, q);
await sell(1, q, 409);
assert.equal((await pos()).products.find((x: any) => x.id === q).stockQty, 0);
await lp("lot-adjust", {
  ...(await previewBase(q)),
  lotId: expired.id,
  mode: "WRITE_OFF",
  quantity: 1,
  expectedCostMinor: 100,
});
await post(
  "/market-accounting/stock-adjust",
  {
    productId: p,
    expectedQty: 4,
    countedQty: 5,
    unitNetMinor: 400,
    description: "DEMO lot sayımı atlama denemesi",
  },
  409
);
await lp("device-register", {
  name: "DEMO lot terminali",
  model: "TC73 klavye",
  platform: "ANDROID",
});
const count = (
  await lp("draft-create", {
    kind: "COUNT",
    label: "DEMO toplamdan lot atlamama",
  })
).id;
let d = await raw(
  `/market-accounting/inventory/draft?stationId=${station}&draftId=${count}`
);
await lp(
  "draft-scan",
  {
    draftId: count,
    draftVersion: d.version,
    barcode: (await pos()).products.find((x: any) => x.id === p).barcode,
    quantity: 5,
    mode: "SET",
  },
  409
);
d = await raw(
  `/market-accounting/inventory/draft?stationId=${station}&draftId=${count}`
);
assert.equal(d.lines.find((l: any) => l.productId === p).countedQty, null);
// Since 0017, a tracked product requires its real lot at collection time.
// An uncollected draft still cannot change stock through financial posting.
await lp(
  "count-post",
  {
    draftId: count,
    draftVersion: d.version,
    expectedRevision: d.revision,
    reason: "DEMO parti seçmeden toplam yazılamaz",
    unitCosts: [],
    expectedGainMinor: 0,
    expectedLossMinor: 0,
  },
  400
);
s = await lotState();
assert.equal(product(s).quantity, 4);
assert.equal(product(s).valueMinor, 2100);
assert.equal(product(s, q).quantity, 2);
assert.equal(product(s, q).valueMinor, 200);
const a = await account();
assert.equal(a.stockValueMinor, 2300);
assert.equal(a.daily.operatingResultMinor, 700);
const monthly = await raw(
  `/market-accounting/monthly?stationId=${station}&month=${today.slice(0, 7)}`
);
assert.equal(monthly.totals.expensesMinor, 1550);
assert.equal(monthly.totals.gainsMinor, 800);
assert.equal(monthly.totals.resultMinor, 700);
const sql = await mysql.createConnection(process.env.DATABASE_URL!);
const [mismatch]: any = await sql.query(
  "SELECT p.id FROM st_products p LEFT JOIN st_market_inventory i ON i.product_id=p.id LEFT JOIN (SELECT product_id,SUM(quantity) AS qty FROM st_inventory_lots GROUP BY product_id) l ON l.product_id=p.id WHERE p.station_id=? AND p.lot_tracking=TRUE AND (p.stock_qty<>i.quantity OR p.stock_qty<>COALESCE(l.qty,0))",
  [station]
);
assert.equal(mismatch.length, 0);
const [unbalanced]: any = await sql.query(
  "SELECT e.id FROM st_market_entries e LEFT JOIN st_market_lines l ON l.entry_id=e.id WHERE e.station_id=? GROUP BY e.id HAVING COALESCE(SUM(l.debit_minor-l.credit_minor),0)<>0",
  [station]
);
assert.equal(unbalanced.length, 0);
const [moves]: any = await sql.query(
  "SELECT COUNT(*) AS n FROM st_inventory_lot_events WHERE station_id=? AND kind='SALE' AND source_id=?",
  [station, sale.id]
);
assert.equal(Number(moves[0].n), 2);
await sql.end();
if (process.env.SMOKE_LEAVE_OPEN !== "1") {
  const ss = (await pos()).sessions.find((x: any) => x.id === session);
  await post("/pos/close", {
    sessionId: session,
    countedCashMinor: ss.expectedCashMinor,
    cashTransferred: true,
  });
  const a = await account();
  await post("/market-accounting/day-close", {
    expectedRevision: a.revision,
    countedCashMinor: a.balances.CASH_SAFE,
  });
  await lp(
    "lot-adjust",
    {
      ...(await previewBase()),
      lotId: late.id,
      mode: "WRITE_OFF",
      quantity: 1,
      expectedCostMinor: 525,
    },
    409
  );
}
const output = process.env.SMOKE_OUTPUT_DIR ?? "/workspace/lot-test/dev";
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
    r,
    supplier,
    register,
    session,
    today,
    early: early.id,
    late: late.id,
    returned: returned.id,
    open: process.env.SMOKE_LEAVE_OPEN === "1",
  }),
  { mode: 0o600 }
);
const checks = [
  "Rol/tenant ve stoklu ürünün tam parti eşleştirmesi",
  "SKT zorunluluğu, geçmiş tarih ve eksik toplam reddi",
  "Çok partili mal kabul ve mükerrer belgede lot/stok/cari rollback",
  "FEFO: yakın SKT, karantina dışlama ve lot başına satış izi",
  "Geçmiş/bilinmeyen SKT satışını engelleme ve kasada satılabilir stok",
  "Müşteri iadesinde bilinmeyen SKT karantinası ve teyitli fizikî kontrol",
  "Tedarikçi iadesinde gerçek parti ve aynı ürüne ait miktar kontrolü",
  "Firede ağırlıklı maliyet, aynı ID tek etki, sayım eksiği/fazlası",
  "Eski toplam sayım yollarının parti stoğunu atlayamaması",
  "Parti/fizikî/maliyet adedi ve dengeli defter mutabakatı",
  "Aylık fire/gain/alış-iade maliyet farkı ve faaliyet sonucu",
];
if (process.env.SMOKE_LEAVE_OPEN !== "1")
  checks.push("Gün sonu mutabakatı ve kapalı güne lot mali işlemi engeli");
await writeFile(
  output + "/result.json",
  JSON.stringify({ ok: true, checks }, null, 2)
);
console.log(JSON.stringify({ ok: true, checks }, null, 2));

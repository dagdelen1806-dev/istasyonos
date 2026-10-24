import { strict as assert } from "node:assert";
import { randomUUID } from "node:crypto";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import mysql from "mysql2/promise";
if (process.env.SMOKE_TEST !== "1")
  throw Error("Explicit synthetic DEMO opt-in required");
const base = process.env.SMOKE_BASE_URL ?? "http://127.0.0.1:3303",
  db = new URL(process.env.DATABASE_URL ?? "");
if (
  !["localhost", "127.0.0.1"].includes(new URL(base).hostname) ||
  db.pathname !== "/istasyonos_pos_v2_test" ||
  db.searchParams.get("socketPath") !== "/workspace/local-mysql/mysql.sock"
)
  throw Error("Exact isolated local test environment required");
const f = JSON.parse(
    await readFile(
      process.env.SMOKE_REPORT_FIXTURE ??
        "/workspace/stock-health-test/dev/fixture.json",
      "utf8"
    )
  ),
  { owner, manager, staff, outsider, station, p, today } = f;
async function api(
  path: string,
  a = owner,
  body?: Record<string, unknown>,
  expected = 200
) {
  const r = await fetch(base + "/api/stationos" + path, {
    method: body ? "POST" : "GET",
    headers: {
      Cookie: a.cookie,
      "Content-Type": "application/json",
      Origin: base,
      "X-Stationos-Request": "1",
      "X-CSRF-Token": a.csrf,
      "X-Stationos-Device-Id": a.device,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const d = await r.json();
  assert.equal(r.status, expected, `${path}: ${JSON.stringify(d)}`);
  return d.result ?? d;
}
const post = (path: string, b: Record<string, unknown>, a = owner) =>
  api(path, a, { stationId: station, requestId: randomUUID(), ...b });
const report = (params: Record<string, string> = {}, a = owner, status = 200) =>
  api(
    `/market-accounting/reports/sales?${new URLSearchParams({ stationId: station, from: today, to: today, ...params })}`,
    a,
    undefined,
    status
  );
const account = () => api("/market-accounting?stationId=" + station);
const physical = (a: any) =>
  JSON.stringify({
    revision: a.revision,
    balances: a.balances,
    stock: a.stock,
    closes: a.closes,
  });
const sql = await mysql.createConnection(process.env.DATABASE_URL!);
try {
  const [[scope]]: any = await sql.query(
    "SELECT t.is_demo FROM st_stations s JOIN st_tenants t ON t.id=s.tenant_id WHERE s.id=?",
    [station]
  );
  assert.equal(Number(scope?.is_demo), 1);
  const [[supplier]]: any = await sql.query(
    "SELECT id FROM st_market_parties WHERE station_id=? AND kind='SUPPLIER' LIMIT 1",
    [station]
  );
  const [[ownerSale]]: any = await sql.query(
    "SELECT session_id FROM st_pos_sales WHERE id=? AND station_id=?",
    [f.first, station]
  );
  const day = (n: number) =>
    new Date(Date.parse(today + "T12:00:00Z") + n * 86400000)
      .toISOString()
      .slice(0, 10);
  async function product(name: string, price = 1200) {
    const r = await post("/product", {
      name,
      barcode: "DEMO-H-" + randomUUID().slice(0, 8),
      minimumQty: 0,
      purchasePriceMinor: 0,
      salePriceMinor: price,
      supplierId: null,
    });
    await post("/market-accounting/product", {
      productId: r.id,
      vatBps: 2000,
      salePriceMinor: price,
    });
    return r.id as string;
  }
  const old = await product("DEMO eski satışsız ürün"),
    recent = await product("DEMO yeni satışsız ürün"),
    loss = await product("DEMO zararlı ve kârlı ürün", 120),
    low = await product("DEMO düşük marjlı ürün", 660),
    tracked = await product("DEMO karantinalı stok");
  const ls = await api(
    "/market-accounting/inventory/lots?stationId=" + station
  );
  const tp = ls.products.find((p: any) => p.id === tracked);
  await post("/market-accounting/inventory/lot-enable", {
    productId: tracked,
    expectedVersion: tp.stockVersion,
    expectedRevision: ls.revision,
    reason: "DEMO gerçek parti teyidi",
    lots: [],
  });
  await post("/market-accounting/purchase", {
    partyId: supplier.id,
    reference: "DEMO-STOK-SAGLIK",
    dueDate: today,
    expectedTotalMinor: 30000,
    lines: [old, recent, loss, low, tracked].map(productId => ({
      productId,
      quantity: 10,
      unitNetMinor: 500,
      vatBps: 2000,
      ...(productId === tracked
        ? {
            lots: [
              { code: "AVAILABLE", quantity: 5, expiryDate: day(30) },
              { code: "HELD", quantity: 5, expiryDate: day(30) },
            ],
          }
        : {}),
    })),
  });
  const receivedLots = await api(
    "/market-accounting/inventory/lots?stationId=" + station
  );
  const held = receivedLots.lots.find(
      (l: any) => l.productId === tracked && l.code === "HELD"
    ),
    trackedProduct = receivedLots.products.find((r: any) => r.id === tracked);
  await post("/market-accounting/inventory/lot-status", {
    productId: tracked,
    expectedVersion: trackedProduct.stockVersion,
    expectedRevision: receivedLots.revision,
    lotId: held.id,
    code: held.code,
    expiryDate: held.expiryDate,
    status: "QUARANTINE",
    inspectionAccepted: true,
    reason: "DEMO fizikî karantina kontrolü",
  });
  async function sell(productId: string, quantity: number, price: number) {
    return post("/pos/checkout", {
      sessionId: ownerSale.session_id,
      lines: [{ productId, quantity, expectedUnitPriceMinor: price }],
      paymentKind: "CASH",
      tenderedMinor: 10000,
    });
  }
  const lossSale = await sell(loss, 2, 120);
  await post("/market-accounting/product", {
    productId: loss,
    vatBps: 2000,
    salePriceMinor: 1200,
  });
  await sell(loss, 2, 1200);
  await sell(low, 2, 660);
  // Aged history is explicit synthetic fixture metadata; no real source data is modified.
  const [[source]]: any = await sql.query(
    "SELECT id FROM st_market_entries WHERE station_id=? AND kind='POS_SALE' AND source_id=?",
    [station, f.first]
  );
  await sql.execute(
    "UPDATE st_market_books SET started_on=? WHERE station_id=?",
    [day(-120), station]
  );
  await sql.execute("UPDATE st_products SET created_at=? WHERE station_id=?", [
    day(-120) + " 09:00:00.000",
    station,
  ]);
  await sql.execute(
    "UPDATE st_products SET created_at=? WHERE id=? AND station_id=?",
    [day(-10) + " 09:00:00.000", recent, station]
  );
  await sql.execute(
    "UPDATE st_market_entries SET business_date=? WHERE id=? AND station_id=?",
    [day(-100), source.id, station]
  );
  const [[q]]: any = await sql.query(
    "SELECT product_id FROM st_pos_sale_lines WHERE sale_id=? AND product_id<>? ORDER BY product_id LIMIT 1",
    [f.first, p]
  );
  const ret = await api(
    `/market-accounting/return-source?stationId=${station}&entryId=${source.id}`
  );
  await post("/market-accounting/return", {
    sourceEntryId: source.id,
    expectedRevision: ret.revision,
    reference: "DEMO-ESKI-SATIS-IADE",
    reason: "DEMO eski ürünün bugünkü iadesi",
    lines: [{ productId: q.product_id, quantity: 1 }],
    expectedTotalMinor: 120,
    expectedCreditedMinor: 0,
    expectedCostMinor: 50,
    wallet: "CASH_SAFE",
    moneyConfirmed: true,
  });
  const health = (
    params: Record<string, string> = {},
    a = owner,
    status = 200
  ) =>
    api(
      `/market-accounting/reports/stock-health?${new URLSearchParams({ stationId: station, ...params })}`,
      a,
      undefined,
      status
    );
  const margin = (
    params: Record<string, string> = {},
    a = owner,
    status = 200
  ) =>
    api(
      `/market-accounting/reports/margin-alerts?${new URLSearchParams({ stationId: station, from: day(-120), to: today, ...params })}`,
      a,
      undefined,
      status
    );
  const before = physical(await account()),
    h = await health();
  assert.ok(h.totals.catalogProducts > 50);
  assert.equal(h.totals.valueMinor, (await account()).stockValueMinor);
  assert.equal(h.rows.length, 50);
  assert.ok(h.nextCursor);
  const h2 = await health({ cursor: h.nextCursor, snapshot: h.snapshot });
  assert.equal(
    new Set([...h.rows, ...h2.rows].map(r => r.id)).size,
    h.totals.catalogProducts
  );
  const all = [...h.rows, ...h2.rows];
  const t = all.find((r: any) => r.id === tracked);
  assert.equal(t.valueMinor, 5000);
  assert.equal(t.quantity, 10);
  assert.equal(t.saleableQty, 5);
  assert.equal(t.blockedQty, 5);
  assert.equal(all.find((r: any) => r.id === recent).status, "UNOBSERVED");
  assert.equal(all.find((r: any) => r.id === old).status, "INACTIVE");
  assert.equal(all.find((r: any) => r.id === p).status, "ACTIVE");
  assert.equal(
    all.find((r: any) => r.id === q.product_id).lastSaleDate,
    day(-100)
  );
  const aged = await health({ mode: "INACTIVE", ageDays: "90" });
  assert.equal(aged.matched.products, 53);
  assert.equal(aged.totals.inactive90, 53);
  assert.equal(aged.totals.inactive30, 53);
  assert.equal(aged.totals.inactive60, 53);
  assert.equal(
    (await health({ search: "DEMO yeni satışsız" })).matched.products,
    1
  );
  assert.equal((await health({ mode: "UNOBSERVED" })).matched.products, 1);
  const m = await margin({ mode: "ALL" });
  assert.ok(m.nextCursor);
  const m2 = await margin({ mode: "ALL", asOf: m.asOf, cursor: m.nextCursor });
  const mi = [...m.rows, ...m2.rows];
  assert.equal(new Set(mi.map((r: any) => r.id)).size, m.totals.products);
  const z = mi.find((r: any) => r.id === loss);
  assert.equal(z.salesProfitMinor, 200);
  assert.equal(z.status, "LOSS");
  assert.equal(z.lossLines, 1);
  assert.equal(z.sampleLossSaleId, lossSale.id);
  assert.equal(mi.find((r: any) => r.id === low).status, "LOW");
  assert.ok(
    !(await margin({ thresholdBps: "900" })).rows.some((r: any) => r.id === low)
  );
  const todayMargins = await margin({ from: today, mode: "ALL" });
  assert.equal(
    todayMargins.rows.find((r: any) => r.id === q.product_id).status,
    "RETURN_ONLY"
  );
  assert.equal((await margin({ mode: "LOSS" })).rows.length, 1);
  const summary = await report({ from: day(-120) });
  assert.equal(m.totals.netSalesMinor, summary.totals.netSalesMinor);
  assert.equal(m.totals.cogsMinor, summary.totals.cogsMinor);
  assert.equal(m.totals.grossProfitMinor, summary.totals.grossProfitMinor);
  assert.equal(physical(await account()), before);
  await health({}, manager);
  await margin({}, manager);
  await health({}, staff, 403);
  await margin({}, staff, 403);
  await health({}, outsider, 403);
  await margin({}, outsider, 403);
  await health({ ageDays: "17" }, owner, 400);
  await health({ cursor: h.nextCursor }, owner, 400);
  await health({ snapshot: "bad" }, owner, 409);
  await margin({ thresholdBps: "10001" }, owner, 400);
  await margin({ from: "2020-01-01" }, owner, 400);
  await margin({ cursor: m.nextCursor }, owner, 400);
  await sell(loss, 1, 1200);
  await health({ cursor: h.nextCursor, snapshot: h.snapshot }, owner, 409);
  assert.deepEqual(
    (await margin({ mode: "ALL", asOf: m.asOf })).totals,
    m.totals
  );
  const currentMargin = await margin({ mode: "ALL" });
  assert.equal(
    currentMargin.totals.netSalesMinor,
    m.totals.netSalesMinor + 1000
  );
  assert.equal(currentMargin.totals.cogsMinor, m.totals.cogsMinor + 500);
  await post("/market-accounting/product", {
    productId: loss,
    vatBps: 1000,
    salePriceMinor: 9900,
  });
  assert.deepEqual(
    (await margin({ mode: "ALL", asOf: m.asOf })).totals,
    m.totals
  );
  const detail = await api(
    `/market-accounting/reports/sales/${lossSale.id}?${new URLSearchParams({ stationId: station, asOf: m.asOf })}`
  );
  assert.equal(detail.lines[0].unitPriceMinor, 120);
  assert.equal(detail.lines[0].costMinor, 1000);
  // Invalid current quantity, lot/cache value or historical cost is refused, never guessed.
  await sql.execute(
    "UPDATE st_market_inventory SET quantity=quantity+1 WHERE product_id=?",
    [old]
  );
  try {
    await health({}, owner, 409);
  } finally {
    await sql.execute(
      "UPDATE st_market_inventory SET quantity=quantity-1 WHERE product_id=?",
      [old]
    );
  }
  const [[lot]]: any = await sql.query(
    "SELECT id FROM st_inventory_lots WHERE product_id=? LIMIT 1",
    [tracked]
  );
  await sql.execute(
    "UPDATE st_inventory_lots SET quantity=quantity+1 WHERE id=?",
    [lot.id]
  );
  try {
    await health({}, owner, 409);
  } finally {
    await sql.execute(
      "UPDATE st_inventory_lots SET quantity=quantity-1 WHERE id=?",
      [lot.id]
    );
  }
  await sql.execute(
    "UPDATE st_market_balances SET balance_minor=balance_minor+1 WHERE station_id=? AND account_code='INVENTORY'",
    [station]
  );
  try {
    await health({}, owner, 409);
  } finally {
    await sql.execute(
      "UPDATE st_market_balances SET balance_minor=balance_minor-1 WHERE station_id=? AND account_code='INVENTORY'",
      [station]
    );
  }
  await sql.execute(
    "UPDATE st_pos_sale_lines SET cost_total_minor=cost_total_minor+1 WHERE sale_id=?",
    [lossSale.id]
  );
  try {
    await margin({}, owner, 409);
  } finally {
    await sql.execute(
      "UPDATE st_pos_sale_lines SET cost_total_minor=cost_total_minor-1 WHERE sale_id=?",
      [lossSale.id]
    );
  }
  await sql.execute(
    "UPDATE st_pos_sale_lines SET cost_total_minor=NULL WHERE sale_id=?",
    [lossSale.id]
  );
  try {
    await margin({}, owner, 409);
  } finally {
    await sql.execute(
      "UPDATE st_pos_sale_lines SET cost_total_minor=1000 WHERE sale_id=? AND product_id=?",
      [lossSale.id, loss]
    );
  }
  for (const a of [owner, manager]) {
    const identity = await api("/state", a),
      ps = await api("/pos?stationId=" + station, a);
    for (const session of ps.sessions.filter(
      (s: any) => !s.closedAt && s.userId === identity.user.id
    ))
      await post(
        "/pos/close",
        {
          sessionId: session.id,
          countedCashMinor: session.expectedCashMinor,
          cashTransferred: true,
        },
        a
      );
  }
  const ac = await account();
  await post("/market-accounting/day-close", {
    expectedRevision: ac.revision,
    countedCashMinor: ac.balances.CASH_SAFE,
  });
  const closed = physical(await account());
  await health();
  await margin();
  assert.equal(physical(await account()), closed);
  const output =
    process.env.SMOKE_OUTPUT_DIR ?? "/workspace/stock-health-test/checks-dev";
  await mkdir(output, { recursive: true, mode: 0o700 });
  await writeFile(
    output + "/fixture.json",
    JSON.stringify({
      ...f,
      old,
      recent,
      loss,
      low,
      tracked,
      lossSale: lossSale.id,
      from: day(-120),
    }),
    { mode: 0o600 }
  );
  const checks = [
    "Güncel stok maliyeti defterle eşleşti; parti değeri iki kez sayılmadı",
    "30/60/90 iç içe hareketsizlik, yeni ürün gözlem eksikliği ve iadenin son satışı yenilememesi",
    "50+ ürün sayfalama/arama ve değişen stokta eski görüntü reddi",
    "Kârlı ürün toplamında gizlenmeyen zararlı satır, düşük marj eşiği ve kaynak fiş snapshotı",
    "Yalnız iade dönemi yanlış zarar sayılmadı; ürün toplamları mali defterle eşleşti",
    "Marj kayıt sınırı, yeni satış ve sonraki fiyat değişiminden bağımsız geçmiş",
    "Rol/tenant/girdi sınırları; bozuk miktar/lot/değer/maliyet reddi",
    "Kapalı gün ve bütün GET sonrası stok/bakiye/revizyon/kapanış değişmedi",
  ];
  await writeFile(
    output + "/result.json",
    JSON.stringify({ ok: true, checks }, null, 2)
  );
  console.log(JSON.stringify({ ok: true, checks }, null, 2));
} finally {
  await sql.end();
}

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
        "/workspace/sales-analysis-test/dev/fixture.json",
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
  const [[tenant]]: any = await sql.query(
    "SELECT t.is_demo FROM st_stations s JOIN st_tenants t ON t.id=s.tenant_id WHERE s.id=?",
    [station]
  );
  assert.equal(Number(tenant?.is_demo), 1);
  const [[os]]: any = await sql.query(
    "SELECT user_id,register_id,session_id FROM st_pos_sales WHERE id=? AND station_id=?",
    [f.first, station]
  );
  const [[ms]]: any = await sql.query(
    "SELECT user_id,register_id,session_id FROM st_pos_sales WHERE id=? AND station_id=?",
    [f.mixed, station]
  );
  const previous = new Date(Date.parse(today + "T12:00:00Z") - 86400000)
    .toISOString()
    .slice(0, 10);
  const cards = await api("/market-accounting/inventory?stationId=" + station),
    q = cards.items.find(
      (r: any) => r.id !== p && r.barcode.startsWith("DEMO-R-")
    );
  assert.ok(q);
  async function category(id: string, name: string) {
    const item = cards.items.find((r: any) => r.id === id);
    return post("/market-accounting/inventory/product", {
      productId: id,
      name: item.name,
      category: name,
      brand: item.brand,
      unit: item.unit,
      shelf: item.shelf,
      supplierId: item.supplierId,
      minimumQty: item.minimumQty,
      maximumQty: item.maximumQty,
      leadDays: item.leadDays,
      reviewDays: item.reviewDays,
      safetyDays: item.safetyDays,
      orderPackQty: item.orderPackQty,
      purchaseVatBps: item.purchaseVatBps,
    });
  }
  await category(p, "DEMO GIDA");
  await category(q.id, "DEMO BAKIM");
  const multiBody = {
    stationId: station,
    requestId: randomUUID(),
    sessionId: ms.session_id,
    paymentKind: "CASH",
    tenderedMinor: 5000,
    lines: [
      { productId: p, quantity: 1, expectedUnitPriceMinor: 2200 },
      { productId: q.id, quantity: 1, expectedUnitPriceMinor: 120 },
    ],
  };
  const multi = await api("/pos/checkout", manager, multiBody);
  assert.deepEqual(await api("/pos/checkout", manager, multiBody), multi);
  await category(p, "DEMO YENI GIDA");
  const second = await post("/pos/checkout", {
    sessionId: os.session_id,
    paymentKind: "CASH",
    tenderedMinor: 5000,
    lines: [{ productId: p, quantity: 1, expectedUnitPriceMinor: 2200 }],
  });
  const [[source]]: any = await sql.query(
    "SELECT id FROM st_market_entries WHERE station_id=? AND kind='POS_SALE' AND source_id=?",
    [station, multi.id]
  );
  const ret = await api(
    `/market-accounting/return-source?stationId=${station}&entryId=${source.id}`
  );
  const refund = await post("/market-accounting/return", {
    sourceEntryId: source.id,
    expectedRevision: ret.revision,
    reference: "DEMO-KATEGORI-IADE",
    reason: "DEMO başka aktörün kategori iadesi",
    lines: [{ productId: p, quantity: 1 }],
    expectedTotalMinor: 2200,
    expectedCreditedMinor: 0,
    expectedCostMinor: 500,
    wallet: "CASH_SAFE",
    moneyConfirmed: true,
  });
  // Synthetic fixture only: simulate pre-0021 snapshots and precise midnight boundaries.
  await sql.execute(
    "UPDATE st_pos_sale_lines SET category_snapshot=NULL WHERE sale_id=?",
    [f.first]
  );
  await sql.execute(
    "UPDATE st_market_books SET started_on=? WHERE station_id=?",
    [previous, station]
  );
  await sql.execute(
    "UPDATE st_pos_sales SET created_at=? WHERE id=? AND station_id=?",
    [previous + " 20:59:00.000", f.first, station]
  );
  await sql.execute(
    "UPDATE st_market_entries SET business_date=? WHERE source_id=? AND station_id=? AND kind='POS_SALE'",
    [previous, f.first, station]
  );
  await sql.execute(
    "UPDATE st_pos_sales SET created_at=? WHERE id=? AND station_id=?",
    [previous + " 21:05:00.000", multi.id, station]
  );
  await sql.execute(
    "UPDATE st_pos_sales SET created_at=? WHERE id=? AND station_id=?",
    [previous + " 21:30:00.000", second.id, station]
  );
  await sql.execute(
    "UPDATE st_market_returns SET created_at=? WHERE station_id=? AND reference='DEMO-RAPOR-IADE'",
    [today + " 02:00:00.000", station]
  );
  await sql.execute(
    "UPDATE st_market_returns SET created_at=? WHERE station_id=? AND reference='DEMO-KATEGORI-IADE'",
    [today + " 20:10:00.000", station]
  );
  const analysis = (
    params: Record<string, string> = {},
    a = owner,
    status = 200
  ) =>
    api(
      `/market-accounting/reports/sales-analysis?${new URLSearchParams({ stationId: station, from: previous, to: today, ...params })}`,
      a,
      undefined,
      status
    );
  const before = physical(await account()),
    r = await analysis();
  assert.equal(r.hours.length, 24);
  assert.equal(r.totals.saleCount, 55);
  assert.equal(r.totals.returnCount, 2);
  const gid = r.categories.find((c: any) => c.category === "DEMO GIDA"),
    bak = r.categories.find((c: any) => c.category === "DEMO BAKIM"),
    changed = r.categories.find((c: any) => c.category === "DEMO YENI GIDA"),
    legacy = r.categories.find((c: any) => c.source === "LEGACY_UNKNOWN"),
    empty = r.categories.find((c: any) => c.source === "UNCATEGORIZED");
  assert.equal(gid.netSalesMinor, 0);
  assert.equal(gid.returnCount, 1);
  assert.equal(bak.netSalesMinor, 100);
  assert.equal(changed.netSalesMinor, 2000);
  assert.equal(legacy.salesGrossMinor, 9720);
  assert.equal(legacy.returnsGrossMinor, 1200);
  assert.ok(empty.saleCount > 0);
  assert.equal(
    r.categories.reduce((s: number, c: any) => s + c.saleCount, 0),
    r.totals.saleCount + 1
  );
  assert.equal(r.hours[0].saleCount, 2);
  assert.equal(r.hours[0].saleLines, 3);
  assert.equal(r.hours[0].salesGrossMinor, 4520);
  assert.equal(r.hours[23].saleCount, 1);
  assert.equal(r.hours[23].returnCount, 1);
  assert.equal(r.hours[5].returnsGrossMinor, 1200);
  assert.equal((await analysis({ from: today })).hours[23].saleCount, 0);
  assert.equal((await analysis({ from: today })).hours[23].returnCount, 1);
  const filtered = await analysis({ userId: String(ms.user_id) });
  assert.equal(filtered.totals.saleCount, 2);
  assert.equal(filtered.totals.returnsGrossMinor, 2200);
  assert.equal(
    filtered.categories.find((c: any) => c.category === "DEMO GIDA")
      .returnCount,
    1
  );
  assert.deepEqual(
    (await analysis({ registerId: ms.register_id })).totals,
    filtered.totals
  );
  assert.equal(
    (await analysis({ registerId: ms.register_id, userId: String(os.user_id) }))
      .totals.saleCount,
    0
  );
  const standard = await report({ from: previous });
  assert.equal(r.totals.netSalesMinor, standard.totals.netSalesMinor);
  assert.equal(r.totals.cogsMinor, standard.totals.cogsMinor);
  assert.equal(r.totals.grossProfitMinor, standard.totals.grossProfitMinor);
  assert.equal(physical(await account()), before);
  await category(p, "DEMO SON");
  assert.deepEqual((await analysis({ asOf: r.asOf })).categories, r.categories);
  const draft = (
    await post("/pos/cart/add", {
      sessionId: os.session_id,
      productId: p,
      quantity: 1,
    })
  ).cart;
  await post("/pos/checkout", {
    sessionId: os.session_id,
    cartId: draft.id,
    cartVersion: draft.version,
    paymentKind: "CASH",
    tenderedMinor: 5000,
  });
  assert.ok(
    (await analysis()).categories.some((c: any) => c.category === "DEMO SON")
  );
  assert.deepEqual((await analysis({ asOf: r.asOf })).categories, r.categories);
  const many = cards.items.filter(
    (x: any) => x.barcode.startsWith("DEMO-R-") && x.id !== q.id
  );
  assert.equal(many.length, 50);
  for (const [i, item] of many.entries()) {
    await category(item.id, `DEMO GRUP ${String(i).padStart(2, "0")}`);
    await post("/pos/checkout", {
      sessionId: os.session_id,
      paymentKind: "CASH",
      tenderedMinor: 1000,
      lines: [{ productId: item.id, quantity: 1, expectedUnitPriceMinor: 120 }],
    });
  }
  const final = await analysis();
  assert.equal(final.categories.length, 56);
  assert.equal(final.totals.saleCount, 106);
  await analysis({}, manager);
  await analysis({}, staff, 403);
  await analysis({}, outsider, 403);
  await analysis({ from: "2020-01-01" }, owner, 400);
  await analysis({ userId: "1.5" }, owner, 400);
  await analysis({ registerId: randomUUID() }, owner, 404);
  await analysis({ asOf: "18446744073709551615" }, owner, 400);
  const tomorrow = new Date(Date.parse(today + "T12:00:00Z") + 86400000)
    .toISOString()
    .slice(0, 10);
  const blank = await analysis({ from: tomorrow, to: tomorrow });
  assert.equal(blank.categories.length, 0);
  assert.equal(blank.hours.length, 24);
  assert.equal(blank.totals.saleCount, 0);
  assert.equal(blank.hours[0].averageSaleMinor, null);
  const [[saved]]: any = await sql.query(
    "SELECT net_total_minor FROM st_pos_sale_lines WHERE sale_id=? AND product_id=?",
    [multi.id, p]
  );
  await sql.execute(
    "UPDATE st_pos_sale_lines SET net_total_minor=NULL WHERE sale_id=? AND product_id=?",
    [multi.id, p]
  );
  try {
    await analysis({}, owner, 409);
  } finally {
    await sql.execute(
      "UPDATE st_pos_sale_lines SET net_total_minor=? WHERE sale_id=? AND product_id=?",
      [saved.net_total_minor, multi.id, p]
    );
  }
  for (const a of [owner, manager]) {
    const st = await api("/state", a),
      pos = await api("/pos?stationId=" + station, a);
    for (const s of pos.sessions.filter(
      (s: any) => !s.closedAt && s.userId === st.user.id
    ))
      await post(
        "/pos/close",
        {
          sessionId: s.id,
          countedCashMinor: s.expectedCashMinor,
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
  await analysis();
  await analysis({ userId: String(ms.user_id) });
  assert.equal(physical(await account()), closed);
  const output =
    process.env.SMOKE_OUTPUT_DIR ?? "/workspace/sales-analysis-test/checks-dev";
  await mkdir(output, { recursive: true, mode: 0o700 });
  await writeFile(
    output + "/fixture.json",
    JSON.stringify({
      ...f,
      from: previous,
      managerUserId: String(ms.user_id),
      managerRegisterId: ms.register_id,
      categoryCount: final.categories.length,
      saleCount: final.totals.saleCount,
    }),
    { mode: 0o600 }
  );
  const checks = [
    "Yeni kategori snapshotı, değişen karttan bağımsız satış ve kaynak kategoriye iade",
    "NULL eski kategori ile boş kayıtlı kategori ayrıldı; mali toplamlar eşleşti",
    "İstanbul gece yarısı, ayrı iade saati ve 24 boş/dolu saat",
    "Çok satır/kategori ve same-ID satış, fiş adedi çoğalmadı",
    "Kasa/kasiyer/kesişim ve başka aktör iadesinde özgün satış filtresi",
    "56 kategori/106 fiş; sabit kayıt sınırı ve yeni kategori",
    "Rol/tenant/tarih/bozuk snapshot reddi",
    "Kapalı gün GET sonrası stok/bakiye/revizyon/kapanış değişmedi",
  ];
  await writeFile(
    output + "/result.json",
    JSON.stringify({ ok: true, checks }, null, 2)
  );
  console.log(JSON.stringify({ ok: true, checks }, null, 2));
} finally {
  await sql.end();
}

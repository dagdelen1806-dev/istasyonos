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
        "/workspace/report-controls-test/dev/fixture.json",
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
const cancels = (
  params: Record<string, string> = {},
  a = owner,
  status = 200
) =>
  api(
    `/market-accounting/reports/cancellations?${new URLSearchParams({ stationId: station, from: today, to: today, ...params })}`,
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
  assert.ok(scope?.is_demo);
  const [[ms]]: any = await sql.query(
    "SELECT register_id,user_id,session_id FROM st_pos_sales WHERE id=? AND station_id=?",
    [f.mixed, station]
  );
  assert.ok(ms);
  const [[os]]: any = await sql.query(
    "SELECT register_id,user_id,session_id FROM st_pos_sales WHERE id=? AND station_id=?",
    [f.first, station]
  );
  const managerFilter = { userId: String(ms.user_id) },
    ownerFilter = { userId: String(os.user_id) };
  const options = await api(
    "/market-accounting/reports/options?stationId=" + station
  );
  assert.ok(options.users.some((u: any) => u.id === managerFilter.userId));
  const full = await report(),
    filtered = await report(managerFilter);
  assert.equal(full.salesOnly, false);
  assert.equal(filtered.salesOnly, true);
  assert.equal(filtered.totals.saleCount, 1);
  assert.equal(filtered.totals.salesGrossMinor, 1200);
  assert.equal(filtered.totals.grossProfitMinor, 500);
  assert.equal(filtered.totals.expensesMinor, 0);
  assert.equal(full.totals.expensesMinor, 100);
  const registerFiltered = await report({ registerId: ms.register_id });
  assert.deepEqual(registerFiltered.totals, filtered.totals);
  assert.equal(
    (await report({ ...managerFilter, registerId: os.register_id })).totals
      .saleCount,
    0
  );
  const productURL =
    "/market-accounting/reports/sales/products?" +
    new URLSearchParams({
      stationId: station,
      from: today,
      to: today,
      asOf: filtered.asOf,
      ...managerFilter,
    });
  const prod = await api(productURL);
  assert.equal(prod.rows.length, 1);
  assert.equal(prod.rows[0].profitMinor, 500);
  const [[source]]: any = await sql.query(
    "SELECT id FROM st_market_entries WHERE source_id=? AND station_id=? AND kind='POS_SALE'",
    [f.mixed, station]
  );
  const ret = await api(
    `/market-accounting/return-source?stationId=${station}&entryId=${source.id}`
  );
  await post("/market-accounting/return", {
    sourceEntryId: source.id,
    expectedRevision: ret.revision,
    reference: "DEMO-KONTROL-IADE",
    reason: "DEMO başka kişi kaynak satış iadesi",
    lines: [{ productId: p, quantity: 1 }],
    expectedTotalMinor: 1200,
    expectedCreditedMinor: 0,
    expectedCostMinor: 500,
    wallet: "CASH_SAFE",
    moneyConfirmed: true,
  });
  const now = await report(managerFilter);
  assert.equal(now.totals.returnsGrossMinor, 1200);
  assert.equal(now.totals.grossProfitMinor, 0);
  assert.equal(
    (await report({ ...managerFilter, asOf: filtered.asOf })).totals
      .returnsGrossMinor,
    0
  );
  assert.equal((await report(ownerFilter)).totals.returnsGrossMinor, 1200); // only the earlier owner-source return
  const before = physical(await account());
  let cart = (
    await post("/pos/cart/add", {
      sessionId: os.session_id,
      productId: p,
      quantity: 55,
    })
  ).cart;
  const firstReduce = {
    stationId: station,
    requestId: randomUUID(),
    sessionId: os.session_id,
    cartId: cart.id,
    cartVersion: cart.version,
    productId: p,
    quantity: 1,
    reason: "DEMO açıklamalı azaltma",
  };
  const once = await api("/pos/cart/reduce", owner, firstReduce);
  assert.deepEqual(await api("/pos/cart/reduce", owner, firstReduce), once);
  cart = once.cart;
  for (let i = 0; i < 50; i++)
    cart = (
      await post("/pos/cart/reduce", {
        sessionId: os.session_id,
        cartId: cart.id,
        cartVersion: cart.version,
        productId: p,
        quantity: 1,
        reason: "DEMO açıklamalı ürün azaltma",
      })
    ).cart;
  await post("/pos/cart/cancel", {
    cartId: cart.id,
    cartVersion: cart.version,
    reason: "DEMO kalan sepet iptali",
  });
  // Isolated fixture: force the same millisecond to exercise UUID tie pagination.
  await sql.execute(
    "UPDATE st_pos_cart_events SET created_at=? WHERE cart_id=? AND action IN ('REDUCE','CANCEL')",
    [today + " 09:00:00.123", cart.id]
  );
  const cr = await cancels();
  assert.equal(cr.totals.events, 52);
  assert.equal(cr.totals.reductions, 51);
  assert.equal(cr.totals.cancellations, 1);
  assert.equal(cr.totals.removedMinor, 121000);
  assert.equal(cr.rows.length, 50);
  assert.ok(cr.nextCursor);
  const next = await cancels({ asOf: cr.asOf, cursor: cr.nextCursor });
  assert.equal(next.rows.length, 2);
  assert.equal(new Set([...cr.rows, ...next.rows].map(r => r.id)).size, 52);
  assert.deepEqual(next.totals, cr.totals);
  assert.ok(cr.rows.every((r: any) => r.lines[0].unitPriceMinor === 2200));
  let mc = (
    await post(
      "/pos/cart/add",
      { sessionId: ms.session_id, productId: p, quantity: 2 },
      manager
    )
  ).cart;
  await post(
    "/pos/cart/cancel",
    {
      cartId: mc.id,
      cartVersion: mc.version,
      reason: "DEMO yönetici sepet iptali",
    },
    manager
  );
  await sql.execute(
    "UPDATE st_pos_cart_events SET created_at=? WHERE cart_id=? AND action='CANCEL'",
    [today + " 09:00:00.123", mc.id]
  );
  const updated = await cancels();
  assert.equal(updated.totals.events, 53);
  assert.equal(updated.totals.removedMinor, 125400);
  assert.equal((await cancels({ asOf: cr.asOf })).totals.events, 52);
  assert.equal((await cancels(managerFilter)).totals.events, 1);
  assert.equal(
    (await cancels({ registerId: ms.register_id })).totals.events,
    1
  );
  assert.equal(
    (await cancels({ ...managerFilter, registerId: os.register_id })).totals
      .events,
    0
  );
  assert.equal(physical(await account()), before);
  await report(managerFilter, staff, 403);
  await report({}, outsider, 403);
  await cancels({}, staff, 403);
  await cancels({}, outsider, 403);
  await api(
    "/market-accounting/reports/options?stationId=" + station,
    staff,
    undefined,
    403
  );
  await report({ userId: "1.2" }, owner, 400);
  await report({ userId: "2147483648" }, owner, 400);
  await report({ registerId: randomUUID() }, owner, 404);
  await report({ userId: "2147483647" }, owner, 404);
  await cancels({ cursor: "garbage", asOf: cr.asOf }, owner, 400);
  await cancels({ asOf: "18446744073709551615" }, owner, 400);
  const [[foreign]]: any = await sql.query(
    "SELECT id FROM st_pos_registers WHERE station_id<>? LIMIT 1",
    [station]
  );
  if (foreign) {
    await report({ registerId: foreign.id }, owner, 404);
    await cancels({ registerId: foreign.id }, owner, 404);
  }
  // Corrupt snapshot must be rejected rather than treated as a zero-value cancellation.
  const corrupt = updated.rows[0].id;
  const [[saved]]: any = await sql.query(
    "SELECT before_lines_json FROM st_pos_cart_events WHERE id=?",
    [corrupt]
  );
  await sql.execute(
    "UPDATE st_pos_cart_events SET before_lines_json='{}' WHERE id=?",
    [corrupt]
  );
  try {
    await cancels({}, owner, 409);
  } finally {
    await sql.execute(
      "UPDATE st_pos_cart_events SET before_lines_json=? WHERE id=?",
      [
        typeof saved.before_lines_json === "string"
          ? saved.before_lines_json
          : JSON.stringify(saved.before_lines_json),
        corrupt,
      ]
    );
  }
  for (const [a, sessionId] of [
    [owner, os.session_id],
    [manager, ms.session_id],
  ] as const) {
    const ps = await api("/pos?stationId=" + station, a),
      s = ps.sessions.find((s: any) => s.id === sessionId);
    await post(
      "/pos/close",
      {
        sessionId,
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
  await cancels();
  await report(managerFilter);
  assert.equal(physical(await account()), closed);
  const output =
    process.env.SMOKE_OUTPUT_DIR ??
    "/workspace/report-controls-test/controls-dev";
  await mkdir(output, { recursive: true, mode: 0o700 });
  await writeFile(
    output + "/fixture.json",
    JSON.stringify({
      ...f,
      managerUserId: managerFilter.userId,
      ownerUserId: ownerFilter.userId,
      managerRegisterId: ms.register_id,
      ownerRegisterId: os.register_id,
    }),
    { mode: 0o600 }
  );
  const checks = [
    "Kasa/kasiyer ve birlikte filtre, cari tahsilatı çoğaltmadan kapsamlı satış",
    "Özgün satış kişisine bağlanan başka aktör iadesi ve maliyet",
    "Filtreli brüt kâr, genel giderlerin dağıtılmaması, filtreli ürünler",
    "52 iptal, aynı milisaniye UUID sayfalaması, tüm dönem toplamı ve snapshot fiyat",
    "Yeni olay aynı tarih/saatte bile seq kayıt sınırını aşamadı",
    "İşlem aktörü/kasa, same-ID tek olay ve bozuk snapshot reddi",
    "Rol/tenant/yabancı kasa/kullanıcı/tarih/imleç koruması",
    "İptal ve kapalı gün GET sonrası stok/defter/bakiye/kapanış değişmedi",
  ];
  await writeFile(
    output + "/result.json",
    JSON.stringify({ ok: true, checks }, null, 2)
  );
  console.log(JSON.stringify({ ok: true, checks }, null, 2));
} finally {
  await sql.end();
}

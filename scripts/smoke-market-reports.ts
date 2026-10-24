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
    companyName: `DEMO rapor testi ${randomUUID().slice(0, 8)}`,
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
const pos = (a = owner) => raw("/pos?stationId=" + station, a);
for (const [a, role] of [
  [staff, "MARKET_STAFF"],
  [manager, "MANAGER"],
] as const) {
  const code = (await post("/invite", { role, stationIds: [station] })).code;
  await raw("/join", a, { requestId: randomUUID(), code });
}
const sql = await mysql.createConnection(process.env.DATABASE_URL!);
try {
  const initial = await pos();
  for (const s of initial.sessions.filter((s: any) => !s.closedAt))
    await post("/pos/close", {
      sessionId: s.id,
      countedCashMinor: s.expectedCashMinor,
    });
  const p = (
    await post("/product", {
      name: "DEMO rapor ana ürün",
      barcode: "0012345678901",
      minimumQty: 2,
      purchasePriceMinor: 0,
      salePriceMinor: 1200,
      supplierId: null,
    })
  ).id;
  const opening = await account();
  await post("/market-accounting/start", {
    openingStockAccepted: true,
    expectedInventoryMinor: opening.openingInventoryMinor,
    cashMinor: 100000,
    bankMinor: 100000,
    cardMinor: 0,
  });
  await post("/market-accounting/product", {
    productId: p,
    vatBps: 2000,
    salePriceMinor: 1200,
  });
  const today = (await account()).today;
  const supplier = (
    await post("/market-accounting/party", {
      name: "DEMO rapor tedarikçisi",
      kind: "SUPPLIER",
      receivableLimitMinor: 0,
      payableLimitMinor: null,
      termDays: 0,
    })
  ).id;
  const customer = (
    await post("/market-accounting/party", {
      name: "DEMO rapor müşterisi",
      kind: "CUSTOMER",
      receivableLimitMinor: 100000,
      termDays: 0,
    })
  ).id;
  const other: string[] = [];
  for (let i = 0; i < 51; i++) {
    const id = (
      await post("/product", {
        name: `DEMO rapor ürün ${i}`,
        barcode: "DEMO-R-" + i,
        minimumQty: 0,
        purchasePriceMinor: 0,
        salePriceMinor: 120,
        supplierId: null,
      })
    ).id;
    await post("/market-accounting/product", {
      productId: id,
      vatBps: 2000,
      salePriceMinor: 120,
    });
    other.push(id);
  }
  await post("/market-accounting/purchase", {
    partyId: supplier,
    reference: "DEMO-RAPOR-ALIS",
    dueDate: today,
    lines: [
      { productId: p, quantity: 200, unitNetMinor: 500, vatBps: 2000 },
      ...other.map(productId => ({
        productId,
        quantity: 2,
        unitNetMinor: 50,
        vatBps: 2000,
      })),
    ],
    expectedTotalMinor: 126120,
  });
  const register = (
    await post("/pos/register", { name: "DEMO rapor kasası", code: "RAPOR" })
  ).id;
  const session = (
    await post("/pos/open", { registerId: register, openingFloatMinor: 1000 })
  ).id;
  const managerRegister = (
    await post("/pos/register", {
      name: "DEMO yönetici kasası",
      code: "YONETICI",
    })
  ).id;
  const managerSession = (
    await post(
      "/pos/open",
      { registerId: managerRegister, openingFloatMinor: 0 },
      200,
      manager
    )
  ).id;
  async function sell(extra: Record<string, unknown> = {}, a = owner) {
    return post(
      "/pos/checkout",
      {
        sessionId: session,
        lines: [{ productId: p, quantity: 1, expectedUnitPriceMinor: 1200 }],
        paymentKind: "CASH",
        tenderedMinor: 10000,
        ...extra,
      },
      200,
      a
    );
  }
  const first = await sell({
    lines: [
      { productId: p, quantity: 3, expectedUnitPriceMinor: 1200 },
      ...other.map(productId => ({
        productId,
        quantity: 1,
        expectedUnitPriceMinor: 120,
      })),
    ],
  });
  const mixed = await sell(
    {
      sessionId: managerSession,
      paymentKind: "MIXED",
      cashAmountMinor: 200,
      cardConfirmed: true,
    },
    manager
  );
  const credit = await sell({
    paymentKind: "ON_ACCOUNT",
    customerPartyId: customer,
  });
  for (let i = 0; i < 49; i++) await sell();
  const [entryRows]: any = await sql.execute(
    "SELECT id FROM st_market_entries WHERE station_id=? AND kind='POS_SALE' AND source_id=?",
    [station, first.id]
  );
  const source = await raw(
    `/market-accounting/return-source?stationId=${station}&entryId=${entryRows[0].id}`
  );
  await post("/market-accounting/return", {
    sourceEntryId: entryRows[0].id,
    expectedRevision: source.revision,
    reference: "DEMO-RAPOR-IADE",
    reason: "DEMO rapor kısmi iade",
    lines: [{ productId: p, quantity: 1 }],
    expectedTotalMinor: 1200,
    expectedCreditedMinor: 0,
    expectedCostMinor: 500,
    wallet: "CASH_SAFE",
    moneyConfirmed: true,
  });
  await post("/market-accounting/settlement", {
    partyId: customer,
    direction: "COLLECTION",
    wallet: "CASH_SAFE",
    amountMinor: 600,
    description: "DEMO satış olmayan tahsilat",
  });
  await post("/market-accounting/expense", {
    wallet: "BANK",
    netMinor: 100,
    vatBps: 0,
    description: "DEMO rapor gider kaydı",
  });
  const path = "/market-accounting/reports/sales";
  const report = (
    params: Record<string, string> = {},
    a = owner,
    status = 200
  ) =>
    raw(
      `${path}?${new URLSearchParams({ stationId: station, from: today, to: today, ...params })}`,
      a,
      undefined,
      status
    );
  const productReport = (asOf: string, cursor = "") =>
    raw(
      `${path}/products?${new URLSearchParams({ stationId: station, from: today, to: today, asOf, cursor })}`
    );
  const saleDetail = (id: string, asOf: string, a = owner, status = 200) =>
    raw(
      `${path}/${id}?${new URLSearchParams({ stationId: station, asOf })}`,
      a,
      undefined,
      status
    );
  const before = await account();
  const r = await report();
  assert.equal(r.totals.saleCount, 52);
  assert.equal(r.rows.length, 50);
  assert.ok(r.nextCursor);
  assert.equal(r.totals.salesGrossMinor, 70920);
  assert.equal(r.totals.returnsGrossMinor, 1200);
  assert.equal(r.totals.netGrossMinor, 69720);
  assert.equal(r.totals.payments.cashMinor, 68720);
  assert.equal(r.totals.payments.cardMinor, 1000);
  assert.equal(r.totals.payments.creditMinor, 1200);
  assert.equal(r.totals.netSalesMinor, 58100);
  assert.equal(r.totals.cogsMinor, 29050);
  assert.equal(r.totals.grossProfitMinor, 29050);
  assert.equal(r.totals.resultMinor, 28950);
  assert.equal(r.previous.saleCount, 0);
  assert.equal(r.totals.returns.cashMinor, 1200);
  const second = await report({ asOf: r.asOf, cursor: r.nextCursor });
  assert.equal(second.rows.length, 2);
  assert.equal(second.nextCursor, null);
  assert.deepEqual(second.totals, r.totals);
  const mixDetail = await saleDetail(mixed.id, r.asOf);
  assert.equal(mixDetail.actorName, "DEMO market yöneticisi");
  assert.equal(mixDetail.cashMinor, 200);
  assert.equal(mixDetail.cardMinor, 1000);
  const original = await saleDetail(first.id, r.asOf);
  assert.equal(original.lines.length, 52);
  assert.equal(original.returns.length, 1);
  assert.equal(original.costMinor, 4050);
  const prods = await productReport(r.asOf);
  assert.equal(prods.rows.length, 50);
  assert.ok(prods.nextCursor);
  const more = await productReport(r.asOf, prods.nextCursor);
  assert.equal(more.rows.length, 2);
  const all = [...prods.rows, ...more.rows];
  assert.equal(new Set(all.map((x: any) => x.id)).size, 52);
  assert.equal(
    all.reduce((s: number, x: any) => s + x.profitMinor, 0),
    r.totals.grossProfitMinor
  );
  assert.equal(all.find((x: any) => x.id === p).returnedQty, 1);
  await report({}, manager);
  await report({}, staff, 403);
  await report({}, outsider, 403);
  await saleDetail(first.id, r.asOf, staff, 403);
  await report({ from: "2026-02-29" }, owner, 400);
  await report({ from: "2020-01-01" }, owner, 400);
  await report({ cursor: "01", asOf: r.asOf }, owner, 400);
  await report({ cursor: r.nextCursor }, owner, 400);
  await report({ asOf: "18446744073709551615" }, owner, 400);
  await raw(
    `${path}/products?${new URLSearchParams({ stationId: station, from: today, to: today, asOf: r.asOf })}`,
    staff,
    undefined,
    403
  );
  await saleDetail(randomUUID(), r.asOf, owner, 404);
  const withoutAuth = await http(
    "/api/stationos" + path + "?stationId=" + station
  );
  assert.equal(withoutAuth.status, 401);
  const after = await account();
  for (const key of ["revision", "balances", "stockValueMinor", "closes"])
    assert.deepEqual(after[key], before[key]);
  // New financial records after the report watermark do not leak into old pages/products.
  const newer = await sell();
  assert.equal((await report({ asOf: r.asOf })).totals.saleCount, 52);
  assert.equal((await report()).totals.saleCount, 53);
  await saleDetail(newer.id, r.asOf, owner, 404);
  const prevDay = new Date(Date.parse(today + "T12:00:00Z") - 86400000)
    .toISOString()
    .slice(0, 10);
  // Fixture-only date perturbation proves returns are counted on their own day, not the original sale day.
  await sql.execute("UPDATE st_market_entries SET business_date=? WHERE id=?", [
    prevDay,
    entryRows[0].id,
  ]);
  try {
    const shifted = await report();
    assert.equal(shifted.totals.salesGrossMinor, 62400);
    assert.equal(shifted.totals.returnsGrossMinor, 1200);
    assert.equal(shifted.previous.salesGrossMinor, 9720);
  } finally {
    await sql.execute(
      "UPDATE st_market_entries SET business_date=? WHERE id=?",
      [today, entryRows[0].id]
    );
  }
  // Later card name/price/cost changes cannot rewrite sale snapshots or old financials.
  await post("/market-accounting/inventory/product", {
    productId: p,
    name: "DEMO güncel kart adı",
    category: "DEMO",
    brand: "",
    unit: "adet",
    shelf: "R1",
    supplierId: supplier,
    minimumQty: 2,
    maximumQty: 0,
    leadDays: 0,
    reviewDays: 1,
    safetyDays: 0,
    orderPackQty: 1,
    purchaseVatBps: 2000,
  });
  await post("/market-accounting/product", {
    productId: p,
    vatBps: 1000,
    salePriceMinor: 2200,
  });
  const originalNow = await saleDetail(first.id, r.asOf);
  assert.equal(
    originalNow.lines.find((l: any) => l.productId === p).name,
    "DEMO rapor ana ürün"
  );
  assert.equal(
    originalNow.lines.find((l: any) => l.productId === p).unitPriceMinor,
    1200
  );
  assert.deepEqual((await report({ asOf: r.asOf })).totals, r.totals);
  // Inconsistent details are rejected, never reconstructed from current product cost.
  await sql.execute(
    "UPDATE st_pos_sale_lines SET cost_total_minor=cost_total_minor+1 WHERE sale_id=? AND product_id=?",
    [first.id, p]
  );
  try {
    await saleDetail(first.id, r.asOf, owner, 409);
  } finally {
    await sql.execute(
      "UPDATE st_pos_sale_lines SET cost_total_minor=cost_total_minor-1 WHERE sale_id=? AND product_id=?",
      [first.id, p]
    );
  }
  if (process.env.SMOKE_LEAVE_OPEN !== "1") {
    const ms = (await pos(manager)).sessions.find(
      (x: any) => x.id === managerSession
    );
    await post(
      "/pos/close",
      {
        sessionId: managerSession,
        countedCashMinor: ms.expectedCashMinor,
        expectedCashMinor: ms.expectedCashMinor,
        reason: "DEMO yönetici kasası kapanışı",
        cashTransferred: true,
      },
      200,
      manager
    );
    const sessions = (await pos()).sessions;
    const sess = sessions.find((s: any) => s.id === session);
    await post("/pos/close", {
      sessionId: session,
      countedCashMinor: sess.expectedCashMinor,
      expectedCashMinor: sess.expectedCashMinor,
      reason: "DEMO rapor kasa kapanışı",
      cashTransferred: true,
    });
    const a = await account();
    await post("/market-accounting/day-close", {
      expectedRevision: a.revision,
      countedCashMinor: a.balances.CASH_SAFE,
    });
    const closedBefore = await account();
    await report();
    await saleDetail(first.id, r.asOf);
    await productReport(r.asOf);
    const closedAfter = await account();
    for (const key of ["revision", "balances", "stockValueMinor", "closes"])
      assert.deepEqual(closedAfter[key], closedBefore[key]);
  }
  const output =
    process.env.SMOKE_OUTPUT_DIR ?? "/workspace/market-report-test/dev";
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
      first: first.id,
      mixed: mixed.id,
      today,
      asOf: r.asOf,
    }),
    { mode: 0o600 }
  );
  const checks = [
    "Satış/iade/KDV/maliyet/faaliyet sonucu mali defter mutabakatı",
    "Karma ödeme ve sonraki tahsilatta satış çoğalmadı",
    "52 fiş ve 52 ürün, keyset sayfalama ve tüm dönem toplamı",
    "Gerçek satış kullanıcısı, snapshot ve kısmi iade ayrıntısı",
    "Rol/tenant/401/tarih/imleç ve tutarsız fiş reddi",
    "Yeni kayıt sonrası sabit watermark ve yeni rapor",
    "İade günü ile kaynak satış günü ayrımı, eşit önceki dönem",
    "Güncel kart/fiyat değişiminden bağımsız kaynak tutarlar",
    ...(process.env.SMOKE_LEAVE_OPEN === "1"
      ? []
      : ["Kapalı gün GET sonrası stok/bakiye/revizyon/kapanış değişmedi"]),
  ];
  await writeFile(
    output + "/result.json",
    JSON.stringify({ ok: true, checks }, null, 2)
  );
  console.log(JSON.stringify({ ok: true, checks }, null, 2));
} finally {
  await sql.end();
}

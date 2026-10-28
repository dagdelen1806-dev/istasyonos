import { strict as assert } from "node:assert";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
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
type Actor = {
  cookie: string;
  csrf: string;
  device: string;
  email: string;
  password: string;
};
async function http(
  path: string,
  a?: Actor,
  body?: Record<string, unknown>,
  expected = 200
) {
  const r = await fetch(base + path, {
    method: body ? "POST" : "GET",
    headers: {
      "Content-Type": "application/json",
      Origin: base,
      "X-Stationos-Request": "1",
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
  const d = await r.json();
  assert.equal(r.status, expected, path + ":" + JSON.stringify(d));
  return {
    data: d.result ?? d,
    cookie: r.headers.get("set-cookie")?.split(";")[0] ?? "",
  };
}
async function auth(name: string) {
  const a: Actor = {
    cookie: "",
    csrf: "",
    device: randomUUID(),
    email: `dues-${randomUUID()}@example.invalid`,
    password: randomBytes(24).toString("hex"),
  };
  a.cookie = (
    await http(
      "/api/auth/register",
      undefined,
      { name: `DEMO ${name}`, email: a.email, password: a.password },
      201
    )
  ).cookie;
  a.csrf = (await http("/api/stationos/state", a)).data.csrfToken;
  return a;
}
const owner = await auth("vade sahibi"),
  manager = await auth("vade yöneticisi"),
  staff = await auth("vade personeli"),
  outsider = await auth("dış kullanıcı");
const station = (
  await http("/api/stationos/setup", owner, {
    requestId: randomUUID(),
    companyName: "DEMO vade " + randomUUID().slice(0, 8),
    stationName: "DEMO Vade Market",
    stationCode: randomUUID().slice(0, 8),
    isDemo: true,
  })
).data.stationId;
const api = async (
  path: string,
  a = owner,
  body?: Record<string, unknown>,
  expected = 200
) => (await http("/api/stationos" + path, a, body, expected)).data;
const post = (path: string, body: Record<string, unknown>) =>
  api(path, owner, { stationId: station, requestId: randomUUID(), ...body });
const account = () => api("/market-accounting?stationId=" + station);
const report = (
  query: Record<string, string> = {},
  a = owner,
  expected = 200
) =>
  api(
    "/market-accounting/reports/party-dues?" +
      new URLSearchParams({ stationId: station, ...query }),
    a,
    undefined,
    expected
  );
const sql = await mysql.createConnection(process.env.DATABASE_URL!);
try {
  const [[t]]: any = await sql.query(
    "SELECT t.is_demo FROM st_stations s JOIN st_tenants t ON t.id=s.tenant_id WHERE s.id=?",
    [station]
  );
  assert.equal(Number(t.is_demo), 1);
  for (const [a, role] of [
    [manager, "MANAGER"],
    [staff, "MARKET_STAFF"],
  ] as const) {
    const code = (await post("/invite", { role, stationIds: [station] })).code;
    await api("/join", a, { requestId: randomUUID(), code });
  }
  const initial = await api("/pos?stationId=" + station);
  for (const s of initial.sessions.filter((s: any) => !s.closedAt))
    await post("/pos/close", {
      sessionId: s.id,
      countedCashMinor: s.expectedCashMinor,
    });
  const opening = await account();
  await post("/market-accounting/start", {
    openingStockAccepted: true,
    expectedInventoryMinor: opening.openingInventoryMinor,
    cashMinor: 100000,
    bankMinor: 100000,
    cardMinor: 0,
  });
  const today = (await account()).today,
    day = (n: number) =>
      new Date(Date.parse(today + "T12:00:00Z") + n * 86400000)
        .toISOString()
        .slice(0, 10);
  const both = (
    await post("/market-accounting/party", {
      name: "DEMO çift yönlü cari",
      kind: "BOTH",
      receivableLimitMinor: 100000,
      openingReceivableMinor: 9000,
      openingPayableMinor: 5000,
      openingNote: "DEMO teyitli devir",
    })
  ).id;
  const supplier = (
    await post("/market-accounting/party", {
      name: "DEMO vade tedarikçisi",
      kind: "SUPPLIER",
      termDays: 0,
    })
  ).id;
  const p = (
    await post("/product", {
      name: "DEMO vade ürünü",
      barcode: "DEMO-V-" + randomUUID().slice(0, 8),
      minimumQty: 0,
      purchasePriceMinor: 0,
      salePriceMinor: 2400,
    })
  ).id;
  await post("/market-accounting/product", {
    productId: p,
    vatBps: 2000,
    salePriceMinor: 2400,
  });
  const offsets = [
    -91,
    -90,
    -61,
    -60,
    -31,
    -30,
    -8,
    -7,
    -1,
    0,
    1,
    7,
    8,
    30,
    31,
    90,
    91,
    ...Array(35).fill(10),
  ];
  for (let i = 0; i < offsets.length; i++)
    await post("/market-accounting/purchase", {
      partyId: supplier,
      reference: "DEMO-VADE-" + i,
      dueDate: day(offsets[i]),
      lines: [{ productId: p, quantity: 2, unitNetMinor: 500, vatBps: 2000 }],
      expectedTotalMinor: 1200,
    });
  let r = await report();
  assert.equal(r.matched, 54);
  assert.equal(r.rows.length, 50);
  assert.deepEqual(r.totals, {
    receivableMinor: 9000,
    payableMinor: 67400,
    documents: 54,
  });
  const second = await report({ cursor: r.nextCursor, snapshot: r.snapshot });
  assert.equal(second.rows.length, 4);
  assert.equal(
    new Set([...r.rows, ...second.rows].map((d: any) => d.id)).size,
    54
  );
  assert.equal(r.overdue.payableMinor, 10800);
  assert.equal(r.todayDue.payableMinor, 6200);
  assert.equal(r.calendar.length, 91);
  assert.equal(
    r.aging.reduce((n: number, a: any) => n + a.amounts.payableMinor, 0),
    r.totals.payableMinor
  );
  assert.equal((await report({ view: "NEXT7" })).matched, 2);
  assert.equal((await report({ view: "NEXT30" })).matched, 39);
  assert.equal((await report({ view: "NEXT90" })).matched, 41);
  assert.equal((await report({ view: "UNKNOWN" })).matched, 0);
  assert.equal(
    (await report({ partyId: both, direction: "AR" })).totals.receivableMinor,
    9000
  );
  assert.deepEqual((await report({ partyId: both })).totals, {
    receivableMinor: 9000,
    payableMinor: 5000,
    documents: 2,
  });
  await report({}, manager);
  await report({}, staff, 403);
  await report({}, outsider, 403);
  await http(
    "/api/stationos/market-accounting/reports/party-dues?stationId=" + station,
    undefined,
    undefined,
    401
  );
  await report({ partyId: randomUUID() }, owner, 404);
  await report({ view: "BAD" }, owner, 400);
  await report({ direction: "BAD" }, owner, 400);
  await report({ from: today }, owner, 400);
  await report({ cursor: r.nextCursor }, owner, 400);
  await report({ cursor: randomUUID(), snapshot: r.snapshot }, owner, 400);
  const payment = await post("/market-accounting/settlement", {
    partyId: supplier,
    direction: "PAYMENT",
    wallet: "BANK",
    amountMinor: 500,
    description: "DEMO kısmi ödeme",
  });
  await report({ cursor: r.nextCursor, snapshot: r.snapshot }, owner, 409);
  r = await report();
  assert.equal(r.totals.payableMinor, 66900);
  assert.equal(
    r.rows.find((d: any) => d.reference === "DEMO-VADE-0").remainingMinor,
    700
  );
  await post("/market-accounting/reverse", {
    entryId: payment.id,
    reason: "DEMO ödeme ters kaydı",
  });
  assert.equal((await report()).totals.payableMinor, 67400);
  const collection = await post("/market-accounting/settlement", {
    partyId: both,
    direction: "COLLECTION",
    wallet: "BANK",
    amountMinor: 9000,
    description: "DEMO tam tahsilat",
  });
  assert.deepEqual((await report({ partyId: both })).totals, {
    receivableMinor: 0,
    payableMinor: 5000,
    documents: 1,
  });
  await post("/market-accounting/reverse", {
    entryId: collection.id,
    reason: "DEMO tahsilat ters kaydı",
  });
  // Actual source-linked return credits part of the latest unpaid purchase.
  const [[source]]: any = await sql.query(
    "SELECT entry_id FROM st_market_documents WHERE station_id=? AND reference=?",
    [station, "DEMO-VADE-51"]
  );
  const src = await api(
    "/market-accounting/return-source?stationId=" +
      station +
      "&entryId=" +
      source.entry_id
  );
  await post("/market-accounting/return", {
    sourceEntryId: source.entry_id,
    expectedRevision: src.revision,
    reference: "DEMO-VADE-IADE",
    reason: "DEMO gerçek mal iadesi",
    lines: [{ productId: p, quantity: 1 }],
    expectedTotalMinor: 600,
    expectedCreditedMinor: 600,
    expectedCostMinor: 500,
    wallet: "CASH_SAFE",
    moneyConfirmed: true,
  });
  r = await report();
  assert.equal(r.totals.payableMinor, 66800);
  const all = [
      ...r.rows,
      ...(await report({ cursor: r.nextCursor, snapshot: r.snapshot })).rows,
    ],
    credited = all.find((d: any) => d.reference === "DEMO-VADE-51");
  assert.equal(credited.creditedMinor, 600);
  assert.equal(credited.remainingMinor, 600);
  // Corruption simulation is confined to this synthetic test station and always restored.
  try {
    await sql.query(
      "UPDATE st_market_documents SET total_minor=total_minor+1 WHERE id=?",
      [credited.id]
    );
    await report({}, owner, 409);
  } finally {
    await sql.query(
      "UPDATE st_market_documents SET total_minor=total_minor-1 WHERE id=?",
      [credited.id]
    );
  }
  const before = await account();
  await report();
  await report({ direction: "AR" });
  await report({ direction: "AP", view: "OVERDUE" }, manager);
  const after = await account();
  for (const key of [
    "revision",
    "balances",
    "stock",
    "stockValueMinor",
    "closes",
  ])
    assert.deepEqual(after[key], before[key]);
  await post("/market-accounting/day-close", {
    expectedRevision: after.revision,
    countedCashMinor: after.balances.CASH_SAFE,
  });
  const closed = await account();
  await report();
  const afterClosed = await account();
  for (const key of [
    "revision",
    "balances",
    "stock",
    "stockValueMinor",
    "closes",
  ])
    assert.deepEqual(afterClosed[key], closed[key]);
  const output =
    process.env.SMOKE_OUTPUT_DIR ?? "/workspace/party-dues-test/dev";
  await mkdir(output, { recursive: true, mode: 0o700 });
  await writeFile(
    output + "/fixture.json",
    JSON.stringify({
      owner,
      manager,
      staff,
      outsider,
      station,
      both,
      supplier,
      p,
      today,
      credited: credited.id,
    }),
    { mode: 0o600 }
  );
  const checks = [
    "54 açık belge 50+4 sayfa; alacak/borç ve tam yaşlandırma mutabakatı",
    "Bugün/gecikme/7/30/90 sınırları ve çift yönlü cari",
    "Kısmi ödeme, tam tahsilat, ters kayıt ve kaynak belgeli iade",
    "Rol/tenant/401/filtre/imleç, canlı görüntü değişimi ve defter tutarsızlığı",
    "Kapalı gün dahil salt GET stok/bakiye/revizyon/kapanış korundu",
  ];
  await writeFile(
    output + "/result.json",
    JSON.stringify({ ok: true, checks }, null, 2)
  );
  console.log(JSON.stringify({ ok: true, checks }, null, 2));
} finally {
  await sql.end();
}

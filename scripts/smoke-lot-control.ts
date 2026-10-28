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
        "/workspace/lot-control-test/dev/fixture.json",
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
  const day = (n: number) =>
    new Date(Date.parse(today + "T12:00:00Z") + 86400000 * n)
      .toISOString()
      .slice(0, 10);
  const tracked = (
    await post("/product", {
      name: "DEMO SKT kontrol süt",
      barcode: "DEMO-SKT-" + randomUUID().slice(0, 8),
      minimumQty: 0,
      purchasePriceMinor: 0,
      salePriceMinor: 1200,
      supplierId: null,
    })
  ).id;
  const lotState = () =>
    api("/market-accounting/inventory/lots?stationId=" + station);
  const preview = async () => {
    const s = await lotState(),
      p = s.products.find((p: any) => p.id === tracked);
    return {
      productId: tracked,
      expectedVersion: p.stockVersion,
      expectedRevision: s.revision,
      reason: "DEMO fizikî kontrol",
    };
  };
  await post("/market-accounting/inventory/lot-enable", {
    ...(await preview()),
    lots: [],
  });
  const lots = [
    { code: "TODAY", quantity: 10, expiryDate: day(0) },
    { code: "D7", quantity: 10, expiryDate: day(7) },
    { code: "D15", quantity: 10, expiryDate: day(15) },
    { code: "D30", quantity: 10, expiryDate: day(30) },
    { code: "FAR", quantity: 10, expiryDate: day(31) },
    { code: "HOLD", quantity: 10, expiryDate: day(20) },
    { code: "EXPIRED", quantity: 10, expiryDate: day(1) },
    { code: "UNKNOWN", quantity: 10, expiryDate: day(1) },
    ...Array.from({ length: 43 }, (_, i) => ({
      code: `FILL-${String(i).padStart(2, "0")}`,
      quantity: i === 0 ? 100 : 10,
      expiryDate: day(10),
    })),
  ];
  for (const [i, part] of [lots.slice(0, 40), lots.slice(40)].entries()) {
    const qty = part.reduce((n, l) => n + l.quantity, 0);
    await post("/market-accounting/purchase", {
      partyId: supplier.id,
      reference: `DEMO-SKT-REPORT-${i}`,
      dueDate: today,
      expectedTotalMinor: qty * 600,
      lines: [
        {
          productId: tracked,
          quantity: qty,
          unitNetMinor: 500,
          vatBps: 2000,
          lots: part,
        },
      ],
    });
  }
  for (const [code, date] of [
    ["HOLD", day(20)],
    ["EXPIRED", day(-1)],
    ["UNKNOWN", null],
  ] as const) {
    const s = await lotState(),
      l = s.lots.find((l: any) => l.productId === tracked && l.code === code);
    await post("/market-accounting/inventory/lot-status", {
      ...(await preview()),
      lotId: l.id,
      code,
      expiryDate: date,
      status: "QUARANTINE",
      inspectionAccepted: true,
      reason: `DEMO ${code} fizikî kontrol açıklaması`,
    });
  }
  const control = (
    params: Record<string, string> = {},
    a = owner,
    status = 200
  ) =>
    api(
      `/market-accounting/reports/lot-control?${new URLSearchParams({ stationId: station, ...params })}`,
      a,
      undefined,
      status
    );
  const history = (
    params: Record<string, string> = {},
    a = owner,
    status = 200
  ) =>
    api(
      `/market-accounting/reports/inventory-losses?${new URLSearchParams({ stationId: station, from: today, to: today, ...params })}`,
      a,
      undefined,
      status
    );
  const before = physical(await account()),
    c = await control();
  assert.equal(c.totals.lots, 51);
  assert.equal(c.rows.length, 50);
  assert.ok(c.nextCursor);
  assert.deepEqual(c.totals, {
    lots: 51,
    products: 1,
    near7: 2,
    near15: 46,
    near30: 47,
    expired: 1,
    quarantine: 3,
    unknown: 1,
    blocked: 3,
  });
  const cp = await control({ cursor: c.nextCursor, snapshot: c.snapshot });
  assert.equal(cp.rows.length, 1);
  assert.equal(new Set([...c.rows, ...cp.rows].map(l => l.id)).size, 51);
  assert.equal((await control({ mode: "NEAR", horizon: "7" })).matched, 2);
  assert.equal((await control({ mode: "NEAR", horizon: "15" })).matched, 46);
  assert.equal((await control({ mode: "NEAR", horizon: "30" })).matched, 47);
  assert.equal((await control({ mode: "EXPIRED" })).matched, 1);
  assert.equal((await control({ mode: "UNKNOWN" })).matched, 1);
  const held = await control({ mode: "QUARANTINE" });
  assert.equal(held.matched, 3);
  assert.ok(
    held.rows.every((l: any) => l.lastStatusReason.includes("fizikî kontrol"))
  );
  assert.equal((await control({ search: "TODAY" })).rows[0].daysLeft, 0);
  assert.equal(physical(await account()), before);
  const s = await lotState(),
    fireLot = s.lots.find(
      (l: any) => l.productId === tracked && l.code === "FILL-00"
    ),
    countLot = s.lots.find(
      (l: any) => l.productId === tracked && l.code === "FILL-01"
    );
  async function adjust(lotId: string, mode: string, n: number, unit = 0) {
    const s = await lotState(),
      pr = s.products.find((r: any) => r.id === tracked),
      l = s.lots.find((r: any) => r.id === lotId),
      delta = mode === "WRITE_OFF" ? -n : n - l.quantity;
    return post("/market-accounting/inventory/lot-adjust", {
      ...(await preview()),
      lotId,
      mode,
      ...(mode === "WRITE_OFF" ? { quantity: n } : { countedQty: n }),
      unitNetMinor: unit,
      expectedCostMinor:
        delta > 0
          ? delta * unit
          : Math.round((pr.valueMinor * -delta) / pr.quantity),
    });
  }
  const firstBody = {
    stationId: station,
    requestId: randomUUID(),
    ...(await preview()),
    lotId: fireLot.id,
    mode: "WRITE_OFF",
    quantity: 1,
    expectedCostMinor: 500,
  };
  const first = await api(
    "/market-accounting/inventory/lot-adjust",
    owner,
    firstBody
  );
  assert.deepEqual(
    await api("/market-accounting/inventory/lot-adjust", owner, firstBody),
    first
  );
  await control({ cursor: c.nextCursor, snapshot: c.snapshot }, owner, 409);
  for (let i = 0; i < 50; i++) await adjust(fireLot.id, "WRITE_OFF", 1);
  await adjust(countLot.id, "COUNT", 8);
  await adjust(countLot.id, "COUNT", 11, 600);
  let ac = await account(),
    pCard = ac.stock.find((r: any) => r.id === p);
  await post("/market-accounting/stock-adjust", {
    productId: p,
    expectedQty: pCard.quantity,
    countedQty: pCard.quantity - 1,
    description: "DEMO masaüstü stok eksiği",
  });
  await post("/market-accounting/inventory/device-register", {
    name: "DEMO rapor terminali",
    model: "Tarayıcı",
    platform: "WINDOWS",
  });
  await post("/market-accounting/inventory/device-approve", {
    deviceId: owner.device,
    enabled: true,
  });
  const draft = (
    await post("/market-accounting/inventory/draft-create", {
      kind: "COUNT",
      label: "DEMO çok ürünlü rapor sayımı",
    })
  ).id;
  const detail = () =>
    api(
      `/market-accounting/inventory/draft?${new URLSearchParams({ stationId: station, draftId: draft })}`
    );
  let d = await detail();
  ac = await account();
  pCard = ac.stock.find((r: any) => r.id === p);
  const q = ac.stock.find(
    (r: any) => r.id !== p && r.barcode.startsWith("DEMO-R-")
  );
  await post("/market-accounting/inventory/draft-scan", {
    draftId: draft,
    draftVersion: d.version,
    barcode: pCard.barcode,
    quantity: pCard.quantity - 1,
    mode: "SET",
  });
  d = await detail();
  await post("/market-accounting/inventory/draft-scan", {
    draftId: draft,
    draftVersion: d.version,
    barcode: q.barcode,
    quantity: q.quantity + 1,
    mode: "SET",
  });
  d = await detail();
  const terminal = await post("/market-accounting/inventory/count-post", {
    draftId: draft,
    draftVersion: d.version,
    expectedRevision: d.revision,
    reason: "DEMO terminal karma sayım",
    unitCosts: [{ productId: q.id, unitNetMinor: 50 }],
    expectedGainMinor: 50,
    expectedLossMinor: 500,
  });
  const h = await history();
  assert.equal(h.totals.entries, 55);
  assert.equal(h.totals.productRows, 56);
  assert.equal(h.totals.writeOffMinor, 25500);
  assert.equal(h.totals.countGainMinor, 1850);
  assert.equal(h.totals.countLossMinor, 2000);
  assert.equal(h.rows.length, 50);
  const hp = await history({ asOf: h.asOf, cursor: h.nextCursor });
  assert.equal(hp.rows.length, 6);
  assert.equal(
    new Set([...h.rows, ...hp.rows].map(r => r.entryId + ":" + r.productId))
      .size,
    56
  );
  assert.equal(
    (await history({ kind: "WRITE_OFF" })).totals.writeOffMinor,
    25500
  );
  const pOnly = await history({ productId: p });
  assert.equal(pOnly.totals.productRows, 2);
  assert.equal(pOnly.totals.countGainMinor, 0);
  assert.equal(pOnly.totals.countLossMinor, 1000);
  const qOnly = await history({ productId: q.id });
  assert.equal(qOnly.totals.countGainMinor, 50);
  assert.equal(qOnly.totals.countLossMinor, 0);
  const inventory = (
    await api("/market-accounting/inventory?stationId=" + station)
  ).items.find((r: any) => r.id === p);
  await post("/market-accounting/inventory/product", {
    productId: p,
    name: "DEMO sayım sonrası ad",
    category: inventory.category,
    brand: inventory.brand,
    unit: inventory.unit,
    shelf: inventory.shelf,
    supplierId: inventory.supplierId,
    minimumQty: inventory.minimumQty,
    maximumQty: inventory.maximumQty,
    leadDays: inventory.leadDays,
    reviewDays: inventory.reviewDays,
    safetyDays: inventory.safetyDays,
    orderPackQty: inventory.orderPackQty,
    purchaseVatBps: inventory.purchaseVatBps,
  });
  const named = await history({ productId: p });
  assert.equal(
    named.rows.find((r: any) => r.kind === "STOCK_ADJUST").name,
    "DEMO sayım sonrası ad"
  );
  assert.equal(
    named.rows.find((r: any) => r.kind === "STOCK_ADJUST").labelSource,
    "CURRENT_CARD"
  );
  assert.equal(
    named.rows.find((r: any) => r.kind === "STOCK_COUNT").name,
    "DEMO güncel kart adı"
  );
  assert.equal(
    named.rows.find((r: any) => r.kind === "STOCK_COUNT").labelSource,
    "SNAPSHOT"
  );
  const current = await lotState(),
    cl = current.lots.find((l: any) => l.id === countLot.id);
  await post("/market-accounting/inventory/lot-status", {
    ...(await preview()),
    lotId: cl.id,
    code: "FILL-01-YENI",
    expiryDate: cl.expiryDate,
    status: cl.status,
    inspectionAccepted: true,
    reason: "DEMO son parti etiketi kontrolü",
  });
  const rh = await history({ productId: tracked });
  assert.ok(
    rh.rows.some(
      (r: any) =>
        r.kind === "LOT_COUNT" &&
        r.lots[0].code === "FILL-01-YENI" &&
        r.lots[0].labelSource === "CURRENT_CARD"
    )
  );
  await adjust(fireLot.id, "WRITE_OFF", 1);
  assert.deepEqual((await history({ asOf: h.asOf })).totals, h.totals);
  const final = await history();
  assert.equal(final.totals.entries, 56);
  assert.equal(final.totals.productRows, 57);
  assert.equal(final.totals.writeOffMinor, 26001);
  await control({}, manager);
  await history({}, manager);
  await control({}, staff, 403);
  await history({}, staff, 403);
  await control({}, outsider, 403);
  await history({}, outsider, 403);
  await control({ horizon: "8" }, owner, 400);
  await control({ productId: p }, owner, 404);
  await history({ productId: randomUUID() }, owner, 404);
  await history({ cursor: "bad", asOf: final.asOf }, owner, 400);
  await history({ asOf: "18446744073709551615" }, owner, 400);
  const stable = physical(await account());
  await control();
  await history();
  assert.equal(physical(await account()), stable);
  const [[saved]]: any = await sql.query(
    "SELECT payload_json FROM st_market_entries WHERE id=?",
    [first.id]
  );
  const original =
      typeof saved.payload_json === "string"
        ? saved.payload_json
        : JSON.stringify(saved.payload_json),
    bad = JSON.parse(original);
  bad.valueMinor++;
  await sql.execute("UPDATE st_market_entries SET payload_json=? WHERE id=?", [
    JSON.stringify(bad),
    first.id,
  ]);
  try {
    await history({}, owner, 409);
  } finally {
    await sql.execute(
      "UPDATE st_market_entries SET payload_json=? WHERE id=?",
      [original, first.id]
    );
  }
  const [[term]]: any = await sql.query(
    "SELECT payload_json FROM st_market_entries WHERE id=?",
    [terminal.id]
  );
  const termOriginal =
      typeof term.payload_json === "string"
        ? term.payload_json
        : JSON.stringify(term.payload_json),
    legacy = JSON.parse(termOriginal);
  delete legacy.countReportVersion;
  await sql.execute("UPDATE st_market_entries SET payload_json=? WHERE id=?", [
    JSON.stringify(legacy),
    terminal.id,
  ]);
  try {
    assert.equal(
      (await history({ productId: p })).rows.find(
        (r: any) => r.kind === "STOCK_COUNT"
      ).labelSource,
      "CURRENT_CARD"
    );
  } finally {
    await sql.execute(
      "UPDATE st_market_entries SET payload_json=? WHERE id=?",
      [termOriginal, terminal.id]
    );
  }
  await sql.execute(
    "UPDATE st_inventory_lots SET quantity=quantity+1 WHERE id=?",
    [fireLot.id]
  );
  try {
    await control({}, owner, 409);
  } finally {
    await sql.execute(
      "UPDATE st_inventory_lots SET quantity=quantity-1 WHERE id=?",
      [fireLot.id]
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
  ac = await account();
  await post("/market-accounting/day-close", {
    expectedRevision: ac.revision,
    countedCashMinor: ac.balances.CASH_SAFE,
  });
  const closed = physical(await account());
  await control();
  await history();
  assert.equal(physical(await account()), closed);
  const output =
    process.env.SMOKE_OUTPUT_DIR ?? "/workspace/lot-control-test/checks-dev";
  await mkdir(output, { recursive: true, mode: 0o700 });
  await writeFile(
    output + "/fixture.json",
    JSON.stringify({
      ...f,
      tracked,
      fireLot: fireLot.id,
      countLot: countLot.id,
      q: q.id,
    }),
    { mode: 0o600 }
  );
  const checks = [
    "51 stoklu parti, 7/15/30 ve bugün/geçmiş/bilinmeyen SKT/karantina",
    "Son durum nedeni, parti/ürün/mali miktar mutabakatı ve eski sayfayı reddetme",
    "Gerçek 52 fire/parti sayımı/masaüstü/çok ürünlü terminal sayımı",
    "Fiş/ürün bazında 50+7 sayfalama ve ürün filtresinde doğru mali tutar",
    "Tarihî terminal etiketi ve eski doğrudan kayıtta güncel etiket ayrımı",
    "Mali asOf, same-ID tek fire, bozuk geçmiş/miktar reddi ve eski sayım uyumu",
    "Rol/tenant/girdi koruması; GET ve kapalı gün stok/bakiye/revizyon/kapanış değişmedi",
  ];
  await writeFile(
    output + "/result.json",
    JSON.stringify({ ok: true, checks }, null, 2)
  );
  console.log(JSON.stringify({ ok: true, checks }, null, 2));
} finally {
  await sql.end();
}

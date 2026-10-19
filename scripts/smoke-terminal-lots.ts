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
    companyName: `DEMO parti sayım testi ${randomUUID().slice(0, 8)}`,
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
const { catalogHeaders } = await import("../shared/catalog-import");
const text =
  catalogHeaders.join("\t") +
  "\n" +
  [
    [
      "DEMO-C-P",
      "DEMO sayım ürünü",
      "001234567001",
      "DEMO",
      "-10",
      "ADET",
      "3,00",
      "1,00",
      "0",
    ],
    [
      "DEMO-C-Q",
      "DEMO diğer ürün",
      "001234567002",
      "DEMO",
      "-3",
      "ADET",
      "3,00",
      "1,00",
      "0",
    ],
  ]
    .map(r => r.join("\t"))
    .join("\n");
const settings = { mode: "DEMO_OPENING_ABS", vatByGroup: { DEMO: 100 } };
const preview = await raw(
  "/market-accounting/inventory/catalog-preview",
  owner,
  { stationId: station, text, settings }
);
await lp("catalog-import", {
  text,
  label: "DEMO sayım açılışı",
  settings,
  expectedHash: preview.hash,
  netCostsAccepted: true,
  demoOpeningAccepted: true,
});
await post("/market-accounting/start", {
  openingStockAccepted: true,
  expectedInventoryMinor: (await account()).openingInventoryMinor,
  cashMinor: 0,
  bankMinor: 0,
  cardMinor: 0,
});
const inventory = () =>
  raw("/market-accounting/inventory?stationId=" + station);
const items = (await inventory()).items;
const p = items.find((x: any) => x.catalogCode === "DEMO-C-P").id,
  q = items.find((x: any) => x.catalogCode === "DEMO-C-Q").id;
const today = (await account()).today;
for (const [id, lots] of [
  [
    p,
    [
      { code: "DEMO-A", expiryDate: today, quantity: 4 },
      { code: "DEMO-B", expiryDate: null, quantity: 4 },
      { code: "DEMO-C", expiryDate: today, quantity: 2 },
    ],
  ],
  [q, [{ code: "DEMO-Q", expiryDate: today, quantity: 3 }]],
] as const) {
  const prod = (await lotState()).products.find((x: any) => x.id === id);
  await lp("lot-enable", {
    productId: id,
    expectedRevision: (await account()).revision,
    expectedVersion: prod.stockVersion,
    reason: "DEMO fizikî parti eşleştirmesi",
    lots,
  });
}
const terminal = (a = owner) =>
  raw("/market-accounting/inventory/terminal?stationId=" + station, a);
const detail = (id: string, a = owner) =>
  raw(
    `/market-accounting/inventory/draft?stationId=${station}&draftId=${id}`,
    a
  );
for (const a of [owner, manager, staff])
  await lp(
    "device-register",
    {
      name: "DEMO " + a.device.slice(0, 6),
      model: "TC73 tarayıcı",
      platform: "ANDROID",
    },
    200,
    a
  );
await lp("device-approve", { deviceId: staff.device, enabled: true });
const create = async (a = staff) =>
  (
    await lp(
      "draft-create",
      { kind: "COUNT", label: "DEMO parti sayımı" },
      200,
      a
    )
  ).id;
let draft = await create();
const line = (d: any, id = p) => d.lines.find((x: any) => x.productId === id);
const lot = (d: any, code: string) =>
  line(d).lots.find((x: any) => x.code === code);
let d = await detail(draft),
  A = lot(d, "DEMO-A").id,
  B = lot(d, "DEMO-B").id,
  C = lot(d, "DEMO-C").id,
  Q = line(d, q).lots[0].id;
assert.equal(line(d).lotCounting, true);
assert.equal(line(d).lots.length, 3);
await raw(
  `/market-accounting/inventory/draft?stationId=${station}&draftId=${draft}`,
  outsider,
  undefined,
  403
);
const hidden = await detail(draft, staff);
assert.equal(line(hidden).baselineQty, null);
assert.equal(line(hidden).currentValueMinor, null);
assert.equal(
  line(hidden).lots.every(
    (l: any) => l.currentQty === null && l.baselineQty === null
  ),
  true
);
const scan = async (
  lotId: string | undefined,
  quantity: number,
  extra: Record<string, unknown> = {},
  status = 200,
  a = staff
) =>
  lp(
    "draft-scan",
    {
      draftId: draft,
      draftVersion: (await detail(draft)).version,
      barcode: "001234567001",
      quantity,
      mode: "SET",
      ...(lotId ? { lotId } : {}),
      ...extra,
    },
    status,
    a
  );
await scan(undefined, 2, {}, 409);
await scan(Q, 2, {}, 409);
await lp("device-approve", { deviceId: staff.device, enabled: false });
await scan(A, 2, {}, 403);
await lp("device-approve", { deviceId: staff.device, enabled: true });
await scan(A, 2);
assert.equal(line(await detail(draft, staff)).countedQty, 2); // must not reveal projected total (8).
const ver = (await detail(draft)).version;
const race = await Promise.all(
  [staff, manager].map(a =>
    http("/api/stationos/market-accounting/inventory/draft-scan", a, {
      stationId: station,
      requestId: randomUUID(),
      draftId: draft,
      draftVersion: ver,
      barcode: "001234567001",
      lotId: B,
      quantity: 1,
      mode: "ADD",
    })
  )
);
assert.deepEqual(race.map(r => r.status).sort(), [200, 409]);
await scan(B, 6);
const parallelDraft = await create(owner);
const before = await account();
const request = {
  stationId: station,
  requestId: randomUUID(),
  draftId: draft,
  draftVersion: (await detail(draft)).version,
  expectedRevision: before.revision,
  reason: "DEMO iki partinin sayım farkı",
  unitCosts: [{ productId: p, unitNetMinor: 150 }],
  expectedGainMinor: 300,
  expectedLossMinor: 200,
};
await raw("/market-accounting/inventory/count-post", staff, request, 403);
await raw(
  "/market-accounting/inventory/count-post",
  owner,
  { ...request, requestId: randomUUID(), expectedLossMinor: 201 },
  409
);
assert.equal((await lotState()).lots.find((x: any) => x.id === A).quantity, 4);
const posted = await raw(
  "/market-accounting/inventory/count-post",
  owner,
  request
);
assert.deepEqual(
  await raw("/market-accounting/inventory/count-post", owner, request),
  posted
);
const after = await account(),
  ls = await lotState(),
  pi = (await inventory()).items.find((x: any) => x.id === p);
assert.equal(pi.quantity, 10);
assert.equal(line(await detail(parallelDraft)).stockChanged, true);
assert.equal(line(await detail(parallelDraft), q).stockChanged, false);
assert.equal(pi.valueMinor, 1100);
assert.equal(ls.lots.find((x: any) => x.id === A).quantity, 2);
assert.equal(ls.lots.find((x: any) => x.id === B).quantity, 6);
assert.equal(ls.lots.find((x: any) => x.id === C).quantity, 2);
assert.equal(ls.lots.find((x: any) => x.id === B).status, "QUARANTINE");
assert.equal(
  after.balances.STOCK_GAIN - (before.balances.STOCK_GAIN ?? 0),
  -300
);
assert.equal(
  after.balances.STOCK_LOSS - (before.balances.STOCK_LOSS ?? 0),
  200
);
assert.equal(after.stockValueMinor, before.stockValueMinor + 100);
const sql = await mysql.createConnection(process.env.DATABASE_URL!);
// Simulate a persisted pre-0017 draft: migration must not turn its total into a lot allocation.
draft = await create();
await sql.query(
  "DELETE FROM st_inventory_draft_lots WHERE draft_id=? AND product_id=?",
  [draft, p]
);
await sql.query(
  "UPDATE st_inventory_draft_lines SET lot_counting=FALSE WHERE draft_id=? AND product_id=?",
  [draft, p]
);
await scan(undefined, 9);
await lp(
  "count-post",
  {
    draftId: draft,
    draftVersion: (await detail(draft)).version,
    expectedRevision: (await account()).revision,
    reason: "DEMO eski toplam sayımı partiye dağıtamaz",
    unitCosts: [],
    expectedGainMinor: 0,
    expectedLossMinor: 110,
  },
  409
);
// Another draft with the same total must still become stale after a party-only move.
draft = await create();
await scan(A, 1);
const state = await lotState(),
  prod = state.products.find((x: any) => x.id === p);
await lp("lot-status", {
  productId: p,
  lotId: B,
  expectedRevision: (await account()).revision,
  expectedVersion: prod.stockVersion,
  code: "DEMO-B",
  expiryDate: null,
  status: "QUARANTINE",
  inspectionAccepted: true,
  reason: "DEMO fizikî durum tekrar kontrolü",
});
await scan(A, 1, {}, 409);
await lp(
  "count-post",
  {
    draftId: draft,
    draftVersion: (await detail(draft)).version,
    expectedRevision: (await account()).revision,
    reason: "DEMO eski stok onayı reddi",
    unitCosts: [],
    expectedGainMinor: 0,
    expectedLossMinor: 110,
  },
  409
);
await lp(
  "draft-rebase",
  {
    draftId: draft,
    draftVersion: (await detail(draft)).version,
    productId: p,
    reason: "DEMO bütün partiler yeniden sayılacak",
  },
  200,
  staff
);
d = await detail(draft, staff);
assert.equal(line(d).countedQty, null);
assert.equal(
  line(d).lots.every((x: any) => x.countedQty === null),
  true
);
assert.equal(d.events.find((x: any) => x.action === "REBASE").beforeQty, null);
await scan(A, 0);
let current = await account();
await lp("count-post", {
  draftId: draft,
  draftVersion: (await detail(draft)).version,
  expectedRevision: current.revision,
  reason: "DEMO sıfır parti sayımı",
  unitCosts: [],
  expectedGainMinor: 0,
  expectedLossMinor: 220,
});
assert.equal((await lotState()).lots.find((x: any) => x.id === A).quantity, 0);
// Zero-cost gain from the same existing zero-quantity lot requires explicit acceptance.
draft = await create();
await scan(A, 1);
current = await account();
const zp = {
  draftId: draft,
  draftVersion: (await detail(draft)).version,
  expectedRevision: current.revision,
  reason: "DEMO sıfır maliyetli parti fazlası",
  unitCosts: [{ productId: p, unitNetMinor: 0 }],
  expectedGainMinor: 0,
  expectedLossMinor: 0,
};
await lp("count-post", zp, 409);
await lp("count-post", { ...zp, zeroCostAccepted: true });
// Stale source versions, not just totals: audit has per-lot actor/device and signed stock movements.
const [events]: any = await sql.query(
  "SELECT detail_json FROM st_inventory_lot_events WHERE product_id=? AND kind='TERMINAL_COUNT'",
  [p]
);
assert.equal(events.length, 4);
const [moves]: any = await sql.query(
  "SELECT quantity FROM st_stock_movements WHERE product_id=? AND reference LIKE 'LOTCOUNT:%'",
  [p]
);
assert.deepEqual(
  moves
    .map((x: any) => Number(x.quantity))
    .sort((a: number, b: number) => a - b),
  [-2, -2, 1, 2]
);
const [balance]: any = await sql.query(
  "SELECT SUM(l.debit_minor-l.credit_minor) AS diff FROM st_market_lines l JOIN st_market_entries e ON e.id=l.entry_id WHERE e.station_id=?",
  [station]
);
assert.equal(Number(balance[0].diff), 0);
await sql.end();
// Leave a shared open count fixture for browser checks, optionally close for full HTTP checks.
draft = await create();
if (process.env.SMOKE_LEAVE_OPEN !== "1") {
  current = await account();
  await post("/market-accounting/day-close", {
    expectedRevision: current.revision,
    countedCashMinor: 0,
  });
  await scan(B, 5);
  current = await account();
  await lp(
    "count-post",
    {
      draftId: draft,
      draftVersion: (await detail(draft)).version,
      expectedRevision: current.revision,
      reason: "DEMO kapalı güne mali onay reddi",
      unitCosts: [],
      expectedGainMinor: 0,
      expectedLossMinor: 0,
    },
    409
  );
}
const output =
  process.env.SMOKE_OUTPUT_DIR ?? "/workspace/terminal-lot-test/dev";
await mkdir(output, { recursive: true, mode: 0o700 });
await writeFile(
  output + "/fixture.json",
  JSON.stringify({
    owner,
    manager,
    staff,
    outsider,
    station,
    draft,
    p,
    q,
    A,
    B,
    C,
    Q,
  }),
  { mode: 0o600 }
);
const checks = [
  "Rol/tenant, onaylı cihaz ve personelden stok/maliyet gizleme",
  "Gerçek parti seçimi, farklı ürüne ait parti reddi, paralel sürüm yarışı",
  "Aynı SKU sıfır net adette ayrı fazla/eksik ve net değer, sayılmayan partiyi koruma",
  "Yanlış maliyet önizlemesinde bütün lot/stok/fiş rollback",
  "Aynı ID tek kayıt ve parti/aktör/cihaz olay izi",
  "Stok/durum değişiminde eski sayımı engelleme, açıklamalı tüm partileri yeniden sayma",
  "SET 0, mevcut sıfır partiye sıfır maliyetli fazlalık teyidi, karantinayı koruma",
  "Parti/ürün/maliyet ve dengeli defter mutabakatı",
  ...(process.env.SMOKE_LEAVE_OPEN === "1"
    ? []
    : ["Kapalı günde sayım toplama açık; mali onay kapalı"]),
];
await writeFile(
  output + "/result.json",
  JSON.stringify({ ok: true, checks }, null, 2)
);
console.log(JSON.stringify({ ok: true, checks }, null, 2));

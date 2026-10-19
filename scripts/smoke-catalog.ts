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
    companyName: `DEMO katalog testi ${randomUUID().slice(0, 8)}`,
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
const prefix = "/market-accounting/inventory/",
  account = () => raw("/market-accounting?stationId=" + station);
for (const [a, role] of [
  [staff, "MARKET_STAFF"],
  [manager, "MANAGER"],
] as const) {
  const code = (await post("/invite", { role, stationIds: [station] })).code;
  await raw("/join", a, { requestId: randomUUID(), code });
}
const { catalogHeaders } = await import("../shared/catalog-import");
const row = (
  code: string,
  barcode: string,
  qty = -2,
  name = "DEMO kaynak ürün"
) =>
  [
    code,
    name,
    barcode,
    "DEMO GRUP",
    String(qty),
    "ADET",
    "50,00",
    "20,40",
    "0",
  ].join("\t");
const existing = (
  await post("/product", {
    name: "DEMO korunacak mevcut fiyat",
    barcode: "88881111",
    minimumQty: 0,
    purchasePriceMinor: 0,
    salePriceMinor: 777,
    supplierId: null,
  })
).id;
const text =
  catalogHeaders.join("\t") +
  "\n" +
  [
    row("ST-T-1", "001234567890"),
    row("ST-T-2", "88881111"),
    row("ST-T-3", "8690000000001", -3),
  ].join("\n");
const inspect = (value = text, a = owner) =>
  raw(prefix + "catalog-preview", a, { stationId: station, text: value });
await raw(prefix + "catalog-preview", staff, { stationId: station, text }, 403);
await raw(
  prefix + "catalog-preview",
  outsider,
  { stationId: station, text },
  403
);
await raw(
  prefix + "catalog-preview",
  owner,
  { stationId: station, text: "başlık yok" },
  400
);
let p = await inspect();
assert.equal(p.added, 2);
assert.equal(p.skipped, 1);
assert.equal(p.negativeRows, 3);
assert.equal(p.sourceTotalQty, -7);
await post("/product", {
  name: "DEMO katalog sürüm değişimi",
  barcode: "99992222",
  minimumQty: 0,
  purchasePriceMinor: 0,
  salePriceMinor: 333,
  supplierId: null,
});
await raw(
  prefix + "catalog-preview",
  { ...owner, csrf: "" },
  { stationId: station, text },
  403
);
const apply = (preview: any, extra: Record<string, unknown> = {}) => ({
  text,
  label: "DEMO kaynak liste",
  expectedHash: preview.hash,
  catalogOnlyAccepted: true,
  ...extra,
});
await post(prefix + "catalog-import", apply(p), 409);
p = await inspect();
await post(
  prefix + "catalog-import",
  apply(p, { catalogOnlyAccepted: false }),
  409
);
await post(prefix + "catalog-import", apply(p), 403, staff);
const before = await account();
const both = await Promise.all(
  [owner, manager].map(a =>
    raw(prefix + "catalog-import", a, {
      stationId: station,
      requestId: randomUUID(),
      ...apply(p),
    })
  )
);
assert.equal(both[0].result.id, both[1].result.id);
let state = await account();
assert.deepEqual(state.balances, before.balances);
assert.equal(state.stockValueMinor, before.stockValueMinor);
assert.equal(
  state.stock.find((x: any) => x.id === existing).salePriceMinor,
  777
);
const inventory = await raw(
  "/market-accounting/inventory?stationId=" + station
);
const item = inventory.items.find((x: any) => x.catalogCode === "ST-T-1");
assert.equal(item.barcode, "001234567890");
assert.equal(item.quantity, 0);
assert.equal(item.averageCostMinor, 0);
assert.equal(item.vatBps, null);
assert.equal(item.purchaseVatBps, null);
assert.equal(item.salePriceMinor, 5000);
assert.equal(item.category, "DEMO GRUP");
assert.equal(item.lotTracking, false);
const history = await raw(prefix + "catalog-history?stationId=" + station);
assert.equal(history.length, 1);
assert.equal(history[0].added, 2);
assert.equal(history[0].negativeRows, 3);
assert.equal(history[0].sourceTotalQty, -7);
assert.equal((await inspect()).alreadyImported, true);
const conflict =
  catalogHeaders.join("\t") + "\n" + row("ST-T-1", "1234567890123");
const cp = await inspect(conflict);
assert.equal(cp.conflicts, 1);
await post(prefix + "catalog-import", { ...apply(cp), text: conflict }, 409);
const demoSettings = {
  mode: "DEMO_OPENING_ABS",
  vatByGroup: { "DEMO GRUP": 1000 },
};
const demoText =
  catalogHeaders.join("\t") + "\n" + row("DEMO-PRE", "0011112222333", -4);
const demoInspect = (value = demoText, settings: unknown = demoSettings) =>
  raw(prefix + "catalog-preview", owner, {
    stationId: station,
    text: value,
    settings,
  });
const demoApply = (
  p: any,
  value = demoText,
  settings: unknown = demoSettings
) => ({
  text: value,
  label: "DEMO net başlangıç",
  settings,
  expectedHash: p.hash,
  demoOpeningAccepted: true,
  netCostsAccepted: true,
});
let dp = await demoInspect(demoText, { mode: "DEMO_OPENING_ABS" });
assert.deepEqual(dp.missingVatGroups, ["DEMO GRUP"]);
await post(
  prefix + "catalog-import",
  demoApply(dp, demoText, { mode: "DEMO_OPENING_ABS" }),
  409
);
dp = await demoInspect();
assert.equal(dp.plannedQty, 4);
assert.equal(dp.plannedInventoryMinor, 8160);
await post(
  prefix + "catalog-import",
  { ...demoApply(dp), netCostsAccepted: false },
  409
);
await post(
  prefix + "catalog-import",
  {
    ...demoApply(dp),
    settings: { mode: "DEMO_OPENING_ABS", vatByGroup: { "DEMO GRUP": 2000 } },
  },
  409
);
const pre = (await account()).openingInventoryMinor;
await post(prefix + "catalog-import", demoApply(dp));
assert.equal((await account()).openingInventoryMinor, pre + 8160);
const dpi = (
  await raw("/market-accounting/inventory?stationId=" + station)
).items.find((x: any) => x.catalogCode === "DEMO-PRE");
assert.equal(dpi.quantity, 4);
assert.equal(dpi.averageCostMinor, 2040);
assert.equal(dpi.vatBps, 1000);
assert.equal(dpi.purchaseVatBps, 1000);
// Identical source may never be upgraded from metadata-only to opening stock.
const priorPlan = await demoInspect(text);
await post(prefix + "catalog-import", demoApply(priorPlan, text), 409);
await post("/market-accounting/start", {
  openingStockAccepted: true,
  expectedInventoryMinor: (await account()).openingInventoryMinor,
  cashMinor: 0,
  bankMinor: 0,
  cardMinor: 0,
});
state = await account();
const saved = JSON.stringify({
  balances: state.balances,
  daily: state.daily,
  revision: state.revision,
});
const newText =
    catalogHeaders.join("\t") + "\n" + row("ST-T-4", "0022223333444", -1),
  np = await inspect(newText),
  request = {
    stationId: station,
    requestId: randomUUID(),
    ...apply(np),
    text: newText,
  };
const result = await raw(prefix + "catalog-import", owner, request);
assert.deepEqual(await raw(prefix + "catalog-import", owner, request), result);
state = await account();
assert.equal(
  JSON.stringify({
    balances: state.balances,
    daily: state.daily,
    revision: state.revision,
  }),
  saved
);
const liveText =
  catalogHeaders.join("\t") + "\n" + row("DEMO-LIVE", "0011112222444", -3);
const lp = await demoInspect(liveText),
  liveBefore = await account();
const liveRequest = {
  stationId: station,
  requestId: randomUUID(),
  ...demoApply(lp, liveText),
};
const results = await Promise.all([
  raw(prefix + "catalog-import", owner, liveRequest),
  raw(prefix + "catalog-import", manager, {
    ...liveRequest,
    requestId: randomUUID(),
  }),
]);
assert.equal(results[0].result.id, results[1].result.id);
assert.deepEqual(
  await raw(prefix + "catalog-import", owner, liveRequest),
  results[0]
);
state = await account();
assert.equal(state.stockValueMinor, liveBefore.stockValueMinor + 6120);
assert.equal(
  state.balances.INVENTORY,
  (liveBefore.balances.INVENTORY ?? 0) + 6120
);
assert.equal(state.balances.OPENING, (liveBefore.balances.OPENING ?? 0) - 6120);
for (const key of [
  "STOCK_GAIN",
  "SALES",
  "INPUT_VAT",
  "PAYABLE",
  "CASH_SAFE",
  "BANK",
])
  assert.equal(state.balances[key] ?? 0, liveBefore.balances[key] ?? 0);
assert.deepEqual(state.daily, liveBefore.daily);
assert.equal(state.revision, liveBefore.revision + 1);
await post("/market-accounting/day-close", {
  expectedRevision: state.revision,
  countedCashMinor: 0,
});
const closed = await account();
const closedSnapshot = JSON.stringify(closed.dayCloses);
const closedText =
    catalogHeaders.join("\t") + "\n" + row("ST-T-5", "0022223333555", -1),
  closedPreview = await inspect(closedText);
await post(prefix + "catalog-import", {
  ...apply(closedPreview),
  text: closedText,
});
assert.equal((await account()).closedToday, true);
assert.equal(JSON.stringify((await account()).dayCloses), closedSnapshot);
const sql = await mysql.createConnection(process.env.DATABASE_URL!);
const [stored]: any = await sql.query(
  "SELECT source_rows_json FROM st_catalog_imports WHERE station_id=? ORDER BY created_at,id",
  [station]
);
const source =
  typeof stored[0].source_rows_json === "string"
    ? JSON.parse(stored[0].source_rows_json)
    : stored[0].source_rows_json;
assert.equal(source.find((r: any) => r.code === "ST-T-1").sourceQuantity, -2);
assert.equal(
  source.find((r: any) => r.code === "ST-T-1").sourcePurchaseMinor,
  2040
);
const [bad]: any = await sql.query(
  "SELECT id FROM st_products WHERE station_id=? AND catalog_code LIKE 'ST-T-%' AND (stock_qty<>0 OR purchase_price_minor<>0 OR market_vat_bps IS NOT NULL)",
  [station]
);
assert.equal(bad.length, 0);
const openingHistory = await raw(
  prefix + "catalog-history?stationId=" + station
);
assert.equal(
  openingHistory.filter((h: any) => h.mode === "DEMO_OPENING_ABS").length,
  2
);
assert.equal(
  openingHistory.find((h: any) => h.openingQty === 3).inventoryMinor,
  6120
);
const blockedText =
  catalogHeaders.join("\t") + "\n" + row("DEMO-BLOCK", "0011112222555", -2);
const blocked = await demoInspect(blockedText);
assert.equal(blocked.closedToday, true);
await post(prefix + "catalog-import", demoApply(blocked, blockedText), 409);
assert.equal(JSON.stringify((await account()).dayCloses), closedSnapshot);
await sql.query(
  "UPDATE st_tenants t JOIN st_stations s ON s.tenant_id=t.id SET t.is_demo=0 WHERE s.id=?",
  [station]
);
try {
  await post(prefix + "catalog-import", demoApply(blocked, blockedText), 409);
} finally {
  await sql.query(
    "UPDATE st_tenants t JOIN st_stations s ON s.tenant_id=t.id SET t.is_demo=1 WHERE s.id=?",
    [station]
  );
}
const [missing]: any = await sql.query(
  "SELECT id FROM st_products WHERE station_id=? AND catalog_code='DEMO-BLOCK'",
  [station]
);
assert.equal(missing.length, 0);
const [entries]: any = await sql.query(
  "SELECT e.id,SUM(l.debit_minor) debit,SUM(l.credit_minor) credit FROM st_market_entries e JOIN st_market_lines l ON l.entry_id=e.id WHERE e.station_id=? AND e.kind='DEMO_CATALOG_OPENING' GROUP BY e.id",
  [station]
);
assert.equal(entries.length, 1);
assert.equal(Number(entries[0].debit), 6120);
assert.equal(entries[0].debit, entries[0].credit);
await sql.end();
const output = process.env.SMOKE_OUTPUT_DIR ?? "/workspace/catalog-test/dev";
await mkdir(output, { recursive: true, mode: 0o700 });
await writeFile(
  output + "/fixture.json",
  JSON.stringify({ owner, manager, staff, outsider, station }),
  { mode: 0o600 }
);
const checks = [
  "Sekmeli liste doğrulama, rol/tenant ve CSRF koruması",
  "Yeni kart, baştaki sıfır, kaynak stok kodu ve kategori",
  "Mevcut barkod fiyatı/stoğu değiştirilmedi",
  "Katalog değiştiğinde önizleme yenileme zorunluluğu",
  "Aynı listeyi iki aktör eşzamanlı aktardığında tek parti",
  "Stok kodu farklı barkod çakışması reddi",
  "Defter öncesi ve aktif defterde stok/maliyet/bakiye değişmedi",
  "Kaynak eksi miktar ve alış fiyatı JSON kaynak kaydında korundu",
  "Aynı-ID tekrar ve kapalı gün sonrası yalnız sıfır stoklu yeni kart",
  "Yalnız kart kipinde KDV/lot/SKT ve net maliyet tahmin edilmedi",
  "Artı DEMO stok: net maliyet/KDV, defter öncesi ve sonrası açılış, çift teyit",
  "Grup KDV eksikliği, değişmiş ayarlar ve önceki aktarımı farklı kiple tekrarlama reddi",
  "Eşzamanlı/same-ID tek açılış; INVENTORY/OPENING dengeli, satış/kâr/KDV alacağı yok",
  "Kapalı gün ve gerçek firma stok aktarımı reddi, kapanış snapshot korundu",
];
await writeFile(
  output + "/result.json",
  JSON.stringify({ ok: true, checks }, null, 2)
);
console.log(JSON.stringify({ ok: true, checks }, null, 2));

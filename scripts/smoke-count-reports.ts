import { strict as assert } from "node:assert";
import { randomUUID, createHash } from "node:crypto";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import mysql from "mysql2/promise";
if (process.env.SMOKE_TEST !== "1")
  throw Error("Explicit opt-in required; isolated synthetic DEMO only.");
const base = process.env.SMOKE_BASE_URL ?? "http://127.0.0.1:3303",
  url = new URL(process.env.DATABASE_URL ?? "");
if (
  !["127.0.0.1", "localhost"].includes(new URL(base).hostname) ||
  url.pathname !== "/istasyonos_pos_v2_test" ||
  url.searchParams.get("socketPath") !== "/workspace/local-mysql/mysql.sock"
)
  throw Error("Exact isolated DB/socket and loopback required.");
const f = JSON.parse(
  await readFile(
    process.env.SMOKE_COUNT_FIXTURE ??
      "/workspace/count-report-test/seed-dev/fixture.json",
    "utf8"
  )
);
async function call(
  path: string,
  a = f.owner,
  body?: Record<string, unknown>,
  status = 200
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
  assert.equal(r.status, status, path + ": " + JSON.stringify(d));
  return d.result ?? d;
}
const account = () => call("/market-accounting?stationId=" + f.station),
  detailDraft = (id: string) =>
    call(
      `/market-accounting/inventory/draft?stationId=${f.station}&draftId=${id}`
    ),
  ipost = (path: string, body: Record<string, unknown>) =>
    call("/market-accounting/inventory/" + path, f.owner, {
      stationId: f.station,
      requestId: randomUUID(),
      ...body,
    });
const today = (await account()).today,
  from = today.slice(0, 7) + "-01",
  query = `?stationId=${f.station}&from=${from}&to=${today}`,
  prefix = "/market-accounting/inventory/count-reports";
const list = (suffix = "", a = f.owner) => call(prefix + query + suffix, a),
  detail = (id: string, a = f.owner, status = 200) =>
    call(`${prefix}/${id}?stationId=${f.station}`, a, undefined, status);
let page = await list();
assert.equal(page.totals.reports, 3);
assert.equal(page.totals.gainMinor, 300);
assert.equal(page.totals.lossMinor, 420);
const mixed = page.rows.find(
  (r: any) => r.gainMinor === 300 && r.lossMinor === 200
);
assert.ok(mixed);
const report = await detail(mixed.id);
assert.equal(report.snapshotVersion, 1);
assert.equal(report.items.length, 1);
const row = report.items[0];
assert.equal(row.before, 10);
assert.equal(row.after, 10);
assert.equal(row.delta, 0);
assert.equal(row.netMinor, 100);
assert.equal(row.lots.length, 2);
assert.equal(row.lots.find((l: any) => l.id === f.A).delta, -2);
assert.equal(row.lots.find((l: any) => l.id === f.B).delta, 2);
assert.ok(
  row.lots.every((l: any) => l.countedBy?.id && l.deviceId === f.staff.device)
);
assert.equal(row.name, "DEMO sayım ürünü");
assert.equal(row.labelSource, "SNAPSHOT");
assert.equal(
  (await account()).stock.find((x: any) => x.id === f.p).quantity,
  9
);
for (const a of [f.staff, f.outsider]) {
  await call(prefix + query, a, undefined, 403);
  await detail(mixed.id, a, 403);
}
await list("", f.manager);
await detail(mixed.id, f.manager);
await detail(randomUUID(), f.owner, 404);
await detail(f.draft, f.owner, 404);
await call(
  prefix + `?stationId=${f.station}&from=${today}&to=2000-01-01`,
  f.owner,
  undefined,
  400
);
await call(
  prefix + `?stationId=${f.station}&from=2000-01-01&to=${today}`,
  f.owner,
  undefined,
  400
);
for (const c of ["0", "1.5", "18446744073709551616", "abc"])
  await call(prefix + query + "&cursor=" + c, f.owner, undefined, 400);
const sql = await mysql.createConnection(process.env.DATABASE_URL!);
const [saved]: any = await sql.query(
  "SELECT payload_json FROM st_market_entries WHERE id=?",
  [mixed.id]
);
const payload =
  typeof saved[0].payload_json === "string"
    ? JSON.parse(saved[0].payload_json)
    : saved[0].payload_json;
const [cards]: any = await sql.query(
  "SELECT name FROM st_products WHERE id=? AND station_id=?",
  [f.p, f.station]
);
try {
  await sql.query("UPDATE st_products SET name=? WHERE id=? AND station_id=?", [
    "DEMO sonradan değişen kart",
    f.p,
    f.station,
  ]);
  assert.equal((await detail(mixed.id)).items[0].name, "DEMO sayım ürünü");
  const old = structuredClone(payload);
  delete old.countReportVersion;
  for (const item of old.items) {
    delete item.productName;
    delete item.barcode;
    delete item.unit;
    delete item.countedByUserId;
    delete item.deviceId;
    for (const lot of item.lots ?? []) {
      delete lot.countedByUserId;
      delete lot.deviceId;
    }
  }
  await sql.query("UPDATE st_market_entries SET payload_json=? WHERE id=?", [
    JSON.stringify(old),
    mixed.id,
  ]);
  const legacy = await detail(mixed.id);
  assert.equal(legacy.items[0].labelSource, "CURRENT_CARD");
  assert.equal(legacy.items[0].name, "DEMO sonradan değişen kart");
  assert.equal(legacy.items[0].lossMinor, 200);
  assert.deepEqual(
    legacy.items[0].lots.map((l: any) => l.countedBy),
    report.items[0].lots.map((l: any) => l.countedBy)
  );
  assert.equal(
    legacy.items[0].lots.every((l: any) => l.deviceId === f.staff.device),
    true
  );
  const bad = structuredClone(payload);
  bad.items[0].gainMinor = 301;
  await sql.query("UPDATE st_market_entries SET payload_json=? WHERE id=?", [
    JSON.stringify(bad),
    mixed.id,
  ]);
  await detail(mixed.id, f.owner, 409);
  assert.equal(
    (await list()).rows.find((r: any) => r.id === mixed.id).gainMinor,
    300
  );
} finally {
  await sql.query("UPDATE st_products SET name=? WHERE id=? AND station_id=?", [
    cards[0].name,
    f.p,
    f.station,
  ]);
  await sql.query("UPDATE st_market_entries SET payload_json=? WHERE id=?", [
    JSON.stringify(payload),
    mixed.id,
  ]);
}
// Real no-op approvals exercise 50-row pagination including entries without journal lines.
const normal = await call("/product", f.owner, {
  stationId: f.station,
  requestId: randomUUID(),
  name: "DEMO rapor farksız normal ürün",
  barcode: "001234567003",
  minimumQty: 0,
  purchasePriceMinor: 0,
  salePriceMinor: 300,
  supplierId: null,
});
async function noop() {
  const d = await ipost("draft-create", {
    kind: "COUNT",
    label: "DEMO rapor sayfalama",
  });
  let draft = await detailDraft(d.id);
  await ipost("draft-scan", {
    draftId: d.id,
    draftVersion: draft.version,
    barcode: "001234567003",
    quantity: 0,
    mode: "SET",
  });
  draft = await detailDraft(d.id);
  await ipost("count-post", {
    draftId: d.id,
    draftVersion: draft.version,
    expectedRevision: (await account()).revision,
    reason: "DEMO farksız sayım raporu",
    unitCosts: [],
    expectedGainMinor: 0,
    expectedLossMinor: 0,
  });
}
if ((await account()).closedToday)
  throw Error("Fresh SMOKE_LEAVE_OPEN=1 terminal-lot fixture required.");
for (let i = 0; i < 48; i++) await noop();
page = await list();
assert.equal(page.rows.length, 50);
assert.equal(page.totals.reports, 51);
assert.ok(page.nextCursor);
const zero = await detail(page.rows[0].id);
assert.equal(zero.gainMinor, 0);
assert.equal(zero.lossMinor, 0);
assert.equal(zero.items[0].delta, 0);
assert.equal(zero.items[0].productId, normal.id);
assert.deepEqual(zero.items[0].lots, []);
await noop();
const older = await list("&cursor=" + page.nextCursor);
assert.equal(older.rows.length, 1);
assert.equal(older.totals.reports, 52);
assert.equal(older.nextCursor, null);
assert.equal(
  new Set([...page.rows, ...older.rows].map((r: any) => r.id)).size,
  51
);
const newPage = await list();
assert.notEqual(newPage.rows[0].id, page.rows[0].id);
assert.equal(newPage.totals.lossMinor, 420);
assert.equal(newPage.totals.gainMinor, 300);
await call("/market-accounting/day-close", f.owner, {
  stationId: f.station,
  requestId: randomUUID(),
  expectedRevision: (await account()).revision,
  countedCashMinor: 0,
});
const hash = (v: unknown) =>
  createHash("sha256").update(JSON.stringify(v)).digest("hex");
const before = await account(),
  snap = hash(before);
for (let i = 0; i < 3; i++) {
  await list();
  await detail(mixed.id);
  await detail(zero.id);
}
assert.equal(hash(await account()), snap);
assert.equal((await account()).closedToday, true);
await sql.end();
const output =
  process.env.SMOKE_OUTPUT_DIR ?? "/workspace/count-report-test/dev";
await mkdir(output, { recursive: true, mode: 0o700 });
await writeFile(
  output + "/fixture.json",
  JSON.stringify({ ...f, reportId: mixed.id, from, to: today }),
  { mode: 0o600 }
);
const checks = [
  "Gerçek onay akışından tarihli normal/parti raporu; net sıfır SKU farkında iki ayrı maliyet",
  "Sonraki stok/maliyet ve kart adı değişince onay anındaki miktar/tutar/etiket korundu",
  "Eski etiketsiz kayıt açıkça güncel kart olarak gösterildi; maliyet tahmin edilmedi",
  "Mali fiş ile ayrıntı uyuşmazsa 409; özet kayıtlı fiş tutarını korudu",
  "Rol/tenant, olmayan fiş, tarih sınırı ve imleç doğrulaması",
  "51/52 gerçek onayda sayfalama, araya yeni onayda tekrar/atlama yok; farksız/satırı olmayan fiş raporda",
  "Kapalı gün okuma ve tekrarlı GET sonrası bakiye/revizyon/kapanış snapshot değişmedi",
];
await writeFile(
  output + "/result.json",
  JSON.stringify({ ok: true, checks }, null, 2)
);
console.log(JSON.stringify({ ok: true, checks }, null, 2));

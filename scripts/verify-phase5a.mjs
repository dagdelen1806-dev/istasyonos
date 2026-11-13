import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { build } from "esbuild";
import { connection, demoDatabase } from "./demo-environment.mjs";
import { request, login } from "./demo-seed.mjs";

if (process.argv[2] !== "--database" || process.argv[3] !== demoDatabase)
  throw Error("EXPLICIT_DEMO_TARGET_REQUIRED");
const db = await connection(),
  access = JSON.parse(await readFile(".local/demo/access.json", "utf8")),
  checks = [];
try {
  assert.equal(
    (await request("/api/health", null, null)).data.demoDatabase,
    demoDatabase
  );
  for (const key of [
    "a-owner",
    "a-manager",
    "a-accountant",
    "b-owner",
    "0-fuel",
    "a-purchaser",
  ]) {
    const actor = access.actors[key];
    try {
      const r = await request("/api/stationos/state", null, actor);
      actor.csrf = r.data.csrfToken ?? r.data.state?.csrfToken;
    } catch {
      await login(actor);
    }
  }
  async function snapshot() {
    const [tables] = await db.query("SHOW TABLES");
    const hashes = {};
    for (const row of tables) {
      const t = Object.values(row)[0];
      if (!t.startsWith("st_")) continue;
      assert.match(t, /^st_[a-z_]+$/);
      const [records] = await db.query("SELECT * FROM `" + t + "`");
      hashes[t] = createHash("sha256")
        .update(
          records
            .map(r => JSON.stringify(r))
            .sort()
            .join("\n")
        )
        .digest("hex");
    }
    return hashes;
  }
  const before = await snapshot();
  const filters = new URLSearchParams({ from: "2026-09-09", to: "2026-11-07" });
  const read = async (actor, extra = "") =>
    (
      await request(
        "/api/stationos/assistant/report?" + filters + extra,
        null,
        actor
      )
    ).data.report;
  const a = await read(access.actors["a-owner"]),
    b = await read(access.actors["b-owner"]);
  assert.equal(
    a.dashboard.totals.revenueMinor + b.dashboard.totals.revenueMinor,
    906996450
  );
  assert.equal(
    a.dashboard.totals.litresMl + b.dashboard.totals.litresMl,
    199062000
  );
  for (const report of [a, b]) {
    assert.equal(report.geminiAvailable, false);
    assert.ok(
      report.findings.every(
        f =>
          f.sources.length <= 10 &&
          f.sources.every(s => report.scope.stationIds.includes(s.stationId))
      )
    );
    assert.equal(
      report.findings.find(f => f.code === "SALES").metrics.sourceMinor,
      report.dashboard.totals.revenueMinor
    );
    assert.ok(
      !report.findings.some(f =>
        ["METER_DIFFERENCE", "APPROVAL_INTEGRITY", "METER_INCOMPLETE"].includes(
          f.code
        )
      )
    );
    const dashboard = (
      await request(
        "/api/stationos/dashboard?" + filters,
        null,
        report === a ? access.actors["a-owner"] : access.actors["b-owner"]
      )
    ).data;
    assert.deepEqual(report.dashboard.totals, dashboard.totals);
  }
  checks.push(
    "İki tenant: 9.069.964,50 TL ve 199.062 L; yönetim paneli ve kaynak satış toplamı birebir"
  );
  const single = await read(
    access.actors["a-owner"],
    "&stationId=" + access.stations[0].id
  );
  assert.equal(single.scope.stationIds.length, 1);
  assert.ok(
    single.findings.every(f =>
      f.sources.every(s => s.stationId === access.stations[0].id)
    )
  );
  const [companies] = await db.query("SELECT id,tenant_id FROM st_companies");
  const [station] = await db.query(
    "SELECT company_id FROM st_stations WHERE id=?",
    [access.stations[0].id]
  );
  assert.deepEqual(
    (
      await read(
        access.actors["a-owner"],
        "&companyId=" + station[0].company_id
      )
    ).dashboard.totals,
    a.dashboard.totals
  );
  const foreignCompany = companies.find(c => c.id !== station[0].company_id).id;
  for (const suffix of [
    "&stationId=" + access.stations[2].id,
    "&companyId=" + foreignCompany,
  ])
    await request(
      "/api/stationos/assistant/report?" + filters + suffix,
      null,
      access.actors["a-owner"],
      403
    );
  for (const role of ["0-fuel", "a-purchaser"]) {
    await request(
      "/api/stationos/assistant/report?" + filters,
      null,
      access.actors[role],
      403
    );
    await request(
      "/api/stationos/assistant/explain",
      { externalConfirmed: true, requestId: randomUUID() },
      access.actors[role],
      403
    );
  }
  for (const role of ["a-manager", "a-accountant"])
    assert.deepEqual(
      (await read(access.actors[role])).dashboard.totals,
      a.dashboard.totals
    );
  await request(
    "/api/stationos/assistant/report?from=2026-02-30&to=2026-11-07",
    null,
    access.actors["a-owner"],
    400
  );
  await request("/api/stationos/assistant/report?" + filters, null, null, 401);
  checks.push(
    "Şirket/istasyon filtreleri; çapraz tenant, personel, satın alma ve anonim erişim reddedildi; yönetici/muhasebe yetkili"
  );
  await request(
    "/api/stationos/assistant/explain",
    {
      externalConfirmed: true,
      stationId: access.stations[2].id,
      requestId: randomUUID(),
    },
    access.actors["a-owner"],
    403
  );
  await request(
    "/api/stationos/assistant/explain",
    { requestId: randomUUID() },
    access.actors["a-owner"],
    400
  );
  const explained = (
    await request(
      "/api/stationos/assistant/explain",
      {
        externalConfirmed: true,
        from: "2026-09-09",
        to: "2026-11-07",
        requestId: randomUUID(),
      },
      access.actors["a-owner"]
    )
  ).data;
  assert.equal(explained.explanation.mode, "LOCAL");
  assert.deepEqual(explained.report.dashboard.totals, a.dashboard.totals);
  checks.push(
    "Gemini kapalıyken yerel rapor/öneriler; dış gönderim onayı ve açıklama yetkisi zorunlu"
  );
  assert.deepEqual(await snapshot(), before);
  checks.push("GET rapor ve POST açıklama bütün st_* kayıtlarını değiştirmedi");
  await build({
    entryPoints: ["server/stationos/smart-assistant.ts"],
    outfile: ".local/demo/phase5a-report.mjs",
    platform: "node",
    bundle: true,
    packages: "external",
    format: "esm",
  });
  const { smartAssistantReport } = await import(
    "../.local/demo/phase5a-report.mjs"
  );
  const [stationRows] = await db.query(
    "SELECT tenant_id FROM st_stations WHERE id=?",
    [access.stations[0].id]
  );
  const tenantId = stationRows[0].tenant_id,
    stationId = access.stations[0].id;
  await db.beginTransaction();
  try {
    const [accounts] = await db.query(
      "SELECT a.id FROM st_accounts a JOIN st_fuel_batches b ON b.account_id=a.id WHERE a.station_id=? AND b.closed=1 ORDER BY a.id LIMIT 1",
      [stationId]
    );
    const accountId = accounts[0].id;
    await db.query(
      "UPDATE st_fuel_batches SET reported_ml=reported_ml+1234 WHERE account_id=?",
      [accountId]
    );
    await db.query("UPDATE st_accounts SET difference_minor=777 WHERE id=?", [
      accountId,
    ]);
    await db.query(
      "UPDATE st_tank_cards SET stock_ml=critical_ml WHERE tank_id=?",
      [access.stations[0].equipment[0].tankId]
    );
    const injected = await smartAssistantReport(
      db,
      tenantId,
      [stationId],
      null,
      "2026-09-09",
      "2026-11-07",
      false
    );
    assert.equal(
      injected.findings.find(f => f.code === "METER_DIFFERENCE").metrics
        .differenceMl,
      1234
    );
    assert.equal(
      injected.findings.find(f => f.code === "ACCOUNT_DIFFERENCE").metrics
        .differenceMinor,
      777
    );
    assert.ok(injected.findings.some(f => f.code === "TANK_CRITICAL"));
    assert.ok(injected.findings.some(f => f.code === "TANK_DIFFERENCE"));
    await db.query(
      "UPDATE st_fuel_batches SET reported_ml=NULL WHERE account_id=?",
      [accountId]
    );
    assert.ok(
      (
        await smartAssistantReport(
          db,
          tenantId,
          [stationId],
          null,
          "2026-09-09",
          "2026-11-07",
          false
        )
      ).findings.some(f => f.code === "METER_INCOMPLETE")
    );
  } finally {
    await db.rollback();
  }
  assert.deepEqual(await snapshot(), before);
  checks.push(
    "Gerçek MySQL rollback senaryoları: 1,234 L sayaç farkı, 7,77 TL icmal farkı, kritik stok, tank ölçüm farkı, eksik litre tespiti; kalıcı değişiklik yok"
  );
  const result = {
    passed: true,
    checks,
    totals: {
      revenueMinor:
        a.dashboard.totals.revenueMinor + b.dashboard.totals.revenueMinor,
      litresMl: a.dashboard.totals.litresMl + b.dashboard.totals.litresMl,
    },
    findings: a.findings.map(f => ({
      code: f.code,
      count: f.count,
      severity: f.severity,
    })),
  };
  await writeFile(
    ".local/demo/phase5a-verification.json",
    JSON.stringify(result, null, 2)
  );
  console.log(JSON.stringify(result, null, 2));
} finally {
  await db.end();
}

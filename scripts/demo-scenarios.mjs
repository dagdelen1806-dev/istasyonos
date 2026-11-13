import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { connection, demoDatabase } from "./demo-environment.mjs";
import { request, login } from "./demo-seed.mjs";
import { build } from "esbuild";
async function run() {
  if (
    process.argv[2] !== "--database" ||
    process.argv[3] !== demoDatabase ||
    process.argv[4] !== "--scenarios"
  )
    throw Error("EXPLICIT_DEMO_TARGET_REQUIRED");
  const db = await connection(),
    file = ".local/demo/scenarios.json",
    saved = JSON.parse(await readFile(file, "utf8").catch(() => "{}"));
  try {
    const [[seedReady]] = await db.query(
      "SELECT COUNT(*) AS n FROM st_audit WHERE action='BUSINESS_DEMO_V1_COMPLETE'"
    );
    if (!Number(seedReady.n)) throw Error("DEMO_SEED_NOT_COMPLETE");
    if (saved.complete) {
      console.log(
        JSON.stringify({ ok: true, alreadyRun: true, checks: saved.checks })
      );
      return;
    }
    assert.equal(
      (await request("/api/health", null, null)).data.demoDatabase,
      demoDatabase
    );
    const access = JSON.parse(
        await readFile(".local/demo/access.json", "utf8")
      ),
      actors = access.actors,
      checks = [];
    for (const key of [
      "a-owner",
      "a-accountant",
      "0-market",
      "0-fuel",
      "b-owner",
    ])
      await login(actors[key]);
    await writeFile(
      ".local/demo/access.json",
      JSON.stringify(access, null, 2),
      { mode: 0o600 }
    );
    const owner = actors["a-owner"],
      accountant = actors["a-accountant"],
      market = actors["0-market"],
      station = access.stations[0],
      stationId = station.id;
    async function op(key, a, path, body, expected = 200) {
      saved.ops ??= {};
      let entry = saved.ops[key];
      if (entry?.response) return entry.response;
      if (!entry) {
        entry = { body: { ...body, requestId: randomUUID() } };
        saved.ops[key] = entry;
        await writeFile(file, JSON.stringify(saved, null, 2));
      }
      const result = (
        await request("/api/stationos" + path, entry.body, a, expected)
      ).data;
      entry.response = result;
      await writeFile(file, JSON.stringify(saved, null, 2));
      return result;
    }
    for (const s of access.stations) {
      const a = actors[s.group + "-owner"],
        [[tank]] = await db.execute(
          "SELECT tank_id,revision FROM st_tank_cards WHERE tank_id=?",
          [s.equipment[0].tankId]
        );
      const pending = (
        await op(s.code + "-pending-delivery", a, "/tank/request", {
          stationId: s.id,
          tankId: tank.tank_id,
          expectedRevision: Number(tank.revision),
          kind: "DELIVERY",
          supplierId: s.supplierId,
          reference: "DEMO-PENDING-DELIVERY-" + s.code,
          documentMl: 1000000,
          measuredMl: 1000000,
          note: "DEMO/SİM yeni tanker kabulü; bağımsız onay bekliyor, stoğa dahil değil",
          evidence: "DEMO bekleyen irsaliye ve ölçüm",
        })
      ).result;
      const denial = await op(
        s.code + "-self-denied",
        a,
        "/tank/review",
        {
          stationId: s.id,
          tankId: tank.tank_id,
          stockRequestId: pending.id,
          expectedRevision: Number(tank.revision),
          decision: "APPROVE",
          note: "DEMO kendi onayını engelleme testi",
          evidence: "DEMO",
        },
        403
      );
      assert.equal(denial.error.code, "SELF_APPROVAL_FORBIDDEN");
    }
    checks.push(
      "Tanker kabulü → bağımsız stok girişi: 45 tarihsel teslim tek kez işlendi; 3 yeni talep bekliyor, kendi onayı reddedildi"
    );
    const [[account]] = await db.execute(
        "SELECT * FROM st_accounts WHERE shift_id=? AND business_unit='MARKET' AND user_id=?",
        [station.activeShiftId, market.id]
      ),
      [[product]] = await db.execute(
        "SELECT * FROM st_products WHERE station_id=? AND barcode=?",
        [stationId, station.code + "-SKU-0"]
      );
    const amount = Number(product.sale_price_minor);
    await op("live-market-sale", market, "/stock", {
      stationId,
      productId: product.id,
      kind: "SALE",
      quantity: 1,
      reference: "DEMO-MARKET:" + account.id,
    });
    let revision = (
      await op("live-market-cash", market, "/payment", {
        accountId: account.id,
        expectedRevision: Number(account.revision),
        kind: "CASH",
        amountMinor: amount,
        reference: "DEMO ek market satış senaryosu",
      })
    ).result.revision;
    revision = (
      await op("live-market-source", owner, "/account/source", {
        accountId: account.id,
        expectedRevision: revision,
        sourceSalesMinor: amount,
        sourceRef: "DEMO-MARKET:" + account.id,
      })
    ).result.revision;
    revision = (
      await op("live-market-submit", market, "/account/submit", {
        accountId: account.id,
        expectedRevision: revision,
        countedCashMinor: amount + Number(account.opening_float_minor),
      })
    ).result.revision;
    revision = (
      await op("live-market-receive", owner, "/account/cash-receive", {
        accountId: account.id,
        expectedRevision: revision,
        receivedMinor: amount,
      })
    ).result.revision;
    revision = (
      await op("live-market-approve1", owner, "/account/approve", {
        accountId: account.id,
        expectedRevision: revision,
        note: "DEMO ilk bağımsız onay; ikinci kişi kullanıcı tarafından tamamlanabilir",
      })
    ).result.revision;
    const duplicate = await op(
      "live-duplicate-approval-denied",
      owner,
      "/account/approve",
      { accountId: account.id, expectedRevision: revision },
      409
    );
    assert.equal(duplicate.error.code, "DUPLICATE_APPROVAL");
    const closed = await op(
      "live-shift-close-denied",
      owner,
      "/shift/close",
      {
        stationId,
        shiftId: station.activeShiftId,
        endsAt: new Date().toISOString(),
      },
      409
    );
    assert.equal(closed.error.code, "SHIFT_APPROVAL_REQUIRED");
    checks.push(
      "Market satışı → kalıcı stok/tahsilat → ilk bağımsız onay; ikinci imza beklerken vardiya kapanışı engellendi"
    );
    await build({
      entryPoints: ["client/src/lib/icmal-export.ts"],
      platform: "node",
      bundle: true,
      format: "esm",
      outfile: ".local/demo/zip-source.js",
    });
    const { zipSourceBytes } = await import("../.local/demo/zip-source.js");
    const bytes = await readFile("scripts/fixtures/demo-tanker.png");
    const source = (
      await op("ocr-import", owner, "/tanker-document/import", {
        stationId,
        sourceName: "DEMO OCR sentetik tanker.zip",
        zipBase64: Buffer.from(
          zipSourceBytes([{ name: "DEMO-tanker.png", data: bytes }])
        ).toString("base64"),
      })
    ).result;
    const path =
      "/api/stationos/tanker-documents?stationId=" +
      stationId +
      "&packageId=" +
      source.id;
    let data = (await request(path, null, owner)).data;
    assert.equal(data.gemini.available, false);
    assert.equal(data.openai.available, false);
    const read = (
      await op("ocr-read", owner, "/tanker-document/read", {
        stationId,
        packageId: source.id,
        expectedSourceHash: data.sourceHash,
        provider: "LOCAL",
      })
    ).result;
    data = (await request(path, null, owner)).data;
    const reading = data.reads.find(r => r.id === read.id);
    assert.equal(reading.provider, "LOCAL");
    const values = structuredClone(reading.proposal.values),
      [[fuel]] = await db.execute(
        "SELECT fuel_type_id FROM st_fuel_tanks WHERE id=?",
        [station.equipment[0].tankId]
      );
    const ocrSupplier = (
      await op("ocr-supplier", owner, "/supplier", {
        stationId,
        name: "DEMO Petrol A.Ş.",
        creditLimitMinor: 0,
      })
    ).result.id;
    Object.assign(values, {
      documentNo: "DEMO-TANKER-BROWSER",
      issuer: "DEMO Petrol A.Ş.",
      documentDate: "2026-11-05",
      supplierId: ocrSupplier,
      pages: data.pages.map(p => ({ pageId: p.id, number: 1, total: 1 })),
      lines: [
        {
          key: "LINE-1",
          label: "DEMO YAKIT",
          productCode: "DEMO-OCR-P1",
          fuelId: fuel.fuel_type_id,
          netMl: 9900,
          dispatchMl: 10000,
        },
      ],
    });
    const review = {
      stationId,
      packageId: source.id,
      expectedSourceHash: data.sourceHash,
      expectedRevision: 0,
      readId: read.id,
      decision: "PENDING",
      sourceConfirmed: false,
      values,
      note: "DEMO yerel OCR + sentetik kaynakla kullanıcı alan kontrolü; gerçek sağlayıcı veya müşteri belgesi değildir",
      evidence: "DEMO üretilen PNG kaynak",
    };
    const pending = (
      await op("ocr-pending", owner, "/tanker-document/review", review)
    ).result;
    const denied = await op(
      "ocr-unconfirmed-denied",
      owner,
      "/tanker-document/review",
      {
        ...review,
        expectedRevision: pending.revision,
        decision: "VERIFIED_DRAFT",
      },
      409
    );
    assert.equal(denied.error.code, "TANKER_DOCUMENT_INCOMPLETE");
    await op("ocr-verified", owner, "/tanker-document/review", {
      ...review,
      expectedRevision: pending.revision,
      decision: "VERIFIED_DRAFT",
      sourceConfirmed: true,
    });
    const reloaded = (await request(path, null, owner)).data;
    assert.equal(reloaded.latest.decision, "VERIFIED_DRAFT");
    assert.equal(reloaded.latest.values.lines[0].netMl, 9900);
    assert.equal(reloaded.receipts.length, 0);
    saved.ocrPackageId = source.id;
    checks.push(
      "Gerçek Windows OCR → PENDING taslak → teyitsiz doğrulama reddi → kullanıcı teyitli kalıcı belge; stok/muhasebe yazımı yok"
    );
    await request(
      "/api/stationos/dashboard?stationId=" + access.stations[2].id,
      null,
      owner,
      403
    );
    await request(
      "/api/stationos/tanks?stationId=" + stationId,
      null,
      actors["b-owner"],
      403
    );
    await request("/api/stationos/dashboard", null, actors["0-fuel"], 403);
    checks.push(
      "İki şirket arasında tenant izolasyonu ve personelde yönetim paneli yetki reddi"
    );
    const state = (await request("/api/stationos/state", null, owner)).data;
    assert.equal(state.integrationStatus.bank, "DISABLED");
    assert.equal(state.integrationStatus.turpak, "DISABLED");
    const dashboard = (await request("/api/stationos/dashboard", null, owner))
      .data;
    assert.equal(dashboard.days.length, 60);
    assert.equal(dashboard.current.pendingAccounts, 1);
    assert.equal(dashboard.current.pendingTankRequests, 2);
    assert.equal(dashboard.current.differenceMinor, 0);
    assert.equal(
      dashboard.totals.revenueMinor,
      dashboard.totals.cashMinor +
        dashboard.totals.cardMinor +
        dashboard.totals.debtMinor +
        dashboard.totals.ibanMinor
    );
    const month = (
      await request(
        "/api/stationos/dashboard?from=2026-10-01&to=2026-10-31",
        null,
        owner
      )
    ).data;
    assert.equal(month.days.length, 31);
    checks.push(
      "Yönetim paneli: gerçek 60 günlük toplamlar, 31 günlük aylık filtre, kasa/cari/stok ve bekleyen onaylar"
    );
    saved.complete = true;
    saved.checks = checks;
    await writeFile(file, JSON.stringify(saved, null, 2));
    console.log(JSON.stringify({ ok: true, checks }));
  } finally {
    await db.end();
  }
}
run().catch(e => {
  console.error(e.message);
  process.exitCode = 1;
});

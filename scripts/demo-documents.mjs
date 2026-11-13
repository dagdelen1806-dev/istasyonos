import assert from "node:assert/strict";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { build } from "esbuild";
import { connection, demoDatabase } from "./demo-environment.mjs";
import { request } from "./demo-seed.mjs";
async function run() {
  if (
    process.argv[2] !== "--database" ||
    process.argv[3] !== demoDatabase ||
    process.argv[4] !== "--documents"
  )
    throw Error("EXPLICIT_DEMO_TARGET_REQUIRED");
  const db = await connection(),
    file = ".local/demo/documents.json",
    saved = JSON.parse(await readFile(file, "utf8").catch(() => "{}"));
  let chrome, socket;
  try {
    const [[seedReady]] = await db.query(
      "SELECT COUNT(*) AS n FROM st_audit WHERE action='BUSINESS_DEMO_V1_COMPLETE'"
    );
    if (!Number(seedReady.n)) throw Error("DEMO_SEED_NOT_COMPLETE");
    if (saved.complete) {
      console.log(JSON.stringify({ ok: true, alreadyGenerated: true }));
      return;
    }
    assert.equal(
      (await request("/api/health", null, null)).data.demoDatabase,
      demoDatabase
    );
    const access = JSON.parse(
      await readFile(".local/demo/access.json", "utf8")
    );
    await build({
      entryPoints: ["client/src/lib/icmal-export.ts"],
      platform: "node",
      bundle: true,
      format: "esm",
      outfile: ".local/demo/zip-source.js",
    });
    const { zipSourceBytes } = await import("../.local/demo/zip-source.js");
    async function op(key, actor, path, body) {
      saved.ops ??= {};
      let row = saved.ops[key];
      if (row?.result) return row.result;
      if (row) {
        const [[tracking]] = await db.execute(
          "SELECT state FROM st_request_tracking WHERE actor_user_id=? AND request_id=?",
          [actor.id, row.body.requestId]
        );
        if (tracking?.state === "FAILED") row = null;
      }
      if (!row) {
        row = { body: { ...body, requestId: randomUUID() } };
        saved.ops[key] = row;
        await writeFile(file, JSON.stringify(saved, null, 2));
      }
      row.result = (
        await request("/api/stationos" + path, row.body, actor)
      ).data.result;
      await writeFile(file, JSON.stringify(saved, null, 2));
      return row.result;
    }
    const port = 19309;
    chrome = spawn(
      "C:/Program Files/Google/Chrome/Application/chrome.exe",
      [
        "--headless=new",
        "--no-sandbox",
        "--disable-gpu",
        "--no-first-run",
        "--remote-debugging-address=127.0.0.1",
        "--remote-debugging-port=" + port,
        "--user-data-dir=" +
          process.cwd() +
          "/.local/demo/fixture-chrome-" +
          Date.now(),
        "about:blank",
      ],
      { windowsHide: true, stdio: "ignore" }
    );
    for (let i = 0; i < 100; i++) {
      try {
        if ((await fetch("http://127.0.0.1:" + port + "/json/version")).ok)
          break;
      } catch {}
      await new Promise(r => setTimeout(r, 100));
    }
    const page = await (
      await fetch("http://127.0.0.1:" + port + "/json/new?about:blank", {
        method: "PUT",
      })
    ).json();
    socket = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise((r, j) => {
      socket.onopen = r;
      socket.onerror = j;
    });
    let seq = 0;
    const pending = new Map();
    socket.onmessage = e => {
      const m = JSON.parse(e.data),
        p = pending.get(m.id);
      if (p) {
        pending.delete(m.id);
        m.error ? p.reject(Error("CDP_FAILED")) : p.resolve(m.result);
      }
    };
    const send = (method, params = {}) =>
      new Promise((resolve, reject) => {
        const id = ++seq;
        pending.set(id, { resolve, reject });
        socket.send(JSON.stringify({ id, method, params }));
      });
    await send("Emulation.setDeviceMetricsOverride", {
      width: 1500,
      height: 1000,
      deviceScaleFactor: 1,
      mobile: false,
    });
    const style =
      '<meta charset="utf-8"><style>body{font:28px Arial;margin:25px;color:#183f36}td,th{padding:14px;border:1px solid #555;text-align:left}table{border-collapse:collapse}h1{font-size:32px}p{font-size:24px}</style>';
    async function image(html, format) {
      await send("Page.navigate", {
        url: "data:text/html;charset=utf-8," + encodeURIComponent(style + html),
      });
      await new Promise(r => setTimeout(r, 150));
      return Buffer.from(
        (
          await send("Page.captureScreenshot", {
            format,
            ...(format === "jpeg" ? { quality: 90 } : {}),
          })
        ).data,
        "base64"
      );
    }
    const litre = n =>
        (n / 1000).toLocaleString("tr-TR", {
          minimumFractionDigits: 3,
          maximumFractionDigits: 3,
          useGrouping: false,
        }),
      money = n =>
        (n / 100).toLocaleString("tr-TR", {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
          useGrouping: false,
        });
    for (const station of access.stations) {
      const actor = access.actors[station.group + "-owner"];
      actor.csrf = (
        await request("/api/stationos/state", null, actor)
      ).data.csrfToken;
      const [tanks] = await db.execute(
        "SELECT c.*,f.name AS fuel FROM st_tank_cards c JOIN st_fuel_tanks t ON t.id=c.tank_id JOIN st_fuel_types f ON f.id=t.fuel_type_id WHERE c.station_id=? ORDER BY c.tank_number",
        [station.id]
      );
      for (const tank of tanks)
        await op(
          station.code + "-dual-" + tank.tank_id,
          actor,
          "/tank/dual-measure",
          {
            stationId: station.id,
            tankId: tank.tank_id,
            expectedRevision: Number(tank.revision),
            expectedReadingId: null,
            productMl: Number(tank.stock_ml) + 2000,
            netMl: Number(tank.stock_ml),
            note: "DEMO/SİM sıcaklık hacim farkı +2 L; stok düzeltmesi değildir",
            evidence: "DEMO ürün/net ölçüm örneği",
          }
        );
      let rows = tanks.map((t, index) => ({
        number: t.tank_number,
        fuelLabel: t.fuel,
        capacityLitres: index === 2 ? 0 : Number(t.capacity_ml) / 1000,
        productVolumeLitres: Number(t.stock_ml) / 1000 + 2,
        netProductVolumeLitres: Number(t.stock_ml) / 1000,
        reportedVolumeFillPercent:
          index === 2
            ? null
            : ((Number(t.stock_ml) + 2000) / Number(t.capacity_ml)) * 100,
      }));
      const jpg = await image(
        "<h1>DEMO TANK FOTOĞRAFI — " +
          station.code +
          "</h1><p>Sentetik ölçüm. Gerçek sensör bağlantısı değildir. Ürün/net farkı: sıcaklık senaryosu.</p><table><tr><th>Tank</th><th>Yakıt</th><th>Kapasite L</th><th>Ürün hacmi L</th><th>Net hacim L</th></tr>" +
          rows
            .map(
              r =>
                "<tr><td>" +
                r.number +
                "</td><td>" +
                r.fuelLabel +
                "</td><td>" +
                r.capacityLitres +
                "</td><td>" +
                r.productVolumeLitres +
                "</td><td>" +
                r.netProductVolumeLitres +
                "</td></tr>"
            )
            .join("") +
          "</table><p>LPG kaynak kapasitesi 0: doğrulama gereklidir, gerçek kapasite değildir.</p>",
        "jpeg"
      );
      const photoHash = createHash("sha256").update(jpg).digest("hex"),
        sourceHash = createHash("sha256")
          .update(JSON.stringify(rows))
          .digest("hex"),
        identifierHash = createHash("sha256")
          .update("DEMO-PHOTO-" + station.code)
          .digest("hex")
          .slice(0, 32),
        id =
          identifierHash.slice(0, 8) +
          "-" +
          identifierHash.slice(8, 12) +
          "-4" +
          identifierHash.slice(13, 16) +
          "-a" +
          identifierHash.slice(17, 20) +
          "-" +
          identifierHash.slice(20, 32);
      await mkdir(".local/phase4d/sources", { recursive: true });
      await writeFile(".local/phase4d/sources/" + photoHash + ".jpeg", jpg, {
        flag: "wx",
      }).catch(e => {
        if (e.code !== "EEXIST") throw e;
      });
      const [[member]] = await db.execute(
        "SELECT tenant_id FROM st_members WHERE user_id=?",
        [actor.id]
      );
      await db.execute(
        "INSERT IGNORE INTO st_tank_photo_drafts(id,tenant_id,station_id,source_name,source_sha256,photo_sha256,displayed_at,rows_json,created_by) VALUES (?,?,?,?,?,?,UTC_TIMESTAMP(3),?,?)",
        [
          id,
          member.tenant_id,
          station.id,
          "DEMO sentetik tank ölçümü " + station.code,
          sourceHash,
          photoHash,
          JSON.stringify(rows),
          actor.id,
        ]
      );
      const [[stored]] = await db.execute(
        "SELECT rows_json FROM st_tank_photo_drafts WHERE id=?",
        [id]
      );
      rows = JSON.parse(stored.rows_json);
      for (const row of rows) {
        const tank = tanks.find(t => t.tank_number === row.number);
        await op(
          station.code + "-photo-review-" + row.number,
          actor,
          "/tank/photo-review",
          {
            stationId: station.id,
            documentId: id,
            rowNumber: row.number,
            expectedRevision: 0,
            decision: "PENDING",
            basis: "BOTH",
            tankId: tank.tank_id,
            capacityMl:
              row.capacityLitres === 0 ? null : row.capacityLitres * 1000,
            volumeMl: null,
            productMl: row.productVolumeLitres * 1000,
            netMl: row.netProductVolumeLitres * 1000,
            sourceConfirmed: false,
            warningsAcknowledged: false,
            note: "DEMO yönetici kaynak kontrolü bekliyor; onaylı stok değiştirilmez",
            evidence: "DEMO sentetik tank görüntüsü",
          }
        );
      }
      const [[account]] = await db.execute(
        "SELECT a.id,a.shift_id FROM st_accounts a JOIN st_shifts s ON s.id=a.shift_id WHERE a.station_id=? AND a.business_unit='FUEL' AND a.status IN ('ACCEPTED','ACCEPTED_WITH_PENDING') ORDER BY s.starts_at DESC LIMIT 1",
        [station.id]
      );
      const [readings] = await db.execute(
        "SELECT r.*,n.tank_id,f.id AS fuelId,f.name AS fuel FROM st_fuel_readings r JOIN st_fuel_nozzles n ON n.id=r.nozzle_id JOIN st_fuel_tanks t ON t.id=n.tank_id JOIN st_fuel_types f ON f.id=t.fuel_type_id WHERE r.account_id=? ORDER BY r.nozzle_id,r.sequence_no",
        [account.id]
      );
      const groups = new Map();
      for (const r of readings) {
        const a = groups.get(r.fuelId) ?? [];
        a.push(r);
        groups.set(r.fuelId, a);
      }
      const sales = [];
      for (const [fuelId, g] of groups) {
        let minor = 0n;
        for (let i = 1; i < g.length; i++)
          minor +=
            ((BigInt(g[i].meter_ml) - BigInt(g[i - 1].meter_ml)) *
              BigInt(g[i - 1].price_minor) +
              500n) /
            1000n;
        sales.push({
          kind: "SALES",
          fuelId,
          label: g[0].fuel,
          basis: "COMMERCIAL",
          volumeMl: Number(g.at(-1).meter_ml) - Number(g[0].meter_ml),
          amountMinor: Number(minor),
        });
      }
      const png = await image(
        "<h1>DEMO GÜNLÜK VARDİYA İCMALİ — " +
          station.code +
          "</h1><p>" +
          access.anchorDay +
          " · Sentetik kaynak, gerçek müşteri kaydı değildir.</p><table><tr><th>Yakıt</th><th>Litre(Lt)</th><th>Tutar(TL)</th></tr>" +
          sales
            .map(
              s =>
                "<tr><td>" +
                s.label +
                "</td><td>" +
                litre(s.volumeMl) +
                "</td><td>" +
                money(s.amountMinor) +
                "</td></tr>"
            )
            .join("") +
          "</table><p>Fiziksel tank sensörü ve otomasyon bağlı değildir.</p>",
        "png"
      );
      const pack = await op(
        station.code + "-daily-import",
        actor,
        "/daily-report/import",
        {
          stationId: station.id,
          sourceName: "DEMO günlük icmal " + station.code + ".zip",
          zipBase64: Buffer.from(
            zipSourceBytes([{ name: "DEMO-icmal.png", data: png }])
          ).toString("base64"),
        }
      );
      const data = (
        await request(
          "/api/stationos/daily-reports?stationId=" +
            station.id +
            "&packageId=" +
            pack.id,
          null,
          actor
        )
      ).data;
      const review = await op(
        station.code + "-daily-source",
        actor,
        "/daily-report/review",
        {
          stationId: station.id,
          packageId: pack.id,
          expectedRevision: 0,
          decision: "REVIEWED_DRAFT",
          shiftReference: "DEMO sabah vardiyası",
          reportDay: access.anchorDay,
          pages: data.pages.map(p => ({ pageId: p.id, kind: "SALES" })),
          sourceConfirmed: true,
          note: "DEMO sentetik görüntü kaynak incelemesi; mali kayıt değildir",
          evidence: "DEMO yerel kaynak görüntüsü",
        }
      );
      await op(station.code + "-daily-ocr", actor, "/daily-report/ocr", {
        stationId: station.id,
        packageId: pack.id,
        pageId: data.pages[0].id,
        expectedSourceSha256: data.pages[0].sha256,
      });
      const context = (
        await request(
          "/api/stationos/daily-report/numeric?" +
            new URLSearchParams({
              stationId: station.id,
              packageId: pack.id,
              shiftId: account.shift_id,
            }),
          null,
          actor
        )
      ).data;
      await op(
        station.code + "-daily-numeric",
        actor,
        "/daily-report/numeric",
        {
          stationId: station.id,
          packageId: pack.id,
          shiftId: account.shift_id,
          expectedRevision: 0,
          expectedSourceRevision: context.sourceRevision,
          expectedSnapshotHash: context.currentSnapshotHash,
          decision: "PENDING",
          sourceConfirmed: false,
          shiftConfirmed: false,
          rows: sales.map(s => ({ ...s, pageId: data.pages[0].id })),
          note: "DEMO kaynakla birebir eşleşen örnek sayılar; kullanıcı onayı bekler. OCR çıkarmış gibi gösterilmez.",
          evidence: "DEMO üretilen icmal tablosu",
        }
      );
    }
    saved.complete = true;
    await writeFile(file, JSON.stringify(saved, null, 2));
    console.log(
      JSON.stringify({
        ok: true,
        photoDrafts: 3,
        pendingPhotoRows: 9,
        dualVolumeReadings: 9,
        dailyPackages: 3,
        numericDrafts: 3,
        stockChanged: false,
      })
    );
  } finally {
    socket?.close();
    chrome?.kill();
    await db.end();
  }
}
run().catch(e => {
  console.error(e.code ?? e.message);
  process.exitCode = 1;
});

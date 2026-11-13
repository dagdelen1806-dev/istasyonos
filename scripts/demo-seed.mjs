import assert from "node:assert/strict";
import { readFile, writeFile, rename, appendFile } from "node:fs/promises";
import { randomBytes, createHash, scryptSync } from "node:crypto";
import http from "node:http";
import { connection, config, demoDatabase } from "./demo-environment.mjs";
import { normalizeDemoDates } from "./demo-seed-dates.mjs";
const uid = s => {
  const h = createHash("sha256")
    .update("istasyonos-business-demo-v1:" + s)
    .digest("hex");
  return (
    h.slice(0, 8) +
    "-" +
    h.slice(8, 12) +
    "-4" +
    h.slice(13, 16) +
    "-a" +
    h.slice(17, 20) +
    "-" +
    h.slice(20, 32)
  );
};
const folder = ".local/demo",
  base = "http://127.0.0.1:3001";
const readJson = async p => JSON.parse(await readFile(p, "utf8"));
const save = async (p, v) => {
  await writeFile(p + ".tmp", JSON.stringify(v, null, 2), { mode: 0o600 });
  await rename(p + ".tmp", p);
};
export async function request(path, body, actor, expected = 200) {
  return new Promise((resolve, reject) => {
    const text = body ? JSON.stringify(body) : null;
    const req = http.request(
      base + path,
      {
        method: body ? "POST" : "GET",
        headers: {
          "Content-Type": "application/json",
          Origin: base,
          "User-Agent": "StationOS Demo Android Mobile",
          "X-Stationos-Request": "1",
          "X-Stationos-Device-Kind": "MOBILE",
          "X-Stationos-Device-Id": actor?.device ?? uid("diagnostic-device"),
          Cookie: actor?.cookie ?? "",
          "X-CSRF-Token": actor?.csrf ?? "",
          ...(text ? { "Content-Length": Buffer.byteLength(text) } : {}),
        },
      },
      res => {
        let raw = "";
        res.on("data", c => (raw += c));
        res.on("end", () => {
          try {
            const data = JSON.parse(raw);
            if (res.statusCode !== expected)
              throw Error(path + ":" + (data.error?.code ?? res.statusCode));
            resolve({
              data,
              cookie: res.headers["set-cookie"]?.[0]?.split(";")[0],
            });
          } catch (e) {
            reject(e);
          }
        });
      }
    );
    req.on("error", () => reject(Error("DEMO_HTTP_UNAVAILABLE")));
    req.setTimeout(70000, () => req.destroy());
    req.end(text);
  });
}
export async function login(actor) {
  actor.cookie = (
    await request("/api/auth/login", {
      email: actor.email,
      password: actor.password,
    })
  ).cookie;
  actor.csrf = (
    await request("/api/stationos/state", null, actor)
  ).data.csrfToken;
}
async function seed() {
  if (
    process.argv[2] !== "--database" ||
    process.argv[3] !== demoDatabase ||
    process.argv[4] !== "--seed"
  )
    throw Error("EXPLICIT_DEMO_TARGET_REQUIRED");
  const db = await connection();
  try {
    let checkpoint = await readJson(folder + "/seed-checkpoint.json").catch(
      () => ({ ops: {} })
    );
    const cfg = await config();
    assert.equal(cfg.port, 3001);
    assert.equal(
      (await request("/api/health", null, null)).data.demoDatabase,
      demoDatabase,
      "DEMO_SERVER_TARGET_REJECTED"
    );
    const journal = await readFile(
      folder + "/seed-operations.jsonl",
      "utf8"
    ).catch(() => "");
    for (const line of journal.trim().split("\n").filter(Boolean)) {
      const entry = JSON.parse(line);
      checkpoint.ops[entry.key] = entry.record;
    }
    const [foreign] = await db.query(
      "SELECT id FROM st_tenants WHERE id NOT IN (?,?)",
      [uid("tenant-a"), uid("tenant-b")]
    );
    if (foreign.length) throw Error("UNRECOGNIZED_DEMO_TENANT_NO_CHANGES");
    const [[unknownUsers]] = await db.query(
      "SELECT COUNT(*) AS n FROM users WHERE openId NOT LIKE 'demo-business-v1-%'"
    );
    if (Number(unknownUsers.n))
      throw Error("UNRECOGNIZED_DEMO_USERS_NO_CHANGES");
    const [[tenantCount]] = await db.query(
      "SELECT COUNT(*) AS n FROM st_tenants"
    );
    if (!Number(tenantCount.n)) {
      // A genuinely empty target cannot reuse results from a former database.
      const stamp = Date.now();
      for (const name of [
        "seed-operations.jsonl",
        "seed-checkpoint.json",
        "scenarios.json",
        "documents.json",
        "browser-write.json",
      ])
        await rename(
          folder + "/" + name,
          folder + "/" + name + ".previous-" + stamp
        ).catch(e => {
          if (e.code !== "ENOENT") throw e;
        });
      checkpoint = { ops: {} };
      const previousAccess = await readJson(folder + "/access.json").catch(
        () => null
      );
      if (previousAccess) {
        previousAccess.anchorDay = new Intl.DateTimeFormat("en-CA", {
          timeZone: "Europe/Istanbul",
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
        }).format(new Date());
        await save(folder + "/access.json", previousAccess);
      }
    }
    const [[done]] = await db.query(
      "SELECT COUNT(*) AS n FROM st_audit WHERE action='BUSINESS_DEMO_V1_COMPLETE'"
    );
    if (Number(done.n)) {
      await normalizeDemoDates();
      console.log(
        JSON.stringify({
          ok: true,
          alreadySeeded: true,
          database: demoDatabase,
          duplicateRecordsCreated: 0,
        })
      );
      return;
    }
    let access = await readJson(folder + "/access.json").catch(() => null);
    if (!access) {
      const actors = {};
      for (const group of ["a", "b"]) {
        for (const [key, role] of [
          ["owner", "OWNER"],
          ["manager", "MANAGER"],
          ["accountant", "ACCOUNTANT"],
          ["purchaser", "PURCHASER"],
        ])
          actors[group + "-" + key] = {
            key: group + "-" + key,
            group,
            role,
            email: `${key}.${group}@demo.example.invalid`,
            password: randomBytes(24).toString("base64url") + "!7aA",
            device: uid(group + key + "device"),
          };
      }
      for (let s = 0; s < 3; s++)
        for (const [key, role] of [
          ["fuel", "FUEL_STAFF"],
          ["market", "MARKET_STAFF"],
        ])
          actors[s + "-" + key] = {
            key: s + "-" + key,
            group: s < 2 ? "a" : "b",
            station: s,
            role,
            email: `${key}.${s + 1}@demo.example.invalid`,
            password: randomBytes(24).toString("base64url") + "!7aA",
            device: uid(s + key + "device"),
          };
      access = {
        actors,
        stations: [
          {
            id: uid("station-0"),
            group: "a",
            name: "DEMO Kuzey Merkez",
            code: "DEMO-KM",
          },
          {
            id: uid("station-1"),
            group: "a",
            name: "DEMO Kuzey Çevreyolu",
            code: "DEMO-KC",
          },
          {
            id: uid("station-2"),
            group: "b",
            name: "DEMO Güney Sahil",
            code: "DEMO-GS",
          },
        ],
        anchorDay: new Intl.DateTimeFormat("en-CA", {
          timeZone: "Europe/Istanbul",
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
        }).format(new Date()),
      };
      await save(folder + "/access.json", access);
    }
    const actors = access.actors,
      stations = access.stations;
    await db.beginTransaction();
    try {
      for (const a of Object.values(actors)) {
        const openId = "demo-business-v1-" + a.key;
        let [[user]] = await db.execute(
          "SELECT id,email FROM users WHERE openId=?",
          [openId]
        );
        if (!user) {
          const [r] = await db.execute(
            "INSERT INTO users(openId,name,email,loginMethod,role) VALUES (?,?,?,'local','user')",
            [openId, "DEMO " + a.key, a.email]
          );
          const salt = randomBytes(16).toString("hex");
          await db.execute(
            "INSERT INTO st_auth_credentials(user_id,email,password_hash) VALUES (?,?,?)",
            [
              r.insertId,
              a.email,
              "scrypt:" +
                salt +
                ":" +
                scryptSync(a.password, salt, 64).toString("hex"),
            ]
          );
          a.id = r.insertId;
        } else {
          assert.equal(user.email, a.email);
          a.id = user.id;
        }
      }
      for (const group of ["a", "b"]) {
        const tenantId = uid("tenant-" + group),
          companyId = uid("company-" + group),
          name =
            group === "a"
              ? "DEMO Kuzey Enerji A.Ş."
              : "DEMO Güney Akaryakıt Ltd.";
        await db.execute(
          "INSERT IGNORE INTO st_tenants(id,name,is_demo,created_by_user_id) VALUES (?,?,TRUE,?)",
          [tenantId, name, actors[group + "-owner"].id]
        );
        await db.execute(
          "INSERT IGNORE INTO st_companies(id,tenant_id,name) VALUES (?,?,?)",
          [companyId, tenantId, name]
        );
        for (const station of stations.filter(s => s.group === group))
          await db.execute(
            "INSERT IGNORE INTO st_stations(id,tenant_id,company_id,name,code,address) VALUES (?,?,?,?,?,?)",
            [
              station.id,
              tenantId,
              companyId,
              station.name,
              station.code,
              "Tamamen kurgusal DEMO istasyon adresi",
            ]
          );
        for (const a of Object.values(actors).filter(a => a.group === group)) {
          await db.execute(
            "INSERT IGNORE INTO st_members(tenant_id,user_id,role) VALUES (?,?,?)",
            [tenantId, a.id, a.role]
          );
          for (const s of stations.filter(
            s =>
              s.group === group &&
              (a.station === undefined || a.station === stations.indexOf(s))
          ))
            await db.execute(
              "INSERT IGNORE INTO st_member_stations(tenant_id,user_id,station_id) VALUES (?,?,?)",
              [tenantId, a.id, s.id]
            );
        }
      }
      await db.commit();
    } catch (e) {
      await db.rollback();
      throw e;
    }
    await save(folder + "/access.json", access);
    for (const a of Object.values(actors)) {
      const token = randomBytes(32).toString("hex");
      a.cookie = "webdev_app_session=" + token;
      await db.execute(
        "INSERT INTO st_auth_sessions(token_hash,user_id,expires_at) VALUES (?,?,UTC_TIMESTAMP(3)+INTERVAL 12 HOUR)",
        [createHash("sha256").update(token).digest("hex"), a.id]
      );
      a.csrf = (await request("/api/stationos/state", null, a)).data.csrfToken;
    }
    await save(folder + "/access.json", access);
    async function op(key, actor, path, body) {
      let record = checkpoint.ops[key];
      if (record?.result) return record.result;
      if (!record) {
        record = { path, body: { ...body, requestId: uid("request-" + key) } };
        checkpoint.ops[key] = record;
        await appendFile(
          folder + "/seed-operations.jsonl",
          JSON.stringify({ key, record }) + "\n",
          { mode: 0o600 }
        );
      }
      assert.equal(record.path, path);
      const [[tracking]] = await db.execute(
        "SELECT state FROM st_request_tracking WHERE actor_user_id=? AND request_id=?",
        [actor.id, record.body.requestId]
      );
      if (tracking?.state === "FAILED") {
        record.attempt = (record.attempt ?? 0) + 1;
        record.body.requestId = uid(
          "request-" + key + "-confirmed-failed-retry-" + record.attempt
        );
        await appendFile(
          folder + "/seed-operations.jsonl",
          JSON.stringify({ key, record }) + "\n",
          { mode: 0o600 }
        );
      }
      const data = (await request("/api/stationos" + path, record.body, actor))
        .data;
      record.result = data.result;
      await appendFile(
        folder + "/seed-operations.jsonl",
        JSON.stringify({ key, record }) + "\n",
        { mode: 0o600 }
      );
      return data.result;
    }
    const card = async tankId =>
      (
        await db.execute("SELECT * FROM st_tank_cards WHERE tank_id=?", [
          tankId,
        ])
      )[0][0];
    const fuels = ["Motorin", "Benzin 95", "LPG"];
    const today = Date.parse(access.anchorDay + "T00:00:00+03:00"),
      first = today - 59 * 86400000;
    for (let stationIndex = 0; stationIndex < stations.length; stationIndex++) {
      const station = stations[stationIndex],
        stationId = station.id,
        owner = actors[station.group + "-owner"],
        accountant = actors[station.group + "-accountant"],
        fuelActor = actors[stationIndex + "-fuel"],
        marketActor = actors[stationIndex + "-market"];
      const supplier = (
        await op(station.code + "-supplier", owner, "/supplier", {
          stationId,
          name: "DEMO " + station.code + " Yakıt ve Market Tedarikçisi",
          creditLimitMinor: 500000000,
        })
      ).id;
      const debtors = [];
      for (let i = 0; i < 3; i++)
        debtors.push(
          (
            await op(station.code + "-debtor-" + i, owner, "/debtor", {
              stationId,
              name: "DEMO " + station.code + " Filo " + (i + 1),
              type: "COMPANY",
            })
          ).id
        );
      const equipment = [];
      for (let f = 0; f < 3; f++) {
        const nozzleId = (
          await op(station.code + "-equipment-" + f, owner, "/fuel/equipment", {
            stationId,
            fuel: fuels[f],
            tank: "DEMO Tank " + (f + 1),
            pump: "DEMO Pompa " + (f + 1),
            nozzle: "Tabanca " + (f + 1),
          })
        ).id;
        const [[n]] = await db.execute(
          "SELECT tank_id FROM st_fuel_nozzles WHERE id=?",
          [nozzleId]
        );
        equipment.push({
          nozzleId,
          tankId: n.tank_id,
          meterMl: 100000000 + f * 10000000,
        });
        await op(station.code + "-card-" + f, owner, "/tank/card", {
          stationId,
          tankId: n.tank_id,
          number: String(f + 1),
          capacityMl: 25000000,
          criticalMl: 2000000,
          toleranceMl: 50000,
          note: "DEMO kapasite tanımı",
          evidence: "DEMO tank teknik kartı",
        });
        const opening = await op(
          station.code + "-opening-" + f,
          owner,
          "/tank/request",
          {
            stationId,
            tankId: n.tank_id,
            expectedRevision: 1,
            kind: "OPENING",
            targetMl: 10000000,
            reference: "DEMO-OPEN-" + station.code + "-" + f,
            note: "DEMO başlangıç stoku",
            evidence: "DEMO ölçüm tutanağı",
          }
        );
        await op(
          station.code + "-opening-approve-" + f,
          accountant,
          "/tank/review",
          {
            stationId,
            tankId: n.tank_id,
            stockRequestId: opening.id,
            expectedRevision: 1,
            decision: "APPROVE",
            note: "DEMO bağımsız açılış onayı",
            evidence: "DEMO ikinci kişi kontrolü",
          }
        );
        await db.execute(
          "UPDATE st_tank_requests SET created_at=? WHERE id=?",
          [new Date(first - 3600000), opening.id]
        );
        await db.execute(
          "UPDATE st_tank_ledger SET created_at=? WHERE request_id=?",
          [new Date(first - 3600000), opening.id]
        );
      }
      const products = [];
      for (let p = 0; p < 3; p++) {
        const product = await op(
          station.code + "-product-" + p,
          owner,
          "/product",
          {
            stationId,
            name: ["DEMO İçme Suyu", "DEMO Kahve", "DEMO Atıştırmalık"][p],
            barcode: station.code + "-SKU-" + p,
            minimumQty: 20,
            purchasePriceMinor: [1000, 2000, 1500][p],
            salePriceMinor: [1500, 3500, 2500][p],
            supplierId: supplier,
          }
        );
        products.push({ id: product.id, price: [1500, 3500, 2500][p] });
        await op(station.code + "-market-opening-" + p, owner, "/stock", {
          stationId,
          productId: product.id,
          kind: "RECEIPT",
          quantity: 1000,
          reference: "DEMO 60 günlük market açılış stoğu",
        });
      }
      for (let day = 0; day < 60; day++) {
        const date = new Date(first + day * 86400000),
          start = new Date(date.getTime() + 60000),
          end = new Date(date.getTime() + 8 * 3600000),
          key = station.code + "-" + day;
        if (end.getTime() >= Date.now())
          throw Error("DEMO_HISTORICAL_WINDOW_NOT_FINISHED");
        if (day > 0 && day % 10 === 0)
          for (let f = 0; f < 3; f++) {
            const e = equipment[f],
              c = await card(e.tankId),
              volume = [6500000, 3300000, 2200000][f];
            const r = await op(key + "-delivery-" + f, owner, "/tank/request", {
              stationId,
              tankId: e.tankId,
              expectedRevision: Number(c.revision),
              kind: "DELIVERY",
              supplierId: supplier,
              reference: "DEMO-IRS-" + key + "-" + f,
              documentMl: volume,
              measuredMl: volume,
              note: "DEMO tanker irsaliyesi ve eşit fiziksel ölçüm",
              evidence: "DEMO-IRS-" + key + "-" + f,
            });
            await op(
              key + "-delivery-approve-" + f,
              accountant,
              "/tank/review",
              {
                stationId,
                tankId: e.tankId,
                stockRequestId: r.id,
                expectedRevision: Number(c.revision),
                decision: "APPROVE",
                note: "DEMO bağımsız teslim onayı",
                evidence: "DEMO irsaliye + ölçüm",
              }
            );
            await db.execute(
              "UPDATE st_tank_requests SET created_at=? WHERE id=?",
              [new Date(start.getTime() - 30000), r.id]
            );
            await db.execute(
              "UPDATE st_tank_ledger SET created_at=? WHERE request_id=?",
              [new Date(start.getTime() - 30000), r.id]
            );
            await op(key + "-payable-" + f, owner, "/payable", {
              stationId,
              supplierId: supplier,
              amountMinor: Math.round((volume / 1000) * [4100, 4300, 2100][f]),
              dueDate: new Date(date.getTime() + 30 * 86400000)
                .toISOString()
                .slice(0, 10),
              reference: "DEMO-IRS-" + key + "-" + f,
            });
          }
        const shift = await op(key + "-shift", owner, "/shift", {
          stationId,
          label:
            "DEMO " +
            new Date(date.getTime() + 3 * 3600000).toISOString().slice(0, 10) +
            " Sabah",
          startsAt: start.toISOString(),
          endsAt: end.toISOString(),
        });
        const prices = [4600, 4800, 2600].map(
            p => p + Math.floor(day / 10) * 100
          ),
          volumes = [
            600000 + (day % 7) * 1000,
            300000 + (day % 5) * 1000,
            200000 + (day % 3) * 1000,
          ];
        const opened = await op(
          key + "-fuel-open",
          fuelActor,
          "/account/open",
          {
            stationId,
            shiftId: shift.id,
            businessUnit: "FUEL",
            openingFloatMinor: 100000,
            readingAt: new Date(start.getTime() + 1000).toISOString(),
            openingReadings: equipment.map((e, f) => ({
              nozzleId: e.nozzleId,
              meterMl: e.meterMl,
              priceMinor: prices[f],
            })),
          }
        );
        let revision = opened.revision;
        const accountId = opened.id;
        let totalMinor = 0;
        const closingPrices = [...prices];
        for (let f = 0; f < 3; f++) {
          if (day % 15 === 0) {
            const middle = volumes[f] / 2;
            revision = (
              await op(key + "-price-" + f, fuelActor, "/fuel/price", {
                accountId,
                expectedRevision: revision,
                nozzleId: equipment[f].nozzleId,
                meterMl: equipment[f].meterMl + middle,
                priceMinor: prices[f] + 50,
                readingAt: new Date(
                  start.getTime() + 4 * 3600000 + f * 1000
                ).toISOString(),
                note: "DEMO vardiya içi fiyat değişimi",
                evidence: "DEMO ara sayaç",
              })
            ).revision;
            closingPrices[f] += 50;
            totalMinor +=
              Math.round((middle * prices[f]) / 1000) +
              Math.round(((volumes[f] - middle) * closingPrices[f]) / 1000);
          } else totalMinor += Math.round((volumes[f] * prices[f]) / 1000);
        }
        const cashMinor = Math.floor(
            (totalMinor * (day % 11 === 0 ? 45 : 55)) / 100
          ),
          cardMinor = Math.floor((totalMinor * 35) / 100),
          ibanMinor = day % 11 === 0 ? Math.floor((totalMinor * 10) / 100) : 0,
          debtMinor = totalMinor - cashMinor - cardMinor - ibanMinor;
        for (const [kind, amountMinor] of [
          ["CASH", cashMinor],
          ["IBAN", ibanMinor],
          ["DEBT", debtMinor],
        ])
          if (amountMinor)
            revision = (
              await op(key + "-pay-" + kind, fuelActor, "/payment", {
                accountId,
                expectedRevision: revision,
                kind,
                amountMinor,
                ...(kind === "DEBT" ? { debtorId: debtors[day % 3] } : {}),
                reference:
                  kind === "IBAN"
                    ? "DEMO/SİM banka teyidi bekleniyor"
                    : "DEMO günlük satış",
              })
            ).revision;
        revision = (
          await op(key + "-slip", fuelActor, "/slip", {
            accountId,
            expectedRevision: revision,
            amountMinor: cardMinor,
            terminalId: "DEMO-POS-" + station.code,
            reference: "DEMO-RRN-" + key,
            transactionAt: new Date(end.getTime() - 60000).toISOString(),
            note: "DEMO/SİM manuel POS beyanı; banka entegrasyonu değildir",
          })
        ).revision;
        revision = (
          await op(key + "-fuel-close", fuelActor, "/fuel/close", {
            accountId,
            expectedRevision: revision,
            readingAt: new Date(end.getTime() - 1000).toISOString(),
            readings: equipment.map((e, f) => ({
              nozzleId: e.nozzleId,
              meterMl: e.meterMl + volumes[f],
              priceMinor: closingPrices[f],
            })),
            reportedMl: volumes.reduce((s, v) => s + v, 0),
            note: "DEMO sayaç kapanışı",
            evidence: "DEMO manuel sayaç tutanağı",
          })
        ).revision;
        revision = (
          await op(key + "-submit", fuelActor, "/account/submit", {
            accountId,
            expectedRevision: revision,
            countedCashMinor: cashMinor + 100000,
          })
        ).revision;
        revision = (
          await op(key + "-cash-receive", owner, "/account/cash-receive", {
            accountId,
            expectedRevision: revision,
            receivedMinor: cashMinor,
          })
        ).revision;
        revision = (
          await op(key + "-approve1", owner, "/account/approve", {
            accountId,
            expectedRevision: revision,
            note: "DEMO birinci bağımsız onay",
          })
        ).revision;
        await op(key + "-approve2", accountant, "/account/approve", {
          accountId,
          expectedRevision: revision,
          note: "DEMO ikinci bağımsız onay",
        });
        const collection = await op(key + "-collection", owner, "/collection", {
          stationId,
          debtorId: debtors[day % 3],
          amountMinor: Math.floor(debtMinor / 2),
          reference: "DEMO cari satış sonrası kısmi tahsilat",
        });
        const market = await op(
          key + "-market-open",
          marketActor,
          "/account/open",
          {
            stationId,
            shiftId: shift.id,
            businessUnit: "MARKET",
            openingFloatMinor: 20000,
          }
        );
        let mr = market.revision,
          marketTotal = 0;
        for (let p = 0; p < 3; p++) {
          const quantity = 1 + ((day + p) % 3);
          marketTotal += quantity * products[p].price;
          await op(key + "-market-sale-" + p, marketActor, "/stock", {
            stationId,
            productId: products[p].id,
            kind: "SALE",
            quantity,
            reference: "DEMO-MARKET:" + market.id,
          });
        }
        mr = (
          await op(key + "-market-cash", marketActor, "/payment", {
            accountId: market.id,
            expectedRevision: mr,
            kind: "CASH",
            amountMinor: marketTotal,
            reference: "DEMO market satışı manuel hesap eşleştirmesi",
          })
        ).revision;
        mr = (
          await op(key + "-market-source", owner, "/account/source", {
            accountId: market.id,
            expectedRevision: mr,
            sourceSalesMinor: marketTotal,
            sourceRef: "DEMO-MARKET:" + market.id,
          })
        ).revision;
        mr = (
          await op(key + "-market-submit", marketActor, "/account/submit", {
            accountId: market.id,
            expectedRevision: mr,
            countedCashMinor: marketTotal + 20000,
          })
        ).revision;
        mr = (
          await op(key + "-market-handover", owner, "/account/cash-receive", {
            accountId: market.id,
            expectedRevision: mr,
            receivedMinor: marketTotal,
          })
        ).revision;
        mr = (
          await op(key + "-market-approve1", owner, "/account/approve", {
            accountId: market.id,
            expectedRevision: mr,
          })
        ).revision;
        await op(key + "-market-approve2", accountant, "/account/approve", {
          accountId: market.id,
          expectedRevision: mr,
        });
        await op(key + "-shift-close", owner, "/shift/close", {
          stationId,
          shiftId: shift.id,
          endsAt: end.toISOString(),
        });
        for (const id of [accountId, market.id]) {
          await db.execute(
            "UPDATE st_accounts SET created_at=?,submitted_at=? WHERE id=?",
            [start, end, id]
          );
          await db.execute(
            "UPDATE st_payments SET created_at=? WHERE account_id=?",
            [new Date(end.getTime() - 60000), id]
          );
          await db.execute(
            "UPDATE st_account_signatures SET created_at=? WHERE account_id=?",
            [end, id]
          );
          await db.execute(
            "UPDATE st_tank_ledger SET created_at=? WHERE account_id=?",
            [end, id]
          );
        }
        if (collection.id)
          await db.execute("UPDATE st_payments SET created_at=? WHERE id=?", [
            end,
            collection.id,
          ]);
        for (let f = 0; f < 3; f++) equipment[f].meterMl += volumes[f];
        if (day % 10 === 9)
          console.log(
            JSON.stringify({ station: station.code, completedDays: day + 1 })
          );
      }
      const activeStart = new Date(today + 9 * 3600000),
        liveKey = station.code + "-active";
      const shift = await op(liveKey + "-shift", owner, "/shift", {
        stationId,
        label: "DEMO Aktif Vardiya",
        startsAt: activeStart.toISOString(),
      });
      const active = await op(liveKey + "-fuel", fuelActor, "/account/open", {
        stationId,
        shiftId: shift.id,
        businessUnit: "FUEL",
        openingFloatMinor: 100000,
        readingAt: new Date(activeStart.getTime() + 1000).toISOString(),
        openingReadings: equipment.map((e, f) => ({
          nozzleId: e.nozzleId,
          meterMl: e.meterMl,
          priceMinor: [5200, 5400, 3200][f],
        })),
      });
      await op(liveKey + "-market", marketActor, "/account/open", {
        stationId,
        shiftId: shift.id,
        businessUnit: "MARKET",
        openingFloatMinor: 20000,
      });
      let rev = active.revision;
      for (const kind of ["TTS", "GIFT_LOAD", "GIFT_USE", "PARTNER"])
        rev = (
          await op(liveKey + "-" + kind, fuelActor, "/icmal/special", {
            accountId: active.id,
            expectedRevision: rev,
            kind,
            source: "DEMO/SİM taslak",
            provider: "DEMO sağlayıcı; iş kuralı onayı bekliyor",
            reference: "DEMO-" + kind + "-" + station.code,
            amountMinor: 5000,
            volumeMl: kind === "GIFT_LOAD" ? 0 : 1000,
            note: "Kesinleşmemiş iş modeli; satış/tahsilat toplamına dahil edilmez",
            evidence: "DEMO iş kuralı taslağı",
          })
        ).revision;
      for (const e of equipment) {
        const c = await card(e.tankId);
        await op(
          liveKey + "-measure-" + e.nozzleId,
          fuelActor,
          "/tank/measure",
          {
            stationId,
            tankId: e.tankId,
            expectedRevision: Number(c.revision),
            measuredMl: Number(c.stock_ml),
            note: "DEMO fiziksel ölçüm; teorik stokla eşit",
            evidence: "DEMO sentetik ölçüm",
          }
        );
      }
      station.equipment = equipment;
      station.activeAccountId = active.id;
      station.activeShiftId = shift.id;
      station.supplierId = supplier;
      station.debtorIds = debtors;
      await save(folder + "/access.json", access);
    }
    await db.execute(
      "INSERT INTO st_audit(tenant_id,actor_user_id,action,entity_id) VALUES (?,?,'BUSINESS_DEMO_V1_COMPLETE',?)",
      [uid("tenant-a"), actors["a-owner"].id, uid("seed-complete")]
    );
    await save(folder + "/access.json", access);
    await writeFile(
      folder + "/LOGIN.txt",
      "YALNIZ YEREL DEMO - http://127.0.0.1:3001\nBu dosyayı paylaşmayın veya Git'e eklemeyin.\n\n" +
        Object.values(actors)
          .map(a => a.role + " | " + a.email + " | " + a.password)
          .join("\n"),
      { mode: 0o600 }
    );
    console.log(
      JSON.stringify({
        ok: true,
        database: demoDatabase,
        companies: 2,
        stations: 3,
        historicalDays: 60,
        closedShifts: 180,
        closedAccounts: 360,
        activeShifts: 3,
        users: Object.keys(actors).length,
      })
    );
    await normalizeDemoDates();
  } finally {
    await db.end();
  }
}
if (process.argv[1]?.endsWith("demo-seed.mjs"))
  seed().catch(e => {
    console.error(
      e.message?.includes("password") ? "DEMO_SEED_FAILED" : e.message
    );
    process.exitCode = 1;
  });

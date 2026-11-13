import { randomUUID } from "node:crypto";
import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import { calculateFuel, fuelInteger } from "../../shared/fuel";
import { execute, first, rows } from "./db";
import {
  requireId,
  requireString,
  safeDate,
  mysqlDate,
  optionalString,
} from "./domain";
import { rejectCardData, safeAdd } from "./safety";
import { fail } from "./types";
import { icmalAdjustments } from "./icmal";

type Row = RowDataPacket & Record<string, any>;
export type FuelAccount = {
  id: string;
  tenant_id: string;
  station_id: string;
  shift_id: string;
  business_unit: string;
  status: string;
  created_at?: unknown;
};
function integer(value: unknown, label: string, positive = false) {
  try {
    return fuelInteger(value, label, positive);
  } catch (e) {
    fail("FUEL_INVALID", (e as Error).message);
  }
}
export async function fuelEquipment(c: PoolConnection, stationId: string) {
  return rows<Row[]>(
    c,
    `SELECT n.id, n.label, n.tank_id AS tankId, n.pump_id AS pumpId,
    t.label AS tank, p.label AS pump, f.id AS fuelTypeId, f.name AS fuel
    FROM st_fuel_nozzles n JOIN st_fuel_tanks t ON t.id=n.tank_id
    JOIN st_fuel_pumps p ON p.id=n.pump_id JOIN st_fuel_types f ON f.id=t.fuel_type_id
    WHERE n.station_id=? ORDER BY p.label,n.label`,
    [stationId]
  );
}
export async function addFuelEquipment(
  c: PoolConnection,
  tenantId: string,
  stationId: string,
  body: Record<string, unknown>
) {
  // All equipment/open operations serialize on the existing station row.
  await first<Row>(c, `SELECT id FROM st_stations WHERE id=? FOR UPDATE`, [
    stationId,
  ]);
  const active = await first<Row>(
    c,
    `SELECT b.account_id FROM st_fuel_batches b JOIN st_accounts a ON a.id=b.account_id WHERE a.station_id=? AND a.status IN ('OPEN','SUBMITTED','IN_REVIEW') LIMIT 1`,
    [stationId]
  );
  if (active)
    fail(
      "FUEL_EQUIPMENT_LOCKED",
      "Açık sayaç hesabı varken donanım eklenemez.",
      409
    );
  const labels = Object.fromEntries(
    ["fuel", "tank", "pump", "nozzle"].map(key => [
      key,
      requireString(body[key], key, { max: 64 }),
    ])
  );
  Object.values(labels).forEach(value => rejectCardData(value));
  let fuel = await first<Row>(
    c,
    `SELECT id FROM st_fuel_types WHERE station_id=? AND name=?`,
    [stationId, labels.fuel]
  );
  if (!fuel) {
    fuel = { id: randomUUID() } as Row;
    await execute(
      c,
      `INSERT INTO st_fuel_types (id,tenant_id,station_id,name) VALUES (?,?,?,?)`,
      [fuel.id, tenantId, stationId, labels.fuel]
    );
  }
  let tank = await first<Row>(
    c,
    `SELECT id,fuel_type_id FROM st_fuel_tanks WHERE station_id=? AND label=?`,
    [stationId, labels.tank]
  );
  if (tank && tank.fuel_type_id !== fuel.id)
    fail("FUEL_TANK_CONFLICT", "Tank farklı yakıt türüne bağlı.", 409);
  if (!tank) {
    tank = { id: randomUUID() } as Row;
    await execute(
      c,
      `INSERT INTO st_fuel_tanks (id,station_id,fuel_type_id,label) VALUES (?,?,?,?)`,
      [tank.id, stationId, fuel.id, labels.tank]
    );
  }
  let pump = await first<Row>(
    c,
    `SELECT id FROM st_fuel_pumps WHERE station_id=? AND label=?`,
    [stationId, labels.pump]
  );
  if (!pump) {
    pump = { id: randomUUID() } as Row;
    await execute(
      c,
      `INSERT INTO st_fuel_pumps (id,station_id,label) VALUES (?,?,?)`,
      [pump.id, stationId, labels.pump]
    );
  }
  const id = randomUUID();
  await execute(
    c,
    `INSERT INTO st_fuel_nozzles (id,station_id,tank_id,pump_id,label) VALUES (?,?,?,?,?)`,
    [id, stationId, tank.id, pump.id, labels.nozzle]
  );
  return { id };
}
function inputReadings(value: unknown, expected: string[]) {
  if (
    !Array.isArray(value) ||
    !expected.length ||
    value.length !== expected.length
  )
    fail(
      "FUEL_READINGS_REQUIRED",
      "Her tabanca için tam bir okuma gerekli; Sayaç mutabakatı ekranını kullanın.",
      409
    );
  const seen = new Set<string>();
  const result = value.map((r: any) => {
    if (!r || typeof r !== "object")
      fail("FUEL_INVALID", "Okuma nesnesi gerekli.");
    const nozzleId = requireId(r.nozzleId, "nozzleId");
    if (!expected.includes(nozzleId) || seen.has(nozzleId))
      fail(
        "FUEL_DUPLICATE",
        "Tabanca eksik, mükerrer veya kapsam dışında.",
        409
      );
    seen.add(nozzleId);
    return {
      nozzleId,
      meterMl: integer(r.meterMl, "Sayaç"),
      priceMinor: integer(r.priceMinor, "Fiyat", true),
    };
  });
  return result;
}
async function insertReading(
  c: PoolConnection,
  accountId: string,
  nozzleId: string,
  seq: number,
  kind: string,
  meterMl: number,
  priceMinor: number,
  at: string,
  actorId: number
) {
  await execute(
    c,
    `INSERT INTO st_fuel_readings (id,account_id,nozzle_id,sequence_no,kind,meter_ml,price_minor,reading_at,created_by) VALUES (?,?,?,?,?,?,?,?,?)`,
    [
      randomUUID(),
      accountId,
      nozzleId,
      seq,
      kind,
      meterMl,
      priceMinor,
      at,
      actorId,
    ]
  );
}
async function readingTime(
  c: PoolConnection,
  account: FuelAccount,
  value: unknown,
  previous?: unknown
) {
  const at = safeDate(value, "readingAt");
  const shift = await first<Row>(
    c,
    `SELECT starts_at, CURRENT_TIMESTAMP(3) AS now_at FROM st_shifts WHERE id=?`,
    [account.shift_id]
  );
  const ms = (v: unknown) =>
    new Date(String(v).replace(" ", "T") + "Z").getTime();
  if (
    !shift ||
    at.getTime() < ms(shift.starts_at) ||
    at.getTime() > ms(shift.now_at) ||
    (previous && at.getTime() <= ms(previous))
  )
    fail(
      "FUEL_READING_TIME",
      "Okuma zamanı vardiya başlangıcından sonra, şimdiye kadar ve önceki okumadan ileri olmalı.",
      409
    );
  return mysqlDate(at);
}
export async function openFuel(
  c: PoolConnection,
  account: FuelAccount,
  actorId: number,
  body: Record<string, unknown>
) {
  if (account.business_unit !== "FUEL") return;
  await first<Row>(c, `SELECT id FROM st_stations WHERE id=? FOR UPDATE`, [
    account.station_id,
  ]);
  const equipment = await fuelEquipment(c, account.station_id);
  if (!equipment.length) return;
  const input = inputReadings(
    body.openingReadings,
    equipment.map(r => r.id)
  );
  const at = await readingTime(c, account, body.readingAt);
  await execute(c, `INSERT INTO st_fuel_batches (account_id) VALUES (?)`, [
    account.id,
  ]);
  for (const r of input) {
    const busy = await first<Row>(
      c,
      `SELECT x.account_id FROM st_fuel_assignments x JOIN st_fuel_batches b ON b.account_id=x.account_id WHERE x.nozzle_id=? AND b.closed=FALSE LIMIT 1`,
      [r.nozzleId]
    );
    if (busy)
      fail(
        "FUEL_NOZZLE_BUSY",
        "Tabanca başka bir açık sayaç hesabına bağlı.",
        409
      );
    const last = await first<Row>(
      c,
      `SELECT meter_ml, reading_at FROM st_fuel_readings WHERE nozzle_id=? ORDER BY reading_at DESC, sequence_no DESC LIMIT 1`,
      [r.nozzleId]
    );
    if (
      last &&
      (Number(last.meter_ml) !== r.meterMl || at <= String(last.reading_at))
    )
      fail(
        "FUEL_CONTINUITY",
        "Açılış önceki son sayaçla aynı, zamanı ileri olmalı; devir/sıfırlama otomatik kabul edilmez.",
        409
      );
    await execute(
      c,
      `INSERT INTO st_fuel_assignments (shift_id,nozzle_id,account_id) VALUES (?,?,?)`,
      [account.shift_id, r.nozzleId, account.id]
    );
    await insertReading(
      c,
      account.id,
      r.nozzleId,
      0,
      "OPEN",
      r.meterMl,
      r.priceMinor,
      at,
      actorId
    );
  }
}
export async function fuelSnapshot(
  c: PoolConnection,
  accountId: string,
  collectedMinor: number
) {
  const batch = await first<Row>(
    c,
    `SELECT * FROM st_fuel_batches WHERE account_id=?`,
    [accountId]
  );
  if (!batch) return null;
  const readings = await rows<Row[]>(
    c,
    `SELECT nozzle_id AS nozzleId,sequence_no AS sequenceNo,kind,meter_ml AS meterMl,price_minor AS priceMinor,reading_at AS readingAt FROM st_fuel_readings WHERE account_id=? ORDER BY nozzle_id,sequence_no`,
    [accountId]
  );
  const groups = new Map<string, Row[]>();
  for (const r of readings) {
    r.meterMl = Number(r.meterMl);
    r.priceMinor = Number(r.priceMinor);
    const group = groups.get(r.nozzleId) ?? [];
    group.push(r);
    groups.set(r.nozzleId, group);
  }
  let soldMl = 0,
    expectedMinor = 0;
  for (const group of groups.values())
    if (group.length > 1) {
      const total = calculateFuel(group as any);
      soldMl = safeAdd(soldMl, total.soldMl);
      expectedMinor = safeAdd(expectedMinor, total.expectedMinor);
    }
  const icmal = await icmalAdjustments(c, accountId, readings as any);
  const commercialMinor = icmal?.commercialMinor ?? expectedMinor;
  return {
    accountId,
    closed: !!Number(batch.closed),
    reportedMl: batch.reported_ml === null ? null : Number(batch.reported_ml),
    note: batch.note,
    evidence: batch.evidence,
    readings,
    soldMl,
    expectedMinor: commercialMinor,
    meterExpectedMinor: expectedMinor,
    icmal,
    collectedMinor,
    litreDifferenceMl:
      batch.reported_ml === null ? null : Number(batch.reported_ml) - soldMl,
    amountDifferenceMinor: collectedMinor - commercialMinor,
  };
}
export async function updateFuel(
  c: PoolConnection,
  account: FuelAccount,
  actorId: number,
  body: Record<string, unknown>,
  kind: "PRICE" | "CLOSE"
) {
  if (account.business_unit !== "FUEL" || account.status !== "OPEN")
    fail(
      "ACCOUNT_LOCKED",
      "Sayaç yalnız açık akaryakıt hesabında değişebilir.",
      409
    );
  await first<Row>(c, `SELECT id FROM st_stations WHERE id=? FOR UPDATE`, [
    account.station_id,
  ]);
  const batch = await first<Row>(
    c,
    `SELECT * FROM st_fuel_batches WHERE account_id=? FOR UPDATE`,
    [account.id]
  );
  if (!batch) fail("FUEL_NOT_STARTED", "Sayaç açılışı bulunamadı.", 409);
  if (kind === "PRICE" && Number(batch.closed))
    fail("FUEL_CLOSED", "Kapanmış sayaca fiyat noktası eklenemez.", 409);
  const previous = await rows<Row[]>(
    c,
    `SELECT r.* FROM st_fuel_readings r WHERE r.account_id=? AND r.sequence_no=(SELECT MAX(q.sequence_no) FROM st_fuel_readings q WHERE q.account_id=r.account_id AND q.nozzle_id=r.nozzle_id) ORDER BY r.nozzle_id`,
    [account.id]
  );
  const ids =
    kind === "PRICE"
      ? [requireId(body.nozzleId, "nozzleId")]
      : previous.map(r => r.nozzle_id);
  if (!previous.some(r => r.nozzle_id === ids[0]))
    fail("FUEL_NOZZLE_FORBIDDEN", "Tabanca bu hesaba bağlı değil.", 403);
  const input = inputReadings(kind === "PRICE" ? [body] : body.readings, ids);
  const changes = [];
  for (const r of input) {
    const p = previous.find(v => v.nozzle_id === r.nozzleId)!;
    if (p.kind === "CLOSE") {
      const later = await first<Row>(
        c,
        `SELECT id FROM st_fuel_readings WHERE nozzle_id=? AND account_id<>? AND reading_at>? LIMIT 1`,
        [r.nozzleId, account.id, p.reading_at]
      );
      if (later)
        fail(
          "FUEL_SUCCESSOR_EXISTS",
          "Sonraki vardiya açılmış; önceki kapanış değiştirilemez.",
          409
        );
    }
    // A corrected CLOSE replaces only the last reading, preserving all price boundaries.
    const prior =
      p.kind === "CLOSE"
        ? await first<Row>(
            c,
            `SELECT * FROM st_fuel_readings WHERE account_id=? AND nozzle_id=? AND sequence_no=?`,
            [account.id, r.nozzleId, Number(p.sequence_no) - 1]
          )
        : p;
    if (!prior) fail("FUEL_INVALID", "Önceki fiyat noktası bulunamadı.", 409);
    const at = await readingTime(c, account, body.readingAt, prior.reading_at);
    if (r.meterMl < Number(prior.meter_ml))
      fail("FUEL_METER_REGRESSION", "Sayaç gerileyemez.", 409);
    if (kind === "CLOSE" && r.priceMinor !== Number(prior.price_minor))
      fail(
        "FUEL_PRICE_BOUNDARY_REQUIRED",
        "Fiyat değişimi için ara sayaç okuması gerekir.",
        409
      );
    if (kind === "PRICE" && r.priceMinor === Number(prior.price_minor))
      fail("FUEL_PRICE_UNCHANGED", "Yeni fiyat önceki fiyatla aynı.", 409);
    if (p.kind === "CLOSE")
      await execute(
        c,
        `DELETE FROM st_fuel_readings WHERE account_id=? AND nozzle_id=? AND sequence_no=?`,
        [account.id, r.nozzleId, p.sequence_no]
      );
    await insertReading(
      c,
      account.id,
      r.nozzleId,
      Number(prior.sequence_no) + 1,
      kind,
      r.meterMl,
      r.priceMinor,
      at,
      actorId
    );
    changes.push({ nozzleId: r.nozzleId, previous: p, next: r });
  }
  const note = optionalString(body.note, "note", 1000),
    evidence = optionalString(body.evidence, "evidence", 500);
  if (note) rejectCardData(note);
  if (evidence) rejectCardData(evidence);
  if (kind === "CLOSE") {
    const reported = integer(body.reportedMl, "Beyan edilen litre");
    if (!note || !evidence)
      fail(
        "FUEL_EVIDENCE_REQUIRED",
        "Kapanış için açıklama ve sayaç kanıt referansı gerekli.",
        409
      );
    await execute(
      c,
      `UPDATE st_fuel_batches SET closed=TRUE,reported_ml=?,note=?,evidence=? WHERE account_id=?`,
      [reported, note, evidence, account.id]
    );
    const total = await fuelSnapshot(c, account.id, 0);
    await execute(
      c,
      `UPDATE st_accounts SET source_sales_minor=?,source_ref=? WHERE id=?`,
      [total!.expectedMinor, "MANUEL SAYAÇ: " + account.id, account.id]
    );
  } else if (!note || !evidence)
    fail(
      "FUEL_EVIDENCE_REQUIRED",
      "Fiyat değişim açıklaması ve kanıt referansı gerekli.",
      409
    );
  return { changes, note, evidence };
}
export async function correctFuel(
  c: PoolConnection,
  account: FuelAccount,
  actorId: number,
  body: Record<string, unknown>
) {
  if (account.status !== "OPEN" || account.business_unit !== "FUEL")
    fail(
      "ACCOUNT_LOCKED",
      "Düzeltme için hesap açık veya bağımsız yetkili tarafından düzeltmeye gönderilmiş olmalı.",
      409
    );
  await first<Row>(c, `SELECT id FROM st_stations WHERE id=? FOR UPDATE`, [
    account.station_id,
  ]);
  const nozzleId = requireId(body.nozzleId, "nozzleId"),
    sequence = integer(body.sequenceNo, "Okuma sırası");
  const batch = await first<Row>(
    c,
    `SELECT * FROM st_fuel_batches WHERE account_id=? FOR UPDATE`,
    [account.id]
  );
  if (!batch) fail("FUEL_NOT_STARTED", "Sayaç açılışı yok.", 409);
  const points = await rows<Row[]>(
    c,
    `SELECT * FROM st_fuel_readings WHERE account_id=? AND nozzle_id=? ORDER BY sequence_no`,
    [account.id, nozzleId]
  );
  const index = points.findIndex(r => Number(r.sequence_no) === sequence),
    point = points[index];
  if (!point) fail("FUEL_NOZZLE_FORBIDDEN", "Okuma bu hesaba ait değil.", 403);
  const later = await first<Row>(
    c,
    `SELECT id FROM st_fuel_readings WHERE nozzle_id=? AND account_id<>? AND reading_at>? LIMIT 1`,
    [nozzleId, account.id, points.at(-1)!.reading_at]
  );
  if (later)
    fail(
      "FUEL_SUCCESSOR_EXISTS",
      "Sonraki vardiya açılmış; önceki okumalar değiştirilemez.",
      409
    );
  const meterMl = integer(body.meterMl, "Sayaç"),
    priceMinor = integer(body.priceMinor, "Fiyat", true);
  if (index === 0 && meterMl !== Number(point.meter_ml))
    fail(
      "FUEL_OPENING_IMMUTABLE",
      "Açılış sayacı devir zincirini korumak için değiştirilemez.",
      409
    );
  if (
    (index > 0 && meterMl < Number(points[index - 1].meter_ml)) ||
    (index + 1 < points.length && meterMl > Number(points[index + 1].meter_ml))
  )
    fail(
      "FUEL_METER_REGRESSION",
      "Düzeltme önceki/sonraki sayaç sırasını bozamaz.",
      409
    );
  if (
    point.kind === "CLOSE" &&
    priceMinor !== Number(points[index - 1]?.price_minor)
  )
    fail(
      "FUEL_PRICE_BOUNDARY_REQUIRED",
      "Fiyatı kapanışta değil açılış veya fiyat ara noktasında düzeltin.",
      409
    );
  const note = requireString(body.note, "note", { max: 1000 }),
    evidence = requireString(body.evidence, "evidence", { max: 500 });
  rejectCardData(note, evidence);
  await execute(
    c,
    `UPDATE st_fuel_readings SET meter_ml=?,price_minor=? WHERE id=?`,
    [meterMl, priceMinor, point.id]
  );
  if (points[index + 1]?.kind === "CLOSE")
    await execute(c, `UPDATE st_fuel_readings SET price_minor=? WHERE id=?`, [
      priceMinor,
      points[index + 1].id,
    ]);
  if (Number(batch.closed)) {
    const total = await fuelSnapshot(c, account.id, 0);
    await execute(c, `UPDATE st_accounts SET source_sales_minor=? WHERE id=?`, [
      total!.expectedMinor,
      account.id,
    ]);
  }
  return {
    previous: point,
    next: { meterMl, priceMinor },
    note,
    evidence,
    actorId,
  };
}
export async function assertFuelReady(
  c: PoolConnection,
  account: FuelAccount,
  collectedMinor: number
) {
  const snapshot = await fuelSnapshot(c, account.id, collectedMinor);
  if (snapshot?.icmal)
    await icmalAdjustments(c, account.id, snapshot.readings as any, true);
  if (
    snapshot &&
    (!snapshot.closed ||
      snapshot.litreDifferenceMl !== 0 ||
      snapshot.amountDifferenceMinor !== 0)
  )
    fail(
      "FUEL_RECONCILIATION_REQUIRED",
      "Sayaç kapanışı, litre ve tutar farkları çözülmeden teslim/onay yapılamaz.",
      409
    );
  return snapshot;
}

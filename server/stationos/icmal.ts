import { randomUUID } from "node:crypto";
import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import {
  specialKinds,
  testAllocation,
  giftBalance,
  operationalTotals,
  safeSum,
  type SpecialOperation,
  type SpecialModel,
} from "../../shared/icmal";
import { fuelInteger, type FuelPoint } from "../../shared/fuel";
import { execute, rows, first } from "./db";
import {
  requireEnum,
  requireString,
  requireId,
  optionalString,
  requireMoney,
} from "./domain";
import { rejectCardData } from "./safety";
import { fail } from "./types";
import { centralTankInfo, assertTankDeliveryMutable } from "./tank";

type Row = RowDataPacket & Record<string, any>;
type Account = {
  id: string;
  tenant_id: string;
  station_id: string;
  user_id: number;
  business_unit: string;
  status: string;
};
export const SPECIAL_COVERAGE_SQL =
  "COALESCE((SELECT SUM(o.amount_minor) FROM st_shift_special_operations o WHERE o.account_id=a.id AND o.status='RECORDED' AND o.kind IN ('TTS','GIFT_USE','PARTNER') AND o.model IN ('RECEIVABLE','PREPAID')),0)";
export const SPECIAL_PENDING_SQL =
  "(SELECT COUNT(*) FROM st_shift_special_operations o WHERE o.account_id=a.id AND o.status='RECORDED' AND o.settlement='PENDING')";
export const PREPAYMENT_CASH_SQL =
  "COALESCE((SELECT SUM(o.amount_minor) FROM st_shift_special_operations o WHERE o.account_id=a.id AND o.status='RECORDED' AND o.kind='GIFT_LOAD' AND o.settlement='SETTLED' AND o.settlement_method='CASH'),0)";
export function specialRow(r: Row): SpecialOperation {
  return {
    id: r.id,
    accountId: r.account_id,
    kind: r.kind,
    model: r.model,
    status: r.status,
    source: r.source,
    provider: r.provider,
    reference: r.reference,
    plate: r.plate,
    customer: r.customer,
    instrument: r.instrument,
    amountMinor: Number(r.amount_minor),
    volumeMl: Number(r.volume_ml),
    documentMl: r.document_ml === null ? null : Number(r.document_ml),
    nozzleId: r.nozzle_id,
    tankId: r.tank_id,
    startMeterMl: r.start_meter_ml === null ? null : Number(r.start_meter_ml),
    endMeterMl: r.end_meter_ml === null ? null : Number(r.end_meter_ml),
    relatedId: r.related_id,
    paymentId: r.payment_id,
    slipId: r.slip_id,
    settlement: r.settlement,
    settlementMethod: r.settlement_method,
    note: r.note,
    evidence: r.evidence,
    reviewerId: r.reviewer_id,
  };
}
export async function specialOperations(c: PoolConnection, accountId: string) {
  return (
    await rows<Row[]>(
      c,
      `SELECT * FROM st_shift_special_operations WHERE account_id=? ORDER BY created_at,id`,
      [accountId]
    )
  ).map(specialRow);
}
async function enable(c: PoolConnection, account: Account) {
  if (account.business_unit !== "FUEL" || account.status !== "OPEN")
    fail(
      "ACCOUNT_LOCKED",
      "İcmal yalnız açık akaryakıt hesabında düzenlenebilir.",
      409
    );
  const tenant = await first<Row>(
    c,
    `SELECT is_demo FROM st_tenants WHERE id=?`,
    [account.tenant_id]
  );
  if (!Number(tenant?.is_demo))
    fail(
      "DEMO_REQUIRED",
      "Faz 4B özel kayıtları yalnız DEMO firma alanında kullanılabilir.",
      403
    );
  await first<Row>(c, `SELECT id FROM st_stations WHERE id=? FOR UPDATE`, [
    account.station_id,
  ]);
  const batch = await first<Row>(
    c,
    `SELECT account_id FROM st_fuel_batches WHERE account_id=?`,
    [account.id]
  );
  if (!batch)
    fail("FUEL_NOT_STARTED", "İcmal için sayaçlı vardiya hesabı gerekli.", 409);
  await execute(
    c,
    `INSERT INTO st_shift_icmal (account_id) VALUES (?) ON DUPLICATE KEY UPDATE account_id=account_id`,
    [account.id]
  );
}
function volume(value: unknown, label: string) {
  try {
    return fuelInteger(value, label);
  } catch (e) {
    fail("INVALID_VOLUME", (e as Error).message);
  }
}
export async function addSpecial(
  c: PoolConnection,
  account: Account,
  actorId: number,
  body: Record<string, unknown>
) {
  await enable(c, account);
  const kind = requireEnum(body.kind, "kind", specialKinds),
    card = ["TTS", "GIFT_LOAD", "GIFT_USE", "PARTNER"].includes(kind);
  const source = requireString(body.source, "source", { max: 190 }),
    provider = requireString(body.provider, "provider", { max: 190 }),
    reference = requireString(body.reference, "reference", { max: 190 });
  const note = requireString(body.note, "note", { max: 1000 }),
    evidence = requireString(body.evidence, "evidence", { max: 500 });
  const plate = optionalString(body.plate, "plate", 32),
    customer = optionalString(body.customer, "customer", 190),
    instrument = optionalString(body.instrument, "instrument", 64);
  rejectCardData(
    source,
    provider,
    reference,
    note,
    evidence,
    plate,
    customer,
    instrument
  );
  const amount = card ? requireMoney(body.amountMinor, "amountMinor") : 0;
  const ml = volume(body.volumeMl ?? 0, "Litre");
  if (kind === "GIFT_LOAD" && ml !== 0)
    fail("GIFT_LOAD_NOT_SALE", "Gift yükleme litre/satış içeremez.");
  if (kind !== "GIFT_LOAD" && ml <= 0)
    fail("VOLUME_REQUIRED", "Bu işlem için pozitif litre gerekli.");
  const tankId = body.tankId ? requireId(body.tankId, "tankId") : null,
    nozzleId = body.nozzleId ? requireId(body.nozzleId, "nozzleId") : null;
  if (!card) {
    const tank = await first<Row>(
      c,
      `SELECT id FROM st_fuel_tanks WHERE id=? AND station_id=?`,
      [tankId, account.station_id]
    );
    if (!tank) fail("TANK_FORBIDDEN", "Tank bu istasyona ait değil.", 403);
  }
  const start =
      kind === "TEST_OUT" ? volume(body.startMeterMl, "İlk test sayacı") : null,
    end =
      kind === "TEST_OUT" ? volume(body.endMeterMl, "Son test sayacı") : null;
  if (kind === "TEST_OUT") {
    if (end! <= start! || end! - start! !== ml)
      fail(
        "TEST_RANGE_INVALID",
        "Test litresi sayaç aralığıyla aynı olmalı.",
        409
      );
    const assignment = await first<Row>(
      c,
      `SELECT n.id FROM st_fuel_nozzles n JOIN st_fuel_assignments x ON x.nozzle_id=n.id WHERE x.account_id=? AND n.id=? AND n.tank_id=?`,
      [account.id, nozzleId, tankId]
    );
    if (!assignment)
      fail(
        "NOZZLE_FORBIDDEN",
        "Tabanca/tank bu sayaç hesabına bağlı değil.",
        403
      );
  }
  const relatedId =
    kind === "TEST_RETURN" ? requireId(body.relatedId, "relatedId") : null;
  if (relatedId) {
    const original = await first<Row>(
      c,
      `SELECT * FROM st_shift_special_operations WHERE id=? AND account_id=? AND kind='TEST_OUT' AND status='RECORDED' FOR UPDATE`,
      [relatedId, account.id]
    );
    const returned = await first<Row>(
      c,
      `SELECT COALESCE(SUM(volume_ml),0) AS ml FROM st_shift_special_operations WHERE related_id=? AND status='RECORDED'`,
      [relatedId]
    );
    if (
      !original ||
      original.tank_id !== tankId ||
      Number(returned?.ml ?? 0) + ml > Number(original.volume_ml)
    )
      fail(
        "TEST_RETURN_INVALID",
        "Dönüş aynı test/tanka bağlı olmalı ve test çıkışını aşmamalı.",
        409
      );
  }
  const documentMl =
    kind === "TANKER_IN" ? volume(body.documentMl, "Belge litresi") : null;
  if (documentMl === 0)
    fail("DELIVERY_DOCUMENT_REQUIRED", "Tanker belge litresi pozitif olmalı.");
  const id = randomUUID();
  await execute(
    c,
    `INSERT INTO st_shift_special_operations (id,tenant_id,station_id,account_id,kind,model,status,source,provider,reference,plate,customer,instrument,amount_minor,volume_ml,document_ml,nozzle_id,tank_id,start_meter_ml,end_meter_ml,related_id,settlement,note,evidence,created_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      id,
      account.tenant_id,
      account.station_id,
      account.id,
      kind,
      card ? "DRAFT" : "PHYSICAL",
      card ? "DRAFT" : "RECORDED",
      source,
      provider,
      reference,
      plate,
      customer,
      instrument,
      amount,
      ml,
      documentMl,
      nozzleId,
      tankId,
      start,
      end,
      relatedId,
      card ? "DRAFT" : "NOT_APPLICABLE",
      note,
      evidence,
      actorId,
    ]
  );
  return { id, kind };
}
async function wallet(c: PoolConnection, stationId: string) {
  return (
    await rows<Row[]>(
      c,
      `SELECT * FROM st_shift_special_operations WHERE station_id=? AND model='PREPAID' AND status='RECORDED' FOR UPDATE`,
      [stationId]
    )
  ).map(specialRow);
}
export async function reviewSpecial(
  c: PoolConnection,
  account: Account,
  actorId: number,
  body: Record<string, unknown>
) {
  await enable(c, account);
  if (Number(account.user_id) === actorId)
    fail(
      "SELF_APPROVAL_FORBIDDEN",
      "Kendi icmalinizin özel modelini/hesaplaşmasını teyit edemezsiniz.",
      403
    );
  const operation = await first<Row>(
    c,
    `SELECT * FROM st_shift_special_operations WHERE id=? AND account_id=? FOR UPDATE`,
    [requireId(body.operationId, "operationId"), account.id]
  );
  const deliveryReview =
    operation?.status === "RECORDED" &&
    operation.kind === "TANKER_IN" &&
    Number(operation.volume_ml) !== Number(operation.document_ml) &&
    operation.reviewer_id === null;
  if (deliveryReview) {
    const note = requireString(body.note, "note", { max: 1000 }),
      evidence = requireString(body.evidence, "evidence", { max: 500 });
    rejectCardData(note, evidence);
    if (body.model !== "PHYSICAL")
      fail(
        "SPECIAL_MODEL_INVALID",
        "Tanker farkı için fiziksel kabul modeli seçilmeli."
      );
    await execute(
      c,
      `UPDATE st_shift_special_operations SET reviewer_id=? WHERE id=?`,
      [actorId, operation!.id]
    );
    return {
      previous: specialRow(operation!),
      model: "PHYSICAL",
      note,
      evidence,
    };
  }
  if (!operation || operation.status !== "DRAFT")
    fail("SPECIAL_LOCKED", "Yalnız taslak kart işlemi incelenebilir.", 409);
  const model = requireEnum(body.model, "model", [
    "EXISTING_PAYMENT",
    "RECEIVABLE",
    "PREPAID",
  ] as const);
  const o = specialRow(operation);
  if (
    (model === "RECEIVABLE" && !["TTS", "PARTNER"].includes(o.kind)) ||
    (model === "PREPAID" && !["GIFT_LOAD", "GIFT_USE"].includes(o.kind)) ||
    (o.kind === "GIFT_LOAD" && model !== "PREPAID")
  )
    fail(
      "SPECIAL_MODEL_INVALID",
      "Bu kategori için seçilen model geçerli değil."
    );
  if (model === "PREPAID" && !o.instrument)
    fail(
      "GIFT_INSTRUMENT_REQUIRED",
      "Yerel ön ödeme modeli için maskeli kart/cüzdan kodu gerekli."
    );
  const note = requireString(body.note, "note", { max: 1000 }),
    evidence = requireString(body.evidence, "evidence", { max: 500 });
  rejectCardData(note, evidence);
  let paymentId = null,
    slipId = null;
  if (model === "EXISTING_PAYMENT") {
    if (!!body.paymentId === !!body.slipId)
      fail("PAYMENT_LINK_REQUIRED", "Tek ödeme veya slip bağlantısı gerekli.");
    if (body.paymentId) {
      paymentId = requireId(body.paymentId, "paymentId");
      const p = await first<Row>(
        c,
        `SELECT amount_minor,kind,status FROM st_payments WHERE id=? AND account_id=?`,
        [paymentId, account.id]
      );
      if (
        !p ||
        p.kind === "AR_COLLECTION" ||
        p.status !== "POSTED" ||
        Number(p.amount_minor) !== o.amountMinor
      )
        fail(
          "PAYMENT_LINK_INVALID",
          "Satış ödemesi bu hesaba ve aynı tutara ait olmalı.",
          409
        );
    }
    if (body.slipId) {
      slipId = requireId(body.slipId, "slipId");
      const p = await first<Row>(
        c,
        `SELECT amount_minor,status FROM st_slips WHERE id=? AND account_id=?`,
        [slipId, account.id]
      );
      if (
        !p ||
        p.status !== "VERIFIED" ||
        Number(p.amount_minor) !== o.amountMinor
      )
        fail(
          "PAYMENT_LINK_INVALID",
          "Slip bu hesaba ve aynı tutara ait olmalı.",
          409
        );
    }
  }
  if (
    model === "PREPAID" &&
    o.kind === "GIFT_USE" &&
    giftBalance(
      await wallet(c, account.station_id),
      o.provider,
      o.instrument!
    ) < o.amountMinor
  )
    fail(
      "GIFT_BALANCE_INSUFFICIENT",
      "Teyit edilmiş ön ödeme bakiyesi yetersiz; bekleyen yükleme harcanamaz.",
      409
    );
  await execute(
    c,
    `UPDATE st_shift_special_operations SET model=?,status='RECORDED',payment_id=?,slip_id=?,settlement='PENDING',reviewer_id=? WHERE id=?`,
    [model, paymentId, slipId, actorId, o.id]
  );
  return { previous: o, model, note, evidence };
}
export async function settleSpecial(
  c: PoolConnection,
  account: Account,
  actorId: number,
  body: Record<string, unknown>
) {
  await enable(c, account);
  if (Number(account.user_id) === actorId)
    fail(
      "SELF_APPROVAL_FORBIDDEN",
      "Kendi hesabınızın hesaplaşmasını teyit edemezsiniz.",
      403
    );
  const o = await first<Row>(
    c,
    `SELECT * FROM st_shift_special_operations WHERE id=? AND account_id=? FOR UPDATE`,
    [requireId(body.operationId, "operationId"), account.id]
  );
  if (!o || o.status !== "RECORDED" || o.settlement !== "PENDING")
    fail("SPECIAL_LOCKED", "İşlem hesaplaşma teyidi beklemiyor.", 409);
  const method = requireEnum(body.method, "method", [
      "CASH",
      "BANK",
      "PROVIDER",
    ] as const),
    note = requireString(body.note, "note", { max: 1000 }),
    evidence = requireString(body.evidence, "evidence", { max: 500 });
  rejectCardData(note, evidence);
  if (method === "CASH" && o.kind !== "GIFT_LOAD")
    fail(
      "SETTLEMENT_METHOD_INVALID",
      "Fizikî nakit teyidi yalnız Gift yüklemesi için geçerli; satış tahsilatı mevcut ödeme akışında kaydedilir.",
      409
    );
  await execute(
    c,
    `UPDATE st_shift_special_operations SET settlement='SETTLED',settlement_method=?,reviewer_id=? WHERE id=?`,
    [method, actorId, o.id]
  );
  return {
    operationId: o.id,
    method,
    note,
    evidence,
    manualConfirmation: true,
  };
}
export async function voidSpecial(
  c: PoolConnection,
  account: Account,
  actorId: number,
  body: Record<string, unknown>
) {
  await enable(c, account);
  const raw = await first<Row>(
    c,
    `SELECT * FROM st_shift_special_operations WHERE id=? AND account_id=? FOR UPDATE`,
    [requireId(body.operationId, "operationId"), account.id]
  );
  if (!raw || raw.status === "VOID")
    fail("SPECIAL_LOCKED", "İşlem iptal edilemez.", 409);
  const o = specialRow(raw),
    note = requireString(body.note, "note", { max: 1000 }),
    evidence = requireString(body.evidence, "evidence", { max: 500 });
  rejectCardData(note, evidence);
  if (
    o.status === "RECORDED" &&
    o.model !== "PHYSICAL" &&
    actorId === Number(account.user_id)
  )
    fail(
      "SELF_APPROVAL_FORBIDDEN",
      "İncelenmiş kart işleminin iptali bağımsız mali yetkili gerektirir.",
      403
    );
  const children = await first<Row>(
    c,
    `SELECT id FROM st_shift_special_operations WHERE related_id=? AND status<>'VOID' LIMIT 1`,
    [o.id]
  );
  if (children)
    fail(
      "SPECIAL_DEPENDENCY",
      "Önce bağlı fiziksel dönüş iptal edilmeli.",
      409
    );
  if (
    o.kind === "GIFT_LOAD" &&
    o.model === "PREPAID" &&
    o.settlement === "SETTLED" &&
    giftBalance(
      await wallet(c, account.station_id),
      o.provider,
      o.instrument!
    ) < o.amountMinor
  )
    fail(
      "GIFT_BALANCE_IN_USE",
      "Kullanılmış yükleme iptal edilemez; önce bağlı kullanımlar çözülmeli.",
      409
    );
  if (o.kind === "TANKER_IN") await assertTankDeliveryMutable(c, o.id);
  await execute(
    c,
    `UPDATE st_shift_special_operations SET status='VOID' WHERE id=?`,
    [o.id]
  );
  return { previous: o, note, evidence };
}
export async function setTankCheck(
  c: PoolConnection,
  account: Account,
  body: Record<string, unknown>
) {
  await enable(c, account);
  const tankId = requireId(body.tankId, "tankId"),
    opening = volume(body.openingMl, "İlk tank stoku"),
    closing = volume(body.closingMl, "Son tank stoku"),
    evidence = requireString(body.evidence, "evidence", { max: 500 });
  rejectCardData(evidence);
  if (
    !(await first<Row>(
      c,
      `SELECT id FROM st_fuel_tanks WHERE id=? AND station_id=?`,
      [tankId, account.station_id]
    ))
  )
    fail("TANK_FORBIDDEN", "Tank istasyon kapsamında değil.", 403);
  const previous = await first<Row>(
    c,
    `SELECT * FROM st_shift_tank_checks WHERE account_id=? AND tank_id=?`,
    [account.id, tankId]
  );
  await execute(
    c,
    `INSERT INTO st_shift_tank_checks (account_id,tank_id,opening_ml,closing_ml,evidence) VALUES (?,?,?,?,?) ON DUPLICATE KEY UPDATE opening_ml=VALUES(opening_ml),closing_ml=VALUES(closing_ml),evidence=VALUES(evidence)`,
    [account.id, tankId, opening, closing, evidence]
  );
  return { tankId, previous, openingMl: opening, closingMl: closing, evidence };
}
export async function icmalAdjustments(
  c: PoolConnection,
  accountId: string,
  readings: (FuelPoint & { nozzleId: string })[],
  validate = false
) {
  if (
    !(await first<Row>(
      c,
      `SELECT account_id FROM st_shift_icmal WHERE account_id=?`,
      [accountId]
    ))
  )
    return null;
  const operations = await specialOperations(c, accountId),
    active = operations.filter(o => o.status === "RECORDED");
  const assignments = await rows<Row[]>(
    c,
    `SELECT n.id,n.tank_id,t.label FROM st_fuel_assignments x JOIN st_fuel_nozzles n ON n.id=x.nozzle_id JOIN st_fuel_tanks t ON t.id=n.tank_id WHERE x.account_id=?`,
    [accountId]
  );
  const checks = await rows<Row[]>(
    c,
    `SELECT * FROM st_shift_tank_checks WHERE account_id=?`,
    [accountId]
  );
  const nozzleTotals: ({ nozzleId: string; tankId: string } & ReturnType<
    typeof testAllocation
  >)[] = [];
  for (const n of assignments) {
    const points = readings.filter(r => r.nozzleId === n.id);
    if (points.length < 2) continue;
    let total;
    try {
      total = testAllocation(
        points,
        active
          .filter(o => o.kind === "TEST_OUT" && o.nozzleId === n.id)
          .map(o => ({ start: o.startMeterMl!, end: o.endMeterMl! }))
      );
    } catch (e) {
      fail("TEST_RANGE_INVALID", (e as Error).message, 409);
    }
    nozzleTotals.push({ nozzleId: n.id, tankId: n.tank_id, ...total });
  }
  const totals = {
    meterMl: safeSum(nozzleTotals.map(n => n.meterMl)),
    meterMinor: safeSum(nozzleTotals.map(n => n.meterMinor)),
    testMl: safeSum(nozzleTotals.map(n => n.testMl)),
    testMinor: safeSum(nozzleTotals.map(n => n.testMinor)),
    commercialMl: safeSum(nozzleTotals.map(n => n.commercialMl)),
    commercialMinor: safeSum(nozzleTotals.map(n => n.commercialMinor)),
  };
  const tankIds = [
    ...new Set([
      ...assignments.map(n => String(n.tank_id)),
      ...active.filter(o => o.tankId).map(o => o.tankId!),
    ]),
  ];
  const tanks = tankIds.map(tankId => {
    const check = checks.find(r => r.tank_id === tankId),
      meterOutMl = safeSum(
        nozzleTotals.filter(n => n.tankId === tankId).map(n => n.meterMl)
      );
    const deliveryMl = safeSum(
        active
          .filter(o => o.tankId === tankId && o.kind === "TANKER_IN")
          .map(o => o.volumeMl)
      ),
      returnMl = safeSum(
        active
          .filter(o => o.tankId === tankId && o.kind === "TEST_RETURN")
          .map(o => o.volumeMl)
      );
    const openingMl = check ? Number(check.opening_ml) : null,
      closingMl = check ? Number(check.closing_ml) : null;
    const expectedClosingMl =
      openingMl === null
        ? null
        : openingMl + deliveryMl + returnMl - meterOutMl;
    if (expectedClosingMl !== null && !Number.isSafeInteger(expectedClosingMl))
      fail("INVALID_VOLUME", "Tank hesabı sınırı aşıyor.");
    return {
      tankId,
      label: assignments.find(n => n.tank_id === tankId)?.label ?? tankId,
      openingMl,
      closingMl,
      meterOutMl,
      deliveryMl,
      returnMl,
      expectedClosingMl,
      differenceMl:
        closingMl === null || expectedClosingMl === null
          ? null
          : closingMl - expectedClosingMl,
    };
  });
  const cardSales = active.filter(o =>
    ["TTS", "GIFT_USE", "PARTNER"].includes(o.kind)
  );
  if (
    safeSum(cardSales.map(o => o.amountMinor)) > totals.commercialMinor ||
    safeSum(cardSales.map(o => o.volumeMl)) > totals.commercialMl
  )
    fail(
      "SPECIAL_SALE_EXCEEDED",
      "Özel satış sınıfları ticari satışın litre/tutarını aşamaz.",
      409
    );
  const summary = operationalTotals(operations);
  const central = await centralTankInfo(c, tankIds, accountId);
  const centralTanks = central.map(r => ({
    tankId: r.tank_id,
    stockMl: r.stock_ml === null ? null : Number(r.stock_ml),
    measuredMl: r.measured_ml === null ? null : Number(r.measured_ml),
    differenceMl:
      r.measured_revision !== null &&
      r.difference_ml !== null &&
      Number(r.measured_revision) === Number(r.revision)
        ? Number(r.difference_ml)
        : null,
    measurementFresh:
      r.measured_revision !== null &&
      Number(r.measured_revision) === Number(r.revision),
    posted: Number(r.posted) > 0,
  }));
  if (
    validate &&
    (summary.draftCount > 0 ||
      active.some(
        o =>
          o.kind === "TANKER_IN" &&
          o.documentMl !== o.volumeMl &&
          o.reviewerId === null
      ) ||
      tanks.some(t => t.differenceMl !== null && t.differenceMl !== 0) ||
      active.some(
        o =>
          ["TEST_OUT", "TEST_RETURN", "TANKER_IN"].includes(o.kind) &&
          tanks.find(t => t.tankId === o.tankId)?.differenceMl !== 0
      ))
  )
    fail(
      "ICMAL_INCOMPLETE",
      "Taslak işlem veya çözülmemiş/ölçülmemiş tank farkı varken teslim/onay yapılamaz.",
      409
    );
  return {
    ...totals,
    ...summary,
    operations,
    nozzleTotals,
    tanks,
    centralTanks,
    deliveryDocumentDifferenceMl: active
      .filter(o => o.kind === "TANKER_IN")
      .reduce((s, o) => s + o.volumeMl - (o.documentMl ?? o.volumeMl), 0),
    testReturnMl: safeSum(
      active.filter(o => o.kind === "TEST_RETURN").map(o => o.volumeMl)
    ),
  };
}

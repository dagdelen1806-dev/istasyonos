import { randomUUID } from "node:crypto";
import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import { first, rows, execute } from "./db";
import {
  requireId,
  requireString,
  requireInteger,
  requireEnum,
} from "./domain";
import { rejectCardData } from "./safety";
import { fail } from "./types";
import { stockAfter, tankStatus, tankRequestKinds } from "../../shared/tank";
import { testAllocation } from "../../shared/icmal";
import {
  prepareTankerReceipt,
  linkTankerReceipt,
  assertTankerReceiptCurrent,
} from "./tanker-proof";
import { parseDbUtc } from "../../shared/datetime";
type Row = RowDataPacket & Record<string, any>;
type Scope = { tenantId: string; stationId: string };
export {
  demoLock as lockDemoTankStation,
  card as lockTankCard,
  revision as checkTankRevision,
  proof as tankProof,
};
const num = (v: unknown) => {
  const n = Number(v);
  if (!Number.isSafeInteger(n))
    fail("STOCK_RANGE", "Güvenli mililitre tamsayısı gerekli.");
  return n;
};
const volume = (v: unknown, label: string) =>
  requireInteger(v, label, { allowZero: true });
const proof = (body: Record<string, unknown>) => {
  const note = requireString(body.note, "note", { max: 1000 }),
    evidence = requireString(body.evidence, "evidence", { max: 500 });
  rejectCardData(note, evidence);
  return { note, evidence };
};
async function demoLock(c: PoolConnection, scope: Scope) {
  const tenant = await first<Row>(
    c,
    `SELECT is_demo FROM st_tenants WHERE id=?`,
    [scope.tenantId]
  );
  if (!Number(tenant?.is_demo))
    fail(
      "DEMO_REQUIRED",
      "Tank stok yazımları yalnız DEMO firma alanında açık.",
      403
    );
  await first<Row>(
    c,
    `SELECT id FROM st_stations WHERE id=? AND tenant_id=? FOR UPDATE`,
    [scope.stationId, scope.tenantId]
  );
}
async function card(c: PoolConnection, scope: Scope, id: unknown) {
  const r = await first<Row>(
    c,
    `SELECT * FROM st_tank_cards WHERE tank_id=? AND tenant_id=? AND station_id=? FOR UPDATE`,
    [requireId(id, "tankId"), scope.tenantId, scope.stationId]
  );
  if (!r) fail("TANK_NOT_MANAGED", "Tank kartı bu istasyonda bulunamadı.", 404);
  return r;
}
function revision(r: Row, value: unknown) {
  if (num(r.revision) !== requireInteger(value, "expectedRevision"))
    fail(
      "REVISION_CONFLICT",
      "Tank stoku/ayarı değişti; yenileyip tekrar inceleyin.",
      409
    );
}
export async function saveTankCard(
  c: PoolConnection,
  scope: Scope,
  body: Record<string, unknown>
) {
  await demoLock(c, scope);
  const tankId = requireId(body.tankId, "tankId");
  if (
    !(await first<Row>(
      c,
      `SELECT id FROM st_fuel_tanks WHERE id=? AND station_id=?`,
      [tankId, scope.stationId]
    ))
  )
    fail("TANK_FORBIDDEN", "Tank istasyon kapsamınızda değil.", 403);
  const number = requireString(body.number, "number", { max: 64 }),
    capacity = volume(body.capacityMl, "capacityMl"),
    critical = volume(body.criticalMl, "criticalMl"),
    tolerance = volume(body.toleranceMl, "toleranceMl");
  rejectCardData(number);
  const previous = await first<Row>(
    c,
    `SELECT * FROM st_tank_cards WHERE tank_id=? FOR UPDATE`,
    [tankId]
  );
  try {
    tankStatus(
      previous?.stock_ml == null ? null : num(previous.stock_ml),
      capacity,
      critical,
      null,
      tolerance
    );
  } catch (e) {
    fail("TANK_LIMITS", (e as Error).message);
  }
  const p = proof(body);
  if (previous) {
    revision(previous, body.expectedRevision);
    await execute(
      c,
      `UPDATE st_tank_cards SET tank_number=?,capacity_ml=?,critical_ml=?,tolerance_ml=?,revision=revision+1 WHERE tank_id=?`,
      [number, capacity, critical, tolerance, tankId]
    );
  } else
    await execute(
      c,
      `INSERT INTO st_tank_cards (tank_id,tenant_id,station_id,tank_number,capacity_ml,critical_ml,tolerance_ml) VALUES (?,?,?,?,?,?,?)`,
      [
        tankId,
        scope.tenantId,
        scope.stationId,
        number,
        capacity,
        critical,
        tolerance,
      ]
    );
  return {
    tankId,
    previous,
    number,
    capacityMl: capacity,
    criticalMl: critical,
    toleranceMl: tolerance,
    ...p,
  };
}
async function append(
  c: PoolConnection,
  r: Row,
  actorId: number,
  m: {
    kind: string;
    delta: number;
    key: string;
    accountId?: string;
    requestId?: string;
    reference: string;
    note: string;
    evidence: string;
  }
) {
  const previous = await first<Row>(
    c,
    `SELECT * FROM st_tank_ledger WHERE tank_id=? AND source_key=? FOR UPDATE`,
    [r.tank_id, m.key]
  );
  if (previous) {
    if (num(previous.delta_ml) !== m.delta || previous.kind !== m.kind)
      fail(
        "STOCK_SOURCE_CONFLICT",
        "Kaynak daha önce farklı miktar/türle işlendi.",
        409
      );
    return false;
  }
  if (r.stock_ml === null && m.kind !== "OPENING")
    fail("OPENING_REQUIRED", "Onaylı başlangıç stoku gerekli.", 409);
  if (r.stock_ml !== null && m.kind === "OPENING")
    fail("OPENING_EXISTS", "Başlangıç stoku zaten onaylı.", 409);
  const before = r.stock_ml === null ? 0 : num(r.stock_ml);
  let after: number;
  try {
    after = stockAfter(before, m.delta, num(r.capacity_ml));
  } catch (e) {
    fail("STOCK_BOUNDS", (e as Error).message, 409);
  }
  await execute(
    c,
    `INSERT INTO st_tank_ledger (tank_id,kind,delta_ml,before_ml,after_ml,source_key,account_id,request_id,reference,note,evidence,actor_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      r.tank_id,
      m.kind,
      m.delta,
      before,
      after,
      m.key,
      m.accountId ?? null,
      m.requestId ?? null,
      m.reference,
      m.note,
      m.evidence,
      actorId,
    ]
  );
  await execute(
    c,
    `UPDATE st_tank_cards SET stock_ml=?,revision=revision+1,initialized_at=COALESCE(initialized_at,CURRENT_TIMESTAMP(3)) WHERE tank_id=?`,
    [after, r.tank_id]
  );
  r.stock_ml = after;
  r.revision = num(r.revision) + 1;
  return true;
}
async function attach(
  c: PoolConnection,
  scope: Scope,
  actorId: number,
  request: Row,
  operationId: unknown
) {
  if (request.kind !== "DELIVERY")
    fail(
      "DELIVERY_REQUIRED",
      "Bağlantı yalnız tanker kabulünde kullanılabilir."
    );
  const op = await first<Row>(
    c,
    `SELECT o.*,a.status AS account_status FROM st_shift_special_operations o JOIN st_accounts a ON a.id=o.account_id WHERE o.id=? AND o.tenant_id=? AND o.station_id=? FOR UPDATE`,
    [requireId(operationId, "operationId"), scope.tenantId, scope.stationId]
  );
  if (
    !op ||
    op.kind !== "TANKER_IN" ||
    op.status !== "RECORDED" ||
    op.account_status !== "OPEN" ||
    op.tank_id !== request.tank_id ||
    num(op.volume_ml) !== num(request.measured_ml) ||
    num(op.document_ml) !== num(request.document_ml) ||
    op.reference !== request.reference
  )
    fail(
      "DELIVERY_LINK_INVALID",
      "İcmal teslimi açık hesapta, aynı tank/belge ve aynı kabul/belge litresinde olmalı.",
      409
    );
  const supplier = await first<Row>(
    c,
    `SELECT name FROM st_suppliers WHERE id=? AND station_id=?`,
    [request.supplier_id, scope.stationId]
  );
  if (
    !supplier ||
    String(supplier.name).normalize("NFC") !==
      String(op.provider).normalize("NFC")
  )
    fail(
      "DELIVERY_SUPPLIER_MISMATCH",
      "İcmaldeki sağlayıcı adı seçilen tedarikçiyle aynı olmalı.",
      409
    );
  await execute(
    c,
    `INSERT INTO st_tank_delivery_links (request_id,operation_id,linked_by) VALUES (?,?,?)`,
    [request.id, op.id, actorId]
  );
  return { operationId: op.id, accountId: op.account_id };
}
export async function requestTankMove(
  c: PoolConnection,
  scope: Scope,
  actorId: number,
  body: Record<string, unknown>
) {
  await demoLock(c, scope);
  const r = await card(c, scope, body.tankId);
  revision(r, body.expectedRevision);
  const kind = requireEnum(body.kind, "kind", tankRequestKinds),
    reference = requireString(body.reference, "reference", { max: 190 }),
    p = proof(body);
  const tankerSource = await prepareTankerReceipt(c, scope, body);
  rejectCardData(reference);
  let target: number | null = null,
    document: number | null = null,
    measured: number | null = null,
    supplierId: string | null = null;
  if (kind === "OPENING") {
    if (r.stock_ml !== null)
      fail("OPENING_EXISTS", "Onaylı başlangıç var.", 409);
    target = volume(body.targetMl, "targetMl");
  } else {
    if (r.stock_ml === null)
      fail("OPENING_REQUIRED", "Önce başlangıç stokunu onaylatın.", 409);
    if (kind === "ADJUSTMENT") target = volume(body.targetMl, "targetMl");
    else {
      supplierId = requireId(body.supplierId, "supplierId");
      if (
        !(await first<Row>(
          c,
          `SELECT id FROM st_suppliers WHERE id=? AND tenant_id=? AND station_id=?`,
          [supplierId, scope.tenantId, scope.stationId]
        ))
      )
        fail("SUPPLIER_FORBIDDEN", "Tedarikçi istasyon kapsamında değil.", 403);
      document = volume(body.documentMl, "documentMl");
      measured = volume(body.measuredMl, "measuredMl");
      if (!document || !measured)
        fail(
          "DELIVERY_VOLUME_REQUIRED",
          "Belge ve ölçülen litre pozitif olmalı."
        );
    }
  }
  try {
    stockAfter(
      r.stock_ml === null ? 0 : num(r.stock_ml),
      kind === "DELIVERY"
        ? measured!
        : target! - (r.stock_ml === null ? 0 : num(r.stock_ml)),
      num(r.capacity_ml)
    );
  } catch (e) {
    fail("STOCK_BOUNDS", (e as Error).message, 409);
  }
  const id = randomUUID();
  await execute(
    c,
    `INSERT INTO st_tank_requests (id,tenant_id,station_id,tank_id,kind,target_ml,document_ml,measured_ml,supplier_id,reference,note,evidence,expected_revision,created_by,tanker_review_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      id,
      scope.tenantId,
      scope.stationId,
      r.tank_id,
      kind,
      target,
      document,
      measured,
      supplierId,
      reference,
      p.note,
      p.evidence,
      r.revision,
      actorId,
      tankerSource?.reviewId ?? null,
    ]
  );
  if (tankerSource) await linkTankerReceipt(c, id, tankerSource);
  if (body.operationId)
    await attach(
      c,
      scope,
      actorId,
      {
        id,
        kind,
        tank_id: r.tank_id,
        reference,
        measured_ml: measured,
        document_ml: document,
        supplier_id: supplierId,
      } as Row,
      body.operationId
    );
  return { id, tankId: r.tank_id, kind, reference, ...p };
}
export async function reviewTankMove(
  c: PoolConnection,
  scope: Scope,
  actorId: number,
  body: Record<string, unknown>
) {
  await demoLock(c, scope);
  const r = await card(c, scope, body.tankId),
    q = await first<Row>(
      c,
      `SELECT * FROM st_tank_requests WHERE id=? AND tank_id=? AND station_id=? FOR UPDATE`,
      [
        requireId(body.stockRequestId, "stockRequestId"),
        r.tank_id,
        scope.stationId,
      ]
    );
  if (!q || q.status !== "PENDING")
    fail("STOCK_REQUEST_LOCKED", "Talep artık onay beklemiyor.", 409);
  if (num(q.created_by) === actorId)
    fail(
      "SELF_APPROVAL_FORBIDDEN",
      "Kendi tanker/stok talebinizi onaylayamazsınız.",
      403
    );
  const decision = requireEnum(body.decision, "decision", [
      "APPROVE",
      "REJECT",
    ] as const),
    p = proof(body);
  if (decision === "APPROVE") {
    if (q.tanker_review_id) await assertTankerReceiptCurrent(c, scope, q);
    revision(r, q.expected_revision);
    revision(r, body.expectedRevision);
    const delta =
      q.kind === "DELIVERY"
        ? num(q.measured_ml)
        : num(q.target_ml) - (r.stock_ml === null ? 0 : num(r.stock_ml));
    await append(c, r, actorId, {
      kind: q.kind,
      delta,
      key: q.kind === "OPENING" ? "OPENING" : "REQ:" + q.id,
      requestId: q.id,
      reference: q.reference,
      ...p,
    });
  }
  await execute(
    c,
    `UPDATE st_tank_requests SET status=?,reviewer_id=?,review_note=?,review_evidence=? WHERE id=?`,
    [
      decision === "APPROVE" ? "APPROVED" : "REJECTED",
      actorId,
      p.note,
      p.evidence,
      q.id,
    ]
  );
  return { requestId: q.id, tankId: r.tank_id, decision, ...p };
}
export async function linkTankDelivery(
  c: PoolConnection,
  scope: Scope,
  actorId: number,
  body: Record<string, unknown>
) {
  await demoLock(c, scope);
  const r = await card(c, scope, body.tankId),
    q = await first<Row>(
      c,
      `SELECT * FROM st_tank_requests WHERE id=? AND tank_id=? AND kind='DELIVERY' AND status<>'REJECTED' FOR UPDATE`,
      [requireId(body.stockRequestId, "stockRequestId"), r.tank_id]
    );
  if (!q) fail("DELIVERY_NOT_FOUND", "Tanker talebi bulunamadı.", 404);
  const p = proof(body);
  return {
    requestId: q.id,
    tankId: r.tank_id,
    ...(await attach(c, scope, actorId, q, body.operationId)),
    ...p,
  };
}
export async function measureTank(
  c: PoolConnection,
  scope: Scope,
  actorId: number,
  body: Record<string, unknown>
) {
  await demoLock(c, scope);
  const r = await card(c, scope, body.tankId);
  revision(r, body.expectedRevision);
  const measured = volume(body.measuredMl, "measuredMl"),
    p = proof(body);
  if (measured > num(r.capacity_ml))
    fail("STOCK_BOUNDS", "Ölçüm kapasiteyi aşıyor.", 409);
  const status = tankStatus(
      r.stock_ml === null ? null : num(r.stock_ml),
      num(r.capacity_ml),
      num(r.critical_ml),
      measured,
      num(r.tolerance_ml)
    ),
    id = randomUUID();
  await execute(
    c,
    `INSERT INTO st_tank_measurements (id,tank_id,measured_ml,theoretical_ml,difference_ml,within_tolerance,revision,note,evidence,actor_id) VALUES (?,?,?,?,?,?,?,?,?,?)`,
    [
      id,
      r.tank_id,
      measured,
      r.stock_ml,
      status.differenceMl,
      status.withinTolerance === null ? null : status.withinTolerance ? 1 : 0,
      r.revision,
      p.note,
      p.evidence,
      actorId,
    ]
  );
  return { id, tankId: r.tank_id, ...status, ...p };
}
export async function centralTankInfo(
  c: PoolConnection,
  tankIds: string[],
  accountId?: string
) {
  if (!tankIds.length) return [];
  return rows<Row[]>(
    c,
    `SELECT c.tank_id,c.stock_ml,c.revision,m.measured_ml,m.revision AS measured_revision,m.difference_ml,m.created_at AS measured_at,(SELECT COUNT(*) FROM st_tank_ledger l WHERE l.tank_id=c.tank_id AND l.account_id=?) AS posted FROM st_tank_cards c LEFT JOIN st_tank_measurements m ON m.id=(SELECT x.id FROM st_tank_measurements x WHERE x.tank_id=c.tank_id ORDER BY x.created_at DESC,x.id DESC LIMIT 1) WHERE c.tank_id IN (${tankIds.map(() => "?").join(",")})`,
    [accountId ?? null, ...tankIds]
  );
}
export async function assertTankDeliveryMutable(
  c: PoolConnection,
  operationId: string
) {
  if (
    await first<Row>(
      c,
      `SELECT x.request_id FROM st_tank_delivery_links x JOIN st_tank_requests q ON q.id=x.request_id WHERE x.operation_id=? AND q.status='APPROVED' FOR UPDATE`,
      [operationId]
    )
  )
    fail(
      "TANK_DELIVERY_POSTED",
      "Tank defterine geçmiş teslim iptal edilemez; kanıtlı bağımsız stok düzeltmesi gerekir.",
      409
    );
}
// Only new, independently accepted accounts enter the immutable stock ledger.
export async function postTankAccount(
  c: PoolConnection,
  account: Row,
  fuel: any,
  actorId: number
) {
  let managed = await rows<Row[]>(
    c,
    `SELECT c.* FROM st_tank_cards c WHERE c.station_id=? AND c.tenant_id=? ORDER BY c.tank_id`,
    [account.station_id, account.tenant_id]
  );
  if (!managed.length) return;
  await demoLock(c, {
    tenantId: account.tenant_id,
    stationId: account.station_id,
  });
  managed = await rows<Row[]>(
    c,
    `SELECT c.* FROM st_tank_cards c WHERE c.station_id=? AND c.tenant_id=? ORDER BY c.tank_id FOR UPDATE`,
    [account.station_id, account.tenant_id]
  );
  const nozzles = await rows<Row[]>(
    c,
    `SELECT n.id,n.tank_id FROM st_fuel_nozzles n JOIN st_fuel_assignments x ON x.nozzle_id=n.id WHERE x.account_id=?`,
    [account.id]
  );
  const stocks: { tankId: string; beforeMl: number; afterMl: number }[] = [];
  const operations =
    fuel.icmal?.operations.filter((o: any) => o.status === "RECORDED") ?? [];
  for (const r of managed) {
    const assigned = nozzles.filter(n => n.tank_id === r.tank_id);
    if (!assigned.length) continue;
    const beforeStock = r.stock_ml === null ? 0 : num(r.stock_ml);
    if (r.initialized_at === null)
      fail(
        "OPENING_REQUIRED",
        "Yönetilen tankın başlangıç stoku onaylanmadan vardiya kesinleşemez.",
        409
      );
    if (
      parseDbUtc(String(account.created_at)).getTime() <
      parseDbUtc(String(r.initialized_at)).getTime()
    )
      fail(
        "STOCK_CUTOVER_REQUIRED",
        "Bu vardiya tank başlangıç kaydından önce açılmış; geçmiş çıkışlar otomatik aktarılmaz.",
        409
      );
    const earlier = await first<Row>(
      c,
      `SELECT a.id FROM st_accounts a JOIN st_fuel_assignments x ON x.account_id=a.id JOIN st_fuel_nozzles n ON n.id=x.nozzle_id WHERE a.station_id=? AND n.tank_id=? AND a.created_at>=? AND a.created_at<? AND a.id<>? AND NOT EXISTS(SELECT 1 FROM st_tank_ledger l WHERE l.account_id=a.id AND l.tank_id=? AND l.kind IN ('SALE','TEST_OUT')) LIMIT 1 FOR UPDATE`,
      [
        account.station_id,
        r.tank_id,
        r.initialized_at,
        account.created_at,
        account.id,
        r.tank_id,
      ]
    );
    if (earlier)
      fail(
        "STOCK_SEQUENCE_PENDING",
        "Önceki tank vardiyasının stok kaydı tamamlanmalı.",
        409
      );
    for (const o of operations.filter(
      (o: any) => o.kind === "TANKER_IN" && o.tankId === r.tank_id
    )) {
      const link = await first<Row>(
        c,
        `SELECT q.* FROM st_tank_delivery_links x JOIN st_tank_requests q ON q.id=x.request_id WHERE x.operation_id=? AND q.tank_id=? AND q.status='APPROVED' FOR UPDATE`,
        [o.id, r.tank_id]
      );
      if (
        !link ||
        num(link.measured_ml) !== o.volumeMl ||
        num(link.document_ml) !== o.documentMl
      )
        fail(
          "TANKER_APPROVAL_REQUIRED",
          "İcmal tanker girişi aynı miktarlı bağımsız onaylı tank kabulüne bağlanmalı.",
          409
        );
      // The request already posted the delivery; never post it from the account.
    }
    for (const n of assigned) {
      const points = fuel.readings.filter((p: any) => p.nozzleId === n.id),
        test = operations.filter(
          (o: any) => o.kind === "TEST_OUT" && o.nozzleId === n.id
        );
      const total = testAllocation(
        points,
        test.map((o: any) => ({ start: o.startMeterMl, end: o.endMeterMl }))
      );
      await append(c, r, actorId, {
        kind: "SALE",
        delta: -total.commercialMl,
        key: "SALE:" + account.id + ":" + n.id,
        accountId: account.id,
        reference: "VARDİYA " + account.id,
        note: "İki bağımsız onaylı ticari sayaç çıkışı",
        evidence: fuel.evidence ?? "Onay snapshot",
      });
      if (total.testMl)
        await append(c, r, actorId, {
          kind: "TEST_OUT",
          delta: -total.testMl,
          key: "TEST:" + account.id + ":" + n.id,
          accountId: account.id,
          reference: "TEST " + account.id,
          note: "Ticari satıştan ayrılan test çıkışı",
          evidence: test
            .map((o: any) => o.evidence)
            .join("; ")
            .slice(0, 500),
        });
    }
    for (const o of operations.filter(
      (o: any) => o.kind === "TEST_RETURN" && o.tankId === r.tank_id
    ))
      await append(c, r, actorId, {
        kind: "TEST_RETURN",
        delta: o.volumeMl,
        key: "RETURN:" + o.id,
        accountId: account.id,
        reference: o.reference,
        note: o.note,
        evidence: o.evidence,
      });
    stocks.push({
      tankId: r.tank_id,
      beforeMl: beforeStock,
      afterMl: num(r.stock_ml),
    });
  }
  return stocks.length ? { stocks } : undefined;
}
export async function tankReport(
  c: PoolConnection,
  scope: Scope,
  filter: { day?: string; month?: string; shiftId?: string }
) {
  const all = await rows<Row[]>(
    c,
    `SELECT c.*,f.name AS fuel,(SELECT GROUP_CONCAT(DISTINCT p.label ORDER BY p.label SEPARATOR ', ') FROM st_fuel_nozzles n JOIN st_fuel_pumps p ON p.id=n.pump_id WHERE n.tank_id=c.tank_id) AS pumps,m.measured_ml,m.revision AS measured_revision,m.created_at AS measured_at FROM st_tank_cards c JOIN st_fuel_tanks t ON t.id=c.tank_id JOIN st_fuel_types f ON f.id=t.fuel_type_id LEFT JOIN st_tank_measurements m ON m.id=(SELECT x.id FROM st_tank_measurements x WHERE x.tank_id=c.tank_id ORDER BY x.created_at DESC,x.id DESC LIMIT 1) WHERE c.station_id=? AND c.tenant_id=? ORDER BY c.tank_number`,
    [scope.stationId, scope.tenantId]
  );
  const cards = all.map(r => {
    const stock = r.stock_ml === null ? null : num(r.stock_ml),
      fresh =
        r.measured_revision != null &&
        num(r.measured_revision) === num(r.revision),
      measured = fresh ? num(r.measured_ml) : null;
    return {
      tankId: r.tank_id,
      stationId: r.station_id,
      number: r.tank_number,
      fuel: r.fuel,
      capacityMl: num(r.capacity_ml),
      criticalMl: num(r.critical_ml),
      toleranceMl: num(r.tolerance_ml),
      revision: num(r.revision),
      stockMl: stock,
      initializedAt:
        r.initialized_at === null
          ? null
          : parseDbUtc(String(r.initialized_at)).toISOString(),
      pumps: r.pumps ?? "",
      measuredMl: r.measured_ml === null ? null : num(r.measured_ml),
      measurementAt:
        r.measured_at === null
          ? null
          : parseDbUtc(String(r.measured_at)).toISOString(),
      measurementFresh: fresh,
      ...tankStatus(
        stock,
        num(r.capacity_ml),
        num(r.critical_ml),
        measured,
        num(r.tolerance_ml)
      ),
    };
  });
  const conditions = ["c.station_id=?", "c.tenant_id=?"],
    params: unknown[] = [scope.stationId, scope.tenantId];
  if (filter.day) {
    conditions.push("DATE(DATE_ADD(l.created_at,INTERVAL 3 HOUR))=?");
    params.push(filter.day);
  }
  if (filter.month) {
    conditions.push(
      "DATE_FORMAT(DATE_ADD(l.created_at,INTERVAL 3 HOUR),'%Y-%m')=?"
    );
    params.push(filter.month);
  }
  if (filter.shiftId) {
    conditions.push("a.shift_id=?");
    params.push(filter.shiftId);
  }
  const ledger = await rows<Row[]>(
    c,
    `SELECT l.*,a.id AS resolved_account_id,c.tank_number,s.label AS shift_label,u.name AS actor_name FROM st_tank_ledger l JOIN st_tank_cards c ON c.tank_id=l.tank_id LEFT JOIN st_tank_delivery_links dl ON dl.request_id=l.request_id LEFT JOIN st_shift_special_operations o ON o.id=dl.operation_id LEFT JOIN st_accounts a ON a.id=COALESCE(l.account_id,o.account_id) LEFT JOIN st_shifts s ON s.id=a.shift_id JOIN users u ON u.id=l.actor_id WHERE ${conditions.join(" AND ")} ORDER BY l.id DESC LIMIT 2001`,
    params
  );
  if (ledger.length > 2000)
    fail(
      "REPORT_RANGE_REQUIRED",
      "2000'den fazla hareket var; tarih/vardiya filtresini daraltın."
    );
  const requests = await rows<Row[]>(
    c,
    `SELECT q.*,s.name AS supplier_name,x.operation_id FROM st_tank_requests q LEFT JOIN st_suppliers s ON s.id=q.supplier_id LEFT JOIN st_tank_delivery_links x ON x.request_id=q.id WHERE q.station_id=? AND q.tenant_id=? ORDER BY q.created_at DESC LIMIT 501`,
    [scope.stationId, scope.tenantId]
  );
  if (requests.length > 500)
    fail(
      "REPORT_RANGE_REQUIRED",
      "500'den fazla stok talebi var; arşiv görüntüleme sınırı için kapsam daraltılmalı."
    );
  const measurements = await rows<Row[]>(
    c,
    `SELECT m.* FROM st_tank_measurements m JOIN st_tank_cards c ON c.tank_id=m.tank_id WHERE c.station_id=? AND c.tenant_id=? ORDER BY m.created_at DESC LIMIT 200`,
    [scope.stationId, scope.tenantId]
  );
  const pending = await first<Row>(
    c,
    `SELECT COUNT(DISTINCT a.id) AS n FROM st_accounts a JOIN st_fuel_assignments x ON x.account_id=a.id JOIN st_fuel_nozzles n ON n.id=x.nozzle_id JOIN st_tank_cards c ON c.tank_id=n.tank_id WHERE a.station_id=? AND a.tenant_id=? AND a.status NOT IN ('ACCEPTED','ACCEPTED_WITH_PENDING') AND (c.initialized_at IS NULL OR a.created_at>=c.initialized_at)`,
    [scope.stationId, scope.tenantId]
  );
  return {
    cards,
    movements: ledger.map(r => ({
      id: String(r.id),
      tankId: r.tank_id,
      tankNumber: r.tank_number,
      kind: r.kind,
      deltaMl: num(r.delta_ml),
      beforeMl: num(r.before_ml),
      afterMl: num(r.after_ml),
      accountId: r.resolved_account_id,
      shiftLabel: r.shift_label,
      reference: r.reference,
      note: r.note,
      evidence: r.evidence,
      createdAt: parseDbUtc(String(r.created_at)).toISOString(),
      actorName: r.actor_name,
      sourceKey: r.source_key,
    })),
    requests: requests.map(r => ({
      id: r.id,
      tankId: r.tank_id,
      kind: r.kind,
      targetMl: r.target_ml === null ? null : num(r.target_ml),
      documentMl: r.document_ml === null ? null : num(r.document_ml),
      measuredMl: r.measured_ml === null ? null : num(r.measured_ml),
      differenceMl:
        r.kind === "DELIVERY" ? num(r.measured_ml) - num(r.document_ml) : null,
      supplierId: r.supplier_id,
      supplierName: r.supplier_name,
      reference: r.reference,
      note: r.note,
      evidence: r.evidence,
      status: r.status,
      createdBy: num(r.created_by),
      expectedRevision: num(r.expected_revision),
      operationId: r.operation_id,
    })),
    measurements: measurements.map(r => ({
      id: r.id,
      tankId: r.tank_id,
      measuredMl: num(r.measured_ml),
      theoreticalMl: r.theoretical_ml === null ? null : num(r.theoretical_ml),
      differenceMl: r.difference_ml === null ? null : num(r.difference_ml),
      withinTolerance:
        r.within_tolerance === null ? null : !!num(r.within_tolerance),
      revision: num(r.revision),
      note: r.note,
      evidence: r.evidence,
      createdAt: parseDbUtc(String(r.created_at)).toISOString(),
    })),
    pendingAccounts: num(pending?.n ?? 0),
  };
}

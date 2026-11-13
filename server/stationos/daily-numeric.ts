import { randomUUID } from "node:crypto";
import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import { first, rows, execute } from "./db";
import {
  requireId,
  requireInteger,
  requireString,
  requireEnum,
  requireBoolean,
  payloadHash,
} from "./domain";
import { requireDailyDemo, scopedDailyPackage } from "./daily-report";
import { fuelEquipment } from "./fuel";
import { fail } from "./types";
import { attachOcrEvidence } from "./daily-ocr";
import { rejectCardData } from "./safety";
import { parseDbUtc, turkeyToday } from "../../shared/datetime";
import {
  numericComparison,
  numericKinds,
  tenderKinds,
  type DailyNumericRow,
  type NumericAccount,
  type NumericComparison,
  type NumericEquipment,
  type NumericStaff,
  type NumericRevision,
} from "../../shared/daily-numeric";
type Row = RowDataPacket & Record<string, any>;
type Scope = { tenantId: string; stationId: string };
export type NumericLoader = (
  c: PoolConnection,
  scope: Scope,
  shiftId: string
) => Promise<NumericAccount[]>;
const maybeId = (v: unknown, label: string) =>
  v == null ? null : requireId(v, label);
const maybeInteger = (v: unknown, label: string) =>
  v == null ? null : requireInteger(v, label, { allowZero: true });
export function validateNumericRows(
  value: unknown,
  pages: { id: string; kind: string }[],
  equipment: NumericEquipment[],
  verified = false,
  staff: NumericStaff[] = []
): DailyNumericRow[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 100)
    fail("DAILY_NUMERIC_ROWS", "1–100 sayısal taslak satırı gerekli.");
  const keys = new Set<string>();
  return value.map((r: any) => {
    const kind = requireEnum(r?.kind, "Satır türü", numericKinds),
      pageId = requireId(r?.pageId, "pageId"),
      page = pages.find(p => p.id === pageId),
      label = requireString(r?.label, "Kaynak satır adı", { max: 190 }),
      sourceLocation =
        r?.sourceLocation === undefined
          ? undefined
          : requireString(r.sourceLocation, "Kaynak sayfa/satır/hücre", {
              max: 190,
            });
    rejectCardData(label, sourceLocation ?? null);
    if (!page)
      fail(
        "DAILY_PAGE_FORBIDDEN",
        "Sayısal satırın fotoğrafı bu pakette bulunamadı.",
        403
      );
    let row: DailyNumericRow | undefined,
      key = "",
      complete = false;
    if (kind === "SALES") {
      const fuelId = maybeId(r.fuelId, "fuelId"),
        basis = requireEnum(r.basis, "Satış esası", [
          "UNDECIDED",
          "METER",
          "COMMERCIAL",
        ] as const),
        volumeMl = maybeInteger(r.volumeMl, "Satış litresi"),
        amountMinor = maybeInteger(r.amountMinor, "Satış tutarı");
      if (fuelId && !equipment.some(e => e.fuelId === fuelId))
        fail(
          "DAILY_MAPPING_FORBIDDEN",
          "Yakıt seçili istasyona ait değil.",
          403
        );
      row = {
        kind,
        pageId,
        label,
        ...(sourceLocation ? { sourceLocation } : {}),
        fuelId,
        basis,
        volumeMl,
        amountMinor,
      };
      key = fuelId ?? pageId + label;
      complete =
        fuelId !== null &&
        basis !== "UNDECIDED" &&
        volumeMl !== null &&
        amountMinor !== null &&
        ["SALES", "TANK"].includes(page.kind);
    } else if (kind === "METER") {
      const nozzleId = maybeId(r.nozzleId, "nozzleId"),
        openingMl = maybeInteger(r.openingMl, "Sayaç açılışı"),
        closingMl = maybeInteger(r.closingMl, "Sayaç kapanışı"),
        reportedMl = maybeInteger(r.reportedMl, "Kaynak litre");
      if (nozzleId && !equipment.some(e => e.id === nozzleId))
        fail(
          "DAILY_MAPPING_FORBIDDEN",
          "Tabanca seçili istasyona ait değil.",
          403
        );
      row = {
        kind,
        pageId,
        label,
        ...(sourceLocation ? { sourceLocation } : {}),
        nozzleId,
        openingMl,
        closingMl,
        reportedMl,
      };
      key = nozzleId ?? pageId + label;
      complete =
        nozzleId !== null &&
        openingMl !== null &&
        closingMl !== null &&
        closingMl >= openingMl &&
        (reportedMl === null || reportedMl === closingMl - openingMl) &&
        page.kind === "METERS";
    } else if (kind === "TANK") {
      const tankId = maybeId(r.tankId, "tankId"),
        openingMl = maybeInteger(r.openingMl, "Tank açılışı"),
        closingMl = maybeInteger(r.closingMl, "Tank kapanışı"),
        deliveryMl = maybeInteger(r.deliveryMl, "Tank girişi"),
        returnMl = maybeInteger(r.returnMl, "Fiziksel test dönüşü");
      if (tankId && !equipment.some(e => e.tankId === tankId))
        fail(
          "DAILY_MAPPING_FORBIDDEN",
          "Tank seçili istasyona ait değil.",
          403
        );
      row = {
        kind,
        pageId,
        label,
        ...(sourceLocation ? { sourceLocation } : {}),
        tankId,
        openingMl,
        closingMl,
        deliveryMl,
        returnMl,
      };
      key = tankId ?? pageId + label;
      complete =
        tankId !== null &&
        openingMl !== null &&
        closingMl !== null &&
        deliveryMl !== null &&
        returnMl !== null &&
        Number.isSafeInteger(openingMl + deliveryMl + returnMl) &&
        openingMl + deliveryMl + returnMl >= closingMl &&
        page.kind === "TANK";
    } else if (kind === "TENDER") {
      const category = requireEnum(r.category, "Tahsilat türü", tenderKinds),
        amountMinor = maybeInteger(r.amountMinor, "Tutar");
      row = {
        kind,
        pageId,
        label,
        ...(sourceLocation ? { sourceLocation } : {}),
        category,
        amountMinor,
      };
      key = category === "OTHER" ? pageId + label : category;
      complete =
        category !== "OTHER" &&
        amountMinor !== null &&
        ["SALES", "CARDS"].includes(page.kind);
    }
    if (kind === "STAFF_SALES" || kind === "STAFF_TENDER") {
      const staffUserId = requireInteger(r.staffUserId, "staffUserId");
      if (
        staffUserId <= 0 ||
        !staff.some(person => person.userId === staffUserId)
      )
        fail(
          "DAILY_STAFF_FORBIDDEN",
          "Personel kimliği seçili şirket ve istasyonda yetkili değil.",
          403
        );
      const transactionCount = maybeInteger(
          r.transactionCount,
          "transactionCount"
        ),
        amountMinor = maybeInteger(r.amountMinor, "Tutar");
      if (kind === "STAFF_SALES") {
        const fuelId = maybeId(r.fuelId, "fuelId"),
          basis = requireEnum(r.basis, "Satış esası", [
            "UNDECIDED",
            "METER",
            "COMMERCIAL",
          ] as const),
          volumeMl = maybeInteger(r.volumeMl, "Satış litresi");
        if (fuelId && !equipment.some(e => e.fuelId === fuelId))
          fail(
            "DAILY_MAPPING_FORBIDDEN",
            "Yakıt seçili istasyona ait değil.",
            403
          );
        row = {
          kind,
          pageId,
          label,
          ...(sourceLocation ? { sourceLocation } : {}),
          staffUserId,
          fuelId,
          basis,
          transactionCount,
          volumeMl,
          amountMinor,
        };
        key = `${staffUserId}:${fuelId ?? pageId + label}:${basis}`;
        complete =
          fuelId !== null &&
          basis !== "UNDECIDED" &&
          transactionCount !== null &&
          volumeMl !== null &&
          amountMinor !== null &&
          page.kind === "SALES";
      } else {
        const category = requireEnum(r.category, "Tahsilat türü", tenderKinds);
        row = {
          kind,
          pageId,
          label,
          ...(sourceLocation ? { sourceLocation } : {}),
          staffUserId,
          category,
          transactionCount,
          amountMinor,
        };
        key = `${staffUserId}:${category}`;
        complete =
          category !== "OTHER" &&
          transactionCount !== null &&
          amountMinor !== null &&
          ["SALES", "CARDS"].includes(page.kind);
      }
    }
    if (!row || !key) fail("DAILY_NUMERIC_KIND", "Satır türü işlenemedi.");
    key = kind + ":" + key.normalize("NFC").toLocaleLowerCase("tr-TR");
    if (keys.has(key))
      fail(
        "DAILY_NUMERIC_DUPLICATE",
        "Aynı yakıt, tabanca, tank veya tahsilat sınıfı iki kez girilemez.",
        409
      );
    keys.add(key);
    if (verified && !complete)
      fail(
        "DAILY_NUMERIC_INCOMPLETE",
        "Kaynak türü, eşleştirme, hacim esası veya sayı eksik/çelişkili. Önce bekleyen taslağı düzeltin.",
        409
      );
    return row;
  });
}
function revision(r: Row): NumericRevision {
  return {
    revision: Number(r.revision),
    sourceRevision: Number(r.source_revision),
    shiftId: r.shift_id,
    decision: r.decision,
    rows: JSON.parse(r.rows_json),
    note: r.note,
    evidence: r.evidence,
    sourceConfirmed: !!Number(r.source_confirmed),
    shiftConfirmed: !!Number(r.shift_confirmed),
    snapshotHash: r.snapshot_hash,
    savedComparison: JSON.parse(r.comparison_json),
    createdAt: parseDbUtc(String(r.created_at)).toISOString(),
    reviewerName: r.reviewer_name,
  };
}
export async function numericContext(
  c: PoolConnection,
  scope: Scope,
  packageId: unknown,
  shiftId: string | null | undefined,
  load: NumericLoader
) {
  await requireDailyDemo(c, scope, true);
  const doc = await scopedDailyPackage(c, scope, packageId, true);
  const source = await first<Row>(
    c,
    "SELECT * FROM st_daily_report_reviews WHERE package_id=? ORDER BY revision DESC LIMIT 1",
    [doc.id]
  );
  const rawPages = await rows<Row[]>(
    c,
    "SELECT id FROM st_daily_report_pages WHERE package_id=? ORDER BY position_index",
    [doc.id]
  );
  const kinds = source ? JSON.parse(source.page_kinds_json) : [];
  const pages = rawPages.map(p => ({
    id: String(p.id),
    kind: String(kinds.find((k: any) => k.pageId === p.id)?.kind ?? "UNKNOWN"),
  }));
  const histories = await rows<Row[]>(
    c,
    "SELECT r.*,u.name AS reviewer_name FROM st_daily_numeric_reviews r JOIN users u ON u.id=r.reviewer_id WHERE r.package_id=? ORDER BY revision DESC LIMIT 101",
    [doc.id]
  );
  if (histories.length > 100)
    fail(
      "DAILY_NUMERIC_HISTORY_LIMIT",
      "100 inceleme sınırı aşıldı; arşiv raporu gerekli."
    );
  const history = histories.map(revision),
    latest = history[0] ?? null,
    requestedShiftId =
      shiftId === undefined ? (latest?.shiftId ?? null) : shiftId;
  let selectedShiftId = requestedShiftId,
    savedShiftDayChanged = false;
  const sourceDay = source ? String(source.report_day).slice(0, 10) : null;
  const shifts = await rows<Row[]>(
    c,
    `SELECT id,label,starts_at FROM st_shifts WHERE tenant_id=? AND station_id=? ${sourceDay ? "AND DATE(DATE_ADD(starts_at,INTERVAL 3 HOUR))=?" : ""} ORDER BY starts_at DESC,id LIMIT 101`,
    [scope.tenantId, scope.stationId, ...(sourceDay ? [sourceDay] : [])]
  );
  if (shifts.length > 100)
    fail(
      "DAILY_SHIFT_LIMIT",
      "Vardiya listesi 100 sınırını aştı; rapor gününü daraltın."
    );
  if (selectedShiftId) {
    requireId(selectedShiftId, "shiftId");
    const s = await first<Row>(
      c,
      "SELECT id,starts_at FROM st_shifts WHERE id=? AND tenant_id=? AND station_id=?",
      [selectedShiftId, scope.tenantId, scope.stationId]
    );
    if (!s)
      fail("DAILY_SHIFT_FORBIDDEN", "Vardiya bu istasyona ait değil.", 403);
    if (
      !sourceDay ||
      turkeyToday(parseDbUtc(String(s.starts_at))) !== sourceDay
    ) {
      if (shiftId === undefined) {
        selectedShiftId = null;
        savedShiftDayChanged = true;
      } else
        fail(
          "DAILY_SHIFT_DAY_MISMATCH",
          "Seçilen vardiyanın Türkiye başlangıç günü kaynak rapor günüyle uyuşmuyor.",
          409
        );
    }
  }
  const equipment: NumericEquipment[] = (
    await fuelEquipment(c, scope.stationId)
  ).map(e => ({
    id: String(e.id),
    label: String(e.label),
    tankId: String(e.tankId),
    tank: String(e.tank),
    pump: String(e.pump),
    fuelId: String(e.fuelTypeId),
    fuel: String(e.fuel),
  }));
  const membershipStatusColumn = await first<Row>(
    c,
    "SELECT COUNT(*) AS count FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='st_member_stations' AND COLUMN_NAME='status'",
    []
  );
  const staffRows = await rows<Row[]>(
    c,
    `SELECT m.user_id AS userId,u.name FROM st_members m JOIN st_member_stations ms ON ms.tenant_id=m.tenant_id AND ms.user_id=m.user_id JOIN users u ON u.id=m.user_id WHERE m.tenant_id=? AND ms.station_id=? AND m.role='FUEL_STAFF' ${Number(membershipStatusColumn?.count) > 0 ? "AND ms.status='ACTIVE'" : ""} ORDER BY u.name,m.user_id LIMIT 201`,
    [scope.tenantId, scope.stationId]
  );
  if (staffRows.length > 200)
    fail("DAILY_STAFF_LIMIT", "200 personel sınırı aşıldı; kapsamı daraltın.");
  const staff: NumericStaff[] = staffRows.map(row => ({
    userId: Number(row.userId),
    name: String(row.name),
  }));
  const accounts = selectedShiftId ? await load(c, scope, selectedShiftId) : [];
  const currentSnapshotHash = payloadHash({
    version: 1,
    shiftId: selectedShiftId,
    equipment,
    staff,
    accounts,
  });
  const sourceRevision = Number(source?.revision ?? 0);
  const comparison = numericComparison(latest?.rows ?? [], equipment, accounts);
  if (savedShiftDayChanged)
    comparison.warnings.push(
      "Önceki vardiya eşleşmesi yeni kaynak rapor gününe uymuyor. Yeni eşleştirme gerekli; geçmiş kayıt korunuyor."
    );
  return {
    packageId: doc.id,
    pages,
    sourceRevision,
    sourceDecision: String(source?.decision ?? "PENDING"),
    sourceDay,
    equipment,
    staff,
    accounts,
    shifts: shifts.map(s => ({
      id: String(s.id),
      label: String(s.label),
      startsAt: parseDbUtc(String(s.starts_at)).toISOString(),
    })),
    selectedShiftId,
    latest,
    history,
    comparison,
    currentSnapshotHash,
    stale:
      !!latest &&
      (latest.sourceRevision !== sourceRevision ||
        latest.snapshotHash !== currentSnapshotHash),
  };
}

type StaffScopedNumericContext = {
  staff: NumericStaff[];
  accounts: NumericAccount[];
  latest: NumericRevision | null;
  history: NumericRevision[];
  comparison: NumericComparison;
};

/** Filter a report response to one station-authorized staff member. */
export function scopeNumericContextToStaff<T extends StaffScopedNumericContext>(
  context: T,
  staffUserId: number
): T {
  if (
    !Number.isSafeInteger(staffUserId) ||
    staffUserId <= 0 ||
    !context.staff.some(person => person.userId === staffUserId) ||
    !context.accounts.some(account => account.userId === staffUserId)
  )
    fail(
      "DAILY_STAFF_FORBIDDEN",
      "Personel bu vardiya ve istasyon kapsamında bulunamadı.",
      404
    );
  const selectedAccount = context.accounts.find(
    account => account.userId === staffUserId
  )!;
  const staffRows = (rows: DailyNumericRow[]) =>
    rows.filter(
      row =>
        (row.kind === "STAFF_SALES" || row.kind === "STAFF_TENDER") &&
        row.staffUserId === staffUserId
    );
  const comparisonRows = (context.comparison.rows ?? []).filter(
    row => row.staffUserId === staffUserId
  );
  const scopedRevision = (item: NumericRevision): NumericRevision => ({
    ...item,
    rows: staffRows(item.rows),
    savedComparison: {
      ...item.savedComparison,
      rows: item.savedComparison.rows.filter(
        row => row.staffUserId === staffUserId
      ),
      accountCount: 1,
      complete: false,
    },
  });
  return {
    ...context,
    staff: context.staff.filter(person => person.userId === staffUserId),
    accounts: [selectedAccount],
    latest: context.latest ? scopedRevision(context.latest) : null,
    history: context.history.map(scopedRevision),
    comparison: {
      ...context.comparison,
      rows: comparisonRows,
      accountCount: 1,
      complete: selectedAccount.closed && !selectedAccount.specialPending,
    },
  } as T;
}

export async function saveNumericDraft(
  c: PoolConnection,
  scope: Scope,
  actorId: number,
  body: Record<string, unknown>,
  load: NumericLoader
) {
  const target = await numericContext(
    c,
    scope,
    body.packageId,
    maybeId(body.shiftId, "shiftId"),
    load
  );
  if (
    requireInteger(body.expectedRevision, "expectedRevision", {
      allowZero: true,
    }) !== (target.latest?.revision ?? 0) ||
    requireInteger(body.expectedSourceRevision, "expectedSourceRevision", {
      allowZero: true,
    }) !== target.sourceRevision
  )
    fail(
      "REVISION_CONFLICT",
      "Sayısal taslak veya kaynak incelemesi değişti; güncel veriyi yükleyin.",
      409
    );
  if (body.expectedSnapshotHash !== target.currentSnapshotHash)
    fail(
      "DAILY_SNAPSHOT_CHANGED",
      "Vardiya icmali/eşleştirmeler değişti; karşılaştırmayı yenileyin.",
      409
    );
  const decision = requireEnum(body.decision, "Karar", [
      "PENDING",
      "VERIFIED_DRAFT",
      "REJECTED",
    ] as const),
    sourceConfirmed = requireBoolean(body.sourceConfirmed, "Kaynak teyidi"),
    shiftConfirmed = requireBoolean(body.shiftConfirmed, "Vardiya eşleşmesi");
  if (
    decision === "VERIFIED_DRAFT" &&
    (!sourceConfirmed ||
      !shiftConfirmed ||
      !target.selectedShiftId ||
      target.sourceDecision !== "REVIEWED_DRAFT")
  )
    fail(
      "DAILY_NUMERIC_CONFIRMATION",
      "Önce kaynak paketini doğrulayın; sayıları ve seçilen vardiya eşleşmesini açıkça teyit edin.",
      409
    );
  const values = validateNumericRows(
      body.rows,
      target.pages,
      target.equipment,
      decision === "VERIFIED_DRAFT",
      target.staff
    ),
    note = requireString(body.note, "Açıklama", { max: 1000 }),
    evidence = requireString(body.evidence, "Kanıt", { max: 500 });
  rejectCardData(note, evidence);
  await attachOcrEvidence(c, scope, target.packageId, values, body.rows);
  const comparison = numericComparison(
      values,
      target.equipment,
      target.accounts
    ),
    next = (target.latest?.revision ?? 0) + 1;
  await execute(
    c,
    "INSERT INTO st_daily_numeric_reviews (id,package_id,revision,source_revision,shift_id,decision,rows_json,snapshot_hash,comparison_json,source_confirmed,shift_confirmed,note,evidence,reviewer_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
    [
      randomUUID(),
      target.packageId,
      next,
      target.sourceRevision,
      target.selectedShiftId,
      decision,
      JSON.stringify(values),
      target.currentSnapshotHash,
      JSON.stringify(comparison),
      sourceConfirmed,
      shiftConfirmed,
      note,
      evidence,
      actorId,
    ]
  );
  return {
    id: target.packageId,
    revision: next,
    decision,
    stockApplied: false,
    financialApplied: false,
  };
}

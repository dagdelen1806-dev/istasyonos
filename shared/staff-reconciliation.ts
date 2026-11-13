/**
 * Offline, deterministic reconciliation primitives for a single fuel-staff
 * account. This module never posts money, confirms a bank receipt, or creates
 * a personnel receivable.
 */
export const reconciliationCategories = [
  "CASH",
  "CARD_SLIP",
  "IBAN",
  "FAST",
  "DEBT_SALE",
  "AR_COLLECTION",
  "TTS",
  "SPECIAL",
] as const;

export type ReconciliationCategory = (typeof reconciliationCategories)[number];
export type ReconciliationScope = {
  tenantId: string;
  stationId: string;
  businessDate: string;
  shiftId: string;
  staffUserId: number;
};

export type SourceRow = {
  id: string;
  category: ReconciliationCategory;
  amountMinor: number | null;
  volumeMl?: number | null;
  transactionCount?: number | null;
  evidenceRef?: string | null;
  bankConfirmation: "NOT_APPLICABLE" | "PENDING" | "CONFIRMED";
};

export type ReconciliationSource = {
  sourceKind: "MOBILE_DECLARATION" | "AUTOMATION_REPORT" | "SHIFT_CLOSE_REPORT";
  scope: ReconciliationScope;
  verified: boolean;
  rows: SourceRow[];
};

export type MobileDeclaration = ReconciliationSource & {
  sourceKind: "MOBILE_DECLARATION";
  accountId?: string;
  declarationId: string;
  revision: number;
  submittedAt: string;
  declaredTotals?: {
    sourceSalesMinor?: number | null;
    countedCashMinor?: number | null;
  };
};

export function isUsableFirstDeclarationSnapshot(
  value: unknown
): value is MobileDeclaration {
  if (!value || typeof value !== "object") return false;
  const snapshot = value as Partial<MobileDeclaration>;
  return (
    snapshot.sourceKind === "MOBILE_DECLARATION" &&
    snapshot.verified === true &&
    typeof snapshot.declarationId === "string" &&
    snapshot.declarationId.trim().length > 0 &&
    Number.isSafeInteger(snapshot.revision) &&
    (snapshot.revision ?? 0) >= 1 &&
    typeof snapshot.submittedAt === "string" &&
    Number.isFinite(Date.parse(snapshot.submittedAt)) &&
    validScope(snapshot.scope as ReconciliationScope) &&
    sourceRowsValid(snapshot as ReconciliationSource)
  );
}

export type CorrectionField = "category" | "amountMinor" | "evidenceRef";
export type CorrectionValue = ReconciliationCategory | number | string | null;
export type Correction = {
  revision: number;
  declarationId: string;
  entryId: string;
  field: CorrectionField;
  previousValue: CorrectionValue;
  newValue: CorrectionValue;
  correctedBy: number;
  createdAt: string;
  reason: string;
  evidenceRef: string;
};
export type CorrectionDraft = {
  declarationId: string;
  original: MobileDeclaration;
  corrections: Correction[];
  correctedRows: SourceRow[];
  status: "DRAFT_REVIEW_REQUIRED";
  financialPosted: false;
  bankConfirmed: false;
  personnelDebtCreated: false;
};

export type ReconciliationCell = {
  category: ReconciliationCategory;
  mobileMinor: number | null;
  automationMinor: number | null;
  closeMinor: number | null;
  mobileMinusAutomationMinor: number | null;
  automationMinusCloseMinor: number | null;
  bankPendingMinor: number | null;
  missingSlipCount: number;
};
export type ReconciliationResult = {
  status:
    | "SCOPE_MISMATCH"
    | "REVIEW_PENDING"
    | "SOURCE_UNVERIFIED"
    | "COMPARABLE_DRAFT";
  complete: boolean;
  scope: ReconciliationScope;
  cells: ReconciliationCell[];
  warnings: string[];
  personnelDebtCreated: false;
  financialPosted: false;
};

/** Draft-only response shape for a future authorized read-only review endpoint. */
export type StaffReconciliationReviewContract = {
  scope: ReconciliationScope;
  sourceStatuses: {
    firstDeclaration: "AVAILABLE" | "UNKNOWN";
    automation: "AVAILABLE" | "UNVERIFIED" | "MISSING";
    shiftClose: "AVAILABLE" | "UNVERIFIED" | "MISSING";
  };
  firstDeclaration:
    | { state: "FIRST_DECLARATION_UNKNOWN" }
    | { state: "FIRST_DECLARATION_AVAILABLE"; snapshot: MobileDeclaration };
  automation:
    | (ReconciliationSource & { sourceKind: "AUTOMATION_REPORT" })
    | null;
  shiftClose:
    | (ReconciliationSource & { sourceKind: "SHIFT_CLOSE_REPORT" })
    | null;
  state: "FIRST_DECLARATION_UNKNOWN" | "SOURCE_PENDING" | "REVIEW_READY";
  result: ReconciliationResult | null;
  correctionPersistence: "DRAFT_ONLY";
  financialPosted: false;
  personnelDebtCreated: false;
};

/**
 * Shapes a read-only review response. It deliberately refuses to substitute
 * current account totals when the immutable first declaration is unavailable.
 */
export function buildStaffReconciliationReviewContract(input: {
  scope: ReconciliationScope;
  firstDeclaration:
    | { state: "FIRST_DECLARATION_UNKNOWN" }
    | { state: "FIRST_DECLARATION_AVAILABLE"; snapshot: MobileDeclaration };
  automation:
    | (ReconciliationSource & { sourceKind: "AUTOMATION_REPORT" })
    | null;
  shiftClose:
    | (ReconciliationSource & { sourceKind: "SHIFT_CLOSE_REPORT" })
    | null;
}): StaffReconciliationReviewContract {
  const firstSnapshot =
    input.firstDeclaration.state === "FIRST_DECLARATION_AVAILABLE"
      ? input.firstDeclaration.snapshot
      : null;
  const firstDeclarationUsable =
    isUsableFirstDeclarationSnapshot(firstSnapshot);
  const base = {
    scope: { ...input.scope },
    sourceStatuses: {
      firstDeclaration: !firstDeclarationUsable
        ? ("UNKNOWN" as const)
        : ("AVAILABLE" as const),
      automation: !input.automation
        ? ("MISSING" as const)
        : input.automation.verified
          ? ("AVAILABLE" as const)
          : ("UNVERIFIED" as const),
      shiftClose: !input.shiftClose
        ? ("MISSING" as const)
        : input.shiftClose.verified
          ? ("AVAILABLE" as const)
          : ("UNVERIFIED" as const),
    },
    firstDeclaration:
      firstDeclarationUsable && firstSnapshot
        ? {
            state: "FIRST_DECLARATION_AVAILABLE" as const,
            snapshot: firstSnapshot,
          }
        : ({ state: "FIRST_DECLARATION_UNKNOWN" } as const),
    automation: input.automation,
    shiftClose: input.shiftClose,
    correctionPersistence: "DRAFT_ONLY" as const,
    financialPosted: false as const,
    personnelDebtCreated: false as const,
  };
  if (!firstDeclarationUsable)
    return { ...base, state: "FIRST_DECLARATION_UNKNOWN", result: null };
  if (!input.automation || !input.shiftClose)
    return { ...base, state: "SOURCE_PENDING", result: null };
  const result = reconcileStaffShift({
    mobile: firstSnapshot!,
    automation: input.automation,
    shiftClose: input.shiftClose,
  });
  return {
    ...base,
    state:
      result.status === "COMPARABLE_DRAFT" ? "REVIEW_READY" : "SOURCE_PENDING",
    result,
  };
}

const money = (value: number | null | undefined, name: string) => {
  if (value === null || value === undefined) return null;
  if (!Number.isSafeInteger(value) || value < 0)
    throw new Error(
      `${name} kuruş cinsinden negatif olmayan güvenli tamsayı olmalı.`
    );
  return value;
};

function validScope(scope: ReconciliationScope | null | undefined): boolean {
  if (!scope || typeof scope !== "object") return false;
  const date = /^\d{4}-\d{2}-\d{2}$/.test(scope.businessDate)
    ? new Date(scope.businessDate + "T00:00:00.000Z")
    : null;
  return (
    !!scope.tenantId?.trim() &&
    !!scope.stationId?.trim() &&
    date !== null &&
    !Number.isNaN(date.getTime()) &&
    date.toISOString().slice(0, 10) === scope.businessDate &&
    !!scope.shiftId?.trim() &&
    Number.isSafeInteger(scope.staffUserId) &&
    scope.staffUserId > 0
  );
}

function isValidSourceRow(value: unknown): value is SourceRow {
  if (!value || typeof value !== "object") return false;
  const row = value as Partial<SourceRow>;
  return (
    typeof row.id === "string" &&
    row.id.trim().length > 0 &&
    reconciliationCategories.includes(row.category as ReconciliationCategory) &&
    (row.amountMinor === null ||
      (Number.isSafeInteger(row.amountMinor) && row.amountMinor! >= 0)) &&
    (row.bankConfirmation === "NOT_APPLICABLE" ||
      row.bankConfirmation === "PENDING" ||
      row.bankConfirmation === "CONFIRMED") &&
    (row.evidenceRef === undefined ||
      row.evidenceRef === null ||
      typeof row.evidenceRef === "string")
  );
}

function sourceRowsValid(source: ReconciliationSource): boolean {
  if (!source || !Array.isArray(source.rows)) return false;
  const rows = source.rows as unknown[];
  if (!rows.every(isValidSourceRow)) return false;
  const ids = rows.map(row => row.id.trim());
  return new Set(ids).size === ids.length;
}

function sameScope(a: ReconciliationScope, b: ReconciliationScope): boolean {
  return (
    a.tenantId === b.tenantId &&
    a.stationId === b.stationId &&
    a.businessDate === b.businessDate &&
    a.shiftId === b.shiftId &&
    a.staffUserId === b.staffUserId
  );
}

function sumCategory(
  source: ReconciliationSource,
  category: ReconciliationCategory
) {
  if (!sourceRowsValid(source)) return null;
  const rows = source.rows.filter(row => row.category === category);
  if (!rows.length || rows.some(row => row.amountMinor === null)) return null;
  return rows.reduce((sum, row) => {
    const next = sum + money(row.amountMinor, "Tutar")!;
    if (!Number.isSafeInteger(next))
      throw new Error("Toplam güvenli kuruş sınırını aşıyor.");
    return next;
  }, 0);
}

export function reconcileStaffShift(input: {
  mobile: MobileDeclaration;
  automation: ReconciliationSource & { sourceKind: "AUTOMATION_REPORT" };
  shiftClose: ReconciliationSource & { sourceKind: "SHIFT_CLOSE_REPORT" };
}): ReconciliationResult {
  const { mobile, automation, shiftClose } = input;
  const warnings: string[] = [];
  const scope = mobile.scope;
  const scopesValid = [mobile, automation, shiftClose].every(source =>
    validScope(source.scope)
  );
  const sourceKindsMatch =
    mobile.sourceKind === "MOBILE_DECLARATION" &&
    automation.sourceKind === "AUTOMATION_REPORT" &&
    shiftClose.sourceKind === "SHIFT_CLOSE_REPORT";
  const scopesMatch =
    sourceKindsMatch &&
    scopesValid &&
    sameScope(scope, automation.scope) &&
    sameScope(scope, shiftClose.scope);
  const rowIdentitiesValid = [mobile, automation, shiftClose].every(
    sourceRowsValid
  );
  const firstDeclarationValid = isUsableFirstDeclarationSnapshot(mobile);
  const sourcesVerified =
    firstDeclarationValid &&
    automation.verified &&
    shiftClose.verified &&
    rowIdentitiesValid;
  if (!scopesValid)
    warnings.push("Kaynak kapsam alanlarından biri eksik veya geçersiz.");
  if (scopesValid && !scopesMatch)
    warnings.push(
      "Tenant, istasyon, tarih, vardiya ve personel üç kaynakta aynı değil."
    );
  if (!sourcesVerified)
    warnings.push(
      "Mobil beyan, otomasyon veya vardiya/gün sonu kaynağı henüz doğrulanmadı; kesin fark hesaplanmadı."
    );
  if (!firstDeclarationValid)
    warnings.push("Invalid, stale, or incomplete first declaration snapshot.");
  if (!rowIdentitiesValid)
    warnings.push(
      "Kaynaklardan en az birinde boş veya mükerrer satır kimliği var; toplamlar ve farklar kesinleştirilmedi."
    );

  const cells: ReconciliationCell[] = reconciliationCategories.map(category => {
    const mobileRows = (Array.isArray(mobile.rows) ? mobile.rows : []).filter(
      (row): row is SourceRow =>
        isValidSourceRow(row) && row.category === category
    );
    const tracksBank =
      category === "CARD_SLIP" || category === "IBAN" || category === "FAST";
    const bankPendingMinor = !sourceRowsValid(mobile)
      ? null
      : mobileRows
          .filter(row => tracksBank && row.bankConfirmation === "PENDING")
          .reduce((sum, row) => {
            const next = sum + (money(row.amountMinor, "Tutar") ?? 0);
            if (!Number.isSafeInteger(next))
              throw new Error(
                "Banka bekleyen toplamı güvenli kuruş sınırını aşıyor."
              );
            return next;
          }, 0);
    const missingSlipCount =
      category === "CARD_SLIP"
        ? mobileRows.filter(row => !row.evidenceRef).length
        : 0;
    return {
      category,
      mobileMinor: sumCategory(mobile, category),
      automationMinor: sumCategory(automation, category),
      closeMinor: sumCategory(shiftClose, category),
      mobileMinusAutomationMinor: null,
      automationMinusCloseMinor: null,
      bankPendingMinor,
      missingSlipCount,
    };
  });

  const comparable = scopesMatch && sourcesVerified;
  if (comparable) {
    for (const cell of cells) {
      if (cell.mobileMinor !== null && cell.automationMinor !== null)
        cell.mobileMinusAutomationMinor =
          cell.mobileMinor - cell.automationMinor;
      if (cell.automationMinor !== null && cell.closeMinor !== null)
        cell.automationMinusCloseMinor = cell.automationMinor - cell.closeMinor;
    }
  }
  if (cells.some(cell => cell.missingSlipCount > 0))
    warnings.push("Kart/slip beyanında kanıt belgesi eksik.");
  if (cells.some(cell => (cell.bankPendingMinor ?? 0) > 0))
    warnings.push(
      "IBAN/FAST/POS beyanlarının bir kısmı banka veya POS teyidi bekliyor."
    );
  warnings.push(
    "Bu karşılaştırma motoru banka teyidi doğrulamaz; teyit yalnız yetkili banka/POS doğrulama kaynağından alınmalıdır."
  );

  return {
    status: !scopesMatch
      ? "SCOPE_MISMATCH"
      : !sourcesVerified
        ? "SOURCE_UNVERIFIED"
        : "COMPARABLE_DRAFT",
    complete:
      comparable &&
      cells.every(
        cell =>
          cell.mobileMinor !== null &&
          cell.automationMinor !== null &&
          cell.closeMinor !== null
      ),
    scope,
    cells,
    warnings,
    personnelDebtCreated: false,
    financialPosted: false,
  };
}

function cloneRows(rows: SourceRow[]): SourceRow[] {
  return rows.map(row => ({ ...row }));
}

export function createCorrectionDraft(input: {
  declaration: MobileDeclaration;
  prior?: CorrectionDraft;
  correction: Omit<Correction, "revision" | "declarationId" | "previousValue">;
  accountantRole: "ACCOUNTANT" | "OWNER" | "MANAGER" | "FUEL_STAFF";
}): CorrectionDraft {
  const { declaration, prior, correction, accountantRole } = input;
  if (!isUsableFirstDeclarationSnapshot(declaration))
    throw new Error("İlk mobil beyan kapsamı veya sürümü geçersiz.");
  if (
    accountantRole !== "ACCOUNTANT" &&
    accountantRole !== "OWNER" &&
    accountantRole !== "MANAGER"
  )
    throw new Error("Bu kullanıcı muhasebe düzeltme taslağı oluşturamaz.");
  if (
    correction.correctedBy <= 0 ||
    !Number.isSafeInteger(correction.correctedBy)
  )
    throw new Error("Düzeltmeyi yapan kullanıcı geçersiz.");
  if (
    !correction.reason.trim() ||
    correction.reason.length > 1000 ||
    !correction.evidenceRef.trim()
  )
    throw new Error("Gerekçe ve kanıt referansı zorunludur.");
  if (!Number.isFinite(Date.parse(correction.createdAt)))
    throw new Error("Düzeltme tarih/saat değeri geçersiz.");

  const original = prior?.original ?? {
    ...declaration,
    rows: cloneRows(declaration.rows),
  };
  if (
    original.declarationId !== declaration.declarationId ||
    (prior && prior.declarationId !== declaration.declarationId)
  )
    throw new Error("Düzeltme başka bir ilk beyana bağlanamaz.");
  if (!prior && declaration.revision < 1)
    throw new Error("İlk beyan sürümü bulunamadı.");

  const correctedRows = cloneRows(prior?.correctedRows ?? original.rows);
  const entry = correctedRows.find(row => row.id === correction.entryId);
  if (!entry) throw new Error("Düzeltilecek beyan satırı bulunamadı.");
  let previousValue: CorrectionValue;
  if (correction.field === "category") {
    previousValue = entry.category;
    if (
      !reconciliationCategories.includes(
        correction.newValue as ReconciliationCategory
      )
    )
      throw new Error("Ödeme/işlem kategorisi geçersiz.");
    entry.category = correction.newValue as ReconciliationCategory;
  } else if (correction.field === "amountMinor") {
    previousValue = entry.amountMinor;
    if (correction.newValue !== null)
      money(correction.newValue as number, "Düzeltilen tutar");
    entry.amountMinor = correction.newValue as number | null;
  } else {
    previousValue = entry.evidenceRef ?? null;
    if (
      correction.newValue !== null &&
      (typeof correction.newValue !== "string" ||
        correction.newValue.length > 500)
    )
      throw new Error("Belge referansı geçersiz.");
    entry.evidenceRef = correction.newValue as string | null;
  }
  const history = [...(prior?.corrections ?? [])];
  const record: Correction = {
    ...correction,
    revision: history.length + 1,
    declarationId: declaration.declarationId,
    previousValue,
  };
  history.push(record);
  return {
    declarationId: declaration.declarationId,
    original,
    corrections: history,
    correctedRows,
    status: "DRAFT_REVIEW_REQUIRED",
    financialPosted: false,
    bankConfirmed: false,
    personnelDebtCreated: false,
  };
}

export function hasTwoIndependentApprovals(
  approvals: { userId: number; authorized: boolean }[],
  correctionAuthorId?: number
): boolean {
  const authorizedIds = approvals
    .filter(approval => approval.authorized && approval.userId > 0)
    .map(approval => approval.userId);
  const independentIds = [...new Set(authorizedIds)];
  return (
    independentIds.length >= 2 &&
    (correctionAuthorId === undefined ||
      independentIds.some(id => id !== correctionAuthorId))
  );
}

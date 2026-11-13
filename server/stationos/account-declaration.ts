type PaymentKind = "CASH" | "IBAN" | "FAST" | "DEBT" | "AR_COLLECTION";

export function canOpenBusinessUnit(
  role: string,
  businessUnit: "FUEL" | "MARKET"
): boolean {
  if (role === "FUEL_STAFF") return businessUnit === "FUEL";
  if (role === "MARKET_STAFF") return businessUnit === "MARKET";
  return role === "OWNER" || role === "MANAGER";
}

export type DeclarationSnapshotInput = {
  snapshotId: string;
  requestId: string;
  accountId: string;
  businessUnit?: "FUEL" | "MARKET";
  cycleNo: number;
  declarationRevision?: number;
  tenantId: string;
  stationId: string;
  shiftId: string;
  businessDate: string;
  staffUserId: number;
  submittedAt: string;
  sourceSalesMinor: number;
  countedCashMinor: number;
  payments: {
    id: string;
    kind: PaymentKind;
    amountMinor: number;
    debtorId: string | null;
    status: string;
  }[];
  slips: {
    id: string;
    amountMinor: number;
    status: string;
    method: string;
    transactionAt: string;
  }[];
  specialOperations: {
    id: string;
    kind: string;
    model: string;
    status: string;
    amountMinor: number;
    volumeMl: number;
    settlement: string;
    settlementMethod: string;
    paymentId: string | null;
    slipId: string | null;
  }[];
};

export function canReadFirstDeclarationSnapshot(
  role: string,
  actorId: number,
  accountOwnerId: number
): boolean {
  return (
    ["OWNER", "MANAGER", "ACCOUNTANT"].includes(role) ||
    (["FUEL_STAFF", "MARKET_STAFF"].includes(role) &&
      actorId === accountOwnerId)
  );
}

const id = (value: string, field: string) => {
  if (!value || value.length > 64) throw new Error(`INVALID_${field}`);
  return value;
};
const amount = (value: number, field: string) => {
  if (!Number.isSafeInteger(value) || value < 0)
    throw new Error(`INVALID_${field}`);
  return value;
};

/** Shape a submitted declaration for append-only storage. No card/reference PII is copied. */
export function buildFirstDeclarationSnapshot(input: DeclarationSnapshotInput) {
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(input.businessDate) ||
    !Number.isSafeInteger(input.staffUserId) ||
    input.staffUserId <= 0 ||
    !Number.isSafeInteger(input.cycleNo) ||
    input.cycleNo <= 0 ||
    !Number.isSafeInteger(input.declarationRevision ?? 1) ||
    (input.declarationRevision ?? 1) <= 0 ||
    !Number.isFinite(Date.parse(input.submittedAt))
  )
    throw new Error("INVALID_SNAPSHOT_SCOPE");

  const seen = new Set<string>();
  const unique = (sourceId: string) => {
    const key = id(sourceId, "SOURCE_ID");
    if (seen.has(key)) throw new Error("DUPLICATE_SNAPSHOT_SOURCE");
    seen.add(key);
    return sourceId;
  };
  const paymentRows = input.payments.map(row => ({
    sourceId: unique(row.id),
    category: row.kind === "DEBT" ? "DEBT_SALE" : row.kind,
    amountMinor: amount(row.amountMinor, "PAYMENT_AMOUNT"),
    debtorId: row.debtorId,
    recordStatus: row.status,
    bankConfirmation: ["IBAN", "FAST"].includes(row.kind)
      ? "PENDING"
      : "NOT_APPLICABLE",
  }));
  const slipRows = input.slips.map(row => ({
    sourceId: unique(row.id),
    category: "CARD_SLIP",
    amountMinor: amount(row.amountMinor, "SLIP_AMOUNT"),
    recordStatus: row.status,
    method: row.method,
    transactionAt: row.transactionAt,
    bankConfirmation: "PENDING",
  }));
  const specialOperations = input.specialOperations.map(row => ({
    sourceId: unique(row.id),
    kind: row.kind,
    model: row.model,
    recordStatus: row.status,
    amountMinor: amount(row.amountMinor, "SPECIAL_AMOUNT"),
    volumeMl: amount(row.volumeMl, "SPECIAL_VOLUME"),
    settlement: row.settlement,
    settlementMethod: row.settlementMethod,
    paymentId: row.paymentId,
    slipId: row.slipId,
  }));
  const reconciliationRows = [
    ...paymentRows
      .filter(row => row.recordStatus === "POSTED")
      .map(row => ({
        id: row.sourceId,
        category: row.category as
          | "CASH"
          | "IBAN"
          | "FAST"
          | "DEBT_SALE"
          | "AR_COLLECTION",
        amountMinor: row.amountMinor,
        evidenceRef: row.category === "DEBT_SALE" ? row.debtorId : null,
        bankConfirmation: row.bankConfirmation as "PENDING" | "NOT_APPLICABLE",
      })),
    ...slipRows
      .filter(row => row.recordStatus === "VERIFIED")
      .map(row => ({
        id: row.sourceId,
        category: "CARD_SLIP" as const,
        amountMinor: row.amountMinor,
        evidenceRef: row.sourceId,
        bankConfirmation: "PENDING" as const,
      })),
    ...specialOperations
      .filter(
        row =>
          row.recordStatus === "RECORDED" &&
          ["RECEIVABLE", "PREPAID"].includes(row.model) &&
          !row.paymentId &&
          !row.slipId &&
          ["TTS", "GIFT_USE", "PARTNER"].includes(row.kind)
      )
      .map(row => ({
        id: row.sourceId,
        category: row.kind === "TTS" ? ("TTS" as const) : ("SPECIAL" as const),
        amountMinor: row.amountMinor,
        evidenceRef: row.sourceId,
        bankConfirmation: "NOT_APPLICABLE" as const,
      })),
  ];

  return {
    kind:
      (input.declarationRevision ?? 1) === 1
        ? ("FIRST_DECLARATION_SNAPSHOT" as const)
        : ("DECLARATION_REVISION_SNAPSHOT" as const),
    sourceKind: "MOBILE_DECLARATION" as const,
    verified: true as const,
    verificationBasis: "AUTHENTICATED_SUBMISSION_ONLY" as const,
    accountingConfirmed: false as const,
    schemaVersion: 1 as const,
    status:
      (input.declarationRevision ?? 1) === 1
        ? ("FIRST_DECLARATION" as const)
        : ("DECLARATION_REVISION" as const),
    snapshotId: id(input.snapshotId, "SNAPSHOT_ID"),
    requestId: id(input.requestId, "REQUEST_ID"),
    accountId: id(input.accountId, "ACCOUNT_ID"),
    businessUnit: input.businessUnit ?? "FUEL",
    cycleNo: input.cycleNo,
    scope: {
      tenantId: id(input.tenantId, "TENANT_ID"),
      stationId: id(input.stationId, "STATION_ID"),
      shiftId: id(input.shiftId, "SHIFT_ID"),
      businessDate: input.businessDate,
      staffUserId: input.staffUserId,
    },
    submittedAt: new Date(input.submittedAt).toISOString(),
    declarationId: id(input.snapshotId, "DECLARATION_ID"),
    revision: input.declarationRevision ?? 1,
    declaredTotals: {
      sourceSalesMinor: amount(input.sourceSalesMinor, "SOURCE_TOTAL"),
      countedCashMinor: amount(input.countedCashMinor, "COUNTED_CASH"),
    },
    paymentRows,
    slipRows,
    specialOperations,
    rows: reconciliationRows,
    financialPosted: false as const,
    bankConfirmed: false as const,
    personnelDebtCreated: false as const,
  };
}

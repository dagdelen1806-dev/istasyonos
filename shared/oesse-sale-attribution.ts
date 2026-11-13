/**
 * Draft contract for transaction-level attribution from a trusted station
 * automation export. It never creates sales, meter readings, payments or debt.
 */
export type OesseAutomationSaleEvent = {
  sourceSystem: string;
  sourceEventId: string | null;
  tenantId: string | null;
  stationId: string | null;
  shiftId: string | null;
  pumpId: string | null;
  nozzleId: string | null;
  soldAt: string | null;
  productId: string | null;
  volumeMl: number | null;
  amountMinor: number | null;
  staffUserId: number | null;
  eventType: "SALE" | "VOID" | "REFUND" | "CORRECTION" | "UNKNOWN";
  reversesSourceEventId: string | null;
  evidenceRef: string | null;
  sourceVerified: boolean;
};

export type OesseSaleAttributionScope = {
  tenantId: string;
  stationId: string;
  shiftId: string;
  startsAt: string;
  endsAt: string;
  assignedStaffUserIds: number[];
  nozzles: {
    nozzleId: string;
    pumpId: string;
    productId: string;
  }[];
};

export type OesseSaleAttributionState =
  | "MATCHED_DRAFT"
  | "UNASSIGNED"
  | "REVIEW_REQUIRED";

export type OesseSaleAttributionResult = {
  rows: {
    sourceSystem: string;
    sourceEventId: string | null;
    staffUserId: number | null;
    nozzleId: string | null;
    state: OesseSaleAttributionState;
    issues: string[];
    volumeMl: number | null;
    amountMinor: number | null;
    financialApplied: false;
    meterReadingCreated: false;
    personnelDebtCreated: false;
  }[];
  totals: { saleCount: number; volumeMl: number; amountMinor: number } | null;
  state: "DRAFT_READY" | "REVIEW_REQUIRED";
  financialApplied: false;
  meterReadingCreated: false;
  personnelDebtCreated: false;
};

function strictInstant(value: string | null): number | null {
  if (!value) return null;
  const match =
    /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(Z|[+-](\d{2}):(\d{2}))$/.exec(
      value
    );
  if (!match) return null;
  const calendar = new Date(match[1] + "T00:00:00.000Z");
  if (
    Number.isNaN(calendar.getTime()) ||
    calendar.toISOString().slice(0, 10) !== match[1] ||
    Number(match[2]) > 23 ||
    Number(match[3]) > 59 ||
    Number(match[4]) > 59 ||
    Number(match[6] ?? 0) > 23 ||
    Number(match[7] ?? 0) > 59
  )
    return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function validNonnegativeInteger(value: number | null): value is number {
  return value !== null && Number.isSafeInteger(value) && value >= 0;
}

/**
 * Validates attribution only when the source supplies the full transaction
 * identity and a server-verified staff/nozzle/scope map. Any ambiguous row
 * blocks aggregate totals; sale time or POS amount similarity is never used
 * to infer a staff member.
 */
export function validateOesseSaleAttributions(
  events: OesseAutomationSaleEvent[],
  scope: OesseSaleAttributionScope
): OesseSaleAttributionResult {
  const startsAt = strictInstant(scope.startsAt),
    endsAt = strictInstant(scope.endsAt);
  const scopeValid =
    !!scope.tenantId.trim() &&
    !!scope.stationId.trim() &&
    !!scope.shiftId.trim() &&
    startsAt !== null &&
    endsAt !== null &&
    startsAt < endsAt &&
    new Set(scope.assignedStaffUserIds).size ===
      scope.assignedStaffUserIds.length &&
    scope.assignedStaffUserIds.every(
      userId => Number.isSafeInteger(userId) && userId > 0
    ) &&
    new Set(scope.nozzles.map(nozzle => nozzle.nozzleId)).size ===
      scope.nozzles.length &&
    scope.nozzles.every(
      nozzle =>
        !!nozzle.nozzleId.trim() &&
        !!nozzle.pumpId.trim() &&
        !!nozzle.productId.trim()
    );
  const eventKeyCounts = new Map<string, number>();
  for (const event of events) {
    if (!event.sourceSystem.trim() || !event.sourceEventId?.trim()) continue;
    const key = event.sourceSystem.trim() + ":" + event.sourceEventId.trim();
    eventKeyCounts.set(key, (eventKeyCounts.get(key) ?? 0) + 1);
  }
  const rows = events.map(event => {
    const issues: string[] = [];
    const eventKey =
      event.sourceSystem.trim() + ":" + (event.sourceEventId?.trim() ?? "");
    const eventTime = strictInstant(event.soldAt);
    const nozzle = scope.nozzles.find(item => item.nozzleId === event.nozzleId);
    if (!scopeValid) issues.push("INVALID_SHIFT_OR_STATION_SCOPE");
    if (!event.sourceVerified) issues.push("SOURCE_NOT_VERIFIED");
    if (!event.sourceSystem.trim() || !event.sourceEventId?.trim())
      issues.push("SOURCE_EVENT_ID_MISSING");
    else if ((eventKeyCounts.get(eventKey) ?? 0) > 1)
      issues.push("DUPLICATE_SOURCE_EVENT_ID");
    if (
      event.tenantId !== scope.tenantId ||
      event.stationId !== scope.stationId ||
      event.shiftId !== scope.shiftId
    )
      issues.push("TENANT_STATION_OR_SHIFT_MISMATCH");
    if (event.staffUserId === null) issues.push("STAFF_ID_MISSING");
    else if (!scope.assignedStaffUserIds.includes(event.staffUserId))
      issues.push("STAFF_NOT_ASSIGNED_TO_SHIFT");
    if (!event.nozzleId || !nozzle) issues.push("NOZZLE_NOT_IN_STATION_SCOPE");
    else if (event.pumpId !== nozzle.pumpId)
      issues.push("PUMP_NOZZLE_MISMATCH");
    if (!eventTime || startsAt === null || endsAt === null)
      issues.push("SALE_TIME_MISSING_OR_INVALID");
    else if (eventTime < startsAt || eventTime >= endsAt)
      issues.push("SALE_OUTSIDE_SHIFT");
    if (!event.productId || event.productId !== nozzle?.productId)
      issues.push("PRODUCT_NOZZLE_MISMATCH");
    if (!validNonnegativeInteger(event.volumeMl) || event.volumeMl === 0)
      issues.push("VOLUME_MISSING_OR_INVALID");
    if (!validNonnegativeInteger(event.amountMinor) || event.amountMinor === 0)
      issues.push("AMOUNT_MISSING_OR_INVALID");
    if (!event.evidenceRef?.trim()) issues.push("SOURCE_EVIDENCE_MISSING");
    if (
      event.eventType === "VOID" ||
      event.eventType === "REFUND" ||
      event.eventType === "CORRECTION"
    ) {
      if (
        !event.reversesSourceEventId?.trim() ||
        !events.some(
          original =>
            original.sourceSystem === event.sourceSystem &&
            original.sourceEventId?.trim() ===
              event.reversesSourceEventId?.trim()
        ) ||
        event.reversesSourceEventId.trim() === event.sourceEventId?.trim()
      )
        issues.push("REVERSAL_LINK_MISSING_OR_INVALID");
      issues.push("REVERSAL_REQUIRES_ACCOUNTING_REVIEW");
    } else if (event.eventType !== "SALE") {
      issues.push("EVENT_TYPE_UNKNOWN");
    }
    const state: OesseSaleAttributionState =
      event.staffUserId === null
        ? "UNASSIGNED"
        : issues.length
          ? "REVIEW_REQUIRED"
          : "MATCHED_DRAFT";
    return {
      sourceSystem: event.sourceSystem,
      sourceEventId: event.sourceEventId,
      staffUserId: event.staffUserId,
      nozzleId: event.nozzleId,
      state,
      issues,
      volumeMl: state === "MATCHED_DRAFT" ? event.volumeMl : null,
      amountMinor: state === "MATCHED_DRAFT" ? event.amountMinor : null,
      financialApplied: false as const,
      meterReadingCreated: false as const,
      personnelDebtCreated: false as const,
    };
  });
  const totalsReady =
    rows.length > 0 && rows.every(row => row.state === "MATCHED_DRAFT");
  const sumSafe = (values: number[]) =>
    values.reduce((sum, value) => {
      const next = sum + value;
      return Number.isSafeInteger(next) ? next : NaN;
    }, 0);
  const volumeMl = sumSafe(rows.map(row => row.volumeMl ?? 0));
  const amountMinor = sumSafe(rows.map(row => row.amountMinor ?? 0));
  const totals =
    totalsReady &&
    Number.isSafeInteger(volumeMl) &&
    Number.isSafeInteger(amountMinor)
      ? { saleCount: rows.length, volumeMl, amountMinor }
      : null;
  return {
    rows,
    totals,
    state: totals ? "DRAFT_READY" : "REVIEW_REQUIRED",
    financialApplied: false,
    meterReadingCreated: false,
    personnelDebtCreated: false,
  };
}

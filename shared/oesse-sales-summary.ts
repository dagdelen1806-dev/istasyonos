export type OseeSalesScope = {
  tenantId: string;
  stationId: string;
  businessDate: string;
  shiftId: string;
  staffUserId: number;
};

export type OseeAutomationSalesSource = {
  scope: OseeSalesScope;
  amountMinor: number | null;
  verified: boolean;
};

export type OseeSalesSummary = {
  declaredTotalMinor: number;
  specialOperationsMinor: number;
  automationSalesMinor: number | null;
  differenceMinor: number | null;
  status:
    | "AUTOMATION_SOURCE_MISSING"
    | "SCOPE_MISMATCH"
    | "SOURCE_UNVERIFIED"
    | "PRELIMINARY_COMPARISON";
};

function validScope(scope: OseeSalesScope): boolean {
  const date = /^\d{4}-\d{2}-\d{2}$/.test(scope.businessDate)
    ? new Date(`${scope.businessDate}T00:00:00.000Z`)
    : null;
  return (
    !!scope.tenantId.trim() &&
    !!scope.stationId.trim() &&
    date !== null &&
    !Number.isNaN(date.valueOf()) &&
    date.toISOString().slice(0, 10) === scope.businessDate &&
    !!scope.shiftId.trim() &&
    Number.isSafeInteger(scope.staffUserId) &&
    scope.staffUserId > 0
  );
}

function sameScope(left: OseeSalesScope, right: OseeSalesScope): boolean {
  return (
    left.tenantId === right.tenantId &&
    left.stationId === right.stationId &&
    left.businessDate === right.businessDate &&
    left.shiftId === right.shiftId &&
    left.staffUserId === right.staffUserId
  );
}

/**
 * Keeps the mobile payment/cari declaration separate from automation sales.
 * A difference is available only for a verified source with an exact scope.
 */
export function buildOseeSalesSummary(input: {
  declarations: {
    cashMinor: number;
    cardSlipMinor: number;
    ibanMinor: number;
    fastMinor: number;
    debtMinor: number;
    specialOperationsMinor: number;
  };
  expectedScope: OseeSalesScope | null;
  automation: OseeAutomationSalesSource | null;
}): OseeSalesSummary {
  const {
    cashMinor,
    cardSlipMinor,
    ibanMinor,
    fastMinor,
    debtMinor,
    specialOperationsMinor,
  } = input.declarations;
  const declarationAmounts = [
    cashMinor,
    cardSlipMinor,
    ibanMinor,
    fastMinor,
    debtMinor,
    specialOperationsMinor,
  ];
  if (
    declarationAmounts.some(
      amount => !Number.isSafeInteger(amount) || amount < 0
    )
  )
    throw new Error("INVALID_DECLARATION_AMOUNT");
  const declaredTotalMinor =
    cashMinor + cardSlipMinor + ibanMinor + fastMinor + debtMinor;
  if (!Number.isSafeInteger(declaredTotalMinor))
    throw new Error("DECLARED_TOTAL_OVERFLOW");

  const base = {
    declaredTotalMinor,
    specialOperationsMinor,
    automationSalesMinor: null,
    differenceMinor: null,
  } as const;
  if (!input.automation)
    return { ...base, status: "AUTOMATION_SOURCE_MISSING" };
  if (
    !input.expectedScope ||
    !validScope(input.expectedScope) ||
    !validScope(input.automation.scope) ||
    !sameScope(input.expectedScope, input.automation.scope)
  )
    return { ...base, status: "SCOPE_MISMATCH" };
  if (
    !input.automation.verified ||
    input.automation.amountMinor === null ||
    !Number.isSafeInteger(input.automation.amountMinor) ||
    input.automation.amountMinor < 0
  )
    return { ...base, status: "SOURCE_UNVERIFIED" };

  return {
    declaredTotalMinor,
    specialOperationsMinor,
    automationSalesMinor: input.automation.amountMinor,
    differenceMinor: input.automation.amountMinor - declaredTotalMinor,
    status: "PRELIMINARY_COMPARISON",
  };
}

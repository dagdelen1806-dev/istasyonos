import { createElement } from "react";
import { createRoot } from "react-dom/client";
import type { AppState } from "@shared/station";
import { money } from "@shared/station";
import { PompaciMobilePage } from "@/components/stationos/PompaciMobilePage";
import { PersonnelPanel } from "@/components/stationos/PersonnelPanel";
import { StaffReconciliationDraftPanel } from "@/components/stationos/StaffReconciliationDraftPanel";
import type { DailyAccountDraft } from "@shared/daily-account-review";
import type { OesseShiftReportDraft } from "@shared/oesse-shift-report";
import { listMobileOperations, readMobilePayload } from "@/lib/mobile-outbox";

type BrowserDiagnostic = {
  type: "assertion" | "console" | "page-error";
  name: string;
  expected?: unknown;
  actual?: unknown;
  stack?: string;
  pass?: boolean;
};

const browserDiagnostics: BrowserDiagnostic[] = [];
const sanitizeDiagnostic = (value: unknown): unknown => {
  if (typeof value !== "string") return value;
  return value
    .replace(/https?:\/\/[^\s"']+/gi, "[url]")
    .replace(/file:\/\/[^\s"']+/gi, "[file]")
    .replace(/[A-Za-z]:[\\/][^\s)]+/g, "[path]")
    .replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g, "[email]")
    .replace(/\b(?:\d[ -]*?){13,19}\b/g, "[payment-number]")
    .slice(0, 240);
};
const recordAssertion = (
  name: string,
  expected: unknown,
  actual: unknown,
  pass: boolean
) => {
  browserDiagnostics.push({
    type: "assertion",
    name,
    expected: sanitizeDiagnostic(expected),
    actual: sanitizeDiagnostic(actual),
    pass,
  });
  publishDiagnostics();
  return pass;
};
const publishDiagnostics = () => {
  const target = document.getElementById("browser-diagnostics");
  if (target)
    target.textContent = JSON.stringify({
      failures: browserDiagnostics.filter(
        item => item.type === "assertion" && item.pass === false
      ),
      browserErrors: browserDiagnostics.filter(
        item => item.type !== "assertion"
      ),
      dom: Object.fromEntries(
        [
          "mobile",
          "mobile-shifts",
          "mobile-shifts-gated",
          "mobile-submit",
          "manager",
          "manager-gated",
          "reconciliation",
          "legacy-reconciliation",
          "mismatch",
          "api-error",
          "invalid-row-reconciliation",
          "legacy-daily-reconciliation",
        ].map(id => {
          const element = document.getElementById(id);
          return [
            id,
            {
              present: !!element,
              childCount: element?.childElementCount ?? 0,
              textLength: element?.textContent?.length ?? 0,
            },
          ];
        })
      ),
    });
  if (target && document.body)
    document.body.dataset.testDiagnostics = encodeURIComponent(
      target.textContent
    );
};

const originalConsoleError = console.error.bind(console);
console.error = (...args: unknown[]) => {
  const first = args[0];
  const error = first instanceof Error ? first : null;
  browserDiagnostics.push({
    type: "console",
    name: error?.name ?? "console.error",
    actual: sanitizeDiagnostic(error?.message ?? String(first ?? "")),
    stack: error?.stack
      ? (sanitizeDiagnostic(error.stack) as string)
      : undefined,
  });
  publishDiagnostics();
  originalConsoleError("[synthetic-browser-error]");
};
window.addEventListener("error", event => {
  browserDiagnostics.push({
    type: "page-error",
    name: event.error?.name ?? "window.error",
    actual: sanitizeDiagnostic(event.message),
    stack: event.error?.stack
      ? (sanitizeDiagnostic(event.error.stack) as string)
      : undefined,
  });
  publishDiagnostics();
});
window.addEventListener("unhandledrejection", event => {
  const reason = event.reason;
  browserDiagnostics.push({
    type: "page-error",
    name: reason instanceof Error ? reason.name : "unhandledrejection",
    actual: sanitizeDiagnostic(
      reason instanceof Error ? reason.message : String(reason ?? "")
    ),
    stack:
      reason instanceof Error && reason.stack
        ? (sanitizeDiagnostic(reason.stack) as string)
        : undefined,
  });
  publishDiagnostics();
});

const stationA = {
  id: "station-a",
  companyId: "company-a",
  name: "İstasyon A",
  code: "A",
  address: null,
};
const stationB = {
  id: "station-b",
  companyId: "company-a",
  name: "İstasyon B",
  code: "B",
  address: null,
};
const common = {
  user: { id: 17, name: "Sentetik ÖSSE", email: null },
  canSetup: false,
  tenant: { id: "tenant-a", name: "Sentetik işletme", isDemo: true },
  csrfToken: "synthetic-csrf",
  companies: [],
  stations: [stationA, stationB],
  members: [],
  shifts: [
    {
      id: "shift-assigned",
      stationId: stationA.id,
      label: "Atanmış sabah",
      startsAt: "2026-11-09T06:00:00.000Z",
      endsAt: "2026-11-09T14:00:00.000Z",
      status: "OPEN",
      assignedUserIds: [17],
    },
    {
      id: "shift-other",
      stationId: stationA.id,
      label: "Başkasının vardiyası",
      startsAt: "2026-11-09T06:00:00.000Z",
      endsAt: "2026-11-09T14:00:00.000Z",
      status: "OPEN",
      assignedUserIds: [18],
    },
    {
      id: "shift-closed",
      stationId: stationA.id,
      label: "Kapalı vardiya",
      startsAt: "2026-11-08T06:00:00.000Z",
      endsAt: "2026-11-08T14:00:00.000Z",
      status: "CLOSED",
      assignedUserIds: [17],
    },
  ],
  accounts: [],
  payments: [],
  slips: [],
  debtors: [],
  products: [],
  suppliers: [],
  payables: [],
  recommendations: [],
  audit: [],
} as unknown as AppState;

const mobileState = {
  ...common,
  member: { role: "FUEL_STAFF", stationIds: [stationA.id, stationB.id] },
  staffingFeaturesAvailable: true,
  fastPaymentAvailable: false,
  posSlipAvailable: false,
  accounts: [
    {
      id: "synthetic-mobile-account",
      stationId: stationA.id,
      shiftId: "shift-assigned",
      userId: 17,
      userName: "Synthetic OSEE",
      status: "OPEN",
      revision: 1,
      businessUnit: "FUEL",
      openingFloatMinor: 0,
      sourceSalesMinor: 24_000,
      sourceRef: "synthetic-account-control",
      cardTotalMinor: 5_000,
      cashSalesMinor: 10_000,
      ibanMinor: 2_000,
      fastMinor: 0,
      debtMinor: 3_000,
      arCollectionMinor: 0,
      expectedCashMinor: 10_000,
      countedCashMinor: null,
      differenceMinor: null,
      cashReceiverUserId: null,
      signatureCount: 0,
      specialCoveredMinor: 4_000,
    },
  ],
  debtors: [
    {
      id: "synthetic-debtor-1",
      stationId: stationA.id,
      name: "Sentetik müşteri",
      type: "COMPANY",
      balanceMinor: 100_000,
    },
  ],
} as AppState;
const mobileShiftState = { ...mobileState, accounts: [] } as AppState;

const mobileSubmitState = {
  ...mobileState,
  user: { id: 20, name: "Sentetik teslim ÖSSE", email: null },
  shifts: mobileState.shifts.map(shift => ({
    ...shift,
    assignedUserIds: [17, 20],
  })),
  accounts: mobileState.accounts.map(account => ({
    ...account,
    id: "synthetic-submit-account",
    userId: 20,
    userName: "Sentetik teslim ÖSSE",
  })),
} as AppState;

const managerState = {
  ...common,
  user: { id: 31, name: "Sentetik yönetici", email: null },
  member: { role: "MANAGER", stationIds: [stationA.id, stationB.id] },
  staffingFeaturesAvailable: true,
  members: [
    {
      userId: 17,
      name: "Sentetik aynı ad",
      email: null,
      role: "FUEL_STAFF",
      stationIds: [stationA.id],
      stationAccess: { [stationA.id]: "ACTIVE" },
    },
    {
      userId: 18,
      name: "Sentetik aynı ad",
      email: null,
      role: "FUEL_STAFF",
      stationIds: [stationA.id],
      stationAccess: { [stationA.id]: "ACTIVE" },
    },
    {
      userId: 19,
      name: "Başka istasyon personeli",
      email: null,
      role: "FUEL_STAFF",
      stationIds: [stationB.id],
      stationAccess: { [stationB.id]: "ACTIVE" },
    },
  ],
  shifts: [
    {
      ...common.shifts[0],
      assignedUserIds: [],
      startsAt: "2026-11-09T04:55:17.000Z",
      endsAt: "2026-11-10T04:55:09.000Z",
    },
  ],
  accounts: [
    {
      id: "synthetic-account-17",
      stationId: stationA.id,
      shiftId: "shift-assigned",
      userId: 17,
      userName: "Sentetik aynı ad",
      status: "SUBMITTED",
      revision: 1,
      businessUnit: "FUEL",
      openingFloatMinor: 0,
      sourceSalesMinor: null,
      sourceRef: null,
      cardTotalMinor: 0,
      cashSalesMinor: 0,
      ibanMinor: 0,
      fastMinor: 0,
      debtMinor: 0,
      arCollectionMinor: 0,
      expectedCashMinor: 0,
      countedCashMinor: null,
      differenceMinor: null,
      cashReceiverUserId: null,
      signatureCount: 0,
    },
  ],
} as AppState;

const reviewScope = {
  tenantId: "tenant-a",
  stationId: stationA.id,
  businessDate: "2026-11-09",
  shiftId: "shift-assigned",
  staffUserId: 17,
};
const dailyAccountDraft = {
  kind: "DAILY_STAFF_CASH_UP",
  sourceSha256: "d".repeat(64),
  sheetName: "Sentetik günlük hesap",
  headerDateRaw: "09/10/2026",
  dateStatus: "AMBIGUOUS_OR_UNMATCHED",
  staffRows: [3, 4, 5].map((sourceRow, index) => ({
    sourceRow,
    sourceLocation: `Sentetik günlük hesap!C${sourceRow}`,
    nameSuggestion: index < 2 ? "Sentetik aynı ad" : null,
    duplicateName: index < 2,
    staffUserId: null,
    requiresUserMapping: true,
    cashMinor: 10000,
    cardSlipMinor: 5000,
    fastMinor: 0,
    ibanMinor: 0,
    debtMinor: 0,
    declaredTotalMinor: 15000,
    automationMinor: 15000,
    sourceCells: {
      name: `C${sourceRow}`,
      cash: `D${sourceRow}`,
      cardSlip: `E${sourceRow}`,
      fast: `F${sourceRow}`,
      iban: `G${sourceRow}`,
      debt: `H${sourceRow}`,
      automation: `J${sourceRow}`,
    },
  })),
  totals: {
    cashMinor: 27162000,
    cardSlipMinor: 115320700,
    fastMinor: 0,
    ibanMinor: 200000,
    debtMinor: 7293300,
    declaredTotalMinor: 149976000,
    automationMinor: 149974699,
    declarationVarianceMinor: 1301,
    posDayEndMinor: 115316275,
    posDayEndVarianceMinor: -4425,
    posBefore23Minor: 15330933,
    posAfter23Minor: 50844059,
    posTimeUnknownMinor: 49141283,
  },
  posRows: [],
  blankCategories: ["FAST"],
  ignoredFormulaCells: ["I3", "K3"],
  warnings: ["Sentetik tarih belirsiz", "POS teyidi bekliyor"],
  status: "REVIEW_REQUIRED",
  financialApplied: false,
  bankConfirmed: false,
  personnelDebtCreated: false,
} as unknown as DailyAccountDraft;
const automationDraft = {
  reportType: "AUTOMATION_SHIFT_SALES",
  status: "READY_FOR_MAPPING",
  shiftId: "shift-assigned",
  startsAt: "2026-11-09T07:55:17",
  endsAt: "2026-11-10T07:55:09",
  metadataSourceFields: {
    shiftId: "sentetik-otomasyon!A1:B1",
    startsAt: "sentetik-otomasyon!A2:B2",
    endsAt: "sentetik-otomasyon!A3:B3",
  },
  staffRows: [
    {
      nameSuggestion: "Sentetik aynı ad",
      staffUserId: 17,
      transactionCount: 10,
      amountMinor: 149974699,
      sourceLocation: "sentetik-otomasyon!A2",
      sourceFields: {
        name: "sentetik-otomasyon!A2",
        transactionCount: "sentetik-otomasyon!B2",
        amount: "sentetik-otomasyon!C2",
      },
      requiresUserMapping: true,
      duplicateName: false,
    },
  ],
  categoryRows: [],
  reportedStaffTotal: {
    transactionCount: 10,
    amountMinor: 149974699,
    sourceLocation: "sentetik-otomasyon!A3",
    sourceFields: {
      name: "sentetik-otomasyon!A3",
      transactionCount: "sentetik-otomasyon!B3",
      amount: "sentetik-otomasyon!C3",
    },
  },
  reportedGeneralTotal: {
    transactionCount: 10,
    amountMinor: 149974699,
    sourceLocation: "sentetik-otomasyon!A4",
    sourceFields: {
      name: "sentetik-otomasyon!A4",
      transactionCount: "sentetik-otomasyon!B4",
      amount: "sentetik-otomasyon!C4",
    },
  },
  checks: {
    staffCountMatches: true,
    staffAmountMatches: true,
    generalAmountMatches: true,
    crossMidnight: true,
    duplicateReportDetectionKey: "synthetic",
  },
  warnings: [],
  sourceLocations: ["sentetik-otomasyon!A2"],
  financialApplied: false,
  independentDayEndSource: false,
} as unknown as OesseShiftReportDraft;

const actions: { path: string; payload: Record<string, unknown> }[] = [];
(window as any).__staffingActions = actions;
const sourceReads: string[] = [];
const sourceReadOutcomes: {
  source: "snapshot" | "numeric";
  key: string;
  status: number;
}[] = [];
let nonReadRequests = 0;
(window as any).__reviewSourceReads = sourceReads;
(window as any).__reviewSourceReadOutcomes = sourceReadOutcomes;
(window as any).__reviewNonReadRequests = () => nonReadRequests;
const firstSnapshot = {
  sourceKind: "MOBILE_DECLARATION",
  accountId: "synthetic-account-17",
  scope: reviewScope,
  declaredTotals: { sourceSalesMinor: 15000, countedCashMinor: 10000 },
  verified: true,
  declarationId: "synthetic-first-declaration",
  revision: 1,
  submittedAt: "2026-11-10T08:00:00.000Z",
  rows: [
    {
      id: "cash-row",
      category: "CASH",
      amountMinor: 10000,
      evidenceRef: null,
      bankConfirmation: "NOT_APPLICABLE",
    },
    {
      id: "slip-row",
      category: "CARD_SLIP",
      amountMinor: 5000,
      evidenceRef: "masked-slip-demo",
      bankConfirmation: "PENDING",
    },
  ],
};
window.fetch = async (input, init) => {
  const url =
      typeof input === "string"
        ? input
        : input instanceof Request
          ? input.url
          : String(input),
    method = init?.method ?? "GET";
  if (method !== "GET") nonReadRequests++;
  if (url.includes("pos-slip-drafts"))
    return new Response('{"drafts":[]}', { status: 200 });
  if (url.includes("declaration-snapshot")) {
    const accountId =
      new URL(url, location.href).searchParams.get("accountId") ?? "";
    sourceReads.push(`snapshot:${accountId}`);
    if (accountId === "synthetic-api-error") {
      sourceReadOutcomes.push({
        source: "snapshot",
        key: accountId,
        status: 503,
      });
      return new Response(
        JSON.stringify({ error: { message: "Sentetik kaynak API hatası" } }),
        { status: 503, headers: { "content-type": "application/json" } }
      );
    }
    const mismatch = accountId.match(
      /^synthetic-(tenant|station|date|shift|person)-mismatch$/
    )?.[1];
    const changes: Record<string, Record<string, unknown>> = {
      tenant: { tenantId: "tenant-other" },
      station: { stationId: "station-other" },
      date: { businessDate: "2026-11-08" },
      shift: { shiftId: "shift-other" },
      person: { staffUserId: 18 },
    };
    const snapshot = mismatch
      ? {
          ...firstSnapshot,
          accountId,
          scope: { ...reviewScope, ...changes[mismatch] },
        }
      : firstSnapshot;
    sourceReadOutcomes.push({
      source: "snapshot",
      key: accountId,
      status: 200,
    });
    return new Response(
      JSON.stringify({
        ok: true,
        result: { state: "FIRST_DECLARATION_AVAILABLE", snapshot },
      }),
      { status: 200, headers: { "content-type": "application/json" } }
    );
  }
  if (url.includes("daily-report/numeric")) {
    const packageId = new URL(url, location.href).searchParams.get("packageId");
    const packageKey = packageId ?? "<missing>";
    sourceReads.push(`numeric:${packageKey}`);
    if (packageId === "synthetic-api-error-package") {
      sourceReadOutcomes.push({
        source: "numeric",
        key: packageKey,
        status: 503,
      });
      return new Response(
        JSON.stringify({
          error: { message: "Sentetik otomasyon API hatası" },
          latest: { rows: [{ amountMinor: 987654321 }] },
        }),
        { status: 503, headers: { "content-type": "application/json" } }
      );
    }
    sourceReadOutcomes.push({
      source: "numeric",
      key: packageKey,
      status: 200,
    });
    return new Response(
      JSON.stringify({
        ok: true,
        latest: null,
        sourceDay: "2026-11-09",
        selectedShiftId: "shift-assigned",
        stale: true,
      }),
      { status: 200, headers: { "content-type": "application/json" } }
    );
  }
  return new Response("{}", {
    status: 404,
    headers: { "content-type": "application/json" },
  });
};

createRoot(document.getElementById("mobile")!).render(
  createElement(PompaciMobilePage, {
    state: mobileState,
    busy: false,
    offlineOnly: true,
    offlineContextSavedAt: null,
    offlineStorageWarning: "",
    onRefresh: async () => undefined,
    onSyncVersion: () => undefined,
    onAction: async () => {
      throw new Error("Browser fixture must not call the server");
    },
  })
);
createRoot(document.getElementById("mobile-shifts")!).render(
  createElement(PompaciMobilePage, {
    state: mobileShiftState,
    busy: false,
    offlineOnly: false,
    offlineContextSavedAt: null,
    offlineStorageWarning: "",
    onRefresh: async () => undefined,
    onSyncVersion: () => undefined,
    onAction: async () => {
      throw new Error("Browser fixture must not call the server");
    },
  })
);
createRoot(document.getElementById("mobile-shifts-gated")!).render(
  createElement(PompaciMobilePage, {
    state: {
      ...mobileShiftState,
      staffingFeaturesAvailable: false,
    } as AppState,
    busy: false,
    offlineOnly: false,
    offlineContextSavedAt: null,
    offlineStorageWarning: "",
    onRefresh: async () => undefined,
    onSyncVersion: () => undefined,
    onAction: async () => {
      throw new Error("Feature-gated fixture must not call the server");
    },
  })
);
const mobileSubmitActions: string[] = [];
(window as any).__mobileSubmitActions = mobileSubmitActions;
createRoot(document.getElementById("mobile-submit")!).render(
  createElement(PompaciMobilePage, {
    state: mobileSubmitState,
    busy: false,
    offlineOnly: true,
    offlineContextSavedAt: null,
    offlineStorageWarning: "",
    onRefresh: async () => undefined,
    onSyncVersion: () => undefined,
    onAction: async path => {
      mobileSubmitActions.push(path);
      return true;
    },
  })
);
createRoot(document.getElementById("manager")!).render(
  createElement(PersonnelPanel, {
    state: managerState,
    busy: false,
    inviteCode: "",
    onInvite: () => undefined,
    onAction: async (path, payload) => {
      actions.push({ path, payload });
      return true;
    },
  })
);
const gatedManagerActions: {
  path: string;
  payload: Record<string, unknown>;
}[] = [];
(window as any).__gatedManagerActions = gatedManagerActions;
createRoot(document.getElementById("manager-gated")!).render(
  createElement(PersonnelPanel, {
    state: { ...managerState, staffingFeaturesAvailable: false } as AppState,
    busy: false,
    inviteCode: "",
    onInvite: () => undefined,
    onAction: async (path, payload) => {
      gatedManagerActions.push({ path, payload });
      return true;
    },
  })
);
createRoot(document.getElementById("reconciliation")!).render(
  createElement(StaffReconciliationDraftPanel, {
    accountantId: 31,
    role: "ACCOUNTANT",
    liveSources: {
      state: managerState,
      stationId: stationA.id,
      packageId: "synthetic-automation-package",
      automationDraft,
      dailyAccountDraft,
      dailyAccountSourceName: "synthetic-daily-account.xlsx",
    },
  })
);
const legacyAutomationDraft = {
  ...automationDraft,
  metadataSourceFields: undefined,
} as unknown as OesseShiftReportDraft;
createRoot(document.getElementById("legacy-reconciliation")!).render(
  createElement(StaffReconciliationDraftPanel, {
    accountantId: 31,
    role: "ACCOUNTANT",
    liveSources: {
      state: managerState,
      stationId: stationA.id,
      packageId: "synthetic-automation-package",
      automationDraft: legacyAutomationDraft,
      dailyAccountDraft,
      dailyAccountSourceName: "synthetic-daily-account.xlsx",
    },
  })
);
const invalidRowAutomationDraft = {
  ...automationDraft,
  staffRows: automationDraft.staffRows.map((row: any) => ({
    ...row,
    sourceFields: undefined,
  })),
} as unknown as OesseShiftReportDraft;
createRoot(document.getElementById("invalid-row-reconciliation")!).render(
  createElement(StaffReconciliationDraftPanel, {
    accountantId: 31,
    role: "ACCOUNTANT",
    liveSources: {
      state: managerState,
      stationId: stationA.id,
      packageId: "synthetic-automation-package",
      automationDraft: invalidRowAutomationDraft,
      dailyAccountDraft,
      dailyAccountSourceName: "synthetic-daily-account.xlsx",
    },
  })
);
const legacyDailyAccountDraft = {
  ...dailyAccountDraft,
  staffRows: dailyAccountDraft.staffRows.map((row: any) => ({
    ...row,
    sourceCells: null,
  })),
} as unknown as DailyAccountDraft;
createRoot(document.getElementById("legacy-daily-reconciliation")!).render(
  createElement(StaffReconciliationDraftPanel, {
    accountantId: 31,
    role: "ACCOUNTANT",
    liveSources: {
      state: managerState,
      stationId: stationA.id,
      packageId: "synthetic-automation-package",
      automationDraft,
      dailyAccountDraft: legacyDailyAccountDraft,
      dailyAccountSourceName: "synthetic-legacy-daily-account.xlsx",
    },
  })
);
createRoot(document.getElementById("mismatch")!).render(
  createElement(StaffReconciliationDraftPanel, {
    accountantId: 31,
    role: "ACCOUNTANT",
    liveSources: {
      state: managerState,
      stationId: stationA.id,
      packageId: "synthetic-automation-package",
      automationDraft: { ...automationDraft, shiftId: "another-shift" },
      dailyAccountDraft,
      dailyAccountSourceName: "synthetic-daily-account.xlsx",
    },
  })
);

const scopeMismatchCases = [
  "tenant",
  "station",
  "date",
  "shift",
  "person",
] as const;
for (const field of scopeMismatchCases) {
  const accountId = `synthetic-${field}-mismatch`;
  createRoot(document.getElementById(`${field}-mismatch`)!).render(
    createElement(StaffReconciliationDraftPanel, {
      accountantId: 31,
      role: "ACCOUNTANT",
      liveSources: {
        state: {
          ...managerState,
          accounts: [{ ...managerState.accounts[0], id: accountId }],
        },
        stationId: stationA.id,
        packageId: "synthetic-automation-package",
        automationDraft,
        dailyAccountDraft,
        dailyAccountSourceName: "synthetic-daily-account.xlsx",
      },
    })
  );
}
createRoot(document.getElementById("api-error")!).render(
  createElement(StaffReconciliationDraftPanel, {
    accountantId: 31,
    role: "ACCOUNTANT",
    liveSources: {
      state: {
        ...managerState,
        accounts: [{ ...managerState.accounts[0], id: "synthetic-api-error" }],
      },
      stationId: stationA.id,
      packageId: "synthetic-api-error-package",
      automationDraft,
      dailyAccountDraft,
      dailyAccountSourceName: "synthetic-daily-account.xlsx",
    },
  })
);

setTimeout(() => {
  const mobile = document.getElementById("mobile")!;
  const mobileShifts = document.getElementById("mobile-shifts")!;
  const shiftOptions = [
    ...mobileShifts.querySelectorAll<HTMLSelectElement>(
      'select[name="shiftId"] option'
    ),
  ].map(option => option.textContent ?? "");
  const manager = document.getElementById("manager")!;
  const assignmentBox = [
    ...manager.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'),
  ].find(input =>
    input.closest("label")?.textContent?.includes("Atanmış sabah")
  );
  const managerAssignmentAuthorized =
    managerState.member.role === "MANAGER" &&
    managerState.member.stationIds.includes(stationA.id) &&
    managerState.shifts.some(
      shift =>
        shift.id === "shift-assigned" &&
        shift.stationId === stationA.id &&
        shift.status === "OPEN"
    ) &&
    managerState.members.some(
      member =>
        member.userId === 17 &&
        member.role === "FUEL_STAFF" &&
        member.stationIds.includes(stationA.id) &&
        member.stationAccess?.[stationA.id] === "ACTIVE"
    );
  const managerAssignmentControlReady =
    managerAssignmentAuthorized &&
    assignmentBox?.disabled === false &&
    assignmentBox.checked === false;
  if (managerAssignmentControlReady) assignmentBox.click();
  const fastOption = [...mobile.querySelectorAll<HTMLSelectElement>("select")]
    .flatMap(select => [...select.options])
    .find(option => option.value === "FAST");
  const mobileText = mobile.textContent ?? "";
  const mobileSummaryRows = [
    ...mobile.querySelectorAll<HTMLElement>(".pompaci-summary-grid"),
  ];
  const displayedDeclarationLabel =
    mobileSummaryRows[0]?.querySelector("span")?.textContent?.trim() ??
    "<missing>";
  const displayedDeclarationTotal =
    mobileSummaryRows[0]?.querySelector("b")?.textContent?.trim() ??
    "<missing>";
  const displayedSpecialTotal =
    mobileSummaryRows[1]?.querySelectorAll("b")[5]?.textContent?.trim() ??
    "<missing>";
  const displayedSpecialLabel =
    mobileSummaryRows[1]?.querySelectorAll("span")[5]?.textContent?.trim() ??
    "<missing>";
  const labeledControls = [...mobile.querySelectorAll("label")].flatMap(label =>
    [...label.querySelectorAll("input, select, textarea")].map(control => ({
      control,
      labelText: label.querySelector("span")?.textContent?.trim() ?? "",
    }))
  );
  const mobileChecks = [
    [
      "mobile.current-assigned-shift-visible",
      "Atanmış sabah",
      mobile.querySelector(".pompaci-account-status b")?.textContent?.trim() ??
        "<missing>",
    ],
    [
      "mobile.declaration-label",
      "ÖSSE ödeme/cari beyan toplamı",
      displayedDeclarationLabel,
    ],
    [
      "mobile.automation-source-state",
      "Doğrulanmış kaynak yok",
      mobileSummaryRows[0]?.querySelectorAll("b")[1]?.textContent?.trim() ??
        "<missing>",
    ],
    [
      "mobile.difference-state",
      "Hesaplanmadı",
      mobileSummaryRows[0]?.querySelectorAll("b")[2]?.textContent?.trim() ??
        "<missing>",
    ],
    [
      "mobile.special-operations-label",
      "TTS/özel işlem (ayrı)",
      displayedSpecialLabel,
    ],
    [
      "mobile.pos-migration-gate",
      "POS slip migration şeması etkin değil",
      mobileText.includes("POS slip migration şeması etkin değil"),
    ],
    [
      "mobile.declaration-total",
      money(20_000).trim(),
      displayedDeclarationTotal,
    ],
    ["mobile.special-total", money(4_000).trim(), displayedSpecialTotal],
    ["mobile.fast-disabled", true, fastOption?.disabled === true],
    [
      "mobile.no-file-input",
      0,
      mobile.querySelectorAll('input[type="file"]').length,
    ],
    [
      "mobile.accessible-labeled-control",
      true,
      labeledControls.length > 0 &&
        labeledControls.every(item => item.labelText.length > 0),
    ],
    ["mobile.viewport-is-390-css-pixels", 390, window.innerWidth],
    [
      "mobile.buttons-have-accessible-names",
      true,
      [...mobile.querySelectorAll<HTMLButtonElement>("button")].every(
        button =>
          !!(
            button.getAttribute("aria-label")?.trim() ||
            button.getAttribute("title")?.trim() ||
            button.textContent?.trim()
          )
      ),
    ],
  ] as const;
  const mobilePassed = mobileChecks.every(([name, expected, actual]) =>
    recordAssertion(name, expected, actual, expected === actual)
  );
  const legacyPanel = document.getElementById("legacy-reconciliation")!;
  const legacyDraftRendered =
    legacyPanel.childElementCount > 0 &&
    legacyPanel.textContent?.includes("kaynak yok") === true;
  recordAssertion(
    "review.missing-metadata-source-safe-empty-state",
    true,
    legacyDraftRendered,
    legacyDraftRendered
  );
  document.body.dataset.legacyDraftResult = legacyDraftRendered
    ? "PASS"
    : "FAIL";
  const invalidRowPanel = document.getElementById(
    "invalid-row-reconciliation"
  )!;
  const invalidRowSafe =
    invalidRowPanel.childElementCount > 0 &&
    invalidRowPanel.textContent?.includes("doğrulanmamış işlem sayısı") ===
      true &&
    !invalidRowPanel.textContent?.includes("10 işlem /");
  recordAssertion(
    "review.missing-transaction-count-evidence-review-required",
    true,
    invalidRowSafe,
    invalidRowSafe
  );
  document.body.dataset.invalidRowResult = invalidRowSafe ? "PASS" : "FAIL";
  const legacyDailyPanel = document.getElementById(
    "legacy-daily-reconciliation"
  )!;
  const legacyDailyRows = [
    ...legacyDailyPanel.querySelectorAll<HTMLTableRowElement>("tbody tr"),
  ].filter(row =>
    row.cells[0]?.textContent?.includes("Sentetik günlük hesap!C")
  );
  const legacyDailyCellsNeedReview =
    legacyDailyRows.length === 3 &&
    legacyDailyRows.every(
      row =>
        [...row.cells]
          .slice(2)
          .every(cell => cell.textContent?.includes("İnceleme gerekli")) &&
        row.cells[0]?.textContent?.includes("Hücre adresi yok")
    );
  const legacyFixtureHasMissingCells = legacyDailyAccountDraft.staffRows.every(
    (row: any) => row.sourceCells === null
  );
  const legacyDailySafe =
    legacyDailyPanel.childElementCount > 0 &&
    legacyDailyPanel.textContent?.includes("Kaynak hücre kanıtı") === true &&
    legacyDailyPanel.textContent?.includes("İnceleme gerekli") === true &&
    legacyFixtureHasMissingCells &&
    legacyDailyCellsNeedReview;
  recordAssertion(
    "review.missing-daily-source-cells-review-required",
    {
      fixtureRows: 3,
      sourceCells: null,
      allDisplayedAmounts: "review required",
    },
    {
      fixtureRows: legacyDailyRows.length,
      sourceCells: legacyFixtureHasMissingCells ? null : "unexpected",
      allDisplayedAmounts: legacyDailyCellsNeedReview
        ? "review required"
        : "numeric or evidence missing",
    },
    legacyDailySafe
  );
  document.body.dataset.dailySourceFallbackResult = legacyDailySafe
    ? "PASS"
    : "FAIL";
  document.body.dataset.mobileSalesGateResult = mobilePassed ? "PASS" : "FAIL";
  const accessibilityControls = [...mobile.querySelectorAll("label")].filter(
    label => label.querySelector("input,select,textarea")
  );
  const firstControl = mobile.querySelector<HTMLElement>("select");
  firstControl?.focus();
  const keyboardFocusAvailable = document.activeElement === firstControl;
  document.body.dataset.accessibilityResult =
    accessibilityControls.length > 0 &&
    labeledControls.length === accessibilityControls.length &&
    labeledControls.every(item => item.labelText.length > 0) &&
    keyboardFocusAvailable
      ? "PASS"
      : "FAIL";
  recordAssertion(
    "mobile.keyboard-accessible-labeled-control",
    true,
    accessibilityControls.length > 0 &&
      labeledControls.length === accessibilityControls.length &&
      labeledControls.every(item => item.labelText.length > 0) &&
      keyboardFocusAvailable,
    accessibilityControls.length > 0 &&
      labeledControls.length === accessibilityControls.length &&
      labeledControls.every(item => item.labelText.length > 0) &&
      keyboardFocusAvailable
  );
  mobile.style.width = "min(390px, 100vw)";
  mobile.style.boxSizing = "border-box";
  const mobileLayoutPassed =
    mobile.clientWidth > 0 && mobile.scrollWidth <= mobile.clientWidth;
  document.body.dataset.mobileLayoutResult = mobileLayoutPassed
    ? "PASS"
    : "FAIL";
  recordAssertion(
    "mobile.layout-no-horizontal-overflow",
    true,
    {
      scrollWidth: mobile.scrollWidth,
      clientWidth: mobile.clientWidth,
      viewportWidth: window.innerWidth,
    },
    mobileLayoutPassed
  );
  setTimeout(() => {
    const shiftChecks = [
      [
        "mobile.assigned-shift-visible",
        true,
        shiftOptions.some(text => text.includes("Atanmış sabah")),
      ],
      [
        "mobile.other-staff-shift-hidden",
        false,
        shiftOptions.some(text => text.includes("Başkasının vardiyası")),
      ],
      [
        "mobile.closed-shift-hidden",
        false,
        shiftOptions.some(text => text.includes("Kapalı vardiya")),
      ],
      [
        "mobile.assignment-feature-gate-hides-shift-selection",
        true,
        document
          .getElementById("mobile-shifts-gated")
          ?.textContent?.includes("vardiya atama şeması etkin değil") ===
          true &&
          document
            .getElementById("mobile-shifts-gated")
            ?.querySelector('select[name="shiftId"]') === null,
      ],
      [
        "manager.assignment-action-when-feature-enabled",
        true,
        managerAssignmentControlReady &&
          actions.some(
            action =>
              action.path === "/staff/shift-assignment" &&
              action.payload.userId === 17 &&
              action.payload.shiftId === "shift-assigned" &&
              action.payload.assigned === true
          ),
      ],
    ] as const;
    const passed = shiftChecks.every(([name, expected, actual]) =>
      recordAssertion(name, expected, actual, expected === actual)
    );
    const gatedManager = document.getElementById("manager-gated")!;
    const gatedAssignment = [
      ...gatedManager.querySelectorAll<HTMLInputElement>(
        'input[type="checkbox"]'
      ),
    ].find(input =>
      input.closest("label")?.textContent?.includes("Atanmış sabah")
    );
    const staffingGateClosed =
      gatedAssignment?.disabled === true &&
      gatedManager.textContent?.includes("migrationı henüz uygulanmamış") ===
        true;
    gatedAssignment?.click();
    const noGatedMutation = gatedManagerActions.length === 0;
    recordAssertion(
      "manager.shift-assignment-closed-without-0020",
      [true, true],
      [staffingGateClosed, noGatedMutation],
      staffingGateClosed && noGatedMutation
    );
    document.body.dataset.testResult = passed ? "PASS" : "FAIL";
    document.body.dataset.staffingGateResult =
      staffingGateClosed && noGatedMutation ? "PASS" : "FAIL";
    document.body.dataset.testDetails = JSON.stringify({
      shiftOptions,
      actions,
    });
  }, 50);
}, 150);

setTimeout(() => {
  const panel = document.getElementById("reconciliation")!;
  const form = panel.querySelector("form");
  const reason = form?.querySelector<HTMLInputElement>('input[name="reason"]');
  const evidence = form?.querySelector<HTMLInputElement>(
    'input[name="evidenceRef"]'
  );
  if (reason) reason.value = "Sentetik tutar kontrolü";
  if (evidence) evidence.value = "fixture-evidence-1";
  form?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  setTimeout(() => {
    const passed =
      (panel.textContent ?? "").includes("SENTETİK TASLAK") &&
      panel.querySelectorAll("tbody tr").length >= 8 &&
      panel.querySelectorAll("table").length >= 2 &&
      (window as any).__staffingActions.length === 1;
    recordAssertion(
      "review.correction-draft-rendered",
      true,
      (panel.textContent ?? "").includes("SENTETİK TASLAK"),
      (panel.textContent ?? "").includes("SENTETİK TASLAK")
    );
    recordAssertion(
      "review.minimum-source-rows",
      ">= 8",
      panel.querySelectorAll("tbody tr").length,
      panel.querySelectorAll("tbody tr").length >= 8
    );
    recordAssertion(
      "review.two-source-tables",
      ">= 2",
      panel.querySelectorAll("table").length,
      panel.querySelectorAll("table").length >= 2
    );
    recordAssertion(
      "review.no-financial-action",
      1,
      (window as any).__staffingActions.length,
      (window as any).__staffingActions.length === 1
    );
    document.body.dataset.reconciliationResult = passed ? "PASS" : "FAIL";
  }, 100);
}, 300);

setTimeout(() => {
  const panel = document.getElementById("reconciliation")!;
  const staffSelects = [
    ...panel.querySelectorAll<HTMLSelectElement>(
      'select[aria-label*="C3"], select[aria-label*="C4"], select[aria-label*="C5"]'
    ),
  ];
  const setSelect = (select: HTMLSelectElement, value: string) => {
    const setter = Object.getOwnPropertyDescriptor(
      HTMLSelectElement.prototype,
      "value"
    )?.set;
    setter?.call(select, value);
    select.dispatchEvent(new Event("change", { bubbles: true }));
  };
  if (staffSelects[0]) setSelect(staffSelects[0], "17");
  if (staffSelects[1]) setSelect(staffSelects[1], "18");
  const scope = panel.querySelector<HTMLInputElement>('input[type="checkbox"]');
  if (scope && !scope.checked) scope.click();
  [...panel.querySelectorAll<HTMLButtonElement>("button")]
    .find(button => button.textContent?.toLowerCase().includes("kaynaklar"))
    ?.click();
  const mismatchPanel = document.getElementById("mismatch")!;
  const mismatchScope = mismatchPanel.querySelector<HTMLInputElement>(
    'input[type="checkbox"]'
  );
  if (mismatchScope && !mismatchScope.checked) mismatchScope.click();
  [...mismatchPanel.querySelectorAll<HTMLButtonElement>("button")]
    .find(button => button.textContent?.toLowerCase().includes("kaynaklar"))
    ?.click();
  for (const field of scopeMismatchCases) {
    const scopePanel = document.getElementById(`${field}-mismatch`)!;
    const scopeCheckbox = scopePanel.querySelector<HTMLInputElement>(
      'input[type="checkbox"]'
    );
    if (scopeCheckbox && !scopeCheckbox.checked) scopeCheckbox.click();
    [...scopePanel.querySelectorAll<HTMLButtonElement>("button")]
      .find(button => button.textContent?.toLowerCase().includes("kaynaklar"))
      ?.click();
  }
  const apiErrorPanel = document.getElementById("api-error")!;
  const apiErrorCheckbox = apiErrorPanel.querySelector<HTMLInputElement>(
    'input[type="checkbox"]'
  );
  if (apiErrorCheckbox && !apiErrorCheckbox.checked) apiErrorCheckbox.click();
  [...apiErrorPanel.querySelectorAll<HTMLButtonElement>("button")]
    .find(button => button.textContent?.toLowerCase().includes("kaynaklar"))
    ?.click();

  setTimeout(() => {
    const form = panel.querySelector("form");
    const setInput = (name: string, value: string) => {
      const input = form?.querySelector<HTMLInputElement>(
        `input[name="${name}"]`
      );
      if (!input) return;
      const setter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value"
      )?.set;
      setter?.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
    };
    setInput("newValue", "120,00");
    setInput("reason", "synthetic review correction");
    setInput("evidenceRef", "fixture-evidence-1");
    form?.dispatchEvent(
      new Event("submit", { bubbles: true, cancelable: true })
    );
    setTimeout(() => {
      const text = panel.textContent ?? "";
      const mismatch = document.getElementById("mismatch")?.textContent ?? "";
      const snapshotSection = panel.querySelector<HTMLElement>(
        'section[aria-label="İlk ÖSSE beyanı"]'
      );
      const originalSnapshotRow =
        snapshotSection?.querySelector("ul li")?.textContent ?? "";
      const originalSnapshotVisible =
        snapshotSection?.textContent?.includes("2026-11-10T08:00:00.000Z") ===
          true &&
        originalSnapshotRow.includes("CASH") &&
        originalSnapshotRow.includes("100,00");
      const scopeMismatchPassed = scopeMismatchCases.every(field => {
        const text =
          document.getElementById(`${field}-mismatch`)?.textContent ?? "";
        const noSnapshot = text.includes("İlk snapshot yok / alan eksik");
        const noDifference = text.includes("Hesaplanmadı");
        recordAssertion(
          `review.scope-mismatch.${field}`,
          [true, true],
          [noSnapshot, noDifference],
          noSnapshot && noDifference
        );
        return noSnapshot && noDifference;
      });
      const apiErrorText = apiErrorPanel.textContent ?? "";
      const failedNumericReads = sourceReadOutcomes.filter(
        item =>
          item.source === "numeric" &&
          item.key === "synthetic-api-error-package"
      );
      const apiErrorNoNumericRead =
        failedNumericReads.length === 1 &&
        failedNumericReads[0].status === 503 &&
        !apiErrorText.includes(money(987654321));
      const apiErrorShown =
        apiErrorText.includes("Sentetik kaynak API hatası") &&
        apiErrorText.includes("Sentetik otomasyon API hatası");
      document.body.dataset.scopeMismatchResult = scopeMismatchPassed
        ? "PASS"
        : "FAIL";
      document.body.dataset.apiErrorResult = apiErrorShown ? "PASS" : "FAIL";
      const authorizedMappingOnly =
        staffSelects.length === 3 &&
        staffSelects.every(select =>
          [...select.options].every(option =>
            ["", "17", "18"].includes(option.value)
          )
        );
      const passed =
        text.includes("CASH") &&
        text.includes("CARD_SLIP") &&
        text.includes("Excel") &&
        text.includes("UNVERIFIED") &&
        text.includes("100,00") &&
        text.includes("120,00") &&
        originalSnapshotVisible &&
        text.includes("SOURCE_PENDING") &&
        authorizedMappingOnly &&
        scopeMismatchPassed &&
        apiErrorShown &&
        mismatch.includes("another-shift") &&
        sourceReads.filter(read => read === "snapshot:synthetic-account-17")
          .length === 1 &&
        apiErrorNoNumericRead &&
        nonReadRequests === 0;
      const finalChecks = [
        ["review.original-declaration-visible", true, originalSnapshotVisible],
        [
          "review.payment-types-visible",
          true,
          text.includes("CARD_SLIP") &&
            text.includes("Excel") &&
            text.includes("UNVERIFIED"),
        ],
        ["review.corrected-value-visible", true, text.includes("120,00")],
        [
          "review.automation-source-state",
          true,
          text.includes("SOURCE_PENDING"),
        ],
        ["review.mapping-options-authorized-only", true, authorizedMappingOnly],
        ["review.scope-mismatch-all-fields", true, scopeMismatchPassed],
        ["review.api-errors-visible", true, apiErrorShown],
        [
          "review.shift-mismatch-blocked",
          true,
          mismatch.includes("another-shift"),
        ],
        [
          "review.snapshot-read-once",
          1,
          sourceReads.filter(read => read === "snapshot:synthetic-account-17")
            .length,
        ],
        [
          "review.api-error-no-numeric-read",
          { failedRequests: 1, status: 503, poisonedAmountRendered: false },
          {
            failedRequests: failedNumericReads.length,
            status: failedNumericReads[0]?.status ?? null,
            poisonedAmountRendered: apiErrorText.includes(money(987654321)),
          },
        ],
        ["review.read-only-requests", 0, nonReadRequests],
      ] as const;
      finalChecks.forEach(([name, expected, actual]) =>
        recordAssertion(name, expected, actual, expected === actual)
      );
      document.body.dataset.reconciliationResult = passed ? "PASS" : "FAIL";
      document.body.dataset.financialReviewResult = passed ? "PASS" : "FAIL";
      document.body.dataset.financialReviewDetails = JSON.stringify({
        sourceReads,
        sourceReadOutcomes,
        apiErrorNoNumericRead,
        originalSnapshotVisible,
        originalSnapshotRow,
        scopeMismatchPassed,
        apiErrorShown,
        mappingOptions: staffSelects.map(select =>
          [...select.options].map(option => option.value)
        ),
        nonReadRequests,
      });
    }, 100);
  }, 200);
}, 700);

setTimeout(() => {
  void (async () => {
    const mobile = document.getElementById("mobile")!;
    const wait = (milliseconds: number) =>
      new Promise(resolve => setTimeout(resolve, milliseconds));
    const paymentForm = [
      ...mobile.querySelectorAll<HTMLFormElement>("form"),
    ].find(form => form.querySelector('input[name="amount"]'));
    const paymentKindSelect = [
      ...(paymentForm?.querySelectorAll("select") ?? []),
    ].find(select =>
      [...select.options].some(option => option.value === "IBAN")
    );
    const setSelect = (
      select: HTMLSelectElement | null | undefined,
      value: string
    ) => {
      if (!select) return;
      Object.getOwnPropertyDescriptor(
        HTMLSelectElement.prototype,
        "value"
      )?.set?.call(select, value);
      select.dispatchEvent(new Event("change", { bubbles: true }));
    };
    const submitValue = async (
      kind: string,
      amount: string,
      debtorId?: string
    ) => {
      setSelect(paymentKindSelect, kind);
      await wait(20);
      const input = paymentForm?.querySelector<HTMLInputElement>(
        'input[name="amount"]'
      );
      if (input) {
        input.value = amount;
        input.dispatchEvent(new Event("input", { bubbles: true }));
        input.dispatchEvent(new Event("change", { bubbles: true }));
      }
      if (kind === "DEBT") {
        const debtor = paymentForm?.querySelector<HTMLSelectElement>(
          'select[name="debtorId"]'
        );
        setSelect(debtor, debtorId ?? "");
      }
      paymentForm?.dispatchEvent(
        new Event("submit", { bubbles: true, cancelable: true })
      );
      await wait(100);
    };
    const waitForQueueCount = async (count: number) => {
      for (let attempt = 0; attempt < 30; attempt++) {
        const items = await listMobileOperations(17);
        if (items.length >= count) return items;
        await wait(25);
      }
      return listMobileOperations(17);
    };
    try {
      await submitValue("CASH", "12,50");
      await waitForQueueCount(1);
      await submitValue("IBAN", "25,00");
      await waitForQueueCount(2);
      await submitValue("DEBT", "50,00", "synthetic-debtor-1");
      const queued = await waitForQueueCount(3);
      const payloads = await Promise.all(queued.map(readMobilePayload));
      const scopeAndKindsValid =
        queued.length === 3 &&
        queued.every(
          item =>
            item.userId === 17 &&
            item.tenantId === "tenant-a" &&
            item.stationId === "station-a" &&
            item.shiftId === "shift-assigned" &&
            item.accountId === "synthetic-mobile-account" &&
            item.status === "PENDING_SYNC"
        ) &&
        new Set(queued.map(item => item.clientOperationId)).size === 3 &&
        payloads.some(
          item => item.kind === "CASH" && item.amountMinor === 1250
        ) &&
        payloads.some(
          item => item.kind === "IBAN" && item.amountMinor === 2500
        ) &&
        payloads.some(
          item =>
            item.kind === "DEBT" &&
            item.amountMinor === 5000 &&
            item.debtorId === "synthetic-debtor-1"
        );
      recordAssertion(
        "mobile.offline-cash-iban-debt-payloads",
        true,
        scopeAndKindsValid,
        scopeAndKindsValid
      );
      const pendingRows = mobile.querySelectorAll(".pompaci-queue-item").length;
      recordAssertion(
        "mobile.offline-queue-reread",
        3,
        pendingRows,
        pendingRows === 3
      );
      const submitButton = [
        ...mobile.querySelectorAll<HTMLButtonElement>("button"),
      ].find(button => button.textContent?.includes("Muhasebeye gönder"));
      recordAssertion(
        "mobile.submit-waits-for-pending-sync",
        true,
        submitButton?.disabled === true,
        submitButton?.disabled === true
      );

      const beforeInvalid = queued.length;
      await submitValue("CASH", "0,00");
      await submitValue("CASH", "-1,00");
      await submitValue("CASH", "");
      const afterInvalid = await listMobileOperations(17);
      const invalidRejected = afterInvalid.length === beforeInvalid;
      const validationAlert = mobile.querySelector<HTMLElement>(
        '[role="alert"][aria-live="assertive"]'
      );
      const validationAlertVisible =
        !!validationAlert?.textContent?.trim() &&
        validationAlert?.getAttribute("aria-live") === "assertive";
      recordAssertion(
        "mobile.empty-zero-negative-not-queued",
        beforeInvalid,
        afterInvalid.length,
        invalidRejected
      );
      recordAssertion(
        "mobile.invalid-amount-announced-accessibly",
        true,
        validationAlertVisible,
        validationAlertVisible
      );
      const submitRoot = document.getElementById("mobile-submit")!;
      const submitForm = [
        ...submitRoot.querySelectorAll<HTMLFormElement>("form"),
      ].find(form => form.querySelector('input[name="countedCash"]'));
      const submitInput = submitForm?.querySelector<HTMLInputElement>(
        'input[name="countedCash"]'
      );
      if (submitInput) {
        submitInput.value = "100,00";
        submitInput.dispatchEvent(new Event("input", { bubbles: true }));
      }
      const submitAllowedInitially =
        !!submitForm?.querySelector<HTMLButtonElement>(
          "button:not([disabled])"
        );
      submitForm?.dispatchEvent(
        new Event("submit", { bubbles: true, cancelable: true })
      );
      let submitQueue = await listMobileOperations(20);
      for (let attempt = 0; attempt < 30 && submitQueue.length < 1; attempt++) {
        await wait(25);
        submitQueue = await listMobileOperations(20);
      }
      const submitPayload = submitQueue[0]
        ? await readMobilePayload(submitQueue[0])
        : null;
      const localSubmitStored =
        submitQueue.length === 1 &&
        submitQueue[0].kind === "ACCOUNT_SUBMIT" &&
        submitQueue[0].status === "PENDING_SYNC" &&
        submitQueue[0].userId === 20 &&
        submitQueue[0].accountId === "synthetic-submit-account" &&
        submitPayload?.countedCashMinor === 10_000 &&
        mobileSubmitActions.length === 0;
      recordAssertion(
        "mobile.account-submit-stays-pending-until-server-ack",
        true,
        localSubmitStored,
        localSubmitStored
      );
      const repeatedSubmitButton = [
        ...submitRoot.querySelectorAll<HTMLButtonElement>("button"),
      ].find(button => button.textContent?.includes("Muhasebeye gönder"));
      repeatedSubmitButton?.click();
      await wait(50);
      const afterRepeatedSubmit = await listMobileOperations(20);
      const duplicateBlocked =
        repeatedSubmitButton?.disabled === true &&
        afterRepeatedSubmit.length === 1 &&
        mobileSubmitActions.length === 0;
      recordAssertion(
        "mobile.pending-account-submit-prevents-second-submit",
        true,
        duplicateBlocked,
        duplicateBlocked
      );
      document.body.dataset.mobileSubmitResult =
        submitAllowedInitially && localSubmitStored && duplicateBlocked
          ? "PASS"
          : "FAIL";
      const mobileEntryPassed =
        scopeAndKindsValid &&
        pendingRows === 3 &&
        submitButton?.disabled === true &&
        invalidRejected &&
        validationAlertVisible;
      document.body.dataset.mobileEntryResult = mobileEntryPassed
        ? "PASS"
        : "FAIL";
      publishDiagnostics();
    } catch (error) {
      recordAssertion(
        "mobile.offline-entry-harness-completed",
        "encrypted IndexedDB operations persisted",
        error instanceof Error ? error.name : "unknown error",
        false
      );
      document.body.dataset.mobileEntryResult = "FAIL";
      publishDiagnostics();
    }
  })();
}, 1250);

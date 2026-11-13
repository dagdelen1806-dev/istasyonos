import { describe, expect, it } from "vitest";
import {
  buildFirstDeclarationSnapshot,
  canOpenBusinessUnit,
  canReadFirstDeclarationSnapshot,
  type DeclarationSnapshotInput,
} from "./account-declaration";

const input = (): DeclarationSnapshotInput => ({
  snapshotId: "snapshot-1",
  requestId: "request-1",
  accountId: "account-1",
  cycleNo: 1,
  tenantId: "tenant-1",
  stationId: "station-1",
  shiftId: "shift-1",
  businessDate: "2026-11-09",
  staffUserId: 17,
  submittedAt: "2026-11-09T15:00:00.000Z",
  sourceSalesMinor: 55000,
  countedCashMinor: 12000,
  payments: [
    {
      id: "cash-1",
      kind: "CASH",
      amountMinor: 10000,
      debtorId: null,
      status: "POSTED",
    },
    {
      id: "fast-1",
      kind: "FAST",
      amountMinor: 20000,
      debtorId: null,
      status: "POSTED",
    },
    {
      id: "iban-1",
      kind: "IBAN",
      amountMinor: 5000,
      debtorId: null,
      status: "POSTED",
    },
    {
      id: "debt-1",
      kind: "DEBT",
      amountMinor: 10000,
      debtorId: "debtor-1",
      status: "POSTED",
    },
  ],
  slips: [
    {
      id: "slip-1",
      amountMinor: 8000,
      status: "VERIFIED",
      method: "MANUAL",
      transactionAt: "2026-11-09 14:00:00",
    },
  ],
  specialOperations: [
    {
      id: "special-1",
      kind: "TTS",
      model: "RECEIVABLE",
      status: "RECORDED",
      amountMinor: 2000,
      volumeMl: 3000,
      settlement: "PENDING",
      settlementMethod: "DRAFT",
      paymentId: null,
      slipId: null,
    },
  ],
});

describe("ÖSSE ilk beyan snapshot şekli", () => {
  it.each([
    ["FUEL_STAFF", "FUEL", true],
    ["FUEL_STAFF", "MARKET", false],
    ["MARKET_STAFF", "MARKET", true],
    ["MARKET_STAFF", "FUEL", false],
    ["OWNER", "FUEL", true],
    ["OWNER", "MARKET", true],
    ["ACCOUNTANT", "FUEL", false],
  ] as const)("account opening policy %s/%s -> %s", (role, unit, allowed) => {
    expect(canOpenBusinessUnit(role, unit)).toBe(allowed);
  });

  it("teslim kapsamını ve her kaynak kimliğini korur; FAST/havale ayrıdır", () => {
    const before = input(),
      snapshot = buildFirstDeclarationSnapshot(before);
    expect(snapshot).toMatchObject({
      kind: "FIRST_DECLARATION_SNAPSHOT",
      schemaVersion: 1,
      status: "FIRST_DECLARATION",
      requestId: "request-1",
      accountId: "account-1",
      cycleNo: 1,
      scope: {
        tenantId: "tenant-1",
        stationId: "station-1",
        shiftId: "shift-1",
        businessDate: "2026-11-09",
        staffUserId: 17,
      },
      financialPosted: false,
      bankConfirmed: false,
      personnelDebtCreated: false,
      verificationBasis: "AUTHENTICATED_SUBMISSION_ONLY",
      accountingConfirmed: false,
    });
    expect(
      snapshot.paymentRows.map(row => [row.sourceId, row.category])
    ).toContainEqual(["fast-1", "FAST"]);
    expect(
      snapshot.paymentRows.map(row => [row.sourceId, row.category])
    ).toContainEqual(["iban-1", "IBAN"]);
    expect(
      snapshot.paymentRows.find(row => row.sourceId === "fast-1")
        ?.bankConfirmation
    ).toBe("PENDING");
    expect(snapshot.slipRows[0]).toMatchObject({
      sourceId: "slip-1",
      category: "CARD_SLIP",
      bankConfirmation: "PENDING",
    });
    expect(snapshot.specialOperations[0]).toMatchObject({
      sourceId: "special-1",
      kind: "TTS",
    });
    expect(snapshot.rows.map(row => row.category)).toEqual([
      "CASH",
      "FAST",
      "IBAN",
      "DEBT_SALE",
      "CARD_SLIP",
      "TTS",
    ]);
    expect(before).toEqual(input());
  });

  it("linked special payment/slip is not counted twice in reconciliation rows", () => {
    const data = input();
    data.specialOperations.push({
      id: "special-linked",
      kind: "PARTNER",
      model: "RECEIVABLE",
      status: "RECORDED",
      amountMinor: 8000,
      volumeMl: 0,
      settlement: "SETTLED",
      settlementMethod: "BANK",
      paymentId: null,
      slipId: "slip-1",
    });
    const snapshot = buildFirstDeclarationSnapshot(data);
    expect(snapshot.specialOperations).toHaveLength(2);
    expect(snapshot.rows.filter(row => row.id === "slip-1")).toHaveLength(1);
    expect(snapshot.rows.some(row => row.id === "special-linked")).toBe(false);
  });

  it("yeniden teslim revizyonunu ilk snapshot'tan ayrı ve artan sürümle üretir", () => {
    const revision = buildFirstDeclarationSnapshot({
      ...input(),
      declarationRevision: 2,
      cycleNo: 2,
    });
    expect(revision).toMatchObject({
      kind: "DECLARATION_REVISION_SNAPSHOT",
      status: "DECLARATION_REVISION",
      revision: 2,
      cycleNo: 2,
    });
  });

  it("hassas slip referansı/kart verisi snapshot'a kopyalamaz", () => {
    const data = input() as any;
    data.slips[0].reference = "4111111111111111";
    data.slips[0].cardNumber = "4111111111111111";
    const serialized = JSON.stringify(buildFirstDeclarationSnapshot(data));
    expect(serialized).not.toContain("4111111111111111");
    expect(serialized).not.toContain("reference");
  });

  it("geçersiz kapsamı, tutarı ve aynı türde mükerrer kaynak kimliğini reddeder", () => {
    expect(() =>
      buildFirstDeclarationSnapshot({ ...input(), businessDate: "unknown" })
    ).toThrow("INVALID_SNAPSHOT_SCOPE");
    expect(() =>
      buildFirstDeclarationSnapshot({
        ...input(),
        payments: [{ ...input().payments[0], amountMinor: -1 }],
      })
    ).toThrow("INVALID_PAYMENT_AMOUNT");
    expect(() =>
      buildFirstDeclarationSnapshot({
        ...input(),
        payments: [...input().payments, input().payments[0]],
      })
    ).toThrow("DUPLICATE_SNAPSHOT_SOURCE");
  });

  it("ilk beyan erişimini muhasebe rollerine ve personelin kendi hesabına sınırlar", () => {
    expect(canReadFirstDeclarationSnapshot("ACCOUNTANT", 31, 17)).toBe(true);
    expect(canReadFirstDeclarationSnapshot("FUEL_STAFF", 17, 17)).toBe(true);
    expect(canReadFirstDeclarationSnapshot("FUEL_STAFF", 18, 17)).toBe(false);
    expect(canReadFirstDeclarationSnapshot("MARKET_STAFF", 17, 17)).toBe(true);
    expect(canReadFirstDeclarationSnapshot("MARKET_STAFF", 18, 17)).toBe(false);
  });
});

import { describe, expect, it } from "vitest";
import {
  buildStaffReconciliationReviewContract,
  createCorrectionDraft,
  hasTwoIndependentApprovals,
  isUsableFirstDeclarationSnapshot,
  reconcileStaffShift,
  type MobileDeclaration,
  type ReconciliationScope,
  type ReconciliationSource,
  type SourceRow,
} from "../../shared/staff-reconciliation";

const scope: ReconciliationScope = {
  tenantId: "demo-tenant",
  stationId: "demo-station",
  businessDate: "2026-11-09",
  shiftId: "demo-shift",
  staffUserId: 17,
};

function rows(
  overrides: Partial<Record<SourceRow["category"], number>> = {}
): SourceRow[] {
  const values: Record<SourceRow["category"], number> = {
    CASH: 10000,
    CARD_SLIP: 20000,
    IBAN: 3000,
    FAST: 4000,
    DEBT_SALE: 5000,
    AR_COLLECTION: 1500,
    TTS: 6000,
    SPECIAL: 7000,
    ...overrides,
  };
  return Object.entries(values).map(([category, amountMinor]) => ({
    id: `row-${category}`,
    category: category as SourceRow["category"],
    amountMinor,
    evidenceRef: category === "CARD_SLIP" ? "demo-slip-1" : null,
    bankConfirmation:
      category === "FAST" || category === "IBAN" || category === "CARD_SLIP"
        ? "PENDING"
        : "NOT_APPLICABLE",
  }));
}

function source(
  overrides: Partial<ReconciliationSource> = {},
  sourceKind: ReconciliationSource["sourceKind"] = "AUTOMATION_REPORT"
): ReconciliationSource {
  return { sourceKind, scope, verified: true, rows: rows(), ...overrides };
}

const mobileSource = (overrides: Partial<ReconciliationSource> = {}) =>
  ({
    ...source(overrides, "MOBILE_DECLARATION"),
    declarationId: "declaration-1",
    revision: 1,
    submittedAt: "2026-11-09T17:00:00.000Z",
  }) as MobileDeclaration;
const closeSource = (overrides: Partial<ReconciliationSource> = {}) =>
  source(overrides, "SHIFT_CLOSE_REPORT");

function declaration(): MobileDeclaration {
  return {
    ...mobileSource({ rows: rows() }),
    declarationId: "declaration-1",
    revision: 1,
    submittedAt: "2026-11-09T17:00:00.000Z",
  };
}

describe("salt okunur muhasebe inceleme sözleşmesi", () => {
  it("snapshot sürümü eski veya satır yapısı geçersizse ilk beyanı bilinmiyor sayar", () => {
    const oldSnapshot = { ...declaration(), revision: 0 };
    expect(isUsableFirstDeclarationSnapshot(oldSnapshot)).toBe(false);
    const review = buildStaffReconciliationReviewContract({
      scope,
      firstDeclaration: {
        state: "FIRST_DECLARATION_AVAILABLE",
        snapshot: oldSnapshot,
      },
      automation: source(),
      shiftClose: closeSource(),
    });
    expect(review).toMatchObject({
      state: "FIRST_DECLARATION_UNKNOWN",
      sourceStatuses: { firstDeclaration: "UNKNOWN" },
      firstDeclaration: { state: "FIRST_DECLARATION_UNKNOWN" },
      result: null,
    });
  });

  it("kaynak satırı bozuk eski snapshot'ı incelemeye düşürür; güncel toplamı kullanmaz", () => {
    const malformed = {
      ...declaration(),
      rows: [...rows(), undefined],
    } as unknown as MobileDeclaration;
    expect(isUsableFirstDeclarationSnapshot(malformed)).toBe(false);
    const review = buildStaffReconciliationReviewContract({
      scope,
      firstDeclaration: {
        state: "FIRST_DECLARATION_AVAILABLE",
        snapshot: malformed,
      },
      automation: source(),
      shiftClose: closeSource(),
    });
    expect(review.state).toBe("FIRST_DECLARATION_UNKNOWN");
    expect(review.result).toBeNull();
  });

  it("snapshot yoksa güncel hesap tutarlarından ilk beyan üretmez", () => {
    const review = buildStaffReconciliationReviewContract({
      scope,
      firstDeclaration: { state: "FIRST_DECLARATION_UNKNOWN" },
      automation: source(),
      shiftClose: closeSource(),
    });
    expect(review).toMatchObject({
      state: "FIRST_DECLARATION_UNKNOWN",
      sourceStatuses: {
        firstDeclaration: "UNKNOWN",
        automation: "AVAILABLE",
        shiftClose: "AVAILABLE",
      },
      result: null,
      correctionPersistence: "DRAFT_ONLY",
      financialPosted: false,
      personnelDebtCreated: false,
    });
  });

  it("otomasyon veya gün sonu eksikse karşılaştırmayı bekletir", () => {
    const review = buildStaffReconciliationReviewContract({
      scope,
      firstDeclaration: {
        state: "FIRST_DECLARATION_AVAILABLE",
        snapshot: declaration(),
      },
      automation: source(),
      shiftClose: null,
    });
    expect(review.state).toBe("SOURCE_PENDING");
    expect(review.sourceStatuses).toMatchObject({
      firstDeclaration: "AVAILABLE",
      automation: "AVAILABLE",
      shiftClose: "MISSING",
    });
    expect(review.result).toBeNull();
  });

  it("üç kaynak geldiğinde yalnız taslak karşılaştırma döndürür ve kapsam uyuşmazlığını korur", () => {
    const review = buildStaffReconciliationReviewContract({
      scope,
      firstDeclaration: {
        state: "FIRST_DECLARATION_AVAILABLE",
        snapshot: declaration(),
      },
      automation: source({
        scope: { ...scope, tenantId: "other-tenant" },
      }) as ReconciliationSource & { sourceKind: "AUTOMATION_REPORT" },
      shiftClose: closeSource(),
    });
    expect(review.state).toBe("SOURCE_PENDING");
    expect(review.result?.status).toBe("SCOPE_MISMATCH");
    expect(review.financialPosted).toBe(false);
    expect(review.personnelDebtCreated).toBe(false);
  });

  it.each([
    ["tenantId", "other-tenant"],
    ["stationId", "other-station"],
    ["businessDate", "2026-11-08"],
    ["shiftId", "other-shift"],
    ["staffUserId", 18],
  ] as const)(
    "gün sonu %s kapsamı ayrışınca kesin fark üretmez",
    (field, value) => {
      const review = buildStaffReconciliationReviewContract({
        scope,
        firstDeclaration: {
          state: "FIRST_DECLARATION_AVAILABLE",
          snapshot: declaration(),
        },
        automation: source(),
        shiftClose: closeSource({ scope: { ...scope, [field]: value } }),
      });
      expect(review.state).toBe("SOURCE_PENDING");
      expect(review.result?.status).toBe("SCOPE_MISMATCH");
      expect(
        review.result?.cells.every(
          cell => cell.mobileMinusAutomationMinor === null
        )
      ).toBe(true);
      expect(review.financialPosted).toBe(false);
      expect(review.personnelDebtCreated).toBe(false);
    }
  );
});

const correction = (overrides: Record<string, unknown> = {}) => ({
  entryId: "row-CASH",
  field: "amountMinor" as const,
  newValue: 12000,
  correctedBy: 31,
  createdAt: "2026-11-09T18:00:00.000Z",
  reason: "Kaynak slip ile tekrar kontrol edildi",
  evidenceRef: "private-demo-evidence-1",
  ...overrides,
});

describe("ÖSSE vardiya mutabakat taslağı", () => {
  it("eski ilk snapshot doğrudan mutabakat motorunda fark üretmez", () => {
    const oldMobile = {
      ...mobileSource(),
      revision: 0,
    };
    const result = reconcileStaffShift({
      mobile: oldMobile,
      automation: source(),
      shiftClose: closeSource(),
    });
    expect(result.status).toBe("SOURCE_UNVERIFIED");
    expect(result.complete).toBe(false);
    expect(
      result.cells.every(cell => cell.mobileMinusAutomationMinor === null)
    ).toBe(true);
    expect(result.warnings.join(" ")).toContain(
      "Invalid, stale, or incomplete first declaration snapshot."
    );
  });

  it("aynı kapsamlı üç kaynağı kategori bazında karşılaştırır; mali kayıt üretmez", () => {
    const result = reconcileStaffShift({
      mobile: mobileSource(),
      automation: source({ rows: rows({ CASH: 9500 }) }),
      shiftClose: closeSource({ rows: rows({ CASH: 9700 }) }),
    });
    const cash = result.cells.find(cell => cell.category === "CASH")!;
    expect(result.status).toBe("COMPARABLE_DRAFT");
    expect(cash.mobileMinusAutomationMinor).toBe(500);
    expect(cash.automationMinusCloseMinor).toBe(-200);
    expect(result.financialPosted).toBe(false);
    expect(result.personnelDebtCreated).toBe(false);
  });

  it("tenant, istasyon, tarih, vardiya veya personel farklıysa fark hesaplamaz", () => {
    const result = reconcileStaffShift({
      mobile: mobileSource(),
      automation: source({ scope: { ...scope, staffUserId: 18 } }),
      shiftClose: closeSource(),
    });
    expect(result.status).toBe("SCOPE_MISMATCH");
    expect(
      result.cells.every(cell => cell.mobileMinusAutomationMinor === null)
    ).toBe(true);
  });

  it.each(["2026-02-29", "2026-11-31", "2026/11/09", " "])(
    "takvimde geçersiz veya boş iş tarihi %s ise mutabakatı durdurur",
    businessDate => {
      const result = reconcileStaffShift({
        mobile: mobileSource({ scope: { ...scope, businessDate } }),
        automation: source(),
        shiftClose: closeSource(),
      });
      expect(result.status).toBe("SCOPE_MISMATCH");
      expect(result.complete).toBe(false);
      expect(
        result.cells.every(
          cell =>
            cell.mobileMinusAutomationMinor === null &&
            cell.automationMinusCloseMinor === null
        )
      ).toBe(true);
    }
  );

  it("kaynak içindeki boş veya yinelenen satır kimliğinde toplamı ve farkı kesinleştirmez", () => {
    const mobileRows = rows();
    const duplicateCash = { ...mobileRows[0], id: "" };
    mobileRows.push(duplicateCash);
    const result = reconcileStaffShift({
      mobile: mobileSource({ rows: mobileRows }),
      automation: source(),
      shiftClose: closeSource(),
    });
    const cash = result.cells.find(cell => cell.category === "CASH")!;
    const fast = result.cells.find(cell => cell.category === "FAST")!;
    expect(result.status).toBe("SOURCE_UNVERIFIED");
    expect(result.complete).toBe(false);
    expect(cash.mobileMinor).toBeNull();
    expect(fast.bankPendingMinor).toBeNull();
    expect(cash.mobileMinusAutomationMinor).toBeNull();
    expect(result.warnings.join(" ")).toMatch(
      /boş veya mükerrer satır kimliği/
    );
  });

  it("doğrulanmamış otomasyon veya gün sonu raporunda farkı kesinleştirmez", () => {
    const result = reconcileStaffShift({
      mobile: mobileSource(),
      automation: source({ verified: false }),
      shiftClose: closeSource(),
    });
    expect(result.status).toBe("SOURCE_UNVERIFIED");
    expect(
      result.cells.every(cell => cell.automationMinusCloseMinor === null)
    ).toBe(true);
  });

  it("FAST ve IBAN'ı ayrı tutar ve teyitsiz tutarları banka tahsilatı saymaz", () => {
    const result = reconcileStaffShift({
      mobile: mobileSource(),
      automation: source(),
      shiftClose: closeSource(),
    });
    const fast = result.cells.find(cell => cell.category === "FAST")!;
    const iban = result.cells.find(cell => cell.category === "IBAN")!;
    expect(fast.mobileMinor).toBe(4000);
    expect(iban.mobileMinor).toBe(3000);
    expect(fast.bankPendingMinor).toBe(4000);
    expect(iban.bankPendingMinor).toBe(3000);
    expect(result.warnings.join(" ")).toMatch(/banka teyidi doğrulamaz/);
  });

  it("eksik slip kanıtını gösterir; tutarı sıfıra veya teyide dönüştürmez", () => {
    const mobileRows = rows().map(row =>
      row.category === "CARD_SLIP" ? { ...row, evidenceRef: null } : row
    );
    const result = reconcileStaffShift({
      mobile: mobileSource({ rows: mobileRows }),
      automation: source(),
      shiftClose: closeSource(),
    });
    const card = result.cells.find(cell => cell.category === "CARD_SLIP")!;
    expect(card.missingSlipCount).toBe(1);
    expect(card.mobileMinor).toBe(20000);
    expect(result.warnings.join(" ")).toMatch(/kanıt belgesi eksik/);
  });
});

describe("ÖSSE beyanından ayrı muhasebe düzeltme taslağı", () => {
  it("ilk beyanı korur, önceki ve yeni değeri sürümlü taslakta saklar", () => {
    const original = declaration();
    const snapshot = JSON.stringify(original);
    const first = createCorrectionDraft({
      declaration: original,
      correction: correction(),
      accountantRole: "ACCOUNTANT",
    });
    expect(JSON.stringify(original)).toBe(snapshot);
    expect(
      first.original.rows.find(row => row.id === "row-CASH")?.amountMinor
    ).toBe(10000);
    expect(
      first.correctedRows.find(row => row.id === "row-CASH")?.amountMinor
    ).toBe(12000);
    expect(first.corrections[0]).toMatchObject({
      previousValue: 10000,
      newValue: 12000,
      correctedBy: 31,
      revision: 1,
    });
    expect(first.status).toBe("DRAFT_REVIEW_REQUIRED");
    expect(first.financialPosted).toBe(false);
    expect(first.personnelDebtCreated).toBe(false);
  });

  it("FAST/havale sınıflandırma düzeltmesini ayrı revizyon olarak tutar", () => {
    const original = declaration();
    const draft = createCorrectionDraft({
      declaration: original,
      correction: correction({
        entryId: "row-FAST",
        field: "category",
        newValue: "IBAN",
      }),
      accountantRole: "ACCOUNTANT",
    });
    expect(
      draft.original.rows.find(row => row.id === "row-FAST")?.category
    ).toBe("FAST");
    expect(
      draft.correctedRows.find(row => row.id === "row-FAST")?.category
    ).toBe("IBAN");
    expect(draft.corrections[0]).toMatchObject({
      previousValue: "FAST",
      newValue: "IBAN",
    });
  });

  it("yeni düzeltme, önceki düzeltme geçmişini ve ilk beyanı korur", () => {
    const original = declaration();
    const first = createCorrectionDraft({
      declaration: original,
      correction: correction(),
      accountantRole: "ACCOUNTANT",
    });
    const second = createCorrectionDraft({
      declaration: original,
      prior: first,
      correction: correction({
        newValue: 12500,
        reason: "İkinci kanıt kontrolü",
      }),
      accountantRole: "ACCOUNTANT",
    });
    expect(
      second.original.rows.find(row => row.id === "row-CASH")?.amountMinor
    ).toBe(10000);
    expect(
      second.correctedRows.find(row => row.id === "row-CASH")?.amountMinor
    ).toBe(12500);
    expect(
      second.corrections.map(item => [
        item.revision,
        item.previousValue,
        item.newValue,
      ])
    ).toEqual([
      [1, 10000, 12000],
      [2, 12000, 12500],
    ]);
  });

  it("düzeltme uygulanmış görünümle farkları yeniden hesaplar; kaynak beyan değişmez", () => {
    const original = declaration();
    const before = reconcileStaffShift({
      mobile: original,
      automation: source({ rows: rows({ CASH: 11000 }) }),
      shiftClose: closeSource(),
    });
    const draft = createCorrectionDraft({
      declaration: original,
      correction: correction(),
      accountantRole: "ACCOUNTANT",
    });
    const after = reconcileStaffShift({
      mobile: { ...original, rows: draft.correctedRows },
      automation: source({ rows: rows({ CASH: 11000 }) }),
      shiftClose: closeSource(),
    });
    expect(
      before.cells.find(cell => cell.category === "CASH")
        ?.mobileMinusAutomationMinor
    ).toBe(-1000);
    expect(
      after.cells.find(cell => cell.category === "CASH")
        ?.mobileMinusAutomationMinor
    ).toBe(1000);
    expect(
      original.rows.find(row => row.category === "CASH")?.amountMinor
    ).toBe(10000);
  });

  it("yetkisiz personelin, gerekçesiz veya hatalı tutarlı düzeltmesini reddeder", () => {
    const original = declaration();
    expect(() =>
      createCorrectionDraft({
        declaration: original,
        correction: correction(),
        accountantRole: "FUEL_STAFF",
      })
    ).toThrow(/muhasebe/);
    expect(() =>
      createCorrectionDraft({
        declaration: original,
        correction: correction({ reason: " " }),
        accountantRole: "ACCOUNTANT",
      })
    ).toThrow(/Gerekçe/);
    expect(() =>
      createCorrectionDraft({
        declaration: original,
        correction: correction({ newValue: -1 }),
        accountantRole: "ACCOUNTANT",
      })
    ).toThrow(/tamsayı/);
  });

  it("iki ayrı yetkili onaylayıcı olmadan bağımsız onayı hazır saymaz", () => {
    expect(
      hasTwoIndependentApprovals([{ userId: 31, authorized: true }], 31)
    ).toBe(false);
    expect(
      hasTwoIndependentApprovals(
        [
          { userId: 31, authorized: true },
          { userId: 31, authorized: true },
        ],
        31
      )
    ).toBe(false);
    expect(
      hasTwoIndependentApprovals(
        [
          { userId: 31, authorized: true },
          { userId: 32, authorized: true },
        ],
        31
      )
    ).toBe(true);
    expect(
      hasTwoIndependentApprovals(
        [
          { userId: 31, authorized: true },
          { userId: 32, authorized: false },
        ],
        31
      )
    ).toBe(false);
  });
});

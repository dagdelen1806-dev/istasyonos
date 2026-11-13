import { describe, expect, it } from "vitest";
import { paymentKinds, paymentLabels } from "../../shared/station";
import { tenderKinds, tenderLabels } from "../../shared/daily-numeric";
import {
  accountTotals,
  hasUnconfirmedBankDeclaration,
} from "./domain";

describe("FAST payment declaration", () => {
  it("keeps FAST separate from IBAN and outside counted cash", () => {
    const totals = accountTotals({
      cashSalesMinor: 1000,
      cardTotalMinor: 2000,
      ibanMinor: 3000,
      fastMinor: 4000,
      debtMinor: 5000,
      arCollectionMinor: 600,
      sourceSalesMinor: null,
    });

    expect(totals.ibanMinor).toBe(3000);
    expect(totals.fastMinor).toBe(4000);
    expect(totals.sourceTotalMinor).toBe(15000);
    expect(totals.expectedCashMinor).toBe(1600);
    expect(hasUnconfirmedBankDeclaration(totals)).toBe(true);
    expect(
      hasUnconfirmedBankDeclaration({ ibanMinor: 0, fastMinor: 0 })
    ).toBe(false);
  });

  it("exposes separate API/report categories and preserves existing kinds", () => {
    expect(paymentKinds).toEqual([
      "CASH",
      "IBAN",
      "FAST",
      "DEBT",
      "AR_COLLECTION",
    ]);
    expect(tenderKinds).toContain("FAST");
    expect(paymentLabels.FAST).toMatch(/FAST/);
    expect(tenderLabels.FAST).toMatch(/FAST/);
    expect(paymentKinds).toContain("IBAN");
    expect(paymentKinds).toContain("CASH");
    expect(paymentKinds).toContain("DEBT");
    expect(paymentKinds).toContain("AR_COLLECTION");
  });
});

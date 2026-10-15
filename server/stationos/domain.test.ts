import { describe, expect, it } from "vitest";
import { accountTotals, invitationHash, payloadHash, recommendationStatus } from "./domain";

describe("StationOS domain kuralları", () => {
  it("nakit beklenen tutara para üstünü ve eski cari tahsilatı eklemez", () => {
    const totals = accountTotals({
      cashSalesMinor: 12000,
      cardTotalMinor: 3000,
      ibanMinor: 2000,
      debtMinor: 1000,
      arCollectionMinor: 500,
      sourceSalesMinor: null,
    });
    expect(totals.expectedCashMinor).toBe(12500);
    expect(totals.sourceTotalMinor).toBe(18000);
  });

  it("alacak tahsilatı için negatif veya borçtan fazla işlem kararı route tarafından uygulanır", () => {
    expect(accountTotals({ cashSalesMinor: 0, cardTotalMinor: 0, ibanMinor: 0, debtMinor: 0, arCollectionMinor: 100, sourceSalesMinor: null }).arCollectionMinor).toBe(100);
  });

  it("öneri durumu deterministik ve LLM'sizdir", () => {
    expect(recommendationStatus(1000, 10, 1200, 0)).toBe("CREDIT_BLOCKED");
    expect(recommendationStatus(2000, 10, 1200, 0)).toBe("STOCKOUT");
    expect(recommendationStatus(2000, 0, 0, 3)).toBe("READY");
  });

  it("idempotency hash anahtar sırasından etkilenmez", () => {
    expect(payloadHash({ b: 2, a: 1 })).toBe(payloadHash({ a: 1, b: 2 }));
  });

  it("davet kodu ham koddan geri döndürülemez hash ile eşleşir", () => {
    expect(invitationHash("one-time-code")).toBe(invitationHash("one-time-code"));
    expect(invitationHash("one-time-code")).not.toBe(invitationHash("other-code"));
  });
});

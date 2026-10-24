import { describe, it, expect } from "vitest";
import {
  analysisAmounts,
  categoryIdentity,
  istanbulHour,
  hourAnalysis,
  totalAnalysis,
} from "./sales-analysis-domain";
const sale = {
  saleCount: 1,
  saleLines: 2,
  salesGrossMinor: 1200,
  salesNetMinor: 1000,
  salesVatMinor: 200,
  salesCostMinor: 700,
};
describe("recorded category and local-hour analysis", () => {
  it("distinguishes unknown historical category from captured empty and named categories", () => {
    expect(categoryIdentity(null)).toMatchObject({
      source: "LEGACY_UNKNOWN",
      category: null,
    });
    expect(categoryIdentity("")).toMatchObject({
      source: "UNCATEGORIZED",
      category: "",
    });
    expect(categoryIdentity("GIDA")).toMatchObject({
      source: "SNAPSHOT",
      label: "GIDA",
    });
    expect(() => categoryIdentity({})).toThrow();
  });
  it("preserves literal category names even when they resemble a fallback label", () => {
    expect(categoryIdentity("Geçmiş kategori kaydı yok").source).toBe(
      "SNAPSHOT"
    );
  });
  it("converts midnight using Istanbul and keeps 23:00 distinct", () => {
    expect(istanbulHour("2026-10-23 21:00:00")).toBe(0);
    expect(istanbulHour("2026-10-23 20:00:00")).toBe(23);
    expect(istanbulHour("2026-10-24 00:00:00")).toBe(3);
  });
  it("uses IANA historical offset instead of assuming every year was UTC+3", () => {
    expect(istanbulHour("2015-01-01 00:00:00")).toBe(2);
  });
  it("rejects malformed calendar hours instead of silently rolling dates", () => {
    for (const d of [
      "2026-02-30 00:00:00",
      "2026-10-24 24:00:00",
      "2026-10-24 00:30:00",
      "bad",
    ])
      expect(() => istanbulHour(d)).toThrow();
  });
  it("fills all 24 local hours and combines different days' same local hour", () => {
    const h = hourAnalysis([
      { ...sale, utcHour: "2026-10-23 21:00:00" },
      { ...sale, utcHour: "2026-10-24 21:00:00" },
    ]);
    expect(h).toHaveLength(24);
    expect(h[0]).toMatchObject({
      saleCount: 2,
      saleLines: 4,
      salesGrossMinor: 2400,
      averageSaleMinor: 1200,
    });
    expect(h[1].averageSaleMinor).toBeNull();
    expect(totalAnalysis(h).salesGrossMinor).toBe(2400);
  });
  it("separates returns from original sale hour and computes net result", () => {
    const h = hourAnalysis([
      { ...sale, utcHour: "2026-10-23 21:00:00" },
      {
        returnCount: 1,
        returnLines: 1,
        returnsGrossMinor: 600,
        returnsNetMinor: 500,
        returnsVatMinor: 100,
        returnsCostMinor: 350,
        utcHour: "2026-10-24 20:00:00",
      },
    ]);
    expect(h[0].saleCount).toBe(1);
    expect(h[23]).toMatchObject({
      returnCount: 1,
      grossProfitMinor: -150,
      averageSaleMinor: null,
    });
    expect(totalAnalysis(h)).toMatchObject({
      netSalesMinor: 500,
      cogsMinor: 350,
      grossProfitMinor: 150,
    });
  });
  it("counts one multi-line receipt once rather than using line count as denominator", () => {
    expect(analysisAmounts(sale)).toMatchObject({
      saleCount: 1,
      saleLines: 2,
      averageSaleMinor: 1200,
    });
  });
  it("rejects broken money and overflow while retaining exact large-money average", () => {
    expect(() => analysisAmounts({ ...sale, salesVatMinor: 199 })).toThrow();
    expect(() => analysisAmounts({ ...sale, salesCostMinor: -1 })).toThrow();
    const max = Number.MAX_SAFE_INTEGER;
    expect(
      analysisAmounts({
        saleCount: 2,
        salesGrossMinor: max,
        salesNetMinor: max,
      }).averageSaleMinor
    ).toBe(4503599627370496);
    expect(() =>
      hourAnalysis([
        {
          utcHour: "2026-10-23 21:00:00",
          saleCount: 1,
          salesGrossMinor: max,
          salesNetMinor: max,
        },
        {
          utcHour: "2026-10-24 21:00:00",
          saleCount: 1,
          salesGrossMinor: 1,
          salesNetMinor: 1,
        },
      ])
    ).toThrow();
  });
});

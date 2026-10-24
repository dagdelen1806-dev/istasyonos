import { describe, it, expect } from "vitest";
import {
  reportRange,
  reportSequence,
  salesMetrics,
  validateReportSale,
} from "./sales-report-domain";
import type { ReportSaleDetail } from "../../shared/market-reports";
const b = {
  SALES: -3000,
  SALES_RETURNS: 1000,
  OUTPUT_VAT: -400,
  COGS: 1400,
  EXPENSE: 100,
  BANK_FEES: 20,
  STOCK_GAIN: -30,
};
const s = { n: 2, gross: 3600, cash: 1200, card: 1200, credit: 1200 };
const r = { n: 1, gross: 1200, cash: 200, bank: 0, credit: 1000 };
describe("market sales report accounting", () => {
  it("counts split payments once and keeps refunds separate from sale shares", () => {
    expect(salesMetrics(b, s, r)).toMatchObject({
      saleCount: 2,
      salesGrossMinor: 3600,
      returnsGrossMinor: 1200,
      netGrossMinor: 2400,
      netSalesMinor: 2000,
      cogsMinor: 1400,
      grossProfitMinor: 600,
      expensesMinor: 120,
      gainsMinor: 30,
      resultMinor: 510,
      averageSaleMinor: 1800,
      payments: { cashMinor: 1200, cardMinor: 1200, creditMinor: 1200 },
      returns: { count: 1, cashMinor: 200, bankMinor: 0, creditMinor: 1000 },
    });
  });
  it("supports empty periods and periods containing only prior-sale returns", () => {
    expect(salesMetrics({}, {}, {}).averageSaleMinor).toBeNull();
    expect(
      salesMetrics(
        { SALES_RETURNS: 1000, OUTPUT_VAT: 200, COGS: -700 },
        {},
        { gross: 1200, n: 1, credit: 1200 }
      )
    ).toMatchObject({
      netGrossMinor: -1200,
      grossProfitMinor: -300,
      saleCount: 0,
      averageSaleMinor: null,
    });
  });
  it("rejects source/ledger mismatches and safe integer overflow", () => {
    expect(() => salesMetrics(b, { ...s, card: 1201 }, r)).toThrow(/uyuşmuyor/);
    expect(() => salesMetrics({ ...b, SALES: -3001 }, s, r)).toThrow(
      /uyuşmuyor/
    );
    expect(() =>
      salesMetrics(
        { SALES: -Number.MAX_SAFE_INTEGER, SALES_RETURNS: -1 },
        {},
        {}
      )
    ).toThrow();
  });
  it("retains exact rounded average for large safe integer money", () => {
    const max = Number.MAX_SAFE_INTEGER;
    expect(
      salesMetrics({ SALES: -max }, { n: 2, gross: max, cash: max }, {})
        .averageSaleMinor
    ).toBe(4503599627370496);
  });
  it("uses an equal-length comparison period including leap days", () => {
    expect(reportRange("2024-02-28", "2024-03-01")).toMatchObject({
      days: 3,
      previousFrom: "2024-02-25",
      previousTo: "2024-02-27",
    });
    expect(() => reportRange("2026-02-29", "2026-03-01")).toThrow();
    expect(() => reportRange("2025-01-01", "2026-01-02")).toThrow();
    expect(() => reportRange("2026-02-02", "2026-02-01")).toThrow();
  });
  it("never rounds a BIGINT sequence to a JS number", () => {
    expect(reportSequence("18446744073709551615")).toBe("18446744073709551615");
    for (const v of ["18446744073709551616", "-1", "1e4", "01", {}, 5])
      expect(() => reportSequence(v)).toThrow();
  });
  const detail = () =>
    ({
      id: "sale",
      entryId: "entry",
      sequence: "1",
      date: "2026-10-24",
      createdAt: "",
      registerName: "",
      actorName: "",
      paymentKind: "MIXED",
      totalMinor: 1200,
      cashMinor: 200,
      cardMinor: 1000,
      creditMinor: 0,
      deviceId: null,
      sessionId: "session",
      netMinor: 1000,
      vatMinor: 200,
      costMinor: 700,
      lines: [
        {
          productId: "p",
          name: "Original DEMO",
          barcode: "00123",
          quantity: 1,
          unitPriceMinor: 1200,
          grossMinor: 1200,
          netMinor: 1000,
          vatMinor: 200,
          costMinor: 700,
        },
      ],
      returns: [],
    }) satisfies ReportSaleDetail;
  it("validates recorded detail costs and gross/net/VAT against source journal", () => {
    expect(validateReportSale(detail()).lines[0].name).toBe("Original DEMO");
    const d = detail();
    d.lines[0].costMinor = 701;
    expect(() => validateReportSale(d)).toThrow(/uyuşmuyor/);
  });
  it("rejects incomplete detail or payment inflation", () => {
    expect(() => validateReportSale({ ...detail(), lines: [] })).toThrow();
    expect(() =>
      validateReportSale({ ...detail(), cardMinor: 1001 })
    ).toThrow();
  });
});

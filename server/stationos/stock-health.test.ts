import { describe, it, expect } from "vitest";
import { inactivity, validateStock, marginItem } from "./stock-health-domain";
const base = {
  id: "p",
  name: "DEMO",
  barcode: "001234",
  unit: "adet",
  soldQty: 2,
  returnedQty: 0,
  salesNetMinor: 1000,
  salesCostMinor: 800,
  returnsNetMinor: 0,
  returnsCostMinor: 0,
  lossLines: 0,
  lowLines: 0,
  sampleLossSaleId: null,
};
describe("current stock observation", () => {
  it("recognizes a recent recorded sale even on a newly opened card", () => {
    expect(
      inactivity("2026-10-24", "2026-10-20", "2026-10-22", "2026-10-24", 2, 30)
        .status
    ).toBe("ACTIVE");
  });
  it("uses calendar-day 30/60/90 boundaries without treating recent receipts as sales", () => {
    expect(
      inactivity("2026-10-24", "2026-01-01", "2026-01-02", "2026-09-24", 2, 30)
    ).toMatchObject({ noSaleDays: 30, status: "INACTIVE" });
    expect(
      inactivity("2026-10-24", "2026-01-01", "2026-01-02", "2026-09-25", 2, 30)
        .status
    ).toBe("ACTIVE");
  });
  it("starts at the later book/product date and refuses to infer unobserved age", () => {
    expect(
      inactivity("2026-10-24", "2026-10-20", "2026-01-01", null, 2, 30)
    ).toMatchObject({
      observedFrom: "2026-10-20",
      observedDays: 4,
      noSaleDays: 4,
      status: "UNOBSERVED",
    });
    expect(
      inactivity("2026-10-24", "2026-01-01", "2026-10-22", null, 2, 30).status
    ).toBe("UNOBSERVED");
  });
  it("distinguishes no observed sale, sufficient history and empty stock", () => {
    expect(
      inactivity("2026-10-24", "2026-01-01", "2026-01-01", null, 2, 90).status
    ).toBe("INACTIVE");
    expect(
      inactivity("2026-10-24", "2026-01-01", "2026-01-01", null, 0, 90).status
    ).toBe("NO_STOCK");
  });
  it("does not claim an inactivity period longer than known coverage", () => {
    expect(
      inactivity("2026-10-24", "2026-10-01", "2026-10-01", "2026-01-01", 1, 30)
        .noSaleDays
    ).toBe(23);
    expect(() =>
      inactivity("2026-10-24", "2026-10-25", "2026-01-01", null, 1, 30)
    ).toThrow();
  });
  it("requires current product/inventory/lot agreement including zero stocks", () => {
    expect(() => validateStock(4, 2000, 4, 3, 4)).not.toThrow();
    for (const args of [
      [4, 2000, 3, 3, 4],
      [4, 2000, 4, 5, 4],
      [4, 2000, 4, 3, 3],
      [0, 1, 0, 0, null],
      [-1, 0, 0, 0, null],
    ])
      expect(() =>
        validateStock(
          ...(args as [number, number, number, number, number | null])
        )
      ).toThrow();
  });
});
describe("sale-time margin evidence", () => {
  it("uses exact net sale denominator and accepts the exact threshold", () => {
    expect(marginItem({ ...base, salesCostMinor: 900 }, 1000)).toMatchObject({
      salesProfitMinor: 100,
      salesMarginBps: 1000,
      status: "OK",
    });
    expect(marginItem({ ...base, salesCostMinor: 901 }, 1000).status).toBe(
      "LOW"
    );
  });
  it("keeps individual losing sales visible even when the product's aggregate is profitable", () => {
    expect(
      marginItem({ ...base, lossLines: 1, sampleLossSaleId: "sale" }, 1000)
    ).toMatchObject({
      salesProfitMinor: 200,
      status: "LOSS",
      sampleLossSaleId: "sale",
    });
  });
  it("keeps individual low-margin rows visible even when later sales lift the average", () => {
    expect(marginItem({ ...base, lowLines: 1 }, 1000).status).toBe("LOW");
  });
  it("separates refund-period profit effect from an actual new losing sale", () => {
    expect(
      marginItem(
        {
          ...base,
          soldQty: 0,
          returnedQty: 1,
          salesNetMinor: 0,
          salesCostMinor: 0,
          returnsNetMinor: 1000,
          returnsCostMinor: 800,
        },
        1000
      )
    ).toMatchObject({
      netSalesMinor: -1000,
      cogsMinor: -800,
      grossProfitMinor: -200,
      status: "RETURN_ONLY",
      salesMarginBps: null,
    });
  });
  it("does not erase a source-sale warning when it is fully returned", () => {
    expect(
      marginItem(
        {
          ...base,
          salesCostMinor: 1100,
          returnedQty: 2,
          returnsNetMinor: 1000,
          returnsCostMinor: 1100,
          lossLines: 1,
        },
        1000
      )
    ).toMatchObject({ netSalesMinor: 0, grossProfitMinor: 0, status: "LOSS" });
  });
  it("handles zero-revenue, free stock and zero threshold without division by zero", () => {
    expect(
      marginItem({ ...base, salesNetMinor: 0, salesCostMinor: 0 }, 0).status
    ).toBe("NO_REVENUE");
    expect(
      marginItem(
        { ...base, salesNetMinor: 0, salesCostMinor: 10, lossLines: 1 },
        0
      ).status
    ).toBe("LOSS");
    expect(marginItem({ ...base, salesCostMinor: 1000 }, 0).status).toBe("OK");
  });
  it("uses safe monetary totals and exact classification for extreme values", () => {
    expect(
      marginItem(
        {
          ...base,
          salesNetMinor: 1,
          salesCostMinor: Number.MAX_SAFE_INTEGER,
          lossLines: 1,
        },
        1000
      )
    ).toMatchObject({ status: "LOSS", salesMarginBps: null });
    expect(() =>
      marginItem(
        {
          ...base,
          salesNetMinor: Number.MAX_SAFE_INTEGER,
          returnsNetMinor: -1,
        },
        1000
      )
    ).toThrow();
  });
});

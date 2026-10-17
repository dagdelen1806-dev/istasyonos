import { describe, it, expect } from "vitest";
import {
  packQuantity,
  stockSuggestion,
  estimateOrder,
  monthRange,
} from "./inventory-domain";
import { normalizePosLines } from "./pos-domain";
import { randomUUID } from "node:crypto";
describe("inventory operations", () => {
  it("converts packs to base units and caps total units", () => {
    expect(packQuantity(3, 12)).toBe(36);
    expect(() => packQuantity(1000, 12)).toThrow();
    expect(() => packQuantity(1.5, 12)).toThrow();
    expect(() => packQuantity(0, 12)).toThrow();
    expect(packQuantity(1000, 12, 1000000000)).toBe(12000);
  });
  it("uses sales horizon, minimum and maximum with whole order packs", () => {
    expect(stockSuggestion(5, 4, 0, 28, 3, 7, 2, 6)).toMatchObject({
      quantity: 12,
      daily: 1,
      coverDays: 5,
      critical: true,
      stagnant: false,
    });
    expect(stockSuggestion(5, 4, 30, 28, 3, 7, 2, 6).quantity).toBe(30);
    expect(stockSuggestion(0, 10, 0, 0, 0, 1, 0, 12)).toMatchObject({
      quantity: 12,
      coverDays: null,
      critical: true,
    });
    expect(stockSuggestion(20, 10, 0, 0, 3, 7, 2, 1)).toMatchObject({
      quantity: 0,
      stagnant: true,
      critical: false,
    });
  });
  it("does not infer purchase VAT from sale VAT and rounds once per line", () => {
    expect(estimateOrder(3, 101, 2000)).toEqual({ net: 303, gross: 364 });
    expect(estimateOrder(3, 101, null)).toEqual({ net: 303, gross: null });
    expect(() => estimateOrder(Number.MAX_SAFE_INTEGER, 2, 2000)).toThrow();
  });
  it("handles leap years, year boundaries and invalid calendar months", () => {
    expect(monthRange("2024-02")).toMatchObject({
      totalDays: 29,
      to: "2024-02-29",
      previousMonth: "2024-01",
    });
    expect(monthRange("2026-01").previousMonth).toBe("2025-12");
    expect(monthRange("2000-01").previousMonth).toBe("1999-12");
    for (const m of ["2026-13", "2026-2", "1999-12", "9999-01"])
      expect(() => monthRange(m)).toThrow();
  });
  it("preserves named prices and rejects a product with mixed price sources", () => {
    const productId = randomUUID(),
      priceListId = randomUUID(),
      line = {
        productId,
        priceListId,
        quantity: 1,
        expectedUnitPriceMinor: 99,
      };
    expect(normalizePosLines([line, line])).toEqual([{ ...line, quantity: 2 }]);
    expect(() =>
      normalizePosLines([line, { ...line, priceListId: randomUUID() }])
    ).toThrow();
    expect(() =>
      normalizePosLines([
        line,
        { productId, quantity: 1, expectedUnitPriceMinor: 99 },
      ])
    ).toThrow();
  });
});

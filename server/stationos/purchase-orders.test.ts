import { describe, it, expect } from "vitest";
import { orderTotals } from "../../shared/purchase-order";
import { netTax } from "./market-accounting-domain";
describe("purchase order plan rounding", () => {
  it("uses exact net and VAT totals for multiple products", () => {
    expect(
      orderTotals([
        { quantity: 4, unitNetMinor: 125, vatBps: 1000 },
        { quantity: 2, unitNetMinor: 200, vatBps: 2000 },
      ])
    ).toEqual({ netMinor: 900, vatMinor: 130, grossMinor: 1030 });
  });
  it("uses the same per-document line rounding as actual market purchases", () => {
    for (const qty of [1, 3, 7, 10000])
      for (const price of [1, 99, 12345])
        for (const vat of [0, 100, 1000, 2000]) {
          const r = orderTotals([
            { quantity: qty, unitNetMinor: price, vatBps: vat },
          ]);
          expect(r.vatMinor).toBe(netTax(qty * price, vat));
        }
  });
  it("does not pretend split invoices must equal the initial gross plan", () => {
    const unit = { unitNetMinor: 1, vatBps: 2000 };
    expect(orderTotals([{ ...unit, quantity: 3 }]).grossMinor).toBe(4);
    expect(3 * orderTotals([{ ...unit, quantity: 1 }]).grossMinor).toBe(3);
  });
  it("handles a fulfilled plan and zero-cost lines alongside priced goods", () => {
    expect(orderTotals([]).grossMinor).toBe(0);
    expect(
      orderTotals([{ quantity: 0, unitNetMinor: 1000, vatBps: 2000 }])
        .grossMinor
    ).toBe(0);
    expect(
      orderTotals([
        { quantity: 5, unitNetMinor: 0, vatBps: 1000 },
        { quantity: 1, unitNetMinor: 100, vatBps: 1000 },
      ]).grossMinor
    ).toBe(110);
  });
  it("rejects unsafe products and summed values instead of rounding with floats", () => {
    expect(() =>
      orderTotals([
        { quantity: 2, unitNetMinor: Number.MAX_SAFE_INTEGER, vatBps: 0 },
      ])
    ).toThrow();
    expect(() =>
      orderTotals([
        { quantity: 1, unitNetMinor: Number.MAX_SAFE_INTEGER, vatBps: 0 },
        { quantity: 1, unitNetMinor: 1, vatBps: 0 },
      ])
    ).toThrow();
  });
  it("rejects negative/fractional quantities, invalid cost and VAT", () => {
    for (const line of [
      { quantity: -1, unitNetMinor: 1, vatBps: 0 },
      { quantity: 1.2, unitNetMinor: 1, vatBps: 0 },
      { quantity: 1, unitNetMinor: -1, vatBps: 0 },
      { quantity: 1, unitNetMinor: 1, vatBps: 10001 },
    ])
      expect(() => orderTotals([line])).toThrow();
  });
});

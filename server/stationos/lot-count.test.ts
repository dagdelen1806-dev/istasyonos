import { describe, it, expect } from "vitest";
import { lotCountPlan } from "../../shared/lot-count";
describe("lot count valuation", () => {
  it("preserves uncounted lots and supports explicit zero", () => {
    expect(
      lotCountPlan(
        10,
        1000,
        [
          { before: 4, after: 0 },
          { before: 6, after: null },
        ],
        undefined
      )
    ).toEqual({
      gainQty: 0,
      lossQty: 4,
      quantity: 6,
      gainMinor: 0,
      lossMinor: 400,
      valueMinor: 600,
    });
  });
  it("records both gain and loss for a zero net quantity change", () => {
    expect(
      lotCountPlan(
        10,
        1000,
        [
          { before: 4, after: 2 },
          { before: 4, after: 6 },
          { before: 2, after: null },
        ],
        150
      )
    ).toEqual({
      gainQty: 2,
      lossQty: 2,
      quantity: 10,
      gainMinor: 300,
      lossMinor: 200,
      valueMinor: 1100,
    });
  });
  it("rounds aggregate product losses once and removes full remaining value", () => {
    expect(
      lotCountPlan(
        3,
        1,
        [
          { before: 1, after: 0 },
          { before: 1, after: 0 },
          { before: 1, after: null },
        ],
        undefined
      ).lossMinor
    ).toBe(1);
    expect(
      lotCountPlan(
        3,
        100,
        [
          { before: 1, after: 0 },
          { before: 2, after: 0 },
        ],
        undefined
      ).valueMinor
    ).toBe(0);
  });
  it("requires net gain cost and rejects unsafe values", () => {
    for (const cost of [undefined, -1, 0.1, Number.MAX_SAFE_INTEGER])
      expect(() =>
        lotCountPlan(1, 100, [{ before: 1, after: 3 }], cost)
      ).toThrow();
    expect(lotCountPlan(0, 0, [{ before: 0, after: 2 }], 0).gainQty).toBe(2);
  });
  it("rejects snapshot mismatch and invalid quantities", () => {
    for (const counts of [
      [{ before: 1, after: 0 }],
      [{ before: 2, after: -1 }],
      [{ before: 2, after: 1.5 }],
      [{ before: 2, after: 1000000001 }],
    ])
      expect(() => lotCountPlan(2, 200, counts, 100)).toThrow();
    expect(() => lotCountPlan(0, 100, [], undefined)).toThrow();
  });
  it("retains a no-op and handles a new gain from an existing zero lot", () => {
    expect(
      lotCountPlan(2, 200, [{ before: 2, after: 2 }], undefined).valueMinor
    ).toBe(200);
    expect(lotCountPlan(0, 0, [{ before: 0, after: 3 }], 75).valueMinor).toBe(
      225
    );
  });
});

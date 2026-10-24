import { describe, it, expect } from "vitest";
import {
  cancellationLines,
  eventPosition,
  encodeEventPosition,
} from "./cancellation-report-domain";
import { reportFilters, saleFilter } from "./report-filters";
const id = "11111111-1111-4111-8111-111111111111";
const line = {
  productId: id,
  productName: "DEMO eski ad",
  barcode: "001234",
  quantity: 4,
  expectedUnitPriceMinor: 125,
};
describe("cancellation evidence", () => {
  it("calculates removed quantities and original prices without current cards", () => {
    expect(
      cancellationLines([line], [{ ...line, quantity: 2 }], "REDUCE")
    ).toMatchObject({
      removedMinor: 250,
      lines: [
        {
          name: "DEMO eski ad",
          beforeQty: 4,
          afterQty: 2,
          removedQty: 2,
          removedMinor: 250,
        },
      ],
    });
  });
  it("counts final cancel separately from earlier reductions and supports empty cancellation", () => {
    expect(
      cancellationLines([{ ...line, quantity: 2 }], [], "CANCEL").removedMinor
    ).toBe(250);
    expect(cancellationLines([], [], "CANCEL")).toEqual({
      lines: [],
      removedMinor: 0,
    });
  });
  it("retains free lines and detects removed entire rows", () => {
    expect(
      cancellationLines([{ ...line, expectedUnitPriceMinor: 0 }], [], "REDUCE")
        .lines[0].removedQty
    ).toBe(4);
  });
  it("rejects invented products, silent repricing and increased quantities", () => {
    for (const after of [
      [{ ...line, quantity: 5 }],
      [{ ...line, expectedUnitPriceMinor: 126 }],
      [{ ...line, productId: "other" }],
      [{ ...line, productName: "new" }],
    ])
      expect(() => cancellationLines([line], after, "REDUCE")).toThrow();
  });
  it("rejects corrupt, duplicate or overflowing snapshots", () => {
    for (const before of [
      "{broken}",
      [line, line],
      [{ ...line, quantity: -1 }],
      [{ ...line, expectedUnitPriceMinor: Number.MAX_SAFE_INTEGER }],
    ])
      expect(() => cancellationLines(before, [], "CANCEL")).toThrow();
  });
  it("checks action-specific before and after evidence", () => {
    expect(() => cancellationLines([line], [line], "REDUCE")).toThrow();
    expect(() => cancellationLines([line], [line], "CANCEL")).toThrow();
    expect(() => cancellationLines([line], [], "HOLD")).toThrow();
  });
  it("preserves millisecond/id page cursor and rejects invalid timestamps", () => {
    const pos = { time: "2026-10-24 20:59:59.001", id };
    expect(eventPosition(encodeEventPosition(pos))).toEqual(pos);
    for (const v of [
      "bad",
      {},
      encodeEventPosition({ ...pos, time: "2026-02-30 00:00:00.000" }),
      encodeEventPosition({ ...pos, id: "bad" }),
    ])
      expect(() => eventPosition(v)).toThrow();
  });
});
describe("scoped sales filters", () => {
  it("accepts optional exact register/user identifiers", () => {
    expect(reportFilters({})).toEqual({ registerId: "", userId: "" });
    expect(reportFilters({ registerId: id, userId: "2147483647" })).toEqual({
      registerId: id,
      userId: "2147483647",
    });
  });
  it("rejects arrays, decimals and out-of-range users", () => {
    for (const userId of [[], "0", "-1", "1.5", "01", "2147483648", {}, 1])
      expect(() => reportFilters({ userId })).toThrow();
  });
  it("binds values separately for both source-sale conditions", () => {
    const f = reportFilters({ registerId: id, userId: "2" });
    expect(saleFilter("s", f)).toEqual({
      sql: " AND s.register_id=? AND s.user_id=?",
      params: [id, "2"],
    });
  });
});

import { describe, it, expect } from "vitest";
import {
  dueAge,
  dueAmounts,
  dueMatches,
  dueRemaining,
  dueBuckets,
} from "./party-dues-domain";
import { plusDays } from "./market-accounting-domain";
import type { DueDocument } from "../../shared/party-dues";
const today = "2026-10-28";
describe("current party dues", () => {
  it("partitions every day at exact overdue/future boundaries", () => {
    const cases = [
      [-91, "OVER_90"],
      [-90, "LATE_61_90"],
      [-61, "LATE_61_90"],
      [-60, "LATE_31_60"],
      [-31, "LATE_31_60"],
      [-30, "LATE_8_30"],
      [-8, "LATE_8_30"],
      [-7, "LATE_1_7"],
      [-1, "LATE_1_7"],
      [0, "TODAY"],
      [1, "FUTURE_1_7"],
      [7, "FUTURE_1_7"],
      [8, "FUTURE_8_30"],
      [30, "FUTURE_8_30"],
      [31, "FUTURE_31_90"],
      [90, "FUTURE_31_90"],
      [91, "FUTURE_OVER_90"],
    ] as const;
    for (const [n, bucket] of cases)
      expect(dueAge(today, plusDays(today, n))).toEqual({
        daysUntil: n,
        bucket,
      });
    expect(dueAge(today, null)).toEqual({ daysUntil: null, bucket: "UNKNOWN" });
    expect(new Set(dueBuckets).size).toBe(dueBuckets.length);
  });
  it("counts calendar days across leap dates and rejects invalid source dates", () => {
    expect(dueAge("2024-02-28", "2024-03-01").daysUntil).toBe(2);
    expect(() => dueAge(today, "2026-02-29")).toThrow();
    expect(() => dueAge(today, "")).toThrow();
  });
  it("deducts payments and return credits exactly, including fully settled records", () => {
    expect(dueRemaining("10001", "3000", "2001")).toBe(5000);
    expect(dueRemaining(10001, 8000, 2001)).toBe(0);
  });
  it("rejects overpayments, negative, missing and unsafe amounts", () => {
    for (const args of [
      [100, 101, 0],
      [100, 0, 101],
      [0, 0, 0],
      [100, -1, 0],
      [100, 0, -1],
      [100, null, 0],
      [100, 0, undefined],
      [Number.MAX_SAFE_INTEGER + 1, 0, 0],
    ])
      expect(() =>
        dueRemaining(...(args as [unknown, unknown, unknown]))
      ).toThrow();
  });
  it("keeps today separate from both overdue and the next seven days", () => {
    expect(dueMatches({ daysUntil: 0 }, "TODAY")).toBe(true);
    expect(dueMatches({ daysUntil: 0 }, "OVERDUE")).toBe(false);
    expect(dueMatches({ daysUntil: 0 }, "NEXT7")).toBe(false);
    expect(dueMatches({ daysUntil: 7 }, "NEXT7")).toBe(true);
    expect(dueMatches({ daysUntil: 8 }, "NEXT7")).toBe(false);
    expect(dueMatches({ daysUntil: 30 }, "NEXT30")).toBe(true);
    expect(dueMatches({ daysUntil: 31 }, "NEXT30")).toBe(false);
    expect(dueMatches({ daysUntil: 90 }, "NEXT90")).toBe(true);
    expect(dueMatches({ daysUntil: 91 }, "NEXT90")).toBe(false);
    expect(dueMatches({ daysUntil: null }, "ALL")).toBe(true);
    expect(dueMatches({ daysUntil: null }, "UNKNOWN")).toBe(true);
    expect(dueMatches({ daysUntil: null }, "NEXT90")).toBe(false);
  });
  it("keeps the same party's receivable and payable separate with safe sums", () => {
    const docs = [
      { direction: "AR", remainingMinor: 5001 },
      { direction: "AP", remainingMinor: 7000 },
      { direction: "AR", remainingMinor: 2000 },
    ] as DueDocument[];
    expect(dueAmounts(docs)).toEqual({
      receivableMinor: 7001,
      payableMinor: 7000,
      documents: 3,
    });
    expect(() =>
      dueAmounts([
        { direction: "AR", remainingMinor: Number.MAX_SAFE_INTEGER },
        { direction: "AR", remainingMinor: 1 },
      ] as DueDocument[])
    ).toThrow();
  });
});

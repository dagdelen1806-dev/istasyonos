import { describe, it, expect } from "vitest";
import { allocateFefo, lotInput } from "./lot-domain";
describe("lot expiry and allocation", () => {
  const today = "2026-10-17";
  it("allocates earliest usable expiry, including today, with stable ties", () => {
    const lots = [
      {
        id: "late",
        quantity: 10,
        expiryDate: "2026-12-01",
        status: "AVAILABLE",
      },
      { id: "today-a", quantity: 2, expiryDate: today, status: "AVAILABLE" },
      { id: "today-b", quantity: 3, expiryDate: today, status: "AVAILABLE" },
    ];
    expect(allocateFefo(lots, 4, today)).toEqual([
      { lotId: "today-a", quantity: 2 },
      { lotId: "today-b", quantity: 2 },
    ]);
  });
  it("never fills a sale from expired, unknown or quarantined stock", () => {
    const lots = [
      {
        id: "old",
        quantity: 100,
        expiryDate: "2026-10-16",
        status: "AVAILABLE",
      },
      { id: "unknown", quantity: 100, expiryDate: null, status: "AVAILABLE" },
      {
        id: "quarantine",
        quantity: 100,
        expiryDate: "2027-01-01",
        status: "QUARANTINE",
      },
    ];
    expect(() => allocateFefo(lots, 1, today)).toThrow();
    expect(() => allocateFefo([], 0, today)).toThrow();
  });
  it("requires explicit full receipt quantities and valid current expiry", () => {
    expect(
      lotInput(
        [
          { code: "A", quantity: 2, expiryDate: today },
          { code: "B", quantity: 3, expiryDate: "2026-11-01" },
        ],
        5,
        today
      ).map(l => l.quantity)
    ).toEqual([2, 3]);
    for (const input of [
      [{ code: "A", quantity: 1, expiryDate: "2026-10-16" }],
      [{ code: "A", quantity: 1, expiryDate: "2026-02-30" }],
      [{ code: "A", quantity: 1, expiryDate: null }],
    ])
      expect(() => lotInput(input, 1, today)).toThrow();
    expect(() =>
      lotInput([{ code: "A", quantity: 2, expiryDate: today }], 3, today)
    ).toThrow();
  });
  it("quarantines unknown or expired opening stock without inventing dates", () => {
    const result = lotInput(
      [
        { code: "UNKNOWN", quantity: 2, expiryDate: null },
        { code: "OLD", quantity: 3, expiryDate: "2020-01-01" },
      ],
      5,
      today,
      true
    );
    expect(result.map(l => l.status)).toEqual(["QUARANTINE", "QUARANTINE"]);
    expect(result[0].expiryDate).toBeNull();
    expect(lotInput([], 0, today, true)).toEqual([]);
  });
});

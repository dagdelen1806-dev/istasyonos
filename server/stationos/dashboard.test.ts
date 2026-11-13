import { describe, it, expect } from "vitest";
import { dashboardDates, dashboardInteger } from "./dashboard";
describe("historical dashboard ranges and exact totals", () => {
  it("uses an inclusive sixty-day default ending on selected day", () =>
    expect(dashboardDates(undefined, "2026-11-07")).toEqual({
      from: "2026-09-09",
      to: "2026-11-07",
    }));
  it("rejects reversed intervals", () =>
    expect(() => dashboardDates("2026-11-08", "2026-11-07")).toThrow());
  it("rejects invalid dates and excessive intervals", () => {
    expect(() => dashboardDates("2026-02-29", "2026-11-07")).toThrow();
    expect(() => dashboardDates("2024-01-01", "2026-11-07")).toThrow();
  });
  it("preserves integer kuruş strings", () =>
    expect(dashboardInteger("9007199254740991")).toBe(Number.MAX_SAFE_INTEGER));
  it.each(["9007199254740992", 1.5, Number.NaN])(
    "rejects inaccurate database totals %s",
    v => expect(() => dashboardInteger(v)).toThrow()
  );
});

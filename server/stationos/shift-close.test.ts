import { describe, expect, it } from "vitest";
import { assertShiftClosable } from "./shift-close";
describe("shift close keeps independent approval rules", () => {
  it("rejects empty shifts", () =>
    expect(() => assertShiftClosable([])).toThrow());
  it.each(["OPEN", "SUBMITTED", "IN_REVIEW"])(
    "rejects %s even with signatures",
    status =>
      expect(() => assertShiftClosable([{ status, approvals: 2 }])).toThrow()
  );
  it("rejects a single distinct approver", () =>
    expect(() =>
      assertShiftClosable([{ status: "ACCEPTED", approvals: 1 }])
    ).toThrow());
  it("closes accepted accounts while retaining pending finance", () =>
    expect(() =>
      assertShiftClosable([
        { status: "ACCEPTED", approvals: 2 },
        { status: "ACCEPTED_WITH_PENDING", approvals: 2 },
      ])
    ).not.toThrow());
});

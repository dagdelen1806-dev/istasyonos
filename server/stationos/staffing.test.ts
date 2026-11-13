import { describe, expect, it } from "vitest";
import {
  canAssignStaffToShift,
  isPosSlipDraftSchemaReady,
  isShiftAssignedToStaff,
  normalizeStationAccessStatus,
} from "./staffing";

const eligible = {
  managerRole: "MANAGER",
  managerHasStation: true,
  targetRole: "FUEL_STAFF",
  targetStationAccess: "ACTIVE" as const,
  shiftStatus: "OPEN",
  overlapsOtherShift: false,
  hasAccountHistory: false,
};

describe("station staffing and assigned shift rules", () => {
  it("opens POS slip OCR only when the complete 0019 schema and unique guards exist", () => {
    expect(
      isPosSlipDraftSchemaReady({
        tableExists: true,
        requiredColumnCount: 21,
        requiredUniqueIndexCount: 3,
      })
    ).toBe(true);
    expect(
      isPosSlipDraftSchemaReady({
        tableExists: true,
        requiredColumnCount: 20,
        requiredUniqueIndexCount: 3,
      })
    ).toBe(false);
    expect(
      isPosSlipDraftSchemaReady({
        tableExists: true,
        requiredColumnCount: 21,
        requiredUniqueIndexCount: 2,
      })
    ).toBe(false);
    expect(
      isPosSlipDraftSchemaReady({
        tableExists: false,
        requiredColumnCount: 21,
        requiredUniqueIndexCount: 3,
      })
    ).toBe(false);
  });

  it("allows an authorized manager to assign active fuel and market staff", () => {
    expect(canAssignStaffToShift(eligible)).toEqual({ ok: true });
    expect(
      canAssignStaffToShift({ ...eligible, targetRole: "MARKET_STAFF" })
    ).toEqual({ ok: true });
  });

  it("fails closed for legacy membership rows pending explicit access review", () => {
    expect(normalizeStationAccessStatus("ACTIVE", true)).toBe("ACTIVE");
    expect(normalizeStationAccessStatus("INACTIVE", true)).toBe("INACTIVE");
    expect(normalizeStationAccessStatus("REVIEW_REQUIRED", true)).toBe(
      "REVIEW_REQUIRED"
    );
    expect(normalizeStationAccessStatus(null, true)).toBe("REVIEW_REQUIRED");
    expect(normalizeStationAccessStatus("unknown", true)).toBe(
      "REVIEW_REQUIRED"
    );
    expect(normalizeStationAccessStatus(null, false)).toBe("ACTIVE");
    expect(
      canAssignStaffToShift({
        ...eligible,
        targetStationAccess: "REVIEW_REQUIRED",
      })
    ).toMatchObject({ ok: false, reason: "STAFF_NOT_ACTIVE_AT_STATION" });
  });

  it("rejects non-manager, out-of-station, inactive and non-staff assignments", () => {
    expect(
      canAssignStaffToShift({ ...eligible, managerRole: "ACCOUNTANT" })
    ).toMatchObject({ ok: false, reason: "STAFFING_SCOPE_FORBIDDEN" });
    expect(
      canAssignStaffToShift({ ...eligible, managerHasStation: false })
    ).toMatchObject({ ok: false, reason: "STAFFING_SCOPE_FORBIDDEN" });
    expect(
      canAssignStaffToShift({ ...eligible, targetStationAccess: "INACTIVE" })
    ).toMatchObject({ ok: false, reason: "STAFF_NOT_ACTIVE_AT_STATION" });
    expect(
      canAssignStaffToShift({ ...eligible, targetRole: "PURCHASER" })
    ).toMatchObject({ ok: false, reason: "STAFF_NOT_ACTIVE_AT_STATION" });
  });

  it("rejects closed shifts, overlapping assignments and accounts with history", () => {
    expect(
      canAssignStaffToShift({ ...eligible, shiftStatus: "CLOSED" })
    ).toMatchObject({ ok: false, reason: "SHIFT_NOT_OPEN" });
    expect(
      canAssignStaffToShift({ ...eligible, overlapsOtherShift: true })
    ).toMatchObject({ ok: false, reason: "SHIFT_ASSIGNMENT_OVERLAP" });
    expect(
      canAssignStaffToShift({ ...eligible, hasAccountHistory: true })
    ).toMatchObject({ ok: false, reason: "ACCOUNT_REQUIRES_REVIEW" });
  });

  it("permits only a current user's active assignment on an open shift", () => {
    const ids = [10, 11];
    expect(isShiftAssignedToStaff("ASSIGNED", "ACTIVE", "OPEN", 10, ids)).toBe(
      true
    );
    expect(isShiftAssignedToStaff("ASSIGNED", "ACTIVE", "OPEN", 11, ids)).toBe(
      true
    );
    expect(isShiftAssignedToStaff("REMOVED", "ACTIVE", "OPEN", 10, ids)).toBe(
      false
    );
    expect(
      isShiftAssignedToStaff("ASSIGNED", "INACTIVE", "OPEN", 10, ids)
    ).toBe(false);
    expect(
      isShiftAssignedToStaff("ASSIGNED", "ACTIVE", "CLOSED", 10, ids)
    ).toBe(false);
    expect(isShiftAssignedToStaff("ASSIGNED", "ACTIVE", "OPEN", 12, ids)).toBe(
      false
    );
  });
});

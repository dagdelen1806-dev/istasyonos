export type StationAccessStatus = "ACTIVE" | "INACTIVE" | "REVIEW_REQUIRED";
export type ShiftAssignmentStatus = "ASSIGNED" | "REMOVED";

export function normalizeStationAccessStatus(
  value: unknown,
  statusColumnAvailable: boolean
): StationAccessStatus {
  // Before the status column existed, a membership row represented access.
  if (!statusColumnAvailable) return "ACTIVE";
  if (value === "ACTIVE" || value === "INACTIVE") return value;
  return "REVIEW_REQUIRED";
}

export function isPosSlipDraftSchemaReady(input: {
  tableExists: boolean;
  requiredColumnCount: number;
  requiredUniqueIndexCount: number;
}): boolean {
  return (
    input.tableExists &&
    input.requiredColumnCount === 21 &&
    input.requiredUniqueIndexCount === 3
  );
}

export type ShiftAssignmentCheck = {
  managerRole: string;
  managerHasStation: boolean;
  targetRole: string;
  targetStationAccess: StationAccessStatus | null;
  shiftStatus: string;
  overlapsOtherShift: boolean;
  hasAccountHistory: boolean;
};

export function canAssignStaffToShift(
  input: ShiftAssignmentCheck
): { ok: true } | { ok: false; reason: string } {
  if (
    !(input.managerRole === "OWNER" || input.managerRole === "MANAGER") ||
    !input.managerHasStation
  )
    return { ok: false, reason: "STAFFING_SCOPE_FORBIDDEN" };
  if (
    !["FUEL_STAFF", "MARKET_STAFF"].includes(input.targetRole) ||
    input.targetStationAccess !== "ACTIVE"
  )
    return { ok: false, reason: "STAFF_NOT_ACTIVE_AT_STATION" };
  if (input.shiftStatus !== "OPEN")
    return { ok: false, reason: "SHIFT_NOT_OPEN" };
  if (input.overlapsOtherShift)
    return { ok: false, reason: "SHIFT_ASSIGNMENT_OVERLAP" };
  if (input.hasAccountHistory)
    return { ok: false, reason: "ACCOUNT_REQUIRES_REVIEW" };
  return { ok: true };
}

export function isShiftAssignedToStaff(
  assignmentStatus: string | undefined,
  membershipStatus: string | undefined,
  shiftStatus: string,
  staffUserId: number,
  assignedUserIds: readonly number[] | undefined
): boolean {
  return (
    shiftStatus === "OPEN" &&
    membershipStatus === "ACTIVE" &&
    assignmentStatus === "ASSIGNED" &&
    Number.isSafeInteger(staffUserId) &&
    staffUserId > 0 &&
    !!assignedUserIds?.includes(staffUserId)
  );
}

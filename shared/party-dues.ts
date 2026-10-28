export type DueDirection = "AR" | "AP";
export type DueBucket =
  | "UNKNOWN"
  | "OVER_90"
  | "LATE_61_90"
  | "LATE_31_60"
  | "LATE_8_30"
  | "LATE_1_7"
  | "TODAY"
  | "FUTURE_1_7"
  | "FUTURE_8_30"
  | "FUTURE_31_90"
  | "FUTURE_OVER_90";
export type DueView =
  | "ALL"
  | "OVERDUE"
  | "TODAY"
  | "NEXT7"
  | "NEXT30"
  | "NEXT90"
  | "UNKNOWN";
export type DueDocument = {
  id: string;
  partyId: string;
  partyName: string;
  kind: string;
  reference: string;
  direction: DueDirection;
  dueDate: string | null;
  daysUntil: number | null;
  bucket: DueBucket;
  totalMinor: number;
  settledMinor: number;
  creditedMinor: number;
  remainingMinor: number;
};
export type DueAmounts = {
  receivableMinor: number;
  payableMinor: number;
  documents: number;
};
export type PartyDues = {
  today: string;
  generatedAt: string;
  snapshot: string;
  partyId: string;
  direction: "ALL" | DueDirection;
  view: DueView;
  parties: { id: string; name: string }[];
  totals: DueAmounts;
  overdue: DueAmounts;
  todayDue: DueAmounts;
  unknown: DueAmounts;
  aging: { bucket: DueBucket; amounts: DueAmounts }[];
  calendar: { date: string; amounts: DueAmounts }[];
  matched: number;
  rows: DueDocument[];
  nextCursor: string | null;
};

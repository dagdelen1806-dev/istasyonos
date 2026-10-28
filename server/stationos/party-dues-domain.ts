import { calendarDate, integer } from "./market-accounting-domain";
import { safeAdd } from "./safety";
import { fail } from "./types";
import type {
  DueBucket,
  DueDocument,
  DueView,
  DueAmounts,
} from "../../shared/party-dues";
export const dueBuckets: DueBucket[] = [
  "OVER_90",
  "LATE_61_90",
  "LATE_31_60",
  "LATE_8_30",
  "LATE_1_7",
  "TODAY",
  "FUTURE_1_7",
  "FUTURE_8_30",
  "FUTURE_31_90",
  "FUTURE_OVER_90",
  "UNKNOWN",
];
export function dueAge(
  today: string,
  due: string | null
): { daysUntil: number | null; bucket: DueBucket } {
  calendarDate(today);
  if (due === null) return { daysUntil: null, bucket: "UNKNOWN" };
  calendarDate(due);
  const daysUntil = Math.round(
    (Date.parse(due + "T12:00:00Z") - Date.parse(today + "T12:00:00Z")) /
      86400000
  );
  const bucket: DueBucket =
    daysUntil < -90
      ? "OVER_90"
      : daysUntil < -60
        ? "LATE_61_90"
        : daysUntil < -30
          ? "LATE_31_60"
          : daysUntil < -7
            ? "LATE_8_30"
            : daysUntil < 0
              ? "LATE_1_7"
              : daysUntil === 0
                ? "TODAY"
                : daysUntil <= 7
                  ? "FUTURE_1_7"
                  : daysUntil <= 30
                    ? "FUTURE_8_30"
                    : daysUntil <= 90
                      ? "FUTURE_31_90"
                      : "FUTURE_OVER_90";
  return { daysUntil, bucket };
}
export function dueRemaining(
  total: unknown,
  settled: unknown,
  credited: unknown
) {
  // A missing monetary column is corruption, never an implied zero.
  if ([total, settled, credited].some(n => n === null || n === undefined))
    fail("REPORT_INCONSISTENT", "Cari belge tutarı eksik.", 409);
  const t = integer(total),
    s = integer(settled),
    c = integer(credited);
  const remaining = safeAdd(t, -s, -c);
  if (t <= 0 || s < 0 || c < 0 || remaining < 0)
    fail(
      "REPORT_INCONSISTENT",
      "Cari belge ödeme/iade toplamı uyuşmuyor.",
      409
    );
  return remaining;
}
export function dueMatches(d: Pick<DueDocument, "daysUntil">, view: DueView) {
  const n = d.daysUntil;
  if (view === "ALL") return true;
  if (view === "UNKNOWN") return n === null;
  if (n === null) return false;
  if (view === "OVERDUE") return n < 0;
  if (view === "TODAY") return n === 0;
  return n >= 1 && n <= Number(view.slice(4));
}
export function dueAmounts(docs: DueDocument[]): DueAmounts {
  let receivableMinor = 0,
    payableMinor = 0;
  for (const d of docs) {
    if (d.direction === "AR")
      receivableMinor = safeAdd(receivableMinor, d.remainingMinor);
    else payableMinor = safeAdd(payableMinor, d.remainingMinor);
  }
  return { receivableMinor, payableMinor, documents: docs.length };
}

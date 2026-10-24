import { integer } from "./market-accounting-domain";
import { safeAdd } from "./safety";
import { fail } from "./types";
import type {
  AnalysisAmounts,
  CategoryAnalysis,
  HourAnalysis,
} from "../../shared/sales-analysis";
export const amountKeys = [
  "saleCount",
  "returnCount",
  "saleLines",
  "returnLines",
  "salesGrossMinor",
  "salesNetMinor",
  "salesVatMinor",
  "salesCostMinor",
  "returnsGrossMinor",
  "returnsNetMinor",
  "returnsVatMinor",
  "returnsCostMinor",
] as const;
export type AmountInput = Partial<Record<(typeof amountKeys)[number], unknown>>;
export function analysisAmounts(r: Record<string, unknown>): AnalysisAmounts {
  const a = Object.fromEntries(
    amountKeys.map(k => [k, integer(r[k])])
  ) as Record<(typeof amountKeys)[number], number>;
  if (
    amountKeys.some(k => a[k] < 0) ||
    safeAdd(a.salesNetMinor, a.salesVatMinor) !== a.salesGrossMinor ||
    safeAdd(a.returnsNetMinor, a.returnsVatMinor) !== a.returnsGrossMinor
  )
    fail(
      "REPORT_INCONSISTENT",
      "Satış analizi kaynak tutarları tutarsız.",
      409
    );
  const netGrossMinor = safeAdd(a.salesGrossMinor, -a.returnsGrossMinor),
    netSalesMinor = safeAdd(a.salesNetMinor, -a.returnsNetMinor),
    cogsMinor = safeAdd(a.salesCostMinor, -a.returnsCostMinor);
  return {
    ...a,
    netGrossMinor,
    netSalesMinor,
    cogsMinor,
    grossProfitMinor: safeAdd(netSalesMinor, -cogsMinor),
    averageSaleMinor: a.saleCount
      ? integer(
          (BigInt(a.salesGrossMinor) + BigInt(a.saleCount) / 2n) /
            BigInt(a.saleCount)
        )
      : null,
  };
}
export function categoryIdentity(
  category: unknown
): Pick<CategoryAnalysis, "category" | "label" | "source"> {
  if (category === null)
    return {
      category: null,
      label: "Geçmiş kategori kaydı yok",
      source: "LEGACY_UNKNOWN",
    };
  if (typeof category !== "string" || category.length > 100)
    fail("REPORT_INCONSISTENT", "Satış kategori kaydı geçersiz.", 409);
  return {
    category,
    label: category || "Kategorisiz (satış anında)",
    source: category ? "SNAPSHOT" : "UNCATEGORIZED",
  };
}
const hourFormat = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/Istanbul",
  hour: "2-digit",
  hourCycle: "h23",
});
export function istanbulHour(utc: string) {
  if (!/^\d{4}-\d{2}-\d{2} \d{2}:00:00$/.test(utc))
    fail("REPORT_INCONSISTENT", "Satış saat kaydı geçersiz.", 409);
  const date = new Date(utc.replace(" ", "T") + "Z");
  if (
    !Number.isFinite(date.getTime()) ||
    date.toISOString().slice(0, 19).replace("T", " ") !== utc
  )
    fail("REPORT_INCONSISTENT", "Satış saat kaydı geçersiz.", 409);
  return Number(hourFormat.format(date));
}
export function hourAnalysis(
  buckets: (AmountInput & { utcHour: string })[]
): HourAnalysis[] {
  const sums = Array.from(
    { length: 24 },
    () =>
      Object.fromEntries(amountKeys.map(k => [k, 0])) as Record<
        (typeof amountKeys)[number],
        number
      >
  );
  for (const b of buckets) {
    const h = istanbulHour(b.utcHour);
    for (const k of amountKeys) sums[h][k] = safeAdd(sums[h][k], integer(b[k]));
  }
  return sums.map((s, hour) => ({ ...analysisAmounts(s), hour }));
}
export function totalAnalysis(hours: HourAnalysis[]): AnalysisAmounts {
  return analysisAmounts(
    Object.fromEntries(
      amountKeys.map(k => [k, hours.reduce((s, h) => safeAdd(s, h[k]), 0)])
    )
  );
}

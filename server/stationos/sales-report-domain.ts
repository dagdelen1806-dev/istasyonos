import { calendarDate, plusDays, integer } from "./market-accounting-domain";
import { fail } from "./types";
import { safeAdd } from "./safety";
import { buildMarketDaily } from "./market-report-domain";
import type {
  SalesMetrics,
  ReportSaleDetail,
} from "../../shared/market-reports";
export function reportRange(from: unknown, to: unknown) {
  const f = calendarDate(from),
    t = calendarDate(to);
  const days = (Date.parse(t) - Date.parse(f)) / 86400000 + 1;
  if (days < 1 || days > 366 || f < "2000-01-01" || t > "9998-12-31")
    fail(
      "INVALID_DATE",
      "Rapor aralığı 2000 yılından itibaren en fazla 366 gün olmalı."
    );
  return {
    from: f,
    to: t,
    days,
    previousFrom: plusDays(f, -days),
    previousTo: plusDays(f, -1),
  };
}
export function reportSequence(value: unknown): string {
  if (
    typeof value !== "string" ||
    !/^(0|[1-9]\d{0,19})$/.test(value) ||
    BigInt(value) > 18446744073709551615n
  )
    fail("INVALID_CURSOR", "Rapor kayıt sınırı/imleci geçersiz.");
  return value;
}
export function salesMetrics(
  b: Record<string, number>,
  s: Record<string, unknown>,
  r: Record<string, unknown>
): SalesMetrics {
  const daily = buildMarketDaily("", b, {}, {}, {}),
    sales = integer(s.gross),
    returns = integer(r.gross);
  const payments = {
    cashMinor: integer(s.cash),
    cardMinor: integer(s.card),
    creditMinor: integer(s.credit),
  };
  if (
    safeAdd(payments.cashMinor, payments.cardMinor, payments.creditMinor) !==
      sales ||
    safeAdd(sales, -returns) !== daily.salesGrossMinor
  )
    fail(
      "REPORT_INCONSISTENT",
      "Satış kaynakları ile mali defter uyuşmuyor; rapor hesaplanmadı.",
      409
    );
  const count = integer(s.n);
  return {
    saleCount: count,
    salesGrossMinor: sales,
    returnsGrossMinor: returns,
    netGrossMinor: safeAdd(sales, -returns),
    netSalesMinor: daily.salesNetMinor,
    cogsMinor: daily.cogsMinor,
    grossProfitMinor: daily.grossProfitMinor,
    expensesMinor: daily.expensesMinor,
    gainsMinor: daily.gainsMinor,
    resultMinor: daily.operatingResultMinor,
    averageSaleMinor: count
      ? Number((BigInt(sales) + BigInt(count) / 2n) / BigInt(count))
      : null,
    payments,
    returns: {
      count: integer(r.n),
      cashMinor: integer(r.cash),
      bankMinor: integer(r.bank),
      creditMinor: integer(r.credit),
    },
  };
}
export function validateReportSale(d: ReportSaleDetail) {
  const sum = (key: "grossMinor" | "netMinor" | "vatMinor" | "costMinor") =>
    d.lines.reduce((s, l) => safeAdd(s, l[key]), 0);
  if (
    !d.lines.length ||
    sum("grossMinor") !== d.totalMinor ||
    sum("netMinor") !== d.netMinor ||
    sum("vatMinor") !== d.vatMinor ||
    sum("costMinor") !== d.costMinor ||
    safeAdd(d.cashMinor, d.cardMinor, d.creditMinor) !== d.totalMinor ||
    safeAdd(d.netMinor, d.vatMinor) !== d.totalMinor ||
    d.lines.some(
      l => l.quantity <= 0 || safeAdd(l.netMinor, l.vatMinor) !== l.grossMinor
    )
  )
    fail(
      "REPORT_INCONSISTENT",
      "Fiş satırları ile kayıtlı mali tutarlar uyuşmuyor.",
      409
    );
  return d;
}

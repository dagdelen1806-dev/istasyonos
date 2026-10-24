import { calendarDate } from "./market-accounting-domain";
import { safeAdd } from "./safety";
import { fail } from "./types";
import type { StockHealthItem, MarginItem } from "../../shared/stock-health";
const days = (a: string, b: string) =>
  (Date.parse(calendarDate(a)) - Date.parse(calendarDate(b))) / 86400000;
export function inactivity(
  today: string,
  startedOn: string,
  createdOn: string,
  lastSale: string | null,
  quantity: number,
  age: number
) {
  const observedFrom = startedOn > createdOn ? startedOn : createdOn;
  if (observedFrom > today || (lastSale !== null && lastSale > today))
    fail(
      "REPORT_INCONSISTENT",
      "Stok raporunda gelecekte bir kaynak tarihi var.",
      409
    );
  const observedDays = days(today, observedFrom),
    last = lastSale && lastSale > observedFrom ? lastSale : observedFrom,
    noSaleDays = days(today, last);
  const status: StockHealthItem["status"] =
    quantity === 0
      ? "NO_STOCK"
      : lastSale !== null && days(today, lastSale) < age
        ? "ACTIVE"
        : observedDays < age
          ? "UNOBSERVED"
          : noSaleDays >= age
            ? "INACTIVE"
            : "ACTIVE";
  return { observedFrom, observedDays, noSaleDays, status };
}
export function validateStock(
  quantity: number,
  value: number,
  inventoryQty: number,
  saleable: number,
  lotQty: number | null
) {
  if (
    [quantity, value, inventoryQty, saleable].some(
      x => !Number.isSafeInteger(x) || x < 0
    ) ||
    quantity !== inventoryQty ||
    (quantity === 0 && value !== 0) ||
    saleable > quantity ||
    (lotQty !== null && lotQty !== quantity)
  )
    fail(
      "REPORT_INCONSISTENT",
      "Ürün, parti ve kayıtlı mali stok miktarı/değeri uyuşmuyor.",
      409
    );
}
export function marginItem(
  input: Omit<
    MarginItem,
    | "netSalesMinor"
    | "cogsMinor"
    | "grossProfitMinor"
    | "salesProfitMinor"
    | "salesMarginBps"
    | "status"
  >,
  threshold: number
): MarginItem {
  const netSalesMinor = safeAdd(input.salesNetMinor, -input.returnsNetMinor),
    cogsMinor = safeAdd(input.salesCostMinor, -input.returnsCostMinor),
    grossProfitMinor = safeAdd(netSalesMinor, -cogsMinor),
    salesProfitMinor = safeAdd(input.salesNetMinor, -input.salesCostMinor);
  const ratio =
    input.salesNetMinor > 0
      ? (BigInt(salesProfitMinor) * 10000n) / BigInt(input.salesNetMinor)
      : null;
  const salesMarginBps =
    ratio !== null &&
    ratio >= -BigInt(Number.MAX_SAFE_INTEGER) &&
    ratio <= BigInt(Number.MAX_SAFE_INTEGER)
      ? Number(ratio)
      : null;
  // Classification uses exact integers; rounded display percentages cannot hide an alert.
  const below =
    input.salesNetMinor > 0 &&
    BigInt(salesProfitMinor) * 10000n <
      BigInt(input.salesNetMinor) * BigInt(threshold);
  const status: MarginItem["status"] =
    input.lossLines > 0 || salesProfitMinor < 0
      ? "LOSS"
      : input.lowLines > 0 || below
        ? "LOW"
        : input.soldQty === 0
          ? "RETURN_ONLY"
          : input.salesNetMinor === 0
            ? "NO_REVENUE"
            : "OK";
  return {
    ...input,
    netSalesMinor,
    cogsMinor,
    grossProfitMinor,
    salesProfitMinor,
    salesMarginBps,
    status,
  };
}

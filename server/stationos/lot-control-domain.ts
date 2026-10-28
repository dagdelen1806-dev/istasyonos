import { calendarDate, integer } from "./market-accounting-domain";
import { requireId, isRecord } from "./domain";
import { fail } from "./types";
import { countReportItems } from "./count-report-domain";
import type { LossItem } from "../../shared/lot-control";
export function lotRisk(today: string, expiry: string | null, status: string) {
  if (!["AVAILABLE", "QUARANTINE"].includes(status))
    fail("REPORT_INCONSISTENT", "Parti durumu geçersiz.", 409);
  const daysLeft =
    expiry === null
      ? null
      : (Date.parse(calendarDate(expiry)) - Date.parse(calendarDate(today))) /
        86400000;
  return {
    daysLeft,
    saleable: status === "AVAILABLE" && daysLeft !== null && daysLeft >= 0,
    expired: daysLeft !== null && daysLeft < 0,
    unknown: daysLeft === null,
    quarantine: status === "QUARANTINE",
  };
}
export type DecodedLoss = Omit<
  LossItem,
  "name" | "barcode" | "unit" | "labelSource" | "lots"
> & {
  label: { name: string; barcode: string; unit: string } | null;
  lots: {
    id: string;
    code: string | null;
    expiryDate: string | null;
    status: string | null;
    before: number;
    after: number;
    delta: number;
    historical: boolean;
  }[];
};
const invalid = () =>
  fail(
    "REPORT_INCONSISTENT",
    "Fire/sayım kaydı mali fişle uyuşmuyor; güncel maliyetten rapor üretilmedi.",
    409
  );
export function lossItems(
  kind: string,
  payload: unknown,
  gainMinor: number,
  lossMinor: number
): DecodedLoss[] {
  if (kind === "STOCK_COUNT")
    return countReportItems(payload, { gainMinor, lossMinor }).items.map(p => ({
      ...p,
      lots: p.lots.map(l => ({ ...l, historical: true })),
    }));
  if (!["LOT_WRITE_OFF", "LOT_COUNT", "STOCK_ADJUST"].includes(kind))
    return invalid();
  let p: unknown;
  try {
    p = typeof payload === "string" ? JSON.parse(payload) : payload;
  } catch {
    return invalid();
  }
  if (
    !isRecord(p) ||
    ![p.before, p.after, p.valueMinor].every(
      v => typeof v === "number" && Number.isSafeInteger(v) && v >= 0
    )
  )
    return invalid();
  const before = integer(p.before),
    after = integer(p.after),
    delta = after - before,
    amount = integer(p.valueMinor);
  if (
    (kind === "LOT_WRITE_OFF" && delta >= 0) ||
    (delta > 0
      ? gainMinor !== amount || lossMinor !== 0
      : delta < 0
        ? lossMinor !== amount || gainMinor !== 0
        : amount !== 0 || gainMinor !== 0 || lossMinor !== 0)
  )
    return invalid();
  let productId: string;
  try {
    productId = requireId(p.productId, "Ürün");
    if (kind !== "STOCK_ADJUST") requireId(p.lotId, "Parti");
  } catch {
    return invalid();
  }
  const lots =
    kind === "STOCK_ADJUST"
      ? []
      : [
          {
            id: requireId(p.lotId, "Parti"),
            code: null,
            expiryDate: null,
            status: null,
            before,
            after,
            delta,
            historical: false,
          },
        ];
  return [
    {
      productId,
      before,
      after,
      delta,
      gainMinor,
      lossMinor,
      label: null,
      lots,
    },
  ];
}

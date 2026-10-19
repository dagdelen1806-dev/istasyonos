import { requireInteger, requireString, isRecord } from "./domain";
import { calendarDate } from "./market-accounting-domain";
import { safeAdd } from "./safety";
import { fail } from "./types";
export function lotInput(
  value: unknown,
  quantity: number,
  today: string,
  allowUnknown = false
) {
  if (
    !Array.isArray(value) ||
    value.length > 50 ||
    (!value.length && quantity > 0)
  )
    fail("LOT_DETAILS_REQUIRED", "Parti adedi ve SKT bilgilerini girin.");
  const result = value.map(raw => {
    if (!isRecord(raw)) fail("INVALID_INPUT", "Parti satırı geçersiz.");
    const code = requireString(raw.code, "Parti kodu", { max: 100 }),
      qty = requireInteger(raw.quantity, "Parti adedi");
    const expiry =
      raw.expiryDate == null || raw.expiryDate === ""
        ? null
        : calendarDate(raw.expiryDate, "SKT");
    if (!allowUnknown && (!expiry || expiry < today))
      fail(
        "LOT_EXPIRY_REQUIRED",
        "Yeni alışta bugünden önce olmayan SKT zorunludur."
      );
    return {
      code,
      quantity: qty,
      expiryDate: expiry,
      status: expiry && expiry >= today ? "AVAILABLE" : "QUARANTINE",
    } as const;
  });
  if (result.reduce((n, l) => safeAdd(n, l.quantity), 0) !== quantity)
    fail(
      "LOT_QUANTITY_MISMATCH",
      "Parti toplamı ürün miktarına eşit olmalı.",
      409
    );
  return result;
}
export function allocateFefo(
  lots: {
    id: string;
    quantity: number;
    expiryDate: string | null;
    status: string;
  }[],
  quantity: number,
  today: string
) {
  requireInteger(quantity, "Çıkış adedi");
  let left = quantity;
  const result: { lotId: string; quantity: number }[] = [];
  for (const lot of lots
    .filter(
      l =>
        l.status === "AVAILABLE" &&
        l.expiryDate !== null &&
        l.expiryDate >= today
    )
    .sort((a, b) => a.expiryDate!.localeCompare(b.expiryDate!))) {
    const qty = Math.min(left, lot.quantity);
    if (qty > 0) {
      result.push({ lotId: lot.id, quantity: qty });
      left -= qty;
    }
    if (!left) break;
  }
  if (left)
    fail(
      "LOT_STOCK_UNAVAILABLE",
      "Satışa uygun SKT’li parti stoğu yetersiz. Karantina veya tarihi geçmiş stok satılamaz.",
      409
    );
  return result;
}

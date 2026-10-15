import { StationError } from "./types";

export function safeAdd(...amounts: number[]): number {
  const total = amounts.reduce((sum, value) => {
    if (!Number.isSafeInteger(value))
      throw new StationError("INVALID_MONEY", "Güvenli kuruş tutarı gerekli.");
    const next = sum + value;
    if (!Number.isSafeInteger(next))
      throw new StationError(
        "AMOUNT_OVERFLOW",
        "Toplam güvenli tutar sınırını aşıyor.",
        409
      );
    return next;
  }, 0);
  return total;
}

export function containsLikelyPan(text: string): boolean {
  const candidates = text.match(/(?:\d[ -]?){13,19}/g) || [];
  return candidates.some(value => {
    const digits = value.replace(/\D/g, "");
    if (digits.length < 13 || digits.length > 19 || /^(\d)\1+$/.test(digits))
      return false;
    let total = 0;
    let double = false;
    for (let i = digits.length - 1; i >= 0; i--) {
      let digit = Number(digits[i]);
      if (double) {
        digit *= 2;
        if (digit > 9) digit -= 9;
      }
      total += digit;
      double = !double;
    }
    return total % 10 === 0;
  });
}

export function rejectCardData(...fields: (string | null)[]): void {
  if (fields.some(field => field && containsLikelyPan(field))) {
    throw new StationError(
      "CARD_DATA_FORBIDDEN",
      "Tam kart numarası içeriyor olabilecek metin kaydedilemez. Yalnız işlem referansı ve gerekli slip alanlarını girin."
    );
  }
}

export function recommendationQuantity(
  stock: number,
  minimum: number,
  averageDaily: number
): number {
  if (!Number.isFinite(averageDaily) || averageDaily < 0)
    throw new StationError("INVALID_INPUT", "Satış ortalaması geçerli değil.");
  // Seven review days + three assumed lead-time days + two days safety.
  // Initial pilot assumptions, not a supplier-specific delivery guarantee.
  const target = Math.max(minimum, Math.ceil(averageDaily * 12));
  const quantity = Math.max(0, target - stock);
  if (!Number.isSafeInteger(quantity))
    throw new StationError(
      "INVALID_INPUT",
      "Sipariş adedi güvenli sınırı aşıyor."
    );
  return quantity;
}

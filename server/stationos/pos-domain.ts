import type { PosLineInput } from "../../shared/pos";
import { isRecord, requireId, requireInteger, requireMoney } from "./domain";
import { safeAdd } from "./safety";
import { fail } from "./types";

export function normalizePosLines(value: unknown): PosLineInput[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 100)
    fail("INVALID_CART", "Sepet 1–100 ürün satırı içermelidir.");
  const lines = new Map<string, PosLineInput>();
  for (const raw of value) {
    if (!isRecord(raw)) fail("INVALID_CART", "Ürün satırı geçersiz.");
    const productId = requireId(raw.productId, "productId");
    const quantity = requireInteger(raw.quantity, "quantity");
    if (quantity > 10000)
      fail("INVALID_CART", "Satır adedi 10.000 sınırını aşıyor.");
    const expectedUnitPriceMinor = requireMoney(
      raw.expectedUnitPriceMinor,
      "expectedUnitPriceMinor",
      { allowZero: true }
    );
    const previous = lines.get(productId);
    if (previous && previous.expectedUnitPriceMinor !== expectedUnitPriceMinor)
      fail(
        "PRICE_CONFLICT",
        "Aynı ürün için farklı fiyatlar gönderilemez.",
        409
      );
    const totalQuantity = safeAdd(previous?.quantity ?? 0, quantity);
    if (totalQuantity > 10000)
      fail("INVALID_CART", "Ürün toplam adedi 10.000 sınırını aşıyor.");
    lines.set(productId, {
      productId,
      quantity: totalQuantity,
      expectedUnitPriceMinor,
    });
  }
  // All checkout transactions acquire product locks in the same order.
  return [...lines.values()].sort((a, b) =>
    a.productId.localeCompare(b.productId)
  );
}

export function posLineTotal(unitPrice: number, quantity: number): number {
  requireMoney(unitPrice, "unitPrice", { allowZero: true });
  requireInteger(quantity, "quantity");
  const total = unitPrice * quantity;
  if (!Number.isSafeInteger(total))
    fail("AMOUNT_OVERFLOW", "Sepet tutarı güvenli sınırı aşıyor.", 409);
  return total;
}

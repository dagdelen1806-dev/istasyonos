import type { PosLineInput } from "../../shared/pos";
import {
  isRecord,
  requireId,
  requireInteger,
  requireMoney,
  requireEnum,
} from "./domain";
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

export function posPayment(body: Record<string, unknown>, total: number) {
  const paymentKind = requireEnum(body.paymentKind, "paymentKind", [
    "CASH",
    "CARD_MANUAL",
    "MIXED",
  ] as const);
  const cashAmountMinor =
    paymentKind === "CASH"
      ? total
      : paymentKind === "MIXED"
        ? requireMoney(body.cashAmountMinor, "cashAmountMinor")
        : 0;
  if (paymentKind === "MIXED" && cashAmountMinor >= total)
    fail(
      "INVALID_PAYMENT_SPLIT",
      "Karma ödemede nakit ve kart tutarları sıfırdan büyük olmalıdır.",
      409
    );
  const cardAmountMinor = total - cashAmountMinor;
  if (paymentKind !== "CASH" && body.cardConfirmed !== true)
    fail(
      "CARD_CONFIRMATION_REQUIRED",
      "Ayrı POS cihazındaki kart tahsilatını teyit edin. Bu kayıt banka doğrulaması değildir.",
      409
    );
  const tenderedMinor =
    paymentKind === "CARD_MANUAL"
      ? null
      : requireMoney(body.tenderedMinor, "tenderedMinor", { allowZero: true });
  if (tenderedMinor !== null && tenderedMinor < cashAmountMinor)
    fail("INSUFFICIENT_CASH", "Alınan nakit, nakit ödeme payından az.", 409);
  return {
    paymentKind,
    cashAmountMinor,
    cardAmountMinor,
    tenderedMinor,
    changeMinor:
      tenderedMinor === null ? null : tenderedMinor - cashAmountMinor,
  };
}

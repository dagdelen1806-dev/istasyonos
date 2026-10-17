import { requireInteger } from "./domain";
import { integer, netTax } from "./market-accounting-domain";
import { safeAdd } from "./safety";
import { fail } from "./types";
export function packQuantity(quantity: number, pack: number, max = 10000) {
  requireInteger(quantity, "Okutulan miktar");
  requireInteger(pack, "Paket adedi");
  const result = quantity * pack;
  if (!Number.isSafeInteger(result) || result > max)
    fail("QUANTITY_LIMIT", "Temel birim adedi sınırı aşıyor.");
  return result;
}
export function stockSuggestion(
  stock: number,
  min: number,
  max: number,
  sold28: number,
  lead: number,
  review: number,
  safety: number,
  pack: number
) {
  const sales = Math.max(0, sold28),
    daily = sales / 28;
  const target = Math.max(
    min,
    max,
    Math.ceil(daily * (lead + review + safety))
  );
  const quantity = integer(
    Math.ceil(Math.max(0, target - stock) / pack) * pack
  );
  return {
    quantity,
    daily,
    coverDays: daily > 0 ? stock / daily : null,
    critical: stock <= min || (daily > 0 && stock / daily <= lead + safety),
    stagnant: stock > 0 && sales === 0,
  };
}
export function estimateOrder(
  qty: number,
  unitNet: number,
  vat: number | null
) {
  const net = qty * unitNet;
  if (!Number.isSafeInteger(net))
    fail("AMOUNT_OVERFLOW", "Sipariş tahmini güvenli tutarı aşıyor.", 409);
  return { net, gross: vat === null ? null : safeAdd(net, netTax(net, vat)) };
}
export function monthRange(value: string) {
  if (
    !/^\d{4}-(0[1-9]|1[0-2])$/.test(value) ||
    value < "2000-01" ||
    value > "9998-12"
  )
    fail("INVALID_MONTH", "Geçerli YYYY-AA ayı seçin.");
  const [y, m] = value.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
  const prev = new Date(Date.UTC(y, m - 2, 1)).toISOString().slice(0, 7);
  return {
    from: value + "-01",
    to: last,
    previousMonth: prev,
    totalDays: Number(last.slice(8)),
  };
}

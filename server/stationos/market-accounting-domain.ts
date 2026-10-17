import type { MarketAccount } from "../../shared/market-accounting";
import { requireInteger, requireMoney, requireString } from "./domain";
import { fail } from "./types";
import { safeAdd } from "./safety";
export type LedgerLine = {
  account: MarketAccount;
  debit?: number;
  credit?: number;
  partyId?: string;
  registerId?: string;
};
export function integer(value: unknown): number {
  const n = Number(value ?? 0);
  if (!Number.isSafeInteger(n))
    fail("AMOUNT_OVERFLOW", "Muhasebe tutarı güvenli sınırı aşıyor.", 409);
  return n;
}
export function ratioRound(
  value: number,
  numerator: number,
  denominator: number
): number {
  requireMoney(value, "value", { allowZero: true });
  requireInteger(numerator, "numerator", { allowZero: true });
  requireInteger(denominator, "denominator");
  return integer(
    (BigInt(value) * BigInt(numerator) + BigInt(denominator) / 2n) /
      BigInt(denominator)
  );
}
export function stockCost(
  value: number,
  quantity: number,
  sold: number
): number {
  requireInteger(quantity, "quantity");
  requireInteger(sold, "sold");
  if (sold > quantity)
    fail("NEGATIVE_INVENTORY", "Stok miktarı yetersiz.", 409);
  return sold === quantity ? value : ratioRound(value, sold, quantity);
}
export function vatRate(value: unknown): number {
  const n = requireInteger(value, "KDV oranı", { allowZero: true });
  if (n > 10000) fail("INVALID_VAT", "KDV oranı %0–100 arasında olmalıdır.");
  return n;
}
export function splitGross(gross: number, bps: number) {
  const net = ratioRound(gross, 10000, 10000 + vatRate(bps));
  return { net, vat: gross - net };
}
export function netTax(net: number, bps: number) {
  return ratioRound(net, vatRate(bps), 10000);
}
export function balanced(lines: LedgerLine[]): LedgerLine[] {
  const clean = lines.filter(
    l => (l.debit ?? 0) !== 0 || (l.credit ?? 0) !== 0
  );
  let d = 0,
    c = 0;
  for (const l of clean) {
    requireMoney(l.debit ?? 0, "debit", { allowZero: true });
    requireMoney(l.credit ?? 0, "credit", { allowZero: true });
    if (!!l.debit === !!l.credit)
      fail("LEDGER_UNBALANCED", "Muhasebe satırı geçersiz.", 500);
    d = safeAdd(d, l.debit ?? 0);
    c = safeAdd(c, l.credit ?? 0);
  }
  if (d !== c) fail("LEDGER_UNBALANCED", "Muhasebe fişi dengeli değil.", 500);
  return clean;
}
export function businessToday() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Istanbul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}
export function calendarDate(value: unknown, field = "Tarih"): string {
  const s = requireString(value, field, { max: 10 });
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(s) ||
    Number.isNaN(Date.parse(s + "T12:00:00Z")) ||
    new Date(s + "T12:00:00Z").toISOString().slice(0, 10) !== s
  )
    fail("INVALID_DATE", `${field} geçerli bir YYYY-AA-GG tarihi olmalıdır.`);
  return s;
}
export function plusDays(date: string, days: number) {
  const d = new Date(calendarDate(date) + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

import { createHash } from "node:crypto";
import type { ShelfSnapshot } from "../../shared/shelf-labels";
import { labelBarcode } from "../../shared/label-barcode";
import { integer } from "./market-accounting-domain";
export function shelfSnapshot(
  p: Record<string, any>,
  history?: Record<string, any> | null
): ShelfSnapshot {
  return {
    version: 1,
    productId: p.id,
    name: p.name,
    barcode: p.barcode,
    unit: p.base_unit,
    shelf: p.shelf,
    priceMinor: integer(p.sale_price_minor),
    vatBps: p.market_vat_bps === null ? null : integer(p.market_vat_bps),
    priceRevision: String(history?.id ?? 0),
    priceRecordedAt: history?.created_at ?? p.created_at,
  };
}
export const shelfHash = (snapshot: ShelfSnapshot) =>
  createHash("sha256").update(JSON.stringify(snapshot)).digest("hex");
export function shelfIssue(s: ShelfSnapshot) {
  if (s.priceMinor <= 0) return "Pozitif satış fiyatı girilmeli.";
  if (s.vatBps === null) return "Satış KDV oranı tanımlanmalı.";
  try {
    labelBarcode(s.barcode);
    return null;
  } catch (e) {
    return (e as Error).message;
  }
}
export function shelfChanges(s: ShelfSnapshot, old: ShelfSnapshot | null) {
  if (!old) return ["İlk raf teyidi"];
  const names = {
    name: "Ürün adı",
    barcode: "Barkod",
    unit: "Birim",
    shelf: "Raf",
    priceMinor: "Fiyat",
    vatBps: "KDV",
    priceRevision: "Fiyat kaydı",
    priceRecordedAt: "Fiyat kayıt tarihi",
  } as const;
  return (Object.keys(names) as (keyof typeof names)[])
    .filter(k => s[k] !== old[k])
    .map(k => names[k]);
}

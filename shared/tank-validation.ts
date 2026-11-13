export interface PhotoTank {
  number: string;
  fuelLabel: string;
  capacityLitres: number | null;
  productVolumeLitres: number | null;
  netProductVolumeLitres: number | null;
  emptyVolumeLitres?: number | null;
  reportedVolumeFillPercent: number | null;
  reportedLevelPercent?: number | null;
}
export interface ValidationCard {
  tankId: string;
  number: string;
  fuel: string;
  capacityMl: number;
}
export interface Proposal {
  capacityMl: number | null;
  volumeMl: number | null;
  basis: "PRODUCT" | "NET" | "UNDECIDED" | "BOTH";
  productMl?: number | null;
  netMl?: number | null;
  tankId: string | null;
}
export interface PhotoReview {
  rowNumber: string;
  revision: number;
  decision: "PENDING" | "APPROVED_DRAFT" | "REJECTED";
  proposal: Proposal;
  note: string;
  evidence: string;
  reviewerName: string;
}
export function toMl(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0)
    return null;
  const ml = Math.round(value * 1000);
  return Number.isSafeInteger(ml) && value === ml / 1000 ? ml : null;
}
export function fillPercent(
  volumeMl: number | null,
  capacityMl: number | null
): number | null {
  if (
    volumeMl === null ||
    capacityMl === null ||
    capacityMl <= 0 ||
    volumeMl < 0 ||
    !Number.isSafeInteger(volumeMl) ||
    !Number.isSafeInteger(capacityMl)
  )
    return null;
  return Math.round((volumeMl / capacityMl) * 10000) / 100;
}
export function analyzePhotoTank(row: PhotoTank, cards: ValidationCard[]) {
  const rawCapacity = toMl(row.capacityLitres),
    capacityMl = rawCapacity !== null && rawCapacity > 0 ? rawCapacity : null,
    productMl = toMl(row.productVolumeLitres),
    netMl = toMl(row.netProductVolumeLitres);
  const warnings: string[] = [];
  if (!capacityMl) warnings.push("CAPACITY_UNKNOWN");
  if (productMl === null || netMl === null)
    warnings.push("VOLUME_MISSING_OR_INVALID");
  if (
    capacityMl !== null &&
    ((productMl ?? 0) > capacityMl || (netMl ?? 0) > capacityMl)
  )
    warnings.push("VOLUME_EXCEEDS_CAPACITY");
  if (productMl !== null && netMl !== null && netMl > productMl)
    warnings.push("NET_EXCEEDS_PRODUCT");
  const productFillPercent = fillPercent(productMl, capacityMl),
    netFillPercent = fillPercent(netMl, capacityMl);
  if (
    row.reportedVolumeFillPercent !== null &&
    (!Number.isFinite(row.reportedVolumeFillPercent) ||
      row.reportedVolumeFillPercent < 0 ||
      row.reportedVolumeFillPercent > 100)
  )
    warnings.push("SOURCE_PERCENT_INVALID");
  if (
    row.reportedVolumeFillPercent !== null &&
    productFillPercent !== null &&
    Math.round(productFillPercent) !== row.reportedVolumeFillPercent
  )
    warnings.push("PRODUCT_FILL_MISMATCH");
  if (
    row.reportedVolumeFillPercent !== null &&
    netFillPercent !== null &&
    Math.round(netFillPercent) !== row.reportedVolumeFillPercent
  )
    warnings.push("NET_FILL_MISMATCH");
  const emptyMl = toMl(row.emptyVolumeLitres);
  if (
    capacityMl !== null &&
    productMl !== null &&
    emptyMl !== null &&
    productMl + emptyMl !== capacityMl
  )
    warnings.push("CAPACITY_VOLUME_SUM_MISMATCH");
  if (capacityMl === null && productMl === 0 && netMl === 0)
    warnings.push("ZERO_READINGS_UNVERIFIED");
  warnings.push(
    "MEASUREMENT_BASIS_UNCONFIRMED",
    "LEVEL_PERCENT_REQUIRES_CALIBRATION"
  );
  const normalize = (s: string) =>
    s.normalize("NFC").trim().toLocaleUpperCase("tr-TR").replace(/\s+/g, " ");
  const candidates = cards.map(card => ({
    card,
    numberMatches: normalize(card.number) === normalize(row.number),
    fuelMatches: normalize(card.fuel) === normalize(row.fuelLabel),
    capacityMatches: capacityMl !== null && card.capacityMl === capacityMl,
  }));
  const exact = candidates.filter(
    c => c.numberMatches && c.fuelMatches && c.capacityMatches
  );
  if (exact.length !== 1)
    warnings.push(exact.length > 1 ? "MATCH_AMBIGUOUS" : "MATCH_UNCONFIRMED");
  return {
    capacityMl,
    productMl,
    netMl,
    productFillPercent,
    netFillPercent,
    warnings,
    candidates,
    suggestedTankId: exact.length === 1 ? exact[0].card.tankId : null,
    proposal: {
      capacityMl,
      volumeMl: null,
      productMl: capacityMl === null ? null : productMl,
      netMl: capacityMl === null ? null : netMl,
      basis: "BOTH",
      tankId: null,
    } as Proposal,
  };
}
export const validationWarnings: Record<string, string> = {
  CAPACITY_UNKNOWN: "Kapasite bilinmiyor; 0 L gerçek kapasite kabul edilmez.",
  VOLUME_MISSING_OR_INVALID:
    "Eksik/geçersiz veya güvenli mililitre sınırı dışında hacim.",
  VOLUME_EXCEEDS_CAPACITY: "Hacim nominal kapasiteyi aşıyor.",
  NET_EXCEEDS_PRODUCT: "Net hacim ürün hacminden büyük; tanım doğrulanmalı.",
  SOURCE_PERCENT_INVALID: "Kaynak yüzde 0–100 aralığında değil.",
  PRODUCT_FILL_MISMATCH:
    "Ürün / nominal kapasite yüzdesi kaynak göstergesiyle eşleşmiyor.",
  NET_FILL_MISMATCH:
    "Net / nominal kapasite yüzdesi kaynak göstergesiyle eşleşmiyor.",
  CAPACITY_VOLUME_SUM_MISMATCH:
    "Ürün + boş hacim nominal kapasiteye eşit değil; kullanılabilir hacim/kalibrasyon tanımı gerekli.",
  ZERO_READINGS_UNVERIFIED: "Sıfır okumalar doğrulanmış boş tank sayılmaz.",
  MEASUREMENT_BASIS_UNCONFIRMED:
    "Ürün ve net hacim ayrı korunur; bunlardan stok aktarımı bu taslak onayıyla yapılmaz.",
  LEVEL_PERCENT_REQUIRES_CALIBRATION:
    "Seviye yüzdesi hacim yüzdesi değildir; tank kalibrasyon tablosu olmadan çevrilmez.",
  MATCH_AMBIGUOUS: "Birden fazla tam eşleşme var; otomatik seçim yok.",
  MATCH_UNCONFIRMED:
    "Tekil tam kart eşleşmesi yok; yönetici tankı açıkça seçmeli.",
};

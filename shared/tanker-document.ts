import { fuelInteger } from "./fuel";

export function tankerDeliveryDifferences(
  line: Pick<TankerLine, "netMl" | "dispatchMl">,
  measuredMl: number,
  basis: string
) {
  fuelInteger(measuredMl, "Ölçülen teslim", true);
  const difference = (documentMl: number | null) => {
    if (documentMl === null) return null;
    fuelInteger(documentMl, "Belge litresi", true);
    return measuredMl - documentMl;
  };
  const netDifferenceMl = difference(line.netMl),
    dispatchDifferenceMl = difference(line.dispatchMl);
  return {
    netDifferenceMl,
    dispatchDifferenceMl,
    selectedDifferenceMl:
      basis === "NET"
        ? netDifferenceMl
        : basis === "DISPATCH"
          ? dispatchDifferenceMl
          : null,
  };
}

export interface TankerLine {
  key: string;
  productCode: string | null;
  label: string;
  fuelId: string | null;
  netMl: number | null;
  dispatchMl: number | null;
}
export interface TankerPage {
  pageId: string;
  number: number | null;
  total: number | null;
}
export interface TankerValues {
  documentFields?: {
    kind: "TANK" | "INVOICE";
    fields: { label: string; value: string | null; unit: string | null }[];
  };
  documentNo: string | null;
  issuer: string | null;
  documentDate: string | null;
  supplierId: string | null;
  pages: TankerPage[];
  lines: TankerLine[];
}
export interface TankerProposal {
  values: TankerValues;
  warnings: string[];
}
export interface TankerRead {
  id: string;
  provider: "LOCAL" | "OPENAI" | "GEMINI";
  model: string;
  createdAt: string;
  proposal: TankerProposal;
}
export interface TankerReview {
  id: string;
  revision: number;
  readId: string | null;
  decision: "PENDING" | "VERIFIED_DRAFT" | "REJECTED";
  values: TankerValues;
  sourceConfirmed: boolean;
  note: string;
  evidence: string;
  reviewerName: string;
  createdAt: string;
}
export interface TankerOverview {
  externalDisabled?: boolean;
  packages: { id: string; name: string; pageCount: number }[];
  document: { id: string; name: string } | null;
  pages: { id: string; name: string; sha256: string }[];
  sourceHash: string;
  reads: TankerRead[];
  history: TankerReview[];
  latest: TankerReview | null;
  suppliers: { id: string; name: string }[];
  fuels: { id: string; name: string }[];
  tanks: {
    tankId: string;
    fuelId: string;
    number: string;
    fuel: string;
    revision: number;
    stockMl: number | null;
    capacityMl: number;
  }[];
  receipts: {
    requestId: string;
    lineKey: string;
    basis: string;
    status: string;
    tankId: string;
    sourceRevision: number;
    documentNo: string | null;
    productLabel: string;
    productCode: string | null;
    netMl: number | null;
    dispatchMl: number | null;
    documentMl: number | null;
    measuredMl: number | null;
    differenceMl: number | null;
    note: string;
    evidence: string;
    reviewNote: string | null;
    reviewEvidence: string | null;
    creatorName: string | null;
    reviewerName: string | null;
    createdAt: string;
  }[];
  openai: { available: boolean; model: string };
  gemini: { available: boolean; model: string };
}
export function tankerCompleteness(values: TankerValues) {
  const warnings: string[] = [],
    totals = values.pages.map(p => p.total),
    expected = totals[0];
  if (
    !expected ||
    totals.some(t => t !== expected) ||
    values.pages.length !== expected ||
    values.pages.some(p => p.number === null) ||
    new Set(values.pages.map(p => p.number)).size !== expected ||
    values.pages.some(p => p.number! < 1 || p.number! > expected)
  )
    warnings.push(
      "Belgenin bütün sayfaları aynı toplamla ve tekil sayfa numarasıyla doğrulanmalı."
    );
  if (values.documentFields) {
    if (
      values.documentFields.kind === "INVOICE" &&
      (!values.documentNo || !values.issuer || !values.documentDate)
    )
      warnings.push(
        "Fatura numarası, düzenleyen ve tarih kaynakla doğrulanmalı."
      );
    if (
      !values.documentFields.fields.length ||
      values.documentFields.fields.some(f => !f.value?.trim())
    )
      warnings.push("Belge alanları eksik; kaynakla kontrol edip tamamlayın.");
    return warnings;
  }
  if (
    !values.documentNo ||
    !values.issuer ||
    !values.documentDate ||
    !values.supplierId
  )
    warnings.push(
      "Belge numarası, düzenleyen, tarih ve tedarikçi eşleştirmesi gerekli."
    );
  if (
    !values.lines.length ||
    values.lines.some(
      l =>
        !l.productCode ||
        !l.fuelId ||
        l.netMl === null ||
        l.dispatchMl === null ||
        l.netMl <= 0 ||
        l.dispatchMl <= 0
    )
  )
    warnings.push(
      "Her ürün için ürün kodu, yakıt eşleştirmesi, pozitif net ve sevk hacmi gerekli."
    );
  if (
    new Set(values.lines.map(l => l.productCode).filter(Boolean)).size !==
    values.lines.length
  )
    warnings.push(
      "Aynı ürün kodu birden fazla satırda; kısmi/split teslim ayrı incelenmeli."
    );
  return warnings;
}

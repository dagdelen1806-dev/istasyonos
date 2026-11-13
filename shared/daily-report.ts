export const dailyPageKinds = [
  "UNKNOWN",
  "SALES",
  "TANK",
  "CARDS",
  "METERS",
  "TANK_STATUS",
  "TANKER_DOCUMENT",
] as const;
export type DailyPageKind = (typeof dailyPageKinds)[number];
export const dailyPageLabels: Record<DailyPageKind, string> = {
  UNKNOWN: "Sınıflandırılmadı",
  SALES: "Satış / personel özeti",
  TANK: "Tank çıkışı / stok mutabakatı",
  CARDS: "Kart ayrıntıları",
  METERS: "Pompa / sayaç sayfası",
  TANK_STATUS: "Anlık tank durumu (ürün / net)",
  TANKER_DOCUMENT: "Tanker evrakı / irsaliye",
};
export interface DailyPage {
  id: string;
  name: string;
  sha256: string;
  mime: string;
  size: number;
  position: number;
  kind: DailyPageKind;
}
export interface DailyReview {
  revision: number;
  decision: "PENDING" | "REVIEWED_DRAFT" | "REJECTED";
  shiftReference: string;
  reportDay: string;
  pages: { pageId: string; kind: DailyPageKind }[];
  note: string;
  evidence: string;
  reviewerName: string;
  createdAt: string;
}
export interface DailyPackage {
  id: string;
  sourceName: string;
  sourceSha256: string;
  pageCount: number;
  createdAt: string;
}
export interface DailyReportOverview {
  packages: DailyPackage[];
  document: DailyPackage | null;
  pages: DailyPage[];
  review: DailyReview | null;
}

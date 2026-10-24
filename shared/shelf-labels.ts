export type ShelfSnapshot = {
  version: 1;
  productId: string;
  name: string;
  barcode: string;
  unit: string;
  shelf: string;
  priceMinor: number;
  vatBps: number | null;
  priceRevision: string;
  priceRecordedAt: string;
};
export type ShelfItem = {
  snapshot: ShelfSnapshot;
  hash: string;
  labelStatus: "UNRECORDED" | "CHANGED" | "CURRENT";
  installedPriceMinor: number | null;
  installedAt: string | null;
  changedFields: string[];
  issue: string | null;
};
export type ShelfBatch = {
  id: string;
  label: string;
  createdAt: string;
  createdBy: string;
  items: {
    snapshot: ShelfSnapshot;
    hash: string;
    copies: number;
    isCurrent: boolean;
    installedAt: string | null;
  }[];
};
export type ShelfState = {
  items: ShelfItem[];
  batches: {
    id: string;
    label: string;
    createdAt: string;
    createdBy: string;
  }[];
  checks: {
    id: string;
    productName: string;
    barcode: string;
    observedMinor: number;
    expectedMinor: number;
    matches: boolean;
    actorName: string;
    reason: string | null;
    createdAt: string;
  }[];
};

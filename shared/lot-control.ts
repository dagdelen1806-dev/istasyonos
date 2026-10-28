export interface ControlLot {
  id: string;
  productId: string;
  name: string;
  barcode: string;
  unit: string;
  code: string;
  expiryDate: string | null;
  daysLeft: number | null;
  status: "AVAILABLE" | "QUARANTINE";
  quantity: number;
  saleable: boolean;
  lastStatusAt: string | null;
  lastStatusBy: string | null;
  lastStatusReason: string | null;
}
export interface LotControl {
  today: string;
  generatedAt: string;
  snapshot: string;
  horizon: number;
  mode: string;
  search: string;
  productId: string;
  products: { id: string; name: string }[];
  totals: {
    lots: number;
    products: number;
    near7: number;
    near15: number;
    near30: number;
    expired: number;
    quarantine: number;
    unknown: number;
    blocked: number;
  };
  matched: number;
  rows: ControlLot[];
  nextCursor: string | null;
}
export interface LossItem {
  productId: string;
  name: string;
  barcode: string;
  unit: string;
  labelSource: "SNAPSHOT" | "CURRENT_CARD" | "UNAVAILABLE";
  before: number;
  after: number;
  delta: number;
  gainMinor: number;
  lossMinor: number;
  lots: {
    id: string;
    code: string;
    expiryDate: string | null;
    status: string | null;
    before: number;
    after: number;
    delta: number;
    labelSource: "SNAPSHOT" | "CURRENT_CARD" | "UNAVAILABLE";
  }[];
}
export interface LossRow extends LossItem {
  entryId: string;
  sequence: string;
  date: string;
  recordedAt: string;
  kind: string;
  reason: string;
  actorName: string;
}
export interface LossReport {
  products: { id: string; name: string }[];
  from: string;
  to: string;
  asOf: string;
  kind: string;
  productId: string;
  totals: {
    entries: number;
    productRows: number;
    writeOffMinor: number;
    countGainMinor: number;
    countLossMinor: number;
  };
  rows: LossRow[];
  nextCursor: string | null;
}

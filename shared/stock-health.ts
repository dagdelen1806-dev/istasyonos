export type StockHealthMode = "ALL" | "INACTIVE" | "UNOBSERVED" | "NO_STOCK";
export interface StockHealthItem {
  id: string;
  name: string;
  barcode: string;
  unit: string;
  category: string;
  quantity: number;
  valueMinor: number;
  saleableQty: number;
  blockedQty: number;
  lastSaleDate: string | null;
  observedFrom: string;
  observedDays: number;
  noSaleDays: number;
  status: "ACTIVE" | "INACTIVE" | "UNOBSERVED" | "NO_STOCK";
}
export interface StockHealthReport {
  today: string;
  generatedAt: string;
  startedOn: string;
  bookRevision: number;
  snapshot: string;
  ageDays: number;
  mode: StockHealthMode;
  search: string;
  totals: {
    catalogProducts: number;
    stockedProducts: number;
    valueMinor: number;
    blockedProducts: number;
    inactive30: number;
    inactive30Minor: number;
    inactive60: number;
    inactive60Minor: number;
    inactive90: number;
    inactive90Minor: number;
  };
  matched: { products: number; valueMinor: number };
  rows: StockHealthItem[];
  nextCursor: string | null;
}
export type MarginMode = "ALL" | "ALERTS" | "LOSS";
export interface MarginItem {
  id: string;
  name: string;
  barcode: string;
  unit: string;
  soldQty: number;
  returnedQty: number;
  salesNetMinor: number;
  salesCostMinor: number;
  returnsNetMinor: number;
  returnsCostMinor: number;
  netSalesMinor: number;
  cogsMinor: number;
  grossProfitMinor: number;
  salesProfitMinor: number;
  salesMarginBps: number | null;
  lossLines: number;
  lowLines: number;
  sampleLossSaleId: string | null;
  status: "LOSS" | "LOW" | "OK" | "NO_REVENUE" | "RETURN_ONLY";
}
export interface MarginReport {
  from: string;
  to: string;
  generatedAt: string;
  asOf: string;
  thresholdBps: number;
  mode: MarginMode;
  totals: {
    products: number;
    lossProducts: number;
    lowProducts: number;
    lossLines: number;
    lowLines: number;
    netSalesMinor: number;
    cogsMinor: number;
    grossProfitMinor: number;
  };
  matched: number;
  rows: MarginItem[];
  nextCursor: string | null;
}

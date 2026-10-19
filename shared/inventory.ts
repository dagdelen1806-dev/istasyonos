export type Barcode = {
  barcode: string;
  productId: string;
  packQty: number;
  label: string;
};
export type PriceList = {
  id: string;
  name: string;
  active: boolean;
  staffEnabled: boolean;
};
export type ProductPrice = {
  productId: string;
  listId: string;
  unitPriceMinor: number;
};
export interface InventoryItem {
  catalogCode: string | null;
  lotTracking: boolean;
  saleableQty: number;
  blockedQty: number;
  id: string;
  name: string;
  barcode: string;
  category: string;
  brand: string;
  unit: string;
  shelf: string;
  quantity: number;
  valueMinor: number;
  averageCostMinor: number;
  salePriceMinor: number;
  vatBps: number | null;
  purchaseVatBps: number | null;
  lastPurchaseMinor: number | null;
  minimumQty: number;
  maximumQty: number;
  leadDays: number;
  reviewDays: number;
  safetyDays: number;
  orderPackQty: number;
  supplierId: string | null;
  supplierName: string | null;
  sold28: number;
  dailySales: number;
  coverDays: number | null;
  suggestedQty: number;
  estimatedNetMinor: number;
  estimatedGrossMinor: number | null;
  creditStatus: "NO_SUPPLIER" | "VAT_MISSING" | "CREDIT_BLOCKED" | "REVIEW";
  critical: boolean;
  stagnant: boolean;
}
export interface InventoryState {
  items: InventoryItem[];
  barcodes: Barcode[];
  priceLists: PriceList[];
  prices: ProductPrice[];
  priceHistory: {
    id: number;
    productId: string;
    listName: string | null;
    oldMinor: number | null;
    newMinor: number;
    actorName: string;
    createdAt: string;
  }[];
}
export type InventoryDevice = {
  id: string;
  name: string;
  model: string;
  platform: string;
  enabled: boolean;
  lastSeenAt: string | null;
};
export type DraftSummary = {
  id: string;
  kind: "COUNT" | "RECEIPT";
  status: "DRAFT" | "POSTED" | "CANCELLED";
  label: string;
  version: number;
  createdAt: string;
  updatedAt: string;
  collected: number;
  total: number;
};
export interface TerminalState {
  canApprove: boolean;
  canPost: boolean;
  enabled: boolean;
  revision: number;
  today: string;
  closedToday: boolean;
  device: InventoryDevice | null;
  devices: InventoryDevice[];
  drafts: DraftSummary[];
  products: {
    id: string;
    name: string;
    barcode: string;
    unit: string;
    shelf: string;
    lotTracking: boolean;
    unitNetMinor: number | null;
    vatBps: number | null;
  }[];
  barcodes: Barcode[];
  suppliers: { id: string; name: string }[];
}
export interface InventoryDraft {
  id: string;
  kind: "COUNT" | "RECEIPT";
  status: string;
  label: string;
  version: number;
  revision: number;
  lines: {
    productId: string;
    name: string;
    barcode: string;
    unit: string;
    baselineQty: number | null;
    countedQty: number | null;
    currentQty: number | null;
    lotTracking: boolean;
    stockChanged: boolean;
    unitNetMinor: number | null;
    currentValueMinor: number | null;
    countedBy: string | null;
    updatedAt: string | null;
  }[];
  events: {
    id: number;
    action: string;
    productId: string | null;
    beforeQty: number | null;
    afterQty: number | null;
    actorName: string;
    note: string | null;
    createdAt: string;
  }[];
}
export interface InventoryMovements {
  product: { id: string; name: string; unit: string };
  from: string;
  to: string;
  openingQty: number;
  closingQty: number;
  currentQty: number;
  nextCursor: string | null;
  rows: {
    id: string;
    date: string;
    kind: string;
    quantity: number;
    reference: string | null;
    actorName: string;
  }[];
}
export interface MonthlyReport {
  startedOn: string | null;
  month: string;
  from: string;
  to: string;
  previousMonth: string;
  closedDays: number;
  totalDays: number;
  totals: {
    netSalesMinor: number;
    grossSalesMinor: number;
    salesReturnsMinor: number;
    cogsMinor: number;
    grossProfitMinor: number;
    expensesMinor: number;
    gainsMinor: number;
    resultMinor: number;
    netPurchasesMinor: number;
    inputVatMinor: number;
    outputVatMinor: number;
    collectionsMinor: number;
    paymentsMinor: number;
    saleCount: number;
  };
  previous: MonthlyReport["totals"];
  days: {
    date: string;
    netSalesMinor: number;
    cogsMinor: number;
    expensesMinor: number;
    resultMinor: number;
  }[];
  balances: Record<string, number>;
  products: {
    id: string;
    name: string;
    quantity: number;
    netSalesMinor: number;
    costMinor: number;
    profitMinor: number;
  }[];
}

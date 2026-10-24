export interface SalesMetrics {
  saleCount: number;
  salesGrossMinor: number;
  returnsGrossMinor: number;
  netGrossMinor: number;
  netSalesMinor: number;
  cogsMinor: number;
  grossProfitMinor: number;
  expensesMinor: number;
  gainsMinor: number;
  resultMinor: number;
  averageSaleMinor: number | null;
  payments: { cashMinor: number; cardMinor: number; creditMinor: number };
  returns: {
    count: number;
    cashMinor: number;
    bankMinor: number;
    creditMinor: number;
  };
}
export interface ReportSale {
  id: string;
  entryId: string;
  sequence: string;
  date: string;
  createdAt: string;
  registerName: string;
  actorName: string;
  paymentKind: string;
  totalMinor: number;
  cashMinor: number;
  cardMinor: number;
  creditMinor: number;
}
export interface SalesReport {
  filters: ReportFilters;
  salesOnly: boolean;
  from: string;
  to: string;
  previousFrom: string;
  previousTo: string;
  asOf: string;
  generatedAt: string;
  startedOn: string | null;
  closedDays: number;
  totalDays: number;
  totals: SalesMetrics;
  previous: SalesMetrics;
  rows: ReportSale[];
  nextCursor: string | null;
}
export interface SalesProduct {
  id: string;
  name: string;
  barcode: string;
  soldQty: number;
  returnedQty: number;
  netSalesMinor: number;
  cogsMinor: number;
  profitMinor: number;
}
export interface SalesProducts {
  asOf: string;
  rows: SalesProduct[];
  nextCursor: string | null;
}
export interface ReportSaleDetail extends ReportSale {
  deviceId: string | null;
  sessionId: string;
  netMinor: number;
  vatMinor: number;
  costMinor: number;
  lines: {
    productId: string;
    name: string;
    barcode: string;
    quantity: number;
    unitPriceMinor: number;
    grossMinor: number;
    netMinor: number;
    vatMinor: number;
    costMinor: number;
  }[];
  returns: {
    id: string;
    date: string;
    reference: string;
    grossMinor: number;
    refundMinor: number;
    creditedMinor: number;
    wallet: string | null;
  }[];
}

export interface ReportFilters {
  registerId: string;
  userId: string;
}
export interface ReportOptions {
  registers: { id: string; name: string }[];
  users: { id: string; name: string }[];
}
export interface CancellationRow {
  id: string;
  cartId: string;
  version: number;
  date: string;
  actorName: string;
  registerName: string;
  deviceId: string;
  action: "REDUCE" | "CANCEL";
  reason: string | null;
  removedMinor: number;
  lines: {
    productId: string;
    name: string;
    barcode: string;
    beforeQty: number;
    afterQty: number;
    removedQty: number;
    unitPriceMinor: number;
    removedMinor: number;
  }[];
}
export interface CancellationReport {
  from: string;
  to: string;
  asOf: string;
  nextCursor: string | null;
  filters: ReportFilters;
  totals: {
    events: number;
    reductions: number;
    cancellations: number;
    removedMinor: number;
  };
  rows: CancellationRow[];
}

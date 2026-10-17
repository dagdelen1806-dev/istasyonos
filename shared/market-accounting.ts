export const marketAccounts = {
  CASH_SAFE: "Merkez kasa",
  CASH_DRAWER: "Satış çekmeceleri",
  BANK: "Banka · manuel kayıt",
  CARD_CLEARING: "Kart alacağı · beyan",
  RECEIVABLE: "Müşteri alacakları",
  INVENTORY: "Stok maliyeti",
  INPUT_VAT: "Alış KDV",
  PAYABLE: "Tedarikçi borçları",
  OUTPUT_VAT: "Satış KDV",
  OPENING: "Açılış karşılığı",
  SALES: "KDV hariç satış",
  SALES_RETURNS: "KDV hariç satış iadesi",
  PURCHASE_RETURN_VARIANCE: "Alış iadesi maliyet farkı",
  COGS: "Satılan mal maliyeti",
  EXPENSE: "İşletme gideri",
  BANK_FEES: "Banka komisyonu",
  STOCK_LOSS: "Stok eksiği",
  STOCK_GAIN: "Stok fazlası",
  CASH_LOSS: "Kasa eksiği",
  CASH_GAIN: "Kasa fazlası",
} as const;
export type MarketAccount = keyof typeof marketAccounts;
export interface MarketParty {
  id: string;
  name: string;
  kind: "CUSTOMER" | "SUPPLIER" | "BOTH";
  taxNumber: string | null;
  receivableLimitMinor: number;
  payableLimitMinor: number | null;
  termDays: number;
  receivableMinor: number;
  payableMinor: number;
  overdueReceivableMinor: number;
  overduePayableMinor: number;
}
export interface MarketDocument {
  id: string;
  partyId: string;
  partyName: string;
  kind: "PURCHASE" | "CREDIT_SALE" | "OPENING_AR" | "OPENING_AP";
  reference: string;
  dueDate: string;
  totalMinor: number;
  settledMinor: number;
  creditedMinor: number;
}
export interface MarketStock {
  id: string;
  name: string;
  barcode: string;
  quantity: number;
  valueMinor: number;
  averageCostMinor: number;
  minimumQty: number;
  salePriceMinor: number;
  vatBps: number | null;
}
export interface MarketJournal {
  id: string;
  number: number;
  date: string;
  kind: string;
  description: string;
  reference: string | null;
  createdAt: string;
  actorName: string;
  reversed?: boolean;
  lines: {
    account: MarketAccount;
    partyId: string | null;
    partyName: string | null;
    registerId: string | null;
    debitMinor: number;
    creditMinor: number;
  }[];
}
export interface MarketDaily {
  date: string;
  salesNetMinor: number;
  outputVatMinor: number;
  salesGrossMinor: number;
  cogsMinor: number;
  grossProfitMinor: number;
  expensesMinor: number;
  gainsMinor: number;
  operatingResultMinor: number;
  purchasesNetMinor: number;
  inputVatMinor: number;
  collectionsMinor: number;
  supplierPaymentsMinor: number;
  saleCount: number;
  salesReturnsGrossMinor: number;
  purchaseReturnsGrossMinor: number;
  saleReturnCount: number;
}
export interface MarketClose {
  id: string;
  date: string;
  expectedCashMinor: number;
  countedCashMinor: number;
  differenceMinor: number;
  note: string | null;
  hash: string;
  createdAt: string;
  snapshot: {
    daily: MarketDaily;
    balances: Partial<Record<MarketAccount, number>>;
    revision: number;
  };
}
export interface MarketAccountingState {
  today: string;
  reportDate: string;
  enabled: boolean;
  revision: number;
  closedToday: boolean;
  startedOn: string | null;
  openingInventoryMinor: number;
  unvaluedStockCount: number;
  balances: Partial<Record<MarketAccount, number>>;
  daily: MarketDaily;
  parties: MarketParty[];
  documents: MarketDocument[];
  stock: MarketStock[];
  journal: MarketJournal[];
  closes: MarketClose[];
  openRegisterCount: number;
  stockValueMinor: number;
  trialDifferenceMinor: number;
  returns: MarketReturnRecord[];
}
export interface MarketReturnSummary {
  id: string;
  number: number;
  date: string;
  kind: "POS_SALE" | "PURCHASE";
  reference: string | null;
  partyName: string | null;
  grossMinor: number;
}
export interface MarketReturnSource extends MarketReturnSummary {
  revision: number;
  openDocumentMinor: number;
  items: {
    productId: string;
    name: string;
    barcode: string;
    quantity: number;
    grossMinor: number;
    netMinor: number;
    costMinor: number;
    returnedQuantity: number;
    returnedGrossMinor: number;
    returnedNetMinor: number;
    returnedCostMinor: number;
    stockQuantity: number;
    stockValueMinor: number;
  }[];
}
export interface MarketReturnRecord {
  id: string;
  date: string;
  kind: "SALE_RETURN" | "PURCHASE_RETURN";
  reference: string;
  sourceEntryId: string;
  sourceReference: string | null;
  reason: string;
  grossMinor: number;
  creditedMinor: number;
  refundMinor: number;
  wallet: "CASH_SAFE" | "BANK" | null;
}
export interface MarketStatementPage {
  party: { id: string; name: string };
  from: string;
  to: string;
  openingReceivableMinor: number;
  openingPayableMinor: number;
  closingReceivableMinor: number;
  closingPayableMinor: number;
  nextCursor: number | null;
  rows: {
    id: string;
    number: number;
    date: string;
    kind: string;
    description: string;
    reference: string | null;
    receivableDeltaMinor: number;
    returnGrossMinor: number;
    returnRefundMinor: number;
    payableDeltaMinor: number;
    receivableBalanceMinor: number;
    payableBalanceMinor: number;
  }[];
}

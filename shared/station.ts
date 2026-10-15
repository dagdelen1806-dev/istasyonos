export type AppRole =
  | "OWNER"
  | "MANAGER"
  | "ACCOUNTANT"
  | "FUEL_STAFF"
  | "MARKET_STAFF"
  | "PURCHASER";
export type PaymentKind = "CASH" | "IBAN" | "DEBT" | "AR_COLLECTION";
export type Unit = "FUEL" | "MARKET";
export interface Company {
  id: string;
  name: string;
  taxNumber: string | null;
}
export interface Station {
  id: string;
  companyId: string;
  name: string;
  code: string;
  address: string | null;
}
export interface Shift {
  id: string;
  stationId: string;
  label: string;
  startsAt: string;
  endsAt: string | null;
  status: string;
}
export interface Account {
  id: string;
  stationId: string;
  shiftId: string;
  userId: number;
  userName: string;
  status: string;
  revision: number;
  businessUnit: Unit;
  openingFloatMinor: number;
  sourceSalesMinor: number | null;
  sourceRef: string | null;
  cardTotalMinor: number;
  cashSalesMinor: number;
  ibanMinor: number;
  debtMinor: number;
  arCollectionMinor: number;
  expectedCashMinor: number;
  countedCashMinor: number | null;
  differenceMinor: number | null;
  cashReceiverUserId: number | null;
  signatureCount: number;
}
export interface Payment {
  id: string;
  accountId: string | null;
  kind: PaymentKind;
  amountMinor: number;
  debtorId: string | null;
  reference: string | null;
  status: string;
}
export interface Slip {
  id: string;
  accountId: string;
  amountMinor: number;
  reference: string;
  terminalId: string;
  transactionAt: string;
  status: string;
  method: string;
  note: string | null;
}
export interface Debtor {
  id: string;
  name: string;
  type: "PERSON" | "COMPANY";
  balanceMinor: number | null;
}
export interface Product {
  id: string;
  stationId: string;
  name: string;
  barcode: string;
  stockQty: number;
  minimumQty: number;
  purchasePriceMinor: number | null;
  salePriceMinor: number;
  supplierId: string | null;
}
export interface Supplier {
  id: string;
  name: string;
  creditLimitMinor: number;
  balanceMinor: number;
  dueMinor: number;
}
export interface Payable {
  id: string;
  supplierId: string;
  supplierName: string;
  amountMinor: number;
  dueDate: string;
  status: string;
}
export interface Recommendation {
  productId: string;
  productName: string;
  supplierId: string | null;
  supplierName: string | null;
  averageDaily: number;
  stockQty: number;
  daysCover: number | null;
  recommendedQty: number;
  costMinor: number;
  availableCreditMinor: number | null;
  status: string;
}
export interface AppState {
  user: { id: number; name: string; email: string | null };
  canSetup: boolean;
  tenant: null | { id: string; name: string; isDemo: boolean };
  member: null | { role: AppRole; stationIds: string[] };
  csrfToken?: string;
  companies: Company[];
  stations: Station[];
  members: {
    userId: number;
    name: string;
    email: string | null;
    role: AppRole;
    stationIds: string[];
  }[];
  shifts: Shift[];
  accounts: Account[];
  payments: Payment[];
  slips: Slip[];
  debtors: Debtor[];
  products: Product[];
  suppliers: Supplier[];
  payables: Payable[];
  recommendations: Recommendation[];
  audit: {
    id: string;
    actorName: string;
    action: string;
    entityId: string | null;
    createdAt: string;
  }[];
  accountEvents?: {
    id: string;
    accountId: string;
    actorName: string;
    eventType: string;
    revision: number;
    createdAt: string;
    payload: Record<string, unknown>;
  }[];
  integrationStatus: { turpak: string; ocr: string; bank: string };
}
export const roleLabels: Record<AppRole, string> = {
  OWNER: "Firma sahibi",
  MANAGER: "Yönetici",
  ACCOUNTANT: "Muhasebeci",
  FUEL_STAFF: "Akaryakıt satış personeli",
  MARKET_STAFF: "Market satış personeli",
  PURCHASER: "Satın alma",
};
export const paymentLabels: Record<PaymentKind, string> = {
  CASH: "Nakit satış",
  IBAN: "IBAN satış beyanı",
  DEBT: "Borçlu satış",
  AR_COLLECTION: "Eski cari nakit tahsilatı",
};
export function money(minor: number | null | undefined) {
  return minor == null
    ? "—"
    : new Intl.NumberFormat("tr-TR", {
        style: "currency",
        currency: "TRY",
        maximumFractionDigits: 2,
      }).format(minor / 100);
}
export function parseMoney(input: string): number {
  const value = input.trim().replace(/\s/g, "").replace(",", ".");
  if (!/^\d{1,10}(\.\d{1,2})?$/.test(value))
    throw new Error(
      "Tutarı 1250,50 biçiminde, binlik ayırıcı kullanmadan girin."
    );
  const [whole, fraction = ""] = value.split(".");
  const minor = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  if (!Number.isSafeInteger(minor))
    throw new Error("Tutar izin verilen sınırı aşıyor.");
  return minor;
}
export function amountInput(minor: number | null | undefined) {
  return minor == null ? "" : (minor / 100).toFixed(2).replace(".", ",");
}

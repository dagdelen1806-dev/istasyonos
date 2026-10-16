import type { Product } from "./station";

export interface PosRegister {
  id: string;
  name: string;
  code: string;
}
export interface PosSession {
  id: string;
  registerId: string;
  userId: number;
  deviceId: string;
  openedAt: string;
  closedAt: string | null;
  openingFloatMinor: number;
  cashSalesMinor: number;
  cardDeclaredMinor: number;
  expectedCashMinor: number;
  countedCashMinor: number | null;
  differenceMinor: number | null;
}
export interface PosSale {
  id: string;
  sessionId: string;
  registerId: string;
  totalMinor: number;
  paymentKind: "CASH" | "CARD_MANUAL";
  createdAt: string;
  fiscalStatus: "NOT_ISSUED_DEMO";
}
export interface PosState {
  isDemo: boolean;
  registers: PosRegister[];
  sessions: PosSession[];
  products: Product[];
  sales: PosSale[];
  capabilities: {
    scanner: "KEYBOARD_INPUT";
    printer: "NOT_CONFIGURED";
    drawer: "NOT_CONFIGURED";
    bank: "MANUAL_DECLARATION";
    fiscal: "NOT_CONFIGURED";
    sync: "NOT_CONFIGURED";
  };
}
export interface PosLineInput {
  productId: string;
  quantity: number;
  expectedUnitPriceMinor: number;
}

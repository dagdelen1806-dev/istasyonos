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
  deviceIds: string[];
  closedByDeviceId: string | null;
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
  deviceId: string;
  totalMinor: number;
  paymentKind: "CASH" | "CARD_MANUAL" | "MIXED";
  cashAmountMinor: number;
  cardAmountMinor: number;
  createdAt: string;
  fiscalStatus: "NOT_ISSUED_DEMO";
}
export interface PosState {
  isDemo: boolean;
  registers: PosRegister[];
  sessions: PosSession[];
  products: Product[];
  sales: PosSale[];
  activeCart: PosCart | null;
  heldCarts: PosCart[];
  cancellations: PosCartEvent[];
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

export interface PosCartLine extends PosLineInput {
  productName: string;
  barcode: string;
}
export interface PosCart {
  id: string;
  sessionId: string;
  ownerUserId: number;
  deviceId: string;
  status: "ACTIVE" | "HELD" | "CHECKED_OUT" | "CANCELLED";
  version: number;
  label: string | null;
  lines: PosCartLine[];
  updatedAt: string;
}
export interface PosCartEvent {
  id: string;
  cartId: string;
  action: "REDUCE" | "CANCEL";
  reason: string;
  actorName: string;
  deviceId: string;
  createdAt: string;
  beforeLines: PosCartLine[];
  afterLines: PosCartLine[];
}

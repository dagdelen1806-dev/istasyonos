export const STATION_ROLES = [
  "OWNER",
  "MANAGER",
  "ACCOUNTANT",
  "FUEL_STAFF",
  "MARKET_STAFF",
  "PURCHASER",
] as const;
export type StationRole = (typeof STATION_ROLES)[number];

export type BusinessUnit = "FUEL" | "MARKET";
export type PaymentKind = "CASH" | "IBAN" | "DEBT" | "AR_COLLECTION";
export type StockKind = "RECEIPT" | "SALE" | "ADJUSTMENT";
export type TerminalKind = "DESKTOP" | "MOBILE";

export type StationActor = {
  id: number;
  openId: string;
  name: string | null;
  email: string | null;
  role: string;
};

export type StationMember = {
  tenantId: string;
  userId: number;
  role: StationRole;
  stationIds: string[];
};

export type AccountTotals = {
  cashSalesMinor: number;
  cardTotalMinor: number;
  ibanMinor: number;
  debtMinor: number;
  arCollectionMinor: number;
  expectedCashMinor: number;
  sourceTotalMinor: number;
};

export type MutationResponse = { ok: true; result: unknown };

export class StationError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status = 400
  ) {
    super(message);
    this.name = "StationError";
  }
}

export function fail(code: string, message: string, status = 400): never {
  throw new StationError(code, message, status);
}

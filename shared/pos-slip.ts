export const posSlipTransactionTypes = ["SALE", "VOID", "REFUND"] as const;
export type PosSlipTransactionType = (typeof posSlipTransactionTypes)[number];
export type PosSlipSettlementKind = "CARD_SLIP" | "FAST";
export type PosSlipValues = {
  transactionAt: string | null;
  amountMinor: number | null;
  bank: string | null;
  terminal: string | null;
  reference: string | null;
  transactionType: PosSlipTransactionType | null;
  settlementKind: PosSlipSettlementKind | null;
  maskedCard: string | null;
};
export type PosSlipSourceFields = {
  transactionAt: string | null;
  amount: string | null;
  bank: string | null;
  terminal: string | null;
  terminalFingerprint: string | null;
  reference: string | null;
  transactionType: string | null;
  settlementKind: string | null;
  referenceFingerprint: string | null;
  maskedCard: string | null;
};
export type PosSlipParse = {
  values: PosSlipValues;
  source: PosSlipSourceFields;
  warnings: string[];
  reviewRequired: boolean;
};
export const emptyPosSlipValues = (): PosSlipValues => ({
  transactionAt: null,
  amountMinor: null,
  bank: null,
  terminal: null,
  reference: null,
  transactionType: null,
  settlementKind: null,
  maskedCard: null,
});

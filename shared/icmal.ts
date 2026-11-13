import { calculateFuel, fuelInteger, type FuelPoint } from "./fuel";

export const specialKinds = [
  "TTS",
  "GIFT_LOAD",
  "GIFT_USE",
  "PARTNER",
  "TEST_OUT",
  "TEST_RETURN",
  "TANKER_IN",
] as const;
export type SpecialKind = (typeof specialKinds)[number];
export const specialLabels: Record<SpecialKind, string> = {
  TTS: "TTS",
  GIFT_LOAD: "Gift Kart yükleme",
  GIFT_USE: "Gift Kart kullanım",
  PARTNER: "Partner Kart",
  TEST_OUT: "Test yakıtı çıkışı",
  TEST_RETURN: "Test yakıtı fiziksel dönüş",
  TANKER_IN: "Tanker teslimi",
};
export type SpecialModel =
  | "DRAFT"
  | "EXISTING_PAYMENT"
  | "RECEIVABLE"
  | "PREPAID"
  | "PHYSICAL";
export interface IcmalTank {
  tankId: string;
  label: string;
  openingMl: number | null;
  closingMl: number | null;
  meterOutMl: number;
  deliveryMl: number;
  returnMl: number;
  expectedClosingMl: number | null;
  differenceMl: number | null;
}
export interface IcmalDetails {
  centralTanks?: {
    tankId: string;
    stockMl: number | null;
    measuredMl: number | null;
    differenceMl: number | null;
    measurementFresh: boolean;
    posted: boolean;
  }[];
  meterMl: number;
  meterMinor: number;
  testMl: number;
  testMinor: number;
  commercialMl: number;
  commercialMinor: number;
  ttsMinor: number;
  giftLoadMinor: number;
  giftUseMinor: number;
  partnerMinor: number;
  excelTtsGiftMinor: number;
  specialCoverageMinor: number;
  draftCount: number;
  pendingCount: number;
  operations: SpecialOperation[];
  tanks: IcmalTank[];
  deliveryDocumentDifferenceMl: number;
  testReturnMl: number;
}
export interface IcmalAccount {
  cashCountedMinor: number | null;
  cashDifferenceMinor: number | null;
  receivableLedgerMinor: number;
  receivableDifferenceMinor: number;
  providerReceivableMinor: number;
  giftAppliedMinor: number;
  id: string;
  shiftId: string;
  shiftLabel: string;
  startsAt: string;
  userId: number;
  userName: string;
  status: string;
  revision: number;
  cashMinor: number;
  cardMinor: number;
  ibanMinor: number;
  fastMinor: number;
  debtMinor: number;
  arCollectionMinor: number;
  specialCoveredMinor: number;
  prepaymentCashMinor: number;
  expectedCashMinor: number;
  signatureCount: number;
  fuel: null | {
    closed: boolean;
    soldMl: number;
    meterExpectedMinor: number;
    expectedMinor: number;
    collectedMinor: number;
    reportedMl: number | null;
    litreDifferenceMl: number | null;
    amountDifferenceMinor: number;
    icmal: IcmalDetails | null;
    readings: (FuelPoint & {
      nozzleId: string;
      sequenceNo: number;
      kind: string;
      readingAt: string;
    })[];
  };
}
export type SpecialOperation = {
  id: string;
  accountId: string;
  kind: SpecialKind;
  model: SpecialModel;
  status: "DRAFT" | "RECORDED" | "VOID";
  source: string;
  provider: string;
  reference: string;
  plate: string | null;
  customer: string | null;
  instrument: string | null;
  amountMinor: number;
  volumeMl: number;
  documentMl: number | null;
  nozzleId: string | null;
  tankId: string | null;
  startMeterMl: number | null;
  endMeterMl: number | null;
  relatedId: string | null;
  paymentId: string | null;
  slipId: string | null;
  settlement: "DRAFT" | "PENDING" | "SETTLED" | "NOT_APPLICABLE";
  settlementMethod: string;
  note: string;
  evidence: string;
  reviewerId: number | null;
};
export function specialCoverage(operations: SpecialOperation[]) {
  return safeSum(
    operations
      .filter(
        o =>
          o.status === "RECORDED" &&
          ["TTS", "GIFT_USE", "PARTNER"].includes(o.kind) &&
          ["RECEIVABLE", "PREPAID"].includes(o.model)
      )
      .map(o => o.amountMinor)
  );
}
export function safeSum(values: number[]) {
  return values.reduce(
    (sum, n) => fuelInteger(sum + fuelInteger(n, "Değer"), "Toplam"),
    0
  );
}
export function giftBalance(
  operations: SpecialOperation[],
  provider: string,
  instrument: string
) {
  const wallet = operations.filter(
    o =>
      o.status === "RECORDED" &&
      o.model === "PREPAID" &&
      o.provider === provider &&
      o.instrument === instrument
  );
  return (
    safeSum(
      wallet
        .filter(o => o.kind === "GIFT_LOAD" && o.settlement === "SETTLED")
        .map(o => o.amountMinor)
    ) -
    safeSum(wallet.filter(o => o.kind === "GIFT_USE").map(o => o.amountMinor))
  );
}
export function testAllocation(
  points: FuelPoint[],
  ranges: { start: number; end: number }[]
) {
  const total = calculateFuel(points),
    sorted = [...ranges].sort((a, b) => a.start - b.start);
  for (let i = 0; i < sorted.length; i++) {
    const r = sorted[i];
    fuelInteger(r.start, "Test başlangıcı");
    fuelInteger(r.end, "Test sonu");
    if (
      r.end <= r.start ||
      r.start < points[0].meterMl ||
      r.end > points.at(-1)!.meterMl ||
      (i > 0 && r.start < sorted[i - 1].end)
    )
      throw Error("Test aralığı sayaç dışında veya mükerrer/çakışıyor.");
  }
  let commercialMinor = 0,
    testMl = 0;
  for (const r of sorted) testMl = safeSum([testMl, r.end - r.start]);
  // Round commercial litres within each original price segment. Test value is
  // the residual, so commercial + test always equals the original meter value.
  for (let i = 1; i < points.length; i++) {
    const start = points[i - 1].meterMl,
      end = points[i].meterMl;
    const excluded = safeSum(
      sorted.map(r =>
        Math.max(0, Math.min(end, r.end) - Math.max(start, r.start))
      )
    );
    const minor = Number(
      (BigInt(end - start - excluded) * BigInt(points[i - 1].priceMinor) +
        500n) /
        1000n
    );
    commercialMinor = safeSum([commercialMinor, minor]);
  }
  return {
    meterMl: total.soldMl,
    meterMinor: total.expectedMinor,
    testMl,
    commercialMl: total.soldMl - testMl,
    commercialMinor,
    testMinor: total.expectedMinor - commercialMinor,
  };
}
export function operationalTotals(operations: SpecialOperation[]) {
  const recorded = operations.filter(o => o.status === "RECORDED");
  const amount = (kind: SpecialKind) =>
    safeSum(recorded.filter(o => o.kind === kind).map(o => o.amountMinor));
  return {
    ttsMinor: amount("TTS"),
    giftLoadMinor: amount("GIFT_LOAD"),
    giftUseMinor: amount("GIFT_USE"),
    partnerMinor: amount("PARTNER"),
    excelTtsGiftMinor: safeSum([amount("TTS"), amount("GIFT_USE")]),
    specialCoverageMinor: specialCoverage(recorded),
    draftCount: operations.filter(o => o.status === "DRAFT").length,
    pendingCount: recorded.filter(o => o.settlement === "PENDING").length,
  };
}

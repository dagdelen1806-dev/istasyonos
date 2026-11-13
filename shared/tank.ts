import { fuelInteger } from "./fuel";
export const tankRequestKinds = ["OPENING", "DELIVERY", "ADJUSTMENT"] as const;
export const tankMovementLabels: Record<string, string> = {
  OPENING: "Başlangıç stoku",
  SALE: "Ticari satış",
  TEST_OUT: "Test çıkışı",
  TEST_RETURN: "Test dönüşü",
  DELIVERY: "Tanker girişi",
  ADJUSTMENT: "Onaylı stok düzeltmesi",
};
export function stockAfter(before: number, delta: number, capacity: number) {
  fuelInteger(before, "Stok");
  fuelInteger(capacity, "Kapasite", true);
  if (!Number.isSafeInteger(delta))
    throw Error("Stok hareketi güvenli tamsayı olmalı.");
  const after = before + delta;
  fuelInteger(after, "Hareket sonrası stok");
  if (after > capacity) throw Error("Hareket tank kapasitesini aşıyor.");
  return after;
}
export function tankStatus(
  stock: number | null,
  capacity: number,
  critical: number,
  measured: number | null,
  tolerance: number
) {
  fuelInteger(capacity, "Kapasite", true);
  fuelInteger(critical, "Kritik seviye");
  fuelInteger(tolerance, "Tolerans");
  if (critical > capacity || tolerance > capacity)
    throw Error("Kritik seviye/tolerans kapasiteyi aşamaz.");
  if (stock !== null) stockAfter(stock, 0, capacity);
  if (measured !== null) fuelInteger(measured, "Ölçüm");
  const differenceMl =
    stock === null || measured === null ? null : measured - stock;
  return {
    fillPercent:
      stock === null ? null : Number(((stock / capacity) * 100).toFixed(2)),
    critical: stock === null ? null : stock <= critical,
    differenceMl,
    withinTolerance:
      differenceMl === null ? null : Math.abs(differenceMl) <= tolerance,
  };
}
export interface TankCard {
  tankId: string;
  stationId: string;
  number: string;
  fuel: string;
  capacityMl: number;
  criticalMl: number;
  toleranceMl: number;
  revision: number;
  stockMl: number | null;
  initializedAt: string | null;
  pumps: string;
  measuredMl: number | null;
  measurementAt: string | null;
  measurementFresh: boolean;
  fillPercent: number | null;
  critical: boolean | null;
  differenceMl: number | null;
  withinTolerance: boolean | null;
}
export interface TankMovement {
  id: string;
  tankId: string;
  tankNumber: string;
  kind: string;
  deltaMl: number;
  beforeMl: number;
  afterMl: number;
  accountId: string | null;
  shiftLabel: string | null;
  reference: string;
  note: string;
  evidence: string;
  createdAt: string;
  actorName: string;
  sourceKey: string;
}
export interface TankRequest {
  id: string;
  tankId: string;
  kind: "OPENING" | "DELIVERY" | "ADJUSTMENT";
  targetMl: number | null;
  documentMl: number | null;
  measuredMl: number | null;
  differenceMl: number | null;
  supplierId: string | null;
  supplierName: string | null;
  reference: string;
  note: string;
  evidence: string;
  status: string;
  createdBy: number;
  expectedRevision: number;
  operationId: string | null;
}
export interface TankMeasurement {
  id: string;
  tankId: string;
  measuredMl: number;
  theoreticalMl: number | null;
  differenceMl: number | null;
  withinTolerance: boolean | null;
  revision: number;
  note: string;
  evidence: string;
  createdAt: string;
}
export interface TankReport {
  volumes?: import("./tank-volumes").TankVolumesReport;
  cards: TankCard[];
  movements: TankMovement[];
  requests: TankRequest[];
  measurements: TankMeasurement[];
  pendingAccounts: number;
}

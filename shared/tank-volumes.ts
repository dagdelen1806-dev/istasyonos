import { fuelInteger } from "./fuel";
export function volumeVariance(
  productMl: number,
  netMl: number,
  baselineSpreadMl: number | null
) {
  fuelInteger(productMl, "Ürün hacmi");
  fuelInteger(netMl, "Net hacim");
  if (baselineSpreadMl !== null && !Number.isSafeInteger(baselineSpreadMl))
    throw Error("Geçerli fark referansı gerekli.");
  const spreadMl = productMl - netMl,
    periodDifferenceMl =
      baselineSpreadMl === null ? null : spreadMl - baselineSpreadMl;
  if (periodDifferenceMl !== null && !Number.isSafeInteger(periodDifferenceMl))
    throw Error("Dönem farkı güvenli sınırı aşıyor.");
  return { productMl, netMl, spreadMl, baselineSpreadMl, periodDifferenceMl };
}
export interface DualReading {
  id: string;
  tankId: string;
  sequence: number;
  productMl: number;
  netMl: number;
  spreadMl: number;
  stockRevision: number;
  note: string;
  evidence: string;
  createdAt: string;
}
export interface VarianceReset {
  id: string;
  tankId: string;
  readingId: string;
  previousResetId: string | null;
  previousSpreadMl: number | null;
  baselineSpreadMl: number;
  closedDifferenceMl: number | null;
  status: string;
  note: string;
  evidence: string;
  createdBy: number;
  createdAt: string;
  reviewedAt: string | null;
}
export interface DualTankState {
  tankId: string;
  number: string;
  productMl: number | null;
  netMl: number | null;
  spreadMl: number | null;
  baselineSpreadMl: number | null;
  periodDifferenceMl: number | null;
  fresh: boolean;
  readingId: string | null;
  baselineId: string | null;
}
export interface TankVolumesReport {
  states: DualTankState[];
  readings: DualReading[];
  resets: VarianceReset[];
}

import { isRecord, requireId, requireString } from "./domain";
import { safeAdd } from "./safety";
import { fail } from "./types";
const invalid = () =>
  fail(
    "COUNT_REPORT_INCONSISTENT",
    "Sayımın kayıtlı ayrıntıları mali fişle uyuşmuyor. Güncel stoktan rapor üretilmedi; kayıt incelemesi gerekiyor.",
    409
  );
const nonnegative = (v: unknown) => {
  if (typeof v !== "number" || !Number.isSafeInteger(v) || v < 0)
    return invalid();
  return v;
};
const text = (v: unknown, max: number) =>
  requireString(v, "Sayım kayıt alanı", { max });
const identity = (v: unknown): number | null =>
  v === undefined || v === null
    ? null
    : typeof v === "number" && Number.isSafeInteger(v) && v > 0
      ? v
      : invalid();
export function countReportItems(
  payload: unknown,
  expected: { gainMinor: number; lossMinor: number }
) {
  try {
    const p = typeof payload === "string" ? JSON.parse(payload) : payload;
    if (
      !isRecord(p) ||
      !Array.isArray(p.items) ||
      !p.items.length ||
      p.items.length > 5000
    )
      return invalid();
    const version = p.countReportVersion ?? 0;
    if (version !== 0 && version !== 1) return invalid();
    const seen = new Set<string>();
    let gain = 0,
      loss = 0;
    const items = p.items.map(raw => {
      if (!isRecord(raw)) return invalid();
      const productId = requireId(raw.productId, "productId");
      if (seen.has(productId)) return invalid();
      seen.add(productId);
      const before = nonnegative(raw.before),
        after = nonnegative(raw.after),
        delta = after - before;
      if (raw.delta !== delta) return invalid();
      let gainMinor = 0,
        lossMinor = 0;
      if (raw.gainMinor !== undefined || raw.lossMinor !== undefined) {
        gainMinor = nonnegative(raw.gainMinor);
        lossMinor = nonnegative(raw.lossMinor);
      } else {
        const value = nonnegative(raw.valueMinor);
        if (delta > 0) gainMinor = value;
        else if (delta < 0) lossMinor = value;
        else if (value !== 0) return invalid();
      }
      gain = safeAdd(gain, gainMinor);
      loss = safeAdd(loss, lossMinor);
      const snapshot = version === 1;
      const label = snapshot
        ? {
            name: text(raw.productName, 190),
            barcode: text(raw.barcode, 190),
            unit: text(raw.unit, 32),
          }
        : null;
      const ids = new Set<string>();
      if (raw.lots !== undefined && !Array.isArray(raw.lots)) return invalid();
      const lots = ((raw.lots as unknown[] | undefined) ?? []).map(l => {
        if (!isRecord(l)) return invalid();
        const id = requireId(l.id, "lotId");
        if (ids.has(id)) return invalid();
        ids.add(id);
        const lb = nonnegative(l.before),
          la = nonnegative(l.after);
        if (l.status !== "AVAILABLE" && l.status !== "QUARANTINE")
          return invalid();
        if (
          l.expiryDate !== null &&
          (typeof l.expiryDate !== "string" ||
            !/^\d{4}-\d{2}-\d{2}$/.test(l.expiryDate))
        )
          return invalid();
        return {
          id,
          code: text(l.code, 100),
          expiryDate: l.expiryDate as string | null,
          status: l.status,
          before: lb,
          after: la,
          delta: la - lb,
          countedByUserId: identity(l.countedByUserId),
          deviceId:
            l.deviceId === undefined || l.deviceId === null
              ? null
              : requireId(l.deviceId, "deviceId"),
        };
      });
      if (
        raw.lots !== undefined &&
        lots.reduce((n, l) => safeAdd(n, l.delta), 0) !== delta
      )
        return invalid();
      return {
        productId,
        label,
        before,
        after,
        delta,
        gainMinor,
        lossMinor,
        netMinor: safeAdd(gainMinor, -lossMinor),
        countedByUserId: identity(raw.countedByUserId),
        deviceId:
          raw.deviceId === undefined || raw.deviceId === null
            ? null
            : requireId(raw.deviceId, "deviceId"),
        lots,
      };
    });
    if (gain !== expected.gainMinor || loss !== expected.lossMinor)
      return invalid();
    return { items, version };
  } catch {
    return invalid();
  }
}

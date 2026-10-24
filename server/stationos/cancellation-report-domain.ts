import { requireId, isRecord } from "./domain";
import { integer } from "./market-accounting-domain";
import { safeAdd } from "./safety";
import { fail } from "./types";
import type { CancellationRow } from "../../shared/market-reports";
const bad = () =>
  fail(
    "REPORT_INCONSISTENT",
    "İptal olayının kayıtlı önce/sonra satırları tutarsız.",
    409
  );
function decode(value: unknown) {
  let v: unknown;
  try {
    v = typeof value === "string" ? JSON.parse(value) : value;
  } catch {
    bad();
  }
  if (!Array.isArray(v) || v.length > 100) return bad();
  const seen = new Set<string>();
  return v.map(l => {
    if (
      !isRecord(l) ||
      typeof l.productId !== "string" ||
      typeof l.productName !== "string" ||
      typeof l.barcode !== "string" ||
      !Number.isSafeInteger(l.quantity) ||
      Number(l.quantity) <= 0 ||
      !Number.isSafeInteger(l.expectedUnitPriceMinor) ||
      Number(l.expectedUnitPriceMinor) < 0 ||
      seen.has(l.productId)
    )
      return bad();
    seen.add(l.productId);
    return {
      id: l.productId,
      name: l.productName,
      barcode: l.barcode,
      qty: Number(l.quantity),
      price: Number(l.expectedUnitPriceMinor),
    };
  });
}
export function cancellationLines(
  before: unknown,
  after: unknown,
  action: string
) {
  const b = decode(before),
    a = decode(after),
    am = new Map(a.map(l => [l.id, l]));
  if (
    !["REDUCE", "CANCEL"].includes(action) ||
    a.some(l => !b.some(x => x.id === l.id)) ||
    (action === "CANCEL" && a.length)
  )
    return bad();
  const lines: CancellationRow["lines"] = [];
  for (const l of b) {
    const next = am.get(l.id);
    if (
      next &&
      (next.qty > l.qty ||
        next.price !== l.price ||
        next.name !== l.name ||
        next.barcode !== l.barcode)
    )
      return bad();
    const removed = l.qty - (next?.qty ?? 0);
    if (removed) {
      const amount = integer(BigInt(removed) * BigInt(l.price));
      lines.push({
        productId: l.id,
        name: l.name,
        barcode: l.barcode,
        beforeQty: l.qty,
        afterQty: next?.qty ?? 0,
        removedQty: removed,
        unitPriceMinor: l.price,
        removedMinor: amount,
      });
    }
  }
  if (action === "REDUCE" && !lines.length) return bad();
  return {
    lines,
    removedMinor: lines.reduce((s, l) => safeAdd(s, l.removedMinor), 0),
  };
}
export type EventPosition = { time: string; id: string };
export const encodeEventPosition = (v: EventPosition) =>
  Buffer.from(JSON.stringify(v)).toString("base64url");
export function eventPosition(value: unknown): EventPosition {
  try {
    if (
      typeof value !== "string" ||
      value.length > 256 ||
      !/^[a-zA-Z0-9_-]+$/.test(value)
    )
      throw Error();
    const v = JSON.parse(Buffer.from(value, "base64url").toString());
    if (
      !v ||
      typeof v.time !== "string" ||
      !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3}$/.test(v.time)
    )
      throw Error();
    const d = new Date(v.time.replace(" ", "T") + "Z");
    if (
      !Number.isFinite(d.getTime()) ||
      d.toISOString().slice(0, 23).replace("T", " ") !== v.time
    )
      throw Error();
    return { time: v.time, id: requireId(v.id, "Olay imleci") };
  } catch {
    fail("INVALID_CURSOR", "İptal raporu imleci geçersiz.");
  }
}

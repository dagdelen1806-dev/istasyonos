// Volumes are integer millilitres, prices integer kuruş/litre. Never use floats
// for multiplication: round each price segment once, half up, to kuruş.
export interface FuelPoint {
  meterMl: number;
  priceMinor: number;
}
export function fuelInteger(
  value: unknown,
  label: string,
  positive = false
): number {
  if (!Number.isSafeInteger(value) || Number(value) < (positive ? 1 : 0))
    throw new Error(
      `${label}: güvenli ${positive ? "pozitif " : ""}tamsayı gerekli.`
    );
  return Number(value);
}
export function parseLitres(value: string): number {
  const text = value.trim().replace(",", ".");
  if (!/^\d{1,12}(\.\d{1,3})?$/.test(text))
    throw new Error(
      "Litreyi en fazla üç ondalıkla, binlik ayırıcı olmadan girin."
    );
  const [whole, fraction = ""] = text.split(".");
  return fuelInteger(
    Number(whole) * 1000 + Number(fraction.padEnd(3, "0")),
    "Litre"
  );
}
export const litres = (ml: number) =>
  (ml / 1000).toLocaleString("tr-TR", {
    minimumFractionDigits: 3,
    maximumFractionDigits: 3,
  });
export function calculateFuel(points: FuelPoint[]) {
  if (points.length < 2) throw new Error("Açılış ve kapanış okuması gerekli.");
  let amount = 0n;
  for (let i = 0; i < points.length; i++) {
    fuelInteger(points[i].meterMl, "Sayaç");
    fuelInteger(points[i].priceMinor, "Fiyat", true);
    if (!i) continue;
    const delta = points[i].meterMl - points[i - 1].meterMl;
    if (delta < 0)
      throw new Error(
        "Sayaç gerileyemez; devir/sıfırlama otomatik kabul edilmez."
      );
    amount += (BigInt(delta) * BigInt(points[i - 1].priceMinor) + 500n) / 1000n;
  }
  const expectedMinor = fuelInteger(Number(amount), "Satış tutarı");
  return { soldMl: points.at(-1)!.meterMl - points[0].meterMl, expectedMinor };
}

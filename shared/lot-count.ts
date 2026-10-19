export type LotCount = { before: number; after: number | null };
const safe = (n: bigint) => {
  if (n < 0n || n > BigInt(Number.MAX_SAFE_INTEGER))
    throw Error("Parti sayım tutarı veya adedi güvenli sınırı aşıyor.");
  return Number(n);
};
export function lotCountPlan(
  quantity: number,
  value: number,
  counts: LotCount[],
  unitCost: number | undefined
) {
  if (
    ![
      quantity,
      value,
      ...counts.flatMap(c => [
        c.before,
        ...(c.after === null ? [] : [c.after]),
      ]),
    ].every(n => Number.isSafeInteger(n) && n >= 0)
  )
    throw Error("Parti sayımı geçerli tam sayı olmalı.");
  if (counts.some(c => c.after !== null && c.after > 1000000000))
    throw Error("Parti adedi sınırı aşıyor.");
  if (quantity === 0 && value !== 0)
    throw Error(
      "Sıfır stokta net değer bulunuyor; stok mutabakatını kontrol edin."
    );
  const baseline = counts.reduce((n, c) => n + BigInt(c.before), 0n);
  if (baseline !== BigInt(quantity))
    throw Error("Parti toplamı ve ürün stoğu uyuşmuyor.");
  let gains = 0n,
    losses = 0n;
  for (const c of counts) {
    if (c.after === null) continue;
    const delta = BigInt(c.after) - BigInt(c.before);
    if (delta > 0n) gains += delta;
    else losses -= delta;
  }
  if (
    gains &&
    (unitCost === undefined || !Number.isSafeInteger(unitCost) || unitCost < 0)
  )
    throw Error("Parti fazlası için KDV hariç birim maliyet girin.");
  const gain = gains * BigInt(unitCost ?? 0),
    loss =
      losses === BigInt(quantity)
        ? BigInt(value)
        : quantity
          ? (BigInt(value) * losses + BigInt(quantity) / 2n) / BigInt(quantity)
          : 0n;
  return {
    gainQty: safe(gains),
    lossQty: safe(losses),
    quantity: safe(BigInt(quantity) + gains - losses),
    gainMinor: safe(gain),
    lossMinor: safe(loss),
    valueMinor: safe(BigInt(value) + gain - loss),
  };
}

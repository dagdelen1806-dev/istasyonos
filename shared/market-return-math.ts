export type ReturnAmounts = {
  quantity: number;
  grossMinor: number;
  netMinor: number;
};

// Cumulative allocation preserves the original gross price and consumes every
// remaining cent on the last unit. Clamp net at the remaining gross/VAT bounds
// so tiny prices and 100% VAT cannot create a negative tax component.
export function returnAmounts(
  original: ReturnAmounts,
  returned: ReturnAmounts,
  quantity: number
) {
  for (const x of [
    original.quantity,
    original.grossMinor,
    original.netMinor,
    returned.quantity,
    returned.grossMinor,
    returned.netMinor,
    quantity,
  ]) {
    if (!Number.isSafeInteger(x) || x < 0)
      throw Error("İade tutarı veya adedi geçersiz.");
  }
  if (
    !original.quantity ||
    original.netMinor > original.grossMinor ||
    returned.quantity + quantity > original.quantity ||
    returned.netMinor > returned.grossMinor ||
    returned.grossMinor > original.grossMinor ||
    returned.netMinor > original.netMinor ||
    returned.grossMinor - returned.netMinor >
      original.grossMinor - original.netMinor
  ) {
    throw Error("İade kalan belge miktarını aşıyor.");
  }
  const round = (value: number, q: number) =>
    Number(
      (BigInt(value) * BigInt(q) + BigInt(original.quantity) / 2n) /
        BigInt(original.quantity)
    );
  if (returned.grossMinor !== round(original.grossMinor, returned.quantity))
    throw Error("Önceki iade dağılımı uyuşmuyor.");
  const grossMinor =
    round(original.grossMinor, returned.quantity + quantity) -
    returned.grossMinor;
  const remainingVat =
    original.grossMinor -
    original.netMinor -
    returned.grossMinor +
    returned.netMinor;
  const netMinor =
    quantity === 0
      ? 0
      : Math.min(
          grossMinor,
          Math.max(
            0,
            grossMinor - remainingVat,
            round(original.netMinor, returned.quantity + quantity) -
              returned.netMinor
          )
        );
  return { grossMinor, netMinor, vatMinor: grossMinor - netMinor };
}

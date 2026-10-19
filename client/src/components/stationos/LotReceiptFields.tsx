export type ReceiptLotInput = {
  code: string;
  expiryDate: string;
  quantity: string;
};
export const receiptLots = (quantity: string): ReceiptLotInput[] => [
  { code: "", expiryDate: "", quantity },
];
export const receiptLotPayload = (
  lots: ReceiptLotInput[],
  quantity: number
) => {
  const rows = lots.map(l => ({
    code: l.code,
    expiryDate: l.expiryDate,
    quantity: Number(l.quantity),
  }));
  if (
    rows.some(
      l =>
        !l.code.trim() ||
        !l.expiryDate ||
        !Number.isSafeInteger(l.quantity) ||
        l.quantity < 1
    ) ||
    rows.reduce((n, l) => n + l.quantity, 0) !== quantity
  )
    throw Error(
      "Parti kodu/SKT/adetlerini tamamlayın; toplamı ürün adedine eşit olmalı."
    );
  return rows;
};
export function LotReceiptFields({
  prefix,
  today,
  quantity,
  value,
  onChange,
}: {
  prefix: string;
  today: string;
  quantity: number;
  value: ReceiptLotInput[];
  onChange: (value: ReceiptLotInput[]) => void;
}) {
  const update = (i: number, field: keyof ReceiptLotInput, text: string) =>
    onChange(value.map((l, j) => (i === j ? { ...l, [field]: text } : l)));
  const total = value.reduce((n, l) => n + (Number(l.quantity) || 0), 0);
  return (
    <div className="mi-receipt-lots">
      <p>
        <b>Parti dağılımı</b> · Toplam {total}/{quantity} temel birim
      </p>
      {value.map((l, i) => (
        <div key={i} className="mi-lot-opening">
          <label>
            Parti kodu
            <input
              aria-label={`${prefix} parti kodu ${i + 1}`}
              maxLength={100}
              required
              value={l.code}
              onChange={e => update(i, "code", e.target.value)}
            />
          </label>
          <label>
            SKT
            <input
              aria-label={`${prefix} SKT ${i + 1}`}
              type="date"
              min={today}
              required
              value={l.expiryDate}
              onChange={e => update(i, "expiryDate", e.target.value)}
            />
          </label>
          <label>
            Parti adedi
            <input
              aria-label={`${prefix} parti adedi ${i + 1}`}
              type="number"
              min={1}
              max={10000}
              step={1}
              required
              value={l.quantity}
              onChange={e => update(i, "quantity", e.target.value)}
            />
          </label>
          <button
            className="btn"
            type="button"
            disabled={value.length <= 1}
            onClick={() => onChange(value.filter((_, j) => i !== j))}
          >
            Partiyi kaldır
          </button>
        </div>
      ))}
      <button
        className="btn"
        type="button"
        disabled={value.length >= 50}
        onClick={() =>
          onChange([...value, { code: "", expiryDate: "", quantity: "1" }])
        }
      >
        + Kabul partisi ekle
      </button>
      {total !== quantity && (
        <p className="ma-error">Parti toplamını ürün miktarıyla eşitleyin.</p>
      )}
    </div>
  );
}

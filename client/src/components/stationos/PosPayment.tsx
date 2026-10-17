import { useState, type RefObject } from "react";
import { money, parseMoney } from "@shared/station";

export function PosPayment({
  total,
  disabled,
  busy,
  cashInput,
  onPay,
}: {
  total: number;
  disabled: boolean;
  busy: boolean;
  cashInput: RefObject<HTMLInputElement | null>;
  onPay: (payload: Record<string, unknown>) => Promise<boolean>;
}) {
  const [kind, setKind] = useState<"CASH" | "CARD_MANUAL" | "MIXED">("CASH");
  const [cash, setCash] = useState("");
  const [tendered, setTendered] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState("");
  let cashPart = kind === "CASH" ? total : 0,
    received = 0;
  try {
    if (kind === "MIXED") cashPart = parseMoney(cash);
    received = parseMoney(tendered);
  } catch {
    /* Empty fields are validated on submit. */
  }
  const validSplit = kind !== "MIXED" || (cashPart > 0 && cashPart < total);
  const cardPart =
    kind === "CARD_MANUAL"
      ? total
      : kind === "MIXED" && validSplit
        ? total - cashPart
        : 0;
  return (
    <form
      className="pos-payment"
      aria-label="Ödeme"
      onSubmit={async e => {
        e.preventDefault();
        setError("");
        try {
          const payload: Record<string, unknown> = { paymentKind: kind };
          if (kind !== "CARD_MANUAL")
            payload.tenderedMinor = parseMoney(tendered);
          if (kind === "MIXED") payload.cashAmountMinor = parseMoney(cash);
          if (kind !== "CASH") payload.cardConfirmed = confirmed;
          await onPay(payload);
        } catch (e) {
          setError((e as Error).message);
        }
      }}
    >
      <div className="pos-payment-tabs" role="group" aria-label="Ödeme türü">
        {(
          [
            ["CASH", "Nakit"],
            ["CARD_MANUAL", "Kart"],
            ["MIXED", "Nakit + kart"],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            aria-pressed={kind === value}
            className={kind === value ? "selected" : ""}
            disabled={disabled}
            onClick={() => {
              setKind(value);
              setConfirmed(false);
              setError("");
            }}
          >
            {label}
          </button>
        ))}
      </div>
      {kind === "MIXED" && (
        <label>
          Nakit payı (TL)
          <input
            aria-label="Nakit payı (TL)"
            inputMode="decimal"
            required
            value={cash}
            onChange={e => {
              setCash(e.target.value);
              setConfirmed(false);
            }}
            disabled={disabled}
          />
          <small>
            Kalan kart:{" "}
            {validSplit ? money(cardPart) : "Geçerli bir nakit payı girin"}
          </small>
        </label>
      )}
      {kind !== "CARD_MANUAL" && (
        <>
          <label>
            Alınan nakit (TL)
            <input
              ref={cashInput}
              inputMode="decimal"
              required
              value={tendered}
              onChange={e => setTendered(e.target.value)}
              disabled={disabled}
              placeholder="0,00"
            />
          </label>
          <div className="pos-quick-cash">
            <button
              type="button"
              disabled={disabled || !validSplit}
              onClick={() =>
                setTendered((cashPart / 100).toFixed(2).replace(".", ","))
              }
            >
              Tam tutar
            </button>
            {[50, 100, 200, 500].map(t => (
              <button
                key={t}
                type="button"
                disabled={disabled}
                onClick={() => setTendered(String(t))}
              >
                {t} ₺
              </button>
            ))}
          </div>
          <div className="pos-change">
            <span>Para üstü</span>
            <strong>{money(Math.max(0, received - cashPart))}</strong>
          </div>
        </>
      )}
      {kind !== "CASH" && (
        <label className="pos-check">
          <input
            type="checkbox"
            checked={confirmed}
            onChange={e => setConfirmed(e.target.checked)}
            disabled={disabled}
          />
          Ayrı banka POS cihazında {money(cardPart)} tahsilatı teyit ettim. Bu
          kayıt kasiyer beyanıdır.
        </label>
      )}
      {error && (
        <p role="alert" className="pos-field-error">
          {error}
        </p>
      )}
      <button
        className="btn primary pos-pay"
        disabled={disabled || !validSplit || (kind !== "CASH" && !confirmed)}
      >
        {busy ? "Kaydediliyor…" : "DEMO satışı tamamla"}
      </button>
    </form>
  );
}

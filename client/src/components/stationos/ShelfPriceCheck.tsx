import { useRef, useState } from "react";
import { lookupShelfPrice } from "@/lib/station-api";
import { labelPrice } from "@shared/label-barcode";
import { parseMoney } from "@shared/station";
import type { ShelfItem } from "@shared/shelf-labels";
export function ShelfPriceCheck({
  stationId,
  locked,
  approved,
  action,
}: {
  stationId: string;
  locked: boolean;
  approved: boolean;
  action: (path: string, body: Record<string, unknown>) => Promise<boolean>;
}) {
  const [barcode, setBarcode] = useState(""),
    [data, setData] = useState<(ShelfItem & { barcode: string }) | null>(null),
    [observed, setObserved] = useState(""),
    [reason, setReason] = useState(""),
    [accepted, setAccepted] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const seq = useRef(0);
  return (
    <section className="ma-panel">
      <h2>Raf / kasa fiyat kontrolü</h2>
      <p>
        Ürünün ana veya adet barkodunu okutun; rafta gerçekten okuduğunuz fiyatı
        girin. Perakende baz fiyatıyla karşılaştırılır.
      </p>
      <form
        onSubmit={async e => {
          e.preventDefault();
          const id = ++seq.current;
          setBusy(true);
          setError("");
          setNotice("");
          setData(null);
          try {
            const next = await lookupShelfPrice(stationId, barcode.trim());
            if (id === seq.current) {
              setData(next);
              setObserved("");
              setReason("");
              setAccepted(false);
            }
          } catch (err) {
            if (id === seq.current) setError((err as Error).message);
          } finally {
            if (id === seq.current) setBusy(false);
          }
        }}
      >
        <fieldset disabled={locked || busy}>
          <label>
            Kontrol barkodu
            <input
              aria-label="Raf kontrol barkodu"
              value={barcode}
              onChange={e => {
                seq.current++;
                setBarcode(e.target.value);
                setData(null);
                setBusy(false);
                setNotice("");
              }}
              required
              autoComplete="off"
            />
          </label>
          <button className="btn">Raf fiyatını sorgula</button>
        </fieldset>
      </form>
      {error && (
        <p className="ma-error" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="notice" role="status">
          {notice}
        </p>
      )}
      {data && (
        <form
          onSubmit={async e => {
            e.preventDefault();
            setError("");
            setNotice("");
            try {
              const amount = parseMoney(observed);
              if (
                await action("shelf-check", {
                  barcode: data.barcode,
                  expectedHash: data.hash,
                  observedMinor: amount,
                  reason,
                  physicalChecked: accepted,
                })
              ) {
                setNotice(
                  amount === data.snapshot.priceMinor
                    ? "Okunan raf fiyatı kasa perakende fiyatıyla eşleşti."
                    : "Raf / kasa fiyat farkı kaydedildi; yetkili kontrolü gerekiyor."
                );
                setObserved("");
                setAccepted(false);
              }
            } catch (err) {
              setError((err as Error).message);
            }
          }}
        >
          <h3>{data.snapshot.name}</h3>
          <p>
            Kasa perakende fiyatı: <b>{labelPrice(data.snapshot.priceMinor)}</b>
            <br />
            Kaydedilmiş raf fiyatı:{" "}
            {data.installedPriceMinor === null
              ? "Teyit yok"
              : labelPrice(data.installedPriceMinor)}
            <br />
            {data.labelStatus === "CURRENT"
              ? "Raf etiketi kaydı güncel"
              : data.labelStatus === "CHANGED"
                ? "Raf etiketi değişmeli"
                : "Raf yerleştirme teyidi yok"}
          </p>
          {data.issue && <p className="notice warning">{data.issue}</p>}
          {!approved && (
            <p className="notice warning">
              Kontrol kaydı için cihazınızın yönetici tarafından onaylanması
              gerekir.
            </p>
          )}
          <fieldset disabled={locked || busy || !approved}>
            <label>
              Rafta okunan KDV dahil fiyat (TL)
              <input
                aria-label="Rafta okunan fiyat"
                inputMode="decimal"
                value={observed}
                onChange={e => setObserved(e.target.value)}
                required
              />
            </label>
            <label>
              Fiyat farkı varsa açıklama
              <input
                aria-label="Raf fiyat farkı açıklaması"
                value={reason}
                onChange={e => setReason(e.target.value)}
                maxLength={500}
              />
            </label>
            <label className="ma-check">
              <input
                type="checkbox"
                aria-label="Fizikî raf fiyatını kontrol ettim"
                checked={accepted}
                onChange={e => setAccepted(e.target.checked)}
                required
              />
              Fizikî raf fiyatını okuyup kontrol ettim.
            </label>
            <button className="btn primary">Raf fiyat kontrolünü kaydet</button>
          </fieldset>
          <p className="ma-hint">
            Bu işlem satış fiyatını, sepeti veya raf yerleştirme teyidini
            değiştirmez. Fiyat farkı yetkiliye kontrol kaydı olarak iletilir.
          </p>
        </form>
      )}
    </section>
  );
}

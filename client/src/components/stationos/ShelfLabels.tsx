import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { FileDown, Printer, RefreshCw } from "lucide-react";
import { newRequestId } from "@/lib/id";
import { loadShelfLabels, loadShelfBatch } from "@/lib/station-api";
import { labelBarcode, labelPrice } from "@shared/label-barcode";
import type { ShelfState, ShelfBatch } from "@shared/shelf-labels";
import { marketCsv } from "./MarketStatement";
import "./shelf-labels.css";
const statusNames = {
  UNRECORDED: "Raf teyidi yok",
  CHANGED: "Etiket değişmeli",
  CURRENT: "Kayıtlı etiket güncel",
};
export function ShelfLabels({
  stationId,
  refreshKey,
  locked,
  action,
}: {
  stationId: string;
  refreshKey: unknown;
  locked: boolean;
  action: (path: string, body: Record<string, unknown>) => Promise<boolean>;
}) {
  const [data, setData] = useState<ShelfState | null>(null),
    [batch, setBatch] = useState<ShelfBatch | null>(null),
    [selectedBatch, setSelectedBatch] = useState(""),
    [selected, setSelected] = useState<Record<string, number>>({}),
    [filter, setFilter] = useState("PENDING"),
    [query, setQuery] = useState(""),
    [label, setLabel] = useState("Raf fiyat güncellemesi"),
    [installIds, setInstallIds] = useState<string[]>([]),
    [reason, setReason] = useState(""),
    [placed, setPlaced] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [printNode, setPrintNode] = useState<HTMLDivElement | null>(null);
  const sequence = useRef(0),
    batchRef = useRef(selectedBatch);
  batchRef.current = selectedBatch;
  async function refresh(id = batchRef.current) {
    const seq = ++sequence.current;
    setBusy(true);
    try {
      const [state, packet] = await Promise.all([
        loadShelfLabels(stationId),
        id ? loadShelfBatch(stationId, id) : Promise.resolve(null),
      ]);
      if (seq === sequence.current) {
        setData(state);
        setBatch(packet);
        setError("");
      }
    } catch (e) {
      if (seq === sequence.current) setError((e as Error).message);
    } finally {
      if (seq === sequence.current) setBusy(false);
    }
  }
  useEffect(() => {
    void refresh();
    return () => {
      sequence.current++;
    };
  }, [stationId, refreshKey]);
  useEffect(() => {
    const node = document.createElement("div");
    node.id = "stationos-shelf-print-root";
    document.body.appendChild(node);
    setPrintNode(node);
    const done = () =>
      document.body.classList.remove("stationos-shelf-printing");
    window.addEventListener("afterprint", done);
    return () => {
      window.removeEventListener("afterprint", done);
      done();
      node.remove();
    };
  }, []);
  const disabled = locked || busy,
    filtered = (data?.items ?? []).filter(
      p =>
        (filter === "ALL" || p.labelStatus !== "CURRENT") &&
        `${p.snapshot.name} ${p.snapshot.barcode} ${p.snapshot.shelf}`
          .toLocaleLowerCase("tr-TR")
          .includes(query.toLocaleLowerCase("tr-TR"))
    ),
    chosen = (data?.items ?? []).filter(p =>
      Object.hasOwn(selected, p.snapshot.productId)
    ),
    copies = chosen.reduce((n, p) => n + selected[p.snapshot.productId], 0);
  async function open(id: string) {
    batchRef.current = id;
    setSelectedBatch(id);
    setInstallIds([]);
    setPlaced(false);
    setReason("");
    await refresh(id);
  }
  return (
    <section className="ma-panel">
      <div className="ma-panel-head">
        <div>
          <h2>Raf fiyatı ve etiketler</h2>
          <p>
            Perakende baz fiyatı · etiket paketi, yazdırma ve ayrı fizikî raf
            teyidi.
          </p>
        </div>
        <button
          className="btn"
          disabled={disabled}
          onClick={() => void refresh()}
        >
          <RefreshCw size={16} />
          Etiketleri yenile
        </button>
      </div>
      <p className="notice">
        Etiket paketi hazırlamak veya yazdırmak satış fiyatını ve raf teyidini
        değiştirmez. Yerleştirme, ilgili bütün raflardaki fizikî etiketler
        kontrol edildikten sonra ayrıca kaydedilir.
      </p>
      {error && (
        <p role="alert" className="ma-error">
          {error}
        </p>
      )}
      {busy && <p role="status">Etiketler yükleniyor…</p>}
      {data && (
        <>
          <div className="ma-wallet-grid">
            <div>
              <span>Raf teyidi bekleyen</span>
              <strong>
                {data.items.filter(p => p.labelStatus === "UNRECORDED").length}
              </strong>
            </div>
            <div>
              <span>Değişmiş etiket</span>
              <strong>
                {data.items.filter(p => p.labelStatus === "CHANGED").length}
              </strong>
            </div>
            <div>
              <span>Güncel kayıtlı etiket</span>
              <strong>
                {data.items.filter(p => p.labelStatus === "CURRENT").length}
              </strong>
            </div>
          </div>
          <div className="ma-form-grid">
            <label>
              Ürün / barkod / raf
              <input
                aria-label="Etiket ürünü ara"
                value={query}
                onChange={e => setQuery(e.target.value)}
              />
            </label>
            <label>
              Göster
              <select
                aria-label="Etiket durum filtresi"
                value={filter}
                onChange={e => setFilter(e.target.value)}
              >
                <option value="PENDING">Raf teyidi bekleyen / değişen</option>
                <option value="ALL">Bütün ürünler</option>
              </select>
            </label>
          </div>
          <div className="ma-table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Seç / kopya</th>
                  <th>Ürün / barkod / raf</th>
                  <th>Kasa perakende fiyatı</th>
                  <th>Rafa kaydedilmiş fiyat</th>
                  <th>Durum</th>
                </tr>
              </thead>
              <tbody>
                {filtered.slice(0, 100).map(p => (
                  <tr key={p.snapshot.productId}>
                    <td>
                      <label>
                        <input
                          type="checkbox"
                          aria-label={`${p.snapshot.name} etiket seç`}
                          checked={Object.hasOwn(
                            selected,
                            p.snapshot.productId
                          )}
                          disabled={
                            disabled ||
                            !!p.issue ||
                            (!Object.hasOwn(selected, p.snapshot.productId) &&
                              chosen.length >= 100)
                          }
                          onChange={e => {
                            const s = { ...selected };
                            if (e.target.checked) s[p.snapshot.productId] = 1;
                            else delete s[p.snapshot.productId];
                            setSelected(s);
                          }}
                        />
                        Etiket
                      </label>
                      {Object.hasOwn(selected, p.snapshot.productId) && (
                        <input
                          aria-label={`${p.snapshot.name} etiket kopyası`}
                          type="number"
                          min={1}
                          max={20}
                          value={selected[p.snapshot.productId]}
                          disabled={disabled}
                          onChange={e =>
                            setSelected({
                              ...selected,
                              [p.snapshot.productId]: Number(e.target.value),
                            })
                          }
                        />
                      )}
                    </td>
                    <td>
                      <b>{p.snapshot.name}</b>
                      <small>
                        {p.snapshot.barcode} ·{" "}
                        {p.snapshot.shelf || "Raf tanımsız"}
                      </small>
                    </td>
                    <td>
                      {labelPrice(p.snapshot.priceMinor)}
                      <small>
                        {p.snapshot.vatBps === null
                          ? "KDV tanımsız"
                          : `KDV %${p.snapshot.vatBps / 100}`}
                      </small>
                    </td>
                    <td>
                      {p.installedPriceMinor === null
                        ? "Teyit yok"
                        : labelPrice(p.installedPriceMinor)}
                      <small>
                        {p.installedAt ? `UTC ${p.installedAt}` : ""}
                      </small>
                    </td>
                    <td>
                      {statusNames[p.labelStatus]}
                      <small>{p.changedFields.join(", ")}</small>
                      {p.issue && <small className="ma-error">{p.issue}</small>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="ma-hint">
            İlk 100 eşleşme gösterilir. Bir pakette en fazla 100 ürün, ürün
            başına 20 ve toplam 500 etiket hazırlanabilir. Ana barkod
            kullanılır; özel fiyat listeleri bu perakende etiketine dahil
            değildir.
          </p>
          <label>
            Etiket paketi adı
            <input
              aria-label="Etiket paketi adı"
              value={label}
              maxLength={100}
              disabled={disabled}
              onChange={e => setLabel(e.target.value)}
            />
          </label>
          <p>
            {chosen.length} ürün · {copies} etiket
          </p>
          <button
            className="btn primary"
            disabled={
              disabled ||
              !chosen.length ||
              !label.trim() ||
              copies > 500 ||
              chosen.some(p => !!p.issue) ||
              chosen.some(
                p =>
                  !Number.isInteger(selected[p.snapshot.productId]) ||
                  selected[p.snapshot.productId] < 1 ||
                  selected[p.snapshot.productId] > 20
              )
            }
            onClick={async () => {
              const id = newRequestId();
              if (
                await action("/market-accounting/inventory/shelf-batch", {
                  batchId: id,
                  label,
                  items: chosen.map(p => ({
                    productId: p.snapshot.productId,
                    copies: selected[p.snapshot.productId],
                    expectedHash: p.hash,
                  })),
                })
              ) {
                setSelected({});
                await open(id);
              } else await refresh();
            }}
          >
            Seçili ürünlerden etiket paketi hazırla
          </button>
          <h3>Son 20 etiket paketi</h3>
          <div className="ma-table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Paket</th>
                  <th>Hazırlayan / UTC</th>
                  <th>İşlem</th>
                </tr>
              </thead>
              <tbody>
                {data.batches.map(b => (
                  <tr key={b.id}>
                    <td>{b.label}</td>
                    <td>
                      {b.createdBy}
                      <small>{b.createdAt}</small>
                    </td>
                    <td>
                      <button
                        className="btn"
                        disabled={disabled}
                        onClick={() => void open(b.id)}
                      >
                        Etiket paketini aç
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <h3>Son 50 raf fiyat kontrolü</h3>
          <div className="ma-table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Ürün / UTC</th>
                  <th>Okunan raf / kasa</th>
                  <th>Sonuç / kontrol eden</th>
                </tr>
              </thead>
              <tbody>
                {data.checks.map(c => (
                  <tr key={c.id}>
                    <td>
                      {c.productName}
                      <small>{c.createdAt}</small>
                    </td>
                    <td>
                      {labelPrice(c.observedMinor)} /{" "}
                      {labelPrice(c.expectedMinor)}
                    </td>
                    <td>
                      {c.matches ? "Fiyat eşleşti" : "Fiyat farkı"} ·{" "}
                      {c.actorName}
                      <small>{c.reason}</small>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
      {batch && (
        <section className="ma-panel" aria-label="Seçilen etiket paketi">
          <h3>{batch.label}</h3>
          <p>
            Hazırlayan {batch.createdBy} · UTC {batch.createdAt}
          </p>
          {batch.items.some(i => !i.isCurrent) && (
            <p className="notice warning">
              Paket hazırlandıktan sonra etiket bilgisi değişmiş. Eski paket
              yazdırılamaz; güncel ürünlerden yeni paket hazırlayın.
            </p>
          )}
          <div className="ma-row-actions">
            <button
              className="btn"
              disabled={disabled || batch.items.some(i => !i.isCurrent)}
              onClick={async () => {
                setBusy(true);
                setError("");
                try {
                  const fresh = await loadShelfBatch(stationId, batch.id);
                  setBatch(fresh);
                  if (fresh.items.some(i => !i.isCurrent)) {
                    setError(
                      "Etiket bilgisi değişti; eski paket yazdırılmadı. Yeni paket hazırlayın."
                    );
                    return;
                  }
                  requestAnimationFrame(() => {
                    document.body.classList.add("stationos-shelf-printing");
                    window.print();
                  });
                } catch (e) {
                  setError((e as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              <Printer size={16} />
              A4 etiketleri yazdır / PDF
            </button>
            <button
              className="btn"
              onClick={() =>
                marketCsv(`etiket-paketi-${batch.id}.csv`, [
                  [
                    "Ürün",
                    "Barkod",
                    "Raf",
                    "Satış birimi",
                    "Perakende TL",
                    "KDV %",
                    "Kopya",
                    "Güncel mi",
                    "Raf teyidi UTC",
                  ],
                  ...batch.items.map(i => [
                    i.snapshot.name,
                    i.snapshot.barcode,
                    i.snapshot.shelf,
                    i.snapshot.unit,
                    i.snapshot.priceMinor / 100,
                    i.snapshot.vatBps === null ? "" : i.snapshot.vatBps / 100,
                    i.copies,
                    i.isCurrent ? "Evet" : "Hayır",
                    i.installedAt ?? "",
                  ]),
                ])
              }
            >
              <FileDown size={16} />
              Etiket paketi CSV
            </button>
          </div>
          <div className="ma-table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Rafa teyit seçimi</th>
                  <th>Ürün / fiyat</th>
                  <th>Kopya / teyit</th>
                </tr>
              </thead>
              <tbody>
                {batch.items.map(i => (
                  <tr key={i.snapshot.productId}>
                    <td>
                      <input
                        type="checkbox"
                        aria-label={`${i.snapshot.name} rafa yerleştirildi`}
                        checked={installIds.includes(i.snapshot.productId)}
                        disabled={disabled || !i.isCurrent}
                        onChange={e =>
                          setInstallIds(
                            e.target.checked
                              ? [...installIds, i.snapshot.productId]
                              : installIds.filter(
                                  id => id !== i.snapshot.productId
                                )
                          )
                        }
                      />
                    </td>
                    <td>
                      {i.snapshot.name}
                      <small>
                        {i.snapshot.barcode} ·{" "}
                        {labelPrice(i.snapshot.priceMinor)}
                      </small>
                    </td>
                    <td>
                      {i.copies} kopya
                      <small>
                        {i.installedAt
                          ? `Teyit UTC ${i.installedAt}`
                          : "Yerleştirme teyidi yok"}
                      </small>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <form
            onSubmit={async e => {
              e.preventDefault();
              if (
                await action("/market-accounting/inventory/shelf-install", {
                  batchId: batch.id,
                  productIds: installIds,
                  placedAccepted: placed,
                  reason,
                })
              ) {
                setInstallIds([]);
                setPlaced(false);
                setReason("");
              }
              await refresh();
            }}
          >
            <fieldset disabled={disabled}>
              <label>
                Raf yerleştirme açıklaması
                <input
                  aria-label="Raf yerleştirme açıklaması"
                  value={reason}
                  onChange={e => setReason(e.target.value)}
                  required
                  minLength={5}
                  maxLength={500}
                />
              </label>
              <label className="ma-check">
                <input
                  type="checkbox"
                  aria-label="Bütün ilgili raf etiketlerini yerleştirdim"
                  checked={placed}
                  onChange={e => setPlaced(e.target.checked)}
                  required
                />
                Seçili ürünlerin ilgili bütün raf etiketlerini yerleştirip
                kontrol ettim.
              </label>
              <button
                className="btn primary"
                disabled={
                  !installIds.length ||
                  !placed ||
                  batch.items.some(
                    i =>
                      installIds.includes(i.snapshot.productId) && !i.isCurrent
                  )
                }
              >
                Seçili raf etiketlerini teyit et
              </button>
            </fieldset>
          </form>
          <p className="ma-hint">
            Yazdırma veya fizikî yerleştirme donanımla doğrulanmaz; bu kayıt
            operatörün teyididir. Çıktı satış birimi/perakende fiyat kontrolü
            içindir; menşe, gramajdan kg/lt fiyatı ve ürün grubuna özel zorunlu
            etiket alanları bu şablonda üretilmez.
          </p>
        </section>
      )}
      {batch &&
        printNode &&
        createPortal(<PrintSheet batch={batch} />, printNode)}
    </section>
  );
}
function PrintSheet({ batch }: { batch: ShelfBatch }) {
  return (
    <div className="shelf-print-sheet">
      {batch.items.flatMap(i =>
        Array.from({ length: i.copies }, (_, copy) => {
          const s = i.snapshot,
            code = labelBarcode(s.barcode),
            price = labelPrice(s.priceMinor),
            date = new Date(
              s.priceRecordedAt.replace(" ", "T") + "Z"
            ).toLocaleDateString("tr-TR", { timeZone: "Europe/Istanbul" });
          return (
            <article
              key={s.productId + ":" + copy}
              className="shelf-paper-label"
            >
              <div className="shelf-paper-name">{s.name}</div>
              <div
                className="shelf-paper-price"
                style={{
                  fontSize:
                    price.length > 18
                      ? "11pt"
                      : price.length > 12
                        ? "16pt"
                        : "21pt",
                }}
              >
                {price}
              </div>
              <div className="shelf-paper-meta">
                KDV %{(s.vatBps ?? 0) / 100} · Satış birimi: {s.unit}
              </div>
              <svg
                role="img"
                aria-label={`Barkod ${s.barcode}`}
                viewBox={`0 0 ${code.width} 40`}
                preserveAspectRatio="none"
              >
                <rect width={code.width} height="40" fill="white" />
                {code.bars.map((b, n) => (
                  <rect
                    key={n}
                    x={b.x}
                    y={0}
                    width={b.width}
                    height={40}
                    fill="black"
                  />
                ))}
              </svg>
              <div className="shelf-paper-code">{s.barcode}</div>
              <div className="shelf-paper-meta">
                {s.shelf || "Raf —"} · Fiyat kaydı: {date}
              </div>
            </article>
          );
        })
      )}
    </div>
  );
}

import { useEffect, useRef, useState } from "react";
import { FileDown, RefreshCw } from "lucide-react";
import { money } from "@shared/station";
import type { CountReportPage, CountReportDetail } from "@shared/count-report";
import { loadCountReports, loadCountReport } from "@/lib/station-api";
import { marketCsv } from "./MarketStatement";
export function CountReports({
  stationId,
  today,
}: {
  stationId: string;
  today: string;
}) {
  const [from, setFrom] = useState(today.slice(0, 7) + "-01"),
    [to, setTo] = useState(today),
    [stack, setStack] = useState([""]),
    [page, setPage] = useState<CountReportPage | null>(null),
    [pageKey, setPageKey] = useState(""),
    [loading, setLoading] = useState(false),
    [error, setError] = useState(""),
    [selected, setSelected] = useState(""),
    [detail, setDetail] = useState<CountReportDetail | null>(null),
    [detailLoading, setDetailLoading] = useState(false),
    [detailError, setDetailError] = useState("");
  const sequence = useRef(0),
    detailSequence = useRef(0),
    cursor = stack.at(-1)!,
    key = JSON.stringify([stationId, from, to, cursor]);
  function clearDetail() {
    detailSequence.current++;
    setSelected("");
    setDetail(null);
    setDetailError("");
    setDetailLoading(false);
  }
  async function refresh() {
    const seq = ++sequence.current;
    setLoading(true);
    setError("");
    clearDetail();
    try {
      const next = await loadCountReports(stationId, from, to, cursor);
      if (seq === sequence.current) {
        setPage(next);
        setPageKey(key);
      }
    } catch (e) {
      if (seq === sequence.current) {
        setError((e as Error).message);
        setPage(null);
      }
    } finally {
      if (seq === sequence.current) setLoading(false);
    }
  }
  async function inspect(id: string) {
    const seq = ++detailSequence.current;
    setSelected(id);
    setDetail(null);
    setDetailLoading(true);
    setDetailError("");
    try {
      const next = await loadCountReport(stationId, id);
      if (seq === detailSequence.current) setDetail(next);
    } catch (e) {
      if (seq === detailSequence.current) setDetailError((e as Error).message);
    } finally {
      if (seq === detailSequence.current) setDetailLoading(false);
    }
  }
  useEffect(() => {
    void refresh();
    return () => {
      sequence.current++;
      detailSequence.current++;
    };
  }, [key]);
  const visible = !loading && pageKey === key ? page : null;
  function range(change: () => void) {
    sequence.current++;
    clearDetail();
    setStack([""]);
    change();
  }
  return (
    <section className="ma-panel">
      <div className="ma-panel-head">
        <div>
          <h2>Onaylanmış sayım raporları</h2>
          <p>
            El terminalinden deftere işlenen sayımların tarihli adet ve net
            maliyet farkları.
          </p>
        </div>
        <button
          className="btn"
          disabled={loading}
          onClick={() => void refresh()}
        >
          <RefreshCw size={16} />
          Sayım raporlarını yenile
        </button>
      </div>
      <div className="ma-form-grid">
        <label>
          Başlangıç tarihi
          <input
            aria-label="Sayım raporu başlangıç"
            type="date"
            value={from}
            onChange={e => range(() => setFrom(e.target.value))}
          />
        </label>
        <label>
          Bitiş tarihi
          <input
            aria-label="Sayım raporu bitiş"
            type="date"
            value={to}
            onChange={e => range(() => setTo(e.target.value))}
          />
        </label>
      </div>
      <p className="ma-hint">
        En fazla 366 gün seçilebilir. Dönem toplamları bütün seçili aralığı,
        tablo ve liste CSV'si bu sayfadaki en fazla 50 onayı kapsar. Masaüstü
        Lot ve SKT ekranındaki tek parti sayımları/fire bu terminal raporuna
        dahil değildir.
      </p>
      {loading && <p role="status">Sayım raporları yükleniyor…</p>}
      {error && (
        <p className="ma-error" role="alert">
          {error}
        </p>
      )}
      {visible && (
        <>
          <div className="ma-wallet-grid">
            <div>
              <span>Dönem sayım adedi</span>
              <strong>{visible.totals.reports}</strong>
            </div>
            <div>
              <span>Dönem stok fazlası · net</span>
              <strong>{money(visible.totals.gainMinor)}</strong>
            </div>
            <div>
              <span>Dönem stok eksiği · net</span>
              <strong>{money(visible.totals.lossMinor)}</strong>
            </div>
            <div>
              <span>Dönem net stok etkisi</span>
              <strong>{money(visible.totals.netMinor)}</strong>
            </div>
          </div>
          <button
            className="btn"
            disabled={!visible.rows.length}
            onClick={() =>
              marketCsv(`sayim-listesi-${from}-${to}.csv`, [
                [
                  "İşlem tarihi TR",
                  "Kayıt zamanı UTC",
                  "Sayım adı",
                  "Fiş ID",
                  "Onaylayan ID",
                  "Onaylayan",
                  "Açıklama",
                  "Fazla net TL",
                  "Eksik net TL",
                  "Net etki TL",
                ],
                ...visible.rows.map(r => [
                  r.date,
                  r.postedAt,
                  r.label,
                  r.id,
                  r.approvedBy.id,
                  r.approvedBy.name,
                  r.reason,
                  r.gainMinor / 100,
                  r.lossMinor / 100,
                  r.netMinor / 100,
                ]),
              ])
            }
          >
            <FileDown size={16} />
            Bu sayfayı CSV indir
          </button>
          <div className="ma-table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Sayım / tarih</th>
                  <th>Onaylayan</th>
                  <th>Fazla / eksik net</th>
                  <th>Net etki</th>
                  <th>Rapor</th>
                </tr>
              </thead>
              <tbody>
                {visible.rows.map(r => (
                  <tr key={r.id}>
                    <td>
                      <b>{r.label}</b>
                      <small>
                        {r.date} · UTC {r.postedAt}
                      </small>
                      <small>{r.reason}</small>
                    </td>
                    <td>
                      {r.approvedBy.name}
                      <small>#{r.approvedBy.id}</small>
                    </td>
                    <td>
                      {money(r.gainMinor)} / {money(r.lossMinor)}
                    </td>
                    <td>{money(r.netMinor)}</td>
                    <td>
                      <button
                        className="btn"
                        aria-pressed={selected === r.id}
                        onClick={() => void inspect(r.id)}
                      >
                        Sayım ayrıntısı
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!visible.rows.length && (
            <p>Bu aralıkta onaylanmış terminal sayımı yok.</p>
          )}
          <div className="ma-row-actions">
            <button
              className="btn"
              disabled={stack.length < 2}
              onClick={() => {
                clearDetail();
                setStack(stack.slice(0, -1));
              }}
            >
              Önceki sayım sayfası
            </button>
            <span>Sayfa {stack.length} · Onay kayıt sırası</span>
            <button
              className="btn"
              disabled={!visible.nextCursor}
              onClick={() => {
                clearDetail();
                setStack([...stack, visible.nextCursor!]);
              }}
            >
              Sonraki sayım sayfası
            </button>
          </div>
        </>
      )}
      {detailLoading && <p role="status">Sayım ayrıntısı yükleniyor…</p>}
      {detailError && (
        <p className="ma-error" role="alert">
          {detailError}
        </p>
      )}
      {detail && detail.id === selected && (
        <section className="ma-panel" aria-label="Seçilen sayım raporu">
          <h3>
            {detail.label} · {detail.date}
          </h3>
          <p>{detail.reason}</p>
          <p>
            Onay: {detail.approvedBy.name} · #{detail.approvedBy.id}
            <br />
            Fiş: {detail.id}
            <br />
            Onay cihazı: {detail.approvedDeviceId ?? "Eski kayıtta yok"}
          </p>
          <p className="notice">
            Adetler ve tutarlar onay kaydından alınır; bugünkü stokla yeniden
            hesaplanmaz. Parti satırlarında adet gösterilir, maliyetler ürün
            toplamındadır.
          </p>
          {detail.items.some(i => i.labelSource !== "SNAPSHOT") && (
            <p className="notice warning">
              Eski kayıtta ürün etiketi saklanmamış: işaretli satırlarda güncel
              kart bilgisi veya ürün kimliği gösteriliyor. Tarihli adet ve
              tutarlar korunur.
            </p>
          )}
          <button
            className="btn"
            onClick={() =>
              marketCsv(`sayim-raporu-${detail.id}.csv`, [
                [
                  "Satır türü",
                  "Fiş ID",
                  "İşlem tarihi TR",
                  "Ürün ID",
                  "Ürün",
                  "Barkod",
                  "Etiket kaynağı",
                  "Birim",
                  "Parti ID",
                  "Parti",
                  "SKT",
                  "Parti durumu",
                  "Önceki adet",
                  "Sonraki adet",
                  "Fark adet",
                  "Fazla net TL",
                  "Eksik net TL",
                  "Net etki TL",
                  "Sayan ID",
                  "Sayan",
                  "Sayım cihazı",
                  "Onaylayan ID",
                  "Onaylayan",
                ],
                ...detail.items.flatMap(i => [
                  [
                    "Ürün",
                    detail.id,
                    detail.date,
                    i.productId,
                    i.name,
                    i.barcode,
                    i.labelSource,
                    i.unit,
                    "",
                    "",
                    "",
                    "",
                    i.before,
                    i.after,
                    i.delta,
                    i.gainMinor / 100,
                    i.lossMinor / 100,
                    i.netMinor / 100,
                    i.countedBy?.id ?? "",
                    i.countedBy?.name ?? "",
                    i.deviceId ?? "",
                    detail.approvedBy.id,
                    detail.approvedBy.name,
                  ],
                  ...i.lots.map(l => [
                    "Parti",
                    detail.id,
                    detail.date,
                    i.productId,
                    i.name,
                    i.barcode,
                    i.labelSource,
                    i.unit,
                    l.id,
                    l.code,
                    l.expiryDate ?? "",
                    l.status,
                    l.before,
                    l.after,
                    l.delta,
                    "",
                    "",
                    "",
                    l.countedBy?.id ?? "",
                    l.countedBy?.name ?? "",
                    l.deviceId ?? "",
                    detail.approvedBy.id,
                    detail.approvedBy.name,
                  ]),
                ]),
              ])
            }
          >
            <FileDown size={16} />
            Seçilen sayımı CSV indir
          </button>
          <div className="ma-table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Ürün / barkod</th>
                  <th>Adet önce / sonra / fark</th>
                  <th>Fazla / eksik net</th>
                  <th>Sayan</th>
                </tr>
              </thead>
              <tbody>
                {detail.items.map(i => (
                  <tr key={i.productId}>
                    <td>
                      <b>{i.name}</b>
                      <small>
                        {i.barcode} · {i.unit}
                      </small>
                      <small>
                        {i.labelSource === "SNAPSHOT"
                          ? "Onay anındaki kart"
                          : i.labelSource === "CURRENT_CARD"
                            ? "Güncel kart etiketi"
                            : "Yalnız kayıtlı kimlik"}
                      </small>
                      {i.lots.length > 0 && (
                        <details>
                          <summary>Parti farkları ({i.lots.length})</summary>
                          {i.lots.map(l => (
                            <p key={l.id}>
                              <b>{l.code}</b> · SKT{" "}
                              {l.expiryDate ?? "bilinmiyor"} ·{" "}
                              {l.status === "QUARANTINE"
                                ? "Karantina"
                                : "Satışa açık"}
                              <br />
                              {l.before} → {l.after} · Fark {l.delta}
                              <br />
                              Sayan: {l.countedBy?.name ?? "Eski kayıtta yok"}
                            </p>
                          ))}
                        </details>
                      )}
                    </td>
                    <td>
                      {i.before} / {i.after} / {i.delta}
                    </td>
                    <td>
                      {money(i.gainMinor)} / {money(i.lossMinor)}
                    </td>
                    <td>
                      {i.countedBy?.name ?? "Eski kayıtta yok"}
                      <small>{i.deviceId ?? ""}</small>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p>
            <b>Sayım toplamı:</b> Fazla {money(detail.gainMinor)} · Eksik{" "}
            {money(detail.lossMinor)} · Net {money(detail.netMinor)}
          </p>
        </section>
      )}
    </section>
  );
}

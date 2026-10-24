import { useEffect, useState } from "react";
import { money } from "@shared/station";
import type {
  CancellationReport,
  CancellationRow,
  ReportOptions,
} from "@shared/market-reports";
import { loadCancellations } from "@/lib/station-api";
import { marketCsv } from "./MarketStatement";
export function CancellationReports({
  stationId,
  today,
  options,
}: {
  stationId: string;
  today: string;
  options: ReportOptions;
}) {
  const [from, setFrom] = useState(today),
    [to, setTo] = useState(today),
    [registerId, setRegisterId] = useState(""),
    [userId, setUserId] = useState("");
  const [query, setQuery] = useState({
      from: today,
      to: today,
      registerId: "",
      userId: "",
      asOf: "",
      cursor: "",
    }),
    [data, setData] = useState<CancellationReport | null>(null),
    [error, setError] = useState(""),
    [selected, setSelected] = useState<CancellationRow | null>(null);
  useEffect(() => {
    let active = true;
    setData(null);
    setError("");
    setSelected(null);
    loadCancellations(
      stationId,
      query.from,
      query.to,
      query,
      query.asOf,
      query.cursor
    )
      .then(d => {
        if (active) setData(d);
      })
      .catch(e => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [stationId, query]);
  return (
    <section className="ma-panel">
      <h2>Sepet iptal denetimi</h2>
      <p>
        Satış öncesi adet/satır azaltma ve bütün sepet iptalleri. İptal edilen
        sepet tutarı gerçekleşmiş ciro, kesin satış kaybı veya stok hareketi
        değildir. Satış sonrası iadeler satış raporunda ayrı izlenir.
      </p>
      <form
        className="mr-filters"
        onSubmit={e => {
          e.preventDefault();
          setQuery({ from, to, registerId, userId, asOf: "", cursor: "" });
        }}
      >
        <label>
          Başlangıç
          <input
            aria-label="İptal başlangıç"
            type="date"
            value={from}
            onChange={e => setFrom(e.target.value)}
            required
          />
        </label>
        <label>
          Bitiş
          <input
            aria-label="İptal bitiş"
            type="date"
            value={to}
            onChange={e => setTo(e.target.value)}
            required
          />
        </label>
        <label>
          Kasa
          <select
            aria-label="İptal kasa filtresi"
            value={registerId}
            onChange={e => setRegisterId(e.target.value)}
          >
            <option value="">Bütün kasalar</option>
            {options.registers.map(o => (
              <option value={o.id} key={o.id}>
                {o.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          İptali yapan
          <select
            aria-label="İptali yapan filtresi"
            value={userId}
            onChange={e => setUserId(e.target.value)}
          >
            <option value="">Bütün işlem kullanıcıları</option>
            {options.users.map(o => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>
        </label>
        <button className="btn primary">İptal raporunu getir / yenile</button>
      </form>
      {error && (
        <p role="alert" className="ma-error">
          {error}
        </p>
      )}
      {!data && !error && <p role="status">İptal raporu yükleniyor…</p>}
      {data && (
        <>
          <p>
            {data.from}–{data.to} · Uygulanan kasa:{" "}
            {options.registers.find(o => o.id === data.filters.registerId)
              ?.name ??
              (data.filters.registerId || "Bütün kasalar")}{" "}
            · İptali yapan:{" "}
            {options.users.find(o => o.id === data.filters.userId)?.name ??
              (data.filters.userId || "Bütün kullanıcılar")}
          </p>
          <div className="ma-wallet-grid">
            <div>
              <span>İptal/azaltma olayı</span>
              <strong>{data.totals.events}</strong>
            </div>
            <div>
              <span>Adet / satır azaltma</span>
              <strong>{data.totals.reductions}</strong>
            </div>
            <div>
              <span>Bütün sepet iptali</span>
              <strong>{data.totals.cancellations}</strong>
            </div>
            <div>
              <span>Sepetten çıkarılan kayıtlı tutar</span>
              <strong>{money(data.totals.removedMinor)}</strong>
            </div>
          </div>
          <p className="ma-hint">
            Toplamlar bütün filtreli döneme aittir. En fazla 5.000 olay;
            aşılırsa aralığı daraltın. Tablo/CSV 50 olaylık bu sayfadır. Sınır:{" "}
            {data.asOf}; yeni olaylar için yenileyin. Kişi/kasa adları
            günceldir. Gösterilen saat İstanbul saatidir.
          </p>
          <button
            className="btn"
            onClick={() =>
              marketCsv(`sepet-iptal-${data.from}-${data.to}-sayfa.csv`, [
                [
                  "Dönem",
                  data.from,
                  data.to,
                  "Kayıt sınırı",
                  data.asOf,
                  "Kasa ID",
                  data.filters.registerId,
                  "İptal kullanıcı ID",
                  data.filters.userId,
                ],
                [
                  "Olay ID",
                  "Zaman UTC",
                  "Sepet ID",
                  "Kasa güncel ad",
                  "İptali yapan güncel ad",
                  "İşlem",
                  "Açıklama",
                  "Çıkarılan tutar kuruş",
                ],
                ...data.rows.map(r => [
                  r.id,
                  r.date,
                  r.cartId,
                  r.registerName,
                  r.actorName,
                  r.action,
                  r.reason,
                  r.removedMinor,
                ]),
              ])
            }
          >
            Bu iptal sayfasını CSV indir
          </button>
          <div className="ma-table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Zaman / işlem</th>
                  <th>Kasa / kişi</th>
                  <th>Açıklama</th>
                  <th>Çıkarılan tutar</th>
                  <th>Ayrıntı</th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map(r => (
                  <tr key={r.id}>
                    <td>
                      {new Date(r.date.replace(" ", "T") + "Z").toLocaleString(
                        "tr-TR",
                        { timeZone: "Europe/Istanbul" }
                      )}
                      <small>
                        {r.action === "CANCEL"
                          ? "Bütün sepet"
                          : "Adet / satır azaltma"}
                      </small>
                    </td>
                    <td>
                      {r.registerName}
                      <small>{r.actorName}</small>
                    </td>
                    <td>{r.reason ?? "Kayıtta açıklama yok"}</td>
                    <td>{money(r.removedMinor)}</td>
                    <td>
                      <button
                        className="btn"
                        aria-label={`İptal ${r.id} ayrıntısı`}
                        onClick={() => setSelected(r)}
                      >
                        İptali incele
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!data.rows.length && <p>Bu kapsamda iptal olayı yok.</p>}
          <div className="ma-row-actions">
            <button
              className="btn"
              disabled={!query.cursor}
              onClick={() =>
                setQuery({ ...query, asOf: data.asOf, cursor: "" })
              }
            >
              İlk iptal sayfası
            </button>
            <button
              className="btn"
              disabled={!data.nextCursor}
              onClick={() =>
                setQuery({
                  ...query,
                  asOf: data.asOf,
                  cursor: data.nextCursor!,
                })
              }
            >
              Sonraki iptaller
            </button>
          </div>
          {selected && (
            <section aria-label="Seçilen iptal olayı">
              <h3>İptal olay ayrıntısı</h3>
              <p>
                Olay: {selected.id} · Sepet: {selected.cartId} · Sepet sürümü:{" "}
                {selected.version} · Cihaz: {selected.deviceId}
              </p>
              <p>{selected.reason}</p>
              <div className="ma-table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Olay anındaki ürün / barkod</th>
                      <th>Önce / sonra miktar</th>
                      <th>Çıkarılan miktar</th>
                      <th>Kayıtlı birim fiyat</th>
                      <th>Çıkarılan tutar</th>
                    </tr>
                  </thead>
                  <tbody>
                    {selected.lines.map(l => (
                      <tr key={l.productId}>
                        <td>
                          {l.name}
                          <small>{l.barcode}</small>
                        </td>
                        <td>
                          {l.beforeQty} / {l.afterQty}
                        </td>
                        <td>{l.removedQty}</td>
                        <td>{money(l.unitPriceMinor)}</td>
                        <td>{money(l.removedMinor)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {!selected.lines.length && (
                <p>Boş sepet iptali; çıkarılan ürün yok.</p>
              )}
              <button className="btn" onClick={() => setSelected(null)}>
                İptal ayrıntısını kapat
              </button>
            </section>
          )}
        </>
      )}
    </section>
  );
}

import { useEffect, useState } from "react";
import { money } from "@shared/station";
import type { SalesAnalysis as Analysis } from "@shared/sales-analysis";
import type { ReportOptions } from "@shared/market-reports";
import { loadSalesAnalysis } from "@/lib/station-api";
import { marketCsv } from "./MarketStatement";
const hours = (h: number) =>
  `${String(h).padStart(2, "0")}:00–${String(h + 1).padStart(2, "0")}:00`;
export function SalesAnalysis({
  stationId,
  today,
  options,
}: {
  stationId: string;
  today: string;
  options: ReportOptions;
}) {
  const [from, setFrom] = useState(today.slice(0, 7) + "-01"),
    [to, setTo] = useState(today),
    [registerId, setRegisterId] = useState(""),
    [userId, setUserId] = useState("");
  const [q, setQ] = useState({ from, to, registerId: "", userId: "" }),
    [data, setData] = useState<Analysis | null>(null),
    [error, setError] = useState(""),
    [search, setSearch] = useState(""),
    [page, setPage] = useState(0),
    [hour, setHour] = useState<number | null>(null);
  useEffect(() => {
    let active = true;
    setData(null);
    setError("");
    setPage(0);
    setHour(null);
    loadSalesAnalysis(stationId, q.from, q.to, q)
      .then(d => {
        if (active) setData(d);
      })
      .catch(e => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [stationId, q]);
  const categories =
      data?.categories.filter(c =>
        c.label
          .toLocaleLowerCase("tr-TR")
          .includes(search.toLocaleLowerCase("tr-TR"))
      ) ?? [],
    visible = categories.slice(page * 50, (page + 1) * 50),
    selected = hour === null ? null : data?.hours[hour],
    max = Math.max(1, ...(data?.hours.map(h => h.salesGrossMinor) ?? []));
  const scope = data
    ? [
        "Dönem",
        data.from,
        data.to,
        "Kayıt sınırı",
        data.asOf,
        "Kasa ID",
        data.filters.registerId,
        "Satış kullanıcı ID",
        data.filters.userId,
      ]
    : [];
  return (
    <section className="ma-panel">
      <h2>Kategori ve saatlik satış analizi</h2>
      <p>
        Satış anındaki kategori ve maliyet; saatler Europe/Istanbul. Genel
        giderler kategori veya saate dağıtılmaz.
      </p>
      <form
        className="mr-filters"
        onSubmit={e => {
          e.preventDefault();
          setQ({ from, to, registerId, userId });
        }}
      >
        <label>
          Başlangıç
          <input
            aria-label="Analiz başlangıç"
            type="date"
            value={from}
            onChange={e => setFrom(e.target.value)}
            required
          />
        </label>
        <label>
          Bitiş
          <input
            aria-label="Analiz bitiş"
            type="date"
            value={to}
            onChange={e => setTo(e.target.value)}
            required
          />
        </label>
        <label>
          Kasa
          <select
            aria-label="Analiz kasa filtresi"
            value={registerId}
            onChange={e => setRegisterId(e.target.value)}
          >
            <option value="">Bütün kasalar</option>
            {options.registers.map(o => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Satışı yapan
          <select
            aria-label="Analiz kasiyer filtresi"
            value={userId}
            onChange={e => setUserId(e.target.value)}
          >
            <option value="">Bütün satış kullanıcıları</option>
            {options.users.map(o => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>
        </label>
        <button className="btn primary">
          Kategori/saat analizini getir / yenile
        </button>
      </form>
      {error && (
        <p role="alert" className="ma-error">
          {error}
        </p>
      )}
      {!data && !error && (
        <p role="status">Kategori/saat analizi yükleniyor…</p>
      )}
      {data && (
        <>
          <p>
            {data.from}–{data.to} · Uygulanan kasa:{" "}
            {options.registers.find(o => o.id === data.filters.registerId)
              ?.name ??
              (data.filters.registerId || "Bütün kasalar")}{" "}
            · Satışı yapan:{" "}
            {options.users.find(o => o.id === data.filters.userId)?.name ??
              (data.filters.userId || "Bütün kullanıcılar")}
          </p>
          <p className="ma-hint">
            Üretim{" "}
            {new Date(data.generatedAt).toLocaleString("tr-TR", {
              timeZone: "Europe/Istanbul",
            })}{" "}
            · Kayıt sınırı {data.asOf}. Yeni satış ve iadeler için yenileyin.
            Tarih kapsamı mali iş günüdür; saat dilimi işlem kayıt anına aittir.
          </p>
          <div className="ma-wallet-grid">
            {[
              ["Satış · KDV dahil", data.totals.salesGrossMinor],
              ["İade · KDV dahil", data.totals.returnsGrossMinor],
              ["İade sonrası net ciro", data.totals.netGrossMinor],
              ["Net satış · KDV hariç", data.totals.netSalesMinor],
              ["Satış maliyeti · iade sonrası", data.totals.cogsMinor],
              ["Brüt kâr · iade sonrası", data.totals.grossProfitMinor],
            ].map(([l, v]) => (
              <div key={String(l)}>
                <span>{l}</span>
                <strong>{money(Number(v))}</strong>
              </div>
            ))}
          </div>
          <p>
            {data.totals.saleCount} satış fişi · {data.totals.returnCount} iade
            belgesi · Ortalama satış fişi {money(data.totals.averageSaleMinor)}
          </p>
          <h3>Satış anındaki kategori dağılımı</h3>
          <p className="ma-hint">
            Geçmiş kategori kaydı yok ayrı tutulur; bugünkü karttan tahmin
            edilmez. Boş kategori satış anında kategorisizdir. İadeler özgün
            satış kategorisini kullanır ve iade gününde düşülür. Aynı fiş birden
            çok kategoride bulunabilir; kategori fiş adetlerini birbirine
            eklemeyin.
          </p>
          {data.categories.some(c => c.source === "LEGACY_UNKNOWN") && (
            <p className="notice">
              Bu dönemde kategori geçmişi kaydedilmemiş eski satış/iadeler var.
              Bu tutar ayrı satırdadır; kategori bazında tam geçmiş dağılımı
              çıkarılamaz.
            </p>
          )}
          <label>
            Kategori tablosunda ara
            <input
              aria-label="Kategori tablosunda ara"
              value={search}
              maxLength={100}
              onChange={e => {
                setSearch(e.target.value);
                setPage(0);
              }}
            />
          </label>
          <p className="ma-hint">
            Kategori araması yalnız bu tabloyu/CSV sayfasını daraltır; üst
            toplamları ve saat grafiğini değiştirmez.
          </p>
          <button
            className="btn"
            onClick={() =>
              marketCsv(`kategori-satis-${data.from}-${data.to}-sayfa.csv`, [
                [...scope, "Kategori araması", search],
                [
                  "Kategori",
                  "Kaynak",
                  "Satış fişi",
                  "İade belgesi",
                  "Satış KDV dahil kuruş",
                  "İade KDV dahil kuruş",
                  "İade sonrası net satış kuruş",
                  "İade sonrası maliyet kuruş",
                  "Brüt kâr kuruş",
                ],
                ...visible.map(c => [
                  c.label,
                  c.source,
                  c.saleCount,
                  c.returnCount,
                  c.salesGrossMinor,
                  c.returnsGrossMinor,
                  c.netSalesMinor,
                  c.cogsMinor,
                  c.grossProfitMinor,
                ]),
              ])
            }
          >
            Bu kategori sayfasını CSV indir
          </button>
          <div className="ma-table-wrap">
            <table aria-label="Kategori satış tablosu">
              <thead>
                <tr>
                  <th>Kategori · satış anı</th>
                  <th>Satış / iade fişi</th>
                  <th>Satış / iade · KDV dahil</th>
                  <th>Net satış</th>
                  <th>Maliyet</th>
                  <th>Brüt kâr</th>
                </tr>
              </thead>
              <tbody>
                {visible.map(c => (
                  <tr key={JSON.stringify(c.category)}>
                    <td>
                      {c.label}
                      <small>
                        {c.source === "LEGACY_UNKNOWN"
                          ? "Kategori snapshotı eksik"
                          : "Satış snapshotı"}
                      </small>
                    </td>
                    <td>
                      {c.saleCount} / {c.returnCount}
                    </td>
                    <td>
                      {money(c.salesGrossMinor)} / {money(c.returnsGrossMinor)}
                    </td>
                    <td>{money(c.netSalesMinor)}</td>
                    <td>{money(c.cogsMinor)}</td>
                    <td>{money(c.grossProfitMinor)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!visible.length && <p>Bu kapsamda kategori satırı yok.</p>}
          <div className="ma-row-actions">
            <button
              className="btn"
              disabled={page === 0}
              onClick={() => setPage(page - 1)}
            >
              Önceki kategori sayfası
            </button>
            <span>
              {categories.length} eşleşen kategori · Sayfa {page + 1}
            </span>
            <button
              className="btn"
              disabled={(page + 1) * 50 >= categories.length}
              onClick={() => setPage(page + 1)}
            >
              Sonraki kategori sayfası
            </button>
          </div>
          <h3>İstanbul saatine göre satış yoğunluğu</h3>
          <p className="ma-hint">
            Saati seçerek ayrıntıyı görebilirsiniz. Grafik satışların KDV dahil
            tutarıdır; iadeler aşağıda ayrı gösterilir. Seçilen bütün günlerin
            aynı yerel saati birlikte toplanır. Ortalama fiş iadeler düşülmeden
            satış toplamı / satış fişi sayısıdır.
          </p>
          <svg
            className="mr-hour-chart"
            viewBox="0 0 720 175"
            style={{ width: "100%", minHeight: 160 }}
            role="group"
            aria-label="İstanbul saatine göre satış grafiği"
          >
            {data.hours.map(h => {
              const height = (h.salesGrossMinor / max) * 115,
                x = 12 + h.hour * 29;
              return (
                <g
                  key={h.hour}
                  tabIndex={0}
                  role="button"
                  aria-label={`${hours(h.hour)} satış ${money(h.salesGrossMinor)}`}
                  aria-pressed={hour === h.hour}
                  onClick={() => setHour(h.hour)}
                  onKeyDown={e => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      setHour(h.hour);
                    }
                  }}
                >
                  <title>
                    {hours(h.hour)} · {h.saleCount} fiş ·{" "}
                    {money(h.salesGrossMinor)}
                  </title>
                  <rect
                    x={x}
                    y="5"
                    width="25"
                    height="150"
                    fill="transparent"
                  />
                  <rect
                    x={x}
                    y={130 - height}
                    width="22"
                    height={height}
                    fill={hour === h.hour ? "#d18a23" : "#087c61"}
                  />
                  <text x={x + 10} y="150" textAnchor="middle" fontSize="10">
                    {h.hour}
                  </text>
                </g>
              );
            })}
          </svg>
          {selected && (
            <p role="status">
              Seçilen saat {hours(selected.hour)} · {selected.saleCount} satış
              fişi · Satış {money(selected.salesGrossMinor)} · İade{" "}
              {money(selected.returnsGrossMinor)} · Brüt kâr{" "}
              {money(selected.grossProfitMinor)}
            </p>
          )}
          <button
            className="btn"
            onClick={() =>
              marketCsv(`saatlik-satis-${data.from}-${data.to}.csv`, [
                [...scope, "Saat dilimi", "Europe/Istanbul"],
                [
                  "Yerel saat",
                  "Satış fişi",
                  "İade belgesi",
                  "Satış KDV dahil kuruş",
                  "İade KDV dahil kuruş",
                  "İade sonrası net satış kuruş",
                  "İade sonrası maliyet kuruş",
                  "Brüt kâr kuruş",
                  "Ortalama satış fişi kuruş",
                ],
                ...data.hours.map(h => [
                  hours(h.hour),
                  h.saleCount,
                  h.returnCount,
                  h.salesGrossMinor,
                  h.returnsGrossMinor,
                  h.netSalesMinor,
                  h.cogsMinor,
                  h.grossProfitMinor,
                  h.averageSaleMinor,
                ]),
              ])
            }
          >
            24 saat tablosunu CSV indir
          </button>
          <div className="ma-table-wrap">
            <table aria-label="Saatlik satış tablosu">
              <thead>
                <tr>
                  <th>İstanbul saati</th>
                  <th>Satış / iade fişi</th>
                  <th>Satış / iade · KDV dahil</th>
                  <th>Net satış</th>
                  <th>Brüt kâr</th>
                  <th>Ortalama satış fişi</th>
                </tr>
              </thead>
              <tbody>
                {data.hours.map(h => (
                  <tr key={h.hour} aria-selected={hour === h.hour}>
                    <td>{hours(h.hour)}</td>
                    <td>
                      {h.saleCount} / {h.returnCount}
                    </td>
                    <td>
                      {money(h.salesGrossMinor)} / {money(h.returnsGrossMinor)}
                    </td>
                    <td>{money(h.netSalesMinor)}</td>
                    <td>{money(h.grossProfitMinor)}</td>
                    <td>{money(h.averageSaleMinor)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="ma-hint">
            İade saati iade işleminin kayıt anıdır; özgün satış saatine
            taşınmaz. İade yapan kişi farklı olsa da kasa/kullanıcı filtresi
            özgün satışı esas alır. Net kâr veya resmî mali belge değildir.
          </p>
        </>
      )}
    </section>
  );
}

import { StockHealthReports, MarginAlertReports } from "./StockHealthReports";
import { CancellationReports } from "./CancellationReports";
import { useEffect, useState } from "react";
import { money, type AppState } from "@shared/station";
import type {
  SalesReport,
  SalesProducts,
  ReportSaleDetail,
  ReportOptions,
} from "@shared/market-reports";
import {
  loadReportOptions,
  loadSalesReport,
  loadSalesProducts,
  loadReportSale,
} from "@/lib/station-api";
import { marketCsv } from "./MarketStatement";
import { MonthlyMarketReport } from "./MonthlyMarketReport";
import { CountReports } from "./CountReports";
import "./market-accounting.css";
import "./market-reports.css";
const todayTR = () =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Istanbul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
const dateTR = (date: string) =>
  new Date(
    date.replace(" ", "T") + (date.endsWith("Z") ? "" : "Z")
  ).toLocaleString("tr-TR", { timeZone: "Europe/Istanbul" });
const margin = (profit: number, net: number) =>
  net > 0
    ? `%${((profit / net) * 100).toLocaleString("tr-TR", { maximumFractionDigits: 2 })}`
    : "Hesaplanamaz";
export default function MarketReports({
  state,
  stationId,
}: {
  state: AppState;
  stationId: string;
}) {
  if (!["OWNER", "MANAGER", "ACCOUNTANT"].includes(state.member?.role ?? ""))
    return (
      <div className="notice">
        Raporlar firma sahibi, yönetici ve muhasebeciye açıktır.
      </div>
    );
  if (!stationId)
    return (
      <div className="notice">
        Raporlar için üst menüden bir istasyon seçin.
      </div>
    );
  return (
    <ReportsWorkspace
      key={`${state.user.id}:${stationId}`}
      stationId={stationId}
    />
  );
}
function ReportsWorkspace({ stationId }: { stationId: string }) {
  const today = todayTR();
  const [tab, setTab] = useState("sales"),
    [from, setFrom] = useState(today.slice(0, 7) + "-01"),
    [to, setTo] = useState(today);
  const [registerId, setRegisterId] = useState(""),
    [userId, setUserId] = useState("");
  const [options, setOptions] = useState<ReportOptions>({
      registers: [],
      users: [],
    }),
    [optionsError, setOptionsError] = useState("");
  useEffect(() => {
    let active = true;
    loadReportOptions(stationId)
      .then(o => {
        if (active) setOptions(o);
      })
      .catch(e => {
        if (active) setOptionsError(e.message);
      });
    return () => {
      active = false;
    };
  }, [stationId]);
  const [query, setQuery] = useState({
      from,
      to,
      cursor: "",
      asOf: "",
      registerId: "",
      userId: "",
    }),
    [report, setReport] = useState<SalesReport | null>(null),
    [error, setError] = useState("");
  const [products, setProducts] = useState<SalesProducts | null>(null),
    [productCursor, setProductCursor] = useState(""),
    [productError, setProductError] = useState("");
  const [selected, setSelected] = useState(""),
    [detail, setDetail] = useState<ReportSaleDetail | null>(null),
    [detailError, setDetailError] = useState("");
  useEffect(() => {
    let active = true;
    setReport(null);
    setError("");
    setSelected("");
    setDetail(null);
    loadSalesReport(stationId, query.from, query.to, query.cursor, query.asOf, {
      registerId: query.registerId,
      userId: query.userId,
    })
      .then(r => {
        if (active) setReport(r);
      })
      .catch(e => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [stationId, query]);
  useEffect(() => {
    let active = true;
    setProducts(null);
    setProductError("");
    if (report)
      loadSalesProducts(
        stationId,
        report.from,
        report.to,
        report.asOf,
        productCursor,
        report.filters
      )
        .then(p => {
          if (active) setProducts(p);
        })
        .catch(e => {
          if (active) setProductError(e.message);
        });
    return () => {
      active = false;
    };
  }, [
    stationId,
    report?.from,
    report?.to,
    report?.asOf,
    report?.filters.registerId,
    report?.filters.userId,
    productCursor,
  ]);
  useEffect(() => {
    let active = true;
    setDetail(null);
    setDetailError("");
    if (selected && report)
      loadReportSale(stationId, selected, report.asOf)
        .then(d => {
          if (active) setDetail(d);
        })
        .catch(e => {
          if (active) setDetailError(e.message);
        });
    return () => {
      active = false;
    };
  }, [stationId, selected, report?.asOf]);
  function apply(f = from, t = to) {
    setFrom(f);
    setTo(t);
    setProductCursor("");
    setQuery({ from: f, to: t, cursor: "", asOf: "", registerId, userId });
  }
  const shift = (days: number) => {
    const d = new Date(today + "T12:00:00Z");
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
  };
  return (
    <div className="ma-root mr-root">
      <header className="ma-header">
        <div>
          <h2>Raporlar merkezi</h2>
          <p>Market satışları ve kayıtlı maliyetler · yalnız okuma</p>
        </div>
      </header>
      <nav className="mr-tabs" aria-label="Rapor bölümleri">
        {[
          ["sales", "Satış özeti"],
          ["products", "Ürün kârlılığı"],
          ["monthly", "Aylık kâr–zarar"],
          ["counts", "Sayım raporları"],
          ["cancellations", "Sepet iptal denetimi"],
          ["stockHealth", "Stokta bağlı para"],
          ["marginAlerts", "Satış marjı uyarıları"],
        ].map(([id, label]) => (
          <button
            key={id}
            className={`btn ${tab === id ? "primary" : ""}`}
            aria-pressed={tab === id}
            onClick={() => setTab(id)}
          >
            {label}
          </button>
        ))}
      </nav>
      {["sales", "products"].includes(tab) && (
        <>
          <form
            className="mr-filters"
            onSubmit={e => {
              e.preventDefault();
              apply();
            }}
          >
            <label>
              Başlangıç
              <input
                aria-label="Rapor başlangıç"
                type="date"
                value={from}
                onChange={e => setFrom(e.target.value)}
                required
              />
            </label>
            <label>
              Bitiş
              <input
                aria-label="Rapor bitiş"
                type="date"
                value={to}
                onChange={e => setTo(e.target.value)}
                required
              />
            </label>
            <label>
              Kasa
              <select
                aria-label="Rapor kasa filtresi"
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
                aria-label="Rapor kasiyer filtresi"
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
            <button className="btn primary" type="submit">
              Raporu getir / yenile
            </button>
            <button
              className="btn"
              type="button"
              onClick={() => apply(today, today)}
            >
              Bugün
            </button>
            <button
              className="btn"
              type="button"
              onClick={() => apply(shift(-1), shift(-1))}
            >
              Dün
            </button>
            <button
              className="btn"
              type="button"
              onClick={() => apply(today.slice(0, 7) + "-01", today)}
            >
              Bu ay
            </button>
          </form>
          {optionsError && (
            <p role="alert">Filtre seçenekleri yüklenemedi: {optionsError}</p>
          )}
          {error && (
            <p role="alert" className="ma-error">
              {error}
            </p>
          )}
          {!report && !error && <p role="status">Rapor yükleniyor…</p>}
          {report && (
            <>
              <p className="ma-hint">
                {report.from}–{report.to} · Defter başlangıcı:{" "}
                {report.startedOn ?? "ticari defter açılmadı"} ·{" "}
                {report.closedDays}/{report.totalDays} gün sonu kayıtlı. Defter
                öncesi satışlar dahil değil. Açık gün tutarları değişebilir.
              </p>
              {report.salesOnly && (
                <p className="notice">
                  Kasa / satış kullanıcısı filtresi uygulanıyor. İadeler özgün
                  satışın kasasına/kullanıcısına bağlıdır. Genel giderler
                  dağıtılmaz; faaliyet sonucu bu kapsamda gösterilmez.
                </p>
              )}
              <p>
                Uygulanan kasa:{" "}
                {options.registers.find(o => o.id === report.filters.registerId)
                  ?.name ??
                  (report.filters.registerId || "Bütün kasalar")}{" "}
                · Satışı yapan:{" "}
                {options.users.find(o => o.id === report.filters.userId)
                  ?.name ??
                  (report.filters.userId || "Bütün kullanıcılar")}
              </p>
              <p className="ma-hint">
                Üretim: {dateTR(report.generatedAt)} · Kayıt sınırı:{" "}
                {report.asOf}. Sayfalama bu sınırda kalır; yeni kayıtlar için
                raporu yenileyin. Bu sınır sertifikalı arşiv değildir.
              </p>
              {tab === "sales" && (
                <>
                  <div className="ma-wallet-grid">
                    {[
                      ["Satış · KDV dahil", report.totals.salesGrossMinor],
                      [
                        "Satış iadeleri · KDV dahil",
                        report.totals.returnsGrossMinor,
                      ],
                      ["Net ciro · KDV dahil", report.totals.netGrossMinor],
                      ["Net satış · KDV hariç", report.totals.netSalesMinor],
                      ["Satılan mal maliyeti", report.totals.cogsMinor],
                      ["Brüt kâr", report.totals.grossProfitMinor],
                      ["Gider ve kayıplar", report.totals.expensesMinor],
                      ["Diğer kayıtlı kazançlar", report.totals.gainsMinor],
                      ["Faaliyet sonucu", report.totals.resultMinor],
                    ]
                      .filter(
                        ([label]) =>
                          !report.salesOnly ||
                          ![
                            "Gider ve kayıplar",
                            "Diğer kayıtlı kazançlar",
                            "Faaliyet sonucu",
                          ].includes(String(label))
                      )
                      .map(([label, value]) => (
                        <div key={String(label)}>
                          <span>{label}</span>
                          <strong>{money(Number(value))}</strong>
                        </div>
                      ))}
                  </div>
                  <p>
                    {report.totals.saleCount} satış fişi · Ortalama satış fişi:{" "}
                    {report.totals.averageSaleMinor === null
                      ? "Hesaplanamaz"
                      : money(report.totals.averageSaleMinor)}{" "}
                    · Brüt marj:{" "}
                    {margin(
                      report.totals.grossProfitMinor,
                      report.totals.netSalesMinor
                    )}
                  </p>
                  <p className="ma-hint">
                    Ortalama fiş iadeler düşülmeden satış toplamı / tamamlanmış
                    satış fişi adedidir. Faaliyet sonucu bütün
                    vergi/amortisman/finansman kalemlerini kapsayan net kâr
                    değildir.
                  </p>
                  <p>
                    Önceki eşit dönem {report.previousFrom}–{report.previousTo}:
                    net ciro {money(report.previous.netGrossMinor)} ·{" "}
                    {report.salesOnly
                      ? "Brüt kâr farkı"
                      : "Faaliyet sonucu farkı"}{" "}
                    {money(
                      report.salesOnly
                        ? report.totals.grossProfitMinor -
                            report.previous.grossProfitMinor
                        : report.totals.resultMinor -
                            report.previous.resultMinor
                    )}
                  </p>
                  <section className="ma-panel">
                    <h3>Satışların ödeme dağılımı</h3>
                    <div className="ma-wallet-grid">
                      {[
                        ["Nakit satış payı", report.totals.payments.cashMinor],
                        [
                          "Kart payı · manuel beyan",
                          report.totals.payments.cardMinor,
                        ],
                        ["Veresiye payı", report.totals.payments.creditMinor],
                      ].map(([l, v]) => (
                        <div key={String(l)}>
                          <span>{l}</span>
                          <strong>{money(Number(v))}</strong>
                        </div>
                      ))}
                    </div>
                    <p className="ma-hint">
                      Karma fişlerin payları ayrı toplanır. Para üstü satış
                      değildir. Sonraki müşteri tahsilatı satışa eklenmez; kart
                      alacağı banka bakiyesi değildir.
                    </p>
                    <p>
                      {report.totals.returns.count} satış iadesi: merkez kasadan
                      iade {money(report.totals.returns.cashMinor)}, bankadan
                      iade {money(report.totals.returns.bankMinor)}, cari mahsup{" "}
                      {money(report.totals.returns.creditMinor)}. İade
                      kaydedildiği iş günündedir; özgün satışın ödeme türüne
                      tahminen dağıtılmaz.
                    </p>
                  </section>
                  <section className="ma-panel">
                    <h3>Satış fişleri · bu sayfa en fazla 50</h3>
                    <button
                      className="btn"
                      onClick={() =>
                        marketCsv(
                          `market-satis-${report.from}-${report.to}-sayfa.csv`,
                          [
                            [
                              "Dönem",
                              report.from,
                              report.to,
                              "Kayıt sınırı",
                              report.asOf,
                              "Kasa ID",
                              report.filters.registerId,
                              "Satış kullanıcı ID",
                              report.filters.userId,
                            ],
                            [
                              "Fiş ID",
                              "Sıra",
                              "İş günü",
                              "Kasa · güncel ad",
                              "Satışı yapan · güncel ad",
                              "KDV dahil kuruş",
                              "Nakit kuruş",
                              "Kart kuruş",
                              "Veresiye kuruş",
                            ],
                            ...report.rows.map(s => [
                              s.id,
                              s.sequence,
                              s.date,
                              s.registerName,
                              s.actorName,
                              s.totalMinor,
                              s.cashMinor,
                              s.cardMinor,
                              s.creditMinor,
                            ]),
                          ]
                        )
                      }
                    >
                      Bu fiş sayfasını CSV indir
                    </button>
                    <div className="ma-table-wrap">
                      <table>
                        <thead>
                          <tr>
                            <th>Fiş / iş günü</th>
                            <th>Kasa / kişi</th>
                            <th>KDV dahil</th>
                            <th>Nakit / kart / veresiye</th>
                            <th>Ayrıntı</th>
                          </tr>
                        </thead>
                        <tbody>
                          {report.rows.map(s => (
                            <tr key={s.id}>
                              <td>
                                #{s.sequence}
                                <small>
                                  {s.date} · {dateTR(s.createdAt)}
                                </small>
                              </td>
                              <td>
                                {s.registerName}
                                <small>{s.actorName}</small>
                              </td>
                              <td>{money(s.totalMinor)}</td>
                              <td>
                                {money(s.cashMinor)} / {money(s.cardMinor)} /{" "}
                                {money(s.creditMinor)}
                              </td>
                              <td>
                                <button
                                  className="btn"
                                  onClick={() => setSelected(s.id)}
                                  aria-label={`Fiş ${s.sequence} ayrıntısı`}
                                >
                                  Fişi incele
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    {!report.rows.length && (
                      <p>Bu dönemde kayıtlı satış fişi yok.</p>
                    )}
                    <div className="ma-row-actions">
                      <button
                        className="btn"
                        disabled={!query.cursor}
                        onClick={() =>
                          setQuery({ ...query, cursor: "", asOf: report.asOf })
                        }
                      >
                        İlk fiş sayfası
                      </button>
                      <button
                        className="btn"
                        disabled={!report.nextCursor}
                        onClick={() =>
                          setQuery({
                            ...query,
                            cursor: report.nextCursor!,
                            asOf: report.asOf,
                          })
                        }
                      >
                        Sonraki fişler
                      </button>
                    </div>
                    <p className="ma-hint">
                      Üst toplamlar bütün dönemi, tablo ve CSV yalnız bu sayfayı
                      kapsar. Kişi/kasa adları güncel kayıttır; ortak kasada
                      satışın gerçek kullanıcısı gösterilir.
                    </p>
                  </section>
                </>
              )}
              {tab === "products" && (
                <section className="ma-panel">
                  <h3>Ürün kârlılığı</h3>
                  <p className="ma-hint">
                    Satış/iade anında kaydedilmiş tutarlar ve maliyetler
                    kullanılır. Ürün adı/barkodu güncel karttır; tarihî kategori
                    analizi yoktur. Ürün sırasıyla 50 kayıtlık sayfalar
                    gösterilir. İşletme giderleri ürünlere dağıtılmaz.
                  </p>
                  <p>
                    Dönem net satış: {money(report.totals.netSalesMinor)} ·
                    Satış maliyeti: {money(report.totals.cogsMinor)} · Brüt kâr:{" "}
                    {money(report.totals.grossProfitMinor)}
                  </p>
                  {productError && (
                    <p role="alert" className="ma-error">
                      {productError}
                    </p>
                  )}
                  {!products && !productError && (
                    <p role="status">Ürün raporu yükleniyor…</p>
                  )}
                  {products && (
                    <>
                      <button
                        className="btn"
                        onClick={() =>
                          marketCsv(
                            `market-urun-${report.from}-${report.to}-sayfa.csv`,
                            [
                              [
                                "Dönem",
                                report.from,
                                report.to,
                                "Kayıt sınırı",
                                report.asOf,
                              ],
                              [
                                "Ürün ID",
                                "Güncel ad",
                                "Güncel barkod",
                                "Satış adedi",
                                "İade adedi",
                                "Net satış kuruş",
                                "Maliyet kuruş",
                                "Brüt kâr kuruş",
                              ],
                              ...products.rows.map(p => [
                                p.id,
                                p.name,
                                p.barcode,
                                p.soldQty,
                                p.returnedQty,
                                p.netSalesMinor,
                                p.cogsMinor,
                                p.profitMinor,
                              ]),
                            ]
                          )
                        }
                      >
                        Bu ürün sayfasını CSV indir
                      </button>
                      <div className="ma-table-wrap">
                        <table>
                          <thead>
                            <tr>
                              <th>Ürün · güncel kart</th>
                              <th>Satış / iade adedi</th>
                              <th>Net satış</th>
                              <th>Maliyet</th>
                              <th>Brüt kâr / marj</th>
                            </tr>
                          </thead>
                          <tbody>
                            {products.rows.map(p => (
                              <tr key={p.id}>
                                <td>
                                  {p.name}
                                  <small>{p.barcode}</small>
                                </td>
                                <td>
                                  {p.soldQty} / {p.returnedQty}
                                </td>
                                <td>{money(p.netSalesMinor)}</td>
                                <td>{money(p.cogsMinor)}</td>
                                <td>
                                  {money(p.profitMinor)}
                                  <small>
                                    {margin(p.profitMinor, p.netSalesMinor)}
                                  </small>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                      {!products.rows.length && (
                        <p>Bu dönemde ürün hareketi yok.</p>
                      )}
                      <div className="ma-row-actions">
                        <button
                          className="btn"
                          disabled={!productCursor}
                          onClick={() => setProductCursor("")}
                        >
                          İlk ürün sayfası
                        </button>
                        <button
                          className="btn"
                          disabled={!products.nextCursor}
                          onClick={() => setProductCursor(products.nextCursor!)}
                        >
                          Sonraki ürünler
                        </button>
                      </div>
                    </>
                  )}
                </section>
              )}
              {selected && tab === "sales" && (
                <section className="ma-panel" aria-label="Seçilen satış fişi">
                  <button className="btn" onClick={() => setSelected("")}>
                    Fiş ayrıntısını kapat
                  </button>
                  {detailError && (
                    <p role="alert" className="ma-error">
                      {detailError}
                    </p>
                  )}
                  {!detail && !detailError && (
                    <p role="status">Fiş yükleniyor…</p>
                  )}
                  {detail && (
                    <>
                      <h3>Satış fişi #{detail.sequence}</h3>
                      <p>
                        {detail.date} · {dateTR(detail.createdAt)} ·{" "}
                        {detail.actorName} · {detail.registerName}
                      </p>
                      <p>
                        Fiş: {detail.id} · Kasa oturumu: {detail.sessionId} ·
                        Cihaz: {detail.deviceId ?? "Eski kayıtta yok"}
                      </p>
                      <p>
                        Net {money(detail.netMinor)} + KDV{" "}
                        {money(detail.vatMinor)} = {money(detail.totalMinor)} ·
                        Satış maliyeti {money(detail.costMinor)}
                      </p>
                      <div className="ma-table-wrap">
                        <table>
                          <thead>
                            <tr>
                              <th>Satış anındaki ürün / barkod</th>
                              <th>Adet</th>
                              <th>Birim fiyat</th>
                              <th>KDV dahil</th>
                              <th>KDV</th>
                              <th>Maliyet</th>
                            </tr>
                          </thead>
                          <tbody>
                            {detail.lines.map(l => (
                              <tr key={l.productId}>
                                <td>
                                  {l.name}
                                  <small>{l.barcode}</small>
                                </td>
                                <td>{l.quantity}</td>
                                <td>{money(l.unitPriceMinor)}</td>
                                <td>{money(l.grossMinor)}</td>
                                <td>{money(l.vatMinor)}</td>
                                <td>{money(l.costMinor)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                      <h4>Bu fişin iade geçmişi</h4>
                      <p className="ma-hint">
                        Rapor kayıt sınırına kadar bütün kaynak iadeleri;
                        seçilen dönemle sınırlı değildir. Resmî mali fiş
                        değildir.
                      </p>
                      {detail.returns.map(r => (
                        <p key={r.id}>
                          {r.date} · {r.reference} · {money(r.grossMinor)} ·
                          Para iadesi {money(r.refundMinor)} · Cari mahsup{" "}
                          {money(r.creditedMinor)}
                        </p>
                      ))}
                      {!detail.returns.length && <p>Kayıtlı iade yok.</p>}
                    </>
                  )}
                </section>
              )}
            </>
          )}
        </>
      )}
      {tab === "cancellations" && (
        <CancellationReports
          stationId={stationId}
          today={today}
          options={options}
        />
      )}
      {tab === "stockHealth" && <StockHealthReports stationId={stationId} />}
      {tab === "marginAlerts" && (
        <MarginAlertReports stationId={stationId} today={today} />
      )}
      {tab === "monthly" && (
        <MonthlyMarketReport stationId={stationId} today={today} />
      )}
      {tab === "counts" && <CountReports stationId={stationId} today={today} />}
    </div>
  );
}

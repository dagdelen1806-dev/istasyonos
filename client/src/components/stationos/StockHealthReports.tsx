import { useEffect, useState } from "react";
import { money } from "@shared/station";
import type { StockHealthReport, MarginReport } from "@shared/stock-health";
import type { ReportSaleDetail } from "@shared/market-reports";
import {
  loadStockHealth,
  loadMarginAlerts,
  loadReportSale,
} from "@/lib/station-api";
import { marketCsv } from "./MarketStatement";
const stockModes = {
  ALL: "Bütün ürünler",
  INACTIVE: "Hareketsiz ürünler",
  UNOBSERVED: "Yeterli geçmişi olmayanlar",
  NO_STOCK: "Stoğu olmayanlar",
};
const marginModes = {
  ALL: "Bütün hareketli ürünler",
  ALERTS: "Düşük marj / zarar uyarıları",
  LOSS: "Zararına satış olanlar",
};
const stockLabels = {
  ACTIVE: "Yakın dönemde satış var",
  INACTIVE: "Hareketsiz",
  UNOBSERVED: "Yeterli gözlem süresi yok",
  NO_STOCK: "Stok yok",
};
const marginLabels = {
  LOSS: "Zararına satış var",
  LOW: "Düşük marjlı satış var",
  OK: "Eşik ve üzeri",
  NO_REVENUE: "Net satış tutarı sıfır",
  RETURN_ONLY: "Yalnız iade etkisi",
};
export function StockHealthReports({ stationId }: { stationId: string }) {
  const [age, setAge] = useState("30"),
    [mode, setMode] = useState("ALL"),
    [search, setSearch] = useState("");
  const [q, setQ] = useState({
      age: "30",
      mode: "ALL",
      search: "",
      cursor: "",
      snapshot: "",
    }),
    [data, setData] = useState<StockHealthReport | null>(null),
    [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    setData(null);
    setError("");
    loadStockHealth(stationId, q.age, q.mode, q.search, q.cursor, q.snapshot)
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
  return (
    <section className="ma-panel">
      <h2>Stokta bağlı para ve hareketsiz ürünler</h2>
      <p>
        Kayıtlı güncel stok maliyet değeri. Geçmiş tarihin stoğu, satış fiyatı
        değeri veya stok devir hızı değildir.
      </p>
      <form
        className="mr-filters"
        onSubmit={e => {
          e.preventDefault();
          setQ({ age, mode, search, cursor: "", snapshot: "" });
        }}
      >
        <label>
          Satışsız takvim günü
          <select
            aria-label="Stok satışsız gün"
            value={age}
            onChange={e => setAge(e.target.value)}
          >
            {[30, 60, 90].map(n => (
              <option key={n} value={n}>
                {n} gün
              </option>
            ))}
          </select>
        </label>
        <label>
          Görünüm
          <select
            aria-label="Stok rapor görünümü"
            value={mode}
            onChange={e => setMode(e.target.value)}
          >
            <option value="ALL">Bütün ürünler</option>
            <option value="INACTIVE">Hareketsiz ürünler</option>
            <option value="UNOBSERVED">Yeterli geçmişi olmayanlar</option>
            <option value="NO_STOCK">Stoğu olmayanlar</option>
          </select>
        </label>
        <label>
          Ürün / barkod / güncel kategori
          <input
            aria-label="Stok rapor araması"
            value={search}
            maxLength={190}
            onChange={e => setSearch(e.target.value)}
          />
        </label>
        <button className="btn primary">Stok raporunu getir / yenile</button>
      </form>
      {error && (
        <p role="alert" className="ma-error">
          {error}
        </p>
      )}
      {!data && !error && <p role="status">Stok analizi yükleniyor…</p>}
      {data && (
        <>
          <p>
            {data.today} · Defter başlangıcı {data.startedOn} · Sürüm{" "}
            {data.bookRevision} · Üretim{" "}
            {new Date(data.generatedAt).toLocaleString("tr-TR", {
              timeZone: "Europe/Istanbul",
            })}
          </p>
          <div className="ma-wallet-grid">
            <div>
              <span>Güncel mali stok değeri · tüm katalog</span>
              <strong>{money(data.totals.valueMinor)}</strong>
            </div>
            <div>
              <span>Stoklu ürün / katalog</span>
              <strong>
                {data.totals.stockedProducts} / {data.totals.catalogProducts}
              </strong>
            </div>
            {([30, 60, 90] as const).map(n => (
              <div key={n}>
                <span>
                  {n}+ gün hareketsiz · {data.totals[`inactive${n}`]} ürün
                </span>
                <strong>{money(data.totals[`inactive${n}Minor`])}</strong>
              </div>
            ))}
            <div>
              <span>Satışa kapalı miktarı olan ürün</span>
              <strong>{data.totals.blockedProducts}</strong>
            </div>
          </div>
          <p className="ma-hint">
            30/60/90 kümeleri iç içedir; tutarlarını birbirine eklemeyin. Parti
            değeri SKU değerine ikinci kez eklenmez. Satılabilir miktar takipli
            üründe güncel SKT/karantina durumuna bağlıdır; değer bütün kayıtlı
            stoğu kapsar.
          </p>
          <p>
            Uygulanan eşik {data.ageDays} gün · Görünüm {stockModes[data.mode]}{" "}
            · Arama {data.search || "yok"}. Eşleşen {data.matched.products} ürün
            / {money(data.matched.valueMinor)}. Üst kartlar bütün katalog,
            tablo/CSV bu 50 satırlık sayfadır.
          </p>
          <p className="ma-hint">
            Satış geçmişi yalnız ticari deftere bağlı POS satışlarını kapsar.
            Gözlem, defter açılışı ve ürün oluşturma tarihlerinden geç olanıyla
            başlar. İade, alım, sayım ve fiyat değişikliği son satış tarihini
            yenilemez. Satış görülmemesi ürünün işletme tarihinde hiç
            satılmadığını kanıtlamaz.
          </p>
          <button
            className="btn"
            onClick={() =>
              marketCsv(`stok-bagli-para-${data.today}-sayfa.csv`, [
                [
                  "Güncel tarih",
                  data.today,
                  "Görüntü",
                  data.snapshot,
                  "Eşik gün",
                  data.ageDays,
                  "Görünüm",
                  data.mode,
                  "Arama",
                  data.search,
                ],
                [
                  "Ürün ID",
                  "Güncel ad",
                  "Barkod",
                  "Temel birim",
                  "Miktar",
                  "Satılabilir",
                  "Kapalı miktar",
                  "Net maliyet değeri kuruş",
                  "Son kayıtlı satış",
                  "Gözlem başlangıcı",
                  "Gözlem günü",
                  "Satışsız gün",
                  "Durum",
                ],
                ...data.rows.map(p => [
                  p.id,
                  p.name,
                  p.barcode,
                  p.unit,
                  p.quantity,
                  p.saleableQty,
                  p.blockedQty,
                  p.valueMinor,
                  p.lastSaleDate,
                  p.observedFrom,
                  p.observedDays,
                  p.noSaleDays,
                  stockLabels[p.status],
                ]),
              ])
            }
          >
            Bu stok sayfasını CSV indir
          </button>
          <div className="ma-table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Ürün · güncel kart</th>
                  <th>Miktar / satılabilir / kapalı</th>
                  <th>Maliyet değeri</th>
                  <th>Son kayıtlı satış</th>
                  <th>Gözlem / satışsız gün</th>
                  <th>Durum</th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map(p => (
                  <tr key={p.id}>
                    <td>
                      {p.name}
                      <small>
                        {p.barcode} · {p.category || "Kategori yok"}
                      </small>
                    </td>
                    <td>
                      {p.quantity} / {p.saleableQty} / {p.blockedQty} {p.unit}
                    </td>
                    <td>{money(p.valueMinor)}</td>
                    <td>{p.lastSaleDate ?? "İzlenen satış yok"}</td>
                    <td>
                      {p.observedDays} / {p.noSaleDays}
                      <small>Başlangıç {p.observedFrom}</small>
                    </td>
                    <td>{stockLabels[p.status]}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!data.rows.length && <p>Bu kapsamda ürün yok.</p>}
          <div className="ma-row-actions">
            <button
              className="btn"
              disabled={!q.cursor}
              onClick={() =>
                setQ({ ...q, cursor: "", snapshot: data.snapshot })
              }
            >
              İlk stok sayfası
            </button>
            <button
              className="btn"
              disabled={!data.nextCursor}
              onClick={() =>
                setQ({
                  ...q,
                  cursor: data.nextCursor!,
                  snapshot: data.snapshot,
                })
              }
            >
              Sonraki stok ürünleri
            </button>
          </div>
          <p className="ma-hint">
            Stok/kart bilgisi değişirse sayfaları birleştirmek yerine ilk
            sayfadan yenilemeniz istenir. Kalıcı arşiv değildir; en fazla 5.000
            ürün.
          </p>
        </>
      )}
    </section>
  );
}
export function MarginAlertReports({
  stationId,
  today,
}: {
  stationId: string;
  today: string;
}) {
  const [from, setFrom] = useState(today.slice(0, 7) + "-01"),
    [to, setTo] = useState(today),
    [threshold, setThreshold] = useState("10"),
    [mode, setMode] = useState("ALERTS");
  const [q, setQ] = useState({
      from,
      to,
      thresholdBps: "1000",
      mode: "ALERTS",
      asOf: "",
      cursor: "",
    }),
    [data, setData] = useState<MarginReport | null>(null),
    [error, setError] = useState("");
  const [selected, setSelected] = useState(""),
    [detail, setDetail] = useState<ReportSaleDetail | null>(null),
    [detailError, setDetailError] = useState("");
  useEffect(() => {
    let active = true;
    setData(null);
    setError("");
    setSelected("");
    loadMarginAlerts(
      stationId,
      q.from,
      q.to,
      q.thresholdBps,
      q.mode,
      q.cursor,
      q.asOf
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
  }, [stationId, q]);
  useEffect(() => {
    let active = true;
    setDetail(null);
    setDetailError("");
    if (selected && data)
      loadReportSale(stationId, selected, data.asOf)
        .then(d => {
          if (active) setDetail(d);
        })
        .catch(e => {
          if (active) setDetailError(e.message);
        });
    return () => {
      active = false;
    };
  }, [stationId, selected, data?.asOf]);
  return (
    <section className="ma-panel">
      <h2>Satış marjı uyarıları</h2>
      <p>
        Satış anında kaydedilmiş KDV hariç tutar ve maliyet. Sonradan değişen
        alış/satış fiyatı geçmiş kârı değiştirmez; giderler ürünlere dağıtılmaz.
      </p>
      <form
        className="mr-filters"
        onSubmit={e => {
          e.preventDefault();
          if (
            !/^\d{1,3}(\.\d{1,2})?$/.test(threshold) ||
            Number(threshold) > 100
          ) {
            setError("Marj eşiği %0–100 arası, en fazla iki ondalık olmalı.");
            return;
          }
          setQ({
            from,
            to,
            thresholdBps: String(Math.round(Number(threshold) * 100)),
            mode,
            asOf: "",
            cursor: "",
          });
        }}
      >
        <label>
          Başlangıç
          <input
            aria-label="Marj başlangıç"
            type="date"
            value={from}
            onChange={e => setFrom(e.target.value)}
            required
          />
        </label>
        <label>
          Bitiş
          <input
            aria-label="Marj bitiş"
            type="date"
            value={to}
            onChange={e => setTo(e.target.value)}
            required
          />
        </label>
        <label>
          Brüt marj eşiği %
          <input
            aria-label="Brüt marj eşiği"
            type="number"
            min="0"
            max="100"
            step="0.01"
            value={threshold}
            onChange={e => setThreshold(e.target.value)}
            required
          />
        </label>
        <label>
          Görünüm
          <select
            aria-label="Marj rapor görünümü"
            value={mode}
            onChange={e => setMode(e.target.value)}
          >
            <option value="ALERTS">Düşük marj / zarar uyarıları</option>
            <option value="LOSS">Zararına satış olanlar</option>
            <option value="ALL">Bütün hareketli ürünler</option>
          </select>
        </label>
        <button className="btn primary">Marj raporunu getir / yenile</button>
      </form>
      {error && (
        <p role="alert" className="ma-error">
          {error}
        </p>
      )}
      {!data && !error && <p role="status">Marj analizi yükleniyor…</p>}
      {data && (
        <>
          <p>
            {data.from}–{data.to} · Uygulanan eşik %{data.thresholdBps / 100} ·
            Görünüm {marginModes[data.mode]} · Kayıt sınırı {data.asOf}
          </p>
          <div className="ma-wallet-grid">
            <div>
              <span>Zararına satış bulunan ürün</span>
              <strong>{data.totals.lossProducts}</strong>
            </div>
            <div>
              <span>Düşük marj uyarılı ürün</span>
              <strong>{data.totals.lowProducts}</strong>
            </div>
            <div>
              <span>Zararına / düşük marjlı satış satırı</span>
              <strong>
                {data.totals.lossLines} / {data.totals.lowLines}
              </strong>
            </div>
            <div>
              <span>Dönem brüt kârı · bütün ürünler</span>
              <strong>{money(data.totals.grossProfitMinor)}</strong>
            </div>
          </div>
          <p className="ma-hint">
            Uyarı özgün satış satırından gelir; aynı ürünün diğer kârlı
            satışları zararına satışı gizlemez. Eşik %10 varsayılan işletme
            tercihidir, yasal oran değildir. Brüt marj = (KDV hariç satış −
            kayıtlı maliyet) / KDV hariç satış. Gösterilen yüzde yuvarlansa da
            karar tam tutarla verilir.
          </p>
          <p className="ma-hint">
            Tabloda satışlar ve iadeler ayrıdır. Yalnız eski satış iadesi olan
            ürün yeni zararına satış diye işaretlenmez. İade kaydedildiği dönemi
            etkiler; uyarı özgün satışın yapıldığını silmez. Sayaçlar satır
            sayısıdır, adet veya fiş sayısı değildir.
          </p>
          <p>
            {data.matched} eşleşen ürün / {data.totals.products} dönem ürünü.
            Üst toplamlar bütün dönem, tablo/CSV bu sayfadır.
          </p>
          <button
            className="btn"
            onClick={() =>
              marketCsv(`satis-marj-${data.from}-${data.to}-sayfa.csv`, [
                [
                  "Dönem",
                  data.from,
                  data.to,
                  "Kayıt sınırı",
                  data.asOf,
                  "Eşik baz puan",
                  data.thresholdBps,
                  "Görünüm",
                  data.mode,
                ],
                [
                  "Ürün ID",
                  "Güncel ad",
                  "Barkod",
                  "Temel birim",
                  "Satış miktarı",
                  "İade miktarı",
                  "Satış net kuruş",
                  "Satış maliyeti kuruş",
                  "İade net kuruş",
                  "İade maliyeti kuruş",
                  "İade sonrası net satış kuruş",
                  "İade sonrası maliyet kuruş",
                  "İade sonrası brüt kâr kuruş",
                  "Zararına satış satırı",
                  "Düşük marjlı satış satırı",
                  "Durum",
                ],
                ...data.rows.map(p => [
                  p.id,
                  p.name,
                  p.barcode,
                  p.unit,
                  p.soldQty,
                  p.returnedQty,
                  p.salesNetMinor,
                  p.salesCostMinor,
                  p.returnsNetMinor,
                  p.returnsCostMinor,
                  p.netSalesMinor,
                  p.cogsMinor,
                  p.grossProfitMinor,
                  p.lossLines,
                  p.lowLines,
                  marginLabels[p.status],
                ]),
              ])
            }
          >
            Bu marj sayfasını CSV indir
          </button>
          <div className="ma-table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Ürün · güncel kart</th>
                  <th>Satış / iade miktarı</th>
                  <th>Satış net / maliyet</th>
                  <th>Satış brüt marjı</th>
                  <th>İade sonrası brüt kâr</th>
                  <th>Uyarı / kaynak</th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map(p => (
                  <tr key={p.id}>
                    <td>
                      {p.name}
                      <small>{p.barcode}</small>
                    </td>
                    <td>
                      {p.soldQty} / {p.returnedQty} {p.unit}
                    </td>
                    <td>
                      {money(p.salesNetMinor)} / {money(p.salesCostMinor)}
                    </td>
                    <td>
                      {p.salesMarginBps === null
                        ? "Oran gösterilemiyor"
                        : `%${(p.salesMarginBps / 100).toLocaleString("tr-TR")}`}
                    </td>
                    <td>{money(p.grossProfitMinor)}</td>
                    <td>
                      {marginLabels[p.status]}
                      <small>
                        {p.lossLines} zarar / {p.lowLines} düşük marj satırı
                      </small>
                      {p.sampleLossSaleId && (
                        <button
                          className="btn"
                          aria-label={`${p.name} örnek zarar fişi`}
                          onClick={() => setSelected(p.sampleLossSaleId!)}
                        >
                          Örnek zararlı satışı incele
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!data.rows.length && <p>Bu kapsamda marj uyarısı/ürün yok.</p>}
          <div className="ma-row-actions">
            <button
              className="btn"
              disabled={!q.cursor}
              onClick={() => setQ({ ...q, asOf: data.asOf, cursor: "" })}
            >
              İlk marj sayfası
            </button>
            <button
              className="btn"
              disabled={!data.nextCursor}
              onClick={() =>
                setQ({ ...q, asOf: data.asOf, cursor: data.nextCursor! })
              }
            >
              Sonraki marj ürünleri
            </button>
          </div>
          {selected && (
            <section aria-label="Örnek zarar satış fişi">
              <h3>Örnek kaynak satış</h3>
              <p className="ma-hint">
                Bu ürün için bir örnek fiş; fişteki diğer satırlar kârlı
                olabilir. Resmî mali belge değildir.
              </p>
              {detailError && <p role="alert">{detailError}</p>}
              {!detail && !detailError && (
                <p role="status">Kaynak fiş yükleniyor…</p>
              )}
              {detail && (
                <>
                  <p>
                    #{detail.sequence} · {detail.date} · {detail.actorName} ·{" "}
                    {detail.registerName}
                  </p>
                  <div className="ma-table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>Satış anındaki ürün</th>
                          <th>Miktar</th>
                          <th>KDV hariç satış</th>
                          <th>Kayıtlı maliyet</th>
                          <th>Brüt kâr</th>
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
                            <td>{money(l.netMinor)}</td>
                            <td>{money(l.costMinor)}</td>
                            <td>{money(l.netMinor - l.costMinor)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
              <button className="btn" onClick={() => setSelected("")}>
                Kaynak fişi kapat
              </button>
            </section>
          )}
        </>
      )}
    </section>
  );
}

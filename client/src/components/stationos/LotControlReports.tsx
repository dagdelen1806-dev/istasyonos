import { useEffect, useState } from "react";
import { money } from "@shared/station";
import type { LotControl, LossReport, LossRow } from "@shared/lot-control";
import { loadLotControl, loadInventoryLosses } from "@/lib/station-api";
import { marketCsv } from "./MarketStatement";
const modeLabels = {
  ALL: "Bütün stoklu partiler",
  NEAR: "SKT yaklaşan · satışa açık",
  EXPIRED: "SKT geçmiş",
  QUARANTINE: "Karantina",
  UNKNOWN: "SKT bilinmiyor",
};
const kindLabels: Record<string, string> = {
  LOT_WRITE_OFF: "Parti firesi",
  LOT_COUNT: "Parti sayımı",
  STOCK_ADJUST: "Masaüstü stok sayımı",
  STOCK_COUNT: "Terminal sayımı",
};
export function LotControlReports({
  stationId,
  today,
}: {
  stationId: string;
  today: string;
}) {
  const [pane, setPane] = useState("current");
  return (
    <section className="ma-panel">
      <h2>SKT, karantina ve fire kontrolü</h2>
      <p>
        Güncel parti riski ile gerçekleşmiş fire/sayım kayıtları ayrıdır. Bu
        rapor stok düşürmez, partiyi satışa açmaz veya kendiliğinden indirim
        uygulamaz.
      </p>
      <div className="mr-tabs">
        <button
          className="btn"
          aria-pressed={pane === "current"}
          onClick={() => setPane("current")}
        >
          Güncel SKT ve karantina
        </button>
        <button
          className="btn"
          aria-pressed={pane === "history"}
          onClick={() => setPane("history")}
        >
          Kayıtlı fire ve sayım farkları
        </button>
      </div>
      {pane === "current" ? (
        <CurrentLots stationId={stationId} />
      ) : (
        <LossHistory stationId={stationId} today={today} />
      )}
      <p className="ma-hint">
        Yetkili işlem için Market muhasebesi → Lot ve SKT veya El terminali
        bölümünü kullanın. Uyarı, fizikî kontrol ve kayıtlı mali işlemin yerine
        geçmez.
      </p>
    </section>
  );
}
function CurrentLots({ stationId }: { stationId: string }) {
  const [horizon, setHorizon] = useState("7"),
    [mode, setMode] = useState("ALL"),
    [search, setSearch] = useState(""),
    [productId, setProduct] = useState("");
  const [q, setQ] = useState({
      horizon: "7",
      mode: "ALL",
      search: "",
      productId: "",
      cursor: "",
      snapshot: "",
    }),
    [data, setData] = useState<LotControl | null>(null),
    [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    setData(null);
    setError("");
    loadLotControl(
      stationId,
      q.horizon,
      q.mode,
      q.search,
      q.productId,
      q.cursor,
      q.snapshot
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
  const [products, setProducts] = useState<{ id: string; name: string }[]>([]);
  useEffect(() => {
    if (data) setProducts(data.products);
  }, [data]);
  return (
    <>
      <h3>Güncel stoklu parti görünümü</h3>
      <form
        className="mr-filters"
        onSubmit={e => {
          e.preventDefault();
          setQ({ horizon, mode, search, productId, cursor: "", snapshot: "" });
        }}
      >
        <label>
          SKT ufku
          <select
            aria-label="SKT ufku"
            value={horizon}
            onChange={e => setHorizon(e.target.value)}
          >
            {[7, 15, 30].map(n => (
              <option key={n} value={n}>
                {n} gün
              </option>
            ))}
          </select>
        </label>
        <label>
          Durum
          <select
            aria-label="Parti kontrol durumu"
            value={mode}
            onChange={e => setMode(e.target.value)}
          >
            {Object.entries(modeLabels).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </label>
        <label>
          Takipli ürün
          <select
            aria-label="Parti kontrol ürünü"
            value={productId}
            onChange={e => setProduct(e.target.value)}
          >
            <option value="">Bütün takipli ürünler</option>
            {products.map(p => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Ürün / barkod / parti kodu
          <input
            aria-label="Parti kontrol araması"
            value={search}
            maxLength={190}
            onChange={e => setSearch(e.target.value)}
          />
        </label>
        <button className="btn primary">Parti kontrolünü getir / yenile</button>
      </form>
      {error && (
        <p role="alert" className="ma-error">
          {error}
        </p>
      )}
      {!data && !error && <p role="status">Parti kontrolü yükleniyor…</p>}
      {data && (
        <>
          <p>
            {data.today} · Üretim{" "}
            {new Date(data.generatedAt).toLocaleString("tr-TR", {
              timeZone: "Europe/Istanbul",
            })}
          </p>
          <div className="ma-wallet-grid">
            {[
              ["Stoklu parti", data.totals.lots],
              ["Stoklu takipli ürün", data.totals.products],
              ["7 gün içinde · satışa açık", data.totals.near7],
              ["15 gün içinde · satışa açık", data.totals.near15],
              ["30 gün içinde · satışa açık", data.totals.near30],
              ["SKT geçmiş parti", data.totals.expired],
              ["Karantinadaki parti", data.totals.quarantine],
              ["SKT bilinmeyen parti", data.totals.unknown],
              ["Satışa kapalı parti", data.totals.blocked],
            ].map(([l, n]) => (
              <div key={String(l)}>
                <span>{l}</span>
                <strong>{n}</strong>
              </div>
            ))}
          </div>
          <p className="ma-hint">
            Kartlar bütün takipli stoklu partileri kapsar; kümeler çakışabilir,
            sayıları toplanmaz. Bugün SKT'si dolan satışa açık parti yaklaşan
            gruptadır, geçmiş sayılmaz. Farklı temel birimlerin miktarları tek
            adet toplamında birleştirilmez. Sıfır miktarlı partiler bu listede
            yoktur.
          </p>
          <p>
            Uygulanan görünüm {modeLabels[data.mode as keyof typeof modeLabels]}{" "}
            · Ufuk {data.horizon} gün · Ürün{" "}
            {data.products.find(p => p.id === data.productId)?.name ??
              "Bütün ürünler"}{" "}
            · Arama {data.search || "yok"}. {data.matched} eşleşen parti;
            tablo/CSV bu 50 satırlık sayfadır.
          </p>
          <button
            className="btn"
            onClick={() =>
              marketCsv(`skt-kontrol-${data.today}-sayfa.csv`, [
                [
                  "Güncel tarih",
                  data.today,
                  "Görüntü",
                  data.snapshot,
                  "Ufuk gün",
                  data.horizon,
                  "Durum",
                  data.mode,
                  "Ürün ID",
                  data.productId,
                  "Arama",
                  data.search,
                ],
                [
                  "Ürün ID",
                  "Güncel ad",
                  "Barkod",
                  "Temel birim",
                  "Parti ID",
                  "Güncel parti kodu",
                  "SKT",
                  "Kalan gün",
                  "Miktar",
                  "Durum",
                  "Satılabilir",
                  "Son durum kayıt UTC",
                  "Kaydeden",
                  "Son durum açıklaması",
                ],
                ...data.rows.map(l => [
                  l.productId,
                  l.name,
                  l.barcode,
                  l.unit,
                  l.id,
                  l.code,
                  l.expiryDate,
                  l.daysLeft,
                  l.quantity,
                  l.status,
                  l.saleable ? "Evet" : "Hayır",
                  l.lastStatusAt,
                  l.lastStatusBy,
                  l.lastStatusReason,
                ]),
              ])
            }
          >
            Bu SKT sayfasını CSV indir
          </button>
          <div className="ma-table-wrap">
            <table aria-label="Güncel SKT tablosu">
              <thead>
                <tr>
                  <th>Ürün / parti · güncel</th>
                  <th>SKT / kalan gün</th>
                  <th>Miktar</th>
                  <th>Durum</th>
                  <th>Son kayıtlı durum kontrolü</th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map(l => (
                  <tr key={l.id}>
                    <td>
                      {l.name}
                      <small>
                        {l.barcode} · {l.code}
                      </small>
                    </td>
                    <td>
                      {l.expiryDate ?? "Bilinmiyor"}
                      <small>
                        {l.daysLeft === null
                          ? "Fizikî etiket kontrolü gerekli"
                          : l.daysLeft === 0
                            ? "Bugün"
                            : l.daysLeft < 0
                              ? `${-l.daysLeft} gün geçmiş`
                              : `${l.daysLeft} gün kaldı`}
                      </small>
                    </td>
                    <td>
                      {l.quantity} {l.unit}
                    </td>
                    <td>
                      {l.status === "QUARANTINE"
                        ? "Karantina"
                        : "Satışa açık durum"}
                      <small>
                        {l.saleable ? "Satılabilir" : "Satışa kapalı"}
                      </small>
                    </td>
                    <td>
                      {l.lastStatusReason ??
                        "Son durum değişikliği açıklaması kaydı yok; kaynak işlemi inceleyin."}
                      <small>
                        {l.lastStatusBy}
                        {l.lastStatusAt
                          ? ` · ${new Date(l.lastStatusAt.replace(" ", "T") + "Z").toLocaleString("tr-TR", { timeZone: "Europe/Istanbul" })}`
                          : ""}
                      </small>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!data.rows.length && <p>Bu kapsamda stoklu parti yok.</p>}
          <div className="ma-row-actions">
            <button
              className="btn"
              disabled={!q.cursor}
              onClick={() =>
                setQ({ ...q, cursor: "", snapshot: data.snapshot })
              }
            >
              İlk SKT sayfası
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
              Sonraki SKT partileri
            </button>
          </div>
          <p className="ma-hint">
            Durum/miktar/kart değişirse eski sayfaya devam edilmez; raporu ilk
            sayfadan yenileyin. Kalıcı geçmiş görüntüsü değildir.
          </p>
        </>
      )}
    </>
  );
}
function LossHistory({
  stationId,
  today,
}: {
  stationId: string;
  today: string;
}) {
  const [from, setFrom] = useState(today.slice(0, 7) + "-01"),
    [to, setTo] = useState(today),
    [kind, setKind] = useState("ALL"),
    [productId, setProduct] = useState("");
  const [q, setQ] = useState({
      from,
      to,
      kind: "ALL",
      productId: "",
      cursor: "",
      asOf: "",
    }),
    [data, setData] = useState<LossReport | null>(null),
    [error, setError] = useState(""),
    [selected, setSelected] = useState<LossRow | null>(null),
    [products, setProducts] = useState<{ id: string; name: string }[]>([]);
  useEffect(() => {
    let active = true;
    setData(null);
    setSelected(null);
    setError("");
    loadInventoryLosses(
      stationId,
      q.from,
      q.to,
      q.kind,
      q.productId,
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
    if (data)
      setProducts(previous => [
        ...new Map(
          [...previous, ...data.products].map(p => [p.id, p])
        ).values(),
      ]);
  }, [data]);
  return (
    <>
      <h3>Kayıtlı fire ve sayım farkları</h3>
      <p>
        Parti firesi; parti, masaüstü ve terminal sayımından ayrıdır. Tutarlar
        kayıtlı fişten ve o işlemin snapshotından gelir.
      </p>
      <form
        className="mr-filters"
        onSubmit={e => {
          e.preventDefault();
          setQ({ from, to, kind, productId, cursor: "", asOf: "" });
        }}
      >
        <label>
          Başlangıç
          <input
            aria-label="Kayıp raporu başlangıç"
            type="date"
            value={from}
            onChange={e => setFrom(e.target.value)}
            required
          />
        </label>
        <label>
          Bitiş
          <input
            aria-label="Kayıp raporu bitiş"
            type="date"
            value={to}
            onChange={e => setTo(e.target.value)}
            required
          />
        </label>
        <label>
          Tür
          <select
            aria-label="Kayıp raporu türü"
            value={kind}
            onChange={e => setKind(e.target.value)}
          >
            <option value="ALL">Fire ve bütün sayımlar</option>
            <option value="WRITE_OFF">Yalnız parti firesi</option>
            <option value="COUNT">Yalnız sayım farkları</option>
          </select>
        </label>
        <label>
          Ürün · güncel ad
          <select
            aria-label="Kayıp raporu ürünü"
            value={productId}
            onChange={e => setProduct(e.target.value)}
          >
            <option value="">Bütün ürünler</option>
            {productId && !products.some(p => p.id === productId) && (
              <option value={productId}>
                Seçili ürün · bu aralıkta kayıt yok
              </option>
            )}
            {products.map(p => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        <button className="btn primary">
          Fire/sayım raporunu getir / yenile
        </button>
      </form>
      {error && (
        <p role="alert" className="ma-error">
          {error}
        </p>
      )}
      {!data && !error && <p role="status">Fire/sayım raporu yükleniyor…</p>}
      {data && (
        <>
          <p>
            {data.from}–{data.to} · Uygulanan tür{" "}
            {data.kind === "ALL"
              ? "Fire ve sayımlar"
              : data.kind === "WRITE_OFF"
                ? "Parti firesi"
                : "Sayım farkları"}{" "}
            · Ürün{" "}
            {data.products.find(p => p.id === data.productId)?.name ??
              (data.productId ? "Seçili ürün" : "Bütün ürünler")}{" "}
            · Kayıt sınırı {data.asOf}
          </p>
          <div className="ma-wallet-grid">
            <div>
              <span>Kayıtlı fiş / ürün satırı</span>
              <strong>
                {data.totals.entries} / {data.totals.productRows}
              </strong>
            </div>
            <div>
              <span>Parti firesi · maliyet</span>
              <strong>{money(data.totals.writeOffMinor)}</strong>
            </div>
            <div>
              <span>Sayım eksiği · maliyet</span>
              <strong>{money(data.totals.countLossMinor)}</strong>
            </div>
            <div>
              <span>Sayım fazlası · kayıtlı değer</span>
              <strong>{money(data.totals.countGainMinor)}</strong>
            </div>
          </div>
          <p className="ma-hint">
            Toplamlar bütün filtreli dönemdir; tablo/CSV 50 ürün satırlık bu
            sayfadır. Çok ürünlü sayım tek fiş, birden çok satırdır.
            Farksız/sıfır maliyetli kayıtlar da görünür. Yeni kayıtlar için
            yenileyin.
          </p>
          <button
            className="btn"
            onClick={() =>
              marketCsv(`fire-sayim-${data.from}-${data.to}-sayfa.csv`, [
                [
                  "Dönem",
                  data.from,
                  data.to,
                  "Kayıt sınırı",
                  data.asOf,
                  "Tür",
                  data.kind,
                  "Ürün ID",
                  data.productId,
                ],
                [
                  "Fiş ID",
                  "Sıra",
                  "İş günü",
                  "Tür",
                  "Kaydeden/onaylayan",
                  "Açıklama",
                  "Ürün ID",
                  "Ürün etiketi",
                  "Etiket kaynağı",
                  "Temel birim",
                  "Önce miktar",
                  "Sonra miktar",
                  "Fark",
                  "Fazla değer kuruş",
                  "Eksik/fire maliyet kuruş",
                  "Parti ID listesi",
                ],
                ...data.rows.map(r => [
                  r.entryId,
                  r.sequence,
                  r.date,
                  kindLabels[r.kind],
                  r.actorName,
                  r.reason,
                  r.productId,
                  r.name,
                  r.labelSource,
                  r.unit,
                  r.before,
                  r.after,
                  r.delta,
                  r.gainMinor,
                  r.lossMinor,
                  r.lots.map(l => l.id).join(" | "),
                ]),
              ])
            }
          >
            Bu fire/sayım sayfasını CSV indir
          </button>
          <div className="ma-table-wrap">
            <table aria-label="Fire ve sayım tablosu">
              <thead>
                <tr>
                  <th>Fiş / iş günü</th>
                  <th>Tür / ürün</th>
                  <th>Önce / sonra / fark</th>
                  <th>Fazla / eksik maliyet</th>
                  <th>Kaydeden/onaylayan / açıklama</th>
                  <th>Ayrıntı</th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map(r => (
                  <tr key={`${r.entryId}:${r.productId}`}>
                    <td>
                      #{r.sequence}
                      <small>{r.date}</small>
                    </td>
                    <td>
                      {kindLabels[r.kind]}
                      <small>
                        {r.name} ·{" "}
                        {r.labelSource === "SNAPSHOT"
                          ? "Kayıt anındaki etiket"
                          : r.labelSource === "CURRENT_CARD"
                            ? "Güncel kart etiketi"
                            : "Etiket yok"}
                      </small>
                    </td>
                    <td>
                      {r.before} / {r.after} / {r.delta} {r.unit}
                    </td>
                    <td>
                      {money(r.gainMinor)} / {money(r.lossMinor)}
                    </td>
                    <td>
                      {r.actorName}
                      <small>{r.reason}</small>
                    </td>
                    <td>
                      <button
                        className="btn"
                        aria-label={`Fiş ${r.sequence} ürün ${r.productId} kayıp ayrıntısı`}
                        onClick={() => setSelected(r)}
                      >
                        Kaydı incele
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!data.rows.length && <p>Bu kapsamda kayıtlı fire/sayım yok.</p>}
          <div className="ma-row-actions">
            <button
              className="btn"
              disabled={!q.cursor}
              onClick={() => setQ({ ...q, cursor: "", asOf: data.asOf })}
            >
              İlk kayıp sayfası
            </button>
            <button
              className="btn"
              disabled={!data.nextCursor}
              onClick={() =>
                setQ({ ...q, cursor: data.nextCursor!, asOf: data.asOf })
              }
            >
              Sonraki kayıp kayıtları
            </button>
          </div>
          {selected && (
            <section aria-label="Seçilen fire sayım kaydı">
              <h4>
                {kindLabels[selected.kind]} · #{selected.sequence}
              </h4>
              <p>
                {selected.reason} · {selected.actorName}
              </p>
              <p>
                Fiş: {selected.entryId} · Ürün: {selected.name} ·{" "}
                {selected.labelSource === "SNAPSHOT"
                  ? "Etiket kayıt anından"
                  : "Güncel kart/kimlik etiketi; geçmiş ad tahmin edilmedi"}
              </p>
              <p>
                Önce {selected.before}, sonra {selected.after}, fark{" "}
                {selected.delta} {selected.unit}. Kayıtlı fazla değer{" "}
                {money(selected.gainMinor)}, eksik/fire maliyeti{" "}
                {money(selected.lossMinor)}.
              </p>
              <p className="ma-hint">
                Maliyet ürün satırına aittir; çok partili sayımda parti
                miktarlarına tahminen dağıtılmaz. Parti etiketi güncelse görünen
                SKT/durum, işlem gününün durumu değildir.
              </p>
              <div className="ma-table-wrap">
                <table aria-label="Kayıp parti ayrıntıları">
                  <thead>
                    <tr>
                      <th>Parti / etiket kaynağı</th>
                      <th>SKT / durum</th>
                      <th>Önce / sonra / fark</th>
                    </tr>
                  </thead>
                  <tbody>
                    {selected.lots.map(l => (
                      <tr key={l.id}>
                        <td>
                          {l.code}
                          <small>
                            {l.id} ·{" "}
                            {l.labelSource === "SNAPSHOT"
                              ? "Kayıt anındaki etiket"
                              : "Güncel etiket / kimlik"}
                          </small>
                        </td>
                        <td>
                          {l.expiryDate ?? "Bilinmiyor"} /{" "}
                          {l.status === "QUARANTINE"
                            ? "Karantina"
                            : l.status === "AVAILABLE"
                              ? "Satışa açık durum"
                              : "Bilinmiyor"}
                        </td>
                        <td>
                          {l.before} / {l.after} / {l.delta}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {!selected.lots.length && (
                <p>
                  Kayıtlı parti ayrıntısı yok; adetler partilere tahminen
                  dağıtılmadı.
                </p>
              )}
              <button className="btn" onClick={() => setSelected(null)}>
                Kayıp ayrıntısını kapat
              </button>
            </section>
          )}
          <p className="ma-hint">
            Geçmiş ürün/parti etiketi saklanmamış kayıtta güncel etiket açıkça
            işaretlenir. Parti bazında mali filtre yoktur; çok partili sayımın
            maliyeti ürün düzeyindedir. Tarih/tür kapsamı en fazla 1.000 fiş ve
            20.000 ürün satırıdır; aşılırsa aralığı daraltın.
          </p>
        </>
      )}
    </>
  );
}

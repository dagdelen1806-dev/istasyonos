import { useEffect, useState } from "react";
import { money } from "@shared/station";
import type {
  DueAmounts,
  DueBucket,
  DueDocument,
  PartyDues,
} from "@shared/party-dues";
import { loadPartyDues } from "@/lib/station-api";
import { marketCsv } from "./MarketStatement";
const bucketNames: Record<DueBucket, string> = {
  OVER_90: "91+ gün gecikmiş",
  LATE_61_90: "61–90 gün gecikmiş",
  LATE_31_60: "31–60 gün gecikmiş",
  LATE_8_30: "8–30 gün gecikmiş",
  LATE_1_7: "1–7 gün gecikmiş",
  TODAY: "Bugün",
  FUTURE_1_7: "1–7 gün sonra",
  FUTURE_8_30: "8–30 gün sonra",
  FUTURE_31_90: "31–90 gün sonra",
  FUTURE_OVER_90: "91+ gün sonra",
  UNKNOWN: "Vadesi bilinmeyen",
};
const views = {
  ALL: "Bütün açık belgeler",
  OVERDUE: "Gecikenler",
  TODAY: "Bugün vadesi gelenler",
  NEXT7: "Yarından itibaren 7 gün",
  NEXT30: "Yarından itibaren 30 gün",
  NEXT90: "Yarından itibaren 90 gün",
  UNKNOWN: "Vadesi bilinmeyen",
};
const kinds: Record<string, string> = {
  PURCHASE: "Alış",
  CREDIT_SALE: "Veresiye satış",
  OPENING_AR: "Açılış alacağı",
  OPENING_AP: "Açılış borcu",
};
export function PartyDuesReports({ stationId }: { stationId: string }) {
  const [partyId, setPartyId] = useState(""),
    [direction, setDirection] = useState("ALL"),
    [view, setView] = useState("ALL");
  const [query, setQuery] = useState({
    partyId: "",
    direction: "ALL",
    view: "ALL",
    cursor: "",
    snapshot: "",
    reload: 0,
  });
  const [report, setReport] = useState<PartyDues | null>(null),
    [error, setError] = useState(""),
    [parties, setParties] = useState<PartyDues["parties"]>([]),
    [selected, setSelected] = useState<DueDocument | null>(null);
  useEffect(() => {
    let active = true;
    setReport(null);
    setError("");
    setSelected(null);
    loadPartyDues(stationId, query)
      .then(r => {
        if (active) {
          setReport(r);
          setParties(r.parties);
        }
      })
      .catch(e => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [stationId, query]);
  const scopeRows = report
    ? [
        ["Görüntü tarihi", report.today, "Oluşturulma UTC", report.generatedAt],
        [
          "Cari ID",
          report.partyId || "Hepsi",
          "Yön",
          report.direction,
          "Belge filtresi",
          report.view,
        ],
        ["Görüntü", report.snapshot],
      ]
    : [];
  function amounts(a: DueAmounts) {
    return (
      <>
        Alacak: {money(a.receivableMinor)}
        <br />
        Borç: {money(a.payableMinor)}
        <small>{a.documents} açık belge</small>
      </>
    );
  }
  return (
    <section className="ma-panel" aria-label="Cari vade ve ödeme takvimi">
      <h3>Cari vade ve ödeme takvimi</h3>
      <p className="ma-hint">
        Bugünkü açık belge tutarlarıdır; geçmiş tarihli bakiye değildir. Ödenen
        ve iadeyle mahsup edilen tutarlar düşülür. Vadeler ödeme/tahsilat
        beklentisini gösterir; gerçekleşmiş para hareketi veya yeni gelir/gider
        oluşturmaz. Açılış belgelerinde sistemin kaydettiği açılış günü
        kullanılır; eski borcun özgün vadesi farklı olabilir.
      </p>
      <form
        className="mr-filters"
        onSubmit={e => {
          e.preventDefault();
          setQuery({
            partyId,
            direction,
            view,
            cursor: "",
            snapshot: "",
            reload: query.reload + 1,
          });
        }}
      >
        <label>
          Cari
          <select
            aria-label="Vade raporu carisi"
            value={partyId}
            onChange={e => setPartyId(e.target.value)}
          >
            <option value="">Bütün cariler</option>
            {parties.map(p => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Yön
          <select
            aria-label="Vade raporu yönü"
            value={direction}
            onChange={e => setDirection(e.target.value)}
          >
            <option value="ALL">Alacak ve borç ayrı</option>
            <option value="AR">Müşteri alacakları</option>
            <option value="AP">Tedarikçi borçları</option>
          </select>
        </label>
        <label>
          Belge listesi
          <select
            aria-label="Vade belge filtresi"
            value={view}
            onChange={e => setView(e.target.value)}
          >
            {Object.entries(views).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </label>
        <button className="btn primary" type="submit">
          Vade raporunu getir / yenile
        </button>
      </form>
      {error && (
        <p className="ma-error" role="alert">
          {error}
        </p>
      )}
      {!report && !error && <p role="status">Vade raporu yükleniyor…</p>}
      {report && (
        <>
          <p>
            Gün: {report.today} (İstanbul) · Uygulanan cari:{" "}
            {report.parties.find(p => p.id === report.partyId)?.name ?? "Hepsi"}{" "}
            · Yön:{" "}
            {report.direction === "ALL"
              ? "Alacak ve borç ayrı"
              : report.direction === "AR"
                ? "Alacak"
                : "Borç"}{" "}
            · Belge filtresi: {views[report.view]}
          </p>
          <p className="ma-hint">
            Kartlar, yaşlandırma ve takvim seçilen cari/yönün bütün açık
            belgelerini kapsar. Belge filtresi yalnız aşağıdaki belge listesini
            daraltır. Aynı carinin alacağı ve borcu birbirinden düşülmez.
          </p>
          <div className="ma-wallet-grid">
            {[
              ["Toplam açık", report.totals],
              ["Gecikmiş", report.overdue],
              ["Bugün vadesi gelen", report.todayDue],
              ["Vadesi bilinmeyen", report.unknown],
            ].map(([label, a]) => (
              <article className="ma-panel" key={label as string}>
                <h4>{label as string}</h4>
                {amounts(a as DueAmounts)}
              </article>
            ))}
          </div>
          <h4>Açık tutar yaşlandırması</h4>
          <button
            className="btn"
            onClick={() =>
              marketCsv("cari-yaslandirma.csv", [
                ...scopeRows,
                [
                  "Kapsam",
                  "Seçilen cari/yönün bütün açık belgeleri; belge filtresi uygulanmaz",
                ],
                ["Vade dilimi", "Alacak kuruş", "Borç kuruş", "Belge"],
                ...report.aging.map(a => [
                  bucketNames[a.bucket],
                  a.amounts.receivableMinor,
                  a.amounts.payableMinor,
                  a.amounts.documents,
                ]),
              ])
            }
          >
            Yaşlandırma CSV indir
          </button>
          <div className="ma-table-wrap">
            <table aria-label="Cari yaşlandırma">
              <thead>
                <tr>
                  <th>Vade dilimi</th>
                  <th>Alacak</th>
                  <th>Borç</th>
                  <th>Belge</th>
                </tr>
              </thead>
              <tbody>
                {report.aging.map(a => (
                  <tr key={a.bucket}>
                    <td>{bucketNames[a.bucket]}</td>
                    <td>{money(a.amounts.receivableMinor)}</td>
                    <td>{money(a.amounts.payableMinor)}</td>
                    <td>{a.amounts.documents}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <h4>Bugün ve sonraki 90 günün vade takvimi</h4>
          <p className="ma-hint">
            Yalnız kayıtlı açık belgeler; gecikmiş/bilinmeyen vadeler ve 90
            günden sonrası bu takvimde yoktur. Alacaklar banka bakiyesi veya
            kesin tahsilat değildir.
          </p>
          <button
            className="btn"
            onClick={() =>
              marketCsv("cari-vade-takvimi.csv", [
                ...scopeRows,
                [
                  "Kapsam",
                  "Bugün ve sonraki 90 gün; seçilen cari/yön, belge filtresi uygulanmaz",
                ],
                ["Vade günü", "Alacak kuruş", "Borç kuruş", "Belge"],
                ...report.calendar.map(a => [
                  a.date,
                  a.amounts.receivableMinor,
                  a.amounts.payableMinor,
                  a.amounts.documents,
                ]),
              ])
            }
          >
            Vade takvimi CSV indir
          </button>
          <div className="ma-table-wrap">
            <table aria-label="Cari vade takvimi">
              <thead>
                <tr>
                  <th>Vade günü</th>
                  <th>Beklenen tahsilat</th>
                  <th>Beklenen ödeme</th>
                  <th>Belge</th>
                </tr>
              </thead>
              <tbody>
                {report.calendar
                  .filter(a => a.amounts.documents > 0)
                  .map(a => (
                    <tr key={a.date}>
                      <td>{a.date}</td>
                      <td>{money(a.amounts.receivableMinor)}</td>
                      <td>{money(a.amounts.payableMinor)}</td>
                      <td>{a.amounts.documents}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
          {!report.calendar.some(a => a.amounts.documents) && (
            <p>Bu takvim aralığında açık belge yok.</p>
          )}
          <h4>Açık belgeler · {report.matched} eşleşme</h4>
          <button
            className="btn"
            onClick={() =>
              marketCsv("cari-vade-belgeler-sayfa.csv", [
                ...scopeRows,
                ["Kapsam", "Yalnız görünen en fazla 50 belge"],
                [
                  "Belge ID",
                  "Cari ID",
                  "Güncel cari adı",
                  "Yön",
                  "Tür",
                  "Referans",
                  "Vade",
                  "Vade dilimi",
                  "Belge kuruş",
                  "Ödenen kuruş",
                  "İade mahsup kuruş",
                  "Açık kuruş",
                ],
                ...report.rows.map(d => [
                  d.id,
                  d.partyId,
                  d.partyName,
                  d.direction,
                  kinds[d.kind],
                  d.reference,
                  d.dueDate ?? "Bilinmiyor",
                  bucketNames[d.bucket],
                  d.totalMinor,
                  d.settledMinor,
                  d.creditedMinor,
                  d.remainingMinor,
                ]),
              ])
            }
          >
            Bu vade sayfasını CSV indir
          </button>
          <div className="ma-table-wrap">
            <table aria-label="Açık vade belgeleri">
              <thead>
                <tr>
                  <th>Cari / belge</th>
                  <th>Yön</th>
                  <th>Vade</th>
                  <th>Açık tutar</th>
                  <th>Ayrıntı</th>
                </tr>
              </thead>
              <tbody>
                {report.rows.map(d => (
                  <tr key={d.id}>
                    <td>
                      {d.partyName}
                      <small>
                        {kinds[d.kind]} · {d.reference}
                      </small>
                    </td>
                    <td>{d.direction === "AR" ? "Alacak" : "Borç"}</td>
                    <td>
                      {d.dueDate ?? "Bilinmiyor"}
                      <small>{bucketNames[d.bucket]}</small>
                    </td>
                    <td>{money(d.remainingMinor)}</td>
                    <td>
                      <button className="btn" onClick={() => setSelected(d)}>
                        Belge ayrıntısı · {d.reference}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!report.rows.length && <p>Bu filtrede açık belge yok.</p>}
          <div className="ma-row-actions">
            <button
              className="btn"
              disabled={!query.cursor}
              onClick={() =>
                setQuery({ ...query, cursor: "", snapshot: report.snapshot })
              }
            >
              İlk vade sayfası
            </button>
            <button
              className="btn"
              disabled={!report.nextCursor}
              onClick={() =>
                setQuery({
                  ...query,
                  cursor: report.nextCursor!,
                  snapshot: report.snapshot,
                })
              }
            >
              Sonraki vade belgeleri
            </button>
          </div>
          <p className="ma-hint">
            50 belgeli sayfalama ve sayfa CSV. Yeni ödeme/iade veya cari
            değişikliğinde raporu yenileyin. Cari adları güncel karttır. Gerçek
            ödeme/tahsilat için mevcut Market muhasebe ekranındaki yetkili,
            teyitli işlemi kullanın.
          </p>
          {selected && (
            <section className="ma-panel" aria-label="Seçilen vade belgesi">
              <button className="btn" onClick={() => setSelected(null)}>
                Belge ayrıntısını kapat
              </button>
              <h4>
                {selected.partyName} · {selected.reference}
              </h4>
              <p>
                Belge ID: {selected.id} · Cari ID: {selected.partyId}
              </p>
              <p>
                Belge tutarı: {money(selected.totalMinor)} · Ödenen:{" "}
                {money(selected.settledMinor)} · İade mahsubu:{" "}
                {money(selected.creditedMinor)} · Kalan:{" "}
                {money(selected.remainingMinor)}
              </p>
              <p>
                {selected.dueDate ?? "Vade bilinmiyor"} ·{" "}
                {bucketNames[selected.bucket]}
              </p>
            </section>
          )}
        </>
      )}
    </section>
  );
}

import { useEffect, useRef, useState } from "react";
import { FileDown, RefreshCw } from "lucide-react";
import type { MonthlyReport } from "@shared/inventory";
import { money } from "@shared/station";
import { loadMonthlyReport } from "@/lib/station-api";
import { marketCsv } from "./MarketStatement";
import { marketAccounts } from "@shared/market-accounting";
export function MonthlyMarketReport({
  stationId,
  today,
}: {
  stationId: string;
  today: string;
}) {
  const [month, setMonth] = useState(today.slice(0, 7)),
    [data, setData] = useState<MonthlyReport | null>(null),
    [error, setError] = useState(""),
    [selected, setSelected] = useState(today),
    [loading, setLoading] = useState(false);
  const seq = useRef(0);
  async function refresh() {
    const id = ++seq.current;
    setLoading(true);
    try {
      const next = await loadMonthlyReport(stationId, month);
      if (id === seq.current) {
        setData(next);
        setError("");
      }
    } catch (e) {
      if (id === seq.current) setError((e as Error).message);
    } finally {
      if (id === seq.current) setLoading(false);
    }
  }
  useEffect(() => {
    void refresh();
    return () => {
      seq.current++;
    };
  }, [stationId, month]);
  const rows = [
    ["netSalesMinor", "İade sonrası net satış"],
    ["cogsMinor", "Satılan mal maliyeti"],
    ["grossProfitMinor", "Brüt kâr"],
    ["expensesMinor", "Gider / komisyon / stok-kasa eksikleri"],
    ["gainsMinor", "Stok-kasa fazlası / maliyet farkı geliri"],
    ["resultMinor", "Kayıtlı faaliyet sonucu"],
    ["salesReturnsMinor", "Satış iadeleri · KDV dahil"],
    ["netPurchasesMinor", "İade sonrası alış · KDV hariç"],
    ["inputVatMinor", "Alış/gider KDV"],
    ["outputVatMinor", "Net satış KDV"],
    ["collectionsMinor", "Cari tahsilat · gelir değildir"],
    ["paymentsMinor", "Tedarikçi ödemesi · ikinci gider değildir"],
  ] as const;
  const day = data?.days.find(d => d.date === selected),
    maximum = Math.max(
      1,
      ...(data?.days.map(d => Math.abs(d.resultMinor)) ?? [1])
    );
  return (
    <section className="ma-panel">
      <div className="ma-panel-head">
        <div>
          <h2>Aylık kâr–zarar ve stok sonucu</h2>
          <p>İadeler ve kaydedilmiş giderlerle, KDV hariç faaliyet hesabı.</p>
        </div>
        <div className="ma-row-actions">
          <label>
            Rapor ayı
            <input
              type="month"
              aria-label="Kâr zarar rapor ayı"
              value={month}
              onChange={e => {
                if (e.target.value) setMonth(e.target.value);
              }}
            />
          </label>
          <button
            className="btn"
            disabled={loading}
            onClick={() => void refresh()}
          >
            <RefreshCw size={16} />
            Yenile
          </button>
        </div>
      </div>
      {error && (
        <p role="alert" className="ma-error">
          {error}
        </p>
      )}
      {loading && <p role="status">Aylık rapor yükleniyor…</p>}
      {data && !loading && (
        <>
          <p className="ma-hint">
            {data.from}–{data.to} · {data.closedDays}/{data.totalDays} gün sonu
            kayıtlı · Defter başlangıcı {data.startedOn ?? "yok"}. Defter öncesi
            hareketler bu rapora dahil değildir.
          </p>
          <div className="ma-wallet-grid">
            <div>
              <span>Net satış</span>
              <strong>{money(data.totals.netSalesMinor)}</strong>
            </div>
            <div>
              <span>Brüt kâr</span>
              <strong>{money(data.totals.grossProfitMinor)}</strong>
            </div>
            <div>
              <span>Faaliyet sonucu</span>
              <strong
                className={data.totals.resultMinor < 0 ? "ma-error" : "ma-good"}
              >
                {money(data.totals.resultMinor)}
              </strong>
            </div>
            <div>
              <span>Önceki aya fark</span>
              <strong>
                {money(data.totals.resultMinor - data.previous.resultMinor)}
              </strong>
            </div>
          </div>
          <h3>Günlere göre faaliyet sonucu</h3>
          <p className="ma-hint">
            Güne dokunarak satış, maliyet ve giderini inceleyin.
          </p>
          <svg
            className="mi-profit-chart"
            viewBox="0 0 680 200"
            role="group"
            aria-label="Aylık günlük kâr zarar grafiği"
          >
            <line x1="20" y1="95" x2="660" y2="95" stroke="#aac2b9" />
            {data.days.map((d, i) => {
              const height = (Math.abs(d.resultMinor) / maximum) * 75,
                x = 23 + i * (630 / data.days.length);
              return (
                <g
                  key={d.date}
                  tabIndex={0}
                  role="button"
                  aria-label={`${d.date}: ${money(d.resultMinor)}`}
                  onClick={() => setSelected(d.date)}
                  onKeyDown={e => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      setSelected(d.date);
                    }
                  }}
                >
                  <title>
                    {d.date}: {money(d.resultMinor)}
                  </title>
                  <rect
                    x={x - 1}
                    y="10"
                    width={630 / data.days.length - 1}
                    height="182"
                    fill="transparent"
                  />
                  <rect
                    x={x}
                    y={d.resultMinor < 0 ? 95 : 95 - height}
                    width={Math.max(8, 630 / data.days.length - 4)}
                    height={Math.max(2, height)}
                    rx="2"
                    fill={d.resultMinor < 0 ? "#c16a51" : "#118366"}
                    stroke={selected === d.date ? "#112e29" : "none"}
                    strokeWidth="2"
                  />
                  <text x={x + 4} y="189" fontSize="9" fill="#536b65">
                    {i % 2 === 0 ? d.date.slice(8) : ""}
                  </text>
                </g>
              );
            })}
          </svg>
          {day && (
            <div className="notice">
              {day.date} · Net satış {money(day.netSalesMinor)} · Maliyet{" "}
              {money(day.cogsMinor)} · Gider {money(day.expensesMinor)} · Sonuç{" "}
              {money(day.resultMinor)}
            </div>
          )}
          <div className="ma-table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Hesap</th>
                  <th>{data.month}</th>
                  <th>{data.previousMonth}</th>
                  <th>Fark</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(([key, label]) => (
                  <tr key={key}>
                    <td>{label}</td>
                    <td>{money(data.totals[key])}</td>
                    <td>{money(data.previous[key])}</td>
                    <td>{money(data.totals[key] - data.previous[key])}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <button
            className="btn"
            onClick={() =>
              marketCsv(`market-kar-zarar-${month}.csv`, [
                ["Hesap", month, data.previousMonth, "Fark TL"],
                ...rows.map(([k, l]) => [
                  l,
                  data.totals[k] / 100,
                  data.previous[k] / 100,
                  (data.totals[k] - data.previous[k]) / 100,
                ]),
              ])
            }
          >
            <FileDown size={16} />
            Aylık karşılaştırmayı CSV indir
          </button>
          <h3>Dönem sonu defter bakiyeleri</h3>
          <div className="ma-wallet-grid">
            {(["CASH_SAFE", "BANK", "CARD_CLEARING", "INVENTORY"] as const).map(
              code => (
                <div key={code}>
                  <span>{marketAccounts[code]}</span>
                  <strong>{money(data.balances[code] ?? 0)}</strong>
                </div>
              )
            )}
          </div>
          <h3>Ürün bazında net satış ve brüt kâr</h3>
          <div className="ma-table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Ürün</th>
                  <th>Net adet</th>
                  <th>Net satış</th>
                  <th>Maliyet</th>
                  <th>Brüt kâr</th>
                  <th>Marj</th>
                </tr>
              </thead>
              <tbody>
                {data.products.map(p => (
                  <tr key={p.id}>
                    <td>{p.name}</td>
                    <td>{p.quantity}</td>
                    <td>{money(p.netSalesMinor)}</td>
                    <td>{money(p.costMinor)}</td>
                    <td>{money(p.profitMinor)}</td>
                    <td>
                      {p.netSalesMinor > 0
                        ? `%${((100 * p.profitMinor) / p.netSalesMinor).toFixed(1)}`
                        : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <button
            className="btn"
            onClick={() =>
              marketCsv(`market-urun-kar-${month}.csv`, [
                [
                  "Ürün",
                  "Net adet",
                  "Net satış TL",
                  "Maliyet TL",
                  "Brüt kâr TL",
                ],
                ...data.products.map(p => [
                  p.name,
                  p.quantity,
                  p.netSalesMinor / 100,
                  p.costMinor / 100,
                  p.profitMinor / 100,
                ]),
              ])
            }
          >
            <FileDown size={16} />
            Görünen ürün raporunu CSV indir
          </button>
          <p className="ma-hint">
            Ürün listesi brüt kâra göre ilk 100 üründür; aylık toplamlar tüm
            fişleri içerir. Faaliyet sonucu, kaydedilmiş giderlerle hesaplanır;
            resmî bilanço, gelir vergisi veya otomatik amortisman hesabı
            değildir. Alışın tamamı gider sayılmaz; satılan miktarın maliyeti
            düşülür.
          </p>
        </>
      )}
    </section>
  );
}

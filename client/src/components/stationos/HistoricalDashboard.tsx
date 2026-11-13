import { useEffect, useState } from "react";
import type { AppState } from "@shared/station";
import type { Dashboard } from "@shared/dashboard";
import { turkeyToday } from "@shared/datetime";
import { litres } from "@shared/fuel";
import { Panel, Field, Notice } from "./Common";
const money = (n: number) =>
  (n / 100).toLocaleString("tr-TR", { style: "currency", currency: "TRY" });
export function HistoricalDashboard({
  state,
  stationId,
}: {
  state: AppState;
  stationId: string;
}) {
  const [to, setTo] = useState(turkeyToday()),
    [from, setFrom] = useState(
      new Date(Date.now() - 59 * 86400000).toLocaleDateString("en-CA", {
        timeZone: "Europe/Istanbul",
      })
    ),
    [data, setData] = useState<Dashboard | null>(null),
    [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    setError("");
    setData(null);
    fetch(
      "/api/stationos/dashboard?" +
        new URLSearchParams({ from, to, ...(stationId ? { stationId } : {}) }),
      { credentials: "include", cache: "no-store", signal: controller.signal }
    )
      .then(async r => {
        const value = await r.json();
        if (!r.ok)
          throw Error(value.error?.message ?? "Gösterge verileri alınamadı.");
        setData(value);
      })
      .catch(e => {
        if (!controller.signal.aborted) setError(e.message);
      });
    return () => controller.abort();
  }, [state, stationId, from, to]);
  return (
    <Panel title="Tarihsel işletme yönetim paneli">
      <Notice>
        {state.tenant?.isDemo ? "DEMO/SİMÜLASYON · " : ""}Satış ve litreler
        seçilen dönemde iki onayı tamamlanmış hesaplardan hesaplanır. Kasa,
        stok, alacak ve bekleyenler güncel durumu gösterir. Banka/POS teyidi
        veya mali defter değildir.
      </Notice>
      <div className="form-grid two">
        <Field label="Başlangıç günü">
          <input
            name="dashboardFrom"
            type="date"
            value={from}
            onChange={e => setFrom(e.target.value)}
          />
        </Field>
        <Field label="Bitiş günü">
          <input
            name="dashboardTo"
            type="date"
            value={to}
            onChange={e => setTo(e.target.value)}
          />
        </Field>
      </div>
      <Field label="Aylık dönem seç">
        <input
          name="dashboardMonth"
          type="month"
          onChange={e => {
            if (!/^\d{4}-\d{2}$/.test(e.target.value)) return;
            const [year, month] = e.target.value.split("-").map(Number);
            setFrom(e.target.value + "-01");
            setTo(
              new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10)
            );
          }}
        />
      </Field>
      {error && <Notice warning>{error}</Notice>}
      {data ? (
        <>
          <div className="metric-grid demo-dashboard-metrics">
            {[
              ["Dönem cirosu", money(data.totals.revenueMinor)],
              [
                "Seçili son gün cirosu",
                money(
                  data.days.find(d => d.day === data.to)?.revenueMinor ?? 0
                ),
              ],
              ["Dönem litre satışı", litres(data.totals.litresMl) + " L"],
              ["Güncel tank stoku", litres(data.current.stockMl) + " L"],
              [
                "Tank ölçüm farkı (mutlak toplam)",
                litres(data.current.absoluteStockDifferenceMl) + " L",
              ],
              ["Aktif vardiya", String(data.current.activeShifts)],
              ["Açık hesaplarda beklenen kasa", money(data.current.cashMinor)],
              ["Güncel cari alacak", money(data.current.receivableMinor)],
              [
                "Bekleyen hesap / tank onayı",
                data.current.pendingAccounts +
                  " / " +
                  data.current.pendingTankRequests,
              ],
              [
                "Açık hesap mutabakat farkı",
                money(data.current.differenceMinor),
              ],
              ["Özel işlem taslakları", String(data.current.draftOperations)],
            ].map(([label, value]) => (
              <div key={label} className="metric-card">
                <small>{label}</small>
                <h3>{value}</h3>
              </div>
            ))}
          </div>
          <p>
            Eksik veya eski fiziksel ölçüm: {data.current.unknownMeasurements} ·
            Stoku bilinmeyen tank: {data.current.unknownTanks}. Litre farkı
            yalnız güncel fiziksel ölçümlerden hesaplanır.
          </p>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Gün</th>
                  <th>Ciro</th>
                  <th>Litre</th>
                  <th>Nakit</th>
                  <th>Manuel POS beyanı</th>
                  <th>Cari satış</th>
                  <th>IBAN beyanÄ± (teyitsiz)</th>
                  <th>FAST beyanÄ± (teyitsiz)</th>
                </tr>
              </thead>
              <tbody>
                {data.days.map(d => (
                  <tr key={d.day}>
                    <td>{d.day}</td>
                    <td>{money(d.revenueMinor)}</td>
                    <td>{litres(d.litresMl)} L</td>
                    <td>{money(d.cashMinor)}</td>
                    <td>{money(d.cardMinor)}</td>
                    <td>{money(d.debtMinor)}</td>
                    <td>{money(d.ibanMinor)}</td>
                    <td>{money(d.fastMinor)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : (
        !error && <p>Gerçek veritabanı kayıtları hesaplanıyor…</p>
      )}
    </Panel>
  );
}

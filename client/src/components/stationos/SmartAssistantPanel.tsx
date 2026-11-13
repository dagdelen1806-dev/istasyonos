import { useEffect, useRef, useState } from "react";
import type { AppState } from "@shared/station";
import type {
  SmartAssistantReport,
  AssistantExplanation,
} from "@shared/smart-assistant";
import { turkeyToday } from "@shared/datetime";
import { litres } from "@shared/fuel";
import { mutate } from "@/lib/station-api";
import { Panel, Field, Notice } from "./Common";

const money = (n: number) =>
  (n / 100).toLocaleString("tr-TR", { style: "currency", currency: "TRY" });
export function SmartAssistantPanel({
  state,
  stationId,
}: {
  state: AppState;
  stationId: string;
}) {
  const [companyId, setCompanyId] = useState(""),
    [from, setFrom] = useState(
      new Date(Date.parse(turkeyToday() + "T12:00:00Z") - 59 * 86400000)
        .toISOString()
        .slice(0, 10)
    ),
    [to, setTo] = useState(turkeyToday());
  const [report, setReport] = useState<SmartAssistantReport | null>(null),
    [explanation, setExplanation] = useState<AssistantExplanation | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const generation = useRef(0);
  useEffect(() => {
    const controller = new AbortController(),
      version = ++generation.current;
    setReport(null);
    setExplanation(null);
    setError("");
    setBusy(false);
    const filters = {
      from,
      to,
      ...(companyId ? { companyId } : {}),
      ...(stationId ? { stationId } : {}),
    };
    fetch("/api/stationos/assistant/report?" + new URLSearchParams(filters), {
      credentials: "include",
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async r => {
        const value = await r.json();
        if (!r.ok)
          throw Error(value.error?.message ?? "Asistan raporu alınamadı.");
        if (generation.current === version && !controller.signal.aborted)
          setReport(value.report);
      })
      .catch(e => {
        if (!controller.signal.aborted && generation.current === version)
          setError(e.message);
      });
    return () => {
      controller.abort();
      generation.current++;
    };
  }, [state, stationId, companyId, from, to]);
  async function explain() {
    const version = generation.current;
    setBusy(true);
    setError("");
    try {
      const result = await mutate(
        "/assistant/explain",
        {
          from,
          to,
          ...(companyId ? { companyId } : {}),
          ...(stationId ? { stationId } : {}),
          externalConfirmed: true,
        },
        crypto.randomUUID(),
        state.csrfToken
      );
      if (version === generation.current) {
        setReport(result.report);
        setExplanation(result.explanation);
      }
    } catch (e) {
      if (version === generation.current)
        setError(
          e instanceof Error
            ? e.message
            : "Açıklama alınamadı; yerel rapor korundu."
        );
    } finally {
      if (version === generation.current) setBusy(false);
    }
  }
  return (
    <Panel
      title="Akıllı Asistan"
      subtitle="Deterministik işletme analizi · Faz 5A"
    >
      <div data-testid="smart-assistant">
        <Notice>
          {state.tenant?.isDemo ? "DEMO · " : ""}Dönem satışları vardiya gününe,
          cari tahsilatlar ödeme kayıt gününe göredir (Türkiye saati). Stok,
          cari bakiye ve bekleyen onaylar günceldir. Bu rapor banka teyidi veya
          mali defter değildir.
        </Notice>
        <div className="form-grid two">
          <Field label="Şirket">
            <select
              aria-label="Asistan şirket"
              value={companyId}
              onChange={e => setCompanyId(e.target.value)}
            >
              <option value="">Yetkili şirketler</option>
              {state.companies.map(c => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="İstasyon kapsamı">
            <p>
              {stationId
                ? state.stations.find(s => s.id === stationId)?.name
                : "Üst menüdeki tüm yetkili istasyonlar"}
            </p>
          </Field>
          <Field label="Başlangıç">
            <input
              aria-label="Asistan başlangıç"
              type="date"
              value={from}
              onChange={e => setFrom(e.target.value)}
            />
          </Field>
          <Field label="Bitiş">
            <input
              aria-label="Asistan bitiş"
              type="date"
              value={to}
              onChange={e => setTo(e.target.value)}
            />
          </Field>
        </div>
        {error && <Notice warning>{error}</Notice>}
        {!report && !error && <p>Yetkili kayıtlar hesaplanıyor…</p>}
        {report && (
          <>
            <div className="metric-grid">
              {[
                [
                  "Dönem operasyonel satışı",
                  money(report.dashboard.totals.revenueMinor),
                ],
                [
                  "Sayaç litresi",
                  litres(report.dashboard.totals.litresMl) + " L",
                ],
                ["Dönem cari tahsilatı", money(report.collectionsMinor)],
                [
                  "Güncel stok",
                  litres(report.dashboard.current.stockMl) + " L",
                ],
                [
                  "Güncel cari alacak",
                  money(report.dashboard.current.receivableMinor),
                ],
              ].map(([label, value]) => (
                <div className="metric-card" key={label}>
                  <small>{label}</small>
                  <h3>{value}</h3>
                </div>
              ))}
            </div>
            <p data-testid="assistant-provider">
              {explanation?.message ??
                (report.geminiAvailable
                  ? "Yerel rapor hazır. Gemini yalnız anonim sayısal özeti açıklayabilir."
                  : "Yerel rapor hazır. Gemini bağlantısı kapalı; hesaplamalar çalışmaya devam ediyor.")}
            </p>
            <button
              type="button"
              disabled={!report.geminiAvailable || busy}
              onClick={explain}
            >
              {busy
                ? "Açıklama hazırlanıyor…"
                : "Anonim özeti Gemini ile açıkla"}
            </button>
            <small>
              {" "}
              Harici gönderim yalnız bu düğmeyle yapılır. Ad, kimlik, kaynak
              kayıt numarası, belge ve serbest metin gönderilmez. Yapay zekâ
              sorgu veya kayıt değiştiremez.
            </small>
            <p>
              Önem sırası: yüksek → orta → bilgi. Kaynak örnekleri her bulguda
              en fazla 10; adet ve toplamlar tüm kapsamdan hesaplanır.
            </p>
            {report.findings.length === 0 && (
              <p>Seçili kapsamda raporlanacak kayıt bulunamadı.</p>
            )}
            {report.findings.map(f => {
              const ai =
                explanation?.mode === "GEMINI"
                  ? explanation.suggestions.find(s => s.code === f.code)
                  : null;
              return (
                <article key={f.code} data-finding={f.code}>
                  <h3>
                    {f.severity === "HIGH"
                      ? "Yüksek"
                      : f.severity === "MEDIUM"
                        ? "Orta"
                        : "Bilgi"}{" "}
                    · {f.title}
                  </h3>
                  <p>
                    {f.period === "CURRENT" ? "Güncel durum" : "Seçili dönem"} ·{" "}
                    {f.count} kayıt
                  </p>
                  <p>
                    <b>Hesaplama:</b> {f.formula}
                  </p>
                  <p>
                    {Object.entries(f.metrics)
                      .map(
                        ([key, value]) =>
                          `${key}: ${key.endsWith("Minor") ? money(value) : key.endsWith("Ml") ? litres(value) + " L" : value}`
                      )
                      .join(" · ")}
                  </p>
                  <p>
                    <b>Yerel öneri:</b> {f.recommendation}
                  </p>
                  {ai && (
                    <Notice>
                      <b>Gemini önerisi (doğrulanmalıdır):</b> {ai.explanation}{" "}
                      {ai.recommendation}
                    </Notice>
                  )}
                  <details>
                    <summary>
                      Kaynak kayıtlar ({f.sources.length}/{f.count})
                    </summary>
                    <div className="table-wrap">
                      <table>
                        <thead>
                          <tr>
                            <th>Kaynak türü / kayıt</th>
                            <th>İstasyon</th>
                            <th>Kaynak değerler (Minor=kuruş, Ml=mililitre)</th>
                          </tr>
                        </thead>
                        <tbody>
                          {f.sources.map(s => (
                            <tr key={s.id}>
                              <td>
                                {s.type}
                                <br />
                                <code>{s.id}</code>
                              </td>
                              <td>
                                {state.stations.find(x => x.id === s.stationId)
                                  ?.name ?? s.stationId}
                              </td>
                              <td>
                                {Object.entries(s.values)
                                  .map(([k, v]) => `${k}: ${v ?? "bilinmiyor"}`)
                                  .join(" · ")}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </details>
                </article>
              );
            })}
            <small>
              Hesaplama zamanı:{" "}
              {new Date(report.generatedAt).toLocaleString("tr-TR")} ·{" "}
              {report.scope.stationIds.length} yetkili istasyon ·{" "}
              {report.dashboard.from}–{report.dashboard.to}
            </small>
          </>
        )}
      </div>
    </Panel>
  );
}

import { useEffect, useState, type FormEvent } from "react";
import type { AppState } from "@shared/station";
import { litres, parseLitres } from "@shared/fuel";
import {
  fillPercent,
  validationWarnings,
  type PhotoTank,
  type PhotoReview,
  type ValidationCard,
  type analyzePhotoTank,
} from "@shared/tank-validation";
import { Panel, Field, Notice } from "./Common";
type Row = {
  source: PhotoTank;
  analysis: ReturnType<typeof analyzePhotoTank>;
  review: PhotoReview | null;
};
type Data = {
  documents: { id: string; sourceName: string; hasPhoto: boolean }[];
  document: null | {
    id: string;
    sourceName: string;
    displayedAt: string;
    hasPhoto: boolean;
  };
  rows: Row[];
  cards: ValidationCard[];
};
type Props = {
  state: AppState;
  stationId: string;
  busy: boolean;
  onAction: (
    path: string,
    payload: Record<string, unknown>
  ) => Promise<boolean>;
};
const input = (ml: number | null) =>
  ml === null ? "" : (ml / 1000).toFixed(3).replace(".", ",");
const sourceL = (n: number | null | undefined) =>
  n == null
    ? "Bilinmiyor"
    : n.toLocaleString("tr-TR", { maximumFractionDigits: 3 }) + " L";
export function TankValidationPanel({
  state,
  stationId,
  busy,
  onAction,
}: Props) {
  const [data, setData] = useState<Data | null>(null),
    [documentId, setDocumentId] = useState(""),
    [rowNumber, setRowNumber] = useState(""),
    [loading, setLoading] = useState(false),
    [error, setError] = useState(""),
    [version, setVersion] = useState(0);
  const station = stationId || state.stations[0]?.id || "",
    allowed = ["OWNER", "MANAGER"].includes(state.member?.role || "");
  useEffect(() => {
    let active = true;
    setData(null);
    setError("");
    if (!allowed || !state.tenant?.isDemo || !station) return;
    setLoading(true);
    const q = new URLSearchParams({
      stationId: station,
      ...(documentId ? { documentId } : {}),
    });
    fetch("/api/stationos/tank/photo-validation?" + q, {
      credentials: "include",
      cache: "no-store",
    })
      .then(async r => {
        const d = await r.json();
        if (!r.ok) throw Error(d.error?.message || "Taslak okunamadı.");
        if (active) setData(d);
      })
      .catch(e => {
        if (active) setError(e.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [station, allowed, state, documentId, version]);
  const row =
      data?.rows.find(r => r.source.number === rowNumber) ?? data?.rows[0],
    proposal = row?.review?.proposal ?? row?.analysis.proposal;
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!row || !data?.document) return;
    const f = Object.fromEntries(new FormData(e.currentTarget)) as Record<
      string,
      string
    >;
    setError("");
    try {
      const saved = await onAction("/tank/photo-review", {
        stationId: station,
        documentId: data.document.id,
        rowNumber: row.source.number,
        expectedRevision: row.review?.revision ?? 0,
        decision: f.decision,
        tankId: f.tankId || null,
        basis: f.basis,
        capacityMl: f.capacity ? parseLitres(f.capacity) : null,
        volumeMl: f.basis !== "BOTH" && f.volume ? parseLitres(f.volume) : null,
        productMl: f.product ? parseLitres(f.product) : null,
        netMl: f.net ? parseLitres(f.net) : null,
        sourceConfirmed: f.sourceConfirmed === "on",
        warningsAcknowledged: f.warningsAcknowledged === "on",
        note: f.note,
        evidence: f.evidence,
      });
      if (saved) setVersion(v => v + 1);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  if (!allowed)
    return (
      <Notice warning>
        Fotoğraf doğrulaması için firma sahibi veya yönetici yetkisi gerekir.
      </Notice>
    );
  if (!state.tenant?.isDemo)
    return (
      <Notice warning>
        Bu ekran yalnız DEMO taslak verileri içindir; onaylı stoklara yazmaz.
      </Notice>
    );
  return (
    <div className="tank-validation-panel">
      <Notice>
        Fotoğraf aktarımı otomatik OCR değildir. Kaynak değişmez; öneri ve
        yönetici kararı ayrı saklanır. “Taslak onayı” tank kartını, ölçümü veya
        stok defterini değiştirmez.
      </Notice>
      {error && <Notice warning>{error}</Notice>}
      <Panel title="Kaynak fotoğraf ve belge">
        <Field label="Taslak belge">
          <select
            name="photoDocument"
            value={data?.document?.id || documentId}
            onChange={e => {
              setDocumentId(e.target.value);
              setRowNumber("");
            }}
          >
            {data?.documents.map(d => (
              <option value={d.id} key={d.id}>
                {d.sourceName}
              </option>
            ))}
          </select>
        </Field>
        {loading && <p>Doğrulama yükleniyor…</p>}
        {!loading && !data?.document && (
          <p>Seçili istasyonda içeri alınmış DEMO fotoğraf taslağı yok.</p>
        )}
        {data?.document && (
          <>
            <p>
              Kaynak zamanı:{" "}
              {new Date(data.document.displayedAt).toLocaleString("tr-TR", {
                timeZone: "Europe/Istanbul",
              })}
              . Ekran zamanı ölçüm cihazının doğrulandığı anlamına gelmez.
            </p>
            {data.document.hasPhoto && (
              <details>
                <summary>Kaynak fotoğrafı göster</summary>
                <img
                  alt="Doğrulanacak tank verilerinin kaynak fotoğrafı"
                  style={{ maxWidth: "100%", height: "auto" }}
                  src={
                    "/api/stationos/tank/photo-image?" +
                    new URLSearchParams({
                      stationId: station,
                      documentId: data.document.id,
                    })
                  }
                />
              </details>
            )}
          </>
        )}
      </Panel>
      <Panel
        title="Kaynak değer, hesaplanan öneri ve onay durumu"
        subtitle="Hacim yüzdesi = seçilen hacim / nominal kapasite. Seviye yüzdesi kalibrasyon tablosu olmadan hacme çevrilmez."
      >
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Tank / yakıt</th>
                <th>Kaynak kapasite</th>
                <th>Ürün hacmi</th>
                <th>Net hacim</th>
                <th>Kaynak hacim / seviye %</th>
                <th>Hesaplanan ürün / net %</th>
                <th>Önerilen kapasite / hacim</th>
                <th>Kart önerisi</th>
                <th>Yönetici durumu</th>
              </tr>
            </thead>
            <tbody>
              {data?.rows.map(r => {
                const p = r.review?.proposal ?? r.analysis.proposal;
                return (
                  <tr key={r.source.number}>
                    <td>
                      <button
                        className="btn"
                        onClick={() => setRowNumber(r.source.number)}
                      >
                        {r.source.number} / {r.source.fuelLabel}
                      </button>
                    </td>
                    <td>
                      {sourceL(r.source.capacityLitres)}
                      {r.analysis.capacityMl === null &&
                        " (geçersiz/bilinmiyor)"}
                    </td>
                    <td>{sourceL(r.source.productVolumeLitres)}</td>
                    <td>{sourceL(r.source.netProductVolumeLitres)}</td>
                    <td>
                      {r.source.reportedVolumeFillPercent ?? "—"} /{" "}
                      {r.source.reportedLevelPercent ?? "—"}
                    </td>
                    <td>
                      {r.analysis.productFillPercent ?? "Bilinmiyor"} /{" "}
                      {r.analysis.netFillPercent ?? "Bilinmiyor"}
                    </td>
                    <td>
                      {p.capacityMl === null
                        ? "Bilinmiyor"
                        : litres(p.capacityMl) + " L"}{" "}
                      /{" "}
                      {p.volumeMl === null
                        ? "Bilinmiyor"
                        : litres(p.volumeMl) + " L"}
                      {p.basis === "BOTH" && (
                        <>
                          {" "}
                          · Ürün:{" "}
                          {p.productMl == null
                            ? "Bilinmiyor"
                            : litres(p.productMl) + " L"}{" "}
                          · Net:{" "}
                          {p.netMl == null
                            ? "Bilinmiyor"
                            : litres(p.netMl) + " L"}
                        </>
                      )}
                    </td>
                    <td>
                      {r.analysis.suggestedTankId
                        ? data.cards.find(
                            c => c.tankId === r.analysis.suggestedTankId
                          )?.number
                        : "Manuel eşleştirme gerekli"}
                    </td>
                    <td>
                      {r.review?.decision ?? "PENDING"} · rev{" "}
                      {r.review?.revision ?? 0}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Panel>
      {row && proposal && (
        <Panel
          title={"Tank " + row.source.number + " · yönetici doğrulaması"}
          subtitle="Kaynak değerlerin fotoğrafta okunması ile ölçümün işletmece doğrulanması ayrı kararlardır."
        >
          <Field label="Kaynak tank">
            <select
              name="photoRow"
              value={row.source.number}
              onChange={e => setRowNumber(e.target.value)}
            >
              {data?.rows.map(r => (
                <option key={r.source.number} value={r.source.number}>
                  {r.source.number} / {r.source.fuelLabel}
                </option>
              ))}
            </select>
          </Field>
          <ul>
            {row.analysis.warnings.map(w => (
              <li key={w}>{validationWarnings[w] || w}</li>
            ))}
          </ul>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Mevcut kart</th>
                  <th>Numara</th>
                  <th>Yakıt</th>
                  <th>Kapasite</th>
                </tr>
              </thead>
              <tbody>
                {row.analysis.candidates.map(c => (
                  <tr key={c.card.tankId}>
                    <td>
                      {c.card.number} / {c.card.fuel} /{" "}
                      {litres(c.card.capacityMl)} L
                    </td>
                    <td>{c.numberMatches ? "Eşleşiyor" : "Farklı"}</td>
                    <td>
                      {c.fuelMatches
                        ? "Eşleşiyor"
                        : "Farklı / alias doğrulanmadı"}
                    </td>
                    <td>
                      {c.capacityMatches ? "Eşleşiyor" : "Farklı / bilinmiyor"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <form
            key={
              data!.document!.id +
              ":" +
              row.source.number +
              ":" +
              (row.review?.revision ?? 0)
            }
            className="form-grid"
            onSubmit={submit}
          >
            <Field label="Karar">
              <select
                name="decision"
                defaultValue={row.review?.decision ?? "PENDING"}
              >
                <option value="PENDING">Doğrulama bekliyor</option>
                <option value="APPROVED_DRAFT">
                  Yalnız taslağı onayla (stok değişmez)
                </option>
                <option value="REJECTED">Taslağı reddet</option>
              </select>
            </Field>
            <Field label="Açıkça eşleştirilen mevcut tank">
              <select name="tankId" defaultValue={proposal.tankId ?? ""}>
                <option value="">Eşleştirme yapılmadı</option>
                {data?.cards.map(c => (
                  <option key={c.tankId} value={c.tankId}>
                    {c.number} / {c.fuel} / {litres(c.capacityMl)} L
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Hacim tanımı">
              <select name="basis" defaultValue={proposal.basis}>
                <option value="BOTH">Ürün ve net hacim birlikte</option>
                <option value="UNDECIDED">Belirlenmedi</option>
                <option value="PRODUCT">Kaynak ürün hacmi</option>
                <option value="NET">Kaynak net hacim</option>
              </select>
            </Field>
            <Field label="Önerilen kapasite (L)">
              <input
                name="capacity"
                inputMode="decimal"
                defaultValue={input(proposal.capacityMl)}
              />
            </Field>
            <Field label="Eski tek hacim esası için hacim (L); birlikte kayıtta kullanılmaz">
              <input
                name="volume"
                inputMode="decimal"
                defaultValue={input(proposal.volumeMl)}
              />
            </Field>
            <Field label="Önerilen ürün hacmi (L)">
              <input
                name="product"
                inputMode="decimal"
                defaultValue={input(proposal.productMl ?? null)}
              />
            </Field>
            <Field label="Önerilen net hacim (L)">
              <input
                name="net"
                inputMode="decimal"
                defaultValue={input(proposal.netMl ?? null)}
              />
            </Field>
            <Field label="Gerekçe / değer ve eşleşme farklarının açıklaması">
              <textarea
                name="note"
                required
                maxLength={1000}
                defaultValue={row.review?.note ?? ""}
              />
            </Field>
            <Field label="Doğrulama kanıtı / belge referansı">
              <input
                name="evidence"
                required
                maxLength={500}
                defaultValue={row.review?.evidence ?? ""}
              />
            </Field>
            <label>
              <input type="checkbox" name="sourceConfirmed" /> Kaynak fotoğrafı
              ve önerdiğim değerleri kontrol ettim.
            </label>
            <label>
              <input type="checkbox" name="warningsAcknowledged" /> Hacim
              tanımı, yüzdeler ve kart eşleşmesi uyarılarını gerekçemle
              değerlendirdim.
            </label>
            <button className="btn primary" disabled={busy || loading}>
              Taslak incelemesini kaydet
            </button>
          </form>
          {row.review && (
            <p>
              Son karar: {row.review.decision} · {row.review.reviewerName} · rev{" "}
              {row.review.revision}. Onaylı stok uygulanmadı.
            </p>
          )}
        </Panel>
      )}
    </div>
  );
}

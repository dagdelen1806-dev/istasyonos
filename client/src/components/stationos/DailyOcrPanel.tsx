import { useEffect, useState } from "react";
import {
  ocrFieldLabels,
  ocrFields,
  type OcrField,
  type OcrRun,
  type OcrEvidence,
} from "@shared/daily-ocr";
import type { DailyNumericRow } from "@shared/daily-numeric";
import type { DailyPage } from "@shared/daily-report";
import { Field, Notice } from "./Common";
import { OcrLayoutPanel, type OcrRowPick } from "./OcrLayoutPanel";
import type { OcrBox } from "@shared/daily-ocr";
import { renderDailyPdfPage } from "@/lib/render-daily-pdf-page";
import { buildOesseShiftReportDraftFromOcr, type OesseShiftReportDraft } from "@shared/oesse-shift-report";
import type { NumericStaff } from "@shared/daily-numeric";
type Props = {
  stationId: string;
  packageId: string;
  page: DailyPage;
  kind: DailyNumericRow["kind"];
  busy: boolean;
  onAction: (path: string, body: Record<string, unknown>) => Promise<boolean>;
  onPick: (field: OcrField, value: string, evidence: OcrEvidence) => void;
  canApplyRow: boolean;
  onPickRow: (label: string, values: OcrRowPick[]) => void;
  pdfPageCount?: number;
  canParseShiftReport?: boolean;
  staffOptions?: NumericStaff[];
  onShiftReportDraft?: (draft: OesseShiftReportDraft | null) => void;
};
type Data = {
  run: OcrRun | null;
  capability: { available: boolean; message?: string };
};
export function DailyOcrPanel({
  stationId,
  packageId,
  page,
  kind,
  busy,
  onAction,
  onPick,
  canApplyRow,
  onPickRow,
  pdfPageCount = 0,
  canParseShiftReport = false,
  staffOptions = [],
  onShiftReportDraft,
}: Props) {
  const [data, setData] = useState<Data | null>(null),
    [loading, setLoading] = useState(false),
    [error, setError] = useState(""),
    [version, setVersion] = useState(0),
    [tokenId, setTokenId] = useState(""),
    [choiceIndex, setChoiceIndex] = useState(""),
    [field, setField] = useState<OcrField | "">(""),
    [confirmed, setConfirmed] = useState(false),
    [pdfPageNumber, setPdfPageNumber] = useState("1"),
    [pdfPreviewUrl, setPdfPreviewUrl] = useState(""),
    [renderingPdf, setRenderingPdf] = useState(false),
    [layoutBoxes, setLayoutBoxes] = useState<OcrBox[]>([]),
    [shiftReportDraft, setShiftReportDraft] = useState<OesseShiftReportDraft | null>(null),
    [shiftReportAttempted, setShiftReportAttempted] = useState(false);
  const isPdf = page.mime === "application/pdf",
    selectedPdfPage = Number(pdfPageNumber),
    q = new URLSearchParams({ stationId, packageId, pageId: page.id }),
    sourceUrl = "/api/stationos/daily-report/image?" + q,
    imageUrl = isPdf ? pdfPreviewUrl : sourceUrl;
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    setShiftReportDraft(null);
    setShiftReportAttempted(false);
    fetch(
      "/api/stationos/daily-report/ocr?" +
        new URLSearchParams({ stationId, packageId, pageId: page.id, ...(isPdf ? { pdfPageNumber } : {}) }),
      { credentials: "include", cache: "no-store" }
    )
      .then(async r => {
        const d = await r.json();
        if (!r.ok) throw Error(d.error?.message || "Okuma sonucu alınamadı.");
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
  }, [stationId, packageId, page.id, version, pdfPageNumber, isPdf]);
  useEffect(() => {
    onShiftReportDraft?.(shiftReportDraft);
  }, [shiftReportDraft, onShiftReportDraft]);
  useEffect(() => {
    setField("");
    setConfirmed(false);
    setLayoutBoxes([]);
  }, [kind]);
  const run = data?.run,
    token = run?.payload.tokens.find(t => t.id === tokenId),
    choice = token?.choices[Number(choiceIndex)],
    selected =
      field === "amountMinor"
        ? choice?.minor
        : field === "transactionCount"
          ? choice?.count
          : choice?.ml;
  async function read() {
    setError("");
    setLoading(true);
    try {
      let renderedPageBase64: string | undefined;
      if (isPdf) {
        if (!pdfPageCount || selectedPdfPage < 1 || selectedPdfPage > pdfPageCount)
          throw Error("Önce PDF sayfa sayısını ayrıştırıp geçerli bir sayfa seçin.");
        setRenderingPdf(true);
        const rendered = await renderDailyPdfPage(sourceUrl, selectedPdfPage);
        renderedPageBase64 = rendered.base64;
        setPdfPreviewUrl("data:image/png;base64," + rendered.base64);
        setRenderingPdf(false);
      }
      if (
        await onAction("/daily-report/ocr", {
          stationId,
          packageId,
          pageId: page.id,
          expectedSourceSha256: page.sha256,
          ...(isPdf ? { pdfPageNumber: selectedPdfPage, renderedPageBase64 } : {}),
        })
      )
        setVersion(v => v + 1);
      else
        setError("Okuma tamamlanmadı. İşlem durumu bildirimini kontrol edin.");
    } finally {
      setRenderingPdf(false);
      setLoading(false);
    }
  }
  function pick() {
    if (
      !run ||
      !token ||
      !choice ||
      !field ||
      !confirmed ||
      choiceIndex === "" ||
      selected == null
    )
      return;
    onPick(field, choice.normalized, {
      runId: run.id,
      pageId: page.id,
      tokenId: token.id,
      choiceIndex: Number(choiceIndex),
      field,
      confirmed: true,
      rawText: token.raw,
      normalized: choice.normalized,
      proposedValue: selected,
    });
    setConfirmed(false);
  }
  return (
    <div className="daily-ocr-panel">
      <p>{isPdf ? `PDF kaynağı: ${page.name}` : `Kaynak fotoğraf: ${page.position}. ${page.name}`}</p>
      {isPdf && (
        <Field label="Yerel OCR için PDF sayfası">
          <select value={pdfPageNumber} onChange={e => { setPdfPageNumber(e.target.value); setPdfPreviewUrl(""); }} disabled={!pdfPageCount || loading}>
            {Array.from({ length: Math.min(pdfPageCount, 100) }, (_, index) => index + 1).map(number => <option key={number} value={number}>{number}. sayfa</option>)}
          </select>
        </Field>
      )}
      {imageUrl && <a href={imageUrl} target="_blank" rel="noreferrer">
        {run ? (
          <svg
            viewBox={"0 0 " + run.payload.width + " " + run.payload.height}
            role="img"
            aria-label="OCR kaynağı ve seçilen sayı konumu"
          >
            <image
              href={imageUrl}
              width={run.payload.width}
              height={run.payload.height}
            />
            {layoutBoxes.map((b, i) => (
              <rect
                key={i}
                {...b}
                fill="rgba(80,170,210,0.18)"
                stroke="#007d9c"
                strokeWidth={Math.max(2, run.payload.width / 700)}
              />
            ))}
            {token && (
              <rect
                x={token.box.x}
                y={token.box.y}
                width={token.box.width}
                height={token.box.height}
                fill="rgba(255,190,0,0.25)"
                stroke="#d57900"
                strokeWidth={Math.max(2, run.payload.width / 700)}
              />
            )}
          </svg>
        ) : !isPdf ? (
          <img
            src={imageUrl}
            alt={"Sayısal taslak kaynak fotoğrafı " + page.position}
          />
        ) : <img src={imageUrl} alt={`PDF ${selectedPdfPage}. sayfa yerel render`} />}
      </a>}
      <button
        type="button"
        className="btn"
        disabled={busy || loading || renderingPdf || !data?.capability.available || (isPdf && !pdfPageCount)}
        onClick={() => void read()}
      >
        {loading
          ? renderingPdf ? "PDF sayfası yerelde render ediliyor…" : "Yerel okuma sürüyor…"
          : run
            ? "Kaydedilmiş okumayı aç"
            : "Fotoğraftan oku (yerel)"}
      </button>
      {data?.capability.available === false && (
        <Notice warning>
          {data.capability.message ??
            "Yerel OCR kullanılamıyor. Elle veri girişi açık."}
        </Notice>
      )}
      {error && <Notice warning>{error}</Notice>}
      {run && (
        <>
          {canParseShiftReport && (
            <button type="button" className="btn" onClick={() => { setShiftReportAttempted(true); setShiftReportDraft(buildOesseShiftReportDraftFromOcr({ lines: run.payload.lines, words: run.payload.words, sourcePageNumber: run.payload.sourcePageNumber, sourceSha256: run.sourceSha256 })); }}>
              Yerel OCR metninden ÖSSE vardiya satış taslağı çıkar
            </button>
          )}
          {shiftReportAttempted && !shiftReportDraft && (
            <Notice warning>
              ÖSSE tablo başlığı okunamadı. Satış satırı, vardiya veya toplam uydurulmadı; kaynağı daha net yeniden yükleyin ya da alanları manuel doğrulayın.
            </Notice>
          )}
          {shiftReportDraft && (
            <section aria-label="ÖSSE vardiya OCR taslağı">
              <Notice warning>
                Yerel OCR taslağı · {shiftReportDraft.status}. Kaynak belgeye göre kontrol edilmelidir; personel adı kalıcı kimliğe dönüştürülmedi. Bağımsız gün sonu değildir ve mali kayıt oluşturmaz.
              </Notice>
              <p>Vardiya {shiftReportDraft.shiftId ?? "belirsiz"} · {shiftReportDraft.startsAt ?? "başlangıç belirsiz"} → {shiftReportDraft.endsAt ?? "bitiş belirsiz"}</p>
              <div className="table-wrap"><table><thead><tr><th>ÖSSE adı önerisi</th><th>Yetkili personel eşlemesi</th><th>İşlem</th><th>Tutar</th><th>OCR konumu</th></tr></thead><tbody>
                {shiftReportDraft.staffRows.map((row, index) => <tr key={`${row.sourceLocation}-${index}`}><td>{row.nameSuggestion}{row.duplicateName ? " · yinelenen ad" : ""}</td><td><select aria-label={`${row.nameSuggestion} kalıcı personel kimliği`} value={row.staffUserId ?? ""} onChange={event => setShiftReportDraft(previous => previous ? { ...previous, status: "REVIEW_REQUIRED", staffRows: previous.staffRows.map((candidate, candidateIndex) => candidateIndex === index ? { ...candidate, staffUserId: event.target.value ? Number(event.target.value) : null } : candidate) } : previous)}><option value="">Personel seçin</option>{staffOptions.map(person => <option value={person.userId} key={person.userId}>{person.name} · ID {person.userId}</option>)}</select></td><td>{row.transactionCount ?? "Belirsiz"}</td><td>{row.amountMinor === null ? "Belirsiz" : new Intl.NumberFormat("tr-TR", { style: "currency", currency: "TRY" }).format(row.amountMinor / 100)}</td><td>{row.sourceLocation}</td></tr>)}
              </tbody></table></div>
              <p>Satır / POMPACI işlem: {String(shiftReportDraft.checks.staffCountMatches ?? "kontrol gerekli")} · tutar: {String(shiftReportDraft.checks.staffAmountMatches ?? "kontrol gerekli")} · genel toplam: {String(shiftReportDraft.checks.generalAmountMatches ?? "kontrol gerekli")}</p>
              {!!shiftReportDraft.warnings.length && <ul>{shiftReportDraft.warnings.map(warning => <li key={warning}>{warning}</li>)}</ul>}
            </section>
          )}
          {run.payload.warnings.map(w => (
            <Notice warning key={w}>
              {w}
            </Notice>
          ))}
          <OcrLayoutPanel
            key={kind}
            run={run}
            kind={kind}
            busy={busy || loading}
            canApply={canApplyRow}
            onHighlight={boxes => {
              setLayoutBoxes(boxes);
              setTokenId("");
              setChoiceIndex("");
              setConfirmed(false);
            }}
            onApply={onPickRow}
          />
          <Field label="Okunan sayı önerisi">
            <select
              name="ocrToken"
              value={tokenId}
              onChange={e => {
                setTokenId(e.target.value);
                setChoiceIndex("");
                setConfirmed(false);
                setLayoutBoxes([]);
              }}
            >
              <option value="">Kaynak sayıyı seçin</option>
              {run.payload.tokens.map(t => (
                <option value={t.id} key={t.id}>
                  {t.raw} · Satır {t.line + 1}:{" "}
                  {run.payload.lines
                    .find(l => l.index === t.line)
                    ?.text.slice(0, 120)}
                </option>
              ))}
            </select>
          </Field>
          {token && (
            <>
              <p>
                Kaynakta okunan: <strong>{token.raw}</strong>. Konumu görüntüde
                işaretli.
              </p>
              {token.warnings.map(w => (
                <Notice key={w} warning>
                  {w}
                </Notice>
              ))}
              <Field label="Sayının açık yorumu">
                <select
                  name="ocrChoice"
                  value={choiceIndex}
                  onChange={e => {
                    setChoiceIndex(e.target.value);
                    setConfirmed(false);
                  }}
                >
                  <option value="">Sayı yorumunu seçin</option>
                  {token.choices.map((c, i) => (
                    <option value={i} key={i}>
                      {c.normalized} · {c.interpretation}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Taslak formundaki hedef alan">
                <select
                  name="ocrField"
                  value={field}
                  onChange={e => {
                    setField(e.target.value as OcrField);
                    setConfirmed(false);
                  }}
                >
                  <option value="">Alan seçin</option>
                  {ocrFields[kind].map(f => (
                    <option key={f} value={f}>
                      {ocrFieldLabels[f]} ({f === "amountMinor" ? "TL" : "L"})
                    </option>
                  ))}
                </select>
              </Field>
              {choiceIndex !== "" && field && selected == null && (
                <Notice warning>
                  Bu sayı seçilen alanın hassasiyet veya büyüklük sınırına
                  uymuyor; elle doğrulayın.
                </Notice>
              )}
              <label>
                <input
                  name="ocrConfirmed"
                  type="checkbox"
                  checked={confirmed}
                  onChange={e => setConfirmed(e.target.checked)}
                />{" "}
                İşaretli sayıyı kaynak fotoğraftan kontrol ettim; seçtiğim sayı
                yorumu ve hedef alan doğru.
              </label>
              <button
                type="button"
                className="btn"
                disabled={
                  busy ||
                  loading ||
                  !confirmed ||
                  !field ||
                  choiceIndex === "" ||
                  selected == null
                }
                onClick={pick}
              >
                Seçilen değeri forma öner
              </button>
            </>
          )}
          <details>
            <summary>Okunan metin ({run.payload.lines.length} satır)</summary>
            <div className="ocr-text-lines">
              {run.payload.lines.map(l => (
                <p key={l.index}>
                  {l.index + 1}. {l.text}
                </p>
              ))}
            </div>
          </details>
          <p>
            Aktarım yalnız açık form alanını doldurur. Satır ekleme ve taslak
            kaydı ayrıca yapılır; mali/stok işlemi uygulanmaz.
          </p>
        </>
      )}
    </div>
  );
}

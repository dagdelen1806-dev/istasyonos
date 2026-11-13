import { useCallback, useEffect, useState, type FormEvent } from "react";
import type { AppState } from "@shared/station";
import {
  dailyPageKinds,
  dailyPageLabels,
  type DailyReportOverview,
} from "@shared/daily-report";
import { Panel, Field, Notice } from "./Common";
import { DailyNumericPanel } from "./DailyNumericPanel";
import { StaffReconciliationDraftPanel } from "./StaffReconciliationDraftPanel";
import type { OesseShiftReportDraft } from "@shared/oesse-shift-report";
type Props = {
  state: AppState;
  stationId: string;
  busy: boolean;
  onAction: (
    path: string,
    payload: Record<string, unknown>
  ) => Promise<boolean>;
};
export function DailyReportPanel({ state, stationId, busy, onAction }: Props) {
  const [data, setData] = useState<DailyReportOverview | null>(null),
    [packageId, setPackageId] = useState(""),
    [version, setVersion] = useState(0),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(false),
    [reading, setReading] = useState(false),
    [parsedDocument, setParsedDocument] = useState<Record<string, any> | null>(
      null
    ),
    [comparisonPackageId, setComparisonPackageId] = useState(""),
    [comparisonDocument, setComparisonDocument] = useState<Record<
      string,
      any
    > | null>(null),
    [comparisonLoading, setComparisonLoading] = useState(false),
    [ocrShiftReports, setOcrShiftReports] = useState<
      Record<string, OesseShiftReportDraft>
    >({}),
    [pageId, setPageId] = useState("");
  const station = stationId || state.stations[0]?.id || "",
    role = state.member?.role ?? "",
    allowed = ["OWNER", "MANAGER", "ACCOUNTANT", "FUEL_STAFF"].includes(role),
    reviewer = ["OWNER", "MANAGER", "ACCOUNTANT"].includes(role),
    disabled = busy || loading || reading || !state.tenant?.isDemo;
  useEffect(() => {
    let active = true;
    setError("");
    if (!station || !allowed || !state.tenant?.isDemo) return;
    setLoading(true);
    const q = new URLSearchParams({
      stationId: station,
      ...(packageId ? { packageId } : {}),
    });
    fetch("/api/stationos/daily-reports?" + q, {
      credentials: "include",
      cache: "no-store",
    })
      .then(async r => {
        const d = await r.json();
        if (!r.ok) throw Error(d.error?.message || "Rapor okunamadı.");
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
  }, [station, allowed, state, packageId, version]);
  async function upload(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");
    const form = e.currentTarget,
      file = (form.elements.namedItem("archive") as HTMLInputElement)
        .files?.[0];
    if (!file) return;
    const isZip = /\.zip$/i.test(file.name),
      isStructured = /\.(pdf|xlsx)$/i.test(file.name),
      maxBytes = isZip ? 20 * 1024 * 1024 : 12 * 1024 * 1024;
    if ((!isZip && !isStructured) || file.size > maxBytes) {
      setError("ZIP (20 MB), PDF veya XLSX (12 MB) dosyası seçin.");
      return;
    }
    const targetStation = station;
    setReading(true);
    try {
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result).split(",")[1]);
        reader.onerror = () => reject(Error("Dosya okunamadı."));
        reader.readAsDataURL(file);
      });
      if (
        await onAction("/daily-report/import", {
          stationId: targetStation,
          sourceName: file.name,
          zipBase64: base64,
        })
      ) {
        setParsedDocument(null);
        setComparisonDocument(null);
        setComparisonPackageId("");
        setPackageId("");
        setVersion(v => v + 1);
        form.reset();
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setReading(false);
    }
  }
  async function parseSourceDocument() {
    if (
      !data?.document ||
      !page ||
      !["application/pdf", "application/xlsx"].includes(page.mime)
    )
      return;
    setError("");
    setReading(true);
    try {
      const response = await fetch(
        "/api/stationos/daily-report/parse?" +
          new URLSearchParams({
            stationId: station,
            packageId: data.document.id,
          }),
        { credentials: "include", cache: "no-store" }
      );
      const result = await response.json();
      if (!response.ok)
        throw Error(result.error?.message || "Belge ayrıştırılamadı.");
      setParsedDocument(result);
      setComparisonDocument(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setReading(false);
    }
  }
  async function parseComparisonSource() {
    if (!comparisonPackageId || comparisonPackageId === data?.document?.id)
      return;
    setError("");
    setComparisonLoading(true);
    try {
      const response = await fetch(
        "/api/stationos/daily-report/parse?" +
          new URLSearchParams({
            stationId: station,
            packageId: comparisonPackageId,
          }),
        { credentials: "include", cache: "no-store" }
      );
      const result = await response.json();
      if (!response.ok)
        throw Error(
          result.error?.message || "Karşılaştırma kaynağı okunamadı."
        );
      setComparisonDocument(result);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Karşılaştırma kaynağı okunamadı."
      );
      setComparisonDocument(null);
    } finally {
      setComparisonLoading(false);
    }
  }
  async function review(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!data?.document) return;
    const f = new FormData(e.currentTarget);
    setError("");
    try {
      if (
        await onAction("/daily-report/review", {
          stationId: station,
          packageId: data.document.id,
          expectedRevision: data.review?.revision ?? 0,
          decision: f.get("decision"),
          shiftReference: f.get("shiftReference"),
          reportDay: f.get("reportDay"),
          note: f.get("note"),
          evidence: f.get("evidence"),
          sourceConfirmed: f.get("sourceConfirmed") === "on",
          pages: data.pages.map(p => ({
            pageId: p.id,
            kind: f.get("kind-" + p.id),
          })),
        })
      )
        setVersion(v => v + 1);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  const page = data?.pages.find(p => p.id === pageId) ?? data?.pages[0];
  const activeDocumentId = data?.document?.id ?? "";
  const onOcrShiftReportDraft = useCallback(
    (draft: OesseShiftReportDraft | null) => {
      if (!activeDocumentId) return;
      setOcrShiftReports(current => {
        if (draft && current[activeDocumentId] === draft) return current;
        if (!draft && !current[activeDocumentId]) return current;
        const next = { ...current };
        if (draft) next[activeDocumentId] = draft;
        else delete next[activeDocumentId];
        return next;
      });
    },
    [activeDocumentId]
  );
  const primaryOcrDraft = data?.document
      ? ocrShiftReports[data.document.id]
      : null,
    comparisonOcrDraft = comparisonPackageId
      ? ocrShiftReports[comparisonPackageId]
      : null,
    reviewAutomationDraft =
      parsedDocument?.shiftReportDraft ??
      comparisonDocument?.shiftReportDraft ??
      primaryOcrDraft ??
      comparisonOcrDraft ??
      null,
    reviewAutomationPackageId = parsedDocument?.shiftReportDraft
      ? data?.document?.id
      : comparisonDocument?.shiftReportDraft
        ? comparisonPackageId
        : primaryOcrDraft
          ? data?.document?.id
          : comparisonOcrDraft
            ? comparisonPackageId
            : data?.document?.id,
    reviewDailyAccountDraft =
      parsedDocument?.dailyAccountDraft ??
      comparisonDocument?.dailyAccountDraft ??
      null,
    reviewDailyAccountSourceName = parsedDocument?.dailyAccountDraft
      ? parsedDocument.sourceName
      : comparisonDocument?.dailyAccountDraft
        ? comparisonDocument.sourceName
        : null;
  if (!allowed)
    return (
      <Notice warning>
        Günlük rapor için akaryakıt, yönetim veya muhasebe yetkisi gerekir.
      </Notice>
    );
  if (!state.tenant?.isDemo)
    return (
      <Notice warning>
        Günlük rapor aktarımı yalnız DEMO/test alanında açıktır.
      </Notice>
    );
  return (
    <div className="daily-report-panel">
      <Notice>
        Fotoğraflar kaynak olarak saklanır. Yerel okuma önerileri kullanıcı
        kontrolüyle forma alınır. Taslak doğrulaması satış, tahsilat veya stok
        kaydı oluşturmaz.
      </Notice>
      {error && <Notice warning>{error}</Notice>}
      <Panel
        title="Günlük rapor kaynağını ekle"
        subtitle="ZIP: 20 MB / 12 görsel. PDF veya XLSX: 12 MB. Ayrıştırma yalnız taslak önerisi üretir."
      >
        <form className="business-form form-grid two" onSubmit={upload}>
          <Field label="Vardiya raporu ZIP dosyası">
            <input
              type="file"
              name="archive"
              accept=".zip,.pdf,.xlsx,application/zip,application/pdf,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              required
              disabled={disabled}
            />
          </Field>
          <button className="btn primary" disabled={disabled || !station}>
            {reading ? "Kaynak aktarılıyor…" : "Kaynak paketi kaydet"}
          </button>
        </form>
      </Panel>
      <Panel title="Kaynak paketler ve taslak doğrulaması">
        <div className="business-form">
          <Field label="Kaynak paket">
            <select
              name="dailyPackage"
              value={data?.document?.id ?? ""}
              disabled={disabled}
              onChange={e => {
                setParsedDocument(null);
                setComparisonDocument(null);
                setComparisonPackageId("");
                setPackageId(e.target.value);
                setPageId("");
              }}
            >
              <option value="">Paket seçin</option>
              {data?.packages.map(p => (
                <option value={p.id} key={p.id}>
                  {p.sourceName} · {p.pageCount} fotoğraf
                </option>
              ))}
            </select>
          </Field>
          {!loading && !data?.document && (
            <p>Bu istasyonda henüz günlük rapor yok.</p>
          )}
          {data?.document && (
            <>
              {reviewer &&
                data.packages.some(item => item.id !== data.document?.id) && (
                  <div className="form-grid two">
                    <Field label="Birlikte incelenecek ikinci PDF/XLSX kaynağı">
                      <select
                        value={comparisonPackageId}
                        onChange={event => {
                          setComparisonPackageId(event.target.value);
                          setComparisonDocument(null);
                        }}
                      >
                        <option value="">İkinci kaynak seçilmedi</option>
                        {data.packages
                          .filter(item => item.id !== data.document?.id)
                          .map(item => (
                            <option key={item.id} value={item.id}>
                              {item.sourceName} · {item.pageCount} kaynak
                            </option>
                          ))}
                      </select>
                    </Field>
                    <button
                      type="button"
                      className="btn"
                      disabled={
                        !comparisonPackageId ||
                        comparisonLoading ||
                        reading ||
                        !!ocrShiftReports[comparisonPackageId]
                      }
                      onClick={() => void parseComparisonSource()}
                    >
                      {comparisonLoading
                        ? "İkinci kaynak okunuyor…"
                        : ocrShiftReports[comparisonPackageId]
                          ? "Yerel OCR taslağı hazır"
                          : "İkinci kaynağı incele"}
                    </button>
                  </div>
                )}
              <p>
                Kaynak: {data.document.sourceName} · {data.pages.length} kaynak
                öğesi · {data.review?.decision ?? "PENDING"} · Rev{" "}
                {data.review?.revision ?? 0}
              </p>
              <Field label="Kaynak belge / görsel">
                <select
                  name="dailyPage"
                  value={page?.id ?? ""}
                  onChange={e => setPageId(e.target.value)}
                >
                  {data.pages.map(p => (
                    <option key={p.id} value={p.id}>
                      {p.position}. {p.name}
                    </option>
                  ))}
                </select>
              </Field>
              {page && reviewer && page.mime === "application/pdf" && (
                <iframe
                  title="PDF rapor kaynağı"
                  src={
                    "/api/stationos/daily-report/image?" +
                    new URLSearchParams({
                      stationId: station,
                      packageId: data.document.id,
                      pageId: page.id,
                    })
                  }
                  sandbox=""
                  referrerPolicy="no-referrer"
                  style={{
                    width: "100%",
                    height: 560,
                    border: "1px solid #aaa",
                  }}
                />
              )}
              {page && reviewer && page.mime === "application/xlsx" && (
                <a
                  className="btn"
                  href={
                    "/api/stationos/daily-report/image?" +
                    new URLSearchParams({
                      stationId: station,
                      packageId: data.document.id,
                      pageId: page.id,
                    })
                  }
                  download={page.name}
                >
                  Kaynak XLSX dosyasını indir ve kontrol et
                </a>
              )}
              {page && !reviewer && page.mime.startsWith("image/") && (
                <a
                  href={
                    "/api/stationos/daily-report/image?" +
                    new URLSearchParams({
                      stationId: station,
                      packageId: data.document.id,
                      pageId: page.id,
                    })
                  }
                  target="_blank"
                  rel="noreferrer"
                >
                  <img
                    style={{
                      maxWidth: "100%",
                      maxHeight: 650,
                      objectFit: "contain",
                      display: "block",
                      margin: "16px auto",
                    }}
                    src={
                      "/api/stationos/daily-report/image?" +
                      new URLSearchParams({
                        stationId: station,
                        packageId: data.document.id,
                        pageId: page.id,
                      })
                    }
                    alt={"Günlük kaynak fotoğrafı " + page.position}
                  />
                </a>
              )}
              {reviewer &&
                page &&
                ["application/pdf", "application/xlsx"].includes(page.mime) && (
                  <div className="form-grid">
                    <button
                      type="button"
                      className="btn"
                      disabled={disabled || reading}
                      onClick={() => void parseSourceDocument()}
                    >
                      {reading
                        ? "Belge güvenli sınırlar içinde ayrıştırılıyor…"
                        : "PDF/XLSX taslak alanlarını çıkar"}
                    </button>
                    {parsedDocument?.format === "PDF" && (
                      <div>
                        <p>
                          {parsedDocument.pageCount} sayfa · kaynak SHA-256:{" "}
                          {parsedDocument.sourceSha256?.slice(0, 12)}…
                        </p>
                        {parsedDocument.pages
                          ?.slice(0, 100)
                          .map((parsedPage: any) => (
                            <details key={parsedPage.pageNumber}>
                              <summary>
                                PDF sayfa {parsedPage.pageNumber}
                                {parsedPage.needsLocalOcr
                                  ? " · yerel OCR gerekli"
                                  : " · metin katmanı bulundu"}
                              </summary>
                              {parsedPage.needsLocalOcr ? (
                                <Notice warning>
                                  Bu sayfada metin katmanı yok. PDF sayfasını
                                  yerelde render edip mevcut Windows OCR ile
                                  okutmak için aşağıdaki OCR taslağına geçin.
                                  Sonucu kullanıcı doğrulamadan kullanmayın.
                                </Notice>
                              ) : (
                                <>
                                  {!!parsedPage.fieldCandidates?.length && (
                                    <div className="table-wrap">
                                      <table>
                                        <thead>
                                          <tr>
                                            <th>Alan</th>
                                            <th>Kaynak metin</th>
                                            <th>Öneri</th>
                                            <th>Kaynak konumu</th>
                                            <th>Durum</th>
                                          </tr>
                                        </thead>
                                        <tbody>
                                          {parsedPage.fieldCandidates.map(
                                            (candidate: any, index: number) => (
                                              <tr key={index}>
                                                <td>{candidate.field}</td>
                                                <td>{candidate.rawText}</td>
                                                <td>
                                                  {candidate.proposedValue ==
                                                  null
                                                    ? "Belirsiz; tahmin edilmedi"
                                                    : String(
                                                        candidate.proposedValue
                                                      )}
                                                </td>
                                                <td>
                                                  Sayfa{" "}
                                                  {candidate.source.pageNumber}{" "}
                                                  · x={candidate.source.x}, y=
                                                  {candidate.source.y}
                                                </td>
                                                <td>
                                                  Kaynakla doğrulanmalı
                                                  {candidate.requiresUserMapping
                                                    ? " · kullanıcı kimliği seçilmedi"
                                                    : ""}
                                                </td>
                                              </tr>
                                            )
                                          )}
                                        </tbody>
                                      </table>
                                    </div>
                                  )}
                                  <pre
                                    style={{
                                      whiteSpace: "pre-wrap",
                                      maxHeight: 260,
                                      overflow: "auto",
                                    }}
                                  >
                                    {String(parsedPage.text ?? "").slice(
                                      0,
                                      6000
                                    )}
                                  </pre>
                                </>
                              )}
                            </details>
                          ))}
                      </div>
                    )}
                    {parsedDocument?.format === "XLSX" && (
                      <div>
                        <p>
                          {parsedDocument.sheets?.length ?? 0} çalışma sayfası ·
                          formüller çalıştırılmaz; formül önbelleği yalnız
                          doğrulama önerisidir.
                        </p>
                        {parsedDocument.sheets
                          ?.slice(0, 30)
                          .map((sheet: any) => (
                            <details key={sheet.name}>
                              <summary>
                                {sheet.name} · {sheet.rowCount} satır ·{" "}
                                {sheet.candidates?.length ?? 0} eşleşen aday
                                satır
                              </summary>
                              <div className="table-wrap">
                                <table>
                                  <thead>
                                    <tr>
                                      <th>Kaynak</th>
                                      <th>ÖSSE önerisi</th>
                                      <th>Vardiya</th>
                                      <th>Tarih</th>
                                      <th>İşlem</th>
                                      <th>Litre</th>
                                      <th>Tutar</th>
                                      <th>TTS</th>
                                      <th>Özel</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {sheet.candidates
                                      ?.slice(0, 100)
                                      .map((candidate: any) => (
                                        <tr key={candidate.rowNumber}>
                                          <td>
                                            {sheet.name}!{candidate.rowNumber}
                                          </td>
                                          <td>
                                            {candidate.staffNameSuggestion ??
                                              "—"}{" "}
                                            · kalıcı kullanıcı kimliği
                                            eşleştirilmedi
                                          </td>
                                          <td>
                                            {candidate.shiftSuggestion ?? "—"}
                                          </td>
                                          {(
                                            [
                                              "date",
                                              "count",
                                              "litres",
                                              "amount",
                                              "tts",
                                              "special",
                                            ] as const
                                          ).map(field => {
                                            const cell =
                                              candidate.fields?.[field];
                                            return (
                                              <td key={field}>
                                                {cell ? (
                                                  <>
                                                    {String(
                                                      cell.display ??
                                                        cell.proposedValue ??
                                                        "—"
                                                    )}
                                                    <small
                                                      style={{
                                                        display: "block",
                                                      }}
                                                    >
                                                      {cell.address}
                                                      {cell.formulaCache
                                                        ? " · önbellek, doğrulanmalı"
                                                        : " · doğrulanmalı"}
                                                    </small>
                                                  </>
                                                ) : (
                                                  "—"
                                                )}
                                              </td>
                                            );
                                          })}
                                        </tr>
                                      ))}
                                  </tbody>
                                </table>
                              </div>
                            </details>
                          ))}
                      </div>
                    )}
                    {parsedDocument?.shiftReportDraft && (
                      <section aria-label="Otomasyon vardiya satış taslağı">
                        <Notice warning>
                          Otomasyon vardiya satış taslağı ·{" "}
                          {parsedDocument.shiftReportDraft.status}. Personel
                          adları kimlik değildir; her satır yetkili FUEL_STAFF
                          listesinden elle eşleştirilmelidir. Bu belge bağımsız
                          gün sonu kaynağı sayılmaz ve mali kayıt oluşturmaz.
                        </Notice>
                        <p>
                          Vardiya{" "}
                          {parsedDocument.shiftReportDraft.shiftId ??
                            "doğrulanmadı"}{" "}
                          ·{" "}
                          {parsedDocument.shiftReportDraft.startsAt ??
                            "başlangıç belirsiz"}{" "}
                          →{" "}
                          {parsedDocument.shiftReportDraft.endsAt ??
                            "bitiş belirsiz"}
                          {parsedDocument.shiftReportDraft.checks.crossMidnight
                            ? " · Gece yarısını aşan vardiya"
                            : ""}
                        </p>
                        <div className="table-wrap">
                          <table>
                            <thead>
                              <tr>
                                <th>ÖSSE ad önerisi</th>
                                <th>Kalıcı kimlik</th>
                                <th>Satış adedi</th>
                                <th>Satış tutarı</th>
                                <th>Kaynak</th>
                              </tr>
                            </thead>
                            <tbody>
                              {parsedDocument.shiftReportDraft.staffRows.map(
                                (row: any, index: number) => (
                                  <tr key={`${row.sourceLocation}-${index}`}>
                                    <td>
                                      {row.nameSuggestion}
                                      {row.duplicateName
                                        ? " · aynı ad tekrar ediyor"
                                        : ""}
                                    </td>
                                    <td>
                                      <select
                                        aria-label={`${row.nameSuggestion} yetkili personel eşlemesi`}
                                        value={row.staffUserId ?? ""}
                                        onChange={event =>
                                          setParsedDocument((current: any) =>
                                            current?.shiftReportDraft
                                              ? {
                                                  ...current,
                                                  shiftReportDraft: {
                                                    ...current.shiftReportDraft,
                                                    status: "REVIEW_REQUIRED",
                                                    staffRows:
                                                      current.shiftReportDraft.staffRows.map(
                                                        (
                                                          candidate: any,
                                                          rowIndex: number
                                                        ) =>
                                                          rowIndex === index
                                                            ? {
                                                                ...candidate,
                                                                staffUserId:
                                                                  event.target
                                                                    .value
                                                                    ? Number(
                                                                        event
                                                                          .target
                                                                          .value
                                                                      )
                                                                    : null,
                                                              }
                                                            : candidate
                                                      ),
                                                  },
                                                }
                                              : current
                                          )
                                        }
                                      >
                                        <option value="">Personel seçin</option>
                                        {state.members
                                          .filter(
                                            member =>
                                              member.role === "FUEL_STAFF" &&
                                              member.stationIds.includes(
                                                station
                                              ) &&
                                              member.stationAccess?.[
                                                station
                                              ] === "ACTIVE"
                                          )
                                          .map(member => (
                                            <option
                                              key={member.userId}
                                              value={member.userId}
                                            >
                                              {member.name} · ID {member.userId}
                                            </option>
                                          ))}
                                      </select>
                                    </td>
                                    <td>
                                      {row.transactionCount ?? "Belirsiz"}
                                    </td>
                                    <td>
                                      {row.amountMinor == null
                                        ? "Belirsiz"
                                        : new Intl.NumberFormat("tr-TR", {
                                            style: "currency",
                                            currency: "TRY",
                                          }).format(row.amountMinor / 100)}
                                    </td>
                                    <td>{row.sourceLocation}</td>
                                  </tr>
                                )
                              )}
                            </tbody>
                          </table>
                        </div>
                        <p>
                          Personel toplamı / POMPACI: işlem{" "}
                          {String(
                            parsedDocument.shiftReportDraft.checks
                              .staffCountMatches ?? "doğrulanamadı"
                          )}
                          , tutar{" "}
                          {String(
                            parsedDocument.shiftReportDraft.checks
                              .staffAmountMatches ?? "doğrulanamadı"
                          )}
                          . Genel toplam:{" "}
                          {String(
                            parsedDocument.shiftReportDraft.checks
                              .generalAmountMatches ?? "doğrulanamadı"
                          )}
                          .
                        </p>
                        {!!parsedDocument.shiftReportDraft.categoryRows
                          .length && (
                          <p>
                            Ayrı kategori satırları:{" "}
                            {parsedDocument.shiftReportDraft.categoryRows
                              .map(
                                (row: any) =>
                                  `${row.category} ${row.amountMinor == null ? "?" : new Intl.NumberFormat("tr-TR", { style: "currency", currency: "TRY" }).format(row.amountMinor / 100)}`
                              )
                              .join(" · ")}
                          </p>
                        )}
                        {!!parsedDocument.shiftReportDraft.warnings.length && (
                          <ul>
                            {parsedDocument.shiftReportDraft.warnings.map(
                              (warning: string) => (
                                <li key={warning}>{warning}</li>
                              )
                            )}
                          </ul>
                        )}
                      </section>
                    )}
                    <Notice warning>
                      Çıkarılan alanlar kaynak satır/hücre önerisidir. Personel
                      kimliği otomatik atanmaz. Sayısal taslak ekranında
                      kullanıcı kaynakla karşılaştırıp doğrulamadan kayıt
                      kesinleşmez.
                    </Notice>
                  </div>
                )}
              {reviewer && (
                <>
                  <DailyNumericPanel
                    key={data.document.id}
                    state={state}
                    stationId={station}
                    packageId={data.document.id}
                    pages={data.pages}
                    pageId={page?.id ?? ""}
                    pdfPageCount={
                      parsedDocument?.format === "PDF"
                        ? Number(parsedDocument.pageCount)
                        : 0
                    }
                    onPage={setPageId}
                    busy={disabled}
                    onAction={onAction}
                    onShiftReportDraft={onOcrShiftReportDraft}
                  />
                  {state.member?.role &&
                    ["OWNER", "MANAGER", "ACCOUNTANT"].includes(
                      state.member.role
                    ) && (
                      <StaffReconciliationDraftPanel
                        accountantId={state.user.id}
                        role={
                          state.member.role as
                            | "OWNER"
                            | "MANAGER"
                            | "ACCOUNTANT"
                        }
                        liveSources={{
                          state,
                          stationId: station,
                          packageId:
                            reviewAutomationPackageId ?? data.document.id,
                          automationDraft: reviewAutomationDraft,
                          dailyAccountDraft: reviewDailyAccountDraft,
                          dailyAccountSourceName: reviewDailyAccountSourceName,
                        }}
                      />
                    )}
                </>
              )}
              <form
                className="form-grid two"
                onSubmit={review}
                key={data.document.id + ":" + (data.review?.revision ?? 0)}
              >
                <Field label="Vardiya referansı (kaynaktaki)">
                  <input
                    name="shiftReference"
                    required
                    maxLength={64}
                    defaultValue={data.review?.shiftReference ?? ""}
                  />
                </Field>
                <Field label="Rapor günü (vardiya başlangıç günü)">
                  <input
                    name="reportDay"
                    type="date"
                    required
                    defaultValue={data.review?.reportDay ?? ""}
                  />
                </Field>
                {data.pages.map(p => (
                  <Field key={p.id} label={p.position + ". " + p.name}>
                    <select name={"kind-" + p.id} defaultValue={p.kind}>
                      {dailyPageKinds.map(k => (
                        <option key={k} value={k}>
                          {dailyPageLabels[k]}
                        </option>
                      ))}
                    </select>
                  </Field>
                ))}
                <Field label="Taslak kararı">
                  <select
                    name="decision"
                    defaultValue={data.review?.decision ?? "PENDING"}
                  >
                    <option value="PENDING">Doğrulama bekliyor</option>
                    <option value="REVIEWED_DRAFT">
                      Kaynak paketi kontrol edildi (taslak)
                    </option>
                    <option value="REJECTED">Reddedildi</option>
                  </select>
                </Field>
                <Field label="Açıklama">
                  <textarea
                    name="note"
                    required
                    maxLength={1000}
                    defaultValue={data.review?.note ?? ""}
                  />
                </Field>
                <Field label="Kanıt / belge referansı">
                  <input
                    name="evidence"
                    required
                    maxLength={500}
                    defaultValue={data.review?.evidence ?? ""}
                  />
                </Field>
                <label>
                  <input name="sourceConfirmed" type="checkbox" /> Tüm
                  fotoğrafların aynı vardiyaya ait olduğunu, günü ve sayfa
                  türlerini kaynaktan kontrol ettim.
                </label>
                <button
                  className="btn primary"
                  disabled={disabled || !reviewer}
                >
                  Taslak incelemesini kaydet
                </button>
              </form>
              {data.review && (
                <p>
                  Son inceleyen: {data.review.reviewerName} ·{" "}
                  {new Date(data.review.createdAt).toLocaleString("tr-TR")}.
                  Mali/stok kaydı uygulanmadı.
                </p>
              )}
            </>
          )}
        </div>
      </Panel>
    </div>
  );
}

import { randomUUID, createHash } from "node:crypto";
import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import { first, execute } from "./db";
import {
  requireId,
  requireInteger,
  requireString,
  requireEnum,
  requireBoolean,
} from "./domain";
import { fail } from "./types";
import { containsLikelyPan } from "./safety";
import {
  requireDailyDemo,
  scopedDailyPackage,
  dailyReportImage,
} from "./daily-report";
import { OCR_ENGINE_VERSION, recognizeImage } from "./windows-ocr";
import {
  ocrNumber,
  ocrFields,
  type OcrPayload,
  type OcrRun,
  type OcrEvidence,
  type OcrField,
} from "../../shared/daily-ocr";
import type { DailyNumericRow } from "../../shared/daily-numeric";
import { suggestOcrLayout } from "../../shared/daily-ocr-layout";
import { parseDbUtc } from "../../shared/datetime";
type Row = RowDataPacket & Record<string, any>;
type Scope = { tenantId: string; stationId: string };
const hash = (b: Buffer) => createHash("sha256").update(b).digest("hex");
export function buildOcrPayload(native: any): OcrPayload {
  const width = requireInteger(native?.width, "OCR genişliği"),
    height = requireInteger(native?.height, "OCR yüksekliği");
  if (
    width > 10000 ||
    height > 10000 ||
    width * height > 16000000 ||
    !Array.isArray(native?.lines) ||
    native.lines.length > 1000
  )
    fail("OCR_OUTPUT_INVALID", "OCR sonucu boyut sınırını aşıyor.");
  const result: OcrPayload = {
    engine: "windows-media-ocr",
    language: "tr",
    width,
    height,
    angle:
      typeof native.angle === "number" && Number.isFinite(native.angle)
        ? native.angle
        : null,
    confidence: null,
    lines: [],
    words: [],
    tokens: [],
    warnings: [
      "Motor güven yüzdesi vermiyor. Her değeri kaynak görüntüyle kontrol edin.",
    ],
  };
  let words = 0,
    characters = 0,
    redacted = false;
  native.lines.forEach((line: any, lineIndex: number) => {
    if (!Array.isArray(line?.words))
      fail("OCR_OUTPUT_INVALID", "OCR satır yapısı geçersiz.");
    words += line.words.length;
    if (words > 5000)
      fail(
        "OCR_OUTPUT_LIMIT",
        "OCR 5000 kelime sınırını aşıyor; daha dar bir kaynak görüntü kullanın."
      );
    const texts = line.words.map((w: any) =>
      requireString(w?.text, "OCR kelimesi", { max: 200 })
    );
    characters += texts.join(" ").length;
    if (characters > 100000)
      fail("OCR_OUTPUT_LIMIT", "OCR metni güvenli boyut sınırını aşıyor.");
    if (containsLikelyPan(texts.join(" "))) {
      result.lines.push({
        index: lineIndex,
        text: "[Kart numarası olabilecek alan öneriye alınmadı]",
      });
      redacted = true;
      return;
    }
    result.lines.push({ index: lineIndex, text: texts.join(" ") });
    line.words.forEach((w: any, wordIndex: number) => {
      const values = [w.x, w.y, w.width, w.height];
      if (
        values.some(
          v => typeof v !== "number" || !Number.isFinite(v) || v < 0
        ) ||
        w.x + w.width > width + 1 ||
        w.y + w.height > height + 1
      )
        fail(
          "OCR_OUTPUT_INVALID",
          "OCR kelime konumu görüntü sınırları dışında."
        );
      const parsed = ocrNumber(texts[wordIndex]);
      result.words!.push({
        id: lineIndex + ":" + wordIndex,
        line: lineIndex,
        text: texts[wordIndex],
        box: { x: w.x, y: w.y, width: w.width, height: w.height },
      });
      if (!parsed.choices.length && !parsed.warnings.length) return;
      result.tokens.push({
        id: lineIndex + ":" + wordIndex,
        line: lineIndex,
        raw: texts[wordIndex],
        box: { x: w.x, y: w.y, width: w.width, height: w.height },
        ...parsed,
      });
    });
  });
  if (redacted)
    result.warnings.push(
      "Kart numarası olabilecek bazı alanlar gizlendi; öneriye veya metin kaydına alınmadı."
    );
  if (!result.tokens.length)
    result.warnings.push(
      "Sayı önerisi bulunamadı; kaynak görüntüyü kontrol edip elle girin."
    );
  if (result.angle !== null && Math.abs(result.angle) > 10)
    result.warnings.push(
      "Görüntü eğimi yüksek; sayı ve satır eşleşmelerini ayrıca kontrol edin."
    );
  return result;
}
const run = (r: Row): OcrRun => ({
  id: r.id,
  pageId: r.page_id,
  sourceSha256: r.source_sha256,
  engineVersion: r.engine_version,
  createdAt: parseDbUtc(String(r.created_at)).toISOString(),
  payload: JSON.parse(r.payload_json),
});
async function context(
  c: PoolConnection,
  scope: Scope,
  packageId: unknown,
  pageId: unknown,
  kind: "SHIFT" | "TANKER" = "SHIFT"
) {
  await requireDailyDemo(c, scope);
  const doc = await scopedDailyPackage(c, scope, packageId, false, kind);
  const page = await first<Row>(
    c,
    "SELECT id,source_sha256,mime_type FROM st_daily_report_pages WHERE id=? AND package_id=?",
    [requireId(pageId, "pageId"), doc.id]
  );
  if (!page)
    fail("DAILY_PAGE_NOT_FOUND", "OCR kaynağı bu pakette bulunamadı.", 404);
  return { doc, page };
}
function pageEngineVersion(mime: string, pageNumber: number | null) {
  return mime === "application/pdf" && pageNumber !== null
    ? `${OCR_ENGINE_VERSION}-pdf-page-${pageNumber}`
    : OCR_ENGINE_VERSION;
}
function validatePdfPageNumber(value: unknown, mime: string) {
  if (mime !== "application/pdf") {
    if (value !== undefined) fail("OCR_PDF_PAGE_INVALID", "Bu kaynak PDF sayfası değil.");
    return null;
  }
  if (typeof value !== "number" || !Number.isInteger(value))
    fail("OCR_PDF_PAGE_INVALID", "PDF sayfa numarası 1–100 arasında olmalı.");
  const page = value;
  if (page < 1 || page > 100)
    fail("OCR_PDF_PAGE_INVALID", "PDF sayfa numarası 1–100 arasında olmalı.");
  return page;
}
function readRenderedPdfPage(value: unknown) {
  if (typeof value !== "string" || value.length > 7 * 1024 * 1024 ||
      !/^[A-Za-z0-9+/]*={0,2}$/.test(value))
    fail("OCR_PDF_RENDER_INVALID", "PDF sayfa renderı geçerli veya güvenli boyutta değil.");
  const bytes = Buffer.from(value, "base64");
  if (bytes.length < 8 || bytes.length > 5 * 1024 * 1024 || bytes.toString("base64") !== value)
    fail("OCR_PDF_RENDER_INVALID", "PDF renderı 5 MB sınırını veya base64 denetimini geçemedi.");
  const png = bytes.length >= 24 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) &&
    bytes.subarray(-12).equals(Buffer.from([0, 0, 0, 0, 73, 69, 78, 68, 174, 66, 96, 130]));
  const jpeg = bytes.subarray(0, 3).equals(Buffer.from([255, 216, 255])) && bytes.subarray(-2).equals(Buffer.from([255, 217]));
  if (!png && !jpeg) fail("OCR_PDF_RENDER_INVALID", "Yalnız PNG/JPEG PDF sayfa renderı kabul edilir.");
  return bytes;
}
export async function getDailyOcr(
  c: PoolConnection,
  scope: Scope,
  packageId: unknown,
  pageId: unknown,
  kind: "SHIFT" | "TANKER" = "SHIFT",
  pdfPageValue?: unknown
) {
  const { doc, page } = await context(c, scope, packageId, pageId, kind);
  const pageNumber = validatePdfPageNumber(pdfPageValue, String(page.mime_type)),
    engineVersion = pageEngineVersion(String(page.mime_type), pageNumber);
  // Recheck source bytes before exposing a cached interpretation.
  await dailyReportImage(c, scope, doc.id, page.id, kind);
  const saved = await first<Row>(
    c,
    "SELECT * FROM st_daily_ocr_runs WHERE page_id=? AND source_sha256=? AND engine_version=?",
    [page.id, page.source_sha256, engineVersion]
  );
  return {
    pageId: page.id,
    ...(pageNumber ? { pdfPageNumber: pageNumber } : {}),
    sourceSha256: page.source_sha256,
    run: saved ? run(saved) : null,
  };
}
export async function readDailyOcr(
  c: PoolConnection,
  scope: Scope,
  actorId: number,
  body: Record<string, unknown>,
  kind: "SHIFT" | "TANKER" = "SHIFT"
) {
  const { doc, page } = await context(
    c,
    scope,
    body.packageId,
    body.pageId,
    kind
  );
  if (body.expectedSourceSha256 !== page.source_sha256)
    fail(
      "OCR_SOURCE_CHANGED",
      "Kaynak fotoğraf değişti; sayfayı yenileyin.",
      409
    );
  const pageNumber = validatePdfPageNumber(body.pdfPageNumber, String(page.mime_type)),
    engineVersion = pageEngineVersion(String(page.mime_type), pageNumber),
    sourceDocument = await dailyReportImage(c, scope, doc.id, page.id, kind),
    imageBytes = pageNumber === null
      ? sourceDocument.bytes
      : readRenderedPdfPage(body.renderedPageBase64);
  const saved = await first<Row>(
    c,
    "SELECT * FROM st_daily_ocr_runs WHERE page_id=? AND source_sha256=? AND engine_version=?",
    [page.id, page.source_sha256, engineVersion]
  );
  if (saved)
    return {
      id: saved.id,
      cached: true,
      stockApplied: false,
      financialApplied: false,
    };
  const payload = buildOcrPayload(await recognizeImage(imageBytes));
  if (pageNumber !== null) {
    payload.sourcePageNumber = pageNumber;
    payload.renderedImageSha256 = hash(imageBytes);
    payload.warnings.unshift("PDF sayfası PDF.js ile tarayıcıda yerel olarak render edildi; OCR sonucu otomatik mali kayıt değildir.");
  }
  const id = randomUUID();
  await execute(
    c,
    "INSERT IGNORE INTO st_daily_ocr_runs (id,page_id,source_sha256,engine_version,payload_json,created_by) VALUES (?,?,?,?,?,?)",
    [
      id,
      page.id,
      page.source_sha256,
      engineVersion,
      JSON.stringify(payload),
      actorId,
    ]
  );
  // A concurrent reader may have committed this source while native OCR ran.
  const persisted = await first<Row>(
    c,
    "SELECT * FROM st_daily_ocr_runs WHERE page_id=? AND source_sha256=? AND engine_version=? FOR UPDATE",
    [page.id, page.source_sha256, engineVersion]
  );
  if (!persisted)
    fail("OCR_STORE_FAILED", "OCR sonucu güvenli biçimde kaydedilemedi.", 500);
  return {
    id: persisted.id,
    cached: persisted.id !== id,
    stockApplied: false,
    financialApplied: false,
  };
}
export async function attachOcrEvidence(
  c: PoolConnection,
  scope: Scope,
  packageId: string,
  normalized: DailyNumericRow[],
  raw: unknown
): Promise<DailyNumericRow[]> {
  const sources = raw as any[],
    cache = new Map<string, Row>();
  const layouts = new Map<string, ReturnType<typeof suggestOcrLayout>>();
  for (const [index, row] of normalized.entries()) {
    const refs = sources[index]?.ocr;
    if (refs === undefined) continue;
    if (!Array.isArray(refs) || refs.length > 5)
      fail(
        "OCR_REFERENCE_INVALID",
        "Satır başına en fazla beş OCR alanı kullanılabilir."
      );
    const fields = new Set<string>(),
      evidence: OcrEvidence[] = [];
    let linkedRow: string | null = null;
    for (const ref of refs) {
      const runId = requireId(ref?.runId, "runId"),
        field = requireEnum(
          ref?.field,
          "OCR alanı",
          ocrFields[row.kind] as readonly OcrField[]
        );
      if (
        fields.has(field) ||
        !requireBoolean(ref?.confirmed, "OCR kaynak teyidi")
      )
        fail(
          "OCR_REFERENCE_INVALID",
          "Her OCR alanını kaynaktan ayrı teyit edin; alan tekrarlanamaz.",
          409
        );
      fields.add(field);
      let stored = cache.get(runId);
      if (!stored) {
        if (cache.size >= 12)
          fail(
            "OCR_REFERENCE_LIMIT",
            "Tek taslakta en fazla 12 kaynak okuma kullanılabilir."
          );
        stored =
          (await first<Row>(
            c,
            "SELECT r.*,p.source_sha256 AS current_sha256,p.image_bytes FROM st_daily_ocr_runs r JOIN st_daily_report_pages p ON p.id=r.page_id JOIN st_daily_report_packages d ON d.id=p.package_id WHERE r.id=? AND d.id=? AND d.tenant_id=? AND d.station_id=?",
            [runId, packageId, scope.tenantId, scope.stationId]
          )) ?? undefined;
        if (
          !stored ||
          !Buffer.isBuffer(stored.image_bytes) ||
          hash(stored.image_bytes) !== stored.source_sha256 ||
          stored.current_sha256 !== stored.source_sha256
        )
          fail(
            "OCR_REFERENCE_FORBIDDEN",
            "OCR okuması bu kaynağa ait değil veya kaynak özeti değişti.",
            403
          );
        cache.set(runId, stored);
      }
      if (stored.page_id !== row.pageId || ref.pageId !== row.pageId)
        fail(
          "OCR_REFERENCE_FORBIDDEN",
          "OCR alanı satırın kaynak fotoğrafına ait değil.",
          403
        );
      const tokenId = requireString(ref?.tokenId, "tokenId", { max: 32 }),
        choiceIndex = requireInteger(ref?.choiceIndex, "choiceIndex", {
          allowZero: true,
        });
      const payload: OcrPayload = JSON.parse(stored.payload_json),
        token = payload.tokens.find(t => t.id === tokenId),
        choice = token?.choices[choiceIndex],
        proposedValue =
          field === "amountMinor"
            ? choice?.minor
            : field === "transactionCount"
              ? choice?.count
              : choice?.ml;
      if (!token || !choice || proposedValue == null)
        fail(
          "OCR_REFERENCE_INVALID",
          "OCR sayısı seçilen alanın birim/hassasiyet sınırına uymuyor."
        );
      let layout: OcrEvidence["layout"];
      if (ref.layout !== undefined) {
        if (ref.layout?.version !== 1)
          fail(
            "OCR_LAYOUT_INVALID",
            "Satır önerisi sürümü geçerli değil.",
            409
          );
        const tableId = requireString(ref.layout.tableId, "tableId", {
            max: 190,
          }),
          rowId = requireString(ref.layout.rowId, "rowId", { max: 190 }),
          key = runId + ":" + row.kind;
        let proposal = layouts.get(key);
        if (!proposal) {
          proposal = suggestOcrLayout(payload, row.kind);
          layouts.set(key, proposal);
        }
        const table = proposal.tables.find(t => t.id === tableId),
          suggestion = table?.rows.find(r => r.id === rowId),
          cell = suggestion?.cells.find(c => c.field === field);
        if (
          !table ||
          table.blocked ||
          !suggestion ||
          suggestion.blocked ||
          cell?.tokenIds.length !== 1 ||
          cell.tokenIds[0] !== tokenId
        )
          fail(
            "OCR_LAYOUT_INVALID",
            "Sayı, başlık ve satır ilişkisi kaynakla doğrulanamadı. Tek sayı seçimi kullanılabilir.",
            409
          );
        const identity = runId + ":" + rowId;
        if (linkedRow !== null && linkedRow !== identity)
          fail(
            "OCR_LAYOUT_MIXED_ROWS",
            "Ayrı kaynak satırları otomatik tek satırda birleştirilemez.",
            409
          );
        linkedRow = identity;
        layout = {
          version: 1,
          tableId,
          rowId,
          header: cell.header,
          rowLabel: suggestion.label,
          labelCorrected: suggestion.label !== row.label,
        };
      }
      evidence.push({
        runId,
        pageId: row.pageId,
        tokenId,
        choiceIndex,
        field,
        confirmed: true,
        rawText: token.raw,
        normalized: choice.normalized,
        proposedValue,
        corrected: (row as any)[field] !== proposedValue,
        ...(layout ? { layout } : {}),
      });
    }
    if (evidence.length) row.ocr = evidence;
  }
  return normalized;
}

import { randomUUID, createHash } from "node:crypto";
import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import { first, rows, execute } from "./db";
import {
  requireId,
  requireInteger,
  requireString,
  requireEnum,
  requireBoolean,
  safeCalendarDate,
} from "./domain";
import { fail } from "./types";
import { rejectCardData } from "./safety";
import { readDailyZip } from "./daily-report-zip";
import {
  DAILY_DOCUMENT_MAX_BYTES,
  detectDailyDocumentFormat,
  parseDailyDocument,
  type DailyDocumentFormat,
} from "./daily-report-document";
import { dailyPageKinds, type DailyReview } from "../../shared/daily-report";
import { parseDbUtc } from "../../shared/datetime";
type Row = RowDataPacket & Record<string, any>;
type Scope = { tenantId: string; stationId: string };
export { demo as requireDailyDemo, document as scopedDailyPackage };
async function demo(c: PoolConnection, scope: Scope, lock = false) {
  const tenant = await first<Row>(
    c,
    "SELECT is_demo FROM st_tenants WHERE id=?",
    [scope.tenantId]
  );
  if (!Number(tenant?.is_demo))
    fail(
      "DEMO_REQUIRED",
      "Günlük rapor taslakları yalnız DEMO alanında kullanılabilir.",
      403
    );
  const station = await first<Row>(
    c,
    `SELECT id FROM st_stations WHERE id=? AND tenant_id=?${lock ? " FOR UPDATE" : ""}`,
    [scope.stationId, scope.tenantId]
  );
  if (!station)
    fail("STATION_FORBIDDEN", "İstasyon firma kapsamında bulunamadı.", 403);
}
async function document(
  c: PoolConnection,
  scope: Scope,
  id: unknown,
  lock = false,
  kind: "SHIFT" | "TANKER" = "SHIFT"
) {
  const d = await first<Row>(
    c,
    `SELECT * FROM st_daily_report_packages WHERE id=? AND tenant_id=? AND station_id=?${lock ? " FOR UPDATE" : ""}`,
    [requireId(id, "packageId"), scope.tenantId, scope.stationId]
  );
  if (!d || (d.document_kind ?? "SHIFT") !== kind)
    fail("DAILY_NOT_FOUND", "Günlük rapor bu istasyonda bulunamadı.", 404);
  return d;
}
export async function importDailyReport(
  c: PoolConnection,
  scope: Scope,
  actorId: number,
  body: Record<string, unknown>,
  kind: "SHIFT" | "TANKER" = "SHIFT"
) {
  await demo(c, scope, true);
  const sourceName = requireString(body.sourceName, "Dosya adı", { max: 190 });
  if (!/\.(zip|pdf|xlsx)$/i.test(sourceName) || /[\\/:\x00-\x1f]/.test(sourceName))
    fail("DAILY_NAME_INVALID", "Geçerli ZIP, PDF veya XLSX dosya adı gerekli.");
  let pages: { name: string; sha256: string; mime: string; bytes: Buffer }[],
    sourceSha256: string,
    sourceSetSha256: string,
    parsedFormat: DailyDocumentFormat | null = null,
    parsedPageCount: number | null = null;
  if (/\.zip$/i.test(sourceName)) {
    const zip = readDailyZip(body.zipBase64);
    pages = zip.pages;
    sourceSha256 = zip.sourceSha256;
    sourceSetSha256 = zip.sourceSetSha256;
  } else {
    if (typeof body.zipBase64 !== "string" ||
        body.zipBase64.length > Math.ceil(DAILY_DOCUMENT_MAX_BYTES / 3) * 4 ||
        !/^[A-Za-z0-9+/]*={0,2}$/.test(body.zipBase64))
      fail("DAILY_DOCUMENT_BASE64", "PDF/XLSX dosya içeriği geçerli değil.");
    const sourceBytes = Buffer.from(body.zipBase64, "base64");
    if (sourceBytes.length > DAILY_DOCUMENT_MAX_BYTES ||
        sourceBytes.toString("base64") !== body.zipBase64)
      fail("DAILY_DOCUMENT_SIZE", "PDF/XLSX dosyası en fazla 12 MB olabilir.");
    parsedFormat = detectDailyDocumentFormat(sourceName, sourceBytes);
    const parsed = await parseDailyDocument(parsedFormat, sourceBytes);
    parsedPageCount = parsedFormat === "PDF" ? Number(parsed.pageCount) : null;
    sourceSha256 = createHash("sha256").update(sourceBytes).digest("hex");
    sourceSetSha256 = sourceSha256;
    pages = [{
      name: sourceName,
      sha256: sourceSha256,
      mime: parsedFormat === "PDF" ? "application/pdf" : "application/xlsx",
      bytes: sourceBytes,
    }];
  }
  const existing = await first<Row>(
    c,
    "SELECT id,document_kind FROM st_daily_report_packages WHERE station_id=? AND (source_sha256=? OR source_set_sha256=?)",
    [scope.stationId, sourceSha256, sourceSetSha256]
  );
  if (existing && (existing.document_kind ?? "SHIFT") !== kind)
    fail(
      "SOURCE_CLASS_CONFLICT",
      "Bu kaynak farklı bir belge alanında kayıtlı; aynı kaynak farklı sınıfa otomatik taşınamaz.",
      409
    );
  if (existing)
    return {
      id: existing.id,
      alreadyImported: true,
      pageCount: pages.length,
      stockApplied: false,
      message:
        "Bu ZIP veya aynı fotoğraf seti zaten kayıtlı. İkinci paket oluşturulmadı; mevcut kaydı kullanabilirsiniz.",
    };
  const id = randomUUID();
  await execute(
    c,
    "INSERT INTO st_daily_report_packages (id,tenant_id,station_id,source_name,source_sha256,source_set_sha256,page_count,created_by,document_kind) VALUES (?,?,?,?,?,?,?,?,?)",
    [
      id,
      scope.tenantId,
      scope.stationId,
      sourceName,
      sourceSha256,
      sourceSetSha256,
      pages.length,
      actorId,
      kind,
    ]
  );
  for (const [i, p] of pages.entries())
    await execute(
      c,
      "INSERT INTO st_daily_report_pages (id,package_id,source_name,source_sha256,mime_type,position_index,byte_size,image_bytes) VALUES (?,?,?,?,?,?,?,?)",
      [
        randomUUID(),
        id,
        p.name,
        p.sha256,
        p.mime,
        i + 1,
        p.bytes.length,
        p.bytes,
      ]
    );
  return {
    id,
    alreadyImported: false,
    pageCount: pages.length,
    ...(parsedFormat ? { documentFormat: parsedFormat, physicalPageCount: parsedPageCount } : {}),
    stockApplied: false,
  };
}
export async function parseDailyReportDocument(
  c: PoolConnection,
  scope: Scope,
  packageId: unknown,
  kind: "SHIFT" | "TANKER" = "SHIFT"
) {
  await demo(c, scope);
  const doc = await document(c, scope, packageId, false, kind);
  const source = await first<Row>(
    c,
    "SELECT id,source_name,source_sha256,mime_type,image_bytes FROM st_daily_report_pages WHERE package_id=? ORDER BY position_index LIMIT 2",
    [doc.id]
  );
  if (!source || !Buffer.isBuffer(source.image_bytes) ||
      createHash("sha256").update(source.image_bytes).digest("hex") !== source.source_sha256)
    fail("DAILY_SOURCE_CHANGED", "Kaynak belge özeti doğrulanamadı.", 409);
  const format: DailyDocumentFormat | null = source.mime_type === "application/pdf" ? "PDF"
    : source.mime_type === "application/xlsx" ? "XLSX"
      : null;
  if (!format) fail("DAILY_DOCUMENT_UNSUPPORTED", "Kaynak PDF/XLSX ayrıştırma taslağı değil.", 415);
  const parsed = await parseDailyDocument(format, source.image_bytes);
  return {
    packageId: doc.id,
    sourcePageId: source.id,
    sourceName: source.source_name,
    sourceSha256: source.source_sha256,
    ...parsed,
    financialApplied: false,
  };
}
export function validateDailyReview(
  body: Record<string, unknown>,
  pages: { id: string }[]
) {
  const revision = requireInteger(body.expectedRevision, "expectedRevision", {
    allowZero: true,
  });
  const decision = requireEnum(body.decision, "decision", [
    "PENDING",
    "REVIEWED_DRAFT",
    "REJECTED",
  ] as const);
  const shiftReference = requireString(
      body.shiftReference,
      "Vardiya referansı",
      { max: 64 }
    ),
    reportDay = safeCalendarDate(body.reportDay, "Rapor günü");
  const note = requireString(body.note, "Açıklama", { max: 1000 }),
    evidence = requireString(body.evidence, "Kanıt", { max: 500 });
  rejectCardData(note, evidence, shiftReference);
  if (!Array.isArray(body.pages) || body.pages.length !== pages.length)
    fail(
      "DAILY_PAGES_INCOMPLETE",
      "Her kaynak fotoğrafı bir kez sınıflandırın."
    );
  const seen = new Set<string>();
  const classified = body.pages.map((p: any) => {
    const pageId = requireId(p?.pageId, "pageId");
    if (seen.has(pageId) || !pages.some(s => s.id === pageId))
      fail(
        "DAILY_PAGE_FORBIDDEN",
        "Fotoğraf bu pakete ait değil veya tekrarlanmış.",
        403
      );
    seen.add(pageId);
    return { pageId, kind: requireEnum(p.kind, "Sayfa türü", dailyPageKinds) };
  });
  if (
    decision === "REVIEWED_DRAFT" &&
    (!requireBoolean(body.sourceConfirmed, "Kaynak teyidi") ||
      classified.some(p => p.kind === "UNKNOWN"))
  )
    fail(
      "DAILY_REVIEW_INCOMPLETE",
      "Fotoğrafları sınıflandırın ve vardiya bilgilerini kaynaktan teyit edin.",
      409
    );
  return {
    revision,
    decision,
    shiftReference,
    reportDay,
    note,
    evidence,
    pages: classified,
  };
}
export async function reviewDailyReport(
  c: PoolConnection,
  scope: Scope,
  actorId: number,
  body: Record<string, unknown>
) {
  await demo(c, scope, true);
  const d = await document(c, scope, body.packageId, true);
  const pages = await rows<Row[]>(
    c,
    "SELECT id FROM st_daily_report_pages WHERE package_id=? ORDER BY position_index",
    [d.id]
  );
  const v = validateDailyReview(
    body,
    pages.map(p => ({ id: String(p.id) }))
  );
  const last = await first<Row>(
    c,
    "SELECT revision FROM st_daily_report_reviews WHERE package_id=? ORDER BY revision DESC LIMIT 1 FOR UPDATE",
    [d.id]
  );
  if (Number(last?.revision ?? 0) !== v.revision)
    fail(
      "REVISION_CONFLICT",
      "Taslak incelemesi değişti; güncel veriyi yenileyin.",
      409
    );
  await execute(
    c,
    "INSERT INTO st_daily_report_reviews (id,package_id,revision,decision,shift_reference,report_day,page_kinds_json,note,evidence,reviewer_id) VALUES (?,?,?,?,?,?,?,?,?,?)",
    [
      randomUUID(),
      d.id,
      v.revision + 1,
      v.decision,
      v.shiftReference,
      v.reportDay,
      JSON.stringify(v.pages),
      v.note,
      v.evidence,
      actorId,
    ]
  );
  return {
    id: d.id,
    revision: v.revision + 1,
    decision: v.decision,
    stockApplied: false,
    financialApplied: false,
  };
}
const pack = (d: Row) => ({
  id: d.id,
  sourceName: d.source_name,
  sourceSha256: d.source_sha256,
  pageCount: Number(d.page_count),
  createdAt: parseDbUtc(String(d.created_at)).toISOString(),
});
export async function dailyReportOverview(
  c: PoolConnection,
  scope: Scope,
  id?: string
) {
  await demo(c, scope);
  const packages = await rows<Row[]>(
    c,
    "SELECT * FROM st_daily_report_packages WHERE tenant_id=? AND station_id=? AND document_kind='SHIFT' ORDER BY created_at DESC,id DESC LIMIT 101",
    [scope.tenantId, scope.stationId]
  );
  if (packages.length > 100)
    fail(
      "DAILY_REPORT_RANGE",
      "Rapor sayısı 100 sınırını aştı; arşiv filtresi gerekli."
    );
  const selected = id ? await document(c, scope, id) : packages[0];
  if (!selected)
    return { packages: [], document: null, pages: [], review: null };
  const source = await rows<Row[]>(
    c,
    "SELECT id,source_name,source_sha256,mime_type,byte_size,position_index FROM st_daily_report_pages WHERE package_id=? ORDER BY position_index",
    [selected.id]
  );
  const r = await first<Row>(
    c,
    "SELECT r.*,u.name AS reviewer_name FROM st_daily_report_reviews r JOIN users u ON u.id=r.reviewer_id WHERE r.package_id=? ORDER BY r.revision DESC LIMIT 1",
    [selected.id]
  );
  const review: DailyReview | null = r
    ? {
        revision: Number(r.revision),
        decision: r.decision,
        shiftReference: r.shift_reference,
        reportDay: String(r.report_day).slice(0, 10),
        pages: JSON.parse(r.page_kinds_json),
        note: r.note,
        evidence: r.evidence,
        reviewerName: r.reviewer_name,
        createdAt: parseDbUtc(String(r.created_at)).toISOString(),
      }
    : null;
  return {
    packages: packages.map(pack),
    document: pack(selected),
    review,
    pages: source.map(p => ({
      id: p.id,
      name: p.source_name,
      sha256: p.source_sha256,
      mime: p.mime_type,
      size: Number(p.byte_size),
      position: Number(p.position_index),
      kind: review?.pages.find(r => r.pageId === p.id)?.kind ?? "UNKNOWN",
    })),
  };
}
export async function dailyReportImage(
  c: PoolConnection,
  scope: Scope,
  packageId: unknown,
  pageId: unknown,
  kind: "SHIFT" | "TANKER" = "SHIFT"
) {
  await demo(c, scope);
  const d = await document(c, scope, packageId, false, kind);
  const p = await first<Row>(
    c,
    "SELECT mime_type,source_sha256,image_bytes FROM st_daily_report_pages WHERE id=? AND package_id=?",
    [requireId(pageId, "pageId"), d.id]
  );
  if (!p)
    fail("DAILY_PAGE_NOT_FOUND", "Kaynak fotoğraf bu pakette bulunamadı.", 404);
  if (
    !Buffer.isBuffer(p.image_bytes) ||
    createHash("sha256").update(p.image_bytes).digest("hex") !== p.source_sha256
  )
    fail("DAILY_SOURCE_CHANGED", "Kaynak fotoğraf özeti doğrulanamadı.", 409);
  return {
    mime: p.mime_type === "application/xlsx"
      ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      : p.mime_type,
    bytes: p.image_bytes,
  };
}

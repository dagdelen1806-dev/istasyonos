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
  payloadHash,
} from "./domain";
import { fail } from "./types";
import { rejectCardData } from "./safety";
import { requireDailyDemo, scopedDailyPackage } from "./daily-report";
import { getDailyOcr, readDailyOcr } from "./daily-ocr";
import { OCR_ENGINE_VERSION } from "./windows-ocr";
import {
  extractTankerWithOpenAi,
  tankerOpenAiAvailable,
  tankerOpenAiModel,
} from "./tanker-openai";
import { suggestOcrLayout } from "../../shared/daily-ocr-layout";
import { ocrNumber, type OcrPayload } from "../../shared/daily-ocr";
import {
  tankerCompleteness,
  type TankerValues,
  type TankerProposal,
  type TankerReview,
  type TankerRead,
} from "../../shared/tanker-document";
import { parseDbUtc } from "../../shared/datetime";
import { normalizeOcrDate, invoiceArithmetic, extractInvoiceMoneyFields } from "./ocr-normalize";
import {
  extractGeminiDocument,
  geminiOcrAvailable,
  geminiOcrModel,
} from "./gemini-ocr";
type Row = RowDataPacket & Record<string, any>;
type Scope = { tenantId: string; stationId: string };
const nullableString = (v: unknown, label: string, max = 190) =>
  v == null || v === "" ? null : requireString(v, label, { max });
const nullableInt = (v: unknown, label: string) =>
  v == null ? null : requireInteger(v, label, { allowZero: true });
function sourceMl(value: unknown, warnings: string[]): number | null {
  if (value == null) return null;
  const text = requireString(value, "Kaynak litre", { max: 40 }),
    parsed = ocrNumber(text);
  if (parsed.choices.length !== 1 || parsed.choices[0].ml === null) {
    warnings.push(
      "Belirsiz litre biçimi kullanıcı tarafından doğrulanmalı: " + text
    );
    return null;
  }
  return parsed.choices[0].ml;
}
export function tankerProposalFromModel(
  raw: any,
  pageIds: string[]
): TankerProposal {
  if (
    !raw ||
    !Array.isArray(raw.pages) ||
    raw.pages.length !== pageIds.length ||
    !Array.isArray(raw.lines) ||
    raw.lines.length > 20 ||
    !Array.isArray(raw.warnings) ||
    raw.warnings.length > 30
  )
    fail("TANKER_MODEL_INVALID", "Belge okuma yapısı doğrulanamadı.");
  const warnings = raw.warnings.map((w: unknown) =>
      requireString(w, "Okuma uyarısı", { max: 500 })
    ),
    seen = new Set<number>();
  const pages = raw.pages.map((p: any) => {
    const index = requireInteger(p?.imageIndex, "imageIndex");
    if (index > pageIds.length || seen.has(index))
      fail("TANKER_MODEL_INVALID", "Kaynak sayfa eşleşmesi doğrulanamadı.");
    seen.add(index);
    return {
      pageId: pageIds[index - 1],
      number:
        p.number == null ? null : requireInteger(p.number, "Sayfa numarası"),
      total: p.total == null ? null : requireInteger(p.total, "Toplam sayfa"),
    };
  });
  const values: TankerValues = {
    documentNo: nullableString(raw.documentNo, "Belge no"),
    issuer: nullableString(raw.issuer, "Düzenleyen"),
    documentDate: (() => { const d=normalizeOcrDate(raw.documentDate); if(d.original && !d.value) warnings.push("Belge tarihi biçimi geçersiz; kullanıcı doğrulaması gerekli."); return d.value ? safeCalendarDate(d.value,"Belge tarihi") : null; })(),
    supplierId: null,
    pages,
    lines: raw.lines.map((l: any, i: number) => ({
      key: "LINE-" + (i + 1),
      productCode: nullableString(l.productCode, "Ürün kodu", 64),
      label: nullableString(l.label, "Ürün adı") ?? "Doğrulama gerekli",
      fuelId: null,
      netMl: sourceMl(l.netText, warnings),
      dispatchMl: sourceMl(l.dispatchText, warnings),
    })),
  };
  rejectCardData(
    values.documentNo,
    values.issuer,
    ...values.lines.flatMap(l => [l.label, l.productCode]),
    ...warnings
  );
  const expectedPages = Math.max(
    0,
    ...pages.map((p: { total: number | null }) => p.total ?? 0)
  );
  if (expectedPages > pageIds.length)
    warnings.push(
      `Belge ${expectedPages} sayfa; yalnız ${pageIds.length} görüntü yüklü. Eksik sayfalar tamamlanmadan kabul kaynağı doğrulanamaz.`
    );
  return {
    values,
    warnings: [
      ...warnings,
      "Net hacim ve sevk miktarı ayrı korunur. İstasyonda ölçülen teslim litresini kullanıcı ayrıca girmelidir.",
    ],
  };
}
export function localTankerProposal(
  inputs: { pageId: string; payload: OcrPayload }[]
): TankerProposal {
  const texts = inputs.flatMap(i => i.payload.lines.map(l => l.text)),
    numbers = [
      ...new Set(texts.flatMap(t => t.match(/\b[A-Z]{2,4}\d{12,20}\b/g) ?? [])),
    ];
  const dateTexts = [
    ...new Set(texts.flatMap(t => t.match(/\b\d{2}\.\d{2}\.\d{4}\b/g) ?? [])),
  ];
  let date: string | null = null;
  if (dateTexts.length === 1) {
    const [d, m, y] = dateTexts[0].split(".");
    try {
      date = safeCalendarDate(y + "-" + m + "-" + d, "Belge tarihi");
    } catch {}
  }
  const issuers = [
    ...new Set(
      inputs.flatMap(i =>
        i.payload.lines
          .filter(
            l =>
              /petrol|akaryak[ıi]t/i.test(l.text) &&
              /(?:a\.?\s*[şs]\.?|ltd)/i.test(l.text)
          )
          .filter(l => {
            const words =
              i.payload.words?.filter(w => w.line === l.index) ?? [];
            return (
              words.length > 0 &&
              Math.max(...words.map(w => w.box.y)) < i.payload.height * 0.25
            );
          })
          .map(l => l.text)
      )
    ),
  ];
  const warnings: string[] = [
      "Yerel okuma başlık ve konum önerisidir; ürün kodları ve bütün alanlar kullanıcı kontrolü gerektirir.",
    ],
    lines: TankerValues["lines"] = [];
  const pages = inputs.map((i, index) => {
    const candidates = i.payload.lines
      .filter(
        l =>
          /sayfa|page/i.test(l.text) ||
          /^\s*\d{1,2}\s*\/\s*\d{1,2}\s*$/.test(l.text)
      )
      .flatMap(l => {
        const m = l.text.match(/\b([1-9]\d?)\s*\/\s*([1-9]\d?)\b/);
        return m ? [{ number: Number(m[1]), total: Number(m[2]) }] : [];
      });
    const unique = [
      ...new Map(candidates.map(p => [p.number + "/" + p.total, p])).values(),
    ];
    const layout = suggestOcrLayout(i.payload, "TANKER");
    warnings.push(...layout.warnings);
    for (const table of layout.tables)
      for (const row of table.rows) {
        if (table.blocked || row.blocked) continue;
        const get = (field: string) => {
          const c = row.cells.find(c => c.field === field),
            token =
              c?.tokenIds.length === 1
                ? i.payload.tokens.find(t => t.id === c.tokenIds[0])
                : undefined;
          return token?.choices.length === 1 ? token.choices[0].ml : null;
        };
        lines.push({
          key: "LINE-" + (lines.length + 1),
          label: row.label,
          productCode: null,
          fuelId: null,
          netMl: get("netMl") ?? null,
          dispatchMl: get("dispatchMl") ?? null,
        });
      }
    return {
      pageId: i.pageId,
      number: unique.length === 1 ? unique[0].number : null,
      total: unique.length === 1 ? unique[0].total : null,
    };
  });
  if (lines.length > 20)
    fail(
      "TANKER_LINE_LIMIT",
      "20 ürün satırı sınırı aşıldı; belgeyi inceleyin."
    );
  const expectedPages = Math.max(0, ...pages.map(p => p.total ?? 0));
  if (expectedPages > inputs.length)
    warnings.push(
      `Belge ${expectedPages} sayfa; yalnız ${inputs.length} görüntü yüklü. Eksik sayfalar tamamlanmadan kabul kaynağı doğrulanamaz.`
    );
  return {
    values: {
      documentNo: numbers.length === 1 ? numbers[0] : null,
      issuer: issuers.length === 1 ? issuers[0] : null,
      documentDate: date,
      supplierId: null,
      pages,
      lines,
    },
    warnings: [
      ...new Set([
        ...warnings,
        "Eksik veya belirsiz alanlar boş bırakıldı; fiziksel teslim litresi evraktan türetilmedi.",
      ]),
    ],
  };
}
export async function tankerContext(
  c: PoolConnection,
  scope: Scope,
  packageId: unknown,
  lock = false
) {
  await requireDailyDemo(c, scope, lock);
  const doc = await scopedDailyPackage(c, scope, packageId, lock, "TANKER");
  const pages = await rows<Row[]>(
    c,
    "SELECT id,source_name,source_sha256,mime_type,image_bytes FROM st_daily_report_pages WHERE package_id=? ORDER BY position_index",
    [doc.id]
  );
  for (const p of pages)
    if (
      !Buffer.isBuffer(p.image_bytes) ||
      createHash("sha256").update(p.image_bytes).digest("hex") !==
        p.source_sha256
    )
      fail(
        "TANKER_SOURCE_CHANGED",
        "Tanker evrakının kaynak özeti değişti.",
        409
      );
  return {
    doc,
    pages,
    sourceHash: payloadHash(
      pages.map(p => ({ id: p.id, sha256: p.source_sha256 }))
    ),
  };
}
const readRow = (r: Row): TankerRead => ({
  id: r.id,
  provider: r.provider,
  model: r.model_name,
  createdAt: parseDbUtc(String(r.created_at)).toISOString(),
  proposal: JSON.parse(r.proposal_json),
});
const reviewRow = (r: Row): TankerReview => ({
  id: r.id,
  revision: Number(r.revision),
  readId: r.read_id,
  decision: r.decision,
  values: JSON.parse(r.values_json),
  sourceConfirmed: !!Number(r.source_confirmed),
  note: r.note,
  evidence: r.evidence,
  reviewerName: r.reviewer_name,
  createdAt: parseDbUtc(String(r.created_at)).toISOString(),
});
export async function tankerOverview(
  c: PoolConnection,
  scope: Scope,
  packageId?: string
) {
  await requireDailyDemo(c, scope);
  const packages = await rows<Row[]>(
    c,
    "SELECT id,source_name,page_count FROM st_daily_report_packages WHERE tenant_id=? AND station_id=? AND document_kind='TANKER' ORDER BY created_at DESC,id DESC LIMIT 101",
    [scope.tenantId, scope.stationId]
  );
  if (packages.length > 100)
    fail(
      "TANKER_ARCHIVE_LIMIT",
      "100 tanker belge sınırı aşıldı; arşiv filtresi gerekli."
    );
  const id = packageId ?? packages[0]?.id,
    ctx = id ? await tankerContext(c, scope, id) : null;
  const reads = ctx
    ? await rows<Row[]>(
        c,
        "SELECT * FROM st_tanker_document_reads WHERE package_id=? ORDER BY created_at DESC,id DESC LIMIT 101",
        [ctx.doc.id]
      )
    : [];
  const history = ctx
    ? await rows<Row[]>(
        c,
        "SELECT r.*,u.name AS reviewer_name FROM st_tanker_document_reviews r JOIN users u ON u.id=r.reviewer_id WHERE package_id=? ORDER BY revision DESC LIMIT 101",
        [ctx.doc.id]
      )
    : [];
  if (reads.length > 100 || history.length > 100)
    fail(
      "TANKER_HISTORY_LIMIT",
      "100 belge inceleme sınırı aşıldı; arşivleme gerekli."
    );
  const suppliers = await rows<Row[]>(
    c,
    "SELECT id,name FROM st_suppliers WHERE tenant_id=? AND station_id=? ORDER BY name,id",
    [scope.tenantId, scope.stationId]
  );
  const fuels = await rows<Row[]>(
    c,
    "SELECT id,name FROM st_fuel_types WHERE tenant_id=? AND station_id=? ORDER BY name,id",
    [scope.tenantId, scope.stationId]
  );
  const tanks = await rows<Row[]>(
    c,
    "SELECT c.tank_id AS tankId,t.fuel_type_id AS fuelId,c.tank_number AS number,f.name AS fuel,c.revision,c.stock_ml AS stockMl,c.capacity_ml AS capacityMl FROM st_tank_cards c JOIN st_fuel_tanks t ON t.id=c.tank_id JOIN st_fuel_types f ON f.id=t.fuel_type_id WHERE c.tenant_id=? AND c.station_id=? ORDER BY c.tank_number",
    [scope.tenantId, scope.stationId]
  );
  const receipts = ctx
    ? await rows<Row[]>(
        c,
        "SELECT q.id AS requestId,x.line_key AS lineKey,x.basis,q.status,q.tank_id AS tankId,q.document_ml AS documentMl,q.measured_ml AS measuredMl,q.note,q.evidence,q.review_note AS reviewNote,q.review_evidence AS reviewEvidence,q.created_at AS createdAt,r.revision AS sourceRevision,r.values_json AS sourceValues,creator.name AS creatorName,reviewer.name AS reviewerName FROM st_tanker_receipt_links x JOIN st_tanker_document_reviews r ON r.id=x.review_id JOIN st_tank_requests q ON q.id=x.request_id LEFT JOIN users creator ON creator.id=q.created_by LEFT JOIN users reviewer ON reviewer.id=q.reviewer_id WHERE r.package_id=? AND q.tenant_id=? AND q.station_id=? ORDER BY q.created_at DESC,q.id DESC",
        [ctx.doc.id, scope.tenantId, scope.stationId]
      )
    : [];
  return {
    packages: packages.map(p => ({
      id: p.id,
      name: p.source_name,
      pageCount: Number(p.page_count),
    })),
    document: ctx ? { id: ctx.doc.id, name: ctx.doc.source_name } : null,
    pages:
      ctx?.pages.map(p => ({
        id: p.id,
        name: p.source_name,
        sha256: p.source_sha256,
      })) ?? [],
    sourceHash: ctx?.sourceHash ?? "",
    reads: reads.map(readRow),
    history: history.map(reviewRow),
    latest: history[0] ? reviewRow(history[0]) : null,
    suppliers,
    fuels,
    tanks: tanks.map(t => ({
      ...t,
      revision: Number(t.revision),
      stockMl: t.stockMl === null ? null : Number(t.stockMl),
      capacityMl: Number(t.capacityMl),
    })),
    receipts: receipts.map(r => {
      const source = JSON.parse(r.sourceValues) as TankerValues,
        line = source.lines.find(l => l.key === r.lineKey),
        documentMl = r.documentMl === null ? null : Number(r.documentMl),
        measuredMl = r.measuredMl === null ? null : Number(r.measuredMl);
      return {
        requestId: r.requestId,
        lineKey: r.lineKey,
        basis: r.basis,
        status: r.status,
        tankId: r.tankId,
        sourceRevision: Number(r.sourceRevision),
        documentNo: source.documentNo,
        productLabel: line?.label ?? r.lineKey,
        productCode: line?.productCode ?? null,
        netMl: line?.netMl ?? null,
        dispatchMl: line?.dispatchMl ?? null,
        documentMl,
        measuredMl,
        differenceMl:
          documentMl === null || measuredMl === null
            ? null
            : measuredMl - documentMl,
        note: r.note,
        evidence: r.evidence,
        reviewNote: r.reviewNote,
        reviewEvidence: r.reviewEvidence,
        creatorName: r.creatorName,
        reviewerName: r.reviewerName,
        createdAt: parseDbUtc(String(r.createdAt)).toISOString(),
      };
    }),
    openai: { available: tankerOpenAiAvailable(), model: tankerOpenAiModel() },
    gemini: { available: geminiOcrAvailable(), model: geminiOcrModel() },
    externalDisabled: process.env.STATIONOS_DEMO_ONLY === "istasyonos_demo",
  };
}
let externalActive = false;
export async function readTankerDocument(
  c: PoolConnection,
  scope: Scope,
  actorId: number,
  body: Record<string, unknown>
): Promise<{
  id: string;
  cached: boolean;
  stockApplied: boolean;
  fallback?: boolean;
  message?: string;
}> {
  const { doc, pages, sourceHash } = await tankerContext(
    c,
    scope,
    body.packageId
  );
  if (body.expectedSourceHash !== sourceHash)
    fail(
      "TANKER_SOURCE_CHANGED",
      "Kaynak evrak değişti; sayfayı yenileyin.",
      409
    );
  const provider = requireEnum(body.provider, "Okuma yöntemi", [
      "LOCAL",
      "OPENAI",
      "GEMINI",
    ] as const),
    kind =
      body.documentType === undefined
        ? "TANKER"
        : requireEnum(body.documentType, "Belge türü", [
            "TANKER",
            "TANK",
            "INVOICE",
          ] as const),
    model =
      provider === "LOCAL"
        ? OCR_ENGINE_VERSION
        : provider === "GEMINI"
          ? geminiOcrModel()
          : tankerOpenAiModel(),
    version = provider + ":" + model + ":" + kind + ":v3";
  const previous = await first<Row>(
    c,
    "SELECT id FROM st_tanker_document_reads WHERE package_id=? AND source_hash=? AND engine_version=?",
    [doc.id, sourceHash, version]
  );
  if (previous) return { id: previous.id, cached: true, stockApplied: false };
  let proposal: TankerProposal;
  if (provider === "GEMINI") {
    if (!requireBoolean(body.externalConfirmed, "Google görüntü gönderimi"))
      fail(
        "GEMINI_CONSENT_REQUIRED",
        "Belge görüntülerinin Google'a gönderimini teyit edin.",
        409
      );
    if (externalActive)
      fail("OCR_BUSY", "Başka bir gelişmiş okuma sürüyor.", 429);
    externalActive = true;
    try {
      const result = await extractGeminiDocument(
        pages.map(p => ({ mime: p.mime_type, bytes: p.image_bytes })),
        kind
      );
      proposal = tankerProposalFromModel(
        result.raw,
        pages.map(p => p.id)
      );
      if (kind !== "TANKER")
        proposal.values.documentFields = validateDocumentFields({
          kind,
          fields: result.raw.fields,
        });
      // Preserve OCR source strings in documentFields; the primary documentDate is
      // normalized separately by tankerProposalFromModel for calendar storage.
      const documentFields = proposal.values.documentFields?.fields;
      const dateField = documentFields?.find(field => /tarih|date/i.test(field.label));
      if (dateField?.value) {
        const parsed = normalizeOcrDate(dateField.value);
        if (!parsed.value) {
          proposal.warnings.push("Belge tarihi okunamadı/geçersiz; kullanıcı incelemesi gerekli.");
        }
      }
      if (kind === "INVOICE" && documentFields) {
        const invoice = extractInvoiceMoneyFields(documentFields);
        const { subtotalTry, vatTry, totalTry } = invoice.values;
        const check = invoiceArithmetic(subtotalTry, vatTry, totalTry);
        if (check.status !== "CONSISTENT" || invoice.ambiguousFields.length > 0) {
          proposal.warnings.push(
            "REVIEW_REQUIRED: Fatura ara toplamı + KDV ile belgede okunan genel toplam eksik, belirsiz veya uyuşmuyor; tutarları kullanıcı doğrulamalı."
          );
        }
      }
    } catch (error) {
      const reason =
        error instanceof Error &&
        "code" in error &&
        String(error.code).startsWith("GEMINI_")
          ? error.message
          : "Gemini çıktısı güvenle doğrulanamadı.";
      const fallback = await readTankerDocument(c, scope, actorId, {
        ...body,
        provider: "LOCAL",
        documentType: kind,
      });
      return {
        ...fallback,
        fallback: true,
        message: "Gemini kullanılamadı; yerel OCR kullanıldı. " + reason,
      };
    } finally {
      externalActive = false;
    }
  } else if (provider === "LOCAL") {
    const inputs: { pageId: string; payload: OcrPayload }[] = [];
    for (const p of pages) {
      await readDailyOcr(
        c,
        scope,
        actorId,
        {
          packageId: doc.id,
          pageId: p.id,
          expectedSourceSha256: p.source_sha256,
        },
        "TANKER"
      );
      const result = await getDailyOcr(c, scope, doc.id, p.id, "TANKER");
      if (!result.run)
        fail("TANKER_OCR_MISSING", "Yerel okuma sonucu bulunamadı.", 500);
      inputs.push({ pageId: p.id, payload: result.run.payload });
    }
    proposal = localTankerProposal(inputs);
    if (kind !== "TANKER") {
      proposal.values.lines = [];
      proposal.values.documentFields = { kind, fields: [] };
      proposal.warnings.push(
        "Yerel OCR metni okundu; bu belge türünde alanlar güvenle eşleştirilemedi. Kaynak fotoğrafla karşılaştırıp elle alan ekleyin."
      );
    }
  } else {
    if (!requireBoolean(body.externalConfirmed, "OpenAI görüntü gönderimi"))
      fail(
        "OPENAI_CONSENT_REQUIRED",
        "Belge görüntülerinin OpenAI'a gönderileceğini teyit edin.",
        409
      );
    if (externalActive)
      fail("OPENAI_BUSY", "Başka bir gelişmiş belge okuması sürüyor.", 429);
    externalActive = true;
    try {
      const result = await extractTankerWithOpenAi(
        pages.map(p => ({ mime: p.mime_type, bytes: p.image_bytes }))
      );
      proposal = tankerProposalFromModel(
        result.raw,
        pages.map(p => p.id)
      );
    } finally {
      externalActive = false;
    }
  }
  const id = randomUUID();
  await execute(
    c,
    "INSERT IGNORE INTO st_tanker_document_reads (id,package_id,source_hash,engine_version,provider,model_name,proposal_json,created_by) VALUES (?,?,?,?,?,?,?,?)",
    [
      id,
      doc.id,
      sourceHash,
      version,
      provider,
      model,
      JSON.stringify(proposal),
      actorId,
    ]
  );
  const saved = await first<Row>(
    c,
    "SELECT id FROM st_tanker_document_reads WHERE package_id=? AND source_hash=? AND engine_version=? FOR UPDATE",
    [doc.id, sourceHash, version]
  );
  if (!saved) fail("TANKER_OCR_STORE", "Belge okuması kaydedilemedi.", 500);
  return { id: saved.id, cached: saved.id !== id, stockApplied: false };
}
export function validateDocumentFields(raw: any) {
  const kind = requireEnum(raw?.kind, "Belge türü", [
    "TANK",
    "INVOICE",
  ] as const);
  if (!Array.isArray(raw.fields) || raw.fields.length > 100)
    fail("OCR_FIELDS_INVALID", "En fazla 100 belge alanı desteklenir.");
  const fields = raw.fields.map((f: any) => ({
    label: requireString(f?.label, "Alan adı", { max: 190 }),
    value: nullableString(f.value, "Alan değeri", 190),
    unit: nullableString(f.unit, "Birim", 32),
  }));
  for (const f of fields) {
    rejectCardData(f.label, f.value, f.unit);
    if (
      kind === "TANK" &&
      /kapasite/i.test(f.label) &&
      f.value !== null &&
      /^0(?:[.,]0+)?(?:\s*L)?$/i.test(f.value.trim())
    )
      f.value = null;
  }
  return { kind, fields };
}
export function validateTankerValues(
  raw: any,
  pageIds: string[]
): TankerValues {
  if (
    !raw ||
    !Array.isArray(raw.pages) ||
    raw.pages.length !== pageIds.length ||
    !Array.isArray(raw.lines) ||
    raw.lines.length > 20
  )
    fail(
      "TANKER_VALUES_INVALID",
      "Her kaynak sayfa ve en fazla 20 ürün satırı gerekli."
    );
  const seenPages = new Set<string>(),
    keys = new Set<string>();
  const pages = raw.pages.map((p: any) => {
    const pageId = requireId(p?.pageId, "pageId");
    if (!pageIds.includes(pageId) || seenPages.has(pageId))
      fail(
        "TANKER_PAGE_FORBIDDEN",
        "Sayfa bu evraka ait değil veya tekrarlanmış.",
        403
      );
    seenPages.add(pageId);
    const number =
        p.number == null ? null : requireInteger(p.number, "Sayfa no"),
      total = p.total == null ? null : requireInteger(p.total, "Toplam sayfa");
    if ((total ?? 0) > 12 || (number ?? 0) > 12)
      fail("TANKER_PAGE_LIMIT", "En fazla 12 sayfalık evrak desteklenir.");
    return { pageId, number, total };
  });
  const lines = raw.lines.map((l: any) => {
    const key = requireString(l?.key, "Satır anahtarı", { max: 64 });
    if (keys.has(key))
      fail("TANKER_LINE_DUPLICATE", "Ürün satır anahtarı tekrarlanamaz.", 409);
    keys.add(key);
    const row = {
      key,
      label: requireString(l?.label, "Ürün adı", { max: 190 }),
      productCode: nullableString(l.productCode, "Ürün kodu", 64),
      fuelId: l.fuelId == null ? null : requireId(l.fuelId, "fuelId"),
      netMl: nullableInt(l.netMl, "Net litre"),
      dispatchMl: nullableInt(l.dispatchMl, "Sevk litresi"),
    };
    rejectCardData(row.label, row.productCode);
    return row;
  });
  const values = {
    ...(raw.documentFields
      ? { documentFields: validateDocumentFields(raw.documentFields) }
      : {}),
    documentNo: nullableString(raw.documentNo, "Belge no"),
    issuer: nullableString(raw.issuer, "Düzenleyen"),
    documentDate:
      raw.documentDate == null
        ? null
        : safeCalendarDate(raw.documentDate, "Belge tarihi"),
    supplierId:
      raw.supplierId == null ? null : requireId(raw.supplierId, "supplierId"),
    pages,
    lines,
  };
  rejectCardData(values.documentNo, values.issuer);
  return values;
}
export async function saveTankerDocument(
  c: PoolConnection,
  scope: Scope,
  actorId: number,
  body: Record<string, unknown>
) {
  const ctx = await tankerContext(c, scope, body.packageId, true);
  const active = await first<Row>(
    c,
    "SELECT q.id FROM st_tanker_receipt_links x JOIN st_tanker_document_reviews r ON r.id=x.review_id JOIN st_tank_requests q ON q.id=x.request_id WHERE r.package_id=? AND q.status IN ('PENDING','APPROVED') LIMIT 1",
    [ctx.doc.id]
  );
  if (active)
    fail(
      "TANKER_RECEIPT_LOCKED",
      "Bu evrakta bekleyen/onaylı tanker kabulü var. Bekleyen talebi mevcut ret/düzeltme akışıyla çözmeden kaynak değiştirilemez.",
      409
    );
  if (body.expectedSourceHash !== ctx.sourceHash)
    fail("TANKER_SOURCE_CHANGED", "Kaynak evrak değişti.", 409);
  const latest = await first<Row>(
    c,
    "SELECT revision FROM st_tanker_document_reviews WHERE package_id=? ORDER BY revision DESC LIMIT 1 FOR UPDATE",
    [ctx.doc.id]
  );
  if (
    requireInteger(body.expectedRevision, "expectedRevision", {
      allowZero: true,
    }) !== Number(latest?.revision ?? 0)
  )
    fail(
      "REVISION_CONFLICT",
      "Tanker evrakı incelemesi değişti; güncel kaydı yükleyin.",
      409
    );
  const decision = requireEnum(body.decision, "Karar", [
      "PENDING",
      "VERIFIED_DRAFT",
      "REJECTED",
    ] as const),
    sourceConfirmed = requireBoolean(body.sourceConfirmed, "Kaynak teyidi"),
    values = validateTankerValues(
      body.values,
      ctx.pages.map(p => p.id)
    ),
    readId = body.readId == null ? null : requireId(body.readId, "readId");
  let source: TankerRead | null = null;
  if (readId) {
    const stored = await first<Row>(
      c,
      "SELECT * FROM st_tanker_document_reads WHERE id=? AND package_id=? AND source_hash=?",
      [readId, ctx.doc.id, ctx.sourceHash]
    );
    if (!stored)
      fail("TANKER_READ_FORBIDDEN", "Belge okuması bu evraka ait değil.", 403);
    source = readRow(stored);
    if (
      source.proposal.values.documentFields &&
      values.documentFields?.kind !== source.proposal.values.documentFields.kind
    )
      fail(
        "OCR_DOCUMENT_TYPE_CHANGED",
        "Okuma belge türü değiştirilemez; ilgili kaynak taslağını kullanın.",
        409
      );
  }
  if (
    values.supplierId &&
    !(await first<Row>(
      c,
      "SELECT id FROM st_suppliers WHERE id=? AND tenant_id=? AND station_id=?",
      [values.supplierId, scope.tenantId, scope.stationId]
    ))
  )
    fail("SUPPLIER_FORBIDDEN", "Tedarikçi seçili istasyona ait değil.", 403);
  for (const line of values.lines)
    if (
      line.fuelId &&
      !(await first<Row>(
        c,
        "SELECT id FROM st_fuel_types WHERE id=? AND tenant_id=? AND station_id=?",
        [line.fuelId, scope.tenantId, scope.stationId]
      ))
    )
      fail("FUEL_FORBIDDEN", "Yakıt seçili istasyona ait değil.", 403);
  if (decision === "VERIFIED_DRAFT") {
    const allReads = await rows<Row[]>(
      c,
      "SELECT proposal_json FROM st_tanker_document_reads WHERE package_id=? AND source_hash=?",
      [ctx.doc.id, ctx.sourceHash]
    );
    const warnings = tankerCompleteness(values),
      sourceTotal = Math.max(
        0,
        ...allReads.flatMap(r =>
          (JSON.parse(r.proposal_json) as TankerProposal).values.pages.map(
            p => p.total ?? 0
          )
        )
      );
    if (!sourceConfirmed || warnings.length || sourceTotal > ctx.pages.length)
      fail(
        "TANKER_DOCUMENT_INCOMPLETE",
        "Evrak eksik/çelişkili. Bütün sayfaları, net/sevk hacimlerini ve eşleştirmeleri doğrulayın.",
        409
      );
  }
  const note = requireString(body.note, "Açıklama", { max: 1000 }),
    evidence = requireString(body.evidence, "Kanıt", { max: 500 });
  rejectCardData(note, evidence);
  const id = randomUUID(),
    revision = Number(latest?.revision ?? 0) + 1;
  await execute(
    c,
    "INSERT INTO st_tanker_document_reviews (id,package_id,revision,read_id,source_hash,decision,values_json,source_confirmed,note,evidence,reviewer_id) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
    [
      id,
      ctx.doc.id,
      revision,
      readId,
      ctx.sourceHash,
      decision,
      JSON.stringify(values),
      sourceConfirmed,
      note,
      evidence,
      actorId,
    ]
  );
  return {
    id,
    packageId: ctx.doc.id,
    revision,
    decision,
    stockApplied: false,
    financialApplied: false,
  };
}

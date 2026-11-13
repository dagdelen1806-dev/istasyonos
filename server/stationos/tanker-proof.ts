import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import { first, execute } from "./db";
import { requireId, requireString, requireEnum, payloadHash } from "./domain";
import { fail } from "./types";
import { tankerContext } from "./tanker-document";
import {
  tankerCompleteness,
  type TankerValues,
} from "../../shared/tanker-document";
type Row = RowDataPacket & Record<string, any>;
type Scope = { tenantId: string; stationId: string };
export async function prepareTankerReceipt(
  c: PoolConnection,
  scope: Scope,
  body: Record<string, unknown>
) {
  if (body.tankerDocument === undefined) return null;
  const input = body.tankerDocument as any;
  if (body.kind !== "DELIVERY")
    fail(
      "TANKER_DELIVERY_REQUIRED",
      "Evrak bağlantısı yalnız tanker kabulünde kullanılabilir."
    );
  const reviewId = requireId(input?.reviewId, "reviewId"),
    lineKey = requireString(input?.lineKey, "lineKey", { max: 64 }),
    basis = requireEnum(input?.basis, "Belge hacim esası", [
      "NET",
      "DISPATCH",
    ] as const);
  const review = await first<Row>(
    c,
    "SELECT r.* FROM st_tanker_document_reviews r JOIN st_daily_report_packages d ON d.id=r.package_id WHERE r.id=? AND d.tenant_id=? AND d.station_id=? AND d.document_kind='TANKER' FOR UPDATE",
    [reviewId, scope.tenantId, scope.stationId]
  );
  if (!review || review.decision !== "VERIFIED_DRAFT")
    fail(
      "TANKER_REVIEW_REQUIRED",
      "Tanker evrakının bütün sayfaları ve ürünleri doğrulanmış olmalı.",
      409
    );
  const latest = await first<Row>(
    c,
    "SELECT id FROM st_tanker_document_reviews WHERE package_id=? ORDER BY revision DESC LIMIT 1",
    [review.package_id]
  );
  const ctx = await tankerContext(c, scope, review.package_id, true),
    values: TankerValues = JSON.parse(review.values_json),
    line = values.lines.find(l => l.key === lineKey);
  if (
    latest?.id !== reviewId ||
    review.source_hash !== ctx.sourceHash ||
    tankerCompleteness(values).length ||
    !line
  )
    fail(
      "TANKER_REVIEW_STALE",
      "Tanker evrakı değişti veya ürün satırı doğrulanamadı.",
      409
    );
  const amount = basis === "NET" ? line.netMl : line.dispatchMl;
  if (values.documentFields)
    fail(
      "TANKER_DOCUMENT_TYPE",
      "Tank fotoğrafı veya fatura, tanker kabul kaynağı olarak kullanılamaz.",
      409
    );
  if (
    body.supplierId !== values.supplierId ||
    body.reference !== values.documentNo ||
    body.documentMl !== amount
  )
    fail(
      "TANKER_RECEIPT_MISMATCH",
      "Tedarikçi, belge numarası ve seçilen net/sevk hacmi onaylı kaynak taslağıyla aynı olmalı.",
      409
    );
  const tank = await first<Row>(
    c,
    "SELECT fuel_type_id FROM st_fuel_tanks WHERE id=? AND station_id=?",
    [body.tankId, scope.stationId]
  );
  if (!tank || tank.fuel_type_id !== line.fuelId)
    fail(
      "TANKER_FUEL_MISMATCH",
      "Seçilen tank doğrulanmış ürünün yakıt türüne ait değil.",
      409
    );
  const businessKey = payloadHash({
    tenantId: scope.tenantId,
    stationId: scope.stationId,
    supplierId: values.supplierId,
    documentNo: values
      .documentNo!.normalize("NFC")
      .trim()
      .toLocaleUpperCase("tr-TR"),
    productCode: line
      .productCode!.normalize("NFC")
      .trim()
      .toLocaleUpperCase("tr-TR"),
  });
  const duplicate = await first<Row>(
    c,
    "SELECT q.id FROM st_tanker_receipt_links x JOIN st_tank_requests q ON q.id=x.request_id WHERE x.business_key=? AND q.status IN ('PENDING','APPROVED') FOR UPDATE",
    [businessKey]
  );
  if (duplicate)
    fail(
      "TANKER_DUPLICATE_RECEIPT",
      "Bu tedarikçi/belge/ürün için bekleyen veya onaylı tanker kabulü zaten var.",
      409
    );
  return { reviewId, lineKey, basis, businessKey };
}
export async function linkTankerReceipt(
  c: PoolConnection,
  requestId: string,
  source: NonNullable<Awaited<ReturnType<typeof prepareTankerReceipt>>>
) {
  await execute(
    c,
    "INSERT INTO st_tanker_receipt_links (request_id,review_id,line_key,business_key,basis) VALUES (?,?,?,?,?)",
    [
      requestId,
      source.reviewId,
      source.lineKey,
      source.businessKey,
      source.basis,
    ]
  );
}
export async function assertTankerReceiptCurrent(
  c: PoolConnection,
  scope: Scope,
  request: Row
) {
  const link = await first<Row>(
    c,
    "SELECT r.*,x.line_key,x.basis FROM st_tanker_receipt_links x JOIN st_tanker_document_reviews r ON r.id=x.review_id WHERE x.request_id=? AND r.id=?",
    [request.id, request.tanker_review_id]
  );
  if (!link)
    fail("TANKER_SOURCE_LINK_MISSING", "Tanker kaynak bağı bulunamadı.", 409);
  const latest = await first<Row>(
      c,
      "SELECT id FROM st_tanker_document_reviews WHERE package_id=? ORDER BY revision DESC LIMIT 1",
      [link.package_id]
    ),
    ctx = await tankerContext(c, scope, link.package_id, true),
    values: TankerValues = JSON.parse(link.values_json),
    line = values.lines.find(l => l.key === link.line_key);
  if (
    latest?.id !== request.tanker_review_id ||
    link.decision !== "VERIFIED_DRAFT" ||
    ctx.sourceHash !== link.source_hash ||
    !line ||
    tankerCompleteness(values).length ||
    values.supplierId !== request.supplier_id ||
    values.documentNo !== request.reference ||
    Number(request.document_ml) !==
      (link.basis === "NET" ? line.netMl : line.dispatchMl)
  )
    fail(
      "TANKER_SOURCE_CHANGED",
      "Tanker kaynak taslağı değişti; eski talep stok onayı alamaz.",
      409
    );
}

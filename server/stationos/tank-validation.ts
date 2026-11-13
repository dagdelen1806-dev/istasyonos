import { randomUUID } from "node:crypto";
import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import { first, rows, execute } from "./db";
import {
  requireId,
  requireString,
  requireInteger,
  requireEnum,
  requireBoolean,
} from "./domain";
import { rejectCardData } from "./safety";
import { fail } from "./types";
import {
  analyzePhotoTank,
  type PhotoTank,
  type ValidationCard,
  type Proposal,
} from "../../shared/tank-validation";
import { parseDbUtc } from "../../shared/datetime";
type Row = RowDataPacket & Record<string, any>;
type Scope = { tenantId: string; stationId: string };
async function demo(c: PoolConnection, scope: Scope) {
  if (
    !Number(
      (
        await first<Row>(c, `SELECT is_demo FROM st_tenants WHERE id=?`, [
          scope.tenantId,
        ])
      )?.is_demo
    )
  )
    fail(
      "DEMO_REQUIRED",
      "Fotoğraf doğrulaması yalnız DEMO taslakları içindir.",
      403
    );
}
export function sourceRows(value: unknown): PhotoTank[] {
  if (!Array.isArray(value) || !value.length || value.length > 100)
    fail("PHOTO_SOURCE_INVALID", "1–100 tank satırı gerekli.");
  const seen = new Set<string>();
  return value.map((row: any) => {
    const number = requireString(row?.number, "number", { max: 32 }),
      fuelLabel = requireString(row?.fuelLabel, "fuelLabel", { max: 190 });
    if (seen.has(number))
      fail("PHOTO_SOURCE_INVALID", "Kaynakta mükerrer tank numarası.");
    seen.add(number);
    for (const key of [
      "capacityLitres",
      "productVolumeLitres",
      "netProductVolumeLitres",
      "emptyVolumeLitres",
      "reportedVolumeFillPercent",
      "reportedLevelPercent",
    ])
      if (
        row[key] !== null &&
        row[key] !== undefined &&
        (typeof row[key] !== "number" || !Number.isFinite(row[key]))
      )
        fail("PHOTO_SOURCE_INVALID", "Kaynak sayısı geçersiz.");
    return { ...row, number, fuelLabel };
  });
}
async function document(
  c: PoolConnection,
  scope: Scope,
  id: string,
  lock = false
) {
  const doc = await first<Row>(
    c,
    `SELECT * FROM st_tank_photo_drafts WHERE id=? AND tenant_id=? AND station_id=?${lock ? " FOR UPDATE" : ""}`,
    [requireId(id, "documentId"), scope.tenantId, scope.stationId]
  );
  if (!doc)
    fail(
      "PHOTO_DOCUMENT_NOT_FOUND",
      "Taslak belge istasyon kapsamında bulunamadı.",
      404
    );
  return doc;
}
async function cards(
  c: PoolConnection,
  scope: Scope
): Promise<ValidationCard[]> {
  return (
    await rows<Row[]>(
      c,
      `SELECT c.tank_id,c.tank_number,c.capacity_ml,f.name AS fuel FROM st_tank_cards c JOIN st_fuel_tanks t ON t.id=c.tank_id JOIN st_fuel_types f ON f.id=t.fuel_type_id WHERE c.station_id=? AND c.tenant_id=? ORDER BY c.tank_number`,
      [scope.stationId, scope.tenantId]
    )
  ).map(r => ({
    tankId: r.tank_id,
    number: r.tank_number,
    capacityMl: Number(r.capacity_ml),
    fuel: r.fuel,
  }));
}
export async function photoOverview(
  c: PoolConnection,
  scope: Scope,
  documentId?: string
) {
  await demo(c, scope);
  const documents = await rows<Row[]>(
    c,
    `SELECT id,source_name,source_sha256,photo_sha256,displayed_at FROM st_tank_photo_drafts WHERE tenant_id=? AND station_id=? ORDER BY created_at DESC,id LIMIT 100`,
    [scope.tenantId, scope.stationId]
  );
  const id = documentId ?? documents[0]?.id;
  if (!id) return { documents: [], document: null, rows: [], cards: [] };
  const doc = await document(c, scope, id),
    available = await cards(c, scope),
    source = sourceRows(JSON.parse(doc.rows_json));
  const reviews = await rows<Row[]>(
    c,
    `SELECT r.*,u.name AS reviewer_name FROM st_tank_photo_reviews r JOIN users u ON u.id=r.reviewer_id WHERE r.document_id=? ORDER BY r.revision DESC,r.created_at DESC`,
    [id]
  );
  const mapped = source.map(s => {
    const r = reviews.find(r => r.row_key === s.number),
      analysis = analyzePhotoTank(s, available);
    return {
      source: s,
      analysis,
      review: r
        ? {
            rowNumber: r.row_key,
            revision: Number(r.revision),
            decision: r.decision,
            proposal: {
              tankId: r.tank_id,
              basis: r.basis,
              capacityMl: r.capacity_ml === null ? null : Number(r.capacity_ml),
              volumeMl: r.volume_ml === null ? null : Number(r.volume_ml),
              productMl: r.product_ml == null ? null : Number(r.product_ml),
              netMl: r.net_ml == null ? null : Number(r.net_ml),
            },
            note: r.note,
            evidence: r.evidence,
            reviewerName: r.reviewer_name,
          }
        : null,
    };
  });
  return {
    documents: documents.map(d => ({
      id: d.id,
      sourceName: d.source_name,
      hasPhoto: !!d.photo_sha256,
    })),
    document: {
      id: doc.id,
      sourceName: doc.source_name,
      sha256: doc.source_sha256,
      displayedAt: parseDbUtc(String(doc.displayed_at)).toISOString(),
      hasPhoto: !!doc.photo_sha256,
    },
    rows: mapped,
    cards: available,
  };
}
export async function photoImageHash(
  c: PoolConnection,
  scope: Scope,
  id: string
) {
  await demo(c, scope);
  const doc = await document(c, scope, id);
  if (!/^[a-f0-9]{64}$/.test(doc.photo_sha256 ?? ""))
    fail("PHOTO_UNAVAILABLE", "Kaynak fotoğraf mevcut değil.", 404);
  return String(doc.photo_sha256);
}
export function validateProposal(
  proposal: Proposal,
  decision: string,
  confirmSource: boolean,
  acknowledged: boolean
) {
  if (decision !== "APPROVED_DRAFT") return;
  if (
    !proposal.tankId ||
    proposal.basis === "UNDECIDED" ||
    proposal.capacityMl === null ||
    proposal.capacityMl <= 0 ||
    (proposal.basis === "BOTH"
      ? proposal.productMl == null ||
        proposal.netMl == null ||
        !Number.isSafeInteger(proposal.productMl) ||
        !Number.isSafeInteger(proposal.netMl) ||
        proposal.productMl < 0 ||
        proposal.netMl < 0 ||
        proposal.productMl > proposal.capacityMl
      : proposal.volumeMl === null ||
        proposal.volumeMl < 0 ||
        proposal.volumeMl > proposal.capacityMl) ||
    !confirmSource ||
    !acknowledged
  )
    fail(
      "PHOTO_REVIEW_INCOMPLETE",
      "Taslak onayı için tank, hacim tanımı, pozitif kapasite, geçerli hacim ve kaynak/uyarı teyitleri gerekli.",
      409
    );
}
export async function reviewPhoto(
  c: PoolConnection,
  scope: Scope,
  actorId: number,
  body: Record<string, unknown>
) {
  await demo(c, scope);
  const doc = await document(
      c,
      scope,
      requireId(body.documentId, "documentId"),
      true
    ),
    rowNumber = requireString(body.rowNumber, "rowNumber", { max: 32 }),
    source = sourceRows(JSON.parse(doc.rows_json));
  if (!source.some(s => s.number === rowNumber))
    fail("PHOTO_ROW_NOT_FOUND", "Bu tank kaynak belgede yok.", 404);
  const previous = await first<Row>(
    c,
    `SELECT * FROM st_tank_photo_reviews WHERE document_id=? AND row_key=? ORDER BY revision DESC LIMIT 1 FOR UPDATE`,
    [doc.id, rowNumber]
  );
  const revision = previous ? Number(previous.revision) : 0,
    expected = requireInteger(body.expectedRevision, "expectedRevision", {
      allowZero: true,
    });
  if (revision !== expected)
    fail("REVISION_CONFLICT", "Taslak incelemesi değişti; yenileyin.", 409);
  const decision = requireEnum(body.decision, "decision", [
      "PENDING",
      "APPROVED_DRAFT",
      "REJECTED",
    ] as const),
    basis = requireEnum(body.basis, "basis", [
      "UNDECIDED",
      "PRODUCT",
      "NET",
      "BOTH",
    ] as const);
  const nullable = (v: unknown, label: string) =>
    v === null ? null : requireInteger(v, label, { allowZero: true });
  const proposal: Proposal = {
    tankId: body.tankId ? requireId(body.tankId, "tankId") : null,
    basis,
    capacityMl: nullable(body.capacityMl, "capacityMl"),
    volumeMl: nullable(body.volumeMl, "volumeMl"),
    productMl: nullable(body.productMl ?? null, "productMl"),
    netMl: nullable(body.netMl ?? null, "netMl"),
  };
  if (proposal.capacityMl === 0) proposal.capacityMl = null;
  if (
    proposal.tankId &&
    !(await cards(c, scope)).some(c => c.tankId === proposal.tankId)
  )
    fail("TANK_FORBIDDEN", "Seçilen tank bu DEMO istasyonda değil.", 403);
  const confirm = requireBoolean(body.sourceConfirmed, "sourceConfirmed"),
    ack = requireBoolean(body.warningsAcknowledged, "warningsAcknowledged");
  validateProposal(proposal, decision, confirm, ack);
  const note = requireString(body.note, "note", { max: 1000 }),
    evidence = requireString(body.evidence, "evidence", { max: 500 });
  rejectCardData(note, evidence);
  const id = randomUUID();
  await execute(
    c,
    `INSERT INTO st_tank_photo_reviews (id,document_id,row_key,revision,decision,tank_id,basis,capacity_ml,volume_ml,note,evidence,source_confirmed,warnings_acknowledged,reviewer_id,product_ml,net_ml) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      id,
      doc.id,
      rowNumber,
      revision + 1,
      decision,
      proposal.tankId,
      basis,
      proposal.capacityMl,
      proposal.volumeMl,
      note,
      evidence,
      confirm,
      ack,
      actorId,
      proposal.productMl ?? null,
      proposal.netMl ?? null,
    ]
  );
  return {
    id,
    documentId: doc.id,
    rowNumber,
    revision: revision + 1,
    decision,
    proposal,
    note,
    evidence,
    stockApplied: false,
  };
}

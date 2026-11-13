import { fuelInteger } from "./fuel";
import { safeSum } from "./icmal";
export const numericKinds = ["SALES", "METER", "TANK", "TENDER", "STAFF_SALES", "STAFF_TENDER"] as const;
export const numericLabels = {
  STAFF_SALES: "\u0050ersonel bazl\u0131 yak\u0131t sat\u0131\u015f\u0131",
  STAFF_TENDER: "\u0050ersonel bazl\u0131 \u00f6zel i\u015flem",
  SALES: "Yakıt satışı",
  METER: "Tabanca sayacı",
  TANK: "Tank çıkışı",
  TENDER: "Tahsilat / özel işlem",
};
export const tenderKinds = [
  "CASH",
  "CARD",
  "IBAN",
  "FAST",
  "DEBT",
  "TTS",
  "GIFT_LOAD",
  "GIFT_USE",
  "PARTNER",
  "TTS_GIFT_COMBINED",
  "OTHER",
] as const;
export const tenderLabels: Record<(typeof tenderKinds)[number], string> = {
  CASH: "Nakit satış tahsilatı",
  CARD: "Kredi kartı",
  IBAN: "IBAN",
  FAST: "FAST (banka teyidi bekliyor)",
  DEBT: "Cari satış",
  TTS: "TTS",
  GIFT_LOAD: "Gift Kart yükleme (satış değildir)",
  GIFT_USE: "Gift Kart kullanım",
  PARTNER: "Partner Kart",
  TTS_GIFT_COMBINED: "TTS + Gift kullanım (rapor birleşik satırı)",
  OTHER: "Diğer / modeli belirsiz",
};
type Base = {
  pageId: string;
  label: string;
  sourceLocation?: string;
  ocr?: import("./daily-ocr").OcrEvidence[];
};
export type DailyNumericRow = Base &
  (
    | {
        kind: "SALES";
        fuelId: string | null;
        basis: "UNDECIDED" | "METER" | "COMMERCIAL";
        volumeMl: number | null;
        amountMinor: number | null;
      }
    | {
        kind: "METER";
        nozzleId: string | null;
        openingMl: number | null;
        closingMl: number | null;
        reportedMl: number | null;
      }
    | {
        kind: "TANK";
        tankId: string | null;
        openingMl: number | null;
        closingMl: number | null;
        deliveryMl: number | null;
        returnMl: number | null;
      }
    | {
        kind: "TENDER";
        category: (typeof tenderKinds)[number];
        amountMinor: number | null;
      }
    | {
        kind: "STAFF_SALES";
        staffUserId: number;
        fuelId: string | null;
        basis: "UNDECIDED" | "METER" | "COMMERCIAL";
        transactionCount: number | null;
        volumeMl: number | null;
        amountMinor: number | null;
      }
    | {
        kind: "STAFF_TENDER";
        staffUserId: number;
        category: (typeof tenderKinds)[number];
        transactionCount: number | null;
        amountMinor: number | null;
      }
  );
export interface NumericStaff {
  userId: number;
  name: string;
}
export interface NumericEquipment {
  id: string;
  label: string;
  tankId: string;
  tank: string;
  pump: string;
  fuelId: string;
  fuel: string;
}
export interface NumericNozzle {
  id: string;
  openingMl: number | null;
  closingMl: number | null;
  meterMl: number | null;
  meterMinor: number | null;
  commercialMl: number | null;
  commercialMinor: number | null;
}
export interface NumericAccount {
  id: string;
  userId: number;
  revision: number;
  status: string;
  closed: boolean;
  nozzles: NumericNozzle[];
  tenders: Partial<Record<(typeof tenderKinds)[number], number>>;
  specialPending: boolean;
}
export interface NumericCell {
  label: string;
  unit: "L" | "TRY" | "COUNT";
  source: number | null;
  current: number | null;
  difference: number | null;
}
export interface NumericComparison {
  rows: {
    index: number;
    kind: DailyNumericRow["kind"];
    label: string;
    staffUserId?: number;
    cells: NumericCell[];
    warnings: string[];
  }[];
  accountCount: number;
  complete: boolean;
  warnings: string[];
}
function signed(n: number) {
  if (!Number.isSafeInteger(n))
    throw Error("Fark güvenli tamsayı sınırını aşıyor.");
  return n;
}
export function numericComparison(
  source: DailyNumericRow[],
  equipment: NumericEquipment[],
  accounts: NumericAccount[]
): NumericComparison {
  const complete =
    accounts.length > 0 && accounts.every(a => a.closed && !a.specialPending);
  const nozzles = accounts.flatMap(a => a.nozzles);
  const warnings = complete
    ? []
    : [
        "Seçili vardiyanın sayaç/özel işlem kayıtları eksik veya vardiya seçilmedi. Kesin karşılaştırma yapılamaz.",
      ];
  const cell = (
    label: string,
    unit: "L" | "TRY" | "COUNT",
    value: number | null,
    current: number | null
  ): NumericCell => ({
    label,
    unit,
    source: value,
    current,
    difference:
      value === null || current === null ? null : signed(value - current),
  });
  const sum = (ns: NumericNozzle[], field: keyof NumericNozzle) =>
    ns.length && ns.every(n => n[field] !== null)
      ? safeSum(ns.map(n => fuelInteger(n[field], String(field))))
      : null;
  const result = source.map((r, index) => {
    const notes: string[] = [],
      cells: NumericCell[] = [];
    if (r.kind === "METER") {
      const current = nozzles.filter(n => n.id === r.nozzleId),
        n = complete && current.length === 1 ? current[0] : null;
      const delta =
        r.openingMl === null || r.closingMl === null
          ? null
          : signed(r.closingMl - r.openingMl);
      if (delta !== null && delta < 0)
        notes.push(
          "Kaynak sayaç geriliyor; otomatik devir/sıfırlama uygulanmadı."
        );
      if (delta !== null && r.reportedMl !== null && delta !== r.reportedMl)
        notes.push("Kaynaktaki litre ile kapanış−açılış uyuşmuyor.");
      if (!r.nozzleId) notes.push("Tabanca eşleştirilmedi.");
      if (current.length > 1)
        notes.push(
          "Tabanca birden fazla hesaba bağlı; karşılaştırma durduruldu."
        );
      cells.push(
        cell("Açılış sayacı", "L", r.openingMl, n?.openingMl ?? null),
        cell("Kapanış sayacı", "L", r.closingMl, n?.closingMl ?? null),
        cell("Sayaç litresi (kapanış−açılış)", "L", delta, n?.meterMl ?? null)
      );
    } else if (r.kind === "SALES" || r.kind === "TANK") {
      const mapped = equipment.filter(e =>
        r.kind === "SALES" ? e.fuelId === r.fuelId : e.tankId === r.tankId
      );
      const ns = mapped.flatMap(e => nozzles.filter(n => n.id === e.id));
      const ready =
        complete &&
        mapped.length > 0 &&
        mapped.every(e => nozzles.filter(n => n.id === e.id).length === 1);
      if (!mapped.length) notes.push("Yakıt/tank eşleştirilmedi.");
      else if (!ready)
        notes.push(
          "Eşleştirilen yakıt/tankın tüm tabancaları için tamamlanmış tekil kayıt gerekli."
        );
      if (r.kind === "SALES") {
        if (r.basis === "UNDECIDED")
          notes.push("Satışın sayaç veya ticari satış esası belirtilmedi.");
        const chosen = ready && r.basis !== "UNDECIDED";
        cells.push(
          cell(
            "Satış litresi",
            "L",
            r.volumeMl,
            chosen
              ? sum(ns, r.basis === "METER" ? "meterMl" : "commercialMl")
              : null
          ),
          cell(
            "Satış tutarı",
            "TRY",
            r.amountMinor,
            chosen
              ? sum(ns, r.basis === "METER" ? "meterMinor" : "commercialMinor")
              : null
          )
        );
      } else {
        const out = [r.openingMl, r.closingMl, r.deliveryMl, r.returnMl].some(
          v => v === null
        )
          ? null
          : signed(
              safeSum([r.openingMl!, r.deliveryMl!, r.returnMl!]) - r.closingMl!
            );
        if (out !== null && out < 0)
          notes.push(
            "Tank çıkışı negatif; giriş/ölçüm bilgilerini doğrulayın."
          );
        cells.push(
          cell(
            "Net tank çıkışı ↔ sayaç çıkışı",
            "L",
            out,
            ready ? sum(ns, "meterMl") : null
          )
        );
      }
    } else if (r.kind === "TENDER") {
      const known =
        complete &&
        r.category !== "OTHER" &&
        accounts.every(a => a.tenders[r.category] !== undefined);
      cells.push(
        cell(
          tenderLabels[r.category],
          "TRY",
          r.amountMinor,
          known ? safeSum(accounts.map(a => a.tenders[r.category]!)) : null
        )
      );
      if (r.category === "OTHER")
        notes.push("İş modeli belirsiz; tahsilat sınıfı varsayılmadı.");
      if (r.category === "GIFT_LOAD")
        notes.push("Yükleme yakıt satışı veya ilave gelir sayılmaz.");
      if (r.category === "TTS_GIFT_COMBINED")
        notes.push(
          "Birleşik satır yalnız rapor karşılaştırmasıdır; ayrı TTS/Gift satırlarına eklenmez."
        );
    } else if (r.kind === "STAFF_SALES") {
      const staffAccounts = complete
          ? accounts.filter(a => a.userId === r.staffUserId)
          : [],
        mapped = equipment.filter(e => e.fuelId === r.fuelId),
        ownNozzles = staffAccounts.flatMap(a =>
          mapped.flatMap(e => a.nozzles.filter(n => n.id === e.id))
        ),
        ready =
          staffAccounts.length === 1 &&
          ownNozzles.length > 0 &&
          new Set(ownNozzles.map(n => n.id)).size === ownNozzles.length;
      if (!staffAccounts.length) notes.push("Personel vardiya hesabı bulunamadı.");
      else if (staffAccounts.length > 1)
        notes.push("Personel için birden fazla vardiya hesabı var.");
      if (!r.fuelId) notes.push("Yakıt eşleştirilmedi.");
      if (r.basis === "UNDECIDED") notes.push("Satış esası belirlenmedi.");
      cells.push(
        cell("İşlem adedi (icmalde bulunmuyor)", "COUNT", r.transactionCount, null),
        cell(
          "Personel yakıt litresi",
          "L",
          r.volumeMl,
          ready && r.basis !== "UNDECIDED"
            ? sum(ownNozzles, r.basis === "METER" ? "meterMl" : "commercialMl")
            : null
        ),
        cell(
          "Personel yakıt tutarı",
          "TRY",
          r.amountMinor,
          ready && r.basis !== "UNDECIDED"
            ? sum(ownNozzles, r.basis === "METER" ? "meterMinor" : "commercialMinor")
            : null
        )
      );
      notes.push("Kaynak personel satırı karşılaştırılır; istasyon toplamına eklenmez.");
    } else if (r.kind === "STAFF_TENDER") {
      const staffAccounts = complete
          ? accounts.filter(a => a.userId === r.staffUserId)
          : [],
        current =
          staffAccounts.length === 1
            ? (staffAccounts[0].tenders[r.category] ?? null)
            : null;
      if (!staffAccounts.length) notes.push("Personel vardiya hesabı bulunamadı.");
      else if (staffAccounts.length > 1)
        notes.push("Personel için birden fazla vardiya hesabı var.");
      cells.push(
        cell("İşlem adedi (icmalde bulunmuyor)", "COUNT", r.transactionCount, null),
        cell(tenderLabels[r.category], "TRY", r.amountMinor, current)
      );
      if (r.category === "OTHER") notes.push("İş modeli belirsiz; tahsilat türü varsayılmadı.");
      if (r.category === "GIFT_LOAD") notes.push("Gift yüklemesi satış sayılmaz.");
      if (r.category === "TTS_GIFT_COMBINED") notes.push("Birleşik TTS/Gift satırı ayrı kategorilerle toplanmaz.");
      notes.push("Kaynak personel satırı karşılaştırılır; istasyon toplamına eklenmez.");
    }
    if (cells.some(c => c.source === null))
      notes.push("Kaynak değer eksik; sıfır kabul edilmedi.");
    return {
      index,
      kind: r.kind,
      label: r.label,
      ...(r.kind === "STAFF_SALES" || r.kind === "STAFF_TENDER"
        ? { staffUserId: r.staffUserId }
        : {}),
      cells,
      warnings: notes,
    };
  });
  return { rows: result, accountCount: accounts.length, complete, warnings };
}
export interface NumericRevision {
  revision: number;
  sourceRevision: number;
  shiftId: string | null;
  decision: "PENDING" | "VERIFIED_DRAFT" | "REJECTED";
  rows: DailyNumericRow[];
  note: string;
  evidence: string;
  sourceConfirmed: boolean;
  shiftConfirmed: boolean;
  snapshotHash: string;
  savedComparison: NumericComparison;
  createdAt: string;
  reviewerName: string;
}
export interface DailyNumericOverview {
  sourceRevision: number;
  sourceDecision: string;
  sourceDay: string | null;
  equipment: NumericEquipment[];
  staff: NumericStaff[];
  accounts: NumericAccount[];
  shifts: { id: string; label: string; startsAt: string }[];
  selectedShiftId: string | null;
  latest: NumericRevision | null;
  history: NumericRevision[];
  comparison: NumericComparison;
  currentSnapshotHash: string;
  stale: boolean;
}

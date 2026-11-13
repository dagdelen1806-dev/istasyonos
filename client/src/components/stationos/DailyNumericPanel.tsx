import { useEffect, useState, useRef, type FormEvent } from "react";
import { DailyOcrPanel } from "./DailyOcrPanel";
import type { OcrRowPick } from "./OcrLayoutPanel";
import {
  ocrFieldLabels,
  type OcrEvidence,
  type OcrField,
} from "@shared/daily-ocr";
import type { AppState } from "@shared/station";
import type { DailyPage } from "@shared/daily-report";
import {
  numericKinds,
  numericLabels,
  tenderKinds,
  tenderLabels,
  numericComparison,
  type DailyNumericRow,
  type DailyNumericOverview,
} from "@shared/daily-numeric";
import { litres, parseLitres } from "@shared/fuel";
import { parseMoney, money, amountInput } from "@shared/station";
import { Panel, Field, Notice } from "./Common";
import { downloadSheets, printSheets } from "@/lib/icmal-export";
import type { OesseShiftReportDraft } from "@shared/oesse-shift-report";
type Props = {
  state: AppState;
  stationId: string;
  packageId: string;
  pages: DailyPage[];
  pageId: string;
  pdfPageCount?: number;
  onPage: (id: string) => void;
  busy: boolean;
  onAction: (path: string, body: Record<string, unknown>) => Promise<boolean>;
  onShiftReportDraft?: (draft: OesseShiftReportDraft | null) => void;
};
const input = (v: number | null | undefined) =>
  v == null ? "" : String(v / 1000).replace(".", ",");
export function DailyNumericPanel({
  state,
  stationId,
  packageId,
  pages,
  pageId,
  pdfPageCount = 0,
  onPage,
  busy,
  onAction,
  onShiftReportDraft,
}: Props) {
  const [data, setData] = useState<DailyNumericOverview | null>(null),
    [rows, setRows] = useState<DailyNumericRow[]>([]),
    [kind, setKind] = useState<DailyNumericRow["kind"]>("SALES"),
    [shiftId, setShiftId] = useState<string | null>(null),
    [version, setVersion] = useState(0),
    [revision, setRevision] = useState(0),
    [dirty, setDirty] = useState(false),
    [loading, setLoading] = useState(false),
    [error, setError] = useState(""),
    [editing, setEditing] = useState<number | null>(null),
    [formVersion, setFormVersion] = useState(0),
    [resetVersion, setResetVersion] = useState(0),
    [ocrEvidence, setOcrEvidence] = useState<OcrEvidence[]>([]);
  const editor = useRef<HTMLFormElement>(null);
  function pickOcrRow(label: string, values: OcrRowPick[]) {
    if (editing !== null || !editor.current) return;
    const names = [
      "volume",
      "amount",
      "transactionCount",
      "opening",
      "closing",
      "reported",
      "delivery",
      "returned",
      "label",
      "sourceLocation",
      "mapping",
    ];
    for (const name of names) {
      const input = editor.current.elements.namedItem(name);
      if (
        input instanceof HTMLInputElement ||
        input instanceof HTMLSelectElement
      )
        input.value = "";
    }
    const basis = editor.current.elements.namedItem("basis"),
      category = editor.current.elements.namedItem("category"),
      input = editor.current.elements.namedItem("label");
    if (basis instanceof HTMLSelectElement) basis.value = "UNDECIDED";
    if (category instanceof HTMLSelectElement) category.value = "OTHER";
    if (input instanceof HTMLInputElement) input.value = label;
    setOcrEvidence([]);
    for (const value of values) pickOcr(value.field, value.value, value.proof);
    setDirty(true);
  }
  function pickOcr(field: OcrField, value: string, proof: OcrEvidence) {
    const names: Record<OcrField, string> = {
      transactionCount: "transactionCount",
      volumeMl: "volume",
      amountMinor: "amount",
      openingMl: "opening",
      closingMl: "closing",
      reportedMl: "reported",
      deliveryMl: "delivery",
      returnMl: "returned",
      netMl: "net",
      dispatchMl: "dispatch",
    };
    const input = editor.current?.elements.namedItem(names[field]);
    if (!(input instanceof HTMLInputElement)) return;
    input.value = value.replace(".", ",");
    setOcrEvidence(previous => [
      ...previous.filter(p => p.field !== field),
      proof,
    ]);
    setDirty(true);
  }
  useEffect(() => {
    let active = true;
    setLoading(true);
    const q = new URLSearchParams({
      stationId,
      packageId,
      ...(shiftId === null ? {} : { shiftId }),
    });
    fetch("/api/stationos/daily-report/numeric?" + q, {
      credentials: "include",
      cache: "no-store",
    })
      .then(async r => {
        const d = await r.json();
        if (!r.ok) throw Error(d.error?.message || "Sayısal taslak okunamadı.");
        if (active) {
          setData(d);
          setError("");
          if (!dirty) {
            setRows(d.latest?.rows ?? []);
            setRevision(d.latest?.revision ?? 0);
          }
        }
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
  }, [stationId, packageId, shiftId, version, state, dirty]);
  const disabled = busy || loading || !data,
    edit = editing === null ? null : rows[editing],
    equipment = data?.equipment ?? [],
    comparison = numericComparison(rows, equipment, data?.accounts ?? []),
    conflict = dirty && data && revision !== (data.latest?.revision ?? 0);
  function add(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");
    const f = Object.fromEntries(new FormData(e.currentTarget)) as Record<
      string,
      string
    >;
    const ml = (name: string) =>
        f[name]?.trim() ? parseLitres(f[name]) : null,
      minor = (name: string) => (f[name]?.trim() ? parseMoney(f[name]) : null),
      count = (name: string) => {
        if (!f[name]?.trim()) return null;
        const value = Number(f[name]);
        if (!Number.isSafeInteger(value) || value < 0)
          throw Error("\u0130\u015flem adedi s\u0131f\u0131r veya pozitif tam say\u0131 olmal\u0131.");
        return value;
      };
    try {
      if (ocrEvidence.some(p => p.pageId !== f.pageId))
        throw Error(
          "OCR alanları farklı fotoğrafa ait. Kaynak fotoğrafına dönün veya OCR bağlantılarını açıkça temizleyin."
        );
      const base = {
        kind,
        pageId: f.pageId,
        label: f.label.trim(),
        ...(f.sourceLocation.trim() ? { sourceLocation: f.sourceLocation.trim() } : {}),
        ...(ocrEvidence.length ? { ocr: ocrEvidence } : {}),
      };
      let row: DailyNumericRow;
      if (kind === "STAFF_SALES")
        row = {
          ...base,
          kind,
          staffUserId: Number(f.staffUserId),
          fuelId: f.mapping || null,
          basis: f.basis as "UNDECIDED" | "METER" | "COMMERCIAL",
          transactionCount: count("transactionCount"),
          volumeMl: ml("volume"),
          amountMinor: minor("amount"),
        };
      else if (kind === "STAFF_TENDER")
        row = {
          ...base,
          kind,
          staffUserId: Number(f.staffUserId),
          category: f.category as (typeof tenderKinds)[number],
          transactionCount: count("transactionCount"),
          amountMinor: minor("amount"),
        };
      else if (kind === "SALES")
        row = {
          ...base,
          kind,
          fuelId: f.mapping || null,
          basis: f.basis as "UNDECIDED" | "METER" | "COMMERCIAL",
          volumeMl: ml("volume"),
          amountMinor: minor("amount"),
        };
      else if (kind === "METER")
        row = {
          ...base,
          kind,
          nozzleId: f.mapping || null,
          openingMl: ml("opening"),
          closingMl: ml("closing"),
          reportedMl: ml("reported"),
        };
      else if (kind === "TANK")
        row = {
          ...base,
          kind,
          tankId: f.mapping || null,
          openingMl: ml("opening"),
          closingMl: ml("closing"),
          deliveryMl: ml("delivery"),
          returnMl: ml("returned"),
        };
      else
        row = {
          ...base,
          kind,
          category: f.category as (typeof tenderKinds)[number],
          amountMinor: minor("amount"),
        };
      if (rows.length >= 100 && editing === null)
        throw Error("En fazla 100 satır ekleyebilirsiniz.");
      setRows(previous =>
        editing === null
          ? [...previous, row]
          : previous.map((r, i) => (i === editing ? row : r))
      );
      setDirty(true);
      setEditing(null);
      setOcrEvidence([]);
      setFormVersion(v => v + 1);
      onPage(row.pageId);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!data) return;
    const f = new FormData(e.currentTarget);
    setError("");
    if (
      await onAction("/daily-report/numeric", {
        stationId,
        packageId,
        shiftId: data.selectedShiftId,
        expectedRevision: revision,
        expectedSourceRevision: data.sourceRevision,
        expectedSnapshotHash: data.currentSnapshotHash,
        decision: f.get("numericDecision"),
        sourceConfirmed: f.get("numericSourceConfirmed") === "on",
        shiftConfirmed: f.get("numericShiftConfirmed") === "on",
        rows,
        note: f.get("numericNote"),
        evidence: f.get("numericEvidence"),
      })
    ) {
      setDirty(false);
      setVersion(v => v + 1);
      setEditing(null);
    }
  }
  const format = (value: number | null, unit: string) =>
    value === null
      ? "Bilinmiyor"
      : unit === "L"
        ? litres(value) + " L"
        : unit === "COUNT"
          ? String(value)
          : money(value);
  function sheets() {
    return [
      {
        name: "Sayısal taslak karşılaştırma",
        rows: [
          [
            "Kaynak satır",
            "Tür",
            "Karşılaştırma",
            "Kaynak",
            "Güncel icmal",
            "Fark (kaynak−icmal)",
            "Birim",
            "Kaynak fotoğraf",
          ],
          ...comparison.rows.flatMap(r =>
            r.cells.map(c => [
              r.staffUserId
                ? `${data?.staff.find(person => person.userId === r.staffUserId)?.name ?? `#${r.staffUserId}`} · ${r.label}`
                : r.label,
              numericLabels[r.kind],
              c.label,
              c.source === null
                ? null
                : c.source / (c.unit === "L" ? 1000 : c.unit === "TRY" ? 100 : 1),
              c.current === null
                ? null
                : c.current / (c.unit === "L" ? 1000 : c.unit === "TRY" ? 100 : 1),
              c.difference === null
                ? null
                : c.difference / (c.unit === "L" ? 1000 : c.unit === "TRY" ? 100 : 1),
              c.unit,
              pages.find(p => p.id === rows[r.index]?.pageId)?.name ?? "",
            ])
          ),
        ],
      },
    ];
  }
  const selectedPage = pages.find(p => p.id === pageId) ?? pages[0];
  const imagePage = selectedPage?.mime.startsWith("image/") || selectedPage?.mime === "application/pdf"
    ? selectedPage
    : pages.find(p => p.mime.startsWith("image/"));
  return (
    <Panel
      className="daily-numeric-panel"
      title="Fotoğraftan sayısal taslak ve icmal karşılaştırması"
      subtitle="Değerleri elle girin veya kaynak teyitli okuma önerisini kullanın. Boş alanlar bilinmiyor kalır. Bu taslak mevcut vardiyayı, stokları veya mali kayıtları değiştirmez."
    >
      <div className="business-form">
        {error && <Notice warning>{error}</Notice>}
        {data?.stale && (
          <Notice warning>
            Son kayıttan sonra kaynak incelemesi, vardiya veya icmal değişti.
            Geçmiş karşılaştırma korunuyor; aşağıda güncel karşılaştırma
            gösteriliyor.
          </Notice>
        )}
        {conflict && (
          <Notice warning>
            Başka bir inceleme kaydedildi. Yerel satırlarınız korunuyor.
            Kayıttan önce güncel taslağı yükleyin.
          </Notice>
        )}
        <Field label="Elle eşleştirilen uygulama vardiyası">
          <select
            name="numericShift"
            disabled={disabled}
            value={data?.selectedShiftId ?? ""}
            onChange={e => {
              setShiftId(e.target.value);
              setDirty(true);
            }}
          >
            <option value="">Eşleştirilmedi</option>
            {data?.shifts.map(s => (
              <option key={s.id} value={s.id}>
                {s.label} · {new Date(s.startsAt).toLocaleString("tr-TR")}
              </option>
            ))}
          </select>
        </Field>
        <p>
          Kaynak paket kararı: {data?.sourceDecision ?? "…"}. Kaynak revizyonu:{" "}
          {data?.sourceRevision ?? 0}. Karşılaştırma seçili vardiyanın kayıtlı
          akaryakıt hesaplarıyla yapılır.
        </p>
        <div className="daily-numeric-workspace">
          <aside>
            {imagePage && (
              <>
                <DailyOcrPanel
                  key={imagePage.id}
                  stationId={stationId}
                  packageId={packageId}
                  page={imagePage}
                  canParseShiftReport={["OWNER", "MANAGER", "ACCOUNTANT"].includes(state.member?.role ?? "")}
                  staffOptions={data?.staff ?? []}
                  kind={kind}
                  busy={disabled}
                  onAction={onAction}
                  onPick={pickOcr}
                  canApplyRow={editing === null}
                  onPickRow={pickOcrRow}
                  pdfPageCount={imagePage.mime === "application/pdf" ? pdfPageCount : 0}
                  onShiftReportDraft={onShiftReportDraft}
                />
              </>
            )}
          </aside>
          <form
            ref={editor}
            className="form-grid two"
            onSubmit={add}
            onChange={() => setDirty(true)}
            key={kind + ":" + editing + ":" + formVersion}
          >
            <Field label="Sayısal satır türü">
              <select
                name="numericKind"
                value={kind}
                onChange={e => {
                  setKind(e.target.value as typeof kind);
                  setEditing(null);
                  setOcrEvidence([]);
                }}
              >
                {numericKinds.map(k => (
                  <option key={k} value={k}>
                    {numericLabels[k]}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Kaynak fotoğraf">
              <select
                name="pageId"
                value={pageId}
                onChange={e => onPage(e.target.value)}
              >
                {pages.map(p => (
                  <option key={p.id} value={p.id}>
                    {p.position}. {p.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Kaynaktaki satır / tabanca / tank adı">
              <input
                name="label"
                required
                maxLength={190}
                defaultValue={edit?.label ?? ""}
              />
            </Field>
            <Field label="PDF sayfa veya XLSX sayfa!hücre/satır kaynağı">
              <input
                name="sourceLocation"
                maxLength={190}
                placeholder="Örn. Sayfa 2 · Vardiya 1!A12:H12"
                defaultValue={edit?.sourceLocation ?? ""}
              />
            </Field>
            {["SALES", "METER", "TANK"].includes(kind) && (
              <Field label="Açıkça seçilen mevcut eşleştirme">
                <select
                  name="mapping"
                  defaultValue={
                    edit
                      ? ((edit.kind === "SALES"
                          ? edit.fuelId
                          : edit.kind === "METER"
                            ? edit.nozzleId
                            : edit.kind === "TANK"
                              ? edit.tankId
                              : "") ?? "")
                      : ""
                  }
                >
                  <option value="">Eşleştirilmedi</option>
                  {equipment
                    .filter(
                      (e, i, all) =>
                        kind === "METER" ||
                        all.findIndex(a =>
                          kind === "SALES"
                            ? a.fuelId === e.fuelId
                            : a.tankId === e.tankId
                        ) === i
                    )
                    .map(e => (
                      <option
                        key={e.id}
                        value={
                          kind === "SALES"
                            ? e.fuelId
                            : kind === "TANK"
                              ? e.tankId
                              : e.id
                        }
                      >
                        {kind === "SALES"
                          ? e.fuel
                          : kind === "TANK"
                            ? e.tank + " / " + e.fuel
                            : e.pump + " / " + e.label + " / " + e.fuel}
                      </option>
                    ))}
                </select>
              </Field>
            )}
            {(kind === "STAFF_SALES" || kind === "STAFF_TENDER") && (
              <Field label="Rapor sat\u0131r\u0131ndaki do\u011frulanm\u0131\u015f personel">
                <select
                  name="staffUserId"
                  required
                  defaultValue={
                    edit?.kind === "STAFF_SALES" || edit?.kind === "STAFF_TENDER"
                      ? String(edit.staffUserId)
                      : ""
                  }
                >
                  <option value="">Personel se\u00e7in</option>
                  {data?.staff.map(person => (
                    <option key={person.userId} value={person.userId}>
                      {person.name}
                    </option>
                  ))}
                </select>
              </Field>
            )}
            {kind === "STAFF_SALES" && (
              <>
                <Field label="Personelin yak\u0131t e\u015fle\u015ftirmesi">
                  <select name="mapping" defaultValue={edit?.kind === "STAFF_SALES" ? edit.fuelId ?? "" : ""}>
                    <option value="">Yak\u0131t se\u00e7in</option>
                    {equipment.filter((e, i, all) => all.findIndex(a => a.fuelId === e.fuelId) === i).map(e => (
                      <option key={e.fuelId} value={e.fuelId}>{e.fuel}</option>
                    ))}
                  </select>
                </Field>
                <Field label="Personel sat\u0131\u015f esas\u0131">
                  <select name="basis" defaultValue={edit?.kind === "STAFF_SALES" ? edit.basis : "UNDECIDED"}>
                    <option value="UNDECIDED">Belirlenmedi</option>
                    <option value="METER">Saya\u00e7 sat\u0131\u015f\u0131</option>
                    <option value="COMMERCIAL">Ticari sat\u0131\u015f</option>
                  </select>
                </Field>
              </>
            )}
            {kind === "SALES" && (
              <>
                <Field label="Kaynak satış esası">
                  <select
                    name="basis"
                    defaultValue={
                      edit?.kind === "SALES" ? edit.basis : "UNDECIDED"
                    }
                  >
                    <option value="UNDECIDED">Belirlenmedi</option>
                    <option value="METER">Sayaç satışı (test dahil)</option>
                    <option value="COMMERCIAL">
                      Ticari satış (test hariç)
                    </option>
                  </select>
                </Field>
                <Field label="Kaynak satış litresi (L)">
                  <input
                    name="volume"
                    inputMode="decimal"
                    defaultValue={
                      edit?.kind === "SALES" ? input(edit.volumeMl) : ""
                    }
                  />
                </Field>
              </>
            )}
            {kind === "STAFF_SALES" && (
              <Field label="Kaynak personel sat\u0131\u015f litresi (L)">
                <input
                  name="volume"
                  inputMode="decimal"
                  defaultValue={edit?.kind === "STAFF_SALES" ? input(edit.volumeMl) : ""}
                />
              </Field>
            )}
            {(kind === "METER" || kind === "TANK") && (
              <>
                <Field label="Kaynak açılış (L)">
                  <input
                    name="opening"
                    inputMode="decimal"
                    defaultValue={
                      edit && (edit.kind === "METER" || edit.kind === "TANK")
                        ? input(edit.openingMl)
                        : ""
                    }
                  />
                </Field>
                <Field label="Kaynak kapanış (L)">
                  <input
                    name="closing"
                    inputMode="decimal"
                    defaultValue={
                      edit && (edit.kind === "METER" || edit.kind === "TANK")
                        ? input(edit.closingMl)
                        : ""
                    }
                  />
                </Field>
              </>
            )}
            {kind === "METER" && (
              <Field label="Kaynakta ayrıca yazılı satılan litre (varsa)">
                <input
                  name="reported"
                  inputMode="decimal"
                  defaultValue={
                    edit?.kind === "METER" ? input(edit.reportedMl) : ""
                  }
                />
              </Field>
            )}
            {kind === "TANK" && (
              <>
                <Field label="Tanker / diğer fiziksel giriş (L)">
                  <input
                    name="delivery"
                    inputMode="decimal"
                    defaultValue={
                      edit?.kind === "TANK" ? input(edit.deliveryMl) : ""
                    }
                  />
                </Field>
                <Field label="Fiziksel test dönüşü (L)">
                  <input
                    name="returned"
                    inputMode="decimal"
                    defaultValue={
                      edit?.kind === "TANK" ? input(edit.returnMl) : ""
                    }
                  />
                </Field>
              </>
            )}
            {(kind === "TENDER" || kind === "STAFF_TENDER") && (
              <Field label="Ayrı tahsilat / özel işlem sınıfı">
                <select
                  name="category"
                  defaultValue={
                    edit?.kind === "TENDER" || edit?.kind === "STAFF_TENDER" ? edit.category : "OTHER"
                  }
                >
                  {tenderKinds.map(k => (
                    <option key={k} value={k}>
                      {tenderLabels[k]}
                    </option>
                  ))}
                </select>
              </Field>
            )}
            {(kind === "SALES" || kind === "TENDER" || kind === "STAFF_SALES" || kind === "STAFF_TENDER") && (
              <Field label="Kaynak tutar (TL)">
                <input
                  name="amount"
                  inputMode="decimal"
                  defaultValue={
                    edit && (edit.kind === "SALES" || edit.kind === "TENDER" || edit.kind === "STAFF_SALES" || edit.kind === "STAFF_TENDER")
                      ? amountInput(edit.amountMinor)
                      : ""
                  }
                />
              </Field>
            )}
            {(kind === "STAFF_SALES" || kind === "STAFF_TENDER") && (
              <Field label="Kaynak i\u015flem adedi">
                <input
                  name="transactionCount"
                  type="number"
                  inputMode="numeric"
                  min="0"
                  step="1"
                  defaultValue={
                    edit?.kind === "STAFF_SALES" || edit?.kind === "STAFF_TENDER"
                      ? edit.transactionCount ?? ""
                      : ""
                  }
                />
              </Field>
            )}
            <button className="btn" disabled={disabled}>
              {editing === null
                ? "Sayısal satırı ekle"
                : "Satır düzenlemesini uygula"}
            </button>
            {editing !== null && (
              <button
                type="button"
                className="btn"
                disabled={disabled}
                onClick={() => {
                  setEditing(null);
                  setFormVersion(v => v + 1);
                  setOcrEvidence([]);
                }}
              >
                Yeni satır formuna geç
              </button>
            )}
            {!!ocrEvidence.length && (
              <div>
                <p>
                  OCR önerisi eklenen alanlar:{" "}
                  {ocrEvidence
                    .map(
                      p =>
                        ocrFieldLabels[p.field] +
                        ": " +
                        p.rawText +
                        " → " +
                        p.normalized
                    )
                    .join(" · ")}
                  . Elle değiştirdiğiniz değerler düzeltme olarak korunur.
                </p>
                <button
                  type="button"
                  className="btn"
                  onClick={() => {
                    setOcrEvidence([]);
                    setDirty(true);
                  }}
                >
                  OCR bağlantılarını temizle (elle giriş)
                </button>
              </div>
            )}
          </form>
        </div>
        {comparison.warnings.map(w => (
          <Notice key={w} warning>
            {w}
          </Notice>
        ))}
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Kaynak satır</th>
                <th>Alan</th>
                <th>Kaynak</th>
                <th>Güncel icmal</th>
                <th>Fark: kaynak−icmal</th>
                <th>İşlem</th>
              </tr>
            </thead>
            <tbody>
              {comparison.rows.flatMap(r =>
                r.cells.map((c, i) => (
                  <tr key={r.index + ":" + i}>
                    <td>
                      {r.staffUserId
                        ? `${data?.staff.find(person => person.userId === r.staffUserId)?.name ?? `#${r.staffUserId}`} · ${r.label}`
                        : r.label}
                      {rows[r.index]?.sourceLocation && (
                        <small style={{ display: "block" }}>Belge koordinatı: {rows[r.index].sourceLocation}</small>
                      )}
                      {i === 0 &&
                        rows[r.index]?.ocr?.map(p => (
                          <small style={{ display: "block" }} key={p.field}>
                            OCR {ocrFieldLabels[p.field]}: {p.rawText} →{" "}
                            {p.normalized}
                            {p.layout &&
                              " · Sütun: " +
                                p.layout.header +
                                " · Kaynak satır: " +
                                p.layout.rowLabel}
                            {p.corrected
                              ? " · Elle düzeltildi"
                              : " · Kaynak teyitli öneri"}
                          </small>
                        ))}
                      {r.warnings.map(w => (
                        <small style={{ display: "block" }} key={w}>
                          {w}
                        </small>
                      ))}
                    </td>
                    <td>{c.label}</td>
                    <td>{format(c.source, c.unit)}</td>
                    <td>{format(c.current, c.unit)}</td>
                    <td>{format(c.difference, c.unit)}</td>
                    <td>
                      {i === 0 && (
                        <>
                          <button
                            type="button"
                            className="btn"
                            disabled={disabled}
                            onClick={() => {
                              setEditing(r.index);
                              setOcrEvidence(rows[r.index].ocr ?? []);
                              setKind(rows[r.index].kind);
                              setFormVersion(v => v + 1);
                              onPage(rows[r.index].pageId);
                            }}
                          >
                            Düzenle
                          </button>
                          <button
                            type="button"
                            className="btn"
                            disabled={disabled}
                            onClick={() => {
                              setRows(previous =>
                                previous.filter((_, i) => i !== r.index)
                              );
                              setDirty(true);
                              setEditing(null);
                              setOcrEvidence([]);
                            }}
                          >
                            Taslak satırını çıkar
                          </button>
                        </>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        <button
          type="button"
          className="btn"
          disabled={disabled}
          onClick={() => {
            setDirty(false);
            setVersion(v => v + 1);
            setEditing(null);
            setFormVersion(v => v + 1);
            setResetVersion(v => v + 1);
            setOcrEvidence([]);
          }}
        >
          Güncel taslağı yükle (yerel düzenlemeyi bırak)
        </button>
        <form
          className="form-grid two"
          onSubmit={save}
          key={"proof-" + revision + ":" + resetVersion}
          onChange={() => setDirty(true)}
        >
          <Field label="Sayısal taslak kararı">
            <select name="numericDecision" defaultValue="PENDING">
              <option value="PENDING">Doğrulama bekliyor</option>
              <option value="VERIFIED_DRAFT">
                Sayısal kaynak doğrulandı (yalnız taslak)
              </option>
              <option value="REJECTED">Reddedildi</option>
            </select>
          </Field>
          <Field label="Sayısal inceleme açıklaması">
            <textarea
              name="numericNote"
              required
              maxLength={1000}
              defaultValue={data?.latest?.note ?? ""}
            />
          </Field>
          <Field label="Sayısal inceleme kanıtı">
            <input
              name="numericEvidence"
              required
              maxLength={500}
              defaultValue={data?.latest?.evidence ?? ""}
            />
          </Field>
          <label>
            <input type="checkbox" name="numericSourceConfirmed" /> Sayıları
            fotoğraflardan kontrol ettim.
          </label>
          <label>
            <input type="checkbox" name="numericShiftConfirmed" /> Kaynak raporu
            seçtiğim uygulama vardiyasıyla eşleştirdim.
          </label>
          <button
            className="btn primary"
            disabled={disabled || !!conflict || !rows.length}
          >
            Sayısal taslağı kaydet
          </button>
        </form>
        <p>
          Kaydedilmiş sayısal karar: {data?.latest?.decision ?? "Henüz yok"} ·
          Rev {data?.latest?.revision ?? 0}. Tahsilat sınıfları ve birleşik
          rapor satırları tekrar toplanmaz.
        </p>
        <button
          type="button"
          className="btn"
          disabled={!rows.length}
          onClick={() =>
            downloadSheets(sheets(), "istasyonos-gunluk-karsilastirma.xlsx")
          }
        >
          Karşılaştırma Excel
        </button>
        <button
          type="button"
          className="btn"
          disabled={!rows.length}
          onClick={() => {
            try {
              printSheets(sheets(), "İstasyonOS günlük sayısal karşılaştırma");
            } catch (e) {
              setError((e as Error).message);
            }
          }}
        >
          Karşılaştırma PDF / Yazdır
        </button>
        {data?.history.map(h => (
          <details key={h.revision}>
            <summary>
              Rev {h.revision} · {h.decision} · {h.reviewerName} ·{" "}
              {new Date(h.createdAt).toLocaleString("tr-TR")}
            </summary>
            <p>
              {h.note} · Kanıt: {h.evidence} · Kaynak rev {h.sourceRevision}
            </p>
            {h.rows.flatMap(
              (r, i) =>
                r.ocr?.map(p => (
                  <p key={i + ":" + p.field}>
                    {r.label} · OCR {ocrFieldLabels[p.field]}: {p.rawText} →{" "}
                    {p.normalized}
                    {p.corrected
                      ? " · Kaydederken elle düzeltildi"
                      : " · Kaynak teyitli öneri"}
                  </p>
                )) ?? []
            )}
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Kaydedildiği andaki satır</th>
                    <th>Alan</th>
                    <th>Kaynak</th>
                    <th>İcmal</th>
                    <th>Fark</th>
                  </tr>
                </thead>
                <tbody>
                  {h.savedComparison.rows.flatMap(r =>
                    r.cells.map((c, i) => (
                      <tr key={r.index + ":" + i}>
                        <td>
                          {r.label}
                          {h.rows[r.index]?.sourceLocation && (
                            <small style={{ display: "block" }}>Belge koordinatı: {h.rows[r.index].sourceLocation}</small>
                          )}
                        </td>
                        <td>{c.label}</td>
                        <td>{format(c.source, c.unit)}</td>
                        <td>{format(c.current, c.unit)}</td>
                        <td>{format(c.difference, c.unit)}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </details>
        ))}
      </div>
    </Panel>
  );
}

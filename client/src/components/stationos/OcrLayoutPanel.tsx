import { useMemo, useState } from "react";
import { suggestOcrLayout, layoutCellToken } from "@shared/daily-ocr-layout";
import {
  ocrFieldLabels,
  type OcrRun,
  type OcrBox,
  type OcrEvidence,
  type OcrField,
} from "@shared/daily-ocr";
import type { DailyNumericRow } from "@shared/daily-numeric";
import { Field, Notice } from "./Common";
export type OcrRowPick = { field: OcrField; value: string; proof: OcrEvidence };
export function OcrLayoutPanel({
  run,
  kind,
  busy,
  canApply,
  onHighlight,
  onApply,
}: {
  run: OcrRun;
  kind: DailyNumericRow["kind"];
  busy: boolean;
  canApply: boolean;
  onHighlight: (boxes: OcrBox[]) => void;
  onApply: (label: string, values: OcrRowPick[]) => void;
}) {
  const layout = useMemo(
      () => suggestOcrLayout(run.payload, kind),
      [run, kind]
    ),
    [tableId, setTableId] = useState(""),
    [rowId, setRowId] = useState(""),
    [choices, setChoices] = useState<Record<string, string>>({}),
    [confirmed, setConfirmed] = useState(false);
  const table = layout.tables.find(t => t.id === tableId) ?? layout.tables[0],
    row = table?.rows.find(r => r.id === rowId);
  const cells =
    row?.cells.map(c => {
      const token = layoutCellToken(run.payload, c),
        index = token?.choices.length === 1 ? "0" : (choices[c.field] ?? ""),
        choice = index === "" ? undefined : token?.choices[Number(index)],
        value =
          c.field === "amountMinor"
            ? choice?.minor
            : c.field === "transactionCount"
              ? choice?.count
              : choice?.ml;
      return { ...c, token, index, choice, value };
    }) ?? [];
  const unresolved = cells.some(
      c => c.token && c.token.choices.length > 1 && c.index === ""
    ),
    usable = cells.filter(c => c.choice && c.value != null),
    disabled =
      busy ||
      !canApply ||
      !confirmed ||
      !row ||
      row.blocked ||
      table?.blocked ||
      unresolved ||
      !usable.length;
  function focus(id: string) {
    setRowId(id);
    setChoices({});
    setConfirmed(false);
    const selected = table?.rows.find(r => r.id === id);
    if (!selected || !table) return;
    const wordIds = new Set([
      ...table.columns.flatMap(c => c.wordIds),
      ...selected.anchorWordIds,
    ]);
    onHighlight([
      ...(run.payload.words ?? [])
        .filter(w => wordIds.has(w.id))
        .map(w => w.box),
      ...selected.cells.flatMap(c =>
        run.payload.tokens
          .filter(t => c.tokenIds.includes(t.id))
          .map(t => t.box)
      ),
    ]);
  }
  function apply() {
    if (disabled || !table || !row) return;
    onApply(
      row.label,
      usable.map(c => ({
        field: c.field,
        value: c.choice!.normalized,
        proof: {
          runId: run.id,
          pageId: run.pageId,
          tokenId: c.token!.id,
          choiceIndex: Number(c.index),
          field: c.field,
          rawText: c.token!.raw,
          normalized: c.choice!.normalized,
          confirmed: true,
          layout: {
            version: 1,
            tableId: table.id,
            rowId: row.id,
            header: c.header,
            rowLabel: row.label,
          },
        },
      }))
    );
    setConfirmed(false);
  }
  return (
    <div className="ocr-layout-panel">
      <h3>Satır ve sütun önerileri</h3>
      {layout.warnings.map(w => (
        <Notice key={w} warning>
          {w}
        </Notice>
      ))}
      {!!layout.tables.length && (
        <>
          <Field label="Önerilen başlık grubu">
            <select
              name="ocrTable"
              value={table?.id ?? ""}
              onChange={e => {
                setTableId(e.target.value);
                setRowId("");
                setChoices({});
                setConfirmed(false);
                onHighlight([]);
              }}
            >
              {layout.tables.map(t => (
                <option value={t.id} key={t.id}>
                  {t.columns
                    .map(c => c.text + " → " + ocrFieldLabels[c.field])
                    .join(" · ")}
                </option>
              ))}
            </select>
          </Field>
          {table?.warnings.map(w => (
            <Notice key={w} warning>
              {w}
            </Notice>
          ))}
          <Field label="Kaynak satır önerisi">
            <select
              name="ocrRow"
              value={rowId}
              onChange={e => focus(e.target.value)}
            >
              <option value="">Kaynak satırı seçin</option>
              {table?.rows.map(r => (
                <option key={r.id} value={r.id}>
                  {r.label || "Etiket okunmadı"}
                  {r.blocked ? " · Kontrol gerekli" : ""}
                </option>
              ))}
            </select>
          </Field>
          {row && (
            <>
              {row.warnings.map(w => (
                <Notice key={w} warning>
                  {w}
                </Notice>
              ))}
              {cells.map(c => (
                <div key={c.field}>
                  <strong>
                    {c.header} → {ocrFieldLabels[c.field]}
                  </strong>
                  {c.warnings.map(w => (
                    <p key={w}>{w}</p>
                  ))}
                  {c.token && (
                    <>
                      <p>Kaynak: {c.token.raw}</p>
                      {c.token.choices.length > 1 && (
                        <Notice warning>
                          Sayı yorumu belirsiz; açık seçim gerekli.
                        </Notice>
                      )}
                      <select
                        aria-label={ocrFieldLabels[c.field] + " sayı yorumu"}
                        name={"layoutChoice-" + c.field}
                        value={c.index}
                        onChange={e => {
                          setChoices(previous => ({
                            ...previous,
                            [c.field]: e.target.value,
                          }));
                          setConfirmed(false);
                        }}
                      >
                        <option value="">Sayı yorumunu seçin</option>
                        {c.token.choices.map((v, i) => (
                          <option key={i} value={i}>
                            {v.normalized} · {v.interpretation}
                          </option>
                        ))}
                      </select>
                      {c.index !== "" && c.value == null && (
                        <p>
                          Bu alanın birim/hassasiyet sınırı uyuşmuyor; boş
                          kalacak.
                        </p>
                      )}
                    </>
                  )}
                </div>
              ))}
              {!canApply && (
                <Notice warning>
                  Önce mevcut satır düzenlemesini bitirin veya yeni satır
                  formuna geçin.
                </Notice>
              )}
              <label>
                <input
                  name="layoutConfirmed"
                  type="checkbox"
                  checked={confirmed}
                  onChange={e => setConfirmed(e.target.checked)}
                />{" "}
                İşaretli satırı, sütun başlıklarını ve sayı yorumlarını kontrol
                ettim. Açık formdaki sayılar ve eşleştirmeler bu öneriyle
                değiştirilecek; eksik alanlar boş kalacak.
              </label>
              <button
                type="button"
                className="btn"
                disabled={disabled}
                onClick={apply}
              >
                Satır önerisini forma al
              </button>
            </>
          )}
        </>
      )}
      <p>
        Tank, tabanca, yakıt ve tahsilat sınıfı otomatik eşleştirilmez. Satır
        ekleme ve taslak kaydı ayrıca yapılır.
      </p>
    </div>
  );
}

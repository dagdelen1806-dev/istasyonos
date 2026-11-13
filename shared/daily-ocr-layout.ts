import {
  ocrFields,
  ocrFieldLabels,
  type OcrField,
  type OcrBox,
  type OcrPayload,
  type OcrToken,
} from "./daily-ocr";
type Kind = keyof typeof ocrFields;
type Word = NonNullable<OcrPayload["words"]>[number];
export interface LayoutColumn {
  field: OcrField;
  text: string;
  wordIds: string[];
  box: OcrBox;
  left: number;
  right: number;
}
export interface LayoutCell {
  field: OcrField;
  header: string;
  tokenIds: string[];
  warnings: string[];
}
export interface LayoutRow {
  id: string;
  label: string;
  anchorWordIds: string[];
  cells: LayoutCell[];
  warnings: string[];
  blocked: boolean;
}
export interface LayoutTable {
  id: string;
  kind: Kind;
  columns: LayoutColumn[];
  rows: LayoutRow[];
  warnings: string[];
  blocked: boolean;
}
export interface OcrLayout {
  version: 1;
  tables: LayoutTable[];
  warnings: string[];
}
const normalize = (s: string) =>
  s
    .toLocaleLowerCase("tr-TR")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ı/g, "i")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
const aliases: Record<OcrField, string[]> = {
  transactionCount: [
    "islem adedi",
    "islem sayisi",
    "satis adedi",
    "islem adedi adet",
  ],
  netMl: ["net hacim l", "net hacim lt", "net hacim"],
  dispatchMl: ["sevk miktari l", "sevk miktari lt", "sevk miktari"],
  volumeMl: [
    "litre",
    "litre lt",
    "litre l",
    "satis litresi",
    "satilan litre",
    "satis miktari lt",
  ],
  amountMinor: [
    "tutar",
    "tutar tl",
    "tutar try",
    "satis tutari",
    "satis tutari tl",
    "tahsilat tl",
  ],
  openingMl: [
    "acilis",
    "acilis lt",
    "acilis l",
    "ilk endeks",
    "ilk sayac",
    "acilis sayaci",
    "onceki miktar lt",
    "onceki miktar l",
  ],
  closingMl: [
    "kapanis",
    "kapanis lt",
    "kapanis l",
    "son endeks",
    "son sayac",
    "kapanis sayaci",
    "son miktar lt",
    "son miktar l",
  ],
  reportedMl: ["satilan litre", "satilan lt", "fark litre", "satis litresi"],
  deliveryMl: [
    "dolum miktari lt",
    "dolum miktari l",
    "dolum lt",
    "giris lt",
    "tanker girisi lt",
  ],
  returnMl: ["test donusu lt", "test iadesi lt", "fiziksel test donusu lt"],
};
const middle = (w: Word) => w.box.y + w.box.height / 2;
const median = (values: number[]) => {
  const v = [...values].sort((a, b) => a - b);
  return v[Math.floor(v.length / 2)] ?? 12;
};
function box(words: Word[]): OcrBox {
  const x = Math.min(...words.map(w => w.box.x)),
    y = Math.min(...words.map(w => w.box.y));
  return {
    x,
    y,
    width: Math.max(...words.map(w => w.box.x + w.box.width)) - x,
    height: Math.max(...words.map(w => w.box.y + w.box.height)) - y,
  };
}
function bands(words: Word[]) {
  const result: { center: number; words: Word[] }[] = [];
  for (const w of [...words].sort(
    (a, b) => middle(a) - middle(b) || a.box.x - b.box.x
  )) {
    const last = result.at(-1),
      tolerance = Math.max(
        3,
        Math.min(
          w.box.height,
          median(last?.words.map(w => w.box.height) ?? [w.box.height])
        ) * 0.55
      );
    if (last && Math.abs(last.center - middle(w)) <= tolerance) {
      last.words.push(w);
      last.center = median(last.words.map(middle));
    } else result.push({ center: middle(w), words: [w] });
  }
  return result.map(r => ({
    ...r,
    words: r.words.sort((a, b) => a.box.x - b.box.x),
  }));
}
function groups(words: Word[]) {
  const result: Word[][] = [];
  for (const w of words) {
    const last = result.at(-1),
      previous = last?.at(-1),
      gap = previous
        ? w.box.x - (previous.box.x + previous.box.width)
        : Infinity;
    if (
      last &&
      gap <= Math.max(5, median([w.box.height, previous!.box.height]) * 1.25)
    )
      last.push(w);
    else result.push([w]);
  }
  return result;
}
export function suggestOcrLayout(payload: OcrPayload, kind: Kind): OcrLayout {
  const result: OcrLayout = { version: 1, tables: [], warnings: [] };
  if (!payload.words?.length) {
    result.warnings.push(
      "Bu okuma başlık konumlarını içermiyor; yeni yerel okumayı çalıştırın. Tek sayı seçimi açık."
    );
    return result;
  }
  if (payload.angle !== null && Math.abs(payload.angle) > 5) {
    result.warnings.push(
      "Görüntü eğimi satır/sütun önerisi için yüksek. Tek sayı seçimi veya elle giriş kullanın."
    );
    return result;
  }
  const rows = bands(payload.words),
    allowed = ocrFields[kind] as readonly OcrField[];
  const headings = rows.flatMap((r, index) => {
    const gs = groups(r.words),
      found = gs.flatMap((words, i) => {
        const text = words.map(w => w.text).join(" "),
          fields = allowed.filter(f => aliases[f].includes(normalize(text)));
        if (fields.length !== 1) return [];
        const b = box(words),
          previous = gs[i - 1],
          next = gs[i + 1],
          center = b.x + b.width / 2;
        const left = previous
          ? (box(previous).x + box(previous).width / 2 + center) / 2
          : Math.max(0, b.x - Math.max(b.width, payload.width * 0.06));
        const right = next
          ? (box(next).x + box(next).width / 2 + center) / 2
          : Math.min(
              payload.width,
              b.x + b.width + Math.max(b.width, payload.width * 0.06)
            );
        return [
          {
            field: fields[0],
            text,
            wordIds: words.map(w => w.id),
            box: b,
            left,
            right,
          },
        ];
      });
    return found.length ? [{ row: index, columns: found }] : [];
  });
  if (headings.length > 20) {
    result.warnings.push(
      "20 başlık grubu sınırı aşıldı; satır önerileri durduruldu."
    );
    return result;
  }
  const tokenMap = new Map(payload.tokens.map(t => [t.id, t]));
  for (const [headingIndex, h] of headings.entries()) {
    const warnings: string[] = [],
      fields = h.columns.map(c => c.field),
      duplicate = new Set(fields).size !== fields.length;
    if (duplicate)
      warnings.push(
        "Aynı alana birden fazla sütun başlığı uyuyor. Tablo otomatik aktarılamaz."
      );
    for (const field of allowed)
      if (!fields.includes(field))
        warnings.push(
          ocrFieldLabels[field] + " sütunu tanınmadı; alan boş kalacak."
        );
    const table: LayoutTable = {
      id: kind + ":" + h.columns[0].wordIds[0],
      kind,
      columns: h.columns,
      rows: [],
      warnings,
      blocked: duplicate,
    };
    const end = headings[headingIndex + 1]?.row ?? rows.length;
    // A blank region marks a section boundary; never join unrelated sections.
    let previousY = rows[h.row].center;
    for (let index = h.row + 1; index < end; index++) {
      const r = rows[index],
        height = median(r.words.map(w => w.box.height));
      if (r.center - previousY > Math.max(height * 5, payload.height * 0.04))
        break;
      previousY = r.center;
      const cells = h.columns.map(column => {
        const tokens = r.words.flatMap(w => {
          const t = tokenMap.get(w.id);
          if (!t) return [];
          const x = t.box.x + t.box.width / 2;
          return x > column.left && x < column.right ? [t] : [];
        });
        const warnings =
          tokens.length > 1
            ? [
                "Hücrede birden fazla sayı var; sütun/satır ilişkisi kesin değil.",
              ]
            : tokens.length === 0
              ? ["Hücre okunmadı; boş kalacak."]
              : [];
        return {
          field: column.field,
          header: column.text,
          tokenIds: tokens.map(t => t.id),
          warnings,
        };
      });
      if (!cells.some(c => c.tokenIds.length)) continue;
      const left = Math.min(...h.columns.map(c => c.left)),
        anchors = r.words.filter(w => w.box.x + w.box.width <= left),
        label = anchors
          .map(w => w.text)
          .join(" ")
          .trim();
      const rowWarnings: string[] = [],
        normalized = normalize(label);
      if (!label)
        rowWarnings.push(
          "Kaynak satır etiketi okunmadı; satır ilişkisi doğrulanmalı."
        );
      if (label.length > 190)
        rowWarnings.push("Satır etiketi uzun; elle düzenleme gerekli.");
      if (/\btoplam\b|\btotal\b/.test(normalized))
        rowWarnings.push(
          "Toplam satırı ayrı kalır; ayrıntı satırlarıyla birlikte aktarılmaz."
        );
      const closeToPrevious =
        index > h.row + 1 && r.center - rows[index - 1].center < height * 0.9;
      if (closeToPrevious)
        rowWarnings.push(
          "Satırlar birbirine çok yakın; satır eşleşmesi belirsiz."
        );
      const blocked =
        duplicate ||
        !label ||
        label.length > 190 ||
        /\btoplam\b|\btotal\b/.test(normalized) ||
        closeToPrevious ||
        cells.some(c => c.tokenIds.length > 1);
      table.rows.push({
        id: table.id + ":" + r.words[0].id,
        label,
        anchorWordIds: anchors.map(w => w.id),
        cells,
        warnings: rowWarnings,
        blocked,
      });
    }
    if (table.rows.length > 100) {
      table.rows = [];
      table.blocked = true;
      table.warnings.push("100 satır sınırı aşıldı; tablo önerisi durduruldu.");
    }
    if (!table.rows.length)
      table.warnings.push(
        "Bu başlıklara bağlı güvenli veri satırı bulunamadı."
      );
    result.tables.push(table);
  }
  if (!result.tables.length)
    result.warnings.push(
      "Başlıklar kesin eşleşmedi. Tek sayı seçimi ve elle giriş kullanılabilir."
    );
  return result;
}
export function layoutCellToken(
  payload: OcrPayload,
  cell: LayoutCell
): OcrToken | undefined {
  return cell.tokenIds.length === 1
    ? payload.tokens.find(t => t.id === cell.tokenIds[0])
    : undefined;
}

import type { IcmalAccount } from "@shared/icmal";
import { specialLabels } from "@shared/icmal";
import { formatTurkeyInstant } from "@shared/datetime";
type Cell = string | number | null;
export function icmalSheets(
  accounts: IcmalAccount[],
  station: string,
  filter: string
) {
  const summary: Cell[][] = [
    ["İstasyonOS — operasyonel vardiya icmali"],
    ["İstasyon", station],
    ["Filtre", filter],
    [
      "Gerçek mali defter / banka teyidi değildir. Taslaklar toplamlara katılmaz.",
    ],
    [
      "Vardiya",
      "Personel",
      "Başlangıç (Türkiye)",
      "Durum",
      "Sayaç L",
      "Sayaç TL",
      "Test L",
      "Ticari L",
      "Ticari TL",
      "Nakit satış TL",
      "Kart TL",
      "IBAN beyan TL",
      "Cari satış TL",
      "Özel karşılık TL",
      "Eski cari tahsilatı TL",
      "Gift yükleme TL",
      "Gift kullanım TL",
      "TTS TL",
      "Partner TL",
      "TTS+Gift kullanım TL (Excel)",
      "Litre farkı L",
      "Tutar farkı TL",
      "Taslak adedi",
      "Bekleyen özel adedi",
      "Fiziki nakit sayım farkı TL",
      "Cari satış defteri TL",
      "Cari defter - satış farkı TL",
      "Operasyonel sağlayıcı alacağı TL",
      "Ön ödeme kullanım karşılığı TL",
    ],
  ];
  const operations: Cell[][] = [
    [
      "Vardiya",
      "Personel",
      "Kategori",
      "Model",
      "Durum",
      "Kaynak",
      "Sağlayıcı",
      "Referans",
      "Plaka",
      "Müşteri",
      "Maskeli cüzdan",
      "Tutar TL",
      "Litre",
      "Belge L",
      "Hesaplaşma",
      "Hesaplaşma yöntemi",
      "Bağlı ödeme",
      "Bağlı slip",
      "Açıklama",
      "Kanıt",
    ],
  ];
  const tanks: Cell[][] = [
    [
      "Vardiya",
      "Personel",
      "Tank",
      "İlk L",
      "Son L",
      "Sayaç çıkışı L",
      "Tanker giriş L",
      "Test dönüş L",
      "Beklenen son L",
      "Fark L",
    ],
  ];
  const readings: Cell[][] = [
    [
      "Vardiya",
      "Personel",
      "Tabanca kimliği",
      "Sıra",
      "Tür",
      "Sayaç L",
      "Fiyat TL/L",
      "Okuma (UTC)",
    ],
  ];
  for (const a of accounts) {
    const f = a.fuel,
      i = f?.icmal;
    summary.push([
      a.shiftLabel,
      a.userName,
      formatTurkeyInstant(a.startsAt),
      a.status,
      f ? f.soldMl / 1000 : null,
      f ? f.meterExpectedMinor / 100 : null,
      i ? i.testMl / 1000 : 0,
      f ? (i?.commercialMl ?? f.soldMl) / 1000 : null,
      f ? f.expectedMinor / 100 : null,
      a.cashMinor / 100,
      a.cardMinor / 100,
      a.ibanMinor / 100,
      a.debtMinor / 100,
      a.specialCoveredMinor / 100,
      a.arCollectionMinor / 100,
      (i?.giftLoadMinor ?? 0) / 100,
      (i?.giftUseMinor ?? 0) / 100,
      (i?.ttsMinor ?? 0) / 100,
      (i?.partnerMinor ?? 0) / 100,
      (i?.excelTtsGiftMinor ?? 0) / 100,
      f?.litreDifferenceMl == null ? null : f.litreDifferenceMl / 1000,
      f ? f.amountDifferenceMinor / 100 : null,
      i?.draftCount ?? 0,
      i?.pendingCount ?? 0,
      a.cashDifferenceMinor === null ? null : a.cashDifferenceMinor / 100,
      a.receivableLedgerMinor / 100,
      a.receivableDifferenceMinor / 100,
      a.providerReceivableMinor / 100,
      a.giftAppliedMinor / 100,
    ]);
    for (const o of i?.operations ?? [])
      operations.push([
        a.shiftLabel,
        a.userName,
        specialLabels[o.kind],
        o.model,
        o.status,
        o.source,
        o.provider,
        o.reference,
        o.plate,
        o.customer,
        o.instrument,
        o.amountMinor / 100,
        o.volumeMl / 1000,
        o.documentMl === null ? null : o.documentMl / 1000,
        o.settlement,
        o.settlementMethod,
        o.paymentId,
        o.slipId,
        o.note,
        o.evidence,
      ]);
    for (const t of i?.tanks ?? [])
      tanks.push([
        a.shiftLabel,
        a.userName,
        t.label,
        t.openingMl === null ? null : t.openingMl / 1000,
        t.closingMl === null ? null : t.closingMl / 1000,
        t.meterOutMl / 1000,
        t.deliveryMl / 1000,
        t.returnMl / 1000,
        t.expectedClosingMl === null ? null : t.expectedClosingMl / 1000,
        t.differenceMl === null ? null : t.differenceMl / 1000,
      ]);
    for (const r of f?.readings ?? [])
      readings.push([
        a.shiftLabel,
        a.userName,
        r.nozzleId,
        r.sequenceNo,
        r.kind,
        r.meterMl / 1000,
        r.priceMinor / 100,
        r.readingAt,
      ]);
  }
  return [
    { name: "Vardiya icmali", rows: summary },
    { name: "Özel işlemler", rows: operations },
    { name: "Tank hareketleri", rows: tanks },
    { name: "Sayaç okumaları", rows: readings },
  ];
}
export const xmlEscape = (value: string) =>
  value
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
const encoder = new TextEncoder();
function crc32(bytes: Uint8Array) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let k = 0; k < 8; k++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
// Minimal OOXML ZIP with stored entries. Inline strings never become formulas,
// even when a supplier/reference starts with =, +, -, or @.
export function xlsxBytes(sheets: { name: string; rows: Cell[][] }[]) {
  const files: { name: string; text: string }[] = [
    {
      name: "[Content_Types].xml",
      text: `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("")}</Types>`,
    },
    {
      name: "_rels/.rels",
      text: '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
    },
    {
      name: "xl/workbook.xml",
      text: `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets.map((s, i) => `<sheet name="${xmlEscape(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("")}</sheets></workbook>`,
    },
    {
      name: "xl/_rels/workbook.xml.rels",
      text: `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join("")}</Relationships>`,
    },
    ...sheets.map((s, index) => ({
      name: `xl/worksheets/sheet${index + 1}.xml`,
      text: `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${s.rows
        .map(
          (row, r) =>
            `<row r="${r + 1}">${row
              .map((value, c) => {
                let n = c + 1,
                  col = "";
                while (n) {
                  n--;
                  col = String.fromCharCode(65 + (n % 26)) + col;
                  n = Math.floor(n / 26);
                }
                const ref = col + (r + 1);
                return typeof value === "number"
                  ? `<c r="${ref}"><v>${Number.isFinite(value) ? value : 0}</v></c>`
                  : `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${xmlEscape(value ?? "—")}</t></is></c>`;
              })
              .join("")}</row>`
        )
        .join("")}</sheetData></worksheet>`,
    })),
  ];
  return zipSourceBytes(
    files.map(file => ({
      name: file.name,
      data: encoder.encode(
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' + file.text
      ),
    }))
  );
}
/** Stored ZIP shared by spreadsheet exports and private document image upload. */
export function zipSourceBytes(files: { name: string; data: Uint8Array }[]) {
  const chunks: Uint8Array[] = [],
    central: Uint8Array[] = [];
  let offset = 0;
  const header = (size: number) => {
    const b = new Uint8Array(size);
    return { b, v: new DataView(b.buffer) };
  };
  for (const file of files) {
    const name = encoder.encode(file.name),
      data = file.data,
      crc = crc32(data);
    const { b, v } = header(30);
    v.setUint32(0, 0x04034b50, true);
    v.setUint16(4, 20, true);
    v.setUint16(6, 0x800, true);
    v.setUint32(14, crc, true);
    v.setUint32(18, data.length, true);
    v.setUint32(22, data.length, true);
    v.setUint16(26, name.length, true);
    chunks.push(b, name, data);
    const h = header(46);
    h.v.setUint32(0, 0x02014b50, true);
    h.v.setUint16(4, 20, true);
    h.v.setUint16(6, 20, true);
    h.v.setUint16(8, 0x800, true);
    h.v.setUint32(16, crc, true);
    h.v.setUint32(20, data.length, true);
    h.v.setUint32(24, data.length, true);
    h.v.setUint16(28, name.length, true);
    h.v.setUint32(42, offset, true);
    central.push(h.b, name);
    offset += b.length + name.length + data.length;
  }
  const centralSize = central.reduce((n, b) => n + b.length, 0),
    end = header(22);
  end.v.setUint32(0, 0x06054b50, true);
  end.v.setUint16(8, files.length, true);
  end.v.setUint16(10, files.length, true);
  end.v.setUint32(12, centralSize, true);
  end.v.setUint32(16, offset, true);
  const all = [...chunks, ...central, end.b],
    result = new Uint8Array(offset + centralSize + 22);
  let pos = 0;
  for (const b of all) {
    result.set(b, pos);
    pos += b.length;
  }
  return result;
}
export function downloadIcmal(
  accounts: IcmalAccount[],
  station: string,
  filter: string
) {
  downloadSheets(
    icmalSheets(accounts, station, filter),
    "istasyonos-vardiya-icmali.xlsx"
  );
}
export function downloadSheets(
  sheets: Parameters<typeof xlsxBytes>[0],
  filename: string
) {
  const bytes = xlsxBytes(sheets);
  const url = URL.createObjectURL(
    new Blob([bytes as BlobPart], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    })
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function printIcmal(
  accounts: IcmalAccount[],
  station: string,
  filter: string
) {
  printSheets(
    icmalSheets(accounts, station, filter),
    "İstasyonOS vardiya icmali"
  );
}
export function printSheets(
  sheets: Parameters<typeof xlsxBytes>[0],
  title: string
) {
  const popup = window.open("", "_blank");
  if (!popup) throw Error("PDF için tarayıcı açılır pencere izni gerekli.");
  popup.opener = null;
  popup.document.write(
    `<!doctype html><html lang="tr"><head><meta charset="UTF-8"><title>${xmlEscape(title)}</title><style>@page{size:A3 landscape;margin:10mm}body{font:10px Arial,sans-serif;color:#111}table{border-collapse:collapse;width:100%;margin-bottom:20px}td,th{border:1px solid #bbb;padding:4px;overflow-wrap:anywhere}thead{display:table-header-group}h2{break-before:page}h2:first-of-type{break-before:auto}tr{break-inside:avoid}@media print{button{display:none}}</style></head><body><button onclick="window.print()">PDF olarak kaydet / Yazdır</button><p>Operasyonel DEMO raporudur; banka veya gerçek mali defter teyidi değildir.</p>${sheets.map(s => `<h2>${xmlEscape(s.name)}</h2><table>${s.rows.map(row => `<tr>${row.map(c => `<td>${xmlEscape(c === null ? "—" : typeof c === "number" ? c.toLocaleString("tr-TR", { maximumFractionDigits: 3 }) : c)}</td>`).join("")}</tr>`).join("")}</table>`).join("")}</body></html>`
  );
  popup.document.close();
  popup.focus();
  setTimeout(() => popup.print(), 250);
}

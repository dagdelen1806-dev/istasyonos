import { parentPort, workerData } from "node:worker_threads";
import { inflateRawSync } from "node:zlib";
import { createHash } from "node:crypto";
import { dirname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import ExcelJS from "exceljs";
import { getDocument, OPS } from "pdfjs-dist/legacy/build/pdf.mjs";

const LIMIT = {
  input: 12 * 1024 * 1024,
  zipEntries: 1000,
  zipExpanded: 48 * 1024 * 1024,
  zipEntryExpanded: 8 * 1024 * 1024,
  ratio: 80,
  sheets: 30,
  rows: 5000,
  columns: 100,
  cells: 50000,
  text: 800000,
  output: 3 * 1024 * 1024,
  pdfPages: 100,
  pdfPageItems: 10000,
  mergedRanges: 5000,
};
const digest = bytes => createHash("sha256").update(bytes).digest("hex");
const stop = message => {
  throw new Error(message);
};
const crcTable = Uint32Array.from({ length: 256 }, (_, value) => {
  let crc = value;
  for (let bit = 0; bit < 8; bit++)
    crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  return crc >>> 0;
});
function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function preflightXlsx(bytes) {
  if (bytes.length < 22 || bytes.length > LIMIT.input) stop("XLSX_INPUT_LIMIT");
  let end = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
    if (
      bytes.readUInt32LE(i) === 0x06054b50 &&
      i + 22 + bytes.readUInt16LE(i + 20) === bytes.length
    ) {
      end = i;
      break;
    }
  }
  if (end < 0) stop("XLSX_ZIP_INVALID");
  const disk = bytes.readUInt16LE(end + 4),
    centralDisk = bytes.readUInt16LE(end + 6),
    diskCount = bytes.readUInt16LE(end + 8),
    count = bytes.readUInt16LE(end + 10),
    centralSize = bytes.readUInt32LE(end + 12),
    centralOffset = bytes.readUInt32LE(end + 16);
  if (
    disk ||
    centralDisk ||
    diskCount !== count ||
    !count ||
    count > LIMIT.zipEntries ||
    count === 0xffff ||
    centralSize === 0xffffffff ||
    centralOffset === 0xffffffff ||
    centralOffset + centralSize !== end
  )
    stop("XLSX_ZIP_LIMIT");
  const names = new Set(),
    ranges = [],
    entries = [];
  let at = centralOffset,
    expandedTotal = 0;
  for (let i = 0; i < count; i++) {
    if (at + 46 > end || bytes.readUInt32LE(at) !== 0x02014b50)
      stop("XLSX_ZIP_INVALID");
    const flags = bytes.readUInt16LE(at + 8),
      method = bytes.readUInt16LE(at + 10),
      crc = bytes.readUInt32LE(at + 16),
      compressed = bytes.readUInt32LE(at + 20),
      expanded = bytes.readUInt32LE(at + 24),
      nameLen = bytes.readUInt16LE(at + 28),
      extraLen = bytes.readUInt16LE(at + 30),
      commentLen = bytes.readUInt16LE(at + 32),
      diskStart = bytes.readUInt16LE(at + 34),
      offset = bytes.readUInt32LE(at + 42);
    if (
      at + 46 + nameLen + extraLen + commentLen > end ||
      !nameLen ||
      nameLen > 512 ||
      diskStart ||
      flags & ~0x808 ||
      flags & 1 ||
      ![0, 8].includes(method) ||
      expanded === 0xffffffff ||
      compressed === 0xffffffff ||
      offset === 0xffffffff ||
      expanded > LIMIT.zipEntryExpanded ||
      expandedTotal + expanded > LIMIT.zipExpanded ||
      expanded > Math.max(1024, compressed * LIMIT.ratio)
    )
      stop("XLSX_ZIP_LIMIT");
    let name;
    try {
      name = new TextDecoder("utf-8", { fatal: true }).decode(
        bytes.subarray(at + 46, at + 46 + nameLen)
      );
    } catch {
      stop("XLSX_ZIP_NAME_INVALID");
    }
    const key = name.toLowerCase();
    if (
      !name ||
      name.includes("\\") ||
      name.startsWith("/") ||
      name.split("/").some(p => p === ".." || p === ".") ||
      names.has(key)
    )
      stop("XLSX_ZIP_NAME_INVALID");
    names.add(key);
    if (
      offset + 30 > centralOffset ||
      bytes.readUInt32LE(offset) !== 0x04034b50
    )
      stop("XLSX_ZIP_INVALID");
    const localNameLen = bytes.readUInt16LE(offset + 26),
      localExtraLen = bytes.readUInt16LE(offset + 28),
      dataStart = offset + 30 + localNameLen + localExtraLen,
      dataEnd = dataStart + compressed;
    if (
      dataEnd > centralOffset ||
      dataEnd < dataStart ||
      bytes.readUInt16LE(offset + 6) !== flags ||
      bytes.readUInt16LE(offset + 8) !== method ||
      localNameLen !== nameLen ||
      !bytes
        .subarray(offset + 30, offset + 30 + localNameLen)
        .equals(bytes.subarray(at + 46, at + 46 + nameLen)) ||
      ranges.some(range => offset < range.end && dataEnd > range.start)
    )
      stop("XLSX_ZIP_INVALID");
    ranges.push({ start: offset, end: dataEnd });
    if (
      !(flags & 8) &&
      (bytes.readUInt32LE(offset + 14) !== crc ||
        bytes.readUInt32LE(offset + 18) !== compressed ||
        bytes.readUInt32LE(offset + 22) !== expanded)
    )
      stop("XLSX_ZIP_INVALID");
    let content;
    try {
      const compressedBytes = bytes.subarray(dataStart, dataEnd);
      content =
        method === 0
          ? Buffer.from(compressedBytes)
          : inflateRawSync(compressedBytes, {
              maxOutputLength: LIMIT.zipEntryExpanded,
            });
    } catch {
      stop("XLSX_ZIP_EXPANSION_REJECTED");
    }
    if (
      content.length !== expanded ||
      content.length > Math.max(1024, compressed * LIMIT.ratio) ||
      crc32(content) !== crc
    )
      stop("XLSX_ZIP_EXPANSION_REJECTED");
    expandedTotal += expanded;
    entries.push({ name, bytes: content });
    at += 46 + nameLen + extraLen + commentLen;
  }
  if (
    at !== end ||
    !names.has("[content_types].xml") ||
    !names.has("xl/workbook.xml")
  )
    stop("XLSX_STRUCTURE_INVALID");
  if (
    entries.some(
      e =>
        /(?:^|\/)(?:vbaProject\.bin|connections\.xml)$/i.test(e.name) ||
        /(?:^|\/)(?:externalLinks?|queryTables|activeX|embeddings|webExtensions|customXml)\//i.test(
          e.name
        )
    )
  )
    stop("XLSX_EXTERNAL_CONTENT_REJECTED");
  const xml = entries.filter(e => /\.(xml|rels)$/i.test(e.name));
  if (
    xml.some(e =>
      /<!DOCTYPE|<!ENTITY|<externalReferences\b|<externalLink\b|TargetMode\s*=\s*["']External/i.test(
        e.bytes.toString("utf8")
      )
    )
  )
    stop("XLSX_EXTERNAL_CONTENT_REJECTED");
  return { expandedTotal, entryCount: count };
}

function normalizeHeader(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("tr-TR")
    .replace(/\u0131/g, "i")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}
const aliases = {
  staff: [
    "osse",
    "pompaci",
    "personel",
    "satis elemani",
    "ad soyad",
    "calisan",
  ],
  shift: ["vardiya", "vardiya no", "vardiya numarasi"],
  date: ["tarih", "islem tarihi", "rapor tarihi", "vardiya tarihi"],
  count: [
    "islem adedi",
    "islem sayisi",
    "satis adedi",
    "satis sayisi",
    "fis adedi",
  ],
  litres: ["litre", "litre satisi", "satis litresi", "hacim litre"],
  amount: ["tutar", "satis tutari", "toplam tutar", "ciro", "toplam tl"],
  tts: [
    "tts",
    "tts tutari",
    "tts satis",
    "tasit tanima",
    "tasit tanima sistemi",
  ],
  special: [
    "ozel islem",
    "ozel islem tutari",
    "gift kart",
    "partner kart",
    "test yakiti",
    "diger islem",
  ],
};
function fieldForHeader(header) {
  const normalized = normalizeHeader(header);
  return (
    Object.entries(aliases).find(([, values]) =>
      values.includes(normalized)
    )?.[0] ?? null
  );
}
function redact(text) {
  return String(text ?? "")
    .replace(/\bTR\d{2}(?:\s?\d){22}\b/gi, "[IBAN HIDDEN]")
    .replace(/\b(?:\d[ -]?){13,19}\b/g, "[CARD OR LONG NUMBER HIDDEN]")
    .replace(/\b(CVV|CVC|SECURITY CODE)\s*[:#-]?\s*\d{3,4}\b/gi, "$1 [HIDDEN]")
    .slice(0, 1000);
}
function scalar(cell) {
  const value = cell.value;
  if (value instanceof Date)
    return {
      type: "date",
      value: value.toISOString(),
      display: redact(cell.text),
      numFmt: cell.numFmt,
    };
  if (value && typeof value === "object") {
    if ("formula" in value || "sharedFormula" in value) {
      const cached = value.result;
      const safeCached =
        typeof cached === "string"
          ? redact(cached)
          : typeof cached === "number" &&
              Number.isSafeInteger(cached) &&
              Math.abs(cached) >= 1_000_000_000_000
            ? null
            : typeof cached === "number"
              ? cached
              : null;
      return {
        type: "formula",
        value: null,
        cachedResult: safeCached,
        display: redact(cell.text),
        numFmt: cell.numFmt,
        requiresConfirmation: true,
      };
    }
    if ("text" in value && typeof value.text === "string")
      return {
        type: "text",
        value: redact(value.text),
        display: redact(value.text),
        numFmt: cell.numFmt,
      };
    return {
      type: "unsupported",
      value: null,
      display: "",
      numFmt: cell.numFmt,
    };
  }
  if (typeof value === "string")
    return {
      type: "text",
      value: redact(value),
      display: redact(cell.text),
      numFmt: cell.numFmt,
    };
  if (typeof value === "number" && Number.isFinite(value)) {
    if (Number.isSafeInteger(value) && Math.abs(value) >= 1_000_000_000_000)
      return {
        type: "redacted",
        value: null,
        display: "[CARD OR LONG NUMBER HIDDEN]",
        numFmt: cell.numFmt,
      };
    return {
      type: "number",
      value,
      display: redact(cell.text),
      numFmt: cell.numFmt,
    };
  }
  if (typeof value === "boolean")
    return {
      type: "boolean",
      value,
      display: String(value),
      numFmt: cell.numFmt,
    };
  return { type: "blank", value: null, display: "", numFmt: cell.numFmt };
}
function decimalUnits(value, scale) {
  if (typeof value === "number") {
    if (!Number.isFinite(value) || value < 0) return null;
    const scaled = Math.round(value * scale);
    return Number.isSafeInteger(scaled) ? scaled : null;
  }
  if (typeof value !== "string") return null;
  let text = value
    .trim()
    .replace(/[\s\u20BA]/g, "")
    .replace(/TL/gi, "");
  if (!text || !/^\d[\d.,]*$/.test(text)) return null;
  if (text.includes(",")) text = text.replace(/\./g, "").replace(",", ".");
  const match = /^(\d+)(?:\.(\d{1,3}))?$/.exec(text);
  if (!match) return null;
  const places = scale === 100 ? 2 : 3;
  if ((match[2]?.length ?? 0) > places) return null;
  const fraction = (match[2] ?? "").padEnd(places, "0");
  const result = Number(match[1]) * scale + Number(fraction || 0);
  return Number.isSafeInteger(result) ? result : null;
}
function candidateValue(field, cell) {
  if (!cell) return null;
  const value = cell.type === "formula" ? cell.cachedResult : cell.value;
  if (value === null || value === undefined) return null;
  let proposed = null;
  if (["amount", "tts", "special"].includes(field))
    proposed = decimalUnits(value, 100);
  else if (field === "litres") proposed = decimalUnits(value, 1000);
  else if (field === "count")
    proposed =
      typeof value === "number" && Number.isSafeInteger(value) && value >= 0
        ? value
        : typeof value === "string" && /^\d{1,7}$/.test(value.trim())
          ? Number(value.trim())
          : null;
  else if (field === "date")
    proposed = cell.type === "date" ? value : normalizedCalendarDate(value);
  else proposed = typeof value === "number" ? value : redact(String(value));
  return {
    address: cell.address,
    cellType: cell.type,
    rawValue: typeof value === "string" ? redact(value) : value,
    display: cell.display,
    numFmt: cell.numFmt,
    proposedValue: proposed,
    requiresConfirmation: true,
    formulaCache: cell.type === "formula",
  };
}
function normalizedCalendarDate(value) {
  if (typeof value !== "string") return null;
  const text = value.trim();
  const turkish = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(text);
  const iso = turkish ? `${turkish[3]}-${turkish[2]}-${turkish[1]}` : text;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;
  const date = new Date(`${iso}T00:00:00.000Z`);
  return Number.isFinite(date.valueOf()) &&
    date.toISOString().slice(0, 10) === iso
    ? iso
    : null;
}
function parseLabeledValue(field, raw) {
  const text = raw
    .trim()
    .replace(/[\s\u20BA]/g, "")
    .replace(/TL/gi, "");
  if (["amount", "tts", "special"].includes(field)) {
    const value = decimalUnits(text, 100);
    return value;
  }
  if (field === "litres") return decimalUnits(text, 1000);
  if (field === "count") return /^\d{1,7}$/.test(text) ? Number(text) : null;
  if (field === "date") {
    const tr = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(text);
    const iso = tr ? `${tr[3]}-${tr[2]}-${tr[1]}` : text;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;
    const date = new Date(`${iso}T00:00:00Z`);
    return date.toISOString().slice(0, 10) === iso ? iso : null;
  }
  return redact(raw.trim());
}
function pdfFieldCandidates(pageNumber, items) {
  const sorted = [...items]
    .map((item, index) => ({ ...item, itemIndex: index }))
    .sort((a, b) => b.y - a.y || a.x - b.x);
  const lines = [];
  for (const item of sorted) {
    let line = lines.find(candidate => Math.abs(candidate.y - item.y) <= 3);
    if (!line) {
      line = { y: item.y, items: [] };
      lines.push(line);
    }
    line.items.push(item);
  }
  const candidates = [];
  for (const line of lines) {
    line.items.sort((a, b) => a.x - b.x);
    const text = line.items
      .map(item => item.text)
      .join(" ")
      .trim();
    const split = /^(.{1,80}?)\s*[:=]\s*(.{1,200})$/.exec(text);
    if (!split) continue;
    const field = fieldForHeader(split[1]);
    if (!field) continue;
    candidates.push({
      field,
      rawText: redact(split[2]),
      proposedValue: parseLabeledValue(field, split[2]),
      source: {
        pageNumber,
        x: Math.min(...line.items.map(item => item.x)),
        y: line.y,
        itemIndexes: line.items.map(item => item.itemIndex),
      },
      requiresConfirmation: true,
      personnelUserId: null,
      requiresUserMapping: field === "staff",
    });
  }
  return candidates;
}

async function parseXlsx(bytes) {
  const zip = preflightXlsx(bytes);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(bytes, { ignoreNodes: ["extLst"] });
  if (workbook.worksheets.length > LIMIT.sheets) stop("XLSX_SHEET_LIMIT");
  const sheets = [];
  let totalRows = 0,
    totalCells = 0,
    characters = 0;
  for (const sheet of workbook.worksheets) {
    if (sheet.rowCount > LIMIT.rows || sheet.columnCount > LIMIT.columns)
      stop("XLSX_ROW_COLUMN_LIMIT");
    const mergedRanges = sheet.model?.merges ?? [];
    if (
      !Array.isArray(mergedRanges) ||
      mergedRanges.length > LIMIT.mergedRanges
    )
      stop("XLSX_MERGE_LIMIT");
    totalRows += sheet.rowCount;
    if (totalRows > LIMIT.rows) stop("XLSX_ROW_LIMIT");
    const rows = [];
    let headerRow = null,
      fieldColumns = {},
      ambiguousHeaderFields = [];
    for (let n = 1; n <= sheet.rowCount; n++) {
      const row = sheet.getRow(n);
      const cells = [];
      row.eachCell({ includeEmpty: false }, cell => {
        if (cell.isMerged && cell.master.address !== cell.address) return;
        totalCells++;
        if (totalCells > LIMIT.cells) stop("XLSX_CELL_LIMIT");
        const parsed = scalar(cell);
        characters +=
          parsed.display.length +
          (typeof parsed.value === "string" ? parsed.value.length : 0);
        if (characters > LIMIT.text) stop("XLSX_TEXT_LIMIT");
        cells.push({ address: cell.address, column: cell.col, ...parsed });
      });
      if (!cells.length) continue;
      if (!headerRow && n <= 30) {
        const candidate = {};
        const duplicates = new Set();
        for (const cell of cells) {
          const field = fieldForHeader(cell.value ?? cell.display);
          if (field && candidate[field] === undefined)
            candidate[field] = cell.column;
          else if (field) duplicates.add(field);
        }
        if (Object.keys(candidate).length >= 2) {
          headerRow = n;
          for (const field of duplicates) delete candidate[field];
          fieldColumns = candidate;
          ambiguousHeaderFields = [...duplicates];
        }
      }
      rows.push({ rowNumber: n, cells });
    }
    const candidates = [];
    if (headerRow) {
      for (const row of rows) {
        if (row.rowNumber <= headerRow) continue;
        const byColumn = new Map(row.cells.map(cell => [cell.column, cell]));
        const fields = {};
        for (const [field, column] of Object.entries(fieldColumns)) {
          const cell = byColumn.get(column);
          if (cell && cell.type !== "blank")
            fields[field] = candidateValue(field, cell);
        }
        if (Object.keys(fields).length) {
          const staff = fields.staff?.rawValue ?? null;
          const shift = fields.shift?.rawValue ?? null;
          candidates.push({
            rowNumber: row.rowNumber,
            staffNameSuggestion: staff,
            shiftSuggestion: shift,
            fields,
            personnelUserId: null,
            requiresUserMapping: !!staff,
          });
        }
      }
    }
    sheets.push({
      name: sheet.name.slice(0, 100),
      rowCount: sheet.rowCount,
      headerRow,
      mergedRanges: [...mergedRanges],
      ambiguousHeaderFields,
      rows,
      candidates,
    });
  }
  return { format: "XLSX", sourceSha256: digest(bytes), zip, sheets };
}

async function parsePdf(bytes) {
  if (
    bytes.length < 8 ||
    bytes.length > LIMIT.input ||
    bytes.subarray(0, 5).toString("ascii") !== "%PDF-"
  )
    stop("PDF_INPUT_INVALID");
  const pdfModule = fileURLToPath(import.meta.resolve("pdfjs-dist"));
  const standardFontDataUrl =
    resolve(dirname(pdfModule), "../standard_fonts").replaceAll("\\", "/") +
    "/";
  const task = getDocument({
    data: new Uint8Array(bytes),
    standardFontDataUrl,
    useWorkerFetch: false,
    disableAutoFetch: true,
    disableFontFace: true,
    isEvalSupported: false,
    enableXfa: false,
    stopAtErrors: true,
  });
  const pdf = await task.promise;
  try {
    if (!pdf.numPages || pdf.numPages > LIMIT.pdfPages) stop("PDF_PAGE_LIMIT");
    const pages = [];
    let totalChars = 0,
      totalItems = 0;
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
      const page = await pdf.getPage(pageNumber);
      const content = await page.getTextContent({
        includeMarkedContent: false,
        disableNormalization: false,
      });
      const operators = await page.getOperatorList({ intent: "display" });
      const containsRasterImage = operators.fnArray.some(op =>
        [
          OPS.paintImageXObject,
          OPS.paintInlineImageXObject,
          OPS.paintImageMaskXObject,
        ].includes(op)
      );
      const items = content.items
        .filter(item => typeof item.str === "string")
        .map(item => ({
          text: redact(item.str).slice(0, 1000),
          x: Math.round(item.transform?.[4] ?? 0),
          y: Math.round(item.transform?.[5] ?? 0),
        }));
      if (items.length > LIMIT.pdfPageItems) stop("PDF_ITEM_LIMIT");
      totalItems += items.length;
      totalChars += items.reduce((n, item) => n + item.text.length, 0);
      if (totalItems > 100000 || totalChars > LIMIT.text)
        stop("PDF_TEXT_LIMIT");
      const fieldCandidates = pdfFieldCandidates(pageNumber, items);
      pages.push({
        pageNumber,
        text: items
          .map(item => item.text)
          .join(" ")
          .slice(0, 100000),
        items,
        fieldCandidates,
        containsRasterImage,
        needsLocalOcr:
          containsRasterImage && items.every(item => !item.text.trim()),
      });
      page.cleanup();
    }
    return {
      format: "PDF",
      sourceSha256: digest(bytes),
      pageCount: pdf.numPages,
      pages,
    };
  } finally {
    await task.destroy();
  }
}

try {
  const bytes = Buffer.from(workerData.bytes);
  if (!bytes.length || bytes.length > LIMIT.input) stop("DOCUMENT_INPUT_LIMIT");
  const result =
    workerData.format === "PDF"
      ? await parsePdf(bytes)
      : workerData.format === "XLSX"
        ? await parseXlsx(bytes)
        : stop("DOCUMENT_FORMAT_UNSUPPORTED");
  const serialized = JSON.stringify(result);
  if (Buffer.byteLength(serialized) > LIMIT.output)
    stop("DOCUMENT_OUTPUT_LIMIT");
  parentPort.postMessage({ ok: true, result });
} catch (error) {
  parentPort.postMessage({
    ok: false,
    error: String(error?.message ?? "DOCUMENT_PARSE_FAILED").slice(0, 160),
  });
}

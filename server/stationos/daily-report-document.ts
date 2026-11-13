import { Worker } from "node:worker_threads";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, resolve } from "node:path";
import { createHash } from "node:crypto";
import { fail } from "./types";
import {
  buildOesseShiftReportDraft,
  type OesseMetadataSource,
  type OesseReportRowInput,
} from "../../shared/oesse-shift-report";
import { buildDailyAccountDraft } from "../../shared/daily-account-review";

export const DAILY_DOCUMENT_MAX_BYTES = 12 * 1024 * 1024;
export const DAILY_DOCUMENT_TIMEOUT_MS = 15_000;
export const DAILY_DOCUMENT_MAX_RESULT_BYTES = 3 * 1024 * 1024;
export type DailyDocumentFormat = "PDF" | "XLSX";
let parserActive = false;
const parseMessages: Record<string, string> = {
  DAILY_DOCUMENT_TIMEOUT:
    "Belge güvenli ayrıştırma süresini aştı; dosya reddedildi.",
  DOCUMENT_INPUT_LIMIT: "Belge boyut sınırını aşıyor.",
  DOCUMENT_OUTPUT_LIMIT: "Ayrıştırma sonucu güvenli boyut sınırını aşıyor.",
  XLSX_ZIP_LIMIT:
    "XLSX açılmış boyut, sıkıştırma oranı veya ZIP sayısı güvenli sınırı aşıyor.",
  XLSX_ZIP_INVALID: "XLSX ZIP yapısı veya bütünlük denetimi geçersiz.",
  XLSX_ZIP_EXPANSION_REJECTED:
    "XLSX ZIP içeriği açılmış boyut veya CRC denetimini geçemedi.",
  XLSX_STRUCTURE_INVALID: "XLSX çalışma kitabı yapısı doğrulanamadı.",
  XLSX_EXTERNAL_CONTENT_REJECTED:
    "XLSX makro veya harici bağlantı içerdiği için reddedildi.",
  XLSX_SHEET_LIMIT: "XLSX sayfa sayısı sınırı aşıldı.",
  XLSX_ROW_COLUMN_LIMIT: "XLSX satır veya sütun sınırı aşıldı.",
  XLSX_ROW_LIMIT: "XLSX toplam satır sınırı aşıldı.",
  XLSX_CELL_LIMIT: "XLSX hücre sayısı sınırı aşıldı.",
  XLSX_TEXT_LIMIT: "XLSX metin alanı sınırı aşıldı.",
  PDF_INPUT_INVALID: "PDF belgesi çözümlenemedi.",
  PDF_PAGE_LIMIT: "PDF sayfa sayısı sınırı aşıldı.",
  PDF_ITEM_LIMIT: "PDF sayfa metin öğesi sınırı aşıldı.",
  PDF_TEXT_LIMIT: "PDF metin boyutu sınırı aşıldı.",
};

export function detectDailyDocumentFormat(
  fileName: string,
  bytes: Buffer
): DailyDocumentFormat {
  if (!bytes.length || bytes.length > DAILY_DOCUMENT_MAX_BYTES)
    fail("DAILY_DOCUMENT_SIZE", "PDF/XLSX dosyası en fazla 12 MB olabilir.");
  if (
    /\.pdf$/i.test(fileName) &&
    bytes.subarray(0, 5).toString("ascii") === "%PDF-"
  )
    return "PDF";
  if (
    /\.xlsx$/i.test(fileName) &&
    bytes.length >= 4 &&
    bytes.readUInt32LE(0) === 0x04034b50
  )
    return "XLSX";
  fail(
    "DAILY_DOCUMENT_TYPE",
    "Yalnız geçerli PDF veya XLSX kaynak belgesi kabul edilir."
  );
}

export async function parseDailyDocument(
  format: DailyDocumentFormat,
  bytes: Buffer
): Promise<Record<string, any>> {
  if (
    !Buffer.isBuffer(bytes) ||
    !bytes.length ||
    bytes.length > DAILY_DOCUMENT_MAX_BYTES
  )
    fail("DAILY_DOCUMENT_SIZE", "PDF/XLSX dosyası en fazla 12 MB olabilir.");
  if (format === "PDF" && bytes.subarray(0, 5).toString("ascii") !== "%PDF-")
    fail("DAILY_DOCUMENT_INVALID", "PDF başlığı doğrulanamadı.");
  if (format === "XLSX" && bytes.readUInt32LE(0) !== 0x04034b50)
    fail("DAILY_DOCUMENT_INVALID", "XLSX ZIP kapsayıcısı doğrulanamadı.");
  if (parserActive)
    fail(
      "DAILY_DOCUMENT_BUSY",
      "Başka bir rapor belgesi ayrıştırılıyor; bitmesini bekleyin.",
      429
    );
  parserActive = true;

  const modulePath = fileURLToPath(import.meta.url);
  const workerPath = modulePath.endsWith(".js")
    ? resolve(dirname(modulePath), "daily-report-parser-worker.mjs")
    : resolve(dirname(modulePath), "daily-report-parser-worker.mjs");
  try {
    const worker = new Worker(pathToFileURL(workerPath), {
      workerData: { format, bytes: Uint8Array.from(bytes) },
      resourceLimits: {
        maxOldGenerationSizeMb: 160,
        maxYoungGenerationSizeMb: 32,
        stackSizeMb: 8,
      },
    });
    const parsed = await new Promise<Record<string, any>>(
      (resolvePromise, reject) => {
        let finished = false;
        const finish = (error?: Error, value?: Record<string, any>) => {
          if (finished) return;
          finished = true;
          clearTimeout(timer);
          void worker.terminate();
          if (error) reject(error);
          else resolvePromise(value!);
        };
        const timer = setTimeout(
          () => finish(new Error("DAILY_DOCUMENT_TIMEOUT")),
          DAILY_DOCUMENT_TIMEOUT_MS
        );
        worker.once("message", (message: any) => {
          if (!message?.ok || !message.result) {
            finish(
              new Error(String(message?.error ?? "DAILY_DOCUMENT_PARSE_FAILED"))
            );
            return;
          }
          let resultBytes: number;
          try {
            resultBytes = Buffer.byteLength(JSON.stringify(message.result));
          } catch {
            finish(new Error("DAILY_DOCUMENT_OUTPUT_INVALID"));
            return;
          }
          if (resultBytes > DAILY_DOCUMENT_MAX_RESULT_BYTES) {
            finish(new Error("DAILY_DOCUMENT_OUTPUT_LIMIT"));
            return;
          }
          if (
            message.result.sourceSha256 !==
            createHash("sha256").update(bytes).digest("hex")
          ) {
            finish(new Error("DAILY_DOCUMENT_SOURCE_MISMATCH"));
            return;
          }
          finish(undefined, message.result);
        });
        worker.once("error", error => finish(error));
        worker.once("exit", code => {
          if (!finished && code !== 0)
            finish(new Error("DAILY_DOCUMENT_WORKER_EXIT"));
        });
      }
    );
    const rows: OesseReportRowInput[] = [];
    let metadataText = "";
    const metadataSources: OesseMetadataSource[] = [];
    if (format === "XLSX") {
      for (const sheet of parsed.sheets ?? []) {
        for (const row of sheet.rows ?? []) {
          const cells = Array<string>(
            Math.max(
              0,
              ...row.cells.map((cell: any) => Number(cell.column ?? 0))
            )
          ).fill("");
          const cellLocations = Array<string | null>(cells.length).fill(null);
          for (const cell of row.cells) {
            cells[Number(cell.column) - 1] = String(
              cell.value ?? cell.display ?? ""
            );
            cellLocations[Number(cell.column) - 1] = cell.address;
          }
          const text = cells.join(" ");
          const metadataRowText = cells.join(" : ");
          metadataText += `${metadataRowText}\n`;
          metadataSources.push({
            text: metadataRowText,
            sourceLocation: `${sheet.name}!${row.cells.map((cell: any) => cell.address).join(",") || `row ${row.rowNumber}`}`,
          });
          rows.push({
            cells,
            cellLocations,
            sourceLocation: `${sheet.name}!${row.cells[0]?.address ?? `row ${row.rowNumber}`}`,
          });
        }
      }
    } else {
      for (const page of parsed.pages ?? []) {
        const lines: { y: number; items: any[] }[] = [];
        for (const item of page.items ?? []) {
          let line = lines.find(
            candidate => Math.abs(candidate.y - Number(item.y)) <= 3
          );
          if (!line) {
            line = { y: Number(item.y), items: [] };
            lines.push(line);
          }
          line.items.push(item);
        }
        lines.sort((a, b) => b.y - a.y);
        const normalize = (value: string) =>
          value
            .normalize("NFD")
            .replace(/[\u0300-\u036f]/g, "")
            .toLocaleLowerCase("tr-TR")
            .replace(/ı/g, "i")
            .replace(/[^a-z0-9]+/g, " ")
            .trim();
        const header = lines.find(line => {
          const text = normalize(line.items.map(item => item.text).join(" "));
          return (
            text.includes("osse adi") &&
            text.includes("satis adedi") &&
            text.includes("satis tutari")
          );
        });
        const metadataLines = lines.map(line => {
          const orderedItems = [...line.items].sort((a, b) => a.x - b.x);
          const lineText = orderedItems.map(item => item.text).join(" ");
          const minX = orderedItems.length
            ? Math.min(...orderedItems.map(item => Number(item.x)))
            : 0;
          return {
            text: lineText,
            sourceLocation: `PDF sayfa ${page.pageNumber}, y=${line.y}, x=${minX}`,
          };
        });
        metadataText += metadataLines.map(line => line.text).join("\n") + "\n";
        metadataSources.push(...metadataLines);
        if (!header) continue;
        const headerItems = [...header.items].sort((a, b) => a.x - b.x);
        const columnItems = ["osse adi", "satis adedi", "satis tutari"].map(
          label =>
            headerItems.find(item => normalize(item.text).includes(label))
        );
        if (columnItems.some(item => !item)) continue;
        const centers = columnItems.map(item => Number(item!.x));
        for (const line of lines.filter(candidate => candidate.y < header!.y)) {
          const cells = ["", "", ""];
          const cellLocations: (string | null)[] = [null, null, null];
          for (const item of line.items) {
            const index = centers.reduce(
              (best, x, candidate) =>
                Math.abs(Number(item.x) - x) <
                Math.abs(Number(item.x) - centers[best])
                  ? candidate
                  : best,
              0
            );
            cells[index] = `${cells[index]} ${item.text}`.trim();
            if (!cellLocations[index])
              cellLocations[index] =
                `PDF sayfa ${page.pageNumber}, x=${Number(item.x)}, y=${line.y}`;
          }
          if (cells.some(Boolean))
            rows.push({
              cells,
              cellLocations,
              sourceLocation: `PDF sayfa ${page.pageNumber}, y=${line.y}`,
            });
        }
      }
    }
    const shiftReportDraft = buildOesseShiftReportDraft({
      rows,
      metadataText,
      metadataSources,
      sourceSha256: parsed.sourceSha256,
    });
    const dailyAccountDraft =
      format === "XLSX"
        ? buildDailyAccountDraft({
            sheets: parsed.sheets ?? [],
            sourceSha256: parsed.sourceSha256,
            automationStartsAt: shiftReportDraft?.startsAt,
            automationEndsAt: shiftReportDraft?.endsAt,
          })
        : null;
    return {
      ...parsed,
      ...(shiftReportDraft ? { shiftReportDraft } : {}),
      ...(dailyAccountDraft ? { dailyAccountDraft } : {}),
    };
  } catch (error) {
    const code = String((error as Error)?.message ?? "").split(/[\s:]/, 1)[0];
    fail(
      code,
      parseMessages[code] ??
        "Belge güvenli biçimde ayrıştırılamadı ve reddedildi.",
      code.includes("LIMIT") || code.includes("SIZE") ? 413 : 422
    );
  } finally {
    parserActive = false;
  }
}

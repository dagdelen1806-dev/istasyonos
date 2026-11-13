import { parseLitres } from "./fuel";
import { parseMoney } from "./station";
export type OcrField =
  | "volumeMl"
  | "amountMinor"
  | "transactionCount"
  | "openingMl"
  | "closingMl"
  | "reportedMl"
  | "deliveryMl"
  | "returnMl"
  | "netMl"
  | "dispatchMl";
export const ocrFieldLabels: Record<OcrField, string> = {
  volumeMl: "Satış litresi",
  amountMinor: "Tutar",
  transactionCount: "İşlem adedi",
  openingMl: "Açılış",
  closingMl: "Kapanış",
  reportedMl: "Kaynakta yazılı litre",
  deliveryMl: "Fiziksel tank girişi",
  returnMl: "Fiziksel test dönüşü",
  netMl: "Belge net hacmi",
  dispatchMl: "Belge sevk miktarı",
};
export const ocrFields = {
  SALES: ["volumeMl", "amountMinor"],
  METER: ["openingMl", "closingMl", "reportedMl"],
  TANK: ["openingMl", "closingMl", "deliveryMl", "returnMl"],
  TENDER: ["amountMinor"],
  STAFF_SALES: ["transactionCount", "volumeMl", "amountMinor"],
  STAFF_TENDER: ["transactionCount", "amountMinor"],
  TANKER: ["netMl", "dispatchMl"],
} as const;
export interface OcrChoice {
  normalized: string;
  ml: number | null;
  minor: number | null;
  count?: number;
  interpretation: string;
}
export interface OcrBox {
  x: number;
  y: number;
  width: number;
  height: number;
}
export interface OcrToken {
  id: string;
  line: number;
  raw: string;
  box: OcrBox;
  choices: OcrChoice[];
  warnings: string[];
}
export interface OcrPayload {
  words?: { id: string; line: number; text: string; box: OcrBox }[];
  engine: "windows-media-ocr";
  language: string;
  width: number;
  height: number;
  angle: number | null;
  confidence: null;
  sourcePageNumber?: number;
  renderedImageSha256?: string;
  lines: { index: number; text: string }[];
  tokens: OcrToken[];
  warnings: string[];
}
export interface OcrRun {
  id: string;
  pageId: string;
  sourceSha256: string;
  engineVersion: string;
  createdAt: string;
  payload: OcrPayload;
}
export interface OcrEvidence {
  layout?: {
    version: 1;
    tableId: string;
    rowId: string;
    header?: string;
    rowLabel?: string;
    labelCorrected?: boolean;
  };
  runId: string;
  pageId: string;
  tokenId: string;
  choiceIndex: number;
  field: OcrField;
  confirmed: true;
  rawText?: string;
  normalized?: string;
  proposedValue?: number;
  corrected?: boolean;
}
export function ocrNumber(raw: string): {
  choices: OcrChoice[];
  warnings: string[];
} {
  const text = raw.trim(),
    warnings: string[] = [],
    values: { value: string; meaning: string }[] = [];
  if (/^[-−]\d/.test(text))
    return {
      choices: [],
      warnings: ["Negatif değer kaynak litre/tutar alanına önerilmez."],
    };
  if (!/^\d[\d.,]*$/.test(text) || text.length > 32)
    return { choices: [], warnings: [] };
  const add = (value: string, meaning: string) => {
    const normalized = value.replace(/^0+(?=\d)/, "");
    if (!values.some(v => v.value === normalized))
      values.push({ value: normalized, meaning });
  };
  if (/^\d+$/.test(text)) add(text, "Tam sayı");
  else if (/^\d{1,3}(\.\d{3})+,\d{1,3}$/.test(text))
    add(
      text.replaceAll(".", "").replace(",", "."),
      "Türkçe binlik ve ondalık ayırıcı"
    );
  else if (/^\d{1,3}(,\d{3})+\.\d{1,3}$/.test(text)) {
    add(text.replaceAll(",", ""), "Virgül binlik, nokta ondalık");
    warnings.push("Sayı biçimi rapordan ayrıca kontrol edilmeli.");
  } else if (/^\d+[.,]\d{1,3}$/.test(text)) {
    add(text.replace(",", "."), "Ondalık sayı");
    if (/^\d{1,3}[.,]\d{3}$/.test(text))
      add(text.replace(/[.,]/g, ""), "Binlik ayırıcıyla tam sayı");
  } else if (/^\d{1,3}(\.\d{3}){2,}$/.test(text))
    add(text.replaceAll(".", ""), "Nokta binlik ayırıcı");
  else if (/^\d{1,3}(,\d{3}){2,}$/.test(text)) {
    add(text.replaceAll(",", ""), "Virgül binlik ayırıcı");
    warnings.push("Sayı biçimi rapordan ayrıca kontrol edilmeli.");
  }
  const choices = values.flatMap(v => {
    let ml: number | null = null,
      minor: number | null = null;
    try {
      ml = parseLitres(v.value);
    } catch {}
    try {
      minor = parseMoney(v.value);
    } catch {}
    return ml === null && minor === null
      ? []
      : [{
          normalized: v.value,
          ml,
          minor,
          ...( /^\d{1,7}$/.test(text) ? { count: Number(text) } : {}),
          interpretation: v.meaning,
        }];
  });
  if (choices.length > 1)
    warnings.push("Ayırıcı belirsiz; doğru sayı yorumunu açıkça seçin.");
  if (text.replace(/\D/g, "").length >= 9)
    warnings.push("Uzun sayı bir kimlik, vardiya veya referans olabilir.");
  if (!choices.length)
    warnings.push("Biçim ya da hassasiyet desteklenmiyor; elle doğrulayın.");
  return { choices, warnings };
}

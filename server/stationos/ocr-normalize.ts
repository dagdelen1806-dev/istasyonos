/** Pure OCR value handling: no database, network, or provider dependencies. */
export type OcrCheckStatus = "CORRECT" | "WRONG" | "MISSING";
export type InvoiceArithmeticStatus = "CONSISTENT" | "NEEDS_USER_REVIEW";

type OcrField = { label: string; value: unknown };

export function normalizeOcrDate(
  value: unknown,
): { value: string | null; original: string | null } {
  if (value === null || value === undefined || String(value).trim() === "") {
    return { value: null, original: null };
  }
  const original = String(value).trim();
  const match = /^(?:(\d{2})\.(\d{2})\.(\d{4})|(\d{4})-(\d{2})-(\d{2}))$/.exec(original);
  if (!match) return { value: null, original };
  const year = Number(match[3] ?? match[4]);
  const month = Number(match[2] ?? match[5]);
  const day = Number(match[1] ?? match[6]);
  if (year < 1000 || year > 9999 || month < 1 || month > 12 || day < 1 || day > 31) {
    return { value: null, original };
  }
  const date = new Date(0);
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCFullYear(year, month - 1, day);
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    return { value: null, original };
  }
  return {
    value: `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
    original,
  };
}

function numericText(value: unknown): string | null {
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : null;
  if (typeof value !== "string") return null;
  const text = value
    .normalize("NFC")
    .replace(/[\u00a0\u202f\s]/g, "")
    .replace(/(?:TRY|TL|₺|LİTRE|LITRE|LT|L)$/iu, "");
  if (!/^[+-]?\d[\d.,]*$/.test(text)) return null;
  const sign = text[0] === "-" ? "-" : "";
  const unsigned = text.replace(/^[+-]/, "");
  if (unsigned.includes(",")) {
    // Turkish locale: comma decimal, dot groups thousands.
    if (!/^(?:\d+|\d{1,3}(?:\.\d{3})+),\d+$/.test(unsigned)) return null;
    return sign + unsigned.replace(/\./g, "").replace(",", ".");
  }
  if (/^\d{1,3}(?:\.\d{3}){2,}$/.test(unsigned)) {
    return sign + unsigned.replace(/\./g, "");
  }
  if (!/^\d+(?:\.\d+)?$/.test(unsigned)) return null;
  return sign + unsigned;
}

export function parseOcrDecimal(value: unknown): number | null {
  const normalized = numericText(value);
  if (normalized === null) return null;
  const number = Number(normalized);
  return Number.isFinite(number) ? number : null;
}

/**
 * Tank display readings with a declared Turkish L-unit format.
 * A single dot followed by exactly three digits is a *thousands separator*
 * only when the original OCR source is a STRING. Never rescale numbers: an
 * upstream numeric 23.879 could mean 23.879 L and has lost its formatting.
 * This must not be used for unlabelled, non-TR, or m³ readings.
 */
export function parseTurkishTankLitres(value: unknown): {
  value: number | null;
  original: string | null;
  interpretation: "TR_GROUPED_L" | "TR_DECIMAL_L" | "PLAIN_L" | "NUMERIC_AS_IS" | "MISSING" | "INVALID";
} {
  if (value === null || value === undefined || value === "") {
    return { value: null, original: null, interpretation: "MISSING" };
  }
  const original = String(value).trim();
  if (typeof value === "number") {
    return Number.isFinite(value) && value >= 0
      ? { value, original, interpretation: "NUMERIC_AS_IS" }
      : { value: null, original, interpretation: "INVALID" };
  }
  if (typeof value !== "string") return { value: null, original, interpretation: "INVALID" };
  const compact = original.normalize("NFC").replace(/[\u00a0\u202f\s]/g, "")
    .replace(/(?:LİTRE|LITRE|LT|L)$/iu, "");
  if (/^\+?\d{1,3}(?:\.\d{3})+$/u.test(compact)) {
    const parsed = Number(compact.replace(/\./g, ""));
    return Number.isSafeInteger(parsed)
      ? { value: parsed, original, interpretation: "TR_GROUPED_L" }
      : { value: null, original, interpretation: "INVALID" };
  }
  const parsed = parseOcrDecimal(value);
  if (parsed === null || parsed < 0) return { value: null, original, interpretation: "INVALID" };
  return {
    value: parsed,
    original,
    interpretation: compact.includes(",") ? "TR_DECIMAL_L" : "PLAIN_L",
  };
}

/** Exact decimal-to-kuruş conversion, HALF_UP, without floating-point rounding. */
export function parseOcrMoneyMinor(value: unknown): number | null {
  const normalized = numericText(value);
  if (normalized === null) return null;
  const negative = normalized.startsWith("-");
  const [whole, fraction = ""] = normalized.replace(/^[+-]/, "").split(".");
  if (!/^\d+$/.test(whole) || !/^\d*$/.test(fraction)) return null;
  const minor = BigInt(whole) * 100n
    + BigInt((fraction + "00").slice(0, 2))
    + (fraction.length > 2 && Number(fraction[2]) >= 5 ? 1n : 0n);
  if (minor > BigInt(Number.MAX_SAFE_INTEGER)) return null;
  return Number(negative ? -minor : minor);
}

export function compareOcrValue(expected: unknown, actual: unknown, field: string): OcrCheckStatus {
  if (actual === null || actual === undefined || actual === "") return "MISSING";
  if (field === "date") {
    const left = normalizeOcrDate(expected).value;
    const right = normalizeOcrDate(actual).value;
    return left && right && left === right ? "CORRECT" : "WRONG";
  }
  if (field.endsWith("Try")) {
    const left = parseOcrMoneyMinor(expected);
    const right = parseOcrMoneyMinor(actual);
    return left !== null && right !== null && left === right ? "CORRECT" : "WRONG";
  }
  if (typeof expected === "number") {
    const got = parseOcrDecimal(actual);
    return got !== null && Math.abs(got - expected) <= 0.01 ? "CORRECT" : "WRONG";
  }
  const normalize = (v: unknown) => String(v).normalize("NFC").toLocaleLowerCase("tr-TR").replace(/\s+/g, " ").trim();
  return normalize(actual) === normalize(expected) ? "CORRECT" : "WRONG";
}

function invoiceLabel(label: string): string {
  return label.normalize("NFC").toLocaleLowerCase("tr-TR").replace(/[:：]\s*$/u, "").replace(/\s+/g, " ").trim();
}

const invoiceLabels = {
  subtotalTry: /^(?:ara\s*toplam(?:\s*(?:tutarı|tutari|\(kdv hariç\)))?|matrah(?:ı|i)?|kdv\s*matrahı|mal\s*\/?\s*hizmet\s*toplam(?:\s*tutarı)?|vergisiz\s*toplam)$/u,
  vatTry: /^(?:kdv(?:\s*(?:tutarı|tutari|toplamı|toplami))?|hesaplanan\s*kdv|toplam\s*kdv|katma\s*değer\s*vergisi)$/u,
  totalTry: /^(?:genel\s*toplam(?:\s*tutarı)?|ödenecek(?:\s*(?:toplam|tutar|tutarı))?|fatura\s*toplamı|toplam\s*tutar(?:ı)?|kdv\s*dahil\s*toplam|vergi\s*dahil\s*toplam)$/u,
} as const;

/** Amount values are returned as OCR source strings; no amount is calculated or inferred. */
export function extractInvoiceMoneyFields(fields: ReadonlyArray<OcrField>) {
  const values: Record<keyof typeof invoiceLabels, unknown> = {
    subtotalTry: null,
    vatTry: null,
    totalTry: null,
  };
  const ambiguousFields: string[] = [];
  for (const [name, pattern] of Object.entries(invoiceLabels) as [keyof typeof invoiceLabels, RegExp][]) {
    const candidates = fields.filter(field => pattern.test(invoiceLabel(field.label)) && field.value !== null && field.value !== "");
    const amounts = new Set(candidates.map(field => parseOcrMoneyMinor(field.value)));
    // Duplicate labels with conflicting or invalid values require review.
    if (amounts.size > 1 || (amounts.size === 1 && amounts.has(null))) {
      ambiguousFields.push(name);
    } else if (candidates.length > 0) {
      values[name] = candidates[0].value;
    }
  }
  return { values, ambiguousFields };
}

export function invoiceArithmetic(subtotal: unknown, vat: unknown, total: unknown) {
  const sub = parseOcrMoneyMinor(subtotal);
  const tax = parseOcrMoneyMinor(vat);
  const read = parseOcrMoneyMinor(total);
  const calculated = sub === null || tax === null ? null : sub + tax;
  const status: InvoiceArithmeticStatus = calculated !== null && read !== null && calculated === read
    ? "CONSISTENT" : "NEEDS_USER_REVIEW";
  return {
    status,
    subtotalMinor: sub,
    vatMinor: tax,
    ocrTotalMinor: read,
    calculatedTotalMinor: calculated,
  };
}

import { createHash, randomUUID } from "node:crypto";
import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import { parseOcrMoneyMinor, normalizeOcrDate } from "./ocr-normalize";
import { containsLikelyPan, safeAdd } from "./safety";
import { first, rows, execute } from "./db";
import { fail } from "./types";
import {
  mysqlDate,
  requireBoolean,
  requireEnum,
  requireId,
  requireInteger,
  requireMoney,
  requireString,
  safeDate,
} from "./domain";
import type {
  PosSlipParse,
  PosSlipSettlementKind,
  PosSlipSourceFields,
  PosSlipTransactionType,
  PosSlipValues,
} from "../../shared/pos-slip";

type Row = RowDataPacket & Record<string, any>;
type Scope = { tenantId: string; stationId: string };
const labelKey = (s: string) =>
  s
    .normalize("NFC")
    .toLocaleLowerCase("tr-TR")
    .replace(/\u0131/g, "i")
    .replace(/\u015f/g, "s")
    .replace(/\u011f/g, "g")
    .replace(/\u00fc/g, "u")
    .replace(/\u00f6/g, "o")
    .replace(/\u00e7/g, "c")
    .replace(/[^a-z0-9]+/g, "");
export function samePosSlip(
  a: Pick<PosSlipValues, "transactionAt" | "terminal" | "reference">,
  b: Pick<PosSlipValues, "transactionAt" | "terminal" | "reference">
) {
  return (
    !!a.transactionAt &&
    !!a.terminal &&
    !!a.reference &&
    !!b.transactionAt &&
    !!b.terminal &&
    !!b.reference &&
    a.transactionAt === b.transactionAt &&
    labelKey(a.terminal) === labelKey(b.terminal) &&
    a.reference.trim().toLocaleLowerCase("tr-TR") ===
      b.reference.trim().toLocaleLowerCase("tr-TR")
  );
}
export function posSlipTransactionKey(
  values: PosSlipValues,
  referenceFingerprint?: string | null,
  terminalFingerprint?: string | null
) {
  if (!values.transactionAt || !values.terminal || !values.reference)
    return null;
  return createHash("sha256")
    .update(
      `${values.transactionAt}|${terminalFingerprint || labelKey(values.terminal)}|${referenceFingerprint || values.reference.trim().toLocaleLowerCase("tr-TR")}`
    )
    .digest("hex");
}
export function posSlipAccessAllowed(role: string, isOwner: boolean) {
  return (
    ["OWNER", "MANAGER", "ACCOUNTANT"].includes(role) ||
    (role === "FUEL_STAFF" && isOwner)
  );
}
const patterns = {
  transactionAt: /^(?:tarihsaat|tarihvesaat|islemtarihi|tarih|saat)$/u,
  amount: /^(?:tutar|islemtutari|islemtutar|toplam|toplamtutar)$/u,
  bank: /^(?:banka|bankaadi|uyeisyeribankasi)$/u,
  terminal: /^(?:terminal|terminalno|terminalnumarasi|posno|posnumarasi)$/u,
  reference:
    /^(?:referans|referansno|islemreferansi|islemno|onaykodu|provizyonno)$/u,
  transactionType: /^(?:islemturu|islem|islemtipi|islemtipi)$/u,
  settlementKind: /^(?:beyan|beyanturu|odemeturu|tahsilatturu|paymenttype)$/u,
  maskedCard: /^(?:maskelikart|kart|kartbilgisi|kartnumarasi)$/u,
} as const;

export function normalizePosSlipDateTime(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const m =
    /^(\d{2}[./-]\d{2}[./-]\d{4}|\d{4}-\d{2}-\d{2})[ T-](\d{2}):(\d{2})(?::(\d{2}))?$/.exec(
      value.trim().replace(/\s+/g, " ")
    );
  if (!m) return null;
  const dateText = /^\d{2}[./-]/u.test(m[1])
    ? m[1].replace(/[/-]/g, ".")
    : m[1];
  const date = normalizeOcrDate(dateText).value;
  const hour = Number(m[2]),
    minute = Number(m[3]),
    second = Number(m[4] ?? 0);
  if (!date || hour > 23 || minute > 59 || second > 59) return null;
  return `${date}T${m[2]}:${m[3]}:${String(second).padStart(2, "0")}+03:00`;
}
function hasLongDigitRun(value: string) {
  return /(?:\d[ -]?){13,19}/u.test(value);
}
function checkSensitive(value: string, label = "") {
  const safeLabel = labelKey(label);
  const compactValue = value.replace(/[\s-]/g, "");
  if (
    /(?:cvv|cvc|guvenlikkodu)/u.test(safeLabel) ||
    containsLikelyPan(value) ||
    /(?:cvv2?|cvc2?|guvenlikkodu)[:#-]?\d{3,4}/iu.test(labelKey(value)) ||
    /(?:kart|card|pan)\D{0,24}(?:\d[ -]?){13,19}/iu.test(value) ||
    (/(?:kart|card|pan)/iu.test(safeLabel) && hasLongDigitRun(value)) ||
    /TR\d{24}/iu.test(compactValue)
  )
    fail(
      "POS_SLIP_SENSITIVE_DATA",
      "Hassas kart verisi algılandı. Görseli maskeleyip yeniden yükleyin.",
      422
    );
}
export function checkPosSlipImagePrivacy(text: string) {
  checkSensitive(text);
  const sensitiveLabels =
    /(?:KAREKOD\s*REF|FAST\s*REF|ONAY\s*KODU|İŞLEM\s*NO|ISLEM\s*NO|İŞYERİ\s*NO|ISYERI\s*NO|POS\s*NO|BATCH\s*NO|AID|IBAN|CARDHOLDER|KART\s*SAHİBİ|KART\s*SAHIBI)\s*[:#-]?/giu;
  for (const line of text.split(/\r?\n/u)) {
    for (const match of line.matchAll(sensitiveLabels)) {
      const tail = line.slice((match.index ?? 0) + match[0].length).trim();
      const token = tail.split(/\s+/u, 1)[0] ?? "";
      if (!token || /[•*Xx]{2,}/u.test(token)) continue;
      const label = labelKey(match[0]);
      const personal = /cardholder|kartsahibi|iban/u.test(label);
      const identifier =
        /^\d{5,}$/u.test(token) || /^(?=.*\d)[A-Z0-9-]{6,}$/iu.test(token);
      if (personal || identifier)
        fail(
          "POS_SLIP_IDENTIFIER_UNMASKED",
          "Tam işlem/işyeri kimliklerini, IBAN'ı ve kart sahibi bilgisini fotoğrafta kapatıp yeniden yükleyin; yalnız son dört karakter görünebilir.",
          422
        );
    }
  }
}
function normalizedReference(value: string) {
  return value
    .normalize("NFC")
    .toLocaleLowerCase("tr-TR")
    .replace(/\s+/g, "")
    .slice(0, 190);
}
function referenceFingerprint(value: string) {
  return createHash("sha256").update(normalizedReference(value)).digest("hex");
}
function terminalFingerprint(value: string) {
  return createHash("sha256").update(labelKey(value)).digest("hex");
}
function maskedReference(value: string) {
  const tail = value.replace(/[^a-z0-9]/giu, "").slice(-4);
  return tail ? `••••${tail}` : "••••";
}
function maskedTerminal(value: string) {
  const tail = value.replace(/[^a-z0-9]/giu, "").slice(-4);
  return tail ? `••••${tail}` : "••••";
}
function isMaskedReference(value: string) {
  return /^(?:•{2,}|\*{2,}|x{2,})[a-z0-9]{0,4}$/iu.test(
    value.replace(/\s+/g, "")
  );
}
const clean = (v: unknown) =>
  typeof v === "string" && v.trim() ? v.trim().slice(0, 190) : null;
export function parsePosSlipFields(fields: unknown): PosSlipParse {
  if (!Array.isArray(fields) || fields.length > 40)
    fail("POS_SLIP_FIELDS_INVALID", "Slip OCR alanları geçersiz.");
  const source: PosSlipSourceFields = {
    transactionAt: null,
    amount: null,
    bank: null,
    terminal: null,
    terminalFingerprint: null,
    reference: null,
    transactionType: null,
    settlementKind: null,
    referenceFingerprint: null,
    maskedCard: null,
  };
  for (const field of fields) {
    if (!field || typeof field.label !== "string") continue;
    if (/(?:cvv|cvc|guvenlikkodu)/u.test(labelKey(field.label)))
      checkSensitive(String(field.value ?? ""), field.label);
    if (typeof field.value === "string")
      checkSensitive(field.value, field.label);
    const key = (Object.keys(patterns) as (keyof typeof patterns)[]).find(k =>
      patterns[k].test(labelKey(field.label))
    );
    if (!key || source[key] !== null) continue;
    const value = clean(field.value);
    if (value) checkSensitive(value, field.label);
    source[key] = value;
  }
  const warnings: string[] = [];
  const rawTerminal = source.terminal;
  if (rawTerminal) {
    source.terminalFingerprint = terminalFingerprint(rawTerminal);
    source.terminal = maskedTerminal(rawTerminal);
  }
  const rawReference = source.reference;
  if (rawReference) {
    source.referenceFingerprint = referenceFingerprint(rawReference);
    source.reference = maskedReference(rawReference);
  }
  const transactionAt = normalizePosSlipDateTime(source.transactionAt);
  if (source.transactionAt && !transactionAt)
    warnings.push("Tarih/saat okunamadı.");
  const amountMinor =
    source.amount === null ? null : parseOcrMoneyMinor(source.amount);
  if (source.amount && amountMinor === null) warnings.push("Tutar okunamadı.");
  const typeText = labelKey(source.transactionType ?? "");
  let transactionType: PosSlipTransactionType | null = null;
  if (/iptal|void|cancel/u.test(typeText)) transactionType = "VOID";
  else if (/iade|refund/u.test(typeText)) transactionType = "REFUND";
  else if (/satis|purchase|sale/u.test(typeText)) transactionType = "SALE";
  if (source.transactionType && !transactionType)
    warnings.push("İşlem türü belirsiz.");
  const settlementText = labelKey(source.settlementKind ?? "");
  const settlementKind: PosSlipSettlementKind | null =
    /fast|hizlitransfer/u.test(settlementText)
      ? "FAST"
      : /kart|slip|pos/u.test(settlementText)
        ? "CARD_SLIP"
        : null;
  if (source.maskedCard) {
    const cardTail = source.maskedCard.replace(/\D/gu, "");
    if (
      /^(?:[*xX•]{2,}\s*){1,4}\d{2,4}$/u.test(source.maskedCard) &&
      cardTail.length >= 2 &&
      cardTail.length <= 4
    ) {
      source.maskedCard = `•••• ${cardTail}`;
    } else {
      source.maskedCard = null;
      warnings.push("Maskeli kart alanı güvenli biçimde okunamadı; atlandı.");
    }
  }
  const values: PosSlipValues = {
    transactionAt,
    amountMinor,
    bank: source.bank,
    terminal: source.terminal,
    reference: source.reference,
    transactionType,
    settlementKind,
    maskedCard: source.maskedCard,
  };
  const reviewRequired =
    warnings.length > 0 || Object.values(values).some(v => v === null);
  if (reviewRequired)
    warnings.push("OCR çıktısı taslaktır; personel belgeyle doğrulamalıdır.");
  return { values, source, warnings, reviewRequired };
}

/** Parses the line layout of Turkish POS and FAST thermal receipts. */
export function parsePosSlipText(text: string): PosSlipParse {
  const lines = text
    .split(/\r?\n/u)
    .map(line => line.trim())
    .filter(Boolean);
  const allText = lines.join("\n");
  const normalizedText = labelKey(allText);
  const fields: { label: string; value: string }[] = [];
  const dateMatch =
    /(?:^|\D)([0-9OIl]{2})[./-]([0-9OIl]{2})[./-]([0-9OIl]{4})\s*[-T ]\s*([0-9OIl]{1,2}:[0-9OIl]{2}(?::[0-9OIl]{2})?)/iu.exec(
      allText
    );
  if (dateMatch) {
    const repairDigits = (value: string) =>
      value.replace(/[Oo]/gu, "0").replace(/[Il|]/gu, "1");
    fields.push({
      label: "Tarih/Saat",
      value: `${repairDigits(dateMatch[1])}.${repairDigits(dateMatch[2])}.${repairDigits(dateMatch[3])} ${repairDigits(dateMatch[4])}`,
    });
  }

  const amountPattern = /(?:\d{1,3}(?:\.\d{3})+|\d+),\d{2}\s*(?:TL|₺)?/u;
  let amount: string | null = null;
  const totalIndex = lines.findIndex(line =>
    /^(?:TUTAR|TOPLAM|AMOUNT)$/iu.test(labelKey(line))
  );
  if (totalIndex >= 0) {
    for (const line of lines.slice(totalIndex + 1, totalIndex + 4)) {
      const match = amountPattern.exec(line);
      if (match) {
        amount = match[0];
        break;
      }
    }
  }
  if (!amount) {
    const labeled =
      /(?:TUTAR|TOPLAM|AMOUNT)\s*[:=-]?\s*((?:\d{1,3}(?:\.\d{3})+|\d+),\d{2})\s*(?:TL|₺)?/iu.exec(
        allText
      );
    const candidates = [
      ...allText.matchAll(new RegExp(amountPattern.source, "gu")),
    ];
    amount =
      labeled?.[1] ?? (candidates.length === 1 ? candidates[0][0] : null);
  }
  if (amount) fields.push({ label: "Tutar", value: amount });

  const bankNames: Array<[RegExp, string]> = [
    [/halk\s*bank|halkbank/iu, "HALKBANK"],
    [/ziraat\s*bank/iu, "ZİRAAT BANKASI"],
    [/vakıf\s*bank|vakifbank/iu, "VAKIFBANK"],
    [/iş\s*bank|isbank/iu, "İŞ BANKASI"],
    [/akbank/iu, "AKBANK"],
    [/garanti/iu, "GARANTİ BBVA"],
    [/yapı\s*kredi|yapikredi/iu, "YAPI KREDİ"],
    [/deniz\s*bank|denizbank/iu, "DENİZBANK"],
  ];
  const bank = bankNames.find(([pattern]) => pattern.test(allText));
  if (bank) fields.push({ label: "Banka", value: bank[1] });

  const terminalMatch =
    /(?:(?:P[O0]S)\s*N[O0]|TERM(?:INAL)?\s*NO)\s*[:#-]?\s*([A-Z0-9-]{3,32})/iu.exec(
      allText
    );
  if (terminalMatch)
    fields.push({ label: "Terminal No", value: terminalMatch[1] });
  const hasFastEvidence =
    /fastsat(?:ı|i)[sş]/u.test(normalizedText) ||
    /fastref|iban|havaleref|gonderenkatilimci/u.test(normalizedText);
  const hasCardEvidence =
    /maskedcard/u.test(normalizedText) ||
    lines.some(
      line => /kart|card/iu.test(line) && /\*{2,}|x{2,}/iu.test(line)
    ) ||
    (!/iban/u.test(normalizedText) && /\*{2,}|x{2,}/iu.test(allText));
  const instrument: PosSlipSettlementKind | null =
    hasFastEvidence === hasCardEvidence
      ? null
      : hasFastEvidence
        ? "FAST"
        : "CARD_SLIP";
  const refPatterns =
    instrument === "FAST"
      ? [
          /(?:FAST\s*REF)\s*[:#-]?\s*([A-Z0-9-]{4,40})/iu,
          /(?:KAREKOD\s*REF)\s*[:#-]?\s*([A-Z0-9-]{4,40})/iu,
          /(?:ONAY\s*KODU)\s*[:#-]?\s*([A-Z0-9-]{4,40})/iu,
        ]
      : [
          /(?:KAREKOD\s*REF)\s*[:#-]?\s*([A-Z0-9-]{4,40})/iu,
          /(?:ONAY\s*KODU)\s*[:#-]?\s*([A-Z0-9-]{4,40})/iu,
          /(?:İŞLEM\s*NO|ISLEM\s*NO)\s*[:#-]?\s*([A-Z0-9-]{4,40})/iu,
        ];
  const refMatch =
    refPatterns.map(pattern => pattern.exec(allText)).find(Boolean) ??
    /(?:karekodref|fastref|onaykodu|islemno)([a-z0-9]{4,40})/u.exec(
      normalizedText
    );
  if (refMatch) fields.push({ label: "İşlem Referansı", value: refMatch[1] });
  if (instrument) fields.push({ label: "Beyan Türü", value: instrument });
  const type = /(?:FAST\s*)?SAT(?:I|İ)[SŞ]/iu.test(allText)
    ? "SATIŞ"
    : /İPTAL|IPTAL|VOID/iu.test(allText)
      ? "İPTAL"
      : /İADE|REFUND/iu.test(allText)
        ? "İADE"
        : null;
  if (
    type &&
    !(
      /(?:fast)?satis/u.test(normalizedText) &&
      /iptal|void|iade|refund/u.test(normalizedText)
    )
  )
    fields.push({ label: "İşlem Türü", value: type });
  const masked = /(?:[*xX•]{2,}\s*\d{2,4})/u.exec(allText);
  if (masked) fields.push({ label: "Maskeli Kart", value: masked[0] });
  return parsePosSlipFields(fields);
}
export function posSlipAmountMismatch(
  ocrAmountMinor: number | null,
  confirmedAmountMinor: number
) {
  return ocrAmountMinor !== null && ocrAmountMinor !== confirmedAmountMinor;
}
export function validatePosSlipConfirmation(
  values: PosSlipValues
): asserts values is PosSlipValues & {
  transactionAt: string;
  amountMinor: number;
  terminal: string;
  reference: string;
  transactionType: PosSlipTransactionType;
  settlementKind: PosSlipSettlementKind;
} {
  if (
    !values.transactionAt ||
    values.amountMinor === null ||
    values.amountMinor < 1 ||
    !values.terminal ||
    !values.reference ||
    !values.transactionType ||
    !values.settlementKind
  )
    fail(
      "POS_SLIP_CONFIRMATION_INCOMPLETE",
      "Tarih/saat, tutar, terminal, referans, beyan ve işlem türü gereklidir.",
      409
    );
  if (!normalizePosSlipDateTime(values.transactionAt.replace(/\+03:00$/, "")))
    fail("POS_SLIP_DATETIME_INVALID", "Slip tarihi/saat biçimi geçersiz.");
  checkSensitive(values.reference);
  checkSensitive(values.terminal);
  checkSensitive(values.bank ?? "");
  if (
    values.maskedCard &&
    !/^(?:[*xX•]{2,}\s*){1,4}\d{2,4}$/u.test(values.maskedCard)
  )
    fail(
      "POS_SLIP_SENSITIVE_DATA",
      "Kart alanı yalnız güvenli maskeli biçimde tutulabilir.",
      422
    );
}
function imageInput(body: Record<string, unknown>) {
  if (
    !requireBoolean(body.sensitiveDataChecked, "Kart bilgisi maskeleme teyidi")
  )
    fail(
      "POS_SLIP_PRIVACY_REQUIRED",
      "Kart numarası/CVV görünmediğini veya fotoğrafta kapatıldığını teyit edin.",
      409
    );
  const mime = requireString(body.mime, "Görsel türü", { max: 32 });
  if (!(["image/jpeg", "image/png"] as string[]).includes(mime))
    fail("POS_SLIP_IMAGE_TYPE", "Yalnız JPEG/PNG desteklenir.");
  const encoded = requireString(body.imageBase64, "Görsel", { max: 7_000_000 });
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(encoded))
    fail("POS_SLIP_IMAGE_INVALID", "Görsel verisi geçersiz.");
  const bytes = Buffer.from(encoded, "base64");
  if (
    bytes.length < 4 ||
    bytes.length > 5 * 1024 * 1024 ||
    bytes.toString("base64") !== encoded
  )
    fail("POS_SLIP_IMAGE_LIMIT", "Görsel 5 MB sınırında JPEG/PNG olmalıdır.");
  const valid =
    mime === "image/jpeg"
      ? bytes[0] === 0xff &&
        bytes[1] === 0xd8 &&
        bytes.at(-2) === 0xff &&
        bytes.at(-1) === 0xd9
      : bytes
          .subarray(0, 8)
          .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  if (!valid)
    fail(
      "POS_SLIP_IMAGE_INVALID",
      "Dosya uzantısı ile gerçek görsel türü uyuşmuyor."
    );
  return {
    mime,
    bytes,
    hash: createHash("sha256").update(bytes).digest("hex"),
  };
}

export async function importPosSlipDraft(
  c: PoolConnection,
  scope: Scope,
  account: Row,
  actorId: number,
  body: Record<string, unknown>
) {
  const image = imageInput(body);
  const { recognizeImage } = await import("./windows-ocr");
  const preflight = await recognizeImage(image.bytes);
  const text = Array.isArray(preflight?.lines)
    ? preflight.lines
        .map((line: any) =>
          (line.words ?? [])
            .map((word: any) => String(word.text ?? ""))
            .join(" ")
        )
        .join("\n")
    : "";
  checkPosSlipImagePrivacy(text);
  const duplicate = await first<Row>(
    c,
    "SELECT id,review_status FROM st_pos_slip_drafts WHERE station_id=? AND source_sha256=? FOR UPDATE",
    [scope.stationId, image.hash]
  );
  if (duplicate)
    return {
      id: duplicate.id,
      duplicate: true,
      status: duplicate.review_status,
    };
  const id = randomUUID();
  await execute(
    c,
    "INSERT INTO st_pos_slip_drafts (id,tenant_id,station_id,shift_id,account_id,staff_user_id,source_sha256,mime_type,byte_size,image_bytes,created_by) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
    [
      id,
      scope.tenantId,
      scope.stationId,
      account.shift_id,
      account.id,
      actorId,
      image.hash,
      image.mime,
      image.bytes.length,
      image.bytes,
      actorId,
    ]
  );
  return { id, duplicate: false, status: "DRAFT" };
}

export async function readPosSlipDraft(
  c: PoolConnection,
  scope: Scope,
  draftId: unknown,
  accountId: string,
  actorId: number,
  provider: unknown,
  externalConfirmed: unknown
) {
  const id = requireId(draftId, "draftId");
  const draft = await first<Row>(
    c,
    "SELECT * FROM st_pos_slip_drafts WHERE id=? AND tenant_id=? AND station_id=? AND account_id=? AND staff_user_id=? FOR UPDATE",
    [id, scope.tenantId, scope.stationId, accountId, actorId]
  );
  if (!draft) fail("POS_SLIP_NOT_FOUND", "Slip taslağı bulunamadı.", 404);
  if (draft.review_status !== "DRAFT")
    fail("POS_SLIP_LOCKED", "Slip taslağı artık değiştirilemez.", 409);
  const mode =
    provider === "GEMINI"
      ? "GEMINI"
      : provider === "LOCAL"
        ? "LOCAL"
        : "MANUAL";
  let parsed: PosSlipParse | null = null,
    fallback = false;
  if (mode === "GEMINI") {
    const tenant = await first<Row>(
      c,
      "SELECT is_demo FROM st_tenants WHERE id=?",
      [scope.tenantId]
    );
    if (
      !Number(tenant?.is_demo) ||
      process.env.STATIONOS_DEMO_ONLY === "istasyonos_demo" ||
      !requireBoolean(externalConfirmed, "Google görsel gönderimi")
    )
      fail(
        "POS_SLIP_EXTERNAL_FORBIDDEN",
        "Harici OCR yalnız izinli DEMO belgelerinde, açık teyitle ve bağlantı kilidi kapalıyken kullanılabilir.",
        403
      );
    try {
      const { extractGeminiDocument } = await import("./gemini-ocr");
      const result = await extractGeminiDocument(
        [{ mime: draft.mime_type, bytes: draft.image_bytes }],
        "POS_SLIP"
      );
      parsed = parsePosSlipFields(result.raw.fields);
    } catch (error) {
      if (
        error instanceof Error &&
        "code" in error &&
        String(error.code) === "POS_SLIP_SENSITIVE_DATA"
      )
        throw error;
      fallback = true;
    }
  }
  if (!parsed && (mode === "LOCAL" || fallback)) {
    const { recognizeImage } = await import("./windows-ocr");
    const native = await recognizeImage(draft.image_bytes);
    const lines = Array.isArray(native?.lines)
      ? native.lines
          .map((line: any) =>
            (line.words ?? [])
              .map((word: any) => String(word.text ?? ""))
              .join(" ")
          )
          .join("\n")
      : "";
    checkPosSlipImagePrivacy(lines);
    parsed = parsePosSlipText(lines);
  }
  const value = parsed ?? {
    values: null,
    source: null,
    warnings: ["Alanları elle girin."],
    reviewRequired: true,
  };
  await execute(
    c,
    "UPDATE st_pos_slip_drafts SET ocr_provider=?,ocr_json=?,values_json=?,revision=revision+1 WHERE id=? AND review_status='DRAFT'",
    [
      mode === "GEMINI" && !fallback
        ? "GEMINI"
        : mode === "MANUAL"
          ? "MANUAL"
          : "LOCAL",
      JSON.stringify(value),
      value.values ? JSON.stringify(value.values) : null,
      id,
    ]
  );
  return {
    id,
    fallback,
    draft: value,
    message: fallback
      ? "Gemini kullanılamadı; yerel OCR önerileri getirildi."
      : undefined,
  };
}

export async function confirmPosSlipDraft(
  c: PoolConnection,
  scope: Scope,
  actorId: number,
  body: Record<string, unknown>,
  account: Row
) {
  const id = requireId(body.draftId, "draftId"),
    revision = requireInteger(body.draftRevision, "draftRevision");
  const draft = await first<Row>(
    c,
    "SELECT * FROM st_pos_slip_drafts WHERE id=? AND tenant_id=? AND station_id=? AND account_id=? FOR UPDATE",
    [id, scope.tenantId, scope.stationId, account.id]
  );
  if (!draft)
    fail("POS_SLIP_NOT_FOUND", "Slip taslağı bu hesapta bulunamadı.", 404);
  if (draft.review_status !== "DRAFT" || Number(draft.revision) !== revision)
    fail(
      "POS_SLIP_REVISION",
      "Slip taslağı değişmiş; yenileyip tekrar kontrol edin.",
      409
    );
  const ocr: Partial<PosSlipValues> = draft.values_json
    ? (JSON.parse(draft.values_json) as PosSlipValues)
    : {};
  const ocrResult = draft.ocr_json
    ? (JSON.parse(draft.ocr_json) as {
        source?: PosSlipSourceFields;
        linkedPaymentId?: string;
      })
    : {};
  const ocrSource = ocrResult.source;
  const values: PosSlipValues = {
    transactionAt:
      body.transactionAt == null
        ? (ocr.transactionAt ?? null)
        : String(body.transactionAt),
    amountMinor:
      body.amountMinor == null
        ? (ocr.amountMinor ?? null)
        : requireMoney(body.amountMinor, "amountMinor"),
    bank:
      body.bank == null
        ? (ocr.bank ?? null)
        : requireString(body.bank, "bank", { max: 100 }),
    terminal:
      body.terminal == null
        ? (ocr.terminal ?? null)
        : requireString(body.terminal, "terminal", { max: 190 }),
    reference:
      body.reference == null
        ? (ocr.reference ?? null)
        : requireString(body.reference, "reference", { max: 190 }),
    transactionType:
      body.transactionType == null
        ? (ocr.transactionType ?? null)
        : requireEnum(body.transactionType, "transactionType", [
            "SALE",
            "VOID",
            "REFUND",
          ] as const),
    settlementKind:
      body.settlementKind == null
        ? (ocr.settlementKind ?? null)
        : requireEnum(body.settlementKind, "settlementKind", [
            "CARD_SLIP",
            "FAST",
          ] as const),
    maskedCard:
      body.maskedCard == null
        ? (ocr.maskedCard ?? null)
        : String(body.maskedCard),
  };
  const refFingerprint = values.reference
    ? values.reference === ocr.reference && ocrSource?.referenceFingerprint
      ? ocrSource.referenceFingerprint
      : referenceFingerprint(values.reference)
    : null;
  const termFingerprint = values.terminal
    ? values.terminal === ocr.terminal && ocrSource?.terminalFingerprint
      ? ocrSource.terminalFingerprint
      : terminalFingerprint(values.terminal)
    : null;
  const safeValues: PosSlipValues = {
    ...values,
    terminal: values.terminal
      ? isMaskedReference(values.terminal)
        ? values.terminal
        : maskedTerminal(values.terminal)
      : null,
    reference: values.reference
      ? isMaskedReference(values.reference)
        ? values.reference
        : maskedReference(values.reference)
      : null,
  };
  const transactionAt = values.transactionAt
    ? safeDate(values.transactionAt, "transactionAt")
    : null;
  validatePosSlipConfirmation(safeValues);
  checkSensitive(safeValues.bank ?? "", "bank");
  requireBoolean(body.staffConfirmed, "personel doğrulaması");
  const expected = ocr.amountMinor ?? null;
  if (
    posSlipAmountMismatch(expected, safeValues.amountMinor!) &&
    !requireBoolean(body.amountOverrideConfirmed, "OCR tutar farkı teyidi")
  )
    fail(
      "POS_SLIP_AMOUNT_REVIEW",
      "Personel tutarı OCR sonucundan farklı; farkı açıkça teyit edin.",
      409
    );
  const transactionKey = posSlipTransactionKey(
    safeValues,
    refFingerprint,
    termFingerprint
  );
  if (!transactionKey)
    fail(
      "POS_SLIP_CONFIRMATION_INCOMPLETE",
      "Mükerrerlik kontrolü için terminal, referans ve tarih gerekli.",
      409
    );
  const existingDraft = await first<Row>(
    c,
    "SELECT id FROM st_pos_slip_drafts WHERE station_id=? AND transaction_key=? AND id<>? LIMIT 1 FOR UPDATE",
    [scope.stationId, transactionKey, id]
  );
  if (existingDraft)
    fail(
      "POS_SLIP_DUPLICATE",
      "Bu terminal/referans/tarih işlemi başka bir slip taslağında bulunuyor.",
      409
    );
  if (safeValues.transactionType === "SALE") {
    if (safeValues.settlementKind === "FAST") {
      const paymentId = randomUUID();
      await execute(
        c,
        "INSERT INTO st_payments (id,tenant_id,station_id,account_id,debtor_id,kind,amount_minor,reference,created_by_user_id) VALUES (?,?,?,?,NULL,'FAST',?,?,?)",
        [
          paymentId,
          scope.tenantId,
          scope.stationId,
          account.id,
          safeValues.amountMinor!,
          `OCR:${refFingerprint}:${safeValues.reference.slice(-4)}`,
          actorId,
        ]
      );
      const ocrJson = JSON.stringify({
        ...ocrResult,
        linkedPaymentId: paymentId,
        bankConfirmed: false,
      });
      await execute(
        c,
        "UPDATE st_pos_slip_drafts SET review_status='PAYMENT_CREATED',transaction_key=?,values_json=?,ocr_json=?,revision=revision+1,confirmed_by=?,confirmed_at=CURRENT_TIMESTAMP(3) WHERE id=?",
        [transactionKey, JSON.stringify(safeValues), ocrJson, actorId, id]
      );
      await execute(
        c,
        "UPDATE st_accounts SET revision=revision+1 WHERE id=?",
        [account.id]
      );
      return {
        id,
        status: "PAYMENT_CREATED",
        paymentId,
        declarationKind: "FAST",
        bankConfirmed: false,
        amountReview: posSlipAmountMismatch(expected, safeValues.amountMinor!),
      };
    }
    safeAdd(Number(account.card_total_minor ?? 0), safeValues.amountMinor!);
    const terminalToken = `OCR:${termFingerprint}:${safeValues.terminal.slice(-4)}`;
    const referenceToken = `OCR:${refFingerprint}:${safeValues.reference.slice(-4)}`;
    const duplicate = await first<Row>(
      c,
      "SELECT id FROM st_slips WHERE station_id=? AND terminal_id=? AND reference=? AND transaction_at=? LIMIT 1 FOR UPDATE",
      [
        scope.stationId,
        terminalToken,
        referenceToken,
        mysqlDate(transactionAt!),
      ]
    );
    if (duplicate)
      fail(
        "POS_SLIP_DUPLICATE",
        "Aynı terminal/referans/tarih ile slip zaten kaydedilmiş.",
        409
      );
    const slipId = randomUUID();
    await execute(
      c,
      "INSERT INTO st_slips (id,tenant_id,station_id,account_id,amount_minor,reference,terminal_id,transaction_at,note,created_by_user_id) VALUES (?,?,?,?,?,?,?,?,?,?)",
      [
        slipId,
        scope.tenantId,
        scope.stationId,
        account.id,
        safeValues.amountMinor!,
        referenceToken,
        terminalToken,
        mysqlDate(transactionAt!),
        `POS OCR onaylı · ${safeValues.bank ?? "Banka belirsiz"}`,
        actorId,
      ]
    );
    await execute(
      c,
      "UPDATE st_pos_slip_drafts SET review_status='PAYMENT_CREATED',confirmed_slip_id=?,transaction_key=?,values_json=?,revision=revision+1,confirmed_by=?,confirmed_at=CURRENT_TIMESTAMP(3) WHERE id=?",
      [slipId, transactionKey, JSON.stringify(safeValues), actorId, id]
    );
    await execute(c, "UPDATE st_accounts SET revision=revision+1 WHERE id=?", [
      account.id,
    ]);
    return {
      id,
      status: "PAYMENT_CREATED",
      slipId,
      declarationKind: "CARD_SLIP",
      bankConfirmed: false,
      amountReview: posSlipAmountMismatch(expected, safeValues.amountMinor!),
    };
  }
  if (!["VOID", "REFUND"].includes(safeValues.transactionType))
    fail(
      "POS_SLIP_NON_SALE_REVIEW",
      "İptal/iade dışı bu işlem satış olarak kaydedilemez.",
      409
    );
  await execute(
    c,
    "UPDATE st_pos_slip_drafts SET review_status='NON_SALE_REVIEWED',transaction_key=?,values_json=?,confirmed_by=?,confirmed_at=CURRENT_TIMESTAMP(3),revision=revision+1 WHERE id=?",
    [transactionKey, JSON.stringify(safeValues), actorId, id]
  );
  return {
    id,
    status: "NON_SALE_REVIEWED",
    slipId: null,
    amountReview: posSlipAmountMismatch(expected, safeValues.amountMinor),
  };
}

export async function posSlipDrafts(
  c: PoolConnection,
  scope: Scope,
  actorId: number,
  role: string,
  accountId?: string
) {
  if (!posSlipAccessAllowed(role, true))
    fail("ROLE_FORBIDDEN", "Slip inceleme yetkiniz yok.", 403);
  const own = role === "FUEL_STAFF";
  const params = own
    ? [scope.tenantId, scope.stationId, actorId]
    : [scope.tenantId, scope.stationId];
  const list = await rows<Row[]>(
    c,
    `SELECT d.id,d.account_id AS accountId,d.shift_id AS shiftId,d.staff_user_id AS staffUserId,u.name AS staffName,d.source_sha256 AS sourceHash,d.mime_type AS mimeType,d.ocr_provider AS provider,d.ocr_json AS ocrJson,d.values_json AS valuesJson,d.review_status AS status,d.revision,d.created_at AS createdAt FROM st_pos_slip_drafts d JOIN users u ON u.id=d.staff_user_id WHERE d.tenant_id=? AND d.station_id=?${own ? " AND d.staff_user_id=?" : ""} ORDER BY d.created_at DESC LIMIT 100`,
    params
  );
  const filtered = accountId
    ? list.filter(x => String(x.accountId) === accountId)
    : list;
  return filtered.map(row => {
    const ocr = row.ocrJson
      ? (JSON.parse(row.ocrJson) as {
          source?: Record<string, unknown>;
          [key: string]: unknown;
        })
      : null;
    if (ocr?.source) {
      const {
        referenceFingerprint: _referenceFingerprint,
        terminalFingerprint: _terminalFingerprint,
        ...displaySource
      } = ocr.source;
      ocr.source = displaySource;
    }
    return {
      ...row,
      sourceHash: undefined,
      ocr,
      values: row.valuesJson ? JSON.parse(row.valuesJson) : null,
      ocrJson: undefined,
      valuesJson: undefined,
    };
  });
}
export async function posSlipDraftImage(
  c: PoolConnection,
  scope: Scope,
  id: unknown,
  actorId: number,
  role: string
) {
  const draftId = requireId(id, "draftId"),
    own = role === "FUEL_STAFF";
  if (!posSlipAccessAllowed(role, true))
    fail("ROLE_FORBIDDEN", "Slip görseli erişim yetkiniz yok.", 403);
  const row = await first<Row>(
    c,
    `SELECT mime_type,image_bytes,staff_user_id FROM st_pos_slip_drafts WHERE id=? AND tenant_id=? AND station_id=?${own ? " AND staff_user_id=?" : ""}`,
    own
      ? [draftId, scope.tenantId, scope.stationId, actorId]
      : [draftId, scope.tenantId, scope.stationId]
  );
  if (!row) fail("POS_SLIP_NOT_FOUND", "Slip görseli bulunamadı.", 404);
  return { mime: row.mime_type, bytes: row.image_bytes };
}

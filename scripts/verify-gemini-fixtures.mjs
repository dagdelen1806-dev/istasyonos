// Standalone live Gemini OCR fixture comparison; no application server or DB imports.
// To run on Windows: node --env-file=.env scripts/verify-gemini-fixtures.mjs
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parse } from "dotenv";
import { build } from "esbuild";

const env = parse(await readFile(".env"));
const key = env.GEMINI_API_KEY?.trim() || process.env.GEMINI_API_KEY?.trim();
if (!key) {
  console.log(JSON.stringify({ ok: false, code: "GEMINI_KEY_MISSING" }));
  process.exit(2);
}
process.env.GEMINI_API_KEY = key;
process.env.GEMINI_OCR_MODEL = process.env.GEMINI_OCR_MODEL?.trim()
  || env.GEMINI_OCR_MODEL?.trim() || "gemini-3.5-flash-lite";
if (process.env.GEMINI_OCR_MODEL !== "gemini-3.5-flash-lite") {
  console.log(JSON.stringify({ ok: false, code: "UNEXPECTED_MODEL" }));
  process.exit(2);
}

// Bundle both modules without importing the server, database, or its startup.
const outdir = ".local/tanker-document/tools";
await Promise.all([
  build({
    entryPoints: ["server/stationos/gemini-ocr.ts"],
    bundle: true, platform: "node", packages: "external", format: "esm",
    outfile: `${outdir}/gemini-fixtures.js`,
  }),
  build({
    entryPoints: ["server/stationos/ocr-normalize.ts"],
    bundle: true, platform: "node", packages: "external", format: "esm",
    outfile: `${outdir}/ocr-fixtures-normalize.js`,
  }),
]);
const [gemini, normalize] = await Promise.all([
  import(pathToFileURL(resolve(`${outdir}/gemini-fixtures.js`)).href),
  import(pathToFileURL(resolve(`${outdir}/ocr-fixtures-normalize.js`)).href),
]);
const { extractGeminiDocument } = gemini;
const { compareOcrValue, parseOcrDecimal, parseTurkishTankLitres, extractInvoiceMoneyFields, invoiceArithmetic } = normalize;
const fixture = JSON.parse(await readFile("scripts/fixtures/gemini-ocr-expected.json", "utf8"));
const textLabel = (fields, pattern) => fields.find(field => pattern.test(
  String(field.label ?? "").normalize("NFC").toLocaleLowerCase("tr-TR")
))?.value ?? null;

const output = [];
for (const doc of fixture.documents) {
  try {
    const image = await readFile(doc.file);
    const result = await extractGeminiDocument([{ mime: "image/png", bytes: image }], doc.kind);
    const raw = result.raw;
    const line = raw.lines?.[0];
    const fields = raw.fields ?? [];
    let actual = {};
    let invoiceValidation;
    let tankVolumeSources;
    if (doc.kind === "TANKER") {
      actual = {
        documentNo: raw.documentNo,
        date: raw.documentDate,
        product: line?.label ?? null,
        netLitres: parseOcrDecimal(line?.netText),
        dispatchLitres: parseOcrDecimal(line?.dispatchText),
      };
    } else if (doc.kind === "INVOICE") {
      const invoice = extractInvoiceMoneyFields(fields);
      actual = {
        documentNo: raw.documentNo,
        date: raw.documentDate,
        product: textLabel(fields, /ürün|mal\s*\/\s*hizmet|açıklama|tanım/),
        quantityLitres: parseOcrDecimal(textLabel(fields, /miktar|quantity/)),
        unitPriceTry: textLabel(fields, /birim\s*fiyat/),
        ...invoice.values,
      };
      const { subtotalTry, vatTry, totalTry } = invoice.values;
      invoiceValidation = {
        ...invoiceArithmetic(subtotalTry, vatTry, totalTry),
        ambiguousFields: invoice.ambiguousFields,
      };
      if (invoice.ambiguousFields.length > 0) invoiceValidation.status = "NEEDS_USER_REVIEW";
    } else if (doc.kind === "TANK") {
      // This synthetic tank fixture declares Turkish-formatted values in L.
      // Keep the OCR source and interpretation; do not rescale numeric inputs.
      // Real tank/stock posting must still use its own user review workflow.
      tankVolumeSources = {
        capacityLitres: parseTurkishTankLitres(textLabel(fields, /kapasite/)),
        productVolumeLitres: parseTurkishTankLitres(textLabel(fields, /ürün hacmi|product volume/)),
        netVolumeLitres: parseTurkishTankLitres(textLabel(fields, /net hacim|net volume/)),
      };
      actual = {
        tankNumber: textLabel(fields, /tank no|tank numarası|tank number/),
        fuel: textLabel(fields, /yakıt türü|yakıt|fuel/),
        capacityLitres: tankVolumeSources.capacityLitres.value,
        productVolumeLitres: tankVolumeSources.productVolumeLitres.value,
        netVolumeLitres: tankVolumeSources.netVolumeLitres.value,
      };
    }
    const checks = Object.entries(doc.expected).map(([field, expected]) => {
      const got = actual[field] ?? null;
      const status = compareOcrValue(expected, got, field);
      return {
        field, status, expected, actual: got,
        ...(field === "date" ? { normalizedActual: normalize.normalizeOcrDate(got).value } : {}),
        ...(tankVolumeSources?.[field] ? { ocrSource: tankVolumeSources[field].original,
          interpretation: tankVolumeSources[field].interpretation } : {}),
      };
    });
    const ok = checks.every(c => c.status === "CORRECT") &&
      (!invoiceValidation || invoiceValidation.status === "CONSISTENT");
    output.push({ document: doc.kind, ok, checks, ...(invoiceValidation ? { invoiceValidation } : {}) });
  } catch (error) {
    const code = typeof error?.code === "string" && error.code.startsWith("GEMINI_")
      ? error.code : "OCR_FAILED";
    output.push({
      document: doc.kind, ok: false, error: code,
      checks: Object.keys(doc.expected).map(field => ({ field, status: "MISSING" })),
    });
  }
}
const total = output.reduce((n, doc) => n + doc.checks.length, 0);
const correct = output.reduce((n, doc) => n + doc.checks.filter(c => c.status === "CORRECT").length, 0);
const report = {
  ok: output.every(doc => doc.ok),
  model: process.env.GEMINI_OCR_MODEL,
  demoOnly: true,
  databaseAccess: false,
  fieldAccuracy: { correct, total, ratio: total ? correct / total : 0 },
  documents: output,
};
await mkdir(".local/demo", { recursive: true });
await writeFile(".local/demo/gemini-fixture-results.json", JSON.stringify(report, null, 2));
console.log(JSON.stringify(report));
if (!report.ok) process.exitCode = 1;

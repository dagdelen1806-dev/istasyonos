// Offline regression: no dotenv, no Gemini API, and no database.
// Node 24+ strips TypeScript types when importing the pure normalization module.
import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import {
  compareOcrValue,
  extractInvoiceMoneyFields,
  invoiceArithmetic,
  normalizeOcrDate,
  parseTurkishTankLitres,
} from "../server/stationos/ocr-normalize.ts";

const fixture = JSON.parse(await readFile(new URL("./fixtures/gemini-ocr-expected.json", import.meta.url), "utf8"));
const invoiceExpected = fixture.documents.find(doc => doc.kind === "INVOICE").expected;

test("Turkish and ISO dates compare without losing OCR source", () => {
  assert.deepEqual(normalizeOcrDate("05.11.2026"), {
    value: "2026-11-05", original: "05.11.2026",
  });
  assert.equal(compareOcrValue("2026-11-05", "05.11.2026", "date"), "CORRECT");
  assert.equal(compareOcrValue(invoiceExpected.date, "07.11.2026", "date"), "CORRECT");
  assert.equal(normalizeOcrDate("31.02.2026").value, null);
});

test("Subtotal never masquerades as invoice total", () => {
  const selected = extractInvoiceMoneyFields([
    { label: "Ara Toplam", value: "5.672,60" },
    { label: "KDV", value: "1.134,52" },
  ]);
  assert.equal(selected.values.totalTry, null);
  assert.equal(invoiceArithmetic(
    selected.values.subtotalTry, selected.values.vatTry, selected.values.totalTry,
  ).status, "NEEDS_USER_REVIEW");
});

test("Previously misread invoice total is still WRONG and requires review", () => {
  const selected = extractInvoiceMoneyFields([
    { label: "Ara Toplam", value: "5.672,60" },
    { label: "KDV", value: "1.134,52" },
    { label: "Genel Toplam", value: "5.672,60" },
  ]);
  assert.equal(compareOcrValue(invoiceExpected.totalTry, selected.values.totalTry, "totalTry"), "WRONG");
  assert.deepEqual(invoiceArithmetic(
    selected.values.subtotalTry, selected.values.vatTry, selected.values.totalTry,
  ), {
    status: "NEEDS_USER_REVIEW", subtotalMinor: 567260, vatMinor: 113452,
    ocrTotalMinor: 567260, calculatedTotalMinor: 680712,
  });
});

test("Explicit, consistent total passes without inference", () => {
  const selected = extractInvoiceMoneyFields([
    { label: "Ara Toplam", value: "5.672,60" },
    { label: "KDV", value: "1.134,52" },
    { label: "Genel Toplam", value: "6.807,12" },
  ]);
  assert.equal(compareOcrValue(invoiceExpected.totalTry, selected.values.totalTry, "totalTry"), "CORRECT");
  assert.equal(invoiceArithmetic(
    selected.values.subtotalTry, selected.values.vatTry, selected.values.totalTry,
  ).status, "CONSISTENT");
});

test("Conflicting labels and missing amounts cannot be auto-approved", () => {
  const selected = extractInvoiceMoneyFields([
    { label: "Genel Toplam", value: "6.807,12" },
    { label: "Ödenecek Tutar", value: "6.999,99" },
  ]);
  assert.equal(selected.values.totalTry, null);
  assert.deepEqual(selected.ambiguousFields, ["totalTry"]);
});


test("TR tank litre thousands grouping preserves source for all three fields", () => {
  const tankExpected = fixture.documents.find(doc => doc.kind === "TANK").expected;
  const examples = {
    capacityLitres: "30.000 L",
    productVolumeLitres: "23.990",
    netVolumeLitres: "23.879",
  };
  for (const [field, source] of Object.entries(examples)) {
    const parsed = parseTurkishTankLitres(source);
    assert.equal(parsed.interpretation, "TR_GROUPED_L");
    assert.equal(parsed.original, source);
    assert.equal(compareOcrValue(tankExpected[field], parsed.value, field), "CORRECT");
  }
});

test("Tank litres do not guess lost formatting or convert comma decimals", () => {
  const numeric = parseTurkishTankLitres(23.879);
  assert.deepEqual(numeric, { value: 23.879, original: "23.879", interpretation: "NUMERIC_AS_IS" });
  assert.equal(parseTurkishTankLitres("23,879 L").value, 23.879);
  assert.equal(parseTurkishTankLitres("23.879,5 L").value, 23879.5);
  assert.equal(parseTurkishTankLitres("-30.000 L").value, null);
  assert.equal(parseTurkishTankLitres("30.000 m³").value, null);
});

import { describe, it, expect } from "vitest";
import {
  normalizeOcrDate,
  parseOcrMoneyMinor,
  compareOcrValue,
  extractInvoiceMoneyFields,
  invoiceArithmetic,
  parseTurkishTankLitres,
} from "./ocr-normalize";

describe("OCR Turkish date normalization", () => {
  it.each([
    ["07.11.2026", "2026-11-07"],
    ["2026-11-07", "2026-11-07"],
    ["29.02.2024", "2024-02-29"],
  ])("normalizes %s and preserves source", (raw, normalized) => {
    expect(normalizeOcrDate(raw)).toEqual({ value: normalized, original: raw });
    expect(compareOcrValue(normalized, raw, "date")).toBe("CORRECT");
  });
  it.each(["31.02.2026", "29.02.2026", "32.01.2026", "7.11.2026", "n/a"])(
    "rejects invalid date %s", raw => expect(normalizeOcrDate(raw).value).toBeNull(),
  );
});

describe("invoice amounts are independent and exact in kuruş", () => {
  it("compares subtotal, VAT and total independently", () => {
    expect(compareOcrValue(5672.6, "5.672,60", "subtotalTry")).toBe("CORRECT");
    expect(compareOcrValue(1134.52, "1.134,52", "vatTry")).toBe("CORRECT");
    expect(compareOcrValue(6807.12, "6.807,12", "totalTry")).toBe("CORRECT");
  });
  it("HALF_UP money rounding works, including decimal float edge cases", () => {
    expect(parseOcrMoneyMinor("1,005")).toBe(101);
    expect(parseOcrMoneyMinor(1.005)).toBe(101);
    expect(parseOcrMoneyMinor("1.234,56 TL")).toBe(123456);
    expect(parseOcrMoneyMinor("not a price")).toBeNull();
  });
  it("does not match Ara Toplam when extracting Genel Toplam", () => {
    const { values } = extractInvoiceMoneyFields([
      { label: "Ara Toplam", value: "5.672,60" },
      { label: "KDV", value: "1.134,52" },
    ]);
    expect(values.totalTry).toBeNull();
    expect(invoiceArithmetic(values.subtotalTry, values.vatTry, values.totalTry).status)
      .toBe("NEEDS_USER_REVIEW");
  });
  it("independently reads an explicitly labeled Genel Toplam", () => {
    const { values, ambiguousFields } = extractInvoiceMoneyFields([
      { label: "Ara Toplam", value: "5.672,60" },
      { label: "KDV", value: "1.134,52" },
      { label: "Genel Toplam", value: "6.807,12" },
    ]);
    expect(ambiguousFields).toEqual([]);
    expect(values.totalTry).toBe("6.807,12");
    expect(invoiceArithmetic(values.subtotalTry, values.vatTry, values.totalTry).status)
      .toBe("CONSISTENT");
  });
  it("keeps misread or missing totals for review, never overwrites them", () => {
    const subtotal = "5.672,60", vat = "1.134,52", wrong = "5.672,60";
    expect(invoiceArithmetic(subtotal, vat, null)).toMatchObject({
      status: "NEEDS_USER_REVIEW", ocrTotalMinor: null, calculatedTotalMinor: 680712,
    });
    expect(invoiceArithmetic(subtotal, vat, wrong)).toMatchObject({
      status: "NEEDS_USER_REVIEW", ocrTotalMinor: 567260, calculatedTotalMinor: 680712,
    });
    expect(compareOcrValue(6807.12, wrong, "totalTry")).toBe("WRONG");
  });
  it("reports ambiguous duplicate general totals", () => {
    const selection = extractInvoiceMoneyFields([
      { label: "Genel Toplam", value: "6.807,12" },
      { label: "Ödenecek Tutar", value: "6.999,99" },
    ]);
    expect(selection.values.totalTry).toBeNull();
    expect(selection.ambiguousFields).toContain("totalTry");
  });
});


describe("Turkish tank litres are parsed without touching monetary fields", () => {
  it.each([
    ["30.000", 30000],
    ["23.990 L", 23990],
    ["23.879", 23879],
    ["23.879,5 L", 23879.5],
  ])("interprets declared TR grouped litres %s", (raw, litres) => {
    expect(parseTurkishTankLitres(raw).value).toBe(litres);
  });
  it("preserves numeric readings as supplied, without inventing thousands", () => {
    expect(parseTurkishTankLitres(23.879).value).toBe(23.879);
    expect(parseTurkishTankLitres("23,879 L").value).toBe(23.879);
    expect(parseTurkishTankLitres("23.879 m³").value).toBeNull();
  });
});

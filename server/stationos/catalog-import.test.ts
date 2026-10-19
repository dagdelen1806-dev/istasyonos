import { describe, it, expect } from "vitest";
import {
  parseCatalog,
  catalogHeaders,
  catalogSettings,
  catalogOpening,
} from "../../shared/catalog-import";
const header = catalogHeaders.join("\t");
const row = (qty = "-2", barcode = "001234567890", unit = "ADET") =>
  [
    "ST001",
    "Örnek ürün",
    barcode,
    "Gıda",
    qty,
    unit,
    "50,00",
    "20,40",
    "0",
  ].join("\t");
describe("catalog source parsing", () => {
  it("preserves a leading zero barcode and source deficit without posting cost", () => {
    expect(parseCatalog(header + "\n" + row())).toEqual([
      {
        line: 2,
        code: "ST001",
        name: "Örnek ürün",
        barcode: "001234567890",
        category: "Gıda",
        unit: "adet",
        sourceQuantity: -2,
        salePriceMinor: 5000,
        sourcePurchaseMinor: 2040,
        discountBps: 0,
      },
    ]);
  });
  it("accepts Unicode BOM, CRLF and quoted TSV cells", () => {
    const quoted = [
      "ST002",
      '"Adı ""özel"" ürün"',
      "8690000000001",
      "Gıda",
      "0",
      "ADET",
      "12,50",
      "0",
      "5,25",
    ].join("\t");
    expect(
      parseCatalog("\uFEFF" + header + "\r\n" + quoted + "\r\n")[0]
    ).toMatchObject({
      name: 'Adı "özel" ürün',
      discountBps: 525,
      salePriceMinor: 1250,
    });
  });
  it("rejects duplicates, noninteger quantities, unsupported units and malformed columns", () => {
    for (const text of [
      header + "\n" + row() + "\n" + row(),
      header + "\n" + row("-1,5"),
      header + "\n" + row("1", "0123456789", "KG"),
      header + "\n" + row() + "\textra",
      header + "\n" + row().replace("20,40", "-20,40"),
    ])
      expect(() => parseCatalog(text)).toThrow();
  });
  it("does not silently accept a different header, scientific notation or open quote", () => {
    for (const text of [
      header.replace("Stok Kodu", "Kod") + "\n" + row(),
      header + "\n" + row("1e3"),
      header + '\n"open',
    ])
      expect(() => parseCatalog(text)).toThrow();
  });
});

describe("catalog opening plan", () => {
  it("turns a deficit into absolute DEMO quantity with exact net value and explicit VAT", () => {
    const source = parseCatalog(header + "\n" + row())[0];
    const settings = catalogSettings({
      mode: "DEMO_OPENING_ABS",
      vatByGroup: { Gıda: 100 },
    });
    expect(catalogOpening(source, settings)).toEqual({
      plannedQty: 2,
      plannedValueMinor: 4080,
      vatBps: 100,
    });
    expect(source.sourceQuantity).toBe(-2);
    expect(catalogOpening(source, catalogSettings(undefined))).toEqual({
      plannedQty: 0,
      plannedValueMinor: 0,
      vatBps: null,
    });
  });
  it("does not infer an unset group or use inherited object properties", () => {
    const source = parseCatalog(header + "\n" + row())[0];
    expect(
      catalogOpening(source, catalogSettings({ mode: "DEMO_OPENING_ABS" }))
        .vatBps
    ).toBeNull();
    expect(
      catalogOpening(
        { ...source, category: "constructor" },
        catalogSettings({ mode: "DEMO_OPENING_ABS" })
      ).vatBps
    ).toBeNull();
  });
  it("rejects unknown modes and unsupported or nonnumeric VAT rates", () => {
    for (const value of [
      null,
      [],
      { mode: "OPENING" },
      { mode: "DEMO_OPENING_ABS", vatByGroup: { Gıda: 800 } },
      { mode: "DEMO_OPENING_ABS", vatByGroup: { Gıda: "100" } },
      { mode: "DEMO_OPENING_ABS", vatByGroup: [] },
    ])
      expect(() => catalogSettings(value)).toThrow();
  });
  it("rejects unsafe quantity and net value without float multiplication", () => {
    const source = parseCatalog(header + "\n" + row())[0],
      settings = catalogSettings({ mode: "DEMO_OPENING_ABS" });
    expect(() =>
      catalogOpening({ ...source, sourceQuantity: -1000000001 }, settings)
    ).toThrow();
    expect(() =>
      catalogOpening(
        {
          ...source,
          sourceQuantity: 2,
          sourcePurchaseMinor: Number.MAX_SAFE_INTEGER,
        },
        settings
      )
    ).toThrow();
  });
});

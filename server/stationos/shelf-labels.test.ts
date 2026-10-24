import { describe, it, expect } from "vitest";
import { labelBarcode, labelPrice } from "../../shared/label-barcode";
import {
  shelfSnapshot,
  shelfHash,
  shelfChanges,
  shelfIssue,
} from "./shelf-label-domain";
const product = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "DEMO ürün",
  barcode: "001234567890",
  base_unit: "adet",
  shelf: "A-1",
  sale_price_minor: 1250,
  market_vat_bps: 1000,
  created_at: "2026-10-24 08:00:00.000",
  stock_qty: 12,
  purchase_price_minor: 700,
};
describe("shelf label encoding and snapshots", () => {
  it("uses reference Code 128 B and C checksums without losing leading zeroes", () => {
    expect(labelBarcode("AB").codes).toEqual([104, 33, 34, 102, 106]);
    expect(labelBarcode("0000").codes).toEqual([105, 0, 0, 2, 106]);
    expect(labelBarcode("12345").codes).toEqual([
      105, 12, 34, 100, 21, 54, 106,
    ]);
    expect(labelBarcode("AB").width).toBe(77);
  });
  it("keeps quiet zones and bounded module widths for the supported label size", () => {
    for (const value of [
      "00001234567890123456789012345678",
      "1234567890123456789012345678901",
      "ABCDEFGHIJKLMNOP",
    ]) {
      const b = labelBarcode(value);
      expect(b.width).toBeLessThanOrEqual(242);
      expect(b.bars[0].x).toBe(10);
      expect(b.bars.at(-1)!.x + b.bars.at(-1)!.width).toBe(b.width - 10);
      expect(
        b.bars.every(
          (r, i) =>
            r.width > 0 && (!i || r.x > b.bars[i - 1].x + b.bars[i - 1].width)
        )
      ).toBe(true);
    }
  });
  it("rejects unsupported controls, Unicode and oversized barcode labels", () => {
    for (const value of [
      "",
      "x".repeat(17),
      "1".repeat(33),
      "BARKOD\n",
      "ÜRÜN01",
    ])
      expect(() => labelBarcode(value)).toThrow();
  });
  it("formats exact cents even near the safe-integer limit", () => {
    expect(labelPrice(1250)).toBe("12,50 ₺");
    expect(labelPrice(0)).toBe("0,00 ₺");
    expect(labelPrice(Number.MAX_SAFE_INTEGER)).toBe("90.071.992.547.409,91 ₺");
    for (const value of [-1, 1.5, Number.MAX_SAFE_INTEGER + 1])
      expect(() => labelPrice(value)).toThrow();
  });
  it("does not dirty a shelf label for quantity, net-cost or supplier changes", () => {
    const a = shelfSnapshot(product),
      b = shelfSnapshot({
        ...product,
        stock_qty: 3,
        purchase_price_minor: 800,
        market_supplier_id: "other",
      });
    expect(shelfHash(a)).toBe(shelfHash(b));
    expect(shelfChanges(a, b)).toEqual([]);
  });
  it("detects product/retail/VAT changes and a price restored by a later event", () => {
    const a = shelfSnapshot(product, {
        id: "10",
        created_at: "2026-10-24 08:00:00.000",
      }),
      b = shelfSnapshot(
        { ...product, sale_price_minor: 1500, market_vat_bps: 2000 },
        { id: "11", created_at: "2026-10-24 09:00:00.000" }
      );
    expect(shelfHash(a)).not.toBe(shelfHash(b));
    expect(shelfChanges(b, a)).toContain("Fiyat");
    expect(shelfChanges(b, a)).toContain("KDV");
    const restored = shelfSnapshot(product, {
      id: "12",
      created_at: "2026-10-24 10:00:00.000",
    });
    expect(shelfHash(restored)).not.toBe(shelfHash(a));
  });
  it("requires a configured positive retail label price and explicit VAT", () => {
    expect(shelfIssue(shelfSnapshot(product))).toBeNull();
    expect(
      shelfIssue(shelfSnapshot({ ...product, market_vat_bps: null }))
    ).toContain("KDV");
    expect(
      shelfIssue(shelfSnapshot({ ...product, sale_price_minor: 0 }))
    ).toContain("Pozitif");
  });
});

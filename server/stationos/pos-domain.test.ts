import { afterEach, describe, expect, it, vi } from "vitest";
import { normalizePosLines, posLineTotal } from "./pos-domain";
import { newRequestId } from "../../client/src/lib/id";

const a = "11111111-1111-4111-8111-111111111111",
  b = "22222222-2222-4222-8222-222222222222";
afterEach(() => vi.unstubAllGlobals());
describe("Kasa sepeti", () => {
  it("tekrarlanan ürünleri birleştirir ve kilit sırasını sabitler", () => {
    expect(
      normalizePosLines([
        { productId: b, quantity: 1, expectedUnitPriceMinor: 1250 },
        { productId: a, quantity: 2, expectedUnitPriceMinor: 100 },
        { productId: b, quantity: 3, expectedUnitPriceMinor: 1250 },
      ])
    ).toEqual([
      { productId: a, quantity: 2, expectedUnitPriceMinor: 100 },
      { productId: b, quantity: 4, expectedUnitPriceMinor: 1250 },
    ]);
  });
  it("fiyat çelişkisi ve kesirli/negatif adetleri reddeder", () => {
    expect(() =>
      normalizePosLines([
        { productId: a, quantity: 1, expectedUnitPriceMinor: 100 },
        { productId: a, quantity: 1, expectedUnitPriceMinor: 101 },
      ])
    ).toThrow();
    for (const quantity of [0, -1, 0.5, 10001])
      expect(() =>
        normalizePosLines([
          { productId: a, quantity, expectedUnitPriceMinor: 100 },
        ])
      ).toThrow();
  });
  it("boş/aşırı büyük sepeti ve geçersiz ürün kimliğini reddeder", () => {
    expect(() => normalizePosLines([])).toThrow();
    expect(() =>
      normalizePosLines(
        Array(101).fill({
          productId: a,
          quantity: 1,
          expectedUnitPriceMinor: 100,
        })
      )
    ).toThrow();
    expect(() =>
      normalizePosLines([
        {
          productId: "other-station",
          quantity: 1,
          expectedUnitPriceMinor: 100,
        },
      ])
    ).toThrow();
  });
  it("birleştirilen adet sınırını da kontrol eder", () => {
    expect(() =>
      normalizePosLines([
        { productId: a, quantity: 6000, expectedUnitPriceMinor: 1 },
        { productId: a, quantity: 6000, expectedUnitPriceMinor: 1 },
      ])
    ).toThrow();
  });
  it("kuruş hesabında sayı taşmasını reddeder", () => {
    expect(posLineTotal(1250, 3)).toBe(3750);
    expect(() => posLineTotal(Number.MAX_SAFE_INTEGER, 2)).toThrow();
  });
  it("HTTP .test ortamında randomUUID yokken kriptografik UUID üretir", () => {
    let seed = 0;
    vi.stubGlobal("crypto", {
      getRandomValues: (bytes: Uint8Array) => {
        bytes.forEach((_, i) => (bytes[i] = ++seed));
        return bytes;
      },
    });
    const id = newRequestId();
    expect(id).toMatch(
      /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/
    );
    expect(newRequestId()).not.toBe(id);
  });
});

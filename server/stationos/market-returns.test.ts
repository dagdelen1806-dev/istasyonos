import { describe, expect, it } from "vitest";
import { returnAmounts } from "../../shared/market-return-math";

describe("Kaynak belgeye bağlı kısmi iadeler", () => {
  it("özgün brüt birim fiyatı, net tutarı ve KDV'yi tam tüketir", () => {
    const original = { quantity: 3, grossMinor: 30, netMinor: 25 };
    let returned = { quantity: 0, grossMinor: 0, netMinor: 0 };
    const parts = [];
    for (let i = 0; i < 3; i++) {
      const part = returnAmounts(original, returned, 1);
      parts.push(part);
      returned = {
        quantity: i + 1,
        grossMinor: returned.grossMinor + part.grossMinor,
        netMinor: returned.netMinor + part.netMinor,
      };
    }
    expect(parts.map(p => p.grossMinor)).toEqual([10, 10, 10]);
    expect(parts.map(p => p.netMinor)).toEqual([8, 9, 8]);
    expect(returned).toEqual(original);
  });
  it("bir kuruşluk fiyat ve %100 KDV'de negatif vergi üretmez", () => {
    const original = { quantity: 2, grossMinor: 2, netMinor: 1 };
    const first = returnAmounts(
      original,
      { quantity: 0, grossMinor: 0, netMinor: 0 },
      1
    );
    expect(first).toEqual({ grossMinor: 1, netMinor: 1, vatMinor: 0 });
    expect(returnAmounts(original, { quantity: 1, ...first }, 1)).toEqual({
      grossMinor: 1,
      netMinor: 0,
      vatMinor: 1,
    });
  });
  it("küçük tutarlardaki tüm bölünmelerde kuruş ve KDV korunumunu sağlar", () => {
    for (let q = 1; q <= 9; q++)
      for (let gross = 0; gross <= 20; gross++)
        for (let net = 0; net <= gross; net++) {
          const original = { quantity: q, grossMinor: gross, netMinor: net };
          let returned = { quantity: 0, grossMinor: 0, netMinor: 0 };
          for (let i = 0; i < q; i++) {
            const part = returnAmounts(original, returned, 1);
            expect(part.netMinor).toBeGreaterThanOrEqual(0);
            expect(part.vatMinor).toBeGreaterThanOrEqual(0);
            returned = {
              quantity: i + 1,
              grossMinor: returned.grossMinor + part.grossMinor,
              netMinor: returned.netMinor + part.netMinor,
            };
          }
          expect(returned).toEqual(original);
        }
  });
  it("fazla iade, tutarsız eski dağılım ve güvenli olmayan sayıları reddeder", () => {
    const source = { quantity: 3, grossMinor: 30, netMinor: 25 };
    expect(() =>
      returnAmounts(source, { quantity: 2, grossMinor: 20, netMinor: 17 }, 2)
    ).toThrow();
    expect(() =>
      returnAmounts(source, { quantity: 1, grossMinor: 9, netMinor: 8 }, 1)
    ).toThrow();
    expect(() =>
      returnAmounts(source, { quantity: 0, grossMinor: 0, netMinor: 0 }, 1.5)
    ).toThrow();
    expect(() =>
      returnAmounts(
        { ...source, grossMinor: Number.MAX_SAFE_INTEGER + 1 },
        { quantity: 0, grossMinor: 0, netMinor: 0 },
        1
      )
    ).toThrow();
  });
});

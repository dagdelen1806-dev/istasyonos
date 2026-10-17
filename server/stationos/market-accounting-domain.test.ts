import { afterEach, describe, it, expect, vi } from "vitest";
import {
  balanced,
  businessToday,
  calendarDate,
  integer,
  netTax,
  plusDays,
  ratioRound,
  splitGross,
  stockCost,
} from "./market-accounting-domain";
afterEach(() => vi.useRealTimers());
describe("Market maliyet ve KDV hesabı", () => {
  it("satır KDV dahil tutarı kuruş kaybetmeden ayırır", () => {
    expect(splitGross(1200, 2000)).toEqual({ net: 1000, vat: 200 });
    expect(splitGross(1010, 800)).toEqual({ net: 935, vat: 75 });
    expect(splitGross(1, 2000)).toEqual({ net: 1, vat: 0 });
    expect(splitGross(500, 0)).toEqual({ net: 500, vat: 0 });
  });
  it("satır alış vergisinde yarım kuruşu yukarı yuvarlar", () => {
    expect(netTax(1005, 1000)).toBe(101);
    expect(netTax(1001, 1000)).toBe(100);
  });
  it("ağırlıklı maliyetin son adedinde kalan kuruşu tüketir", () => {
    const first = stockCost(10, 3, 1),
      second = stockCost(10 - first, 2, 1),
      last = stockCost(10 - first - second, 1, 1);
    expect([first, second, last]).toEqual([3, 4, 3]);
    expect(first + second + last).toBe(10);
  });
  it("tamsayı sınırı yakınında ara çarpımda float kullanmaz", () => {
    expect(ratioRound(Number.MAX_SAFE_INTEGER, 10000, 12000)).toBe(
      7505999378950826
    );
    expect(() => integer(9007199254740992n)).toThrow();
  });
  it("aşırı stok düşümünü ve geçersiz vergi oranını reddeder", () => {
    expect(() => stockCost(100, 1, 2)).toThrow();
    expect(() => splitGross(100, 10001)).toThrow();
    expect(() => netTax(100, 0.5)).toThrow();
  });
});
describe("Dengeli fiş ve Türkiye iş günü", () => {
  it("borç/alacak toplamını ve tek yönlü satırları denetler", () => {
    expect(
      balanced([
        { account: "CASH_SAFE", debit: 120 },
        { account: "SALES", credit: 100 },
        { account: "OUTPUT_VAT", credit: 20 },
      ])
    ).toHaveLength(3);
    expect(() =>
      balanced([
        { account: "CASH_SAFE", debit: 100 },
        { account: "SALES", credit: 99 },
      ])
    ).toThrow();
    expect(() =>
      balanced([{ account: "CASH_SAFE", debit: 1, credit: 1 }])
    ).toThrow();
    expect(balanced([{ account: "CASH_SAFE", debit: 0 }])).toEqual([]);
  });
  it("UTC gün sınırını Türkiye gün sonu olarak kullanmaz", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-16T20:59:00Z"));
    expect(businessToday()).toBe("2026-10-16");
    vi.setSystemTime(new Date("2026-10-16T21:01:00Z"));
    expect(businessToday()).toBe("2026-10-17");
  });
  it("takvim dışı tarihleri reddeder ve vadeyi gün olarak ilerletir", () => {
    expect(() => calendarDate("2026-02-29")).toThrow();
    expect(() => calendarDate("2026-13-01")).toThrow();
    expect(calendarDate("2024-02-29")).toBe("2024-02-29");
    expect(plusDays("2026-10-17", 30)).toBe("2026-11-16");
  });
});

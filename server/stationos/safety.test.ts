import { describe, expect, it } from "vitest";
import { containsLikelyPan, recommendationQuantity, rejectCardData, safeAdd } from "./safety";

describe("Finans ve gizlilik korumaları", () => {
  it("tam kart numarasını bitişik veya boşluklu metinde reddeder", () => {
    expect(containsLikelyPan("4111111111111111")).toBe(true);
    expect(containsLikelyPan("Kart 4111 1111 1111 1111")).toBe(true);
    expect(() => rejectCardData("4111-1111-1111-1111")).toThrow();
  });
  it("maskeli son dört hane ve olağan işlem referansını PAN saymaz", () => {
    expect(containsLikelyPan("**** **** **** 1111")).toBe(false);
    expect(containsLikelyPan("RRN-123456789012")).toBe(false);
    expect(() => rejectCardData("RRN-123456789012", "TERM-03", "Slip tutarını kontrol ettim.")).not.toThrow();
  });
  it("toplamları kuruş olarak doğrular ve güvenli sayı taşmasını reddeder", () => {
    expect(safeAdd(10001, 999, 0)).toBe(11000);
    expect(safeAdd(10, -2)).toBe(8);
    expect(() => safeAdd(Number.MAX_SAFE_INTEGER, 1)).toThrow();
    expect(() => safeAdd(0.1, 1)).toThrow();
  });
  it("minimum eşik ile 12 günlük pilot hedefini beraber kullanır", () => {
    expect(recommendationQuantity(6, 10, 2)).toBe(18);
    expect(recommendationQuantity(6, 10, 0)).toBe(4);
    expect(recommendationQuantity(100, 10, 2)).toBe(0);
    expect(() => recommendationQuantity(2, 1, -1)).toThrow();
  });
});

import { describe, expect, it } from "vitest";
import { tankerDeliveryDifferences } from "../../shared/tanker-document";

describe("tanker physical receipt preview", () => {
  const line = { netMl: 9900, dispatchMl: 10000 };
  it("keeps opposite net and dispatch differences separate", () => {
    expect(tankerDeliveryDifferences(line, 9950, "DISPATCH")).toEqual({
      netDifferenceMl: 50,
      dispatchDifferenceMl: -50,
      selectedDifferenceMl: -50,
    });
    expect(
      tankerDeliveryDifferences(line, 9950, "NET").selectedDifferenceMl
    ).toBe(50);
  });
  it("does not assume a basis or fill unknown source litres", () => {
    expect(
      tankerDeliveryDifferences(line, 9950, "").selectedDifferenceMl
    ).toBeNull();
    expect(
      tankerDeliveryDifferences({ netMl: null, dispatchMl: 10000 }, 9950, "NET")
        .selectedDifferenceMl
    ).toBeNull();
  });
  it("preserves exact equality and one millilitre shortage", () => {
    expect(
      tankerDeliveryDifferences(line, 10000, "DISPATCH").selectedDifferenceMl
    ).toBe(0);
    expect(
      tankerDeliveryDifferences(line, 9999, "DISPATCH").selectedDifferenceMl
    ).toBe(-1);
  });
  it.each([0, -1, 1.1, Number.NaN, Number.MAX_SAFE_INTEGER + 1])(
    "rejects invalid measured quantity %s",
    value => {
      expect(() => tankerDeliveryDifferences(line, value, "NET")).toThrow();
    }
  );
  it("rejects invalid source quantities", () => {
    expect(() =>
      tankerDeliveryDifferences({ netMl: -1, dispatchMl: 10000 }, 9950, "NET")
    ).toThrow();
  });
});

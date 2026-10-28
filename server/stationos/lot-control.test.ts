import { describe, it, expect } from "vitest";
import { lotRisk, lossItems } from "./lot-control-domain";
const p = "11111111-1111-4111-8111-111111111111",
  l = "22222222-2222-4222-8222-222222222222",
  l2 = "33333333-3333-4333-8333-333333333333";
describe("expiry control", () => {
  it("keeps today's expiry saleable but yesterday's blocked", () => {
    expect(lotRisk("2026-10-28", "2026-10-28", "AVAILABLE")).toMatchObject({
      daysLeft: 0,
      saleable: true,
      expired: false,
    });
    expect(lotRisk("2026-10-28", "2026-10-27", "AVAILABLE")).toMatchObject({
      saleable: false,
      expired: true,
    });
  });
  it("blocks future quarantine and unknown dates without guessing", () => {
    expect(lotRisk("2026-10-28", "2026-11-04", "QUARANTINE")).toMatchObject({
      daysLeft: 7,
      saleable: false,
      quarantine: true,
    });
    expect(lotRisk("2026-10-28", null, "AVAILABLE")).toMatchObject({
      saleable: false,
      unknown: true,
    });
  });
  it("retains overlapping expired/quarantine flags and validates dates", () => {
    expect(lotRisk("2026-10-28", "2026-10-27", "QUARANTINE")).toMatchObject({
      expired: true,
      quarantine: true,
    });
    expect(() => lotRisk("2026-10-28", "2026-02-30", "AVAILABLE")).toThrow();
    expect(() => lotRisk("2026-10-28", null, "bad")).toThrow();
  });
});
describe("recorded fire and count decoding", () => {
  const payload = {
    productId: p,
    lotId: l,
    before: 10,
    after: 9,
    valueMinor: 500,
  };
  it("uses immutable quantities/cost and marks old labels as absent", () => {
    expect(lossItems("LOT_WRITE_OFF", payload, 0, 500)[0]).toMatchObject({
      productId: p,
      before: 10,
      after: 9,
      delta: -1,
      lossMinor: 500,
      label: null,
      lots: [{ id: l, historical: false }],
    });
  });
  it("rejects treating a gain or no-op as a write-off", () => {
    expect(() =>
      lossItems("LOT_WRITE_OFF", { ...payload, after: 11 }, 500, 0)
    ).toThrow();
    expect(() =>
      lossItems("LOT_WRITE_OFF", { ...payload, after: 10, valueMinor: 0 }, 0, 0)
    ).toThrow();
  });
  it("separates positive and negative direct count money", () => {
    expect(
      lossItems(
        "LOT_COUNT",
        { ...payload, after: 12, valueMinor: 1200 },
        1200,
        0
      )[0].gainMinor
    ).toBe(1200);
    expect(lossItems("STOCK_ADJUST", payload, 0, 500)[0].lots).toHaveLength(0);
  });
  it("preserves zero-cost loss quantities and rejects bad monetary evidence", () => {
    expect(
      lossItems("LOT_WRITE_OFF", { ...payload, valueMinor: 0 }, 0, 0)[0].delta
    ).toBe(-1);
    for (const bad of [
      { ...payload, valueMinor: 501 },
      { ...payload, before: "10" },
      { ...payload, after: -1 },
      "bad",
    ])
      expect(() => lossItems("LOT_COUNT", bad, 0, 500)).toThrow();
  });
  it("validates whole terminal entry before splitting product rows", () => {
    const items = [
      { productId: p, before: 4, after: 3, delta: -1, valueMinor: 500 },
      { productId: l, before: 1, after: 2, delta: 1, valueMinor: 50 },
    ];
    expect(lossItems("STOCK_COUNT", { items }, 50, 500)).toHaveLength(2);
    expect(() => lossItems("STOCK_COUNT", { items }, 50, 499)).toThrow();
  });
  it("retains mixed per-lot gain/loss even at zero SKU delta", () => {
    const items = [
      {
        productId: p,
        before: 10,
        after: 10,
        delta: 0,
        gainMinor: 300,
        lossMinor: 200,
        lots: [
          {
            id: l,
            code: "A",
            status: "AVAILABLE",
            expiryDate: "2026-11-01",
            before: 3,
            after: 4,
          },
          {
            id: l2,
            code: "B",
            status: "QUARANTINE",
            expiryDate: null,
            before: 7,
            after: 6,
          },
        ],
      },
    ];
    const r = lossItems("STOCK_COUNT", { items }, 300, 200)[0];
    expect(r).toMatchObject({ delta: 0, gainMinor: 300, lossMinor: 200 });
    expect(r.lots.map(l => l.historical)).toEqual([true, true]);
  });
  it("accepts no-change terminal counts but rejects unsupported entry kinds", () => {
    expect(
      lossItems(
        "STOCK_COUNT",
        {
          items: [
            { productId: p, before: 1, after: 1, delta: 0, valueMinor: 0 },
          ],
        },
        0,
        0
      )[0].delta
    ).toBe(0);
    expect(() => lossItems("PURCHASE", payload, 0, 500)).toThrow();
  });
});

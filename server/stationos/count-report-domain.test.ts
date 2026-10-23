import { describe, it, expect } from "vitest";
import { countReportItems } from "./count-report-domain";
const id = "11111111-1111-4111-8111-111111111111",
  lot = "22222222-2222-4222-8222-222222222222";
const old = { productId: id, before: 5, after: 3, delta: -2, valueMinor: 250 };
describe("posted count report decoding", () => {
  it("uses historical count cost rather than needing current stock or cost", () => {
    const r = countReportItems(
      { items: [old] },
      { gainMinor: 0, lossMinor: 250 }
    );
    expect(r.items[0]).toMatchObject({
      before: 5,
      after: 3,
      delta: -2,
      lossMinor: 250,
      gainMinor: 0,
      label: null,
    });
    expect(r.version).toBe(0);
  });
  it("keeps mixed gain and loss for zero net product quantity", () => {
    const r = countReportItems(
      {
        countReportVersion: 1,
        items: [
          {
            ...old,
            productName: "DEMO süt",
            barcode: "001234567890",
            unit: "adet",
            before: 10,
            after: 10,
            delta: 0,
            gainMinor: 300,
            lossMinor: 200,
            lots: [
              {
                id: lot,
                code: "A",
                expiryDate: null,
                status: "QUARANTINE",
                before: 4,
                after: 2,
              },
              {
                id: "33333333-3333-4333-8333-333333333333",
                code: "B",
                expiryDate: "2026-12-01",
                status: "AVAILABLE",
                before: 4,
                after: 6,
              },
            ],
          },
        ],
      },
      { gainMinor: 300, lossMinor: 200 }
    );
    expect(r.items[0]).toMatchObject({
      delta: 0,
      gainMinor: 300,
      lossMinor: 200,
      netMinor: 100,
      label: { name: "DEMO süt", barcode: "001234567890" },
    });
  });
  it("retains zero-value gains and no-op counts with no journal lines", () => {
    for (const row of [
      { ...old, before: 0, after: 1, delta: 1, valueMinor: 0 },
      { ...old, before: 2, after: 2, delta: 0, valueMinor: 0 },
    ])
      expect(
        countReportItems({ items: [row] }, { gainMinor: 0, lossMinor: 0 })
          .items[0].netMinor
      ).toBe(0);
  });
  it("rejects mismatched ledger totals, duplicate source products and malformed snapshots", () => {
    for (const payload of [
      { items: [old, old] },
      { items: [{ ...old, delta: 7 }] },
      { items: [{ ...old, valueMinor: -1 }] },
      { countReportVersion: 1, items: [old] },
      { countReportVersion: 5, items: [old] },
      { items: [] },
      "{broken",
    ])
      expect(() =>
        countReportItems(payload, { gainMinor: 0, lossMinor: 250 })
      ).toThrow();
    expect(() =>
      countReportItems({ items: [old] }, { gainMinor: 0, lossMinor: 251 })
    ).toThrow();
  });
  it("does not infer a missing half of a mixed-cost snapshot or silently accept bad lot totals", () => {
    expect(() =>
      countReportItems(
        { items: [{ ...old, gainMinor: 10 }] },
        { gainMinor: 10, lossMinor: 250 }
      )
    ).toThrow();
    expect(() =>
      countReportItems(
        {
          items: [
            {
              ...old,
              lots: [
                {
                  id: lot,
                  code: "A",
                  expiryDate: null,
                  status: "QUARANTINE",
                  before: 1,
                  after: 0,
                },
              ],
            },
          ],
        },
        { gainMinor: 0, lossMinor: 250 }
      )
    ).toThrow();
  });
  it("rejects unsafe summed money instead of losing precision", () => {
    expect(() =>
      countReportItems(
        {
          items: [
            { ...old, valueMinor: Number.MAX_SAFE_INTEGER },
            { ...old, productId: lot, valueMinor: 1 },
          ],
        },
        { gainMinor: 0, lossMinor: Number.MAX_SAFE_INTEGER }
      )
    ).toThrow();
  });
});

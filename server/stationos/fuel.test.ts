import { beforeEach, describe, expect, it, vi } from "vitest";
import { calculateFuel, parseLitres } from "../../shared/fuel";
const memory = vi.hoisted(() => ({
  batch: null as any,
  previous: [] as any[],
  equipment: [] as any[],
  writes: [] as any[],
  busy: false,
  last: null as any,
  later: false,
}));
vi.mock("./db", () => ({
  rows: vi.fn(async (_c: unknown, sql: string) => {
    if (sql.includes("FROM st_fuel_nozzles")) return memory.equipment;
    if (sql.includes("MAX(q.sequence_no)")) return memory.previous;
    if (sql.includes("SELECT * FROM st_fuel_readings")) return memory.previous;
    if (sql.includes("FROM st_fuel_readings"))
      return memory.previous.map(r => ({
        nozzleId: r.nozzle_id,
        sequenceNo: r.sequence_no,
        kind: r.kind,
        meterMl: r.meter_ml,
        priceMinor: r.price_minor,
        readingAt: r.reading_at,
      }));
    throw Error(sql);
  }),
  first: vi.fn(async (_c: unknown, sql: string) => {
    if (sql.includes("FROM st_shift_icmal")) return null;
    if (sql.includes("FROM st_stations")) return { id: "station" };
    if (sql.includes("FROM st_shifts"))
      return {
        starts_at: "2026-11-05 00:00:00.000",
        now_at: "2026-11-05 23:00:00.000",
      };
    if (sql.includes("FROM st_fuel_batches")) return memory.batch;
    if (sql.includes("FROM st_fuel_assignments"))
      return memory.busy ? { account_id: "other" } : null;
    if (sql.includes("account_id<>"))
      return memory.later ? { id: "later" } : null;
    if (sql.includes("sequence_no=?"))
      return memory.previous[0]?.kind === "CLOSE"
        ? {
            ...memory.previous[0],
            kind: "OPEN",
            sequence_no: 0,
            meter_ml: 100000,
          }
        : null;
    if (sql.includes("FROM st_fuel_readings")) return memory.last;
    throw Error(sql);
  }),
  execute: vi.fn(async (_c: unknown, sql: string, params: any[]) => {
    memory.writes.push({ sql, params });
    return {};
  }),
}));
import { assertFuelReady, openFuel, updateFuel, correctFuel } from "./fuel";
const nozzle = "11111111-1111-4111-8111-111111111111";
const account = {
  id: "account",
  tenant_id: "tenant",
  station_id: "station",
  shift_id: "shift",
  business_unit: "FUEL",
  status: "OPEN",
};
const connection = {} as any;
const at = "2026-11-05T10:00:00.000Z";
beforeEach(() => {
  Object.assign(memory, {
    batch: null,
    previous: [],
    equipment: [{ id: nozzle }],
    writes: [],
    busy: false,
    last: null,
    later: false,
  });
});
describe("fuel integer calculations", () => {
  it("parses litres exactly to millilitres", () => {
    expect(parseLitres("1234,567")).toBe(1234567);
    expect(parseLitres("0.001")).toBe(1);
  });
  it.each(["1.0001", "-1", "1e3", "1.234,56", "Infinity", ""])(
    "rejects ambiguous litres %s",
    value => expect(() => parseLitres(value)).toThrow()
  );
  it("splits sales by measured price boundaries", () =>
    expect(
      calculateFuel([
        { meterMl: 1000000, priceMinor: 4500 },
        { meterMl: 1010000, priceMinor: 4600 },
        { meterMl: 1015000, priceMinor: 4600 },
      ])
    ).toEqual({ soldMl: 15000, expectedMinor: 68000 }));
  it("rounds half-up once per price segment", () =>
    expect(
      calculateFuel([
        { meterMl: 0, priceMinor: 1500 },
        { meterMl: 1, priceMinor: 2500 },
        { meterMl: 2, priceMinor: 2500 },
      ]).expectedMinor
    ).toBe(5));
  it("supports zero sales and a price change with zero volume", () =>
    expect(
      calculateFuel([
        { meterMl: 100, priceMinor: 1 },
        { meterMl: 100, priceMinor: 2 },
      ])
    ).toEqual({ soldMl: 0, expectedMinor: 0 }));
  it("rejects meter regression", () =>
    expect(() =>
      calculateFuel([
        { meterMl: 10, priceMinor: 1 },
        { meterMl: 9, priceMinor: 1 },
      ])
    ).toThrow("gerileyemez"));
  it("rejects unsafe output without rounding errors", () =>
    expect(() =>
      calculateFuel([
        { meterMl: 0, priceMinor: Number.MAX_SAFE_INTEGER },
        { meterMl: 1001, priceMinor: 1 },
      ])
    ).toThrow());
  it.each([0, -1, 1.1, NaN, Infinity])("rejects invalid price %s", priceMinor =>
    expect(() =>
      calculateFuel([
        { meterMl: 0, priceMinor },
        { meterMl: 1, priceMinor },
      ])
    ).toThrow()
  );
  it("requires a closing reading", () =>
    expect(() => calculateFuel([{ meterMl: 1, priceMinor: 100 }])).toThrow());
});
describe("fuel safety rules", () => {
  it("locks accepted reading corrections", async () => {
    await expect(
      correctFuel(connection, { ...account, status: "ACCEPTED" }, 7, {})
    ).rejects.toMatchObject({ code: "ACCOUNT_LOCKED" });
  });
  it("rejects corrections to another account's nozzle", async () => {
    memory.batch = { closed: 0 };
    await expect(
      correctFuel(connection, account, 7, { nozzleId: nozzle, sequenceNo: 0 })
    ).rejects.toMatchObject({ code: "FUEL_NOZZLE_FORBIDDEN" });
  });
  it("preserves the opening counter during price corrections", async () => {
    memory.batch = { closed: 0 };
    memory.previous = [
      {
        id: "r",
        nozzle_id: nozzle,
        sequence_no: 0,
        kind: "OPEN",
        meter_ml: 100000,
        price_minor: 4500,
      },
    ];
    await expect(
      correctFuel(connection, account, 7, {
        nozzleId: nozzle,
        sequenceNo: 0,
        meterMl: 99999,
        priceMinor: 4600,
      })
    ).rejects.toMatchObject({ code: "FUEL_OPENING_IMMUTABLE" });
  });
  it("audits the old and corrected price without changing opening volume", async () => {
    memory.batch = { closed: 0 };
    memory.previous = [
      {
        id: "r",
        nozzle_id: nozzle,
        sequence_no: 0,
        kind: "OPEN",
        meter_ml: 100000,
        price_minor: 4500,
      },
    ];
    await expect(
      correctFuel(connection, account, 7, {
        nozzleId: nozzle,
        sequenceNo: 0,
        meterMl: 100000,
        priceMinor: 4600,
        note: "DEMO düzeltme",
        evidence: "DEMO belge",
      })
    ).resolves.toMatchObject({
      previous: { price_minor: 4500 },
      next: { meterMl: 100000, priceMinor: 4600 },
    });
  });
  it("requires independent documentary evidence on corrections", async () => {
    memory.batch = { closed: 0 };
    memory.previous = [
      {
        id: "r",
        nozzle_id: nozzle,
        sequence_no: 0,
        kind: "OPEN",
        meter_ml: 100000,
        price_minor: 4500,
      },
    ];
    await expect(
      correctFuel(connection, account, 7, {
        nozzleId: nozzle,
        sequenceNo: 0,
        meterMl: 100000,
        priceMinor: 4600,
        note: "DEMO",
      })
    ).rejects.toThrow();
    expect(memory.writes).toHaveLength(0);
  });
  const opening = (extra: Record<string, unknown> = {}) =>
    openFuel(connection, account, 7, {
      readingAt: at,
      openingReadings: [
        { nozzleId: nozzle, meterMl: 100000, priceMinor: 4500 },
      ],
      ...extra,
    });
  const change = (
    extra: Record<string, unknown> = {},
    kind: "PRICE" | "CLOSE" = "PRICE"
  ) =>
    updateFuel(
      connection,
      account,
      7,
      {
        readingAt: at,
        nozzleId: nozzle,
        meterMl: 110000,
        priceMinor: 4600,
        note: "DEMO fiyat değişimi",
        evidence: "DEMO sayaç fotoğrafı",
        ...extra,
      },
      kind
    );
  function existing() {
    memory.batch = { closed: 0, reported_ml: null };
    memory.previous = [
      {
        nozzle_id: nozzle,
        meter_ml: 100000,
        price_minor: 4500,
        sequence_no: 0,
        kind: "OPEN",
        reading_at: "2026-11-05 09:00:00.000",
      },
    ];
  }
  it("keeps legacy equipment-free fuel accounts unchanged", async () => {
    memory.equipment = [];
    await expect(opening()).resolves.toBeUndefined();
    expect(memory.writes).toHaveLength(0);
  });
  it("requires every opening nozzle exactly once", async () => {
    await expect(opening({ openingReadings: [] })).rejects.toMatchObject({
      code: "FUEL_READINGS_REQUIRED",
    });
    expect(memory.writes).toHaveLength(0);
  });
  it("rejects a nozzle outside the configured station", async () => {
    await expect(
      opening({
        openingReadings: [
          {
            nozzleId: "22222222-2222-4222-8222-222222222222",
            meterMl: 0,
            priceMinor: 1,
          },
        ],
      })
    ).rejects.toMatchObject({ code: "FUEL_DUPLICATE" });
  });
  it("rejects another open assignment", async () => {
    memory.busy = true;
    await expect(opening()).rejects.toMatchObject({ code: "FUEL_NOZZLE_BUSY" });
    expect(
      memory.writes.some(w => w.sql.includes("INSERT INTO st_fuel_readings"))
    ).toBe(false);
  });
  it("requires continuity from the previous closing counter", async () => {
    memory.last = { meter_ml: 99999, reading_at: "2026-11-05 09:00:00.000" };
    await expect(opening()).rejects.toMatchObject({ code: "FUEL_CONTINUITY" });
  });
  it("records opening and immutable shift/nozzle assignment", async () => {
    await opening();
    expect(memory.writes.map(w => w.sql).join(" ")).toContain(
      "st_fuel_assignments"
    );
    expect(memory.writes.at(-1).params.slice(3, 7)).toEqual([
      0,
      "OPEN",
      100000,
      4500,
    ]);
  });
  it("requires a price boundary rather than changing the closing price", async () => {
    existing();
    await expect(
      change(
        {
          readings: [{ nozzleId: nozzle, meterMl: 110000, priceMinor: 4600 }],
          reportedMl: 10000,
        },
        "CLOSE"
      )
    ).rejects.toMatchObject({ code: "FUEL_PRICE_BOUNDARY_REQUIRED" });
  });
  it("rejects regressing price-boundary readings", async () => {
    existing();
    await expect(change({ meterMl: 99999 })).rejects.toMatchObject({
      code: "FUEL_METER_REGRESSION",
    });
  });
  it("rejects unchanged prices", async () => {
    existing();
    await expect(change({ priceMinor: 4500 })).rejects.toMatchObject({
      code: "FUEL_PRICE_UNCHANGED",
    });
  });
  it.each([
    "2026-11-04T23:00:00Z",
    "2026-11-05T09:00:00Z",
    "2026-11-06T00:00:00Z",
  ])("rejects invalid reading order %s", async readingAt => {
    existing();
    await expect(change({ readingAt })).rejects.toMatchObject({
      code: "FUEL_READING_TIME",
    });
  });
  it("requires documentary evidence for price changes", async () => {
    existing();
    await expect(change({ evidence: "" })).rejects.toMatchObject({
      code: "FUEL_EVIDENCE_REQUIRED",
    });
  });
  it("locks submitted and accepted accounts", async () => {
    existing();
    await expect(
      updateFuel(
        connection,
        { ...account, status: "IN_REVIEW" },
        7,
        {},
        "CLOSE"
      )
    ).rejects.toMatchObject({ code: "ACCOUNT_LOCKED" });
  });
  it("rejects price edits after meter close", async () => {
    existing();
    memory.batch.closed = 1;
    await expect(change()).rejects.toMatchObject({ code: "FUEL_CLOSED" });
  });
  it("prevents correcting a close already used by the next shift", async () => {
    existing();
    memory.previous[0].kind = "CLOSE";
    memory.previous[0].sequence_no = 1;
    memory.later = true;
    await expect(
      change(
        {
          readings: [{ nozzleId: nozzle, meterMl: 110000, priceMinor: 4500 }],
          reportedMl: 10000,
        },
        "CLOSE"
      )
    ).rejects.toMatchObject({ code: "FUEL_SUCCESSOR_EXISTS" });
  });
  it("blocks incomplete readings from submit and approval", async () => {
    existing();
    await expect(assertFuelReady(connection, account, 0)).rejects.toMatchObject(
      { code: "FUEL_RECONCILIATION_REQUIRED" }
    );
  });
  it("blocks independent litre discrepancy even with matching money", async () => {
    existing();
    memory.batch = { closed: 1, reported_ml: 9999 };
    memory.previous.push({
      ...memory.previous[0],
      meter_ml: 110000,
      sequence_no: 1,
      kind: "CLOSE",
    });
    await expect(
      assertFuelReady(connection, account, 45000)
    ).rejects.toMatchObject({ code: "FUEL_RECONCILIATION_REQUIRED" });
  });
  it("blocks amount discrepancy even with matching litres", async () => {
    existing();
    memory.batch = { closed: 1, reported_ml: 10000 };
    memory.previous.push({
      ...memory.previous[0],
      meter_ml: 110000,
      sequence_no: 1,
      kind: "CLOSE",
    });
    await expect(
      assertFuelReady(connection, account, 44999)
    ).rejects.toMatchObject({ code: "FUEL_RECONCILIATION_REQUIRED" });
  });
  it("accepts complete operational reconciliation", async () => {
    existing();
    memory.batch = { closed: 1, reported_ml: 10000 };
    memory.previous.push({
      ...memory.previous[0],
      meter_ml: 110000,
      sequence_no: 1,
      kind: "CLOSE",
    });
    await expect(
      assertFuelReady(connection, account, 45000)
    ).resolves.toMatchObject({
      soldMl: 10000,
      expectedMinor: 45000,
      litreDifferenceMl: 0,
      amountDifferenceMinor: 0,
    });
  });
});

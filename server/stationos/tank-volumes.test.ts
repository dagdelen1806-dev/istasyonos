import { describe, it, expect, vi, beforeEach } from "vitest";
import { volumeVariance } from "../../shared/tank-volumes";
const m = vi.hoisted(() => ({
  reading: null as any,
  baseline: null as any,
  request: null as any,
  writes: [] as string[],
}));
vi.mock("./tank", () => ({
  lockDemoTankStation: vi.fn(),
  lockTankCard: vi.fn(async () => ({
    tank_id: "tank",
    capacity_ml: 200000,
    revision: 1,
  })),
  checkTankRevision: vi.fn((_: unknown, revision: unknown) => {
    if (revision !== 1) throw Error("REVISION");
  }),
  tankProof: vi.fn(() => ({ note: "DEMO kontrol", evidence: "DEMO belge" })),
}));
vi.mock("./db", () => ({
  first: vi.fn(async (_: unknown, sql: string) =>
    sql.includes("st_tank_volume_readings WHERE")
      ? m.reading
      : sql.includes("JOIN st_tank_volume_readings")
        ? m.baseline
        : m.request
  ),
  execute: vi.fn(async (_: unknown, sql: string) => {
    m.writes.push(sql);
  }),
  rows: vi.fn(),
}));
import {
  recordDualVolumes,
  requestVarianceReset,
  reviewVarianceReset,
} from "./tank-volumes";
const c = {} as any,
  scope = { tenantId: "t", stationId: "s" };
const id = "11111111-1111-4111-8111-111111111111";
beforeEach(() => {
  m.reading = {
    id,
    product_ml: 100000,
    net_ml: 99000,
    stock_revision: 1,
    sequence_index: 1,
  };
  m.baseline = null;
  m.request = {
    id,
    created_by: 2,
    status: "PENDING",
    reading_id: id,
    previous_reset_id: null,
  };
  m.writes = [];
});
describe("dual volumes", () => {
  it("retains raw spread after period reset", () => {
    expect(volumeVariance(100000, 99000, 1000)).toEqual({
      productMl: 100000,
      netMl: 99000,
      spreadMl: 1000,
      baselineSpreadMl: 1000,
      periodDifferenceMl: 0,
    });
    expect(volumeVariance(102000, 100000, 1000).periodDifferenceMl).toBe(1000);
  });
  it("preserves signed differences and unknown first reference", () => {
    expect(volumeVariance(99000, 100000, null).spreadMl).toBe(-1000);
    expect(volumeVariance(99000, 100000, null).periodDifferenceMl).toBeNull();
  });
  it.each([-1, NaN, Infinity, 1.2, Number.MAX_SAFE_INTEGER + 1])(
    "rejects invalid volume %s",
    n => expect(() => volumeVariance(n, 0, null)).toThrow()
  );
  it("rejects overflowing period delta", () =>
    expect(() => volumeVariance(Number.MAX_SAFE_INTEGER, 0, -1)).toThrow());
  it("appends both values without a stock write", async () => {
    const r = await recordDualVolumes(c, scope, 2, {
      tankId: "tank",
      productMl: 102000,
      netMl: 100000,
      expectedRevision: 1,
      expectedReadingId: id,
    });
    expect(r.stockApplied).toBe(false);
    expect(m.writes).toHaveLength(1);
    expect(m.writes[0]).toContain("INSERT INTO st_tank_volume_readings");
  });
  it("blocks stale reading replacement", async () => {
    await expect(
      recordDualVolumes(c, scope, 2, {
        tankId: "tank",
        productMl: 1,
        netMl: 1,
        expectedRevision: 1,
        expectedReadingId: null,
      })
    ).rejects.toMatchObject({ code: "REVISION_CONFLICT" });
    expect(m.writes).toHaveLength(0);
  });
  it("blocks over-capacity product", async () =>
    await expect(
      recordDualVolumes(c, scope, 2, {
        tankId: "tank",
        productMl: 200001,
        netMl: 1,
        expectedRevision: 1,
      })
    ).rejects.toMatchObject({ code: "STOCK_BOUNDS" }));
  it("requests reference only, never a stock adjustment", async () => {
    const r = await requestVarianceReset(c, scope, 2, {
      tankId: "tank",
      readingId: id,
      expectedRevision: 1,
    });
    expect(r.stockApplied).toBe(false);
    expect(m.writes[0]).toContain("INSERT INTO st_tank_variance_resets");
  });
  it("requires fresh stock revision", async () => {
    m.reading.stock_revision = 0;
    await expect(
      requestVarianceReset(c, scope, 2, {
        tankId: "tank",
        readingId: id,
        expectedRevision: 1,
      })
    ).rejects.toMatchObject({ code: "READING_STALE" });
  });
  it("forbids self approval", async () =>
    await expect(
      reviewVarianceReset(c, scope, 2, {
        tankId: "tank",
        varianceResetId: id,
        decision: "APPROVE",
        expectedRevision: 1,
      })
    ).rejects.toMatchObject({ code: "SELF_APPROVAL_FORBIDDEN" }));
  it("rejects changed source reading", async () => {
    m.request.reading_id = "old";
    await expect(
      reviewVarianceReset(c, scope, 3, {
        tankId: "tank",
        varianceResetId: id,
        decision: "APPROVE",
        expectedRevision: 1,
      })
    ).rejects.toMatchObject({ code: "RESET_STALE" });
  });
  it("rejects changed baseline", async () => {
    m.baseline = { id: "another" };
    await expect(
      reviewVarianceReset(c, scope, 3, {
        tankId: "tank",
        varianceResetId: id,
        decision: "APPROVE",
        expectedRevision: 1,
      })
    ).rejects.toMatchObject({ code: "RESET_STALE" });
  });
  it("independent approval writes only reset review", async () => {
    const r = await reviewVarianceReset(c, scope, 3, {
      tankId: "tank",
      varianceResetId: id,
      decision: "APPROVE",
      expectedRevision: 1,
    });
    expect(r.stockApplied).toBe(false);
    expect(m.writes).toHaveLength(1);
    expect(m.writes[0]).toMatch(/^UPDATE st_tank_variance_resets /);
  });
});

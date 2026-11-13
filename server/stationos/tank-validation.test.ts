import { beforeEach, describe, it, expect, vi } from "vitest";
import {
  analyzePhotoTank,
  fillPercent,
  toMl,
  type PhotoTank,
} from "../../shared/tank-validation";
const memory = vi.hoisted(() => ({
  demo: true,
  previous: null as any,
  writes: [] as { sql: string; params: any[] }[],
  cards: [] as any[],
}));
const documentId = "11111111-1111-4111-8111-111111111111",
  tankId = "22222222-2222-4222-8222-222222222222";
vi.mock("./db", () => ({
  first: vi.fn(async (_c: unknown, sql: string, p: any[]) => {
    if (sql.includes("FROM st_tenants"))
      return { is_demo: memory.demo ? 1 : 0 };
    if (sql.includes("FROM st_tank_photo_drafts"))
      return p[0] === documentId
        ? {
            id: documentId,
            rows_json: JSON.stringify([
              {
                number: "1",
                fuelLabel: "DEMO Yakıt",
                capacityLitres: 100,
                productVolumeLitres: 40,
                netProductVolumeLitres: 39.5,
                reportedVolumeFillPercent: 85,
              },
            ]),
          }
        : null;
    if (sql.includes("FROM st_tank_photo_reviews")) return memory.previous;
    throw Error(sql);
  }),
  rows: vi.fn(async (_c: unknown, sql: string) => {
    if (sql.includes("FROM st_tank_cards")) return memory.cards;
    throw Error(sql);
  }),
  execute: vi.fn(async (_c: unknown, sql: string, params: any[]) => {
    memory.writes.push({ sql, params });
    return {};
  }),
}));
import { reviewPhoto, sourceRows, validateProposal } from "./tank-validation";
const c = {} as any,
  scope = { tenantId: "t", stationId: "s" };
const source: PhotoTank = {
  number: "1",
  fuelLabel: "DEMO Yakıt",
  capacityLitres: 100,
  productVolumeLitres: 40,
  netProductVolumeLitres: 39.5,
  emptyVolumeLitres: 60,
  reportedVolumeFillPercent: 85,
  reportedLevelPercent: 79,
};
beforeEach(() => {
  memory.demo = true;
  memory.previous = null;
  memory.writes = [];
  memory.cards = [
    {
      tank_id: tankId,
      tank_number: "1",
      capacity_ml: 100000,
      fuel: "DEMO Yakıt",
    },
  ];
});
describe("Fotoğraf hesap ve eşleşme güvenliği", () => {
  it("keeps product and net percentages separate", () => {
    const a = analyzePhotoTank(source, []);
    expect(a.productFillPercent).toBe(40);
    expect(a.netFillPercent).toBe(39.5);
    expect(a.warnings).toContain("PRODUCT_FILL_MISMATCH");
    expect(a.warnings).toContain("NET_FILL_MISMATCH");
  });
  it("does not treat LPG zero capacity as a real empty tank", () => {
    const a = analyzePhotoTank(
      {
        ...source,
        number: "101",
        fuelLabel: "LPG",
        capacityLitres: 0,
        productVolumeLitres: 0,
        netProductVolumeLitres: 0,
      },
      []
    );
    expect(a.capacityMl).toBeNull();
    expect(a.productFillPercent).toBeNull();
    expect(a.proposal.capacityMl).toBeNull();
    expect(a.proposal.volumeMl).toBeNull();
    expect(a.warnings).toContain("ZERO_READINGS_UNVERIFIED");
  });
  it("does not derive volume from level percentage", () => {
    const a = analyzePhotoTank(
      { ...source, productVolumeLitres: null, netProductVolumeLitres: null },
      []
    );
    expect(a.productMl).toBeNull();
    expect(a.proposal.volumeMl).toBeNull();
    expect(a.warnings).toContain("LEVEL_PERCENT_REQUIRES_CALIBRATION");
  });
  it("flags volume above capacity and reversed net volume", () => {
    const a = analyzePhotoTank(
      { ...source, productVolumeLitres: 110, netProductVolumeLitres: 120 },
      []
    );
    expect(a.warnings).toContain("VOLUME_EXCEEDS_CAPACITY");
    expect(a.warnings).toContain("NET_EXCEEDS_PRODUCT");
  });
  it("detects nominal versus available volume contradiction", () =>
    expect(
      analyzePhotoTank({ ...source, emptyVolumeLitres: 50 }, []).warnings
    ).toContain("CAPACITY_VOLUME_SUM_MISMATCH"));
  it("suggests a unique exact match without selecting it", () => {
    const a = analyzePhotoTank(source, [
      { tankId, number: "1", fuel: "DEMO Yakıt", capacityMl: 100000 },
    ]);
    expect(a.suggestedTankId).toBe(tankId);
    expect(a.proposal.tankId).toBeNull();
  });
  it("requires manual choice for ambiguous matches", () => {
    const a = analyzePhotoTank(source, [
      { tankId, number: "1", fuel: "DEMO Yakıt", capacityMl: 100000 },
      { tankId: "other", number: "1", fuel: "DEMO Yakıt", capacityMl: 100000 },
    ]);
    expect(a.suggestedTankId).toBeNull();
    expect(a.warnings).toContain("MATCH_AMBIGUOUS");
  });
  it("does not silently equate a brand alias or DEMO prefix", () => {
    const a = analyzePhotoTank(source, [
      { tankId, number: "DEMO-1", fuel: "DEMO Yakıt", capacityMl: 100000 },
    ]);
    expect(a.suggestedTankId).toBeNull();
  });
  it.each([null, undefined, -1, Infinity, NaN, 1e30, 0.0001, 0.000000001])(
    "rejects unrepresentable litres %s",
    v => expect(toMl(v)).toBeNull()
  );
  it("preserves millilitre precision", () => expect(toMl(12.345)).toBe(12345));
  it("unknown denominator stays unknown", () =>
    expect(fillPercent(0, 0)).toBeNull());
  it("checks displayed integer percent with rounding precision", () => {
    const a = analyzePhotoTank(
      {
        ...source,
        productVolumeLitres: 40.4,
        netProductVolumeLitres: 40,
        reportedVolumeFillPercent: 40,
      },
      []
    );
    expect(a.warnings).not.toContain("PRODUCT_FILL_MISMATCH");
  });
});
describe("Yalnız taslak karar yazımı", () => {
  const body = {
    documentId,
    rowNumber: "1",
    expectedRevision: 0,
    decision: "APPROVED_DRAFT",
    tankId,
    basis: "PRODUCT",
    capacityMl: 100000,
    volumeMl: 40000,
    sourceConfirmed: true,
    warningsAcknowledged: true,
    note: "DEMO doğrulama gerekçesi",
    evidence: "DEMO kaynak belge",
  };
  it("requires DEMO scope", async () => {
    memory.demo = false;
    await expect(reviewPhoto(c, scope, 7, body)).rejects.toMatchObject({
      code: "DEMO_REQUIRED",
    });
    expect(memory.writes).toHaveLength(0);
  });
  it("rejects foreign document and source row", async () => {
    await expect(
      reviewPhoto(c, scope, 7, { ...body, rowNumber: "999" })
    ).rejects.toMatchObject({ code: "PHOTO_ROW_NOT_FOUND" });
  });
  it("rejects tank outside station", async () => {
    memory.cards = [];
    await expect(reviewPhoto(c, scope, 7, body)).rejects.toMatchObject({
      code: "TANK_FORBIDDEN",
    });
  });
  it("rejects stale review revisions", async () => {
    memory.previous = { revision: 1 };
    await expect(reviewPhoto(c, scope, 7, body)).rejects.toMatchObject({
      code: "REVISION_CONFLICT",
    });
  });
  it.each([
    { capacityMl: 0 },
    { volumeMl: 100001 },
    { basis: "UNDECIDED" },
    { sourceConfirmed: false },
    { warningsAcknowledged: false },
    { tankId: null },
  ])("blocks incomplete approval %o", async extra => {
    await expect(
      reviewPhoto(c, scope, 7, { ...body, ...extra })
    ).rejects.toMatchObject({ code: "PHOTO_REVIEW_INCOMPLETE" });
    expect(memory.writes).toHaveLength(0);
  });
  it("preserves unknown capacity on pending LPG review", async () => {
    await reviewPhoto(c, scope, 7, {
      ...body,
      decision: "PENDING",
      capacityMl: 0,
      volumeMl: null,
      tankId: null,
      basis: "UNDECIDED",
      sourceConfirmed: false,
      warningsAcknowledged: false,
    });
    expect(memory.writes[0].params[7]).toBeNull();
  });
  it("only appends review; no stock, measurement, card or source update", async () => {
    const result = await reviewPhoto(c, scope, 7, body);
    expect(result.stockApplied).toBe(false);
    expect(memory.writes).toHaveLength(1);
    expect(memory.writes[0].sql).toContain("INSERT INTO st_tank_photo_reviews");
    expect(memory.writes[0].sql).not.toMatch(
      /UPDATE|st_tank_ledger|st_tank_measurements/
    );
  });
  it("allows a rejection without manufacturing capacity or a match", () =>
    expect(() =>
      validateProposal(
        { capacityMl: null, volumeMl: null, basis: "UNDECIDED", tankId: null },
        "REJECTED",
        false,
        false
      )
    ).not.toThrow());
  it("approves both volumes without selecting a single stock basis", async () => {
    const r = await reviewPhoto(c, scope, 7, {
      ...body,
      basis: "BOTH",
      volumeMl: null,
      productMl: 50000,
      netMl: 49000,
    });
    expect(r.proposal.productMl).toBe(50000);
    expect(r.proposal.netMl).toBe(49000);
    expect(r.stockApplied).toBe(false);
  });
  it.each([
    { productMl: null, netMl: 49000 },
    { productMl: 50000, netMl: null },
    { productMl: 100001, netMl: 49000 },
  ])("blocks incomplete dual-volume approval %o", async extra => {
    await expect(
      reviewPhoto(c, scope, 7, {
        ...body,
        basis: "BOTH",
        volumeMl: null,
        ...extra,
      })
    ).rejects.toMatchObject({ code: "PHOTO_REVIEW_INCOMPLETE" });
  });
  it("rejects duplicate source rows", () =>
    expect(() => sourceRows([source, source])).toThrow());
});

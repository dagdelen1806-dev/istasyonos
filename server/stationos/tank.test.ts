import { beforeEach, describe, it, expect, vi } from "vitest";
import { stockAfter, tankStatus } from "../../shared/tank";
const tankId = "11111111-1111-4111-8111-111111111111",
  reqId = "22222222-2222-4222-8222-222222222222";
const memory = vi.hoisted(() => ({
  card: null as any,
  request: null as any,
  demo: true,
  ledger: new Map<string, any>(),
  writes: [] as string[],
  earlier: false,
  link: null as any,
}));
vi.mock("./db", () => ({
  first: vi.fn(async (_c: unknown, sql: string, params: any[]) => {
    if (sql.includes("FROM st_tenants"))
      return { is_demo: memory.demo ? 1 : 0 };
    if (sql.includes("FROM st_stations")) return { id: "s" };
    if (sql.includes("FROM st_tank_cards")) return memory.card;
    if (sql.includes("FROM st_tank_requests"))
      return params[0] === memory.request?.id ? memory.request : null;
    if (sql.includes("FROM st_accounts"))
      return memory.earlier ? { id: "prior" } : null;
    if (sql.includes("FROM st_tank_ledger"))
      return memory.ledger.get(params[1]) ?? null;
    if (sql.includes("FROM st_tank_delivery_links")) return memory.link;
    if (sql.includes("FROM st_accounts"))
      return memory.earlier ? { id: "prior" } : null;
    throw Error(sql);
  }),
  rows: vi.fn(async (_c: unknown, sql: string) => {
    if (sql.includes("FROM st_tank_cards"))
      return memory.card ? [{ ...memory.card }] : [];
    if (sql.includes("FROM st_fuel_nozzles"))
      return [{ id: "n", tank_id: memory.card.tank_id }];
    throw Error(sql);
  }),
  execute: vi.fn(async (_c: unknown, sql: string, p: any[]) => {
    memory.writes.push(sql);
    if (sql.includes("INSERT INTO st_tank_ledger"))
      memory.ledger.set(p[5], { kind: p[1], delta_ml: p[2] });
    if (sql.includes("UPDATE st_tank_cards SET stock_ml")) {
      memory.card.stock_ml = p[0];
      memory.card.revision++;
    }
    if (sql.includes("UPDATE st_tank_requests SET status"))
      memory.request.status = p[0];
    return {};
  }),
}));
import {
  reviewTankMove,
  measureTank,
  postTankAccount,
  assertTankDeliveryMutable,
} from "./tank";
const c = {} as any,
  scope = { tenantId: "t", stationId: "s" },
  proof = {
    tankId,
    stockRequestId: reqId,
    requestId: "33333333-3333-4333-8333-333333333333",
    expectedRevision: 1,
    decision: "APPROVE",
    note: "DEMO bağımsız kontrol",
    evidence: "DEMO tutanak",
  };
beforeEach(() => {
  memory.card = {
    tank_id: tankId,
    tenant_id: "t",
    station_id: "s",
    tank_number: "1",
    capacity_ml: 200000,
    critical_ml: 20000,
    tolerance_ml: 1000,
    revision: 1,
    stock_ml: 100000,
    initialized_at: "2026-11-05 00:00:00.000",
  };
  memory.request = {
    id: reqId,
    tank_id: tankId,
    kind: "DELIVERY",
    status: "PENDING",
    measured_ml: 10000,
    document_ml: 10000,
    expected_revision: 1,
    created_by: 7,
    reference: "DEMO",
  };
  memory.demo = true;
  memory.ledger.clear();
  memory.writes = [];
  memory.earlier = false;
  memory.link = null;
});
describe("Tank litre hesapları", () => {
  it("counts sales, test, return and delivery once", () => {
    let n = 100000;
    n = stockAfter(n, 10000, 200000);
    n = stockAfter(n, -18000, 200000);
    n = stockAfter(n, -2000, 200000);
    n = stockAfter(n, 1000, 200000);
    expect(n).toBe(91000);
  });
  it("keeps missing stock/measurement unknown", () =>
    expect(tankStatus(null, 200000, 20000, null, 1000)).toEqual({
      fillPercent: null,
      critical: null,
      differenceMl: null,
      withinTolerance: null,
    }));
  it("zero stock is critical but unknown is distinct", () =>
    expect(tankStatus(0, 200000, 0, 0, 0)).toMatchObject({
      critical: true,
      fillPercent: 0,
      differenceMl: 0,
      withinTolerance: true,
    }));
  it("evaluates absolute litre tolerance without changing stock", () =>
    expect(tankStatus(100000, 200000, 20000, 100500, 500)).toMatchObject({
      fillPercent: 50,
      critical: false,
      differenceMl: 500,
      withinTolerance: true,
    }));
  it("flags a negative out-of-tolerance physical difference", () =>
    expect(tankStatus(100000, 200000, 20000, 98000, 1000)).toMatchObject({
      differenceMl: -2000,
      withinTolerance: false,
    }));
  it.each([-100001, 100001, 1.5, Number.MAX_SAFE_INTEGER])(
    "rejects invalid delta %s",
    delta => expect(() => stockAfter(100000, delta, 200000)).toThrow()
  );
  it.each([
    { capacity: 0, critical: 0, tolerance: 0 },
    { capacity: 100, critical: 101, tolerance: 0 },
    { capacity: 100, critical: 0, tolerance: 101 },
  ])("rejects invalid limits %o", ({ capacity, critical, tolerance }) =>
    expect(() =>
      tankStatus(null, capacity, critical, null, tolerance)
    ).toThrow()
  );
});
describe("Stok onayları, kanıt ve kaynak kilitleri", () => {
  it("blocks non-demo approval", async () => {
    memory.demo = false;
    await expect(reviewTankMove(c, scope, 8, proof)).rejects.toMatchObject({
      code: "DEMO_REQUIRED",
    });
    expect(memory.writes).toHaveLength(0);
  });
  it("rejects self approval", async () => {
    await expect(reviewTankMove(c, scope, 7, proof)).rejects.toMatchObject({
      code: "SELF_APPROVAL_FORBIDDEN",
    });
    expect(memory.writes).toHaveLength(0);
  });
  it("requires evidence", async () => {
    await expect(
      reviewTankMove(c, scope, 8, { ...proof, evidence: "" })
    ).rejects.toThrow();
    expect(memory.writes).toHaveLength(0);
  });
  it("rejects stale stock snapshots", async () => {
    memory.card.revision = 2;
    await expect(reviewTankMove(c, scope, 8, proof)).rejects.toMatchObject({
      code: "REVISION_CONFLICT",
    });
    expect(memory.writes).toHaveLength(0);
  });
  it("requires opening stock before delivery", async () => {
    memory.card.stock_ml = null;
    await expect(reviewTankMove(c, scope, 8, proof)).rejects.toMatchObject({
      code: "OPENING_REQUIRED",
    });
  });
  it("bounds approval by capacity", async () => {
    memory.request.measured_ml = 100001;
    await expect(reviewTankMove(c, scope, 8, proof)).rejects.toMatchObject({
      code: "STOCK_BOUNDS",
    });
    expect(memory.writes).toHaveLength(0);
  });
  it("posts independently approved delivery once", async () => {
    await reviewTankMove(c, scope, 8, proof);
    expect(memory.card.stock_ml).toBe(110000);
    expect(memory.ledger.size).toBe(1);
    await expect(
      reviewTankMove(c, scope, 8, { ...proof, expectedRevision: 2 })
    ).rejects.toMatchObject({ code: "STOCK_REQUEST_LOCKED" });
  });
  it("measurement records a discrepancy without changing stock", async () => {
    await measureTank(c, scope, 7, {
      tankId,
      expectedRevision: 1,
      measuredMl: 98000,
      note: "DEMO fark",
      evidence: "DEMO fotoğraf",
    });
    expect(memory.card.stock_ml).toBe(100000);
    expect(memory.ledger.size).toBe(0);
    expect(
      memory.writes.some(sql => sql.includes("st_tank_measurements"))
    ).toBe(true);
  });
  it("protects accepted stock delivery from voiding its source", async () => {
    memory.link = { request_id: reqId };
    await expect(assertTankDeliveryMutable(c, reqId)).rejects.toMatchObject({
      code: "TANK_DELIVERY_POSTED",
    });
  });
  it("does not import pre-opening historical accounts", async () => {
    await expect(
      postTankAccount(
        c,
        {
          id: "a",
          station_id: "s",
          tenant_id: "t",
          created_at: "2026-11-04 23:00:00.000",
        } as any,
        {},
        8
      )
    ).rejects.toMatchObject({ code: "STOCK_CUTOVER_REQUIRED" });
    expect(memory.ledger.size).toBe(0);
  });
  it("keeps late approvals in stock sequence", async () => {
    memory.earlier = true;
    await expect(
      postTankAccount(
        c,
        {
          id: "a",
          station_id: "s",
          tenant_id: "t",
          created_at: "2026-11-05 01:00:00.000",
        } as any,
        {},
        8
      )
    ).rejects.toMatchObject({ code: "STOCK_SEQUENCE_PENDING" });
  });
  it("posts commercial and test litres separately and replays idempotently", async () => {
    const account = {
      id: "a",
      station_id: "s",
      tenant_id: "t",
      created_at: "2026-11-05 01:00:00.000",
    } as any;
    const fuel = {
      readings: [
        { nozzleId: "n", meterMl: 1000000, priceMinor: 5000 },
        { nozzleId: "n", meterMl: 1020000, priceMinor: 5000 },
      ],
      evidence: "DEMO",
      icmal: {
        operations: [
          {
            id: "test",
            status: "RECORDED",
            kind: "TEST_OUT",
            nozzleId: "n",
            tankId,
            startMeterMl: 1002000,
            endMeterMl: 1004000,
            evidence: "DEMO",
          },
        ],
      },
    };
    await postTankAccount(c, account, fuel, 8);
    expect(memory.card.stock_ml).toBe(80000);
    expect(memory.ledger.size).toBe(2);
    await postTankAccount(c, account, fuel, 8);
    expect(memory.card.stock_ml).toBe(80000);
    expect(memory.ledger.size).toBe(2);
  });
});

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  giftBalance,
  operationalTotals,
  specialCoverage,
  testAllocation,
  type SpecialOperation,
} from "../../shared/icmal";
import {
  icmalSheets,
  xlsxBytes,
  xmlEscape,
} from "../../client/src/lib/icmal-export";
const memory = vi.hoisted(() => ({
  demo: true,
  batch: true,
  operation: null as any,
  payment: null as any,
  wallet: [] as any[],
  writes: [] as any[],
}));
vi.mock("./db", () => ({
  first: vi.fn(async (_c: unknown, sql: string) => {
    if (sql.includes("FROM st_tenants"))
      return { is_demo: memory.demo ? 1 : 0 };
    if (sql.includes("FROM st_stations")) return { id: "s" };
    if (sql.includes("FROM st_fuel_batches"))
      return memory.batch ? { account_id: "a" } : null;
    if (sql.includes("FROM st_payments") || sql.includes("FROM st_slips"))
      return memory.payment;
    if (sql.includes("related_id=?")) return null;
    if (sql.includes("FROM st_shift_special_operations"))
      return memory.operation;
    throw Error(sql);
  }),
  rows: vi.fn(async (_c: unknown, sql: string) => {
    if (sql.includes("FOR UPDATE")) return memory.wallet;
    throw Error(sql);
  }),
  execute: vi.fn(async (_c: unknown, sql: string, params: unknown[]) => {
    memory.writes.push({ sql, params });
    return {};
  }),
}));
import { addSpecial, reviewSpecial, settleSpecial, voidSpecial } from "./icmal";
const operation = (extra: Partial<SpecialOperation> = {}) =>
  ({
    id: "op",
    accountId: "a",
    kind: "TTS",
    model: "DRAFT",
    status: "DRAFT",
    source: "DEMO",
    provider: "DEMO",
    reference: "ref",
    plate: null,
    customer: null,
    instrument: null,
    amountMinor: 1000,
    volumeMl: 1000,
    documentMl: null,
    nozzleId: null,
    tankId: null,
    startMeterMl: null,
    endMeterMl: null,
    relatedId: null,
    paymentId: null,
    slipId: null,
    settlement: "DRAFT",
    settlementMethod: "DRAFT",
    note: "DEMO",
    evidence: "DEMO",
    reviewerId: null,
    ...extra,
  }) as SpecialOperation;
const raw = (extra: Record<string, unknown> = {}) => ({
  id: "11111111-1111-4111-8111-111111111111",
  account_id: "a",
  kind: "TTS",
  model: "DRAFT",
  status: "DRAFT",
  source: "DEMO",
  provider: "DEMO",
  reference: "ref",
  amount_minor: 1000,
  volume_ml: 1000,
  document_ml: null,
  plate: null,
  customer: null,
  instrument: null,
  nozzle_id: null,
  tank_id: null,
  start_meter_ml: null,
  end_meter_ml: null,
  related_id: null,
  payment_id: null,
  slip_id: null,
  settlement: "DRAFT",
  settlement_method: "DRAFT",
  note: "DEMO",
  evidence: "DEMO",
  reviewer_id: null,
  ...extra,
});
const account = {
    id: "a",
    tenant_id: "t",
    station_id: "s",
    user_id: 7,
    business_unit: "FUEL",
    status: "OPEN",
  },
  c = {} as any,
  proof = {
    operationId: "11111111-1111-4111-8111-111111111111",
    note: "DEMO karar",
    evidence: "DEMO kanıt",
  };
beforeEach(() =>
  Object.assign(memory, {
    demo: true,
    batch: true,
    operation: raw(),
    payment: null,
    wallet: [],
    writes: [],
  })
);
describe("İcmal hesapları ve çift gelir koruması", () => {
  it("splits test across price boundaries without erasing physical litres", () =>
    expect(
      testAllocation(
        [
          { meterMl: 1000000, priceMinor: 4500 },
          { meterMl: 1010000, priceMinor: 4600 },
          { meterMl: 1020000, priceMinor: 4600 },
        ],
        [{ start: 1009000, end: 1011000 }]
      )
    ).toEqual({
      meterMl: 20000,
      meterMinor: 91000,
      testMl: 2000,
      commercialMl: 18000,
      commercialMinor: 81900,
      testMinor: 9100,
    }));
  it("preserves kuruş conservation at fractional rounding boundaries", () => {
    const t = testAllocation(
      [
        { meterMl: 0, priceMinor: 1500 },
        { meterMl: 3, priceMinor: 1500 },
      ],
      [{ start: 0, end: 1 }]
    );
    expect(t.commercialMinor + t.testMinor).toBe(t.meterMinor);
  });
  it.each([
    {
      ranges: [
        { start: 1, end: 3 },
        { start: 2, end: 4 },
      ],
    },
    { ranges: [{ start: 0, end: 0 }] },
    { ranges: [{ start: 0, end: 11 }] },
  ])("rejects overlapping or outside test ranges", ({ ranges }) =>
    expect(() =>
      testAllocation(
        [
          { meterMl: 0, priceMinor: 100 },
          { meterMl: 10, priceMinor: 100 },
        ],
        ranges
      )
    ).toThrow()
  );
  it("gift loading never becomes a second fuel sale", () =>
    expect(
      specialCoverage([
        operation({
          kind: "GIFT_LOAD",
          model: "PREPAID",
          status: "RECORDED",
          settlement: "SETTLED",
        }),
      ])
    ).toBe(0));
  it("linked card tags add no second payment coverage", () =>
    expect(
      specialCoverage([
        operation({
          model: "EXISTING_PAYMENT",
          status: "RECORDED",
          paymentId: "payment",
        }),
      ])
    ).toBe(0));
  it("keeps three card categories distinct while aggregating Excel view", () => {
    const t = operationalTotals([
      operation({ status: "RECORDED", kind: "TTS", amountMinor: 1000 }),
      operation({ status: "RECORDED", kind: "GIFT_USE", amountMinor: 2000 }),
      operation({ status: "RECORDED", kind: "GIFT_LOAD", amountMinor: 9000 }),
      operation({ status: "RECORDED", kind: "PARTNER", amountMinor: 3000 }),
    ]);
    expect(t.excelTtsGiftMinor).toBe(3000);
    expect(t.partnerMinor).toBe(3000);
    expect(t.giftLoadMinor).toBe(9000);
  });
  it("draft and void records do not enter financial/volume totals", () =>
    expect(
      operationalTotals([
        operation(),
        operation({ status: "VOID", model: "RECEIVABLE" }),
      ])
    ).toMatchObject({ ttsMinor: 0, specialCoverageMinor: 0, draftCount: 1 }));
  it("reserves recorded gift use against settled loads only", () => {
    const w = [
      operation({
        kind: "GIFT_LOAD",
        status: "RECORDED",
        model: "PREPAID",
        instrument: "MASK",
        settlement: "SETTLED",
        amountMinor: 5000,
      }),
      operation({
        kind: "GIFT_LOAD",
        status: "RECORDED",
        model: "PREPAID",
        instrument: "MASK",
        settlement: "PENDING",
        amountMinor: 9000,
      }),
      operation({
        kind: "GIFT_USE",
        status: "RECORDED",
        model: "PREPAID",
        instrument: "MASK",
        amountMinor: 3000,
      }),
    ];
    expect(giftBalance(w, "DEMO", "MASK")).toBe(2000);
    expect(giftBalance(w, "OTHER", "MASK")).toBe(0);
  });
});
describe("Özel işlem kilitleri ve bağımsız model kararı", () => {
  it("blocks non-DEMO writes", async () => {
    memory.demo = false;
    await expect(addSpecial(c, account, 7, {})).rejects.toMatchObject({
      code: "DEMO_REQUIRED",
    });
    expect(memory.writes).toHaveLength(0);
  });
  it.each(["SUBMITTED", "IN_REVIEW", "ACCEPTED", "ACCEPTED_WITH_PENDING"])(
    "locks %s financial records",
    async status => {
      await expect(
        addSpecial(c, { ...account, status }, 7, {})
      ).rejects.toMatchObject({ code: "ACCOUNT_LOCKED" });
      expect(memory.writes).toHaveLength(0);
    }
  );
  it("requires a meter account", async () => {
    memory.batch = false;
    await expect(addSpecial(c, account, 7, {})).rejects.toMatchObject({
      code: "FUEL_NOT_STARTED",
    });
  });
  it("requires independent model approval", async () => {
    await expect(
      reviewSpecial(c, account, 7, { ...proof, model: "RECEIVABLE" })
    ).rejects.toMatchObject({ code: "SELF_APPROVAL_FORBIDDEN" });
  });
  it("rejects using gift load as customer credit", async () => {
    memory.operation = raw({ kind: "GIFT_LOAD", volume_ml: 0 });
    await expect(
      reviewSpecial(c, account, 8, { ...proof, model: "RECEIVABLE" })
    ).rejects.toMatchObject({ code: "SPECIAL_MODEL_INVALID" });
  });
  it("requires matching payment amount and the same account", async () => {
    memory.payment = { amount_minor: 999, kind: "CASH", status: "POSTED" };
    await expect(
      reviewSpecial(c, account, 8, {
        ...proof,
        model: "EXISTING_PAYMENT",
        paymentId: proof.operationId,
      })
    ).rejects.toMatchObject({ code: "PAYMENT_LINK_INVALID" });
  });
  it("cannot classify old receivable collection as fuel sale", async () => {
    memory.payment = {
      amount_minor: 1000,
      kind: "AR_COLLECTION",
      status: "POSTED",
    };
    await expect(
      reviewSpecial(c, account, 8, {
        ...proof,
        model: "EXISTING_PAYMENT",
        paymentId: proof.operationId,
      })
    ).rejects.toMatchObject({ code: "PAYMENT_LINK_INVALID" });
  });
  it("rejects gift spending without confirmed load", async () => {
    memory.operation = raw({ kind: "GIFT_USE", instrument: "MASK" });
    await expect(
      reviewSpecial(c, account, 8, { ...proof, model: "PREPAID" })
    ).rejects.toMatchObject({ code: "GIFT_BALANCE_INSUFFICIENT" });
  });
  it("preserves current payment when merely adding an operational label", async () => {
    memory.payment = { amount_minor: 1000, kind: "CASH", status: "POSTED" };
    await reviewSpecial(c, account, 8, {
      ...proof,
      model: "EXISTING_PAYMENT",
      paymentId: proof.operationId,
    });
    expect(
      memory.writes.some(w =>
        /UPDATE st_payments|INSERT INTO st_payments/.test(w.sql)
      )
    ).toBe(false);
  });
  it("prevents self settlement", async () => {
    await expect(settleSpecial(c, account, 7, proof)).rejects.toMatchObject({
      code: "SELF_APPROVAL_FORBIDDEN",
    });
  });
  it("does not invent cash collections on provider claims", async () => {
    memory.operation = raw({
      status: "RECORDED",
      model: "RECEIVABLE",
      settlement: "PENDING",
    });
    await expect(
      settleSpecial(c, account, 8, { ...proof, method: "CASH" })
    ).rejects.toMatchObject({ code: "SETTLEMENT_METHOD_INVALID" });
  });
  it("prevents owner from voiding independently reviewed cards", async () => {
    memory.operation = raw({ status: "RECORDED", model: "RECEIVABLE" });
    await expect(voidSpecial(c, account, 7, proof)).rejects.toMatchObject({
      code: "SELF_APPROVAL_FORBIDDEN",
    });
  });
});
describe("Excel/PDF içerik güvenliği", () => {
  it("generates an OOXML ZIP, not a renamed CSV", () => {
    const bytes = xlsxBytes([
      { name: "İcmal", rows: [["=HYPERLINK(test)", "<script>", 123.45, null]] },
    ]);
    expect(Array.from(bytes.slice(0, 4))).toEqual([80, 75, 3, 4]);
    const text = new TextDecoder().decode(bytes);
    expect(text).toContain('t="inlineStr"');
    expect(text).toContain("=HYPERLINK(test)");
    expect(text).not.toContain("<f>");
    expect(text).toContain("&lt;script&gt;");
    expect(text).toContain("<v>123.45</v>");
  });
  it("escapes HTML/XML injection", () =>
    expect(xmlEscape('<img src=x onerror="x">&')).toBe(
      "&lt;img src=x onerror=&quot;x&quot;&gt;&amp;"
    ));
  it("keeps missing stock distinct from zero", () => {
    const sheets = icmalSheets([], "DEMO", "2026-11-05");
    expect(sheets.map(s => s.name)).toEqual([
      "Vardiya icmali",
      "Özel işlemler",
      "Tank hareketleri",
      "Sayaç okumaları",
    ]);
  });
});

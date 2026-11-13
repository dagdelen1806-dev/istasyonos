import { beforeEach, describe, it, expect, vi } from "vitest";
import {
  numericComparison,
  type DailyNumericRow,
  type NumericEquipment,
  type NumericAccount,
} from "../../shared/daily-numeric";
import { scopeNumericContextToStaff } from "./daily-numeric";
const ids = {
  page: "11111111-1111-4111-8111-111111111111",
  meterPage: "22222222-2222-4222-8222-222222222222",
  tankPage: "33333333-3333-4333-8333-333333333333",
  cardPage: "44444444-4444-4444-8444-444444444444",
  nozzle: "55555555-5555-4555-8555-555555555555",
  tank: "66666666-6666-4666-8666-666666666666",
  fuel: "77777777-7777-4777-8777-777777777777",
  shift: "88888888-8888-4888-8888-888888888888",
  package: "99999999-9999-4999-8999-999999999999",
};
const equipment: NumericEquipment[] = [
  {
    id: ids.nozzle,
    label: "DEMO tabanca",
    tankId: ids.tank,
    tank: "DEMO tank",
    pump: "DEMO pompa",
    fuelId: ids.fuel,
    fuel: "DEMO yakıt",
  },
];
const account = (): NumericAccount => ({
  id: "a",
  userId: 17,
  revision: 1,
  status: "OPEN",
  closed: true,
  specialPending: false,
  nozzles: [
    {
      id: ids.nozzle,
      openingMl: 100000,
      closingMl: 202000,
      meterMl: 102000,
      meterMinor: 510000,
      commercialMl: 100000,
      commercialMinor: 500000,
    },
  ],
  tenders: {
    CASH: 300000,
    CARD: 100000,
    IBAN: 10000,
    DEBT: 50000,
    TTS: 20000,
    GIFT_LOAD: 5000,
    GIFT_USE: 10000,
    PARTNER: 10000,
    TTS_GIFT_COMBINED: 30000,
  },
});
const sale: DailyNumericRow = {
  kind: "SALES",
  pageId: ids.page,
  label: "DEMO satış",
  fuelId: ids.fuel,
  basis: "COMMERCIAL",
  volumeMl: 100000,
  amountMinor: 500000,
};
const meter: DailyNumericRow = {
  kind: "METER",
  pageId: ids.meterPage,
  label: "DEMO sayaç",
  nozzleId: ids.nozzle,
  openingMl: 100000,
  closingMl: 202000,
  reportedMl: 102000,
};
const tank: DailyNumericRow = {
  kind: "TANK",
  pageId: ids.tankPage,
  label: "DEMO tank çıkış",
  tankId: ids.tank,
  openingMl: 200000,
  closingMl: 109000,
  deliveryMl: 10000,
  returnMl: 1000,
};
const pageKinds = [
  { id: ids.page, kind: "SALES" },
  { id: ids.meterPage, kind: "METERS" },
  { id: ids.tankPage, kind: "TANK" },
  { id: ids.cardPage, kind: "CARDS" },
];
const m = vi.hoisted(() => ({
  demo: true,
  doc: true,
  source: null as any,
  pages: [] as any[],
  equipment: [] as any[],
  history: [] as any[],
  shift: null as any,
  staff: [] as any[],
  writes: [] as { sql: string; params: any[] }[],
}));
vi.mock("./db", () => ({
  first: vi.fn(async (_: unknown, sql: string, p: any[]) => {
    if (sql.includes("information_schema.COLUMNS")) return { count: 0 };
    if (sql.includes("FROM st_tenants")) return { is_demo: m.demo ? 1 : 0 };
    if (sql.includes("FROM st_stations")) return { id: "s" };
    if (sql.includes("FROM st_daily_report_packages"))
      return m.doc ? { id: p[0] } : null;
    if (sql.includes("FROM st_daily_report_reviews")) return m.source;
    if (sql.includes("FROM st_shifts"))
      return p[0] === m.shift?.id ? m.shift : null;
    throw Error(sql);
  }),
  rows: vi.fn(async (_: unknown, sql: string) => {
    if (sql.includes("FROM st_members")) return m.staff;
    if (sql.includes("FROM st_daily_report_pages")) return m.pages;
    if (sql.includes("FROM st_daily_numeric_reviews")) return m.history;
    if (sql.includes("FROM st_shifts")) return m.shift ? [m.shift] : [];
    if (sql.includes("FROM st_fuel_nozzles")) return m.equipment;
    throw Error(sql);
  }),
  execute: vi.fn(async (_: unknown, sql: string, params: any[]) => {
    m.writes.push({ sql, params });
  }),
}));
import {
  validateNumericRows,
  numericContext,
  saveNumericDraft,
} from "./daily-numeric";
const c = {} as any,
  scope = { tenantId: "t", stationId: "s" },
  load = vi.fn(async () => [account()]);
beforeEach(() => {
  m.demo = true;
  m.doc = true;
  m.source = {
    revision: 1,
    decision: "REVIEWED_DRAFT",
    report_day: "2026-11-05",
    page_kinds_json: JSON.stringify(
      pageKinds.map(p => ({ pageId: p.id, kind: p.kind }))
    ),
  };
  m.pages = pageKinds.map(p => ({ id: p.id }));
  m.equipment = equipment.map(e => ({ ...e, fuelTypeId: e.fuelId }));
  m.history = [];
  m.staff = [{ userId: 17, name: "DEMO ÖSSE" }];
  m.shift = {
    id: ids.shift,
    label: "DEMO vardiya",
    starts_at: "2026-11-05 05:00:00.000",
  };
  m.writes = [];
  load.mockReset();
  load.mockResolvedValue([account()]);
});
describe("integer daily comparison", () => {
  it("separates commercial sale, meter and physical tank out", () => {
    const r = numericComparison([sale, meter, tank], equipment, [account()]);
    expect(r.complete).toBe(true);
    expect(r.rows[0].cells.map(c => c.difference)).toEqual([0, 0]);
    expect(r.rows[1].cells.map(c => c.difference)).toEqual([0, 0, 0]);
    expect(r.rows[2].cells[0]).toMatchObject({
      source: 102000,
      current: 102000,
      difference: 0,
    });
  });
  it("compares meter price totals separately from commercial sales", () => {
    const r = numericComparison(
      [{ ...sale, basis: "METER", volumeMl: 102000, amountMinor: 510000 }],
      equipment,
      [account()]
    );
    expect(r.rows[0].cells.map(c => c.difference)).toEqual([0, 0]);
  });
  it("compares a source personnel row to only that person's own account", () => {
    const staffSale: DailyNumericRow = {
      kind: "STAFF_SALES",
      pageId: ids.page,
      label: "DEMO personel satışı",
      staffUserId: 17,
      fuelId: ids.fuel,
      basis: "COMMERCIAL",
      transactionCount: 4,
      volumeMl: 100000,
      amountMinor: 500000,
    };
    const result = numericComparison([staffSale], equipment, [account()]);
    expect(result.rows[0].cells.map(cell => cell.difference)).toEqual([
      null,
      0,
      0,
    ]);
    expect(result.rows[0].warnings.join(" ")).toContain(
      "istasyon toplamına eklenmez"
    );
    expect(
      numericComparison(
        [staffSale],
        [...equipment, { ...equipment[0], id: ids.cardPage }],
        [account()]
      ).rows[0].cells[1].current
    ).toBe(100000);
    expect(
      numericComparison([staffSale], equipment, [{ ...account(), userId: 18 }])
        .rows[0].cells[1].current
    ).toBeNull();
  });
  it("keeps staff tender source categories separate from fuel sale", () => {
    const row: DailyNumericRow = {
      kind: "STAFF_TENDER",
      pageId: ids.cardPage,
      label: "DEMO slip toplamı",
      staffUserId: 17,
      category: "CARD",
      transactionCount: 2,
      amountMinor: 100000,
    };
    expect(
      numericComparison([row], equipment, [account()]).rows[0].cells
    ).toMatchObject([
      { source: 2, current: null, unit: "COUNT" },
      { source: 100000, current: 100000, difference: 0, unit: "TRY" },
    ]);
  });
  it("keeps signed litre and kuruş differences separate", () => {
    const r = numericComparison(
      [{ ...sale, volumeMl: 99999, amountMinor: 500001 }],
      equipment,
      [account()]
    );
    expect(r.rows[0].cells.map(c => c.difference)).toEqual([-1, 1]);
  });
  it("does not turn missing source values into zero", () => {
    const r = numericComparison([{ ...sale, volumeMl: null }], equipment, [
      account(),
    ]);
    expect(r.rows[0].cells[0]).toMatchObject({
      source: null,
      current: 100000,
      difference: null,
    });
  });
  it("does not present zero for an absent shift", () =>
    expect(
      numericComparison([sale], equipment, []).rows[0].cells[0].current
    ).toBeNull());
  it("does not compare incomplete current batches", () => {
    const a = account();
    a.closed = false;
    expect(
      numericComparison([sale, meter], equipment, [a])
        .rows.flatMap(r => r.cells)
        .every(c => c.current === null)
    ).toBe(true);
  });
  it("blocks partial fuel coverage", () => {
    const e = [...equipment, { ...equipment[0], id: ids.cardPage }];
    expect(
      numericComparison([sale], e, [account()]).rows[0].cells[0].current
    ).toBeNull();
  });
  it("does not compare duplicate nozzle assignments", () =>
    expect(
      numericComparison([meter], equipment, [
        account(),
        { ...account(), id: "b" },
      ]).rows[0].cells[0].current
    ).toBeNull());
  it("flags source meter regression and separately reported mismatch", () => {
    expect(
      numericComparison([{ ...meter, closingMl: 99999 }], equipment, [
        account(),
      ]).rows[0].warnings.join(" ")
    ).toContain("geriliyor");
    expect(
      numericComparison([{ ...meter, reportedMl: 1 }], equipment, [
        account(),
      ]).rows[0].warnings.join(" ")
    ).toContain("uyuşmuyor");
  });
  it("does not infer physical returns from blank", () =>
    expect(
      numericComparison([{ ...tank, returnMl: null }], equipment, [account()])
        .rows[0].cells[0].source
    ).toBeNull());
  it("keeps TTS, gift and partner separate; combined is comparison only", () => {
    const r = numericComparison(
      ["TTS", "GIFT_LOAD", "GIFT_USE", "PARTNER", "TTS_GIFT_COMBINED"].map(
        category =>
          ({
            kind: "TENDER",
            pageId: ids.cardPage,
            label: category,
            category,
            amountMinor: 1,
          }) as DailyNumericRow
      ),
      equipment,
      [account()]
    );
    expect(r.rows.map(r => r.cells[0].current)).toEqual([
      20000, 5000, 10000, 10000, 30000,
    ]);
    expect(r.rows[1].warnings.join(" ")).toContain("ilave gelir sayılmaz");
    expect(r.rows[4].warnings.join(" ")).toContain("eklenmez");
  });
  it("keeps unknown card model unclassified", () =>
    expect(
      numericComparison(
        [
          {
            kind: "TENDER",
            pageId: ids.page,
            label: "DEMO bilinmiyor",
            category: "OTHER",
            amountMinor: 100,
          },
        ],
        equipment,
        [account()]
      ).rows[0].cells[0].current
    ).toBeNull());
  it("requires a declared sale basis", () =>
    expect(
      numericComparison([{ ...sale, basis: "UNDECIDED" }], equipment, [
        account(),
      ]).rows[0].cells[0].current
    ).toBeNull());
  it("rejects unsafe physical sum", () =>
    expect(() =>
      numericComparison(
        [{ ...tank, openingMl: Number.MAX_SAFE_INTEGER, deliveryMl: 1 }],
        equipment,
        [account()]
      )
    ).toThrow());
});
describe("source numeric validation", () => {
  it("accepts mapped source rows", () =>
    expect(
      validateNumericRows([sale, meter, tank], pageKinds, equipment, true)
    ).toHaveLength(3));
  it("accepts station-authorized personnel report rows and rejects foreign identity", () => {
    const row: DailyNumericRow = {
      kind: "STAFF_SALES",
      pageId: ids.page,
      label: "DEMO personel satırı",
      staffUserId: 17,
      fuelId: ids.fuel,
      basis: "COMMERCIAL",
      transactionCount: 4,
      volumeMl: 100000,
      amountMinor: 500000,
    };
    expect(
      validateNumericRows([row], pageKinds, equipment, true, [
        { userId: 17, name: "DEMO ÖSSE" },
      ])
    ).toHaveLength(1);
    expect(() =>
      validateNumericRows([row], pageKinds, equipment, true, [
        { userId: 18, name: "Diğer istasyon personeli" },
      ])
    ).toThrow("Personel kimliği");
  });
  it("requires transaction counts and rejects duplicate staff/category lines", () => {
    const staff = [{ userId: 17, name: "DEMO ÖSSE" }],
      tender: DailyNumericRow = {
        kind: "STAFF_TENDER",
        pageId: ids.cardPage,
        label: "DEMO FAST",
        staffUserId: 17,
        category: "FAST",
        transactionCount: 2,
        amountMinor: 250000,
      };
    expect(() =>
      validateNumericRows(
        [{ ...tender, transactionCount: null }],
        pageKinds,
        equipment,
        true,
        staff
      )
    ).toThrow();
    expect(() =>
      validateNumericRows(
        [tender, { ...tender, label: "DEMO FAST tekrar" }],
        pageKinds,
        equipment,
        true,
        staff
      )
    ).toThrow();
    expect(() =>
      validateNumericRows(
        [{ ...tender, category: "OTHER" }],
        pageKinds,
        equipment,
        true,
        staff
      )
    ).toThrow();
  });
  it("preserves null values and regression only as pending draft", () =>
    expect(
      validateNumericRows(
        [{ ...meter, nozzleId: null, closingMl: 1, reportedMl: null }],
        pageKinds,
        equipment
      )
    ).toMatchObject([{ nozzleId: null, closingMl: 1, reportedMl: null }]));
  it.each([
    { volumeMl: -1 },
    { volumeMl: 1.2 },
    { amountMinor: Infinity },
    { amountMinor: Number.MAX_SAFE_INTEGER + 1 },
  ])("rejects invalid numeric input %o", patch =>
    expect(() =>
      validateNumericRows([{ ...sale, ...patch }], pageKinds, equipment)
    ).toThrow()
  );
  it("forbids foreign photo and equipment", () => {
    expect(() =>
      validateNumericRows(
        [{ ...sale, pageId: ids.shift }],
        pageKinds,
        equipment
      )
    ).toThrow();
    expect(() =>
      validateNumericRows(
        [{ ...meter, nozzleId: ids.shift }],
        pageKinds,
        equipment
      )
    ).toThrow();
  });
  it("rejects duplicate mapped source even across pages", () =>
    expect(() =>
      validateNumericRows(
        [sale, { ...sale, label: "DEMO tekrar", pageId: ids.cardPage }],
        pageKinds,
        equipment
      )
    ).toThrow());
  it("rejects mismatched page type on verification", () =>
    expect(() =>
      validateNumericRows(
        [{ ...meter, pageId: ids.page }],
        pageKinds,
        equipment,
        true
      )
    ).toThrow());
  it.each([{ nozzleId: null }, { closingMl: 1 }, { reportedMl: 1 }])(
    "blocks contradictory confirmed meter %o",
    patch =>
      expect(() =>
        validateNumericRows(
          [{ ...meter, ...patch }],
          pageKinds,
          equipment,
          true
        )
      ).toThrow()
  );
  it("blocks unknown LPG mapping and missing tank movement fields", () =>
    expect(() =>
      validateNumericRows(
        [{ ...tank, tankId: null, returnMl: null }],
        pageKinds,
        equipment,
        true
      )
    ).toThrow());
  it("cannot verify an undecided commercial basis or card model", () => {
    expect(() =>
      validateNumericRows(
        [{ ...sale, basis: "UNDECIDED" }],
        pageKinds,
        equipment,
        true
      )
    ).toThrow();
    expect(() =>
      validateNumericRows(
        [
          {
            kind: "TENDER",
            pageId: ids.cardPage,
            label: "DEMO kart",
            category: "OTHER",
            amountMinor: 1,
          },
        ],
        pageKinds,
        equipment,
        true
      )
    ).toThrow();
  });
});
async function body() {
  const ctx = await numericContext(c, scope, ids.package, ids.shift, load);
  return {
    packageId: ids.package,
    shiftId: ids.shift,
    expectedRevision: 0,
    expectedSourceRevision: 1,
    expectedSnapshotHash: ctx.currentSnapshotHash,
    decision: "VERIFIED_DRAFT",
    sourceConfirmed: true,
    shiftConfirmed: true,
    rows: [sale, meter, tank],
    note: "DEMO sayılar kaynaktan kontrol edildi",
    evidence: "DEMO sentetik kaynak",
  };
}
describe("numeric draft scope and revisions", () => {
  async function keepHistory() {
    const ctx = await numericContext(c, scope, ids.package, ids.shift, load);
    m.history = [
      {
        revision: 1,
        source_revision: 1,
        shift_id: ids.shift,
        decision: "VERIFIED_DRAFT",
        rows_json: JSON.stringify([sale]),
        snapshot_hash: ctx.currentSnapshotHash,
        comparison_json: JSON.stringify(
          numericComparison([sale], equipment, [account()])
        ),
        source_confirmed: 1,
        shift_confirmed: 1,
        note: "DEMO önceki inceleme",
        evidence: "DEMO önceki kanıt",
        created_at: "2026-11-06 08:00:00.000",
        reviewer_name: "DEMO test",
      },
    ];
  }
  it("preserves saved comparison when current source changes", async () => {
    await keepHistory();
    m.source.revision = 2;
    const ctx = await numericContext(c, scope, ids.package, undefined, load);
    expect(ctx.stale).toBe(true);
    expect(ctx.history[0].savedComparison.rows[0].cells[0].difference).toBe(0);
    expect(ctx.latest?.sourceRevision).toBe(1);
    expect(m.writes).toHaveLength(0);
  });
  it("marks changed current accounts stale without rewriting old comparison", async () => {
    await keepHistory();
    const a = account();
    a.revision = 2;
    a.nozzles[0].commercialMl = 99999;
    load.mockResolvedValue([a]);
    const ctx = await numericContext(c, scope, ids.package, undefined, load);
    expect(ctx.stale).toBe(true);
    expect(ctx.comparison.rows[0].cells[0].difference).toBe(1);
    expect(ctx.history[0].savedComparison.rows[0].cells[0].difference).toBe(0);
  });
  it("shows unlinked current comparison if source day changed, preserving old mapping", async () => {
    await keepHistory();
    m.source.report_day = "2026-11-06";
    const ctx = await numericContext(c, scope, ids.package, undefined, load);
    expect(ctx.selectedShiftId).toBeNull();
    expect(ctx.latest?.shiftId).toBe(ids.shift);
    expect(ctx.stale).toBe(true);
    expect(ctx.comparison.warnings.join(" ")).toContain(
      "yeni kaynak rapor gününe uymuyor"
    );
  });
  it("rejects another review arriving before save", async () => {
    const b = await body();
    await keepHistory();
    await expect(saveNumericDraft(c, scope, 7, b, load)).rejects.toMatchObject({
      code: "REVISION_CONFLICT",
    });
  });
  it("requires DEMO before any write", async () => {
    const b = await body();
    m.demo = false;
    await expect(saveNumericDraft(c, scope, 7, b, load)).rejects.toMatchObject({
      code: "DEMO_REQUIRED",
    });
    expect(m.writes).toHaveLength(0);
  });
  it("does not reveal a foreign package", async () => {
    m.doc = false;
    await expect(
      numericContext(c, scope, ids.package, null, load)
    ).rejects.toMatchObject({ code: "DAILY_NOT_FOUND" });
  });
  it("rejects shift outside station", async () =>
    await expect(
      numericContext(c, scope, ids.package, ids.page, load)
    ).rejects.toMatchObject({ code: "DAILY_SHIFT_FORBIDDEN" }));
  it("rejects report/shift Turkey day mismatch", async () => {
    m.shift.starts_at = "2026-11-05 22:00:00.000";
    await expect(
      numericContext(c, scope, ids.package, ids.shift, load)
    ).rejects.toMatchObject({ code: "DAILY_SHIFT_DAY_MISMATCH" });
  });
  it("requires reviewed source and explicit confirmation", async () => {
    const b = await body();
    await expect(
      saveNumericDraft(c, scope, 7, { ...b, sourceConfirmed: false }, load)
    ).rejects.toMatchObject({ code: "DAILY_NUMERIC_CONFIRMATION" });
    m.source.decision = "PENDING";
    await expect(saveNumericDraft(c, scope, 7, b, load)).rejects.toMatchObject({
      code: "DAILY_NUMERIC_CONFIRMATION",
    });
  });
  it("rejects changed source revision", async () => {
    const b = await body();
    m.source.revision = 2;
    await expect(saveNumericDraft(c, scope, 7, b, load)).rejects.toMatchObject({
      code: "REVISION_CONFLICT",
    });
  });
  it("rejects stale financial snapshot", async () => {
    const b = await body();
    const a = account();
    a.revision = 2;
    load.mockResolvedValue([a]);
    await expect(saveNumericDraft(c, scope, 7, b, load)).rejects.toMatchObject({
      code: "DAILY_SNAPSHOT_CHANGED",
    });
  });
  it("appends only a numeric draft, never financial or stock records", async () => {
    const r = await saveNumericDraft(c, scope, 7, await body(), load);
    expect(r).toMatchObject({
      revision: 1,
      stockApplied: false,
      financialApplied: false,
    });
    expect(m.writes).toHaveLength(1);
    expect(m.writes[0].sql).toMatch(/^INSERT INTO st_daily_numeric_reviews /);
    const saved = JSON.parse(m.writes[0].params[8]);
    expect(saved.rows[0].cells[0].difference).toBe(0);
  });
  it("allows an unlinked pending source with unknowns", async () => {
    const ctx = await numericContext(c, scope, ids.package, null, load);
    const r = await saveNumericDraft(
      c,
      scope,
      7,
      {
        ...(await body()),
        shiftId: null,
        expectedSnapshotHash: ctx.currentSnapshotHash,
        decision: "PENDING",
        rows: [{ ...sale, fuelId: null, volumeMl: null }],
        sourceConfirmed: false,
        shiftConfirmed: false,
      },
      load
    );
    expect(r.decision).toBe("PENDING");
  });
});

describe("authorized staff read filtering", () => {
  it("filters report revisions, comparison rows, and accounts to the selected staff id", () => {
    const staffRow = (staffUserId: number) => ({
      kind: "STAFF_TENDER",
      staffUserId,
    });
    const context = {
      staff: [{ userId: 17 }, { userId: 18 }],
      accounts: [{ userId: 17 }, { userId: 18 }],
      latest: {
        rows: [staffRow(17), staffRow(18)],
        savedComparison: { rows: [staffRow(17), staffRow(18)] },
      },
      history: [
        {
          rows: [staffRow(17), staffRow(18)],
          savedComparison: { rows: [staffRow(17), staffRow(18)] },
        },
      ],
      comparison: { rows: [staffRow(17), staffRow(18)] },
    } as any;
    const result = scopeNumericContextToStaff(context, 17);
    expect(result.staff.map((person: any) => person.userId)).toEqual([17]);
    expect(result.accounts.map((account: any) => account.userId)).toEqual([17]);
    expect(result.latest.rows).toEqual([staffRow(17)]);
    expect(result.history[0].rows).toEqual([staffRow(17)]);
    expect(result.latest.savedComparison.rows).toEqual([staffRow(17)]);
    expect(result.history[0].savedComparison.rows).toEqual([staffRow(17)]);
    expect(result.comparison.rows).toEqual([staffRow(17)]);
  });

  it("refuses personnel outside this station/shift result", () => {
    const context = {
      staff: [{ userId: 17 }],
      accounts: [{ userId: 17 }],
      latest: null,
      history: [],
      comparison: { rows: [] },
    } as any;
    expect(() => scopeNumericContextToStaff(context, 18)).toThrow(
      "Personel bu vardiya ve istasyon kapsamında bulunamadı."
    );
  });
});

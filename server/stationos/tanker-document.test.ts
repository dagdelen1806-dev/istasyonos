import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import { createHash } from "node:crypto";
import {
  tankerCompleteness,
  type TankerValues,
} from "../../shared/tanker-document";
const id = {
  package: "11111111-1111-4111-8111-111111111111",
  page: "22222222-2222-4222-8222-222222222222",
  review: "33333333-3333-4333-8333-333333333333",
  fuel: "44444444-4444-4444-8444-444444444444",
  supplier: "55555555-5555-4555-8555-555555555555",
  tank: "66666666-6666-4666-8666-666666666666",
  read: "77777777-7777-4777-8777-777777777777",
};
const m = vi.hoisted(() => ({
  demo: true,
  doc: true,
  active: false,
  foreign: false,
  latest: null as any,
  read: null as any,
  reads: [] as any[],
  review: null as any,
  sourceHash: "",
  pages: [] as any[],
  writes: [] as any[],
  receipts: [] as any[],
}));
vi.mock("./db", () => ({
  first: vi.fn(async (_: unknown, sql: string, p: any[]) => {
    if (sql.includes("FROM st_tenants")) return { is_demo: m.demo ? 1 : 0 };
    if (sql.includes("FROM st_stations")) return { id: "s" };
    if (sql.includes("FROM st_daily_report_packages"))
      return m.doc
        ? {
            id: "11111111-1111-4111-8111-111111111111",
            document_kind: "TANKER",
          }
        : null;
    if (sql.includes("SELECT q.id FROM st_tanker_receipt_links"))
      return m.active ? { id: "active" } : null;
    if (sql.includes("SELECT r.* FROM st_tanker_document_reviews"))
      return m.review;
    if (sql.includes("SELECT r.*,x.line_key"))
      return m.review
        ? { ...m.review, line_key: "LINE-1", basis: "DISPATCH" }
        : null;
    if (sql.includes("FROM st_tanker_document_reviews")) return m.latest;
    if (sql.includes("SELECT id FROM st_tanker_document_reads")) {
      const stored = m.writes.find(
        w =>
          w.sql.includes("INSERT IGNORE INTO st_tanker_document_reads") &&
          w.p[1] === p[0] &&
          w.p[2] === p[1] &&
          w.p[3] === p[2]
      );
      return stored ? { id: stored.p[0] } : null;
    }
    if (sql.includes("FROM st_tanker_document_reads")) return m.read;
    if (sql.includes("FROM st_suppliers") || sql.includes("FROM st_fuel_types"))
      return m.foreign ? null : { id: p[0] };
    if (sql.includes("FROM st_fuel_tanks"))
      return {
        fuel_type_id: m.foreign
          ? "foreign"
          : "44444444-4444-4444-8444-444444444444",
      };
    throw Error(sql);
  }),
  rows: vi.fn(async (_: unknown, sql: string) => {
    if (sql.includes("FROM st_tanker_receipt_links")) return m.receipts;
    if (sql.includes("FROM st_daily_report_packages"))
      return [{ id: id.package, source_name: "DEMO.zip", page_count: 1 }];
    if (sql.includes("FROM st_tanker_document_reviews")) return [];
    if (
      sql.includes("FROM st_suppliers") ||
      sql.includes("FROM st_fuel_types") ||
      sql.includes("FROM st_tank_cards")
    )
      return [];
    if (sql.includes("FROM st_daily_report_pages")) return m.pages;
    if (sql.includes("FROM st_tanker_document_reads")) return m.reads;
    throw Error(sql);
  }),
  execute: vi.fn(async (_: unknown, sql: string, p: any[]) => {
    m.writes.push({ sql, p });
  }),
}));
vi.mock("./daily-ocr", () => ({
  readDailyOcr: vi.fn(async () => ({ id: "DEMO" })),
  getDailyOcr: vi.fn(async () => ({
    run: {
      payload: {
        engine: "windows-media-ocr",
        language: "tr",
        width: 100,
        height: 100,
        angle: null,
        confidence: null,
        lines: [],
        tokens: [],
        words: [],
        warnings: [],
      },
    },
  })),
}));
import {
  tankerProposalFromModel,
  validateTankerValues,
  tankerContext,
  saveTankerDocument,
  tankerOverview,
  readTankerDocument,
} from "./tanker-document";
import {
  prepareTankerReceipt,
  assertTankerReceiptCurrent,
} from "./tanker-proof";
import {
  extractTankerWithOpenAi,
  tankerExtractionSchema,
} from "./tanker-openai";
const c = {} as any,
  scope = { tenantId: "t", stationId: "s" };
const values = (): TankerValues => ({
  documentNo: "DEMO-DOC-01",
  issuer: "DEMO kaynak",
  documentDate: "2026-11-05",
  supplierId: id.supplier,
  pages: [{ pageId: id.page, number: 1, total: 1 }],
  lines: [
    {
      key: "LINE-1",
      label: "DEMO ürün",
      productCode: "DEMO-P1",
      fuelId: id.fuel,
      netMl: 9900,
      dispatchMl: 10000,
    },
  ],
});
beforeEach(() => {
  m.demo = true;
  m.doc = true;
  m.active = false;
  m.foreign = false;
  m.latest = null;
  m.read = null;
  m.reads = [];
  m.review = null;
  m.writes = [];
  m.receipts = [];
  const bytes = Buffer.from("DEMO tanker");
  m.pages = [
    {
      id: id.page,
      source_name: "DEMO.jpeg",
      source_sha256: createHash("sha256").update(bytes).digest("hex"),
      mime_type: "image/jpeg",
      image_bytes: bytes,
    },
  ];
});
afterEach(() => vi.unstubAllEnvs());
const raw = () => ({
  documentNo: "DEMO-DOC-01",
  issuer: "DEMO kaynak",
  documentDate: "2026-11-05",
  pages: [{ imageIndex: 1, number: 1, total: 2 }],
  lines: [
    {
      productCode: "DEMO-P1",
      label: "DEMO ürün",
      netText: "12.345,600",
      dispatchText: "12.400,000",
    },
  ],
  warnings: [],
});
describe("tanker source values", () => {
  it("falls back to a clearly local generic draft on unavailable Gemini without financial writes", async () => {
    vi.stubEnv("GEMINI_API_KEY", "");
    const ctx = await tankerContext(c, scope, id.package);
    const result = await readTankerDocument(c, scope, 1, {
      packageId: id.package,
      expectedSourceHash: ctx.sourceHash,
      provider: "GEMINI",
      documentType: "TANK",
      externalConfirmed: true,
    });
    expect(result.fallback).toBe(true);
    expect(result.message).toContain("yerel OCR");
    const insert = m.writes.find(w =>
      w.sql.includes("INSERT IGNORE INTO st_tanker_document_reads")
    );
    expect(insert.p[4]).toBe("LOCAL");
    expect(JSON.parse(insert.p[6]).values.documentFields).toEqual({
      kind: "TANK",
      fields: [],
    });
    expect(
      m.writes.every(w => w.sql.includes("st_tanker_document_reads"))
    ).toBe(true);
  });
  it("requires Gemini external consent before making a provider call", async () => {
    const ctx = await tankerContext(c, scope, id.package);
    await expect(
      readTankerDocument(c, scope, 1, {
        packageId: id.package,
        expectedSourceHash: ctx.sourceHash,
        provider: "GEMINI",
        externalConfirmed: false,
      })
    ).rejects.toMatchObject({ code: "GEMINI_CONSENT_REQUIRED" });
    expect(m.writes).toHaveLength(0);
  });
  it("shows receipt values from its own source revision and scopes receipt query", async () => {
    const source = values();
    m.receipts = [
      {
        requestId: id.review,
        lineKey: "LINE-1",
        basis: "DISPATCH",
        status: "PENDING",
        tankId: id.tank,
        sourceRevision: "2",
        sourceValues: JSON.stringify(source),
        documentMl: "10000",
        measuredMl: "9950",
        createdAt: "2026-11-06 10:00:00",
        note: "DEMO",
        evidence: "DEMO",
        reviewNote: null,
        reviewEvidence: null,
        creatorName: "DEMO",
        reviewerName: null,
      },
    ];
    const result = await tankerOverview(c, scope, id.package);
    expect(result.latest).toBeNull();
    expect(result.receipts[0]).toMatchObject({
      sourceRevision: 2,
      documentNo: source.documentNo,
      netMl: 9900,
      dispatchMl: 10000,
      documentMl: 10000,
      measuredMl: 9950,
      differenceMl: -50,
      reviewerName: null,
    });
    const { rows } = await import("./db");
    const call = vi
      .mocked(rows)
      .mock.calls.findLast(call =>
        String(call[1]).includes("FROM st_tanker_receipt_links")
      );
    expect(call?.[1]).toContain("q.tenant_id=? AND q.station_id=?");
    expect(call?.[2]).toEqual([id.package, scope.tenantId, scope.stationId]);
    expect(m.writes).toEqual([]);
  });
  it("keeps missing document or measured receipt quantities unknown", async () => {
    m.receipts = [
      {
        requestId: id.review,
        lineKey: "LINE-1",
        basis: "NET",
        status: "REJECTED",
        tankId: id.tank,
        sourceRevision: 1,
        sourceValues: JSON.stringify(values()),
        documentMl: null,
        measuredMl: null,
        createdAt: "2026-11-06 10:00:00",
      },
    ];
    expect(
      (await tankerOverview(c, scope, id.package)).receipts[0].differenceMl
    ).toBeNull();
  });
  it("keeps net and dispatch litres separate and never invents receipt quantity", () => {
    const p = tankerProposalFromModel(raw(), [id.page]);
    expect(p.values.lines[0]).toMatchObject({
      netMl: 12345600,
      dispatchMl: 12400000,
      fuelId: null,
    });
    expect(p.values).not.toHaveProperty("measuredMl");
  });
  it("preserves ambiguous/unknown source quantities as null", () => {
    const r = raw();
    r.lines[0].netText = "1.234";
    const p = tankerProposalFromModel(r, [id.page]);
    expect(p.values.lines[0].netMl).toBeNull();
    expect(p.warnings.join(" ")).toContain("Belirsiz");
  });
  it("does not convert a missing page into a complete document", () =>
    expect(
      tankerCompleteness({
        ...values(),
        pages: [{ pageId: id.page, number: 1, total: 2 }],
      })
    ).not.toHaveLength(0));
  it("requires page identity and unique page/product keys", () => {
    expect(() =>
      validateTankerValues(
        { ...values(), pages: [{ pageId: id.read, number: 1, total: 1 }] },
        [id.page]
      )
    ).toThrow();
    expect(() =>
      validateTankerValues(
        { ...values(), lines: [values().lines[0], values().lines[0]] },
        [id.page]
      )
    ).toThrow();
  });
  it("requires valid calendar date and integer litres", () => {
    expect(() =>
      validateTankerValues({ ...values(), documentDate: "2026-02-30" }, [
        id.page,
      ])
    ).toThrow();
    expect(() =>
      validateTankerValues(
        { ...values(), lines: [{ ...values().lines[0], netMl: 1.2 }] },
        [id.page]
      )
    ).toThrow();
  });
  it("requires explicit fuel and supplier mapping", () => {
    const v = values();
    v.supplierId = null;
    v.lines[0].fuelId = null;
    expect(tankerCompleteness(v)).not.toHaveLength(0);
  });
});
async function body() {
  const ctx = await tankerContext(c, scope, id.package);
  return {
    packageId: id.package,
    expectedSourceHash: ctx.sourceHash,
    expectedRevision: 0,
    readId: null,
    decision: "VERIFIED_DRAFT",
    sourceConfirmed: true,
    values: values(),
    note: "DEMO kaynak kontrolü",
    evidence: "DEMO evrak",
  };
}
describe("tanker review guards", () => {
  it("rejects non-DEMO before writes", async () => {
    m.demo = false;
    await expect(
      saveTankerDocument(c, scope, 7, { packageId: id.package })
    ).rejects.toMatchObject({ code: "DEMO_REQUIRED" });
    expect(m.writes).toHaveLength(0);
  });
  it("rejects foreign source and edited source bytes", async () => {
    m.doc = false;
    await expect(tankerContext(c, scope, id.package)).rejects.toMatchObject({
      code: "DAILY_NOT_FOUND",
    });
    m.doc = true;
    m.pages[0].image_bytes = Buffer.from("tampered");
    await expect(tankerContext(c, scope, id.package)).rejects.toMatchObject({
      code: "TANKER_SOURCE_CHANGED",
    });
  });
  it("rejects stale revision and foreign mapping", async () => {
    const b = await body();
    m.latest = { revision: 1 };
    await expect(saveTankerDocument(c, scope, 7, b)).rejects.toMatchObject({
      code: "REVISION_CONFLICT",
    });
    m.latest = null;
    m.foreign = true;
    await expect(saveTankerDocument(c, scope, 7, b)).rejects.toMatchObject({
      code: "SUPPLIER_FORBIDDEN",
    });
  });
  it("does not bypass missing-page evidence by omitting readId", async () => {
    const b = await body();
    m.reads = [
      {
        proposal_json: JSON.stringify(
          tankerProposalFromModel(raw(), [id.page])
        ),
      },
    ];
    await expect(saveTankerDocument(c, scope, 7, b)).rejects.toMatchObject({
      code: "TANKER_DOCUMENT_INCOMPLETE",
    });
  });
  it("requires source confirmation for verified draft", async () =>
    await expect(
      saveTankerDocument(c, scope, 7, {
        ...(await body()),
        sourceConfirmed: false,
      })
    ).rejects.toMatchObject({ code: "TANKER_DOCUMENT_INCOMPLETE" }));
  it("appends only an evrak review without inventory/money effects", async () => {
    const r = await saveTankerDocument(c, scope, 7, await body());
    expect(r).toMatchObject({ stockApplied: false, financialApplied: false });
    expect(m.writes).toHaveLength(1);
    expect(m.writes[0].sql).toContain("INSERT INTO st_tanker_document_reviews");
  });
  it("freezes source while native receipt is pending or approved", async () => {
    const b = await body();
    m.active = true;
    await expect(saveTankerDocument(c, scope, 7, b)).rejects.toMatchObject({
      code: "TANKER_RECEIPT_LOCKED",
    });
  });
});
async function receipt() {
  const b = await body();
  m.review = {
    id: id.review,
    package_id: id.package,
    revision: 1,
    decision: "VERIFIED_DRAFT",
    source_hash: b.expectedSourceHash,
    values_json: JSON.stringify(values()),
  };
  m.latest = { id: id.review, revision: 1 };
  return {
    kind: "DELIVERY",
    tankId: id.tank,
    supplierId: id.supplier,
    reference: "DEMO-DOC-01",
    documentMl: 10000,
    measuredMl: 9950,
    tankerDocument: {
      reviewId: id.review,
      lineKey: "LINE-1",
      basis: "DISPATCH",
    },
  };
}
describe("existing tank receipt integration", () => {
  it("does not affect old manual requests", async () =>
    expect(
      await prepareTankerReceipt(c, scope, { kind: "DELIVERY" })
    ).toBeNull());
  it("checks explicit basis and exact source, leaving physical measurement to native flow", async () => {
    const b = await receipt(),
      p = await prepareTankerReceipt(c, scope, b);
    expect(p).toMatchObject({ basis: "DISPATCH", reviewId: id.review });
    await expect(
      prepareTankerReceipt(c, scope, { ...b, documentMl: 9900 })
    ).rejects.toMatchObject({ code: "TANKER_RECEIPT_MISMATCH" });
  });
  it("rejects wrong tank fuel and duplicate native receipt", async () => {
    const b = await receipt();
    m.foreign = true;
    await expect(prepareTankerReceipt(c, scope, b)).rejects.toMatchObject({
      code: "TANKER_FUEL_MISMATCH",
    });
    m.foreign = false;
    m.active = true;
    await expect(prepareTankerReceipt(c, scope, b)).rejects.toMatchObject({
      code: "TANKER_DUPLICATE_RECEIPT",
    });
  });
  it("requires latest verified source for stock approval", async () => {
    await receipt();
    const q = {
      id: "request",
      tanker_review_id: id.review,
      supplier_id: id.supplier,
      reference: "DEMO-DOC-01",
      document_ml: 10000,
    } as any;
    await expect(
      assertTankerReceiptCurrent(c, scope, q)
    ).resolves.toBeUndefined();
    m.latest = { id: id.read };
    await expect(assertTankerReceiptCurrent(c, scope, q)).rejects.toMatchObject(
      { code: "TANKER_SOURCE_CHANGED" }
    );
  });
});
describe("strong OpenAI adapter, fake HTTP only", () => {
  it("rejects missing API key without a request", async () => {
    vi.stubEnv("OPENAI_API_KEY", "");
    const fetcher = vi.fn();
    await expect(
      extractTankerWithOpenAi(
        [{ mime: "image/jpeg", bytes: Buffer.from("DEMO") }],
        fetcher as any
      )
    ).rejects.toMatchObject({ code: "OPENAI_KEY_MISSING" });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("uses vision, strict schema, fixed endpoint and store:false without tool execution", async () => {
    vi.stubEnv("OPENAI_API_KEY", "test-not-live");
    vi.stubEnv("OPENAI_OCR_MODEL", "gpt-6-astra");
    const fetcher = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            status: "completed",
            output: [
              {
                content: [{ type: "output_text", text: JSON.stringify(raw()) }],
              },
            ],
          }),
          { status: 200 }
        )
    );
    const r = await extractTankerWithOpenAi(
        [{ mime: "image/jpeg", bytes: Buffer.from("DEMO") }],
        fetcher as any
      ),
      [url, init] = fetcher.mock.calls[0] as any,
      payload = JSON.parse(init.body);
    expect(url).toBe("https://api.openai.com/v1/responses");
    expect(payload).toMatchObject({
      model: "gpt-6-astra",
      store: false,
      text: { format: { strict: true, type: "json_schema" } },
    });
    expect(payload.input[0].content[1].type).toBe("input_image");
    expect(payload).not.toHaveProperty("tools");
    expect(r.raw.documentNo).toBe("DEMO-DOC-01");
    expect(tankerExtractionSchema.additionalProperties).toBe(false);
  });
  it.each([401, 429, 500])(
    "does not silently switch provider on HTTP %s",
    async status => {
      vi.stubEnv("OPENAI_API_KEY", "test-not-live");
      await expect(
        extractTankerWithOpenAi(
          [{ mime: "image/jpeg", bytes: Buffer.from("DEMO") }],
          vi.fn(async () => new Response("{}", { status })) as any
        )
      ).rejects.toMatchObject({ code: "OPENAI_ACCESS_ERROR" });
    }
  );
  it("rejects incomplete responses and refusal rather than storing fabricated values", async () => {
    vi.stubEnv("OPENAI_API_KEY", "test-not-live");
    for (const data of [
      { status: "incomplete", output: [] },
      { status: "completed", output: [{ content: [{ type: "refusal" }] }] },
    ])
      await expect(
        extractTankerWithOpenAi(
          [{ mime: "image/jpeg", bytes: Buffer.from("DEMO") }],
          vi.fn(async () => new Response(JSON.stringify(data))) as any
        )
      ).rejects.toThrow();
  });
});

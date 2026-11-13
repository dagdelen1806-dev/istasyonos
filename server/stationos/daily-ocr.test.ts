import { beforeEach, describe, it, expect, vi } from "vitest";
import { createHash } from "node:crypto";
import { ocrNumber, type OcrPayload } from "../../shared/daily-ocr";
import type { DailyNumericRow } from "../../shared/daily-numeric";
import { suggestOcrLayout } from "../../shared/daily-ocr-layout";
const m = vi.hoisted(() => ({
  demo: true,
  page: true,
  doc: true,
  saved: null as any,
  reference: null as any,
  native: null as any,
  bytes: Buffer.from("DEMO source"),
  mime: "image/jpeg",
  writes: [] as any[],
}));
vi.mock("./windows-ocr", () => ({
  OCR_ENGINE_VERSION: "windows-media-ocr-tr-numeric-v1",
  recognizeImage: vi.fn(async () => m.native),
}));
vi.mock("./db", () => ({
  first: vi.fn(async (_: unknown, sql: string) => {
    if (sql.includes("FROM st_tenants")) return { is_demo: m.demo ? 1 : 0 };
    if (sql.includes("FROM st_stations")) return { id: "s" };
    if (sql.includes("FROM st_daily_report_packages"))
      return m.doc ? { id: "11111111-1111-4111-8111-111111111111" } : null;
    if (sql.includes("JOIN st_daily_report_pages")) return m.reference;
    if (sql.includes("FROM st_daily_report_pages"))
      return m.page
        ? {
            id: "22222222-2222-4222-8222-222222222222",
            source_sha256: createHash("sha256")
              .update(Buffer.from("DEMO source"))
              .digest("hex"),
            mime_type: m.mime,
            image_bytes: m.bytes,
          }
        : null;
    if (sql.includes("FROM st_daily_ocr_runs")) return m.saved;
    throw Error(sql);
  }),
  execute: vi.fn(async (_: unknown, sql: string, p: any[]) => {
    m.writes.push({ sql, p });
    m.saved = {
      id: p[0],
      page_id: p[1],
      source_sha256: p[2],
      engine_version: p[3],
      payload_json: p[4],
      created_at: "2026-11-06 08:00:00.000",
    };
  }),
  rows: vi.fn(),
}));
import { recognizeImage } from "./windows-ocr";
import {
  buildOcrPayload,
  readDailyOcr,
  getDailyOcr,
  attachOcrEvidence,
} from "./daily-ocr";
const c = {} as any,
  scope = { tenantId: "t", stationId: "s" },
  pageId = "22222222-2222-4222-8222-222222222222",
  runId = "33333333-3333-4333-8333-333333333333",
  packageId = "11111111-1111-4111-8111-111111111111";
const sha = () =>
  createHash("sha256").update(Buffer.from("DEMO source")).digest("hex");
const word = (text: string) => ({ text, x: 1, y: 1, width: 100, height: 20 });
beforeEach(() => {
  m.demo = true;
  m.doc = true;
  m.page = true;
  m.saved = null;
  m.reference = null;
  m.bytes = Buffer.from("DEMO source");
  m.mime = "image/jpeg";
  m.writes = [];
  m.native = {
    width: 1000,
    height: 1000,
    angle: null,
    lines: [{ words: [word("1.234,56")] }],
  };
  vi.mocked(recognizeImage).mockClear();
});
describe("OCR number proposals never guess locale", () => {
  it("converts Turkish mixed separators exactly", () =>
    expect(ocrNumber("1.234,56").choices).toMatchObject([
      { normalized: "1234.56", ml: 1234560, minor: 123456 },
    ]));
  it("supports English mixed separators with a warning", () => {
    const r = ocrNumber("1,234.56");
    expect(r.choices[0].minor).toBe(123456);
    expect(r.warnings.length).toBeGreaterThan(0);
  });
  it("keeps dot-thousands and decimal interpretations separate", () => {
    const r = ocrNumber("1.234");
    expect(r.choices.map(c => c.ml)).toEqual([1234, 1234000]);
    expect(r.choices[0].minor).toBeNull();
    expect(r.choices[1].minor).toBe(123400);
    expect(r.warnings.join(" ")).toContain("belirsiz");
  });
  it("keeps comma-thousands and decimal interpretations separate", () =>
    expect(ocrNumber("12,345").choices.map(c => c.ml)).toEqual([
      12345, 12345000,
    ]));
  it("supports unambiguous three-decimal litres but not money", () => {
    const r = ocrNumber("11473,440");
    expect(r.choices).toMatchObject([{ ml: 11473440, minor: null }]);
  });
  it("preserves known zero", () =>
    expect(ocrNumber("0").choices[0]).toMatchObject({ ml: 0, minor: 0 }));
  it("offers a separate small-integer count only for a plain integer token", () => {
    expect(ocrNumber("27").choices[0].count).toBe(27);
    expect(ocrNumber("27,00").choices[0].count).toBeUndefined();
    expect(ocrNumber("12345678").choices[0].count).toBeUndefined();
  });
  it("does not fix letters into digits", () =>
    expect(ocrNumber("1O,50").choices).toHaveLength(0));
  it.each([
    "05.11.2026",
    "12345678901234567890123456789012345",
    "-2,95",
    "1.23.456",
    "5%",
    "12:30",
    "100,0000",
  ])("does not offer unsupported token %s", text =>
    expect(ocrNumber(text).choices).toHaveLength(0)
  );
  it("warns about long identifiers instead of inferring litres", () =>
    expect(ocrNumber("2026110501").warnings.join(" ")).toContain("referans"));
  it("supports multiple thousands groups without rounding", () =>
    expect(ocrNumber("1.234.567,890").choices[0]).toMatchObject({
      ml: 1234567890,
      minor: null,
    }));
});
describe("native OCR output validation", () => {
  it("retains source box and null confidence", () => {
    const p = buildOcrPayload(m.native);
    expect(p.confidence).toBeNull();
    expect(p.tokens[0]).toMatchObject({
      id: "0:0",
      raw: "1.234,56",
      box: { x: 1, y: 1, width: 100, height: 20 },
    });
  });
  it("does not persist likely card numbers or offer their fragments", () => {
    m.native.lines = [{ words: ["4111", "1111", "1111", "1111"].map(word) }];
    const p = buildOcrPayload(m.native);
    expect(p.tokens).toHaveLength(0);
    expect(JSON.stringify(p)).not.toContain("4111");
  });
  it("rejects image dimensions beyond budget", () =>
    expect(() => buildOcrPayload({ ...m.native, width: 20000 })).toThrow());
  it("rejects boxes beyond source image", () => {
    m.native.lines[0].words[0].width = 1001;
    expect(() => buildOcrPayload(m.native)).toThrow();
  });
  it("rejects unbounded line and word arrays", () => {
    expect(() =>
      buildOcrPayload({ ...m.native, lines: Array(1001).fill({ words: [] }) })
    ).toThrow();
    expect(() =>
      buildOcrPayload({
        ...m.native,
        lines: [{ words: Array(5001).fill(word("1")) }],
      })
    ).toThrow();
  });
});
describe("OCR source scope, caching and provenance", () => {
  it("rejects non-DEMO before recognition", async () => {
    m.demo = false;
    await expect(
      readDailyOcr(c, scope, 7, {
        packageId,
        pageId,
        expectedSourceSha256: sha(),
      })
    ).rejects.toMatchObject({ code: "DEMO_REQUIRED" });
    expect(recognizeImage).not.toHaveBeenCalled();
  });
  it("rejects foreign package/page and changed source", async () => {
    m.page = false;
    await expect(
      getDailyOcr(c, scope, packageId, pageId)
    ).rejects.toMatchObject({ code: "DAILY_PAGE_NOT_FOUND" });
    m.page = true;
    await expect(
      readDailyOcr(c, scope, 7, {
        packageId,
        pageId,
        expectedSourceSha256: "x",
      })
    ).rejects.toMatchObject({ code: "OCR_SOURCE_CHANGED" });
  });
  it("records only OCR output and reuses cache", async () => {
    const b = { packageId, pageId, expectedSourceSha256: sha() },
      r = await readDailyOcr(c, scope, 7, b);
    expect(r).toMatchObject({
      cached: false,
      stockApplied: false,
      financialApplied: false,
    });
    expect(m.writes[0].sql).toContain("INSERT IGNORE INTO st_daily_ocr_runs");
    expect(m.writes).toHaveLength(1);
    const cached = await readDailyOcr(c, scope, 7, b);
    expect(cached.id).toBe(r.id);
    expect(cached.cached).toBe(true);
    expect(recognizeImage).toHaveBeenCalledTimes(1);
  });
  it("runs the existing local OCR on a browser-rendered PDF page without changing source provenance", async () => {
    m.mime = "application/pdf";
    const rendered = Buffer.alloc(24);
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(rendered);
    Buffer.from([0, 0, 0, 0, 73, 69, 78, 68, 174, 66, 96, 130]).copy(rendered, 12);
    const result = await readDailyOcr(c, scope, 7, {
      packageId,
      pageId,
      expectedSourceSha256: sha(),
      pdfPageNumber: 2,
      renderedPageBase64: rendered.toString("base64"),
    });
    expect(result.cached).toBe(false);
    expect(vi.mocked(recognizeImage)).toHaveBeenCalledWith(rendered);
    expect(m.writes[0].p[2]).toBe(sha());
    expect(m.writes[0].p[3]).toContain("pdf-page-2");
    expect(JSON.parse(m.writes[0].p[4])).toMatchObject({
      sourcePageNumber: 2,
      renderedImageSha256: createHash("sha256").update(rendered).digest("hex"),
    });
  });
  it("rejects a PDF OCR render unless its page and image format are valid", async () => {
    m.mime = "application/pdf";
    await expect(readDailyOcr(c, scope, 7, {
      packageId, pageId, expectedSourceSha256: sha(), pdfPageNumber: 0,
      renderedPageBase64: Buffer.from("bad").toString("base64"),
    })).rejects.toMatchObject({ code: "OCR_PDF_PAGE_INVALID" });
    await expect(readDailyOcr(c, scope, 7, {
      packageId, pageId, expectedSourceSha256: sha(), pdfPageNumber: 1,
      renderedPageBase64: Buffer.from("bad").toString("base64"),
    })).rejects.toMatchObject({ code: "OCR_PDF_RENDER_INVALID" });
  });
  it("does not expose cache if source bytes changed", async () => {
    m.bytes = Buffer.from("tampered");
    await expect(
      getDailyOcr(c, scope, packageId, pageId)
    ).rejects.toMatchObject({ code: "DAILY_SOURCE_CHANGED" });
  });
  function provenance() {
    const payload = buildOcrPayload(m.native);
    m.reference = {
      id: runId,
      page_id: pageId,
      source_sha256: sha(),
      current_sha256: sha(),
      image_bytes: Buffer.from("DEMO source"),
      payload_json: JSON.stringify(payload),
    };
    return {
      runId,
      pageId,
      field: "amountMinor",
      tokenId: "0:0",
      choiceIndex: 0,
      confirmed: true,
    };
  }
  const row = (): DailyNumericRow => ({
    kind: "SALES",
    pageId,
    label: "DEMO satış",
    fuelId: null,
    basis: "UNDECIDED",
    volumeMl: null,
    amountMinor: 123456,
  });
  it("stores canonical OCR text, not a forged client copy", async () => {
    const ref = provenance(),
      rows = [row()];
    await attachOcrEvidence(c, scope, packageId, rows, [
      { ocr: [{ ...ref, rawText: "forged", proposedValue: 1 }] },
    ]);
    expect(rows[0].ocr?.[0]).toMatchObject({
      rawText: "1.234,56",
      proposedValue: 123456,
      corrected: false,
    });
  });
  it("accepts a count only from the OCR count interpretation and source token", async () => {
    m.native.lines = [{ words: [word("27")] }];
    const payload = buildOcrPayload(m.native);
    m.reference = {
      id: runId,
      page_id: pageId,
      source_sha256: sha(),
      current_sha256: sha(),
      image_bytes: Buffer.from("DEMO source"),
      payload_json: JSON.stringify(payload),
    };
    const staffRow: DailyNumericRow = {
      kind: "STAFF_SALES",
      pageId,
      label: "DEMO personel",
      staffUserId: 7,
      fuelId: null,
      basis: "UNDECIDED",
      transactionCount: 27,
      volumeMl: null,
      amountMinor: null,
    };
    const ref = {
      runId,
      pageId,
      tokenId: "0:0",
      choiceIndex: 0,
      field: "transactionCount",
      confirmed: true,
    } as const;
    await attachOcrEvidence(c, scope, packageId, [staffRow], [
      { ocr: [ref] },
    ]);
    expect(staffRow.ocr?.[0]).toMatchObject({
      field: "transactionCount",
      rawText: "27",
      proposedValue: 27,
    });
    await expect(
      attachOcrEvidence(c, scope, packageId, [staffRow], [
        { ocr: [{ ...ref, choiceIndex: 1 }] },
      ])
    ).rejects.toMatchObject({ code: "OCR_REFERENCE_INVALID" });
  });
  it("records human correction separately from original OCR", async () => {
    const ref = provenance(),
      rows = [{ ...row(), amountMinor: 123457 }];
    await attachOcrEvidence(c, scope, packageId, rows, [{ ocr: [ref] }]);
    expect(rows[0].ocr?.[0]).toMatchObject({
      proposedValue: 123456,
      corrected: true,
    });
  });
  it("requires explicit confirmation and unique field", async () => {
    const ref = provenance();
    await expect(
      attachOcrEvidence(
        c,
        scope,
        packageId,
        [row()],
        [{ ocr: [{ ...ref, confirmed: false }] }]
      )
    ).rejects.toMatchObject({ code: "OCR_REFERENCE_INVALID" });
    await expect(
      attachOcrEvidence(c, scope, packageId, [row()], [{ ocr: [ref, ref] }])
    ).rejects.toMatchObject({ code: "OCR_REFERENCE_INVALID" });
  });
  it("forbids unknown run, foreign page and changed bytes", async () => {
    const ref = provenance();
    m.reference = null;
    await expect(
      attachOcrEvidence(c, scope, packageId, [row()], [{ ocr: [ref] }])
    ).rejects.toMatchObject({ code: "OCR_REFERENCE_FORBIDDEN" });
    provenance();
    m.reference.page_id = runId;
    await expect(
      attachOcrEvidence(c, scope, packageId, [row()], [{ ocr: [ref] }])
    ).rejects.toMatchObject({ code: "OCR_REFERENCE_FORBIDDEN" });
    provenance();
    m.reference.image_bytes = Buffer.from("tampered");
    await expect(
      attachOcrEvidence(c, scope, packageId, [row()], [{ ocr: [ref] }])
    ).rejects.toMatchObject({ code: "OCR_REFERENCE_FORBIDDEN" });
  });
  it("rejects incompatible units and forged token indices", async () => {
    m.native.lines[0].words[0].text = "1.234";
    const ref = provenance();
    await expect(
      attachOcrEvidence(c, scope, packageId, [row()], [{ ocr: [ref] }])
    ).rejects.toMatchObject({ code: "OCR_REFERENCE_INVALID" });
    m.native.lines[0].words[0].text = "1,23";
    provenance();
    await expect(
      attachOcrEvidence(
        c,
        scope,
        packageId,
        [row()],
        [{ ocr: [{ ...ref, tokenId: "999:999" }] }]
      )
    ).rejects.toMatchObject({ code: "OCR_REFERENCE_INVALID" });
  });
  it("leaves manual rows untouched without a source read", async () => {
    const rows = [row()];
    await attachOcrEvidence(c, scope, packageId, rows, [{}]);
    expect(rows[0].ocr).toBeUndefined();
    expect(m.writes).toHaveLength(0);
  });
  function layoutProof() {
    const w = (text: string, x: number, y: number) => ({
      text,
      x,
      y,
      width: 80,
      height: 20,
    });
    m.native = {
      width: 1000,
      height: 1000,
      angle: 0,
      lines: [
        {
          words: [w("Yakıt", 20, 20), w("Litre", 300, 20), w("Tutar", 650, 20)],
        },
        {
          words: [
            w("DEMO-A", 20, 70),
            w("10,50", 300, 70),
            w("500,00", 650, 70),
          ],
        },
        {
          words: [
            w("DEMO-B", 20, 110),
            w("11,50", 300, 110),
            w("600,00", 650, 110),
          ],
        },
      ],
    };
    provenance();
    const payload: OcrPayload = JSON.parse(m.reference.payload_json),
      table = suggestOcrLayout(payload, "SALES").tables[0],
      r = table.rows[0];
    const refs = r.cells.map(cell => ({
      runId,
      pageId,
      field: cell.field,
      tokenId: cell.tokenIds[0],
      choiceIndex: 0,
      confirmed: true,
      layout: { version: 1, tableId: table.id, rowId: r.id, header: "forged" },
    }));
    return { refs, table };
  }
  it("recomputes row/column association and ignores forged heading", async () => {
    const { refs } = layoutProof(),
      values = [
        { ...row(), label: "DEMO-A", volumeMl: 10500, amountMinor: 50000 },
      ];
    await attachOcrEvidence(c, scope, packageId, values, [{ ocr: refs }]);
    expect(values[0].ocr?.[0].layout).toMatchObject({
      header: "Litre",
      rowLabel: "DEMO-A",
      labelCorrected: false,
    });
  });
  it("rejects forged column membership and mixed source rows", async () => {
    let { refs, table } = layoutProof();
    await expect(
      attachOcrEvidence(
        c,
        scope,
        packageId,
        [row()],
        [{ ocr: [{ ...refs[0], tokenId: table.rows[1].cells[0].tokenIds[0] }] }]
      )
    ).rejects.toMatchObject({ code: "OCR_LAYOUT_INVALID" });
    const second = {
      ...refs[1],
      tokenId: table.rows[1].cells[1].tokenIds[0],
      layout: { ...refs[1].layout, rowId: table.rows[1].id },
    };
    await expect(
      attachOcrEvidence(
        c,
        scope,
        packageId,
        [row()],
        [{ ocr: [refs[0], second] }]
      )
    ).rejects.toMatchObject({ code: "OCR_LAYOUT_MIXED_ROWS" });
  });
});

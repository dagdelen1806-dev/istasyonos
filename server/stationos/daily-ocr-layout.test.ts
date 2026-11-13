import { describe, it, expect } from "vitest";
import { buildOcrPayload } from "./daily-ocr";
import { suggestOcrLayout } from "../../shared/daily-ocr-layout";
const w = (text: string, x: number, y: number, width = 80) => ({
  text,
  x,
  y,
  width,
  height: 20,
});
function source(extra: any[] = []) {
  return buildOcrPayload({
    width: 1000,
    height: 1000,
    angle: 0,
    lines: [
      {
        words: [
          w("Yakıt", 20, 30),
          w("Litre(Lt)", 300, 30),
          w("Tutar(TL)", 600, 30),
        ],
      },
      {
        words: [w("DEMO-A", 20, 80), w("10,50", 300, 80), w("500,00", 600, 80)],
      },
      {
        words: [
          w("DEMO-B", 20, 120),
          w("1.234", 300, 120),
          w("600,00", 600, 120),
        ],
      },
      ...extra,
    ],
  });
}
describe("geometry based source rows and headers", () => {
  it("matches explicit litre/amount headers and source rows", () => {
    const p = source(),
      r = suggestOcrLayout(p, "SALES");
    expect(r.tables).toHaveLength(1);
    expect(r.tables[0].columns.map(c => c.field)).toEqual([
      "volumeMl",
      "amountMinor",
    ]);
    expect(r.tables[0].rows.map(r => r.label)).toEqual(["DEMO-A", "DEMO-B"]);
    expect(r.tables[0].rows.every(r => !r.blocked)).toBe(true);
  });
  it("maps a clearly labeled source count column only to personnel rows", () => {
    const p = buildOcrPayload({
      width: 1000,
      height: 1000,
      angle: 0,
      lines: [
        {
          words: [
            w("Personel", 20, 30),
            w("Islem Adedi", 220, 30, 120),
            w("Litre", 430, 30),
            w("Tutar", 700, 30),
          ],
        },
        {
          words: [
            w("DEMO-A", 20, 80),
            w("27", 220, 80, 30),
            w("10,50", 430, 80),
            w("500,00", 700, 80),
          ],
        },
      ],
    });
    const r = suggestOcrLayout(p, "STAFF_SALES");
    expect(r.tables[0].columns.map(c => c.field)).toEqual([
      "transactionCount",
      "volumeMl",
      "amountMinor",
    ]);
    const cell = r.tables[0].rows[0].cells[0];
    expect(cell.tokenIds).toEqual(["1:1"]);
    expect(p.tokens.find(t => t.id === "1:1")?.choices[0].count).toBe(27);
  });
  it("does not choose a decimal interpretation for a row", () => {
    const p = source(),
      r = suggestOcrLayout(p, "SALES"),
      cell = r.tables[0].rows[1].cells[0];
    expect(p.tokens.find(t => t.id === cell.tokenIds[0])?.choices).toHaveLength(
      2
    );
  });
  it("keeps count columns outside litre corridor", () => {
    const p = buildOcrPayload({
      width: 1000,
      height: 1000,
      angle: 0,
      lines: [
        {
          words: [
            w("Yakıt", 20, 30),
            w("Adet", 180, 30, 40),
            w("Litre", 350, 30),
            w("Tutar", 650, 30),
          ],
        },
        {
          words: [
            w("DEMO", 20, 80),
            w("7", 180, 80, 20),
            w("12,50", 350, 80),
            w("500,00", 650, 80),
          ],
        },
      ],
    });
    const r = suggestOcrLayout(p, "SALES");
    expect(r.tables[0].rows[0].cells[0].tokenIds).toEqual([
      p.tokens.find(t => t.raw === "12,50")!.id,
    ]);
  });
  it("blocks duplicate columns rather than picking one", () => {
    const p = source();
    p.words!.push({
      id: "extra",
      line: 0,
      text: "Tutar",
      box: { x: 850, y: 30, width: 80, height: 20 },
    });
    const r = suggestOcrLayout(p, "SALES");
    expect(r.tables[0].blocked).toBe(true);
  });
  it("blocks multiple numbers in one cell", () => {
    const p = source();
    const extra = buildOcrPayload({
      width: 1000,
      height: 1000,
      angle: 0,
      lines: [{ words: [w("8,00", 420, 80, 30)] }],
    });
    p.words!.push({ ...extra.words![0], id: "extra" });
    p.tokens.push({ ...extra.tokens[0], id: "extra" });
    expect(suggestOcrLayout(p, "SALES").tables[0].rows[0].blocked).toBe(true);
  });
  it("blocks aggregate rows from detail transfer", () => {
    const r = suggestOcrLayout(
      source([
        {
          words: [
            w("GENEL TOPLAM", 20, 160, 150),
            w("50,00", 300, 160),
            w("1000,00", 600, 160),
          ],
        },
      ]),
      "SALES"
    );
    expect(r.tables[0].rows.at(-1)!.blocked).toBe(true);
  });
  it("keeps missing cells empty rather than synthesizing zero", () => {
    const p = source();
    p.words = p.words!.filter(w => w.id !== "1:2");
    p.tokens = p.tokens.filter(t => t.id !== "1:2");
    const r = suggestOcrLayout(p, "SALES");
    expect(r.tables[0].rows[0].cells[1].tokenIds).toEqual([]);
  });
  it("does not infer field meaning from unsupported heading", () => {
    const p = source();
    p.words = p.words!.map(w =>
      w.line === 0 ? { ...w, text: "Bilinmeyen" } : w
    );
    expect(suggestOcrLayout(p, "SALES").tables).toHaveLength(0);
  });
  it("requires row label and rejects distant unrelated sections", () => {
    const p = source([
      {
        words: [
          w("UYUMSUZ", 20, 500),
          w("99,00", 300, 500),
          w("999,00", 600, 500),
        ],
      },
    ]);
    p.words = p.words!.filter(w => w.id !== "1:0");
    const r = suggestOcrLayout(p, "SALES");
    expect(r.tables[0].rows[0].blocked).toBe(true);
    expect(r.tables[0].rows.some(r => r.label === "UYUMSUZ")).toBe(false);
  });
  it("does not use legacy output or high-angle geometry", () => {
    const p = source();
    delete p.words;
    expect(suggestOcrLayout(p, "SALES").tables).toHaveLength(0);
    expect(
      suggestOcrLayout({ ...source(), angle: 6 }, "SALES").tables
    ).toHaveLength(0);
  });
  it("keeps tanker net and dispatch distinct from shift values", () => {
    const p = buildOcrPayload({
      width: 1000,
      height: 1000,
      angle: 0,
      lines: [
        {
          words: [
            w("Ürün", 20, 30),
            w("Net Hacim(L)", 300, 30, 140),
            w("Sevk Miktarı(L)", 650, 30, 180),
          ],
        },
        {
          words: [w("DEMO", 20, 80), w("10,50", 300, 80), w("10,80", 650, 80)],
        },
      ],
    });
    expect(
      suggestOcrLayout(p, "TANKER").tables[0].columns.map(c => c.field)
    ).toEqual(["netMl", "dispatchMl"]);
  });
  it("rejects over-limit header sets without truncation", () => {
    const p = buildOcrPayload({
      width: 1000,
      height: 5000,
      angle: 0,
      lines: Array.from({ length: 21 }, (_, i) => ({
        words: [w("Litre", 300, 30 + i * 100), w("Tutar", 650, 30 + i * 100)],
      })),
    });
    const r = suggestOcrLayout(p, "SALES");
    expect(r.tables).toHaveLength(0);
    expect(r.warnings.join(" ")).toContain("20");
  });
});

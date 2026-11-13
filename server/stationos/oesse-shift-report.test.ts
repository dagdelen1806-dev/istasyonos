import { describe, expect, it } from "vitest";
import {
  buildOesseShiftReportDraft,
  buildOesseShiftReportDraftFromOcr,
  hasCompleteOesseShiftReportEvidence,
  mappedOesseSaleForStaff,
  type OesseReportRowInput,
} from "../../shared/oesse-shift-report";

const sourceSha256 = "a".repeat(64);
const metadataText =
  "Vardiya İsmi : 2026110801\nVardiya Başlangıcı : 08.11.2026 - 08:44:26\nVardiya Bitişi : 09.11.2026 - 07:55:17";
const metadataSources = [
  { text: "Vardiya İsmi : 2026110801", sourceLocation: "Vardiya!A1:B1" },
  {
    text: "Vardiya Başlangıcı : 08.11.2026 - 08:44:26",
    sourceLocation: "Vardiya!A2:B2",
  },
  {
    text: "Vardiya Bitişi : 09.11.2026 - 07:55:17",
    sourceLocation: "Vardiya!A3:B3",
  },
];
const rows: OesseReportRowInput[] = [
  {
    cells: ["ÖSSE Adı", "Satış Adedi", "Satış Tutarı (TL)"],
    sourceLocation: "PDF sayfa 1, y=500",
  },
  {
    cells: ["GANDI", "172", "397.769,77"],
    sourceLocation: "PDF sayfa 1, y=480",
  },
  {
    cells: ["SÜLEYMAN", "104", "217.652,76"],
    sourceLocation: "PDF sayfa 1, y=460",
  },
  {
    cells: ["ŞAHİN", "200", "452.080,12"],
    sourceLocation: "PDF sayfa 1, y=440",
  },
  {
    cells: ["YUSUF", "251", "509.979,54"],
    sourceLocation: "PDF sayfa 1, y=420",
  },
  {
    cells: ["POMPACI", "727", "1.577.482,19"],
    sourceLocation: "PDF sayfa 1, y=400",
  },
  { cells: ["TTS", "14", "62.820,13"], sourceLocation: "PDF sayfa 1, y=380" },
  {
    cells: ["GIFT CARD", "2", "4.999,54"],
    sourceLocation: "PDF sayfa 1, y=360",
  },
  {
    cells: ["TOPLAM", "743", "1.645.301,86"],
    sourceLocation: "PDF sayfa 1, y=340",
  },
];

describe("automation shift report / OSEE sales draft", () => {
  it("requires source cell evidence for counts, amounts, and report totals", () => {
    const complete = buildOesseShiftReportDraft({
      rows: rows.map(row => ({
        ...row,
        cellLocations: row.cells.map(
          (_cell, index) => `${row.sourceLocation}!C${index + 1}`
        ),
      })),
      metadataText,
      metadataSources,
      sourceSha256,
    });
    expect(hasCompleteOesseShiftReportEvidence(complete)).toBe(true);
    const legacy = {
      ...complete!,
      staffRows: complete!.staffRows.map(row => ({
        ...row,
        sourceFields: undefined,
      })),
    };
    expect(hasCompleteOesseShiftReportEvidence(legacy as any)).toBe(false);
    expect(mappedOesseSaleForStaff(legacy as any, 101)).toBeNull();
  });

  it("checks four staff rows against POMPACI and total without assigning identities", () => {
    const draft = buildOesseShiftReportDraft({
      rows,
      metadataText,
      metadataSources,
      sourceSha256,
    });
    expect(draft).toMatchObject({
      reportType: "AUTOMATION_SHIFT_SALES",
      status: "READY_FOR_MAPPING",
      shiftId: "2026110801",
      startsAt: "2026-11-08T08:44:26",
      endsAt: "2026-11-09T07:55:17",
      metadataSourceFields: {
        shiftId: "Vardiya!A1:B1",
        startsAt: "Vardiya!A2:B2",
        endsAt: "Vardiya!A3:B3",
      },
      checks: {
        staffCountMatches: true,
        staffAmountMatches: true,
        generalAmountMatches: true,
        crossMidnight: true,
        duplicateReportDetectionKey: sourceSha256,
      },
      reportedStaffTotal: { transactionCount: 727, amountMinor: 157748219 },
      reportedGeneralTotal: { transactionCount: 743, amountMinor: 164530186 },
      financialApplied: false,
      independentDayEndSource: false,
    });
    expect(draft?.staffRows.map(row => row.staffUserId)).toEqual([
      null,
      null,
      null,
      null,
    ]);
    expect(draft?.staffRows.map(row => row.transactionCount)).toEqual([
      172, 104, 200, 251,
    ]);
    expect(draft?.staffRows.map(row => row.amountMinor)).toEqual([
      39776977, 21765276, 45208012, 50997954,
    ]);
    expect(draft?.categoryRows.map(row => row.category)).toEqual([
      "POMPACI",
      "TTS",
      "GIFT_CARD",
    ]);
    expect(draft?.staffRows[0].sourceLocation).toBe("PDF sayfa 1, y=480");
  });

  it("holds report for missing/incorrect staff rows and does not fabricate a subtotal", () => {
    const draft = buildOesseShiftReportDraft({
      rows: rows.filter(row => !row.cells[0].startsWith("ŞAHİN")),
      metadataText,
      metadataSources,
      sourceSha256,
    });
    expect(draft?.status).toBe("REVIEW_REQUIRED");
    expect(draft?.checks.staffCountMatches).toBe(false);
    expect(draft?.checks.staffAmountMatches).toBe(false);
  });

  it("marks repeated names for manual identity disambiguation", () => {
    const duplicate = [
      ...rows.slice(0, 2),
      { ...rows[1], sourceLocation: "PDF sayfa 2, y=480" },
      ...rows.slice(2),
    ];
    const draft = buildOesseShiftReportDraft({
      rows: duplicate,
      metadataText,
      metadataSources,
      sourceSha256,
    });
    expect(
      draft?.staffRows
        .filter(row => row.nameSuggestion === "GANDI")
        .every(row => row.duplicateName && row.staffUserId === null)
    ).toBe(true);
    expect(draft?.status).toBe("REVIEW_REQUIRED");
  });

  it("selects only a unique explicitly mapped permanent staff ID", () => {
    const draft = buildOesseShiftReportDraft({
      rows,
      metadataText,
      metadataSources,
      sourceSha256,
    })!;
    draft.staffRows[0].staffUserId = 101;
    expect(mappedOesseSaleForStaff(draft, 101)?.nameSuggestion).toBe("GANDI");
    expect(mappedOesseSaleForStaff(draft, 102)).toBeNull();
    draft.staffRows[1].staffUserId = 101;
    expect(mappedOesseSaleForStaff(draft, 101)).toBeNull();
  });

  it("keeps special-category totals separate and detects general-total mismatch", () => {
    const changed = rows.map(row =>
      row.cells[0] === "GIFT CARD"
        ? { ...row, cells: ["GIFT CARD", "2", "9.999,54"] }
        : row
    );
    const draft = buildOesseShiftReportDraft({
      rows: changed,
      metadataText,
      metadataSources,
      sourceSha256,
    });
    expect(draft?.checks.generalAmountMatches).toBe(false);
    expect(
      draft?.categoryRows.find(row => row.category === "GIFT_CARD")?.amountMinor
    ).toBe(999954);
    expect(draft?.warnings.join(" ")).toContain("genel toplamla uyuşmuyor");
  });

  it("keeps card usage and discounts as non-additive detail rows", () => {
    const withCardDetail = [
      ...rows,
      {
        cells: ["Kart Türü", "İşlem Adedi", "Harcama (TL)", "İndirim (TL)"],
        sourceLocation: "PDF sayfa 1, kart başlığı",
      },
      {
        cells: ["SMART CARD", "332", "0,00", "28.039,54"],
        sourceLocation: "PDF sayfa 1, kart satırı",
      },
      {
        cells: ["GIFT CARD", "2", "4.999,54", "0,00"],
        sourceLocation: "PDF sayfa 1, gift detay",
      },
    ];
    const draft = buildOesseShiftReportDraft({
      rows: withCardDetail,
      metadataText,
      metadataSources,
      sourceSha256,
    });
    expect(draft?.checks.generalAmountMatches).toBe(true);
    expect(draft?.categoryRows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          category: "SMART_CARD",
          basis: "CARD_DETAIL",
          amountMinor: 0,
        }),
        expect.objectContaining({
          category: "DISCOUNT",
          basis: "CARD_DETAIL",
          amountMinor: 2803954,
        }),
        expect.objectContaining({
          category: "GIFT_CARD",
          basis: "CARD_DETAIL",
          amountMinor: 499954,
        }),
      ])
    );
  });

  it("does not classify an unrelated automation report as independent day-end evidence", () => {
    const draft = buildOesseShiftReportDraft({
      rows,
      metadataText,
      metadataSources,
      sourceSha256,
    });
    expect(draft?.independentDayEndSource).toBe(false);
    expect(draft?.financialApplied).toBe(false);
    expect(
      buildOesseShiftReportDraft({ rows: [], metadataText, sourceSha256 })
    ).toBeNull();
  });

  it("requires source locations for shift identity and both timestamps", () => {
    const draft = buildOesseShiftReportDraft({
      rows,
      metadataText,
      sourceSha256,
    });
    expect(draft?.status).toBe("REVIEW_REQUIRED");
    expect(draft?.metadataSourceFields).toEqual({
      shiftId: null,
      startsAt: null,
      endsAt: null,
    });
    expect(draft?.warnings.join(" ")).toContain("kaynak konumu bulunamadı");
  });

  it("uses existing local OCR lines as source-located draft rows", () => {
    const lines = [
      { index: 0, text: "Vardiya İsmi : 2026110801" },
      { index: 1, text: "Vardiya Başlangıcı : 08.11.2026 - 08:44:26" },
      { index: 2, text: "Vardiya Bitişi : 09.11.2026 - 07:55:17" },
      { index: 3, text: "ÖSSE Adı Satış Adedi Satış Tutarı (TL)" },
      { index: 4, text: "GANDI 172 397.769,77" },
      { index: 5, text: "SÜLEYMAN 104 217.652,76" },
      { index: 6, text: "ŞAHİN 200 452.080,12" },
      { index: 7, text: "YUSUF 251 509.979,54" },
      { index: 8, text: "POMPACI 727 1.577.482,19" },
      { index: 9, text: "TTS 14 62.820,13" },
      { index: 10, text: "GIFT CARD 2 4.999,54" },
      { index: 11, text: "TOPLAM 743 1.645.301,86" },
    ];
    const draft = buildOesseShiftReportDraftFromOcr({
      lines,
      words: [
        { line: 0, box: { x: 40, y: 700 } },
        { line: 1, box: { x: 42, y: 680 } },
        { line: 2, box: { x: 43, y: 660 } },
        { line: 4, box: { x: 123, y: 456 } },
      ],
      sourcePageNumber: 1,
      sourceSha256,
    });
    expect(draft?.checks).toMatchObject({
      staffCountMatches: true,
      staffAmountMatches: true,
      generalAmountMatches: true,
      crossMidnight: true,
    });
    expect(draft?.staffRows[0]).toMatchObject({
      nameSuggestion: "GANDI",
      amountMinor: 39776977,
      staffUserId: null,
      sourceLocation: "OCR sayfa 1, satır 5, x=123, y=456",
    });
    expect(draft?.metadataSourceFields).toEqual({
      shiftId: "OCR sayfa 1, satır 1, x=40, y=700",
      startsAt: "OCR sayfa 1, satır 2, x=42, y=680",
      endsAt: "OCR sayfa 1, satır 3, x=43, y=660",
    });
  });

  it("does not invent a shift draft when OCR cannot read the table heading", () => {
    expect(
      buildOesseShiftReportDraftFromOcr({
        lines: [{ index: 0, text: "POMPACI 727 1.577.482,19" }],
        sourceSha256,
      })
    ).toBeNull();
  });
});

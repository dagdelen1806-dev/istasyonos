import { describe, expect, it } from "vitest";
import {
  buildDailyAccountDraft,
  safeDailySourceCellEntries,
  type DailyAccountSheet,
} from "../../shared/daily-account-review";

function fixture(): DailyAccountSheet {
  const rows: DailyAccountSheet["rows"] = [
    {
      rowNumber: 1,
      cells: [
        {
          address: "C1",
          column: 3,
          type: "formula",
          display: "09/10/2026 POMPACILAR",
          formulaCache: true,
        },
        ...[
          "NAKİT",
          "KK-SLIP",
          "FAST",
          "EFT/İBAN",
          "BORÇ VERİLEN",
          "TOPLAM",
          "OTO. SATIŞ",
        ].map((display, index) => ({
          address: `${String.fromCharCode(68 + index)}1`,
          column: 4 + index,
          type: "formula",
          display,
          formulaCache: true,
        })),
      ],
    },
  ];
  const sales = [
    {
      row: 3,
      name: "ALFA",
      cash: 44880,
      card: 243268,
      iban: 2000,
      debt: 39530,
      automation: 327658.38,
    },
    {
      row: 4,
      name: "BETA",
      cash: 81750,
      card: 354871,
      debt: 15550,
      automation: 454064.5,
    },
    {
      row: 5,
      name: "BETA",
      cash: 113670,
      card: 411148,
      debt: 12610,
      automation: 537444.21,
    },
    {
      row: 8,
      name: null,
      cash: 31320,
      card: 143920,
      debt: 5243,
      automation: 180579.9,
    },
  ];
  for (const sale of sales) {
    const cells: DailyAccountSheet["rows"][number]["cells"] = [];
    if (sale.name)
      cells.push({
        address: `C${sale.row}`,
        column: 3,
        type: "text",
        value: sale.name,
      });
    for (const [column, value] of [
      [4, sale.cash],
      [5, sale.card],
      [7, sale.iban],
      [8, sale.debt],
      [10, sale.automation],
    ] as const)
      cells.push({
        address: `${String.fromCharCode(64 + column)}${sale.row}`,
        column,
        type: "number",
        value,
      });
    rows.push({ rowNumber: sale.row, cells });
  }
  const pos = [
    125261.68, 3750, 4520.32, 1500, 18277.33, 485310.04, 23130.55, 491412.83,
  ];
  pos.forEach((value, index) => {
    const rowNumber = index + 2;
    rows.push({
      rowNumber,
      cells: [
        { address: `M${rowNumber}`, column: 13, type: "number", value },
        ...(index < 5
          ? [
              {
                address: `N${rowNumber}`,
                column: 14,
                type: "formula",
                display: "23 den önce",
                formulaCache: true,
              },
            ]
          : index < 7
            ? [
                {
                  address: `N${rowNumber}`,
                  column: 14,
                  type: "formula",
                  display: "23 den sonra",
                  formulaCache: true,
                },
              ]
            : []),
      ],
    });
  });
  rows.push({
    rowNumber: 9,
    cells: [
      {
        address: "I9",
        column: 9,
        type: "formula",
        value: null,
        formulaCache: true,
        display: "1,499,760.00",
      },
      {
        address: "K9",
        column: 11,
        type: "formula",
        value: null,
        formulaCache: true,
        display: "13.01",
      },
    ],
  });
  return {
    name: "Günlük hesap",
    rows: rows.sort((a, b) => a.rowNumber - b.rowNumber),
  };
}

describe("daily Excel cash-up review draft", () => {
  it("treats absent or invalid legacy cell evidence as empty evidence", () => {
    expect(safeDailySourceCellEntries(null)).toEqual([]);
    expect(safeDailySourceCellEntries(undefined)).toEqual([]);
    expect(safeDailySourceCellEntries("not-an-object")).toEqual([]);
    expect(
      safeDailySourceCellEntries({
        cash: "D3",
        cardSlip: null,
        fast: "",
        iban: 7,
      })
    ).toEqual([["cash", "D3"]]);
  });

  it("recomputes the reference totals in kuruş and does not trust formula caches", () => {
    const result = buildDailyAccountDraft({
      sheets: [fixture()],
      sourceSha256: "a".repeat(64),
      automationStartsAt: "2026-11-09T07:55:17",
      automationEndsAt: "2026-11-10T07:55:09",
    });
    expect(result).not.toBeNull();
    expect(result!.totals).toMatchObject({
      cashMinor: 27162000,
      cardSlipMinor: 115320700,
      fastMinor: null,
      ibanMinor: null,
      debtMinor: 7293300,
      declaredTotalMinor: null,
      automationMinor: 149974699,
      declarationVarianceMinor: null,
      posDayEndMinor: 115316275,
      posDayEndVarianceMinor: -4425,
    });
    expect(result!.totals.posBefore23Minor).toBe(15330933);
    expect(result!.totals.posAfter23Minor).toBe(50844059);
    expect(result!.totals.posTimeUnknownMinor).toBe(49141283);
    expect(result!.ignoredFormulaCells).toContain("I9");
    expect(
      result!.staffRows.some(row => row.automationMinor === 1_499_760_00)
    ).toBe(false);
    expect(result!.totals.automationMinor).toBe(149974699);
    expect(result!.headerDateLocation).toBe("C1");
    expect(result!.staffRows[0].sourceCells).toMatchObject({
      name: "C3",
      cash: "D3",
      cardSlip: "E3",
      fast: null,
      iban: "G3",
      debt: "H3",
      automation: "J3",
    });
    expect(
      result!.posRows.find(row => row.sourceRow === 2)?.sourceCells
    ).toEqual({ amount: "M2", period: "N2", staff: null });
    expect(result!.dateStatus).toBe("AMBIGUOUS_OR_UNMATCHED");
    expect(result!.status).toBe("REVIEW_REQUIRED");
    expect(result!.financialApplied).toBe(false);
  });

  it("keeps duplicate and blank names as separate unmapped rows", () => {
    const result = buildDailyAccountDraft({
      sheets: [fixture()],
      sourceSha256: "b".repeat(64),
    })!;
    const duplicateRows = result.staffRows.filter(
      row => row.nameSuggestion === "BETA"
    );
    expect(duplicateRows).toHaveLength(2);
    expect(
      duplicateRows.every(
        row =>
          row.duplicateName &&
          row.staffUserId === null &&
          row.requiresUserMapping
      )
    ).toBe(true);
    const blank = result.staffRows.find(row => row.sourceRow === 8)!;
    expect(blank.nameSuggestion).toBeNull();
    expect(blank.staffUserId).toBeNull();
  });

  it("treats missing source fields as review items and never promotes FAST or EFT to bank receipts", () => {
    const result = buildDailyAccountDraft({
      sheets: [fixture()],
      sourceSha256: "c".repeat(64),
    })!;
    expect(result.blankCategories).toContain("FAST");
    expect(result.bankConfirmed).toBe(false);
    expect(result.status).toBe("REVIEW_REQUIRED");
    expect(result.personnelDebtCreated).toBe(false);
  });
});

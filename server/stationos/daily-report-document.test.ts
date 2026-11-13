import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import {
  detectDailyDocumentFormat,
  parseDailyDocument,
} from "./daily-report-document";

function pdfFixture(pages: (string | null)[]) {
  const objects: string[] = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    `<< /Type /Pages /Kids [${pages.map((_, index) => `${3 + index * 2} 0 R`).join(" ")}] /Count ${pages.length} >>`,
  ];
  for (let index = 0; index < pages.length; index++) {
    const pageId = 3 + index * 2,
      contentId = pageId + 1,
      text = pages[index] ?? "",
      stream = text ? `BT /F1 12 Tf 40 760 Td (${text}) Tj ET` : "";
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 ${3 + pages.length * 2} 0 R >> >> /Contents ${contentId} 0 R >>`,
      `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`
    );
  }
  objects.push("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  let output = "%PDF-1.4\n%DEMO\n";
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(output));
    output += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = Buffer.byteLength(output);
  output += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1))
    output += `${String(offset).padStart(10, "0")} 00000 n \n`;
  output += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(output, "ascii");
}

function imagePdfFixture() {
  const image = Buffer.from([0, 0, 0]);
  const content = "q 10 0 0 10 0 0 cm /Im0 Do Q";
  const objects: Buffer[] = [
    Buffer.from("<< /Type /Catalog /Pages 2 0 R >>", "ascii"),
    Buffer.from("<< /Type /Pages /Kids [3 0 R] /Count 1 >>", "ascii"),
    Buffer.from(
      "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Resources << /XObject << /Im0 6 0 R >> >> /Contents 4 0 R >>",
      "ascii"
    ),
    Buffer.from(
      `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`,
      "ascii"
    ),
    Buffer.from(
      "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
      "ascii"
    ),
    Buffer.concat([
      Buffer.from(
        `<< /Type /XObject /Subtype /Image /Width 1 /Height 1 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Length ${image.length} >>\nstream\n`,
        "ascii"
      ),
      image,
      Buffer.from("\nendstream", "ascii"),
    ]),
  ];
  const chunks = [Buffer.from("%PDF-1.4\n%DEMO\n", "ascii")],
    offsets = [0];
  let size = chunks[0].length;
  objects.forEach((object, index) => {
    offsets.push(size);
    const chunk = Buffer.concat([
      Buffer.from(`${index + 1} 0 obj\n`, "ascii"),
      object,
      Buffer.from("\nendobj\n", "ascii"),
    ]);
    chunks.push(chunk);
    size += chunk.length;
  });
  const xref = size;
  let trailer = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1))
    trailer += `${String(offset).padStart(10, "0")} 00000 n \n`;
  trailer += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  chunks.push(Buffer.from(trailer, "ascii"));
  return Buffer.concat(chunks);
}

async function xlsxFixture() {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Vardiya 1");
  sheet.addRow([
    "ÖSSE",
    "Vardiya",
    "Tarih",
    "İşlem Adedi",
    "Litre",
    "Satış Tutarı",
    "TTS",
    "Özel İşlem",
  ]);
  sheet.addRow([
    "DEMO Personel",
    "V-22",
    new Date("2026-11-09T00:00:00Z"),
    25,
    133.25,
    2500.79,
    120.5,
    10,
  ]);
  sheet.getCell("F2").value = { formula: "SUM(2500,79)", result: 2500.79 };
  const second = workbook.addWorksheet("Gün Sonu");
  second.addRow(["Tarih", "İşlem Adedi", "Toplam Tutar"]);
  second.addRow(["2026-11-09", 25, "2.500,79"]);
  second.addRow(["4111111111111111"]);
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

// The production parser intentionally permits one worker-backed parse at a time.
// Keep this fixture suite sequential when Vitest runs unrelated files in parallel.
describe.sequential("daily report PDF/XLSX parse drafts", () => {
  // ExcelJS plus the isolated parser worker may exceed the default timeout
  // when all unrelated suites are running in parallel.
  it("builds the OSEE automation shift draft from XLSX rows with source references", async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Vardiya");
    sheet.addRow(["Vardiya İsmi", "2026110801"]);
    sheet.addRow(["Vardiya Başlangıcı", "08.11.2026 - 08:44:26"]);
    sheet.addRow(["Vardiya Bitişi", "09.11.2026 - 07:55:17"]);
    sheet.addRow(["ÖSSE Adı", "Satış Adedi", "Satış Tutarı (TL)"]);
    sheet.addRow(["GANDI", 172, "397.769,77"]);
    sheet.addRow(["SÜLEYMAN", 104, "217.652,76"]);
    sheet.addRow(["ŞAHİN", 200, "452.080,12"]);
    sheet.addRow(["YUSUF", 251, "509.979,54"]);
    sheet.addRow(["POMPACI", 727, "1.577.482,19"]);
    sheet.addRow(["TTS", 14, "62.820,13"]);
    sheet.addRow(["GIFT CARD", 2, "4.999,54"]);
    sheet.addRow(["TOPLAM", 743, "1.645.301,86"]);
    const result = await parseDailyDocument(
      "XLSX",
      Buffer.from(await workbook.xlsx.writeBuffer())
    );
    expect(result.shiftReportDraft).toMatchObject({
      status: "READY_FOR_MAPPING",
      shiftId: "2026110801",
      startsAt: "2026-11-08T08:44:26",
      endsAt: "2026-11-09T07:55:17",
      metadataSourceFields: {
        shiftId: "Vardiya!A1,B1",
        startsAt: "Vardiya!A2,B2",
        endsAt: "Vardiya!A3,B3",
      },
      checks: {
        staffCountMatches: true,
        staffAmountMatches: true,
        generalAmountMatches: true,
        crossMidnight: true,
      },
      independentDayEndSource: false,
      financialApplied: false,
    });
    expect(result.shiftReportDraft.staffRows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          nameSuggestion: "GANDI",
          staffUserId: null,
          sourceLocation: "Vardiya!A5",
          sourceFields: { name: "A5", transactionCount: "B5", amount: "C5" },
        }),
      ])
    );
  }, 15_000);

  it("extracts multi-page PDF text with exact page and source item coordinates", async () => {
    const bytes = pdfFixture(["OSSE: DEMO STAFF", "Tutar: 2.500,79"]);
    const result = await parseDailyDocument("PDF", bytes);
    expect(result).toMatchObject({ format: "PDF", pageCount: 2 });
    expect(result.pages[0].pageNumber).toBe(1);
    expect(result.pages[0].text).toMatch(/OSSE/);
    expect(result.pages[1].pageNumber).toBe(2);
    expect(result.pages[1].items[0]).toHaveProperty("x");
    expect(result.pages[0].fieldCandidates[0]).toMatchObject({
      field: "staff",
      rawText: "DEMO STAFF",
      personnelUserId: null,
      requiresUserMapping: true,
    });
    expect(result.pages[1].fieldCandidates[0]).toMatchObject({
      field: "amount",
      rawText: "2.500,79",
      proposedValue: 250079,
      requiresConfirmation: true,
    });
  });

  it("detects image-only scanned pages for local OCR", async () => {
    const result = await parseDailyDocument("PDF", imagePdfFixture());
    expect(result.pages[0].containsRasterImage).toBe(true);
    expect(result.pages[0].needsLocalOcr).toBe(true);
  });

  it("reads multiple XLSX sheets and returns source cell coordinates and typed proposals", async () => {
    const bytes = await xlsxFixture();
    const result = await parseDailyDocument("XLSX", bytes);
    expect(result.format).toBe("XLSX");
    expect(result.sheets).toHaveLength(2);
    const person = result.sheets[0].candidates[0];
    expect(person).toMatchObject({
      rowNumber: 2,
      staffNameSuggestion: "DEMO Personel",
      shiftSuggestion: "V-22",
      personnelUserId: null,
      requiresUserMapping: true,
    });
    expect(person.fields.amount).toMatchObject({
      address: "F2",
      proposedValue: 250079,
      requiresConfirmation: true,
      formulaCache: true,
    });
    expect(JSON.stringify(result)).not.toContain("SUM(2500,79)");
    expect(person.fields.litres).toMatchObject({
      address: "E2",
      proposedValue: 133250,
    });
    expect(person.fields.count).toMatchObject({
      address: "D2",
      proposedValue: 25,
    });
    expect(person.fields.tts).toMatchObject({
      address: "G2",
      proposedValue: 12050,
    });
    expect(person.fields.special).toMatchObject({
      address: "H2",
      proposedValue: 1000,
    });
    expect(person.fields.date).toMatchObject({
      address: "C2",
      cellType: "date",
      requiresConfirmation: true,
    });
    expect(result.sheets[1].candidates[0].fields.amount).toMatchObject({
      address: "C2",
      proposedValue: 250079,
    });
    expect(JSON.stringify(result)).not.toContain("4111111111111111");
  });

  it("builds the daily cash-up review from raw XLSX cells, ignores formula results and preserves POS cutoff evidence", async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Günlük hesap");
    for (const [address, value] of Object.entries({
      C1: "09/10/2026 POMPACILAR",
      D1: "NAKİT",
      E1: "KK-SLIP",
      F1: "FAST",
      G1: "EFT/İBAN",
      H1: "BORÇ VERİLEN",
      I1: "TOPLAM",
      J1: "OTO. SATIŞ",
      N1: "Saat dilimi",
    }))
      sheet.getCell(address).value = value;
    const entries = [
      {
        row: 3,
        name: "PERSON A",
        cash: 44880,
        card: 243268,
        iban: 2000,
        debt: 39530,
        sale: 327658.38,
      },
      {
        row: 4,
        name: "PERSON B",
        cash: 81750,
        card: 354871,
        debt: 15550,
        sale: 454064.5,
      },
      {
        row: 5,
        name: "PERSON B",
        cash: 113670,
        card: 411148,
        debt: 12610,
        sale: 537444.21,
      },
      {
        row: 8,
        name: null,
        cash: 31320,
        card: 143920,
        debt: 5243,
        sale: 180579.9,
      },
    ];
    for (const row of [2, 3, 4, 5, 6, 7, 8, 9]) {
      const values = [
        125261.68, 3750, 4520.32, 1500, 18277.33, 485310.04, 23130.55,
        491412.83,
      ];
      sheet.getCell(`M${row}`).value = values[row - 2];
      if (row <= 6) sheet.getCell(`N${row}`).value = "23 den önce";
      else if (row <= 8) sheet.getCell(`N${row}`).value = "23 den sonra";
    }
    for (const entry of entries) {
      sheet.getCell(`C${entry.row}`).value = entry.name;
      sheet.getCell(`D${entry.row}`).value = entry.cash;
      sheet.getCell(`E${entry.row}`).value = entry.card;
      sheet.getCell(`G${entry.row}`).value = entry.iban ?? null;
      sheet.getCell(`H${entry.row}`).value = entry.debt;
      sheet.getCell(`I${entry.row}`).value = {
        formula: `SUM(D${entry.row}:H${entry.row})`,
        result: 9999999,
      };
      sheet.getCell(`J${entry.row}`).value = entry.sale;
      sheet.getCell(`K${entry.row}`).value = {
        formula: `I${entry.row}-J${entry.row}`,
        result: -1,
      };
    }
    const result = await parseDailyDocument(
      "XLSX",
      Buffer.from(await workbook.xlsx.writeBuffer())
    );
    expect(result.dailyAccountDraft).toMatchObject({
      kind: "DAILY_STAFF_CASH_UP",
      headerDateRaw: "09/10/2026",
      dateStatus: "AMBIGUOUS_OR_UNMATCHED",
      status: "REVIEW_REQUIRED",
      totals: {
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
      },
      financialApplied: false,
      bankConfirmed: false,
      personnelDebtCreated: false,
    });
    expect(result.dailyAccountDraft.ignoredFormulaCells).toContain("I3");
    expect(result.dailyAccountDraft.headerDateLocation).toBe("C1");
    expect(result.dailyAccountDraft.staffRows[0].sourceCells).toMatchObject({
      name: "C3",
      cash: "D3",
      cardSlip: "E3",
      fast: null,
      iban: "G3",
      debt: "H3",
      automation: "J3",
    });
    expect(
      result.dailyAccountDraft.posRows.find((row: any) => row.sourceRow === 2)
        ?.sourceCells
    ).toEqual({ amount: "M2", period: "N2", staff: null });
    expect(
      result.dailyAccountDraft.staffRows.filter((row: any) => row.duplicateName)
    ).toHaveLength(2);
    expect(
      result.dailyAccountDraft.staffRows.some(
        (row: any) => row.nameSuggestion === null && row.staffUserId === null
      )
    ).toBe(true);
    expect(
      result.dailyAccountDraft.posRows.find((row: any) => row.sourceRow === 2)
    ).toMatchObject({ sourceLocation: "Günlük hesap!M2", period: "BEFORE_23" });
  });

  it("does not assign parsed names to a permanent user id", async () => {
    const result = await parseDailyDocument("XLSX", await xlsxFixture());
    expect(result.sheets[0].candidates[0].personnelUserId).toBeNull();
    expect(result.sheets[0].candidates[0].requiresUserMapping).toBe(true);
  });

  it("keeps merged range evidence and does not repeat merged cells as data", async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Merged");
    sheet.mergeCells("A1:C1");
    sheet.getCell("A1").value = "Vardiya raporu";
    sheet.addRow(["ÖSSE", "Satış Adedi", "Satış Tutarı"]);
    sheet.addRow(["DEMO Personel", 12, "1.234,50"]);
    const result = await parseDailyDocument(
      "XLSX",
      Buffer.from(await workbook.xlsx.writeBuffer())
    );
    expect(result.sheets[0].mergedRanges).toContain("A1:C1");
    expect(
      result.sheets[0].rows[0].cells.map((cell: any) => cell.address)
    ).toEqual(["A1"]);
    expect(result.sheets[0].candidates[0].fields.amount).toMatchObject({
      address: "C3",
      proposedValue: 123450,
    });
  });

  it("withholds duplicated report columns instead of choosing the first amount", async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Ambiguous headers");
    sheet.addRow(["ÖSSE", "Tarih", "Tutar", "Satış Tutarı", "Satış Adedi"]);
    sheet.addRow(["DEMO Personel", "2026-11-09", "100,00", "200,00", 1]);
    const result = await parseDailyDocument(
      "XLSX",
      Buffer.from(await workbook.xlsx.writeBuffer())
    );
    expect(result.sheets[0].ambiguousHeaderFields).toContain("amount");
    expect(result.sheets[0].candidates[0].fields.amount).toBeUndefined();
    expect(result.sheets[0].candidates[0].personnelUserId).toBeNull();
  });

  it("normalizes only validated ISO and Turkish dotted dates and leaves ambiguous dates unresolved", async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Dates");
    sheet.addRow(["ÖSSE", "Tarih", "Satış Adedi"]);
    sheet.addRow(["ISO", "2026-11-09", 1]);
    sheet.addRow(["TR", "09.11.2026", 2]);
    sheet.addRow(["Ambiguous", "09/10/2026", 3]);
    sheet.addRow(["Invalid", "31.02.2026", 4]);
    const result = await parseDailyDocument(
      "XLSX",
      Buffer.from(await workbook.xlsx.writeBuffer())
    );
    const candidates = result.sheets[0].candidates;
    expect(
      candidates.map(
        (candidate: any) => candidate.fields.date?.proposedValue ?? null
      )
    ).toEqual(["2026-11-09", "2026-11-09", null, null]);
    expect(
      candidates.every(
        (candidate: any) => candidate.fields.date?.requiresConfirmation
      )
    ).toBe(true);
  });

  it("keeps source sheets available but does not invent an automation draft when headers are missing", async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Unknown format");
    sheet.addRow(["Person", "Value", "Day"]);
    sheet.addRow(["DEMO", "1.200,00", "09.11.2026"]);
    const result = await parseDailyDocument(
      "XLSX",
      Buffer.from(await workbook.xlsx.writeBuffer())
    );
    expect(result.sheets[0].headerRow).toBeNull();
    expect(result.shiftReportDraft).toBeUndefined();
    expect(result.dailyAccountDraft).toBeUndefined();
    expect(
      result.sheets[0].rows[1].cells.map((cell: any) => cell.address)
    ).toEqual(["A2", "B2", "C2"]);
  });

  it("rejects overlapping parser work explicitly and releases the parser slot", async () => {
    const first = pdfFixture(["Tutar: 2.500,79"]);
    const second = pdfFixture(["Tutar: 4.400,89"]);
    const results = await Promise.allSettled([
      parseDailyDocument("PDF", first),
      parseDailyDocument("PDF", second),
    ]);
    expect(
      results.filter(result => result.status === "fulfilled")
    ).toHaveLength(1);
    expect(results.filter(result => result.status === "rejected")).toHaveLength(
      1
    );
    const afterContention = await parseDailyDocument("PDF", first);
    expect(afterContention.sourceSha256).toMatch(/^[a-f0-9]{64}$/u);
  });

  it("rejects bad signatures, unsupported formats and oversized files", () => {
    expect(() =>
      detectDailyDocumentFormat("report.xlsm", Buffer.from("PK\x03\x04"))
    ).toThrow();
    expect(() =>
      detectDailyDocumentFormat("report.pdf", Buffer.from("not pdf"))
    ).toThrow();
    expect(() =>
      detectDailyDocumentFormat("report.xlsx", Buffer.alloc(13 * 1024 * 1024))
    ).toThrow();
  });

  it("rejects malformed XLSX ZIP containers before workbook parsing", async () => {
    await expect(
      parseDailyDocument("XLSX", Buffer.from("PK\x03\x04invalid"))
    ).rejects.toThrow();
  });

  it("rejects XLSX files containing an external hyperlink relationship", async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Links");
    sheet.getCell("A1").value = {
      text: "Kaynak",
      hyperlink: "https://example.invalid/source",
    };
    await expect(
      parseDailyDocument("XLSX", Buffer.from(await workbook.xlsx.writeBuffer()))
    ).rejects.toThrow(/harici bağlantı|external/i);
  });
});

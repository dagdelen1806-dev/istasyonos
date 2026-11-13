/** Draft parser for the station automation shift report. Names are never IDs. */
export type OesseReportRowInput = {
  cells: string[];
  sourceLocation: string;
  cellLocations?: (string | null)[];
};
export type OesseMetadataSource = {
  text: string;
  sourceLocation: string;
};

export type OesseShiftReportDraft = {
  reportType: "AUTOMATION_SHIFT_SALES";
  status: "REVIEW_REQUIRED" | "READY_FOR_MAPPING";
  shiftId: string | null;
  startsAt: string | null;
  endsAt: string | null;
  metadataSourceFields: {
    shiftId: string | null;
    startsAt: string | null;
    endsAt: string | null;
  };
  staffRows: {
    nameSuggestion: string;
    staffUserId: number | null;
    transactionCount: number | null;
    amountMinor: number | null;
    sourceLocation: string;
    sourceFields: {
      name: string | null;
      transactionCount: string | null;
      amount: string | null;
    };
    requiresUserMapping: true;
    duplicateName: boolean;
  }[];
  categoryRows: {
    category:
      | "POMPACI"
      | "TTS"
      | "GIFT_CARD"
      | "SMART_CARD"
      | "PARTNER_CARD"
      | "DISCOUNT";
    basis: "SALES_BREAKDOWN" | "CARD_DETAIL";
    transactionCount: number | null;
    amountMinor: number | null;
    sourceLocation: string;
    sourceFields: {
      name: string | null;
      transactionCount: string | null;
      amount: string | null;
    };
  }[];
  reportedStaffTotal: {
    transactionCount: number | null;
    amountMinor: number | null;
    sourceLocation: string;
    sourceFields: {
      name: string | null;
      transactionCount: string | null;
      amount: string | null;
    };
  } | null;
  reportedGeneralTotal: {
    transactionCount: number | null;
    amountMinor: number | null;
    sourceLocation: string;
    sourceFields: {
      name: string | null;
      transactionCount: string | null;
      amount: string | null;
    };
  } | null;
  checks: {
    staffCountMatches: boolean | null;
    staffAmountMatches: boolean | null;
    generalAmountMatches: boolean | null;
    crossMidnight: boolean | null;
    duplicateReportDetectionKey: string | null;
  };
  warnings: string[];
  sourceLocations: string[];
  financialApplied: false;
  independentDayEndSource: false;
};

/** Returns a row only when the selected persistent user mapping is unambiguous. */
export function mappedOesseSaleForStaff(
  draft: OesseShiftReportDraft | null | undefined,
  staffUserId: number | null | undefined
) {
  if (
    !draft ||
    !Number.isSafeInteger(staffUserId) ||
    !staffUserId ||
    staffUserId < 1
  )
    return null;
  if (!Array.isArray(draft.staffRows)) return null;
  const matches = draft.staffRows.filter(
    row => row && row.staffUserId === staffUserId
  );
  return matches.length === 1 ? matches[0] : null;
}

/**
 * Runtime guard for persisted/older drafts. A parsed amount is not a verified
 * staff sale unless row, count, amount, total, and shift source references exist.
 */
export function hasCompleteOesseShiftReportEvidence(
  draft: OesseShiftReportDraft | null | undefined
): boolean {
  const hasText = (value: unknown): value is string =>
    typeof value === "string" && value.trim().length > 0;
  const hasCount = (value: unknown) =>
    Number.isSafeInteger(value) && Number(value) >= 0;
  const hasAmount = (value: unknown) =>
    Number.isSafeInteger(value) && Number(value) >= 0;
  const hasTotalEvidence = (total: unknown) => {
    if (!total || typeof total !== "object") return false;
    const candidate = total as OesseShiftReportDraft["reportedStaffTotal"];
    return !!candidate &&
      hasText(candidate.sourceLocation) &&
      hasCount(candidate.transactionCount) &&
      hasAmount(candidate.amountMinor) &&
      hasText(candidate.sourceFields?.transactionCount) &&
      hasText(candidate.sourceFields?.amount);
  };

  if (
    !draft ||
    draft.status !== "READY_FOR_MAPPING" ||
    !draft.metadataSourceFields ||
    !hasText(draft.metadataSourceFields.shiftId) ||
    !hasText(draft.metadataSourceFields.startsAt) ||
    !hasText(draft.metadataSourceFields.endsAt) ||
    !Array.isArray(draft.staffRows) ||
    draft.staffRows.length === 0 ||
    !hasTotalEvidence(draft.reportedStaffTotal) ||
    !hasTotalEvidence(draft.reportedGeneralTotal) ||
    draft.checks?.staffCountMatches !== true ||
    draft.checks?.staffAmountMatches !== true ||
    draft.checks?.generalAmountMatches !== true
  )
    return false;

  return draft.staffRows.every(row => {
    if (!row || typeof row !== "object") return false;
    return (
      hasText(row.nameSuggestion) &&
      hasText(row.sourceLocation) &&
      hasCount(row.transactionCount) &&
      hasAmount(row.amountMinor) &&
      hasText(row.sourceFields?.name) &&
      hasText(row.sourceFields?.transactionCount) &&
      hasText(row.sourceFields?.amount)
    );
  });
}

const normalize = (value: string) =>
  value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("tr-TR")
    .replace(/ı/g, "i")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

function moneyMinor(raw: string): number | null {
  const text = raw.trim().replace(/[₺\s]/g, "").replace(/TL/gi, "");
  if (!/^\d[\d.,]*$/.test(text)) return null;
  let whole: string, fraction: string;
  if (/^\d{1,3}(\.\d{3})+,\d{2}$/.test(text)) {
    [whole, fraction] = [
      text.slice(0, text.lastIndexOf(",")).replaceAll(".", ""),
      text.slice(text.lastIndexOf(",") + 1),
    ];
  } else if (/^\d+,\d{2}$/.test(text)) {
    [whole, fraction] = text.split(",");
  } else if (/^\d+\.\d{2}$/.test(text)) {
    [whole, fraction] = text.split(".");
  } else if (/^\d+$/.test(text)) {
    whole = text;
    fraction = "00";
  } else return null;
  const amount = Number(whole) * 100 + Number(fraction);
  return Number.isSafeInteger(amount) ? amount : null;
}

function countValue(raw: string): number | null {
  const text = raw.trim().replaceAll(".", "").replaceAll(",", "");
  const value = /^\d{1,7}$/.test(text) ? Number(text) : NaN;
  return Number.isSafeInteger(value) ? value : null;
}

function reportDate(raw: string): string | null {
  const text = raw.trim();
  const isoMatch = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})/.exec(
    text
  );
  if (isoMatch) {
    const iso = `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}T${isoMatch[4]}:${isoMatch[5]}:${isoMatch[6]}`;
    const date = new Date(`${iso}Z`);
    return !Number.isNaN(date.valueOf()) &&
      date.toISOString().slice(0, 19) === iso
      ? iso
      : null;
  }
  const match =
    /^(\d{2})\.(\d{2})\.(\d{4})\s*[-–]?\s*(\d{2}):(\d{2}):(\d{2})$/.exec(text);
  if (!match) return null;
  const [, dd, mm, yyyy, hh, mi, ss] = match;
  const iso = `${yyyy}-${mm}-${dd}T${hh}:${mi}:${ss}`;
  const date = new Date(`${iso}Z`);
  return Number.isNaN(date.valueOf()) || date.toISOString().slice(0, 19) !== iso
    ? null
    : iso;
}

export function buildOesseShiftReportDraft(input: {
  rows: OesseReportRowInput[];
  metadataText?: string;
  metadataSources?: OesseMetadataSource[];
  sourceSha256: string;
}): OesseShiftReportDraft | null {
  const headerIndex = input.rows.findIndex(row => {
    const cells = row.cells.map(normalize);
    return (
      cells.includes("osse adi") &&
      cells.includes("satis adedi") &&
      cells.includes("satis tutari tl")
    );
  });
  if (headerIndex < 0) return null;
  const header = input.rows[headerIndex].cells.map(normalize);
  const nameColumn = header.indexOf("osse adi");
  const countColumn = header.indexOf("satis adedi");
  const amountColumn = header.indexOf("satis tutari tl");
  const staffRows: OesseShiftReportDraft["staffRows"] = [];
  const categoryRows: OesseShiftReportDraft["categoryRows"] = [];
  let reportedStaffTotal: OesseShiftReportDraft["reportedStaffTotal"] = null;
  let reportedGeneralTotal: OesseShiftReportDraft["reportedGeneralTotal"] =
    null;
  const warnings: string[] = [];
  const sourceFields = (row: OesseReportRowInput) => ({
    name: row.cellLocations?.[nameColumn] ?? null,
    transactionCount: row.cellLocations?.[countColumn] ?? null,
    amount: row.cellLocations?.[amountColumn] ?? null,
  });
  for (const row of input.rows.slice(headerIndex + 1)) {
    const label = (row.cells[nameColumn] ?? "").trim();
    if (!label) continue;
    const key = normalize(label);
    const count = countValue(row.cells[countColumn] ?? "");
    const amount = moneyMinor(row.cells[amountColumn] ?? "");
    const evidence = sourceFields(row);
    if (key === "toplam") {
      reportedGeneralTotal = {
        transactionCount: count,
        amountMinor: amount,
        sourceLocation: row.sourceLocation,
        sourceFields: evidence,
      };
      break;
    }
    if (key === "pompaci") {
      reportedStaffTotal = {
        transactionCount: count,
        amountMinor: amount,
        sourceLocation: row.sourceLocation,
        sourceFields: evidence,
      };
      categoryRows.push({
        category: "POMPACI",
        basis: "SALES_BREAKDOWN",
        transactionCount: count,
        amountMinor: amount,
        sourceLocation: row.sourceLocation,
        sourceFields: evidence,
      });
      continue;
    }
    if (
      ["tts", "gift card", "smart card", "partner card", "indirim"].includes(
        key
      )
    ) {
      const category =
        key === "tts"
          ? "TTS"
          : key === "gift card"
            ? "GIFT_CARD"
            : key === "smart card"
              ? "SMART_CARD"
              : key === "partner card"
                ? "PARTNER_CARD"
                : "DISCOUNT";
      categoryRows.push({
        category,
        basis: "SALES_BREAKDOWN",
        transactionCount: count,
        amountMinor: amount,
        sourceLocation: row.sourceLocation,
        sourceFields: evidence,
      });
      continue;
    }
    if (count === null || amount === null) {
      warnings.push(`Personel satırı doğrulanamadı: ${row.sourceLocation}`);
      continue;
    }
    staffRows.push({
      nameSuggestion: label,
      staffUserId: null,
      transactionCount: count,
      amountMinor: amount,
      sourceLocation: row.sourceLocation,
      sourceFields: evidence,
      requiresUserMapping: true,
      duplicateName: false,
    });
  }
  const cardHeaderIndex = input.rows.findIndex(row => {
    const cells = row.cells.map(normalize);
    return (
      cells.includes("kart turu") &&
      cells.some(value => value.startsWith("harcama")) &&
      cells.some(value => value.startsWith("indirim"))
    );
  });
  if (cardHeaderIndex >= 0) {
    const header = input.rows[cardHeaderIndex].cells.map(normalize);
    const typeIndex = header.indexOf("kart turu"),
      countIndex = header.findIndex(value => value.includes("islem adedi")),
      spendIndex = header.findIndex(value => value.startsWith("harcama")),
      discountIndex = header.findIndex(value => value.startsWith("indirim"));
    for (const row of input.rows.slice(cardHeaderIndex + 1)) {
      const name = normalize(row.cells[typeIndex] ?? "");
      if (name === "toplam") break;
      const category =
        name === "smart card"
          ? "SMART_CARD"
          : name === "gift card"
            ? "GIFT_CARD"
            : name === "partner card"
              ? "PARTNER_CARD"
              : null;
      if (!category) continue;
      categoryRows.push({
        category,
        basis: "CARD_DETAIL",
        transactionCount: countValue(row.cells[countIndex] ?? ""),
        amountMinor: moneyMinor(row.cells[spendIndex] ?? ""),
        sourceLocation: row.sourceLocation,
        sourceFields: {
          name: row.cellLocations?.[typeIndex] ?? null,
          transactionCount: row.cellLocations?.[countIndex] ?? null,
          amount: row.cellLocations?.[spendIndex] ?? null,
        },
      });
      const discount = moneyMinor(row.cells[discountIndex] ?? "");
      if (discount !== null)
        categoryRows.push({
          category: "DISCOUNT",
          basis: "CARD_DETAIL",
          transactionCount: null,
          amountMinor: discount,
          sourceLocation: row.sourceLocation,
          sourceFields: {
            name: row.cellLocations?.[typeIndex] ?? null,
            transactionCount: null,
            amount: row.cellLocations?.[discountIndex] ?? null,
          },
        });
    }
  }
  const nameCounts = new Map<string, number>();
  for (const row of staffRows)
    nameCounts.set(
      normalize(row.nameSuggestion),
      (nameCounts.get(normalize(row.nameSuggestion)) ?? 0) + 1
    );
  for (const row of staffRows)
    row.duplicateName =
      (nameCounts.get(normalize(row.nameSuggestion)) ?? 0) > 1;
  if (staffRows.some(row => row.duplicateName))
    warnings.push(
      "Aynı personel adı birden fazla satırda var; kalıcı kullanıcı eşlemesi ayrıca doğrulanmalı."
    );
  const staffCount = staffRows.length
    ? staffRows.reduce((sum, row) => sum + (row.transactionCount ?? 0), 0)
    : null;
  const staffAmount = staffRows.length
    ? staffRows.reduce((sum, row) => sum + (row.amountMinor ?? 0), 0)
    : null;
  const staffCountMatches =
    staffCount !== null &&
    reportedStaffTotal?.transactionCount !== null &&
    reportedStaffTotal?.transactionCount !== undefined
      ? staffCount === reportedStaffTotal.transactionCount
      : null;
  const staffAmountMatches =
    staffAmount !== null &&
    reportedStaffTotal?.amountMinor !== null &&
    reportedStaffTotal?.amountMinor !== undefined
      ? staffAmount === reportedStaffTotal.amountMinor
      : null;
  const categoryAmount = categoryRows
    .filter(
      row => row.basis === "SALES_BREAKDOWN" && row.category !== "POMPACI"
    )
    .reduce((sum, row) => sum + (row.amountMinor ?? 0), 0);
  const generalAmountMatches =
    reportedGeneralTotal?.amountMinor !== null &&
    reportedGeneralTotal?.amountMinor !== undefined &&
    reportedStaffTotal?.amountMinor !== null &&
    reportedStaffTotal?.amountMinor !== undefined
      ? reportedStaffTotal.amountMinor + categoryAmount ===
        reportedGeneralTotal.amountMinor
      : null;
  if (!staffRows.length) warnings.push("ÖSSE satırları bulunamadı.");
  if (!reportedStaffTotal) warnings.push("POMPACI ara toplamı bulunamadı.");
  if (staffCountMatches === false || staffAmountMatches === false)
    warnings.push(
      "ÖSSE satır toplamları POMPACI toplamıyla uyuşmuyor; rapor incelemede."
    );
  if (generalAmountMatches === false)
    warnings.push(
      "POMPACI ve ayrı özel işlem satırları genel toplamla uyuşmuyor."
    );
  const metadata = input.metadataText ?? "";
  const shiftId =
    /Vardiya\s*(?:İsmi|Adi)\s*:\s*(\d{6,})/i.exec(metadata)?.[1] ?? null;
  const startsAt = reportDate(
    /Vardiya\s*Başlangıcı\s*:\s*([^\r\n]+)/i.exec(metadata)?.[1] ?? ""
  );
  const endsAt = reportDate(
    /Vardiya\s*Bitişi\s*:\s*([^\r\n]+)/i.exec(metadata)?.[1] ?? ""
  );
  if (!shiftId || !startsAt || !endsAt)
    warnings.push(
      "Vardiya kimliği veya kesin başlangıç/bitiş zamanı doğrulanmadı."
    );
  const metadataSourceFor = (pattern: RegExp) =>
    input.metadataSources?.find(source => pattern.test(source.text))
      ?.sourceLocation ?? null;
  const metadataSourceFields = {
    shiftId: metadataSourceFor(/Vardiya\s*(?:İsmi|Adi)\s*:/i),
    startsAt: metadataSourceFor(/Vardiya\s*Başlangıcı\s*:/i),
    endsAt: metadataSourceFor(/Vardiya\s*Bitişi\s*:/i),
  };
  if (
    !metadataSourceFields.shiftId ||
    !metadataSourceFields.startsAt ||
    !metadataSourceFields.endsAt
  )
    warnings.push(
      "Vardiya kimliği veya tarih alanının kaynak konumu bulunamadı."
    );
  const crossMidnight =
    startsAt && endsAt ? startsAt.slice(0, 10) !== endsAt.slice(0, 10) : null;
  const status =
    warnings.length === 0 &&
    staffCountMatches === true &&
    staffAmountMatches === true &&
    generalAmountMatches === true
      ? "READY_FOR_MAPPING"
      : "REVIEW_REQUIRED";
  return {
    reportType: "AUTOMATION_SHIFT_SALES",
    status,
    shiftId,
    startsAt,
    endsAt,
    metadataSourceFields,
    staffRows,
    categoryRows,
    reportedStaffTotal,
    reportedGeneralTotal,
    checks: {
      staffCountMatches,
      staffAmountMatches,
      generalAmountMatches,
      crossMidnight,
      duplicateReportDetectionKey: input.sourceSha256,
    },
    warnings,
    sourceLocations: input.rows.map(row => row.sourceLocation),
    financialApplied: false,
    independentDayEndSource: false,
  };
}

export function buildOesseShiftReportDraftFromOcr(input: {
  lines: { index: number; text: string }[];
  words?: { line: number; box: { x: number; y: number } }[];
  sourcePageNumber?: number;
  sourceSha256: string;
}): OesseShiftReportDraft | null {
  const headerIndex = input.lines.findIndex(line => {
    const text = normalize(line.text);
    return (
      text.includes("osse adi") &&
      text.includes("satis adedi") &&
      text.includes("satis tutari")
    );
  });
  if (headerIndex < 0) return null;
  const rows: OesseReportRowInput[] = [];
  for (const line of input.lines.slice(headerIndex + 1)) {
    const match = /^(.+?)\s+(\d{1,7})\s+([\d.,]+)(?:\s|$)/.exec(
      line.text.trim()
    );
    if (!match) continue;
    const boxes =
      input.words
        ?.filter(word => word.line === line.index)
        .map(word => word.box) ?? [];
    const position = boxes.length
      ? `, x=${Math.min(...boxes.map(box => box.x))}, y=${Math.min(...boxes.map(box => box.y))}`
      : "";
    rows.push({
      cells: [match[1].trim(), match[2], match[3]],
      sourceLocation: `OCR sayfa ${input.sourcePageNumber ?? 1}, satır ${line.index + 1}${position}`,
    });
  }
  return buildOesseShiftReportDraft({
    rows: [
      {
        cells: ["ÖSSE Adı", "Satış Adedi", "Satış Tutarı (TL)"],
        sourceLocation: `OCR sayfa ${input.sourcePageNumber ?? 1}, başlık`,
      },
      ...rows,
    ],
    metadataText: input.lines.map(line => line.text).join("\n"),
    metadataSources: input.lines.map(line => {
      const boxes =
        input.words
          ?.filter(word => word.line === line.index)
          .map(word => word.box) ?? [];
      const sourceLocation = boxes.length
        ? `OCR sayfa ${input.sourcePageNumber ?? 1}, satır ${line.index + 1}, x=${Math.min(...boxes.map(box => box.x))}, y=${Math.min(...boxes.map(box => box.y))}`
        : `OCR sayfa ${input.sourcePageNumber ?? 1}, satır ${line.index + 1}`;
      return { text: line.text, sourceLocation };
    }),
    sourceSha256: input.sourceSha256,
  });
}

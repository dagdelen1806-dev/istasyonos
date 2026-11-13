/**
 * Read-only draft model for the station's daily cash-up XLSX.
 * Formula cells are evidence only and never contribute to calculated totals.
 */
export type DailyAccountCell = {
  address: string;
  column: number;
  type: string;
  value?: unknown;
  display?: string;
  requiresConfirmation?: boolean;
  formulaCache?: boolean;
};

export type DailyAccountSheet = {
  name: string;
  rows: { rowNumber: number; cells: DailyAccountCell[] }[];
};

export type DailyAccountDraft = {
  kind: "DAILY_STAFF_CASH_UP";
  sourceSha256: string;
  sheetName: string;
  headerDateRaw: string | null;
  headerDateLocation: string | null;
  dateStatus: "AMBIGUOUS_OR_UNMATCHED" | "MATCHED" | "MISMATCH" | "UNKNOWN";
  staffRows: {
    sourceRow: number;
    sourceLocation: string;
    nameSuggestion: string | null;
    duplicateName: boolean;
    staffUserId: null;
    requiresUserMapping: true;
    cashMinor: number | null;
    cardSlipMinor: number | null;
    fastMinor: number | null;
    ibanMinor: number | null;
    debtMinor: number | null;
    declaredTotalMinor: number | null;
    automationMinor: number | null;
    sourceCells: {
      name: string | null;
      cash: string | null;
      cardSlip: string | null;
      fast: string | null;
      iban: string | null;
      debt: string | null;
      automation: string | null;
    };
  }[];
  totals: {
    cashMinor: number | null;
    cardSlipMinor: number | null;
    fastMinor: number | null;
    ibanMinor: number | null;
    debtMinor: number | null;
    declaredTotalMinor: number | null;
    automationMinor: number | null;
    declarationVarianceMinor: number | null;
    posDayEndMinor: number | null;
    posDayEndVarianceMinor: number | null;
    posBefore23Minor: number;
    posAfter23Minor: number;
    posTimeUnknownMinor: number;
  };
  posRows: {
    sourceRow: number;
    sourceLocation: string;
    sourceCells: {
      amount: string | null;
      period: string | null;
      staff: string | null;
    };
    amountMinor: number;
    period: "BEFORE_23" | "AFTER_23" | "UNKNOWN";
    nameSuggestion: string | null;
  }[];
  blankCategories: string[];
  ignoredFormulaCells: string[];
  warnings: string[];
  status: "REVIEW_REQUIRED";
  financialApplied: false;
  bankConfirmed: false;
  personnelDebtCreated: false;
};

/** Legacy/parser payloads may omit cell evidence; that is unknown, not zero. */
export function safeDailySourceCellEntries(value: unknown): [string, string][] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  return Object.entries(value as Record<string, unknown>).filter(
    (entry): entry is [string, string] =>
      typeof entry[1] === "string" && entry[1].trim().length > 0
  );
}

const moneyColumns = [
  ["cashMinor", 4, "Nakit"],
  ["cardSlipMinor", 5, "KK-Slip"],
  ["fastMinor", 6, "FAST"],
  ["ibanMinor", 7, "EFT/IBAN"],
  ["debtMinor", 8, "Borç verilen / Cari"],
] as const;

function minorUnits(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0)
    return null;
  const minor = Math.round(value * 100);
  return Number.isSafeInteger(minor) ? minor : null;
}

function checkedSum(values: number[]) {
  return values.reduce((sum, value) => {
    const next = sum + value;
    if (!Number.isSafeInteger(next))
      throw new Error("Günlük hesap kuruş toplamı sınırı aşıyor.");
    return next;
  }, 0);
}

function cellAt(row: DailyAccountSheet["rows"][number], column: number) {
  return row.cells.find(cell => cell.column === column);
}

function safeLabel(cell: DailyAccountCell | undefined) {
  const value =
    cell?.type === "formula" ? cell.display : (cell?.value ?? cell?.display);
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function buildDailyAccountDraft(input: {
  sheets: DailyAccountSheet[];
  sourceSha256: string;
  automationStartsAt?: string | null;
  automationEndsAt?: string | null;
}): DailyAccountDraft | null {
  for (const sheet of input.sheets) {
    const first = sheet.rows.find(row => row.rowNumber === 1);
    if (!first) continue;
    const header = (column: number) =>
      (safeLabel(cellAt(first, column)) ?? "").toLowerCase();
    if (
      !header(3).includes("pompac") ||
      !header(4).includes("nak") ||
      !header(5).includes("slip") ||
      !header(6).includes("fast") ||
      !header(7).includes("eft") ||
      !header(8).includes("bor") ||
      !header(9).includes("toplam") ||
      !header(10).includes("oto")
    )
      continue;

    const headerDateRaw =
      safeLabel(cellAt(first, 3))?.match(
        /\b\d{1,2}[/.]\d{1,2}[/.]\d{4}\b/
      )?.[0] ?? null;
    const headerDateLocation = cellAt(first, 3)?.address ?? null;
    const staffRows: DailyAccountDraft["staffRows"] = [];
    const posRows: DailyAccountDraft["posRows"] = [];
    const ignoredFormulaCells: string[] = first.cells
      .filter(cell => cell.type === "formula" || cell.formulaCache)
      .map(cell => cell.address);
    const warnings: string[] = [];
    const blankCategories = new Set<string>();
    const missingCategories = new Set<string>();
    const collected = new Map<string, number[]>();
    for (const [key] of moneyColumns) collected.set(key, []);
    const automationValues: number[] = [];
    let automationMissing = false;

    for (const row of sheet.rows) {
      if (row.rowNumber <= 1) continue;
      for (const cell of row.cells)
        if (cell.type === "formula" || cell.formulaCache)
          ignoredFormulaCells.push(cell.address);
      const nameSuggestion = safeLabel(cellAt(row, 3));
      const categoryAmounts: Partial<
        Record<(typeof moneyColumns)[number][0], number | null>
      > = {};
      let hasCashupInput = false;
      for (const [key, column, label] of moneyColumns) {
        const cell = cellAt(row, column);
        if (cell?.type === "formula" || cell?.formulaCache) {
          ignoredFormulaCells.push(cell.address);
          categoryAmounts[key] = null;
          blankCategories.add(label);
          hasCashupInput = true;
        } else if (cell?.type === "number" && typeof cell.value === "number") {
          const amount = minorUnits(cell.value);
          categoryAmounts[key] = amount;
          if (amount !== null) collected.get(key)!.push(amount);
          hasCashupInput = true;
        } else {
          categoryAmounts[key] = null;
        }
      }
      const automationCell = cellAt(row, 10);
      let automationMinor: number | null = null;
      if (automationCell?.type === "formula" || automationCell?.formulaCache) {
        ignoredFormulaCells.push(automationCell.address);
        blankCategories.add("Otomasyon satışı");
        hasCashupInput = true;
      } else if (
        automationCell?.type === "number" &&
        typeof automationCell.value === "number"
      ) {
        automationMinor = minorUnits(automationCell.value);
        if (automationMinor !== null) automationValues.push(automationMinor);
        hasCashupInput = true;
      }
      if (hasCashupInput) {
        for (const [key, , label] of moneyColumns) {
          if (categoryAmounts[key] === null) {
            missingCategories.add(key);
            blankCategories.add(label);
          }
        }
        if (automationMinor === null) automationMissing = true;
        const known = moneyColumns
          .map(([key]) => categoryAmounts[key])
          .filter((v): v is number => v !== null && v !== undefined);
        const declaredTotalMinor = moneyColumns.every(
          ([key]) => categoryAmounts[key] !== null
        )
          ? checkedSum(known)
          : null;
        staffRows.push({
          sourceRow: row.rowNumber,
          sourceLocation: `${sheet.name}!${row.rowNumber}`,
          nameSuggestion,
          duplicateName: false,
          staffUserId: null,
          requiresUserMapping: true,
          cashMinor: categoryAmounts.cashMinor ?? null,
          cardSlipMinor: categoryAmounts.cardSlipMinor ?? null,
          fastMinor: categoryAmounts.fastMinor ?? null,
          ibanMinor: categoryAmounts.ibanMinor ?? null,
          debtMinor: categoryAmounts.debtMinor ?? null,
          declaredTotalMinor,
          automationMinor,
          sourceCells: {
            name: cellAt(row, 3)?.address ?? null,
            cash: cellAt(row, 4)?.address ?? null,
            cardSlip: cellAt(row, 5)?.address ?? null,
            fast: cellAt(row, 6)?.address ?? null,
            iban: cellAt(row, 7)?.address ?? null,
            debt: cellAt(row, 8)?.address ?? null,
            automation: automationCell?.address ?? null,
          },
        });
      }

      const posCell = cellAt(row, 13);
      if (posCell?.type === "number" && typeof posCell.value === "number") {
        const amountMinor = minorUnits(posCell.value);
        if (amountMinor !== null) {
          const periodText =
            safeLabel(cellAt(row, 14))?.toLocaleLowerCase("tr-TR") ?? "";
          const period =
            periodText.includes("23 den önce") ||
            periodText.includes("23'ten önce")
              ? ("BEFORE_23" as const)
              : periodText.includes("23 den sonra") ||
                  periodText.includes("23'ten sonra")
                ? ("AFTER_23" as const)
                : ("UNKNOWN" as const);
          posRows.push({
            sourceRow: row.rowNumber,
            sourceLocation: `${sheet.name}!M${row.rowNumber}`,
            sourceCells: {
              amount: posCell.address,
              period: cellAt(row, 14)?.address ?? null,
              staff: cellAt(row, 3)?.address ?? null,
            },
            amountMinor,
            period,
            nameSuggestion,
          });
        }
      } else if (posCell?.type === "formula" || posCell?.formulaCache)
        ignoredFormulaCells.push(posCell.address);
    }

    const totalFor = (key: string) =>
      missingCategories.has(key) ? null : checkedSum(collected.get(key) ?? []);
    const cashMinor = totalFor("cashMinor"),
      cardSlipMinor = totalFor("cardSlipMinor"),
      fastMinor = totalFor("fastMinor"),
      ibanMinor = totalFor("ibanMinor"),
      debtMinor = totalFor("debtMinor"),
      declaredTotalMinor = [
        cashMinor,
        cardSlipMinor,
        fastMinor,
        ibanMinor,
        debtMinor,
      ].some(value => value === null)
        ? null
        : checkedSum([
            cashMinor!,
            cardSlipMinor!,
            fastMinor!,
            ibanMinor!,
            debtMinor!,
          ]),
      automationMinor = automationMissing ? null : checkedSum(automationValues),
      posDayEndMinor = checkedSum(posRows.map(row => row.amountMinor)),
      posBefore23Minor = checkedSum(
        posRows
          .filter(row => row.period === "BEFORE_23")
          .map(row => row.amountMinor)
      ),
      posAfter23Minor = checkedSum(
        posRows
          .filter(row => row.period === "AFTER_23")
          .map(row => row.amountMinor)
      ),
      posTimeUnknownMinor = checkedSum(
        posRows
          .filter(row => row.period === "UNKNOWN")
          .map(row => row.amountMinor)
      );

    const blankHeader = moneyColumns
      .filter(
        ([, column]) =>
          !sheet.rows.some(
            row => row.rowNumber > 1 && cellAt(row, column)?.type === "number"
          )
      )
      .map(([, , label]) => label);
    const normalizeName = (value: string | null) =>
      value
        ?.normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLocaleLowerCase("tr-TR")
        .replace(/[^a-z0-9]+/g, " ")
        .trim() ?? "";
    const nameCounts = new Map<string, number>();
    for (const row of staffRows) {
      const key = normalizeName(row.nameSuggestion);
      if (key) nameCounts.set(key, (nameCounts.get(key) ?? 0) + 1);
    }
    for (const row of staffRows) {
      const key = normalizeName(row.nameSuggestion);
      row.duplicateName = !!key && (nameCounts.get(key) ?? 0) > 1;
    }
    blankHeader.forEach(label => blankCategories.add(label));
    const dateMatch = headerDateRaw?.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
    const unambiguousDate = dateMatch
      ? `${dateMatch[3]}-${dateMatch[2]}-${dateMatch[1]}`
      : headerDateRaw && /^\d{4}-\d{2}-\d{2}$/.test(headerDateRaw)
        ? headerDateRaw
        : null;
    const shiftDates = [input.automationStartsAt, input.automationEndsAt]
      .filter((value): value is string => !!value)
      .map(value => value.slice(0, 10));
    const dateStatus: DailyAccountDraft["dateStatus"] = !headerDateRaw
      ? "UNKNOWN"
      : !unambiguousDate || !shiftDates.length
        ? "AMBIGUOUS_OR_UNMATCHED"
        : shiftDates.includes(unambiguousDate)
          ? "MATCHED"
          : "MISMATCH";
    if (dateStatus !== "MATCHED")
      warnings.push(
        "Excel başlık tarihi vardiya aralığıyla kesin eşleşmedi; 09/10/2026 gibi tarih metinleri belirsiz kabul edilir."
      );
    if (blankCategories.size)
      warnings.push(
        "Boş veya formüllü alanlar doğrulanmış değer sayılmadı; toplamlar yalnız sayısal kaynak hücrelerinden yeniden hesaplandı."
      );
    if (ignoredFormulaCells.length)
      warnings.push("Formüller ve önbellek sonuçları hesaplamaya alınmadı.");
    if (staffRows.some(row => !row.nameSuggestion || row.duplicateName))
      warnings.push(
        "Boş veya yinelenen personel adı var; yalnız açık kalıcı kimlik eşlemesi kullanılabilir."
      );
    if (posRows.some(row => row.period === "UNKNOWN"))
      warnings.push(
        "POS gün sonu satırlarının bir kısmında 23:00 öncesi/sonrası sınıflaması belirsiz."
      );
    warnings.push(
      "Personel adları öneridir; her satır kalıcı FUEL_STAFF kimliğiyle açıkça eşlenmelidir."
    );
    warnings.push(
      "POS toplamı işlem tarihi, terminal, banka ve gün sonu kapsamı doğrulanmadan kart beyanıyla kesin eşleşme değildir."
    );
    if (
      automationMinor !== null &&
      declaredTotalMinor !== null &&
      declaredTotalMinor !== automationMinor
    )
      warnings.push(
        "Beyan toplamı ile otomasyon satış toplamı arasında ön inceleme farkı var."
      );
    return {
      kind: "DAILY_STAFF_CASH_UP",
      sourceSha256: input.sourceSha256,
      sheetName: sheet.name,
      headerDateRaw,
      headerDateLocation,
      dateStatus,
      staffRows,
      totals: {
        cashMinor,
        cardSlipMinor,
        fastMinor,
        ibanMinor,
        debtMinor,
        declaredTotalMinor,
        automationMinor,
        declarationVarianceMinor:
          declaredTotalMinor === null || automationMinor === null
            ? null
            : declaredTotalMinor - automationMinor,
        posDayEndMinor,
        posDayEndVarianceMinor:
          cardSlipMinor === null ? null : posDayEndMinor - cardSlipMinor,
        posBefore23Minor,
        posAfter23Minor,
        posTimeUnknownMinor,
      },
      posRows,
      blankCategories: [...blankCategories],
      ignoredFormulaCells: [...new Set(ignoredFormulaCells)],
      warnings,
      status: "REVIEW_REQUIRED",
      financialApplied: false,
      bankConfirmed: false,
      personnelDebtCreated: false,
    };
  }
  return null;
}

import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  normalizePosSlipDateTime,
  checkPosSlipImagePrivacy,
  parsePosSlipFields,
  posSlipAccessAllowed,
  posSlipAmountMismatch,
  posSlipTransactionKey,
  parsePosSlipText,
  samePosSlip,
  validatePosSlipConfirmation,
} from "./pos-slip";
import { recognizeImage } from "./windows-ocr";

const synthetic = [
  { label: "Tarih/Saat", value: "07.11.2026 16:20:19" },
  { label: "Tutar", value: "1.234,50 TL" },
  { label: "Banka", value: "ÖRNEK DEMO BANKA" },
  { label: "Terminal No", value: "DEMO-TERM-04" },
  { label: "İşlem Referansı", value: "DEMO-REF-00042" },
  { label: "İşlem Türü", value: "SATIŞ" },
  { label: "Beyan Türü", value: "POS/Kart Slip" },
  { label: "Maskeli Kart", value: "**** 1234" },
];

describe("POS_SLIP OCR draft rules", () => {
  it("parses synthetic Turkish POS fields without network or database", () => {
    const result = parsePosSlipFields(synthetic);
    expect(result.values).toMatchObject({
      transactionAt: "2026-11-07T16:20:19+03:00",
      amountMinor: 123450,
      bank: "ÖRNEK DEMO BANKA",
      terminal: "••••RM04",
      reference: "••••0042",
      transactionType: "SALE",
      maskedCard: "•••• 1234",
      settlementKind: "CARD_SLIP",
    });
    expect(result.reviewRequired).toBe(false);
  });

  it("parses thermal POS and FAST line layouts, masks identifiers, and keeps them separate", () => {
    const pos = parsePosSlipText(
      [
        "ISYERI NO: 00000000000000 POS NO: 01805894",
        "ISLEM NO: GP0001 BATCH NO:1602 05/11/2026-13:03",
        "SATIS",
        "**** **** **** 2276",
        "TUTAR",
        "2.500,79 TL",
        "KAREKOD REF: PRIVATE123456",
        "HALKBANK",
      ].join("\n")
    );
    expect(pos.values).toMatchObject({
      amountMinor: 250079,
      transactionAt: "2026-11-05T13:03:00+03:00",
      terminal: "••••5894",
      transactionType: "SALE",
      settlementKind: "CARD_SLIP",
      reference: "••••3456",
      bank: "HALKBANK",
    });
    expect(pos.source.referenceFingerprint).toMatch(/^[a-f0-9]{64}$/u);
    expect(JSON.stringify(pos)).not.toContain("PRIVATE123456");

    const fast = parsePosSlipText(
      [
        "POS NO: 01805894 05/11/2026-15:24",
        "FAST SATIS",
        "TUTAR",
        "4.400,89 TL",
        "IBAN: TR32****************7271",
        "FAST REF: PRIVATEFAST1234",
        "HALKBANK",
      ].join("\n")
    );
    expect(fast.values).toMatchObject({
      amountMinor: 440089,
      settlementKind: "FAST",
      transactionType: "SALE",
    });
    expect(fast.values.reference).toBe("••••1234");
    expect(JSON.stringify(fast)).not.toContain("PRIVATEFAST1234");
    expect(JSON.stringify(fast)).not.toContain("TR32");
  });

  it("normalizes Turkish thousands and decimal separators without changing value", () => {
    expect(
      parsePosSlipFields([{ label: "Tutar", value: "2.500,79 TL" }]).values
        .amountMinor
    ).toBe(250079);
  });

  it.skipIf(!process.env.POS_SLIP_LOCAL_FIXTURES)(
    "reads user supplied receipts only through local Windows OCR and reports field checks without raw text",
    async () => {
      const root = process.env.POS_SLIP_LOCAL_FIXTURES!;
      const fixtures = [
        {
          id: "POS-A",
          file: "WhatsApp Image 2026-11-07 at 16.20.08.jpeg",
          amountMinor: 250079,
          settlementKind: "CARD_SLIP",
        },
        {
          id: "POS-B",
          file: "WhatsApp Image 2026-11-07 at 16.20.08 (1).jpeg",
          amountMinor: 100000,
          settlementKind: "CARD_SLIP",
        },
        {
          id: "POS-C",
          file: "WhatsApp Image 2026-11-07 at 16.20.08 (2).jpeg",
          amountMinor: 1000000,
          settlementKind: "CARD_SLIP",
        },
        {
          id: "FAST-A",
          file: "WhatsApp Image 2026-11-07 at 16.20.08 (3).jpeg",
          amountMinor: 440089,
          settlementKind: "FAST",
        },
      ] as const;
      for (const fixture of fixtures) {
        const native = await recognizeImage(
          await readFile(join(root, fixture.file))
        );
        const text = native.lines
          .map((line: any) =>
            line.words.map((word: any) => word.text).join(" ")
          )
          .join("\n");
        const result = parsePosSlipText(text);
        const checks = {
          amount: result.values.amountMinor === fixture.amountMinor,
          datetime: result.values.transactionAt !== null,
          bank: result.values.bank !== null,
          terminal: result.values.terminal !== null,
          reference: result.values.reference !== null,
          kind: result.values.settlementKind === fixture.settlementKind,
          operation: result.values.transactionType === "SALE",
          maskedCard:
            fixture.settlementKind !== "CARD_SLIP" ||
            result.values.maskedCard !== null,
        };
        console.info(
          "POS local OCR fields",
          JSON.stringify({
            id: fixture.id,
            checks,
            lineCount: native.lines.length,
            skewDegrees: native.angle,
            preprocessing: native.preprocessing ?? "original",
            preprocessingScores: native.preprocessingScores,
          })
        );
        expect(checks.amount, `${fixture.id} amount`).toBe(true);
        expect(
          result.values.settlementKind === fixture.settlementKind ||
            result.values.settlementKind === null,
          `${fixture.id} category is correct or left for user review`
        ).toBe(true);
        expect(checks.operation, `${fixture.id} transaction type`).toBe(true);
      }
    },
    30000
  );

  it.each([
    ["IPTAL", "VOID"],
    ["İADE", "REFUND"],
    ["SATIŞ", "SALE"],
  ])("distinguishes transaction type %s", (source, expected) => {
    expect(
      parsePosSlipFields([{ label: "İşlem Türü", value: source }]).values
        .transactionType
    ).toBe(expected);
  });

  it("keeps invalid and missing date/time as a reviewable blank", () => {
    expect(normalizePosSlipDateTime("31.02.2026 16:20")).toBeNull();
    const result = parsePosSlipFields([
      { label: "Tarih/Saat", value: "31.02.2026 16:20" },
    ]);
    expect(result.values.transactionAt).toBeNull();
    expect(result.reviewRequired).toBe(true);
  });

  it("surfaces OCR amount mismatch instead of silently replacing it", () => {
    expect(posSlipAmountMismatch(123450, 123400)).toBe(true);
    expect(posSlipAmountMismatch(123450, 123450)).toBe(false);
    expect(parsePosSlipFields(synthetic).values.amountMinor).toBe(123450);
  });

  it("rejects full card and CVV values before any draft JSON is persisted", () => {
    expect(() =>
      parsePosSlipFields([{ label: "Referans", value: "4111 1111 1111 1111" }])
    ).toThrowError(/Hassas kart verisi/);
    expect(() =>
      parsePosSlipFields([{ label: "CVV", value: "123" }])
    ).toThrowError(/Hassas kart verisi/);
    expect(() =>
      parsePosSlipFields([{ label: "Güvenlik Kodu", value: "123" }])
    ).toThrowError(/Hassas kart verisi/);
    expect(() =>
      parsePosSlipFields([
        { label: "IBAN", value: "TR320000000000000000000000" },
      ])
    ).toThrowError(/Hassas kart verisi/);
  });

  it("requires sensitive receipt identifiers to be masked before private image storage", () => {
    expect(() =>
      checkPosSlipImagePrivacy("KAREKOD REF: PRIVATE123456")
    ).toThrowError(/Tam işlem/);
    expect(() =>
      checkPosSlipImagePrivacy("KAREKOD REF: ••••3456")
    ).not.toThrow();
  });

  it("blocks repeated slip identity and rejects duplicate normalized transaction keys", () => {
    const first = parsePosSlipFields(synthetic).values;
    const duplicate = { ...first, terminal: "••••RM04", reference: "••••0042" };
    expect(samePosSlip(first as any, duplicate as any)).toBe(true);
    expect(
      posSlipTransactionKey(
        first,
        "fixture-reference-hash",
        "fixture-terminal-hash"
      )
    ).toBe(
      posSlipTransactionKey(
        duplicate,
        "fixture-reference-hash",
        "fixture-terminal-hash"
      )
    );
    expect(
      samePosSlip(first as any, { ...duplicate, reference: "OTHER" } as any)
    ).toBe(false);
  });

  it("limits staff access to own records and allows scoped accounting review", () => {
    expect(posSlipAccessAllowed("FUEL_STAFF", false)).toBe(false);
    expect(posSlipAccessAllowed("FUEL_STAFF", true)).toBe(true);
    expect(posSlipAccessAllowed("ACCOUNTANT", false)).toBe(true);
    expect(posSlipAccessAllowed("MARKET_STAFF", true)).toBe(false);
  });

  it("requires complete, valid fields before a payment slip can be created", () => {
    const values = parsePosSlipFields(synthetic).values;
    expect(() => validatePosSlipConfirmation(values)).not.toThrow();
    expect(() =>
      validatePosSlipConfirmation({ ...values, transactionType: null })
    ).toThrowError(/işlem türü gereklidir/);
  });
});

describe("POS slip ambiguous OCR evidence", () => {
  it("leaves amount blank when an unlabeled text layer contains multiple money candidates", () => {
    const result = parsePosSlipText(
      "HALKBANK\nSATIS\n2.500,79 TL\nKDV\n500,00 TL"
    );
    expect(result.values.amountMinor).toBeNull();
    expect(result.reviewRequired).toBe(true);
  });

  it("does not choose sale when sale and cancellation evidence conflict", () => {
    const result = parsePosSlipText(
      "HALKBANK\nSATIS\nIPTAL\nTUTAR\n2.500,79 TL"
    );
    expect(result.values.transactionType).toBeNull();
    expect(result.reviewRequired).toBe(true);
  });

  it("does not infer a settlement kind from mixed FAST and card evidence", () => {
    const result = parsePosSlipText(
      "HALKBANK\nFAST SATIS\n**** **** 2276\nFAST REF: DEMO1234\nTUTAR\n4.400,89 TL"
    );
    expect(result.values.settlementKind).toBeNull();
    expect(result.reviewRequired).toBe(true);
  });
});

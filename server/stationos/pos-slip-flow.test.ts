import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockFirst, mockExecute, mockRows } = vi.hoisted(() => ({
  mockFirst: vi.fn(),
  mockExecute: vi.fn(),
  mockRows: vi.fn(),
}));
vi.mock("./db", () => ({ first: mockFirst, execute: mockExecute, rows: mockRows }));

import { confirmPosSlipDraft, readPosSlipDraft } from "./pos-slip";
const connection = {} as any;
const scope = { tenantId: "demo-tenant", stationId: "demo-station" };
const draftId = "11111111-1111-4111-8111-111111111111";
const accountId = "22222222-2222-4222-8222-222222222222";
const values = {
  transactionAt: "2026-11-07T16:20:00+03:00",
  amountMinor: 123450,
  bank: "ÖRNEK DEMO BANKA",
  terminal: "DEMO-TERM-04",
  reference: "DEMO-REF-00042",
  transactionType: "SALE" as const,
  settlementKind: "CARD_SLIP" as const,
  maskedCard: "**** 1234",
};

beforeEach(() => {
  mockFirst.mockReset();
  mockExecute.mockReset().mockResolvedValue(undefined);
  mockRows.mockReset().mockResolvedValue([]);
});

describe("POS slip taslak / teyit sınırı", () => {
  it("manual/OCR draft read never writes a payment row", async () => {
    mockFirst.mockResolvedValueOnce({
      id: draftId,
      review_status: "DRAFT",
      mime_type: "image/jpeg",
      image_bytes: Buffer.from("masked-fixture"),
    });
    await readPosSlipDraft(
      connection,
      scope,
      draftId,
      accountId,
      7,
      "MANUAL",
      false
    );
    expect(mockExecute.mock.calls.map(([, sql]) => String(sql))).toEqual([
      expect.stringContaining("UPDATE st_pos_slip_drafts"),
    ]);
    expect(mockExecute.mock.calls.some(([, sql]) => String(sql).includes("INSERT INTO st_slips"))).toBe(false);
  });

  it("creates the existing verified-slip record only after staff confirmation", async () => {
    mockFirst
      .mockResolvedValueOnce({
        id: draftId,
        review_status: "DRAFT",
        revision: 2,
        values_json: JSON.stringify(values),
      })
      .mockResolvedValueOnce(null);
    const result = await confirmPosSlipDraft(
      connection,
      scope,
      7,
      {
        draftId,
        draftRevision: 2,
        staffConfirmed: true,
        amountOverrideConfirmed: false,
      },
      { id: accountId, card_total_minor: 0 } as any
    );
    expect(result.status).toBe("PAYMENT_CREATED");
    expect(mockExecute.mock.calls.some(([, sql]) => String(sql).includes("INSERT INTO st_slips"))).toBe(true);
    expect(mockExecute.mock.calls.some(([, sql]) => String(sql).includes("UPDATE st_pos_slip_drafts SET review_status='PAYMENT_CREATED'"))).toBe(true);
  });

  it("links a confirmed FAST receipt to a separate unverified FAST declaration", async () => {
    mockFirst
      .mockResolvedValueOnce({
        id: draftId,
        review_status: "DRAFT",
        revision: 2,
        values_json: JSON.stringify({ ...values, reference: "••••0042", terminal: "••••RM04", settlementKind: "FAST" }),
        ocr_json: JSON.stringify({ source: { referenceFingerprint: "a".repeat(64), terminalFingerprint: "b".repeat(64) } }),
      })
      .mockResolvedValueOnce(null);
    const result = await confirmPosSlipDraft(
      connection,
      scope,
      7,
      { draftId, draftRevision: 2, staffConfirmed: true, amountOverrideConfirmed: false },
      { id: accountId, card_total_minor: 0 } as any
    );
    expect(result).toMatchObject({ status: "PAYMENT_CREATED", declarationKind: "FAST", bankConfirmed: false });
    expect(mockExecute.mock.calls.some(([, sql]) => String(sql).includes("INSERT INTO st_payments") && String(sql).includes("'FAST'"))).toBe(true);
    expect(mockExecute.mock.calls.some(([, sql]) => String(sql).includes("INSERT INTO st_slips"))).toBe(false);
    expect(mockExecute.mock.calls.some(([, sql, params]) => String(sql).includes("ocr_json") && String(params).includes("linkedPaymentId"))).toBe(true);
  });
});

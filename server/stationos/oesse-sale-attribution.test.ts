import { describe, expect, it } from "vitest";
import {
  validateOesseSaleAttributions,
  type OesseAutomationSaleEvent,
} from "../../shared/oesse-sale-attribution";
import {
  syntheticOesseSaleEvents,
  syntheticOesseSaleScope,
} from "./oesse-sale-attribution.fixture";

describe("ÖSSE–pompa–tabanca işlem atfı sözleşme taslağı", () => {
  it("gece yarısını aşan vardiyada kapsamı tam eşleşen kaynak işlemleri yalnız taslak sayar", () => {
    const result = validateOesseSaleAttributions(
      syntheticOesseSaleEvents,
      syntheticOesseSaleScope
    );
    expect(result).toMatchObject({
      state: "DRAFT_READY",
      totals: { saleCount: 2, volumeMl: 60450, amountMinor: 365600 },
      financialApplied: false,
      meterReadingCreated: false,
      personnelDebtCreated: false,
    });
    expect(result.rows.every(row => row.state === "MATCHED_DRAFT")).toBe(true);
  });

  it("atanmış ÖSSE'nin aynı istasyondaki farklı tabancalardaki işlemlerini eşler", () => {
    const secondStaffOnSamePump = {
      ...syntheticOesseSaleEvents[0],
      sourceEventId: "event-demo-0003",
      nozzleId: "nozzle-demo-2",
      staffUserId: 102,
    };
    const result = validateOesseSaleAttributions(
      [...syntheticOesseSaleEvents, secondStaffOnSamePump],
      syntheticOesseSaleScope
    );
    expect(result.state).toBe("DRAFT_READY");
    expect(result.rows[2]).toMatchObject({
      staffUserId: 102,
      nozzleId: "nozzle-demo-2",
      state: "MATCHED_DRAFT",
    });
  });

  it("personel kimliği yoksa işlemi UNASSIGNED bırakır ve toplam oluşturmaz", () => {
    const unassigned = {
      ...syntheticOesseSaleEvents[0],
      staffUserId: null,
    };
    const result = validateOesseSaleAttributions(
      [unassigned],
      syntheticOesseSaleScope
    );
    expect(result.rows[0]).toMatchObject({
      state: "UNASSIGNED",
      amountMinor: null,
      volumeMl: null,
      issues: ["STAFF_ID_MISSING"],
    });
    expect(result.totals).toBeNull();
  });

  it.each([
    ["tenantId", "another-tenant", "TENANT_STATION_OR_SHIFT_MISMATCH"],
    ["stationId", "another-station", "TENANT_STATION_OR_SHIFT_MISMATCH"],
    ["shiftId", "another-shift", "TENANT_STATION_OR_SHIFT_MISMATCH"],
    ["staffUserId", 999, "STAFF_NOT_ASSIGNED_TO_SHIFT"],
    ["nozzleId", "nozzle-other-station", "NOZZLE_NOT_IN_STATION_SCOPE"],
    ["pumpId", "pump-demo-2", "PUMP_NOZZLE_MISMATCH"],
    ["productId", "fuel-demo-gasoline", "PRODUCT_NOZZLE_MISMATCH"],
    ["soldAt", "2026-11-11T09:00:00.000Z", "SALE_OUTSIDE_SHIFT"],
  ] as const)(
    "%s eşleşmediğinde ÖSSE satışını kesinleştirmez",
    (field, value, issue) => {
      const event = {
        ...syntheticOesseSaleEvents[0],
        [field]: value,
      } as OesseAutomationSaleEvent;
      const result = validateOesseSaleAttributions(
        [event],
        syntheticOesseSaleScope
      );
      expect(result.state).toBe("REVIEW_REQUIRED");
      expect(result.rows[0].issues).toContain(issue);
      expect(result.totals).toBeNull();
    }
  );

  it("aynı otomasyon işlem kimliği ikinci kez görünürse çift sayımı ve toplamı engeller", () => {
    const duplicate = { ...syntheticOesseSaleEvents[0] };
    const result = validateOesseSaleAttributions(
      [syntheticOesseSaleEvents[0], duplicate],
      syntheticOesseSaleScope
    );
    expect(result.rows.map(row => row.state)).toEqual([
      "REVIEW_REQUIRED",
      "REVIEW_REQUIRED",
    ]);
    expect(
      result.rows.every(row => row.issues.includes("DUPLICATE_SOURCE_EVENT_ID"))
    ).toBe(true);
    expect(result.totals).toBeNull();
  });

  it.each(["VOID", "REFUND", "CORRECTION"] as const)(
    "%s hareketini otomatik netleştirmez; kaynak işlemi ve muhasebe incelemesi ister",
    eventType => {
      const reversal = {
        ...syntheticOesseSaleEvents[0],
        sourceEventId: "event-demo-reversal",
        eventType,
        reversesSourceEventId: syntheticOesseSaleEvents[0].sourceEventId,
      };
      const result = validateOesseSaleAttributions(
        [syntheticOesseSaleEvents[0], reversal],
        syntheticOesseSaleScope
      );
      expect(result.rows[1].issues).toContain(
        "REVERSAL_REQUIRES_ACCOUNTING_REVIEW"
      );
      expect(result.totals).toBeNull();
      expect(result.financialApplied).toBe(false);
    }
  );

  it("vardiya sınırı, kanıt, doğrulanmış kaynak ve ölçüler eksikse REVIEW_REQUIRED döndürür", () => {
    const incomplete = {
      ...syntheticOesseSaleEvents[0],
      soldAt: "2026-11-10 23:00:00",
      evidenceRef: null,
      sourceVerified: false,
      amountMinor: null,
      volumeMl: null,
    };
    const result = validateOesseSaleAttributions(
      [incomplete],
      syntheticOesseSaleScope
    );
    expect(result.rows[0].state).toBe("REVIEW_REQUIRED");
    expect(result.rows[0].issues).toEqual(
      expect.arrayContaining([
        "SOURCE_NOT_VERIFIED",
        "SALE_TIME_MISSING_OR_INVALID",
        "AMOUNT_MISSING_OR_INVALID",
        "VOLUME_MISSING_OR_INVALID",
        "SOURCE_EVIDENCE_MISSING",
      ])
    );
    expect(result.totals).toBeNull();
  });

  it("takvimde geçersiz satış zamanını kabul etmez", () => {
    const invalidDate = {
      ...syntheticOesseSaleEvents[0],
      soldAt: "2026-02-30T22:15:00.000Z",
    };
    const result = validateOesseSaleAttributions(
      [invalidDate],
      syntheticOesseSaleScope
    );
    expect(result.rows[0].state).toBe("REVIEW_REQUIRED");
    expect(result.rows[0].issues).toContain("SALE_TIME_MISSING_OR_INVALID");
    expect(result.totals).toBeNull();
  });

  it("hatalı vardiya aralığını tüm eşlemeler için fail-closed reddeder", () => {
    const result = validateOesseSaleAttributions(syntheticOesseSaleEvents, {
      ...syntheticOesseSaleScope,
      endsAt: "2026-11-10T19:00:00.000Z",
    });
    expect(result.state).toBe("REVIEW_REQUIRED");
    expect(
      result.rows.every(row =>
        row.issues.includes("INVALID_SHIFT_OR_STATION_SCOPE")
      )
    ).toBe(true);
    expect(result.totals).toBeNull();
  });
});

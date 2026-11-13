import { describe, expect, it } from "vitest";
import {
  buildOseeSalesSummary,
  type OseeSalesScope,
} from "../../shared/oesse-sales-summary";

const scope: OseeSalesScope = {
  tenantId: "tenant-1",
  stationId: "station-1",
  businessDate: "2026-11-09",
  shiftId: "shift-1",
  staffUserId: 17,
};
const declarations = {
  cashMinor: 100_000,
  cardSlipMinor: 50_000,
  ibanMinor: 0,
  fastMinor: 0,
  debtMinor: 0,
  specialOperationsMinor: 25_000,
};

describe("ÖSSE mobil satış özeti", () => {
  it("tahsilat/cari beyan toplamını otomasyon satışı olmayan durumda ayrı tutar", () => {
    expect(
      buildOseeSalesSummary({
        declarations,
        expectedScope: scope,
        automation: null,
      })
    ).toEqual({
      declaredTotalMinor: 150_000,
      specialOperationsMinor: 25_000,
      automationSalesMinor: null,
      differenceMinor: null,
      status: "AUTOMATION_SOURCE_MISSING",
    });
  });

  it.each([
    ["tenant", { tenantId: "tenant-2" }],
    ["istasyon", { stationId: "station-2" }],
    ["tarih", { businessDate: "2026-11-10" }],
    ["vardiya", { shiftId: "shift-2" }],
    ["personel", { staffUserId: 18 }],
  ])(
    "%s uyuşmazlığında otomasyon toplamını ve farkı kapalı tutar",
    (_, change) => {
      const result = buildOseeSalesSummary({
        declarations,
        expectedScope: scope,
        automation: {
          scope: { ...scope, ...change },
          amountMinor: 155_000,
          verified: true,
        },
      });
      expect(result.status).toBe("SCOPE_MISMATCH");
      expect(result.automationSalesMinor).toBeNull();
      expect(result.differenceMinor).toBeNull();
    }
  );

  it("doğrulanmamış otomasyon değerini karşılaştırmaya sokmaz", () => {
    const result = buildOseeSalesSummary({
      declarations,
      expectedScope: scope,
      automation: { scope, amountMinor: 155_000, verified: false },
    });
    expect(result.status).toBe("SOURCE_UNVERIFIED");
    expect(result.automationSalesMinor).toBeNull();
    expect(result.differenceMinor).toBeNull();
  });

  it("tam kapsam eşleşmesinde kuruş farkını yalnız ön inceleme olarak hesaplar", () => {
    expect(
      buildOseeSalesSummary({
        declarations,
        expectedScope: scope,
        automation: { scope, amountMinor: 151_301, verified: true },
      })
    ).toEqual({
      declaredTotalMinor: 150_000,
      specialOperationsMinor: 25_000,
      automationSalesMinor: 151_301,
      differenceMinor: 1_301,
      status: "PRELIMINARY_COMPARISON",
    });
  });
});

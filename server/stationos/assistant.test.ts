import { describe, expect, it, vi } from "vitest";
import type { AppState } from "../../shared/station";
import { anonymousSummary, classifyQuestion, explainSummary } from "./assistant";

const sample = (role = "PURCHASER") => ({
  user: { id: 7, name: "PERSONAL-NAME-SECRET", email: "private@example.com" },
  member: {role, stationIds:["PRIVATE-STATION-ID"]},
  stations:[{id:"PRIVATE-STATION-ID",name:"COMPANY-NAME-SECRET"}],
  accounts:[], payments:[],slips:[],
  debtors:[{name:"PERSONAL-DEBTOR-SECRET",balanceMinor:125000}],
  products:[{name:"PRODUCT-SECRET",stockQty:6,minimumQty:10}],
  recommendations:[{productName:"PRODUCT-SECRET",supplierName:"SUPPLIER-SECRET",recommendedQty:18,costMinor:9000,status:"CREDIT_BLOCKED",daysCover:3}],
  payables:[],
}) as unknown as AppState;

describe("Rol bazlı AI veri sınırı", () => {
  it("bağımsız modda haricî servis çağırmadan yetkili yerel özet üretir", async () => {
    vi.stubEnv("AUTH_PROVIDER", "local");
    const request = vi.fn(); vi.stubGlobal("fetch", request);
    try {
      const result = await explainSummary(anonymousSummary(sample("FUEL_STAFF"), "FINANCE"));
      expect(result).toContain("Kural tabanlı yerel özet");
      expect(result).toContain("bilinmiyor / yetki dışında");
      expect(result).not.toContain("SECRET");
      expect(request).not.toHaveBeenCalled();
    } finally { vi.unstubAllGlobals(); vi.unstubAllEnvs(); }
  });
  it("serbest soru metninden yalnız kontrollü konu üretir", () => {
    expect(classifyQuestion("Haftalık sipariş ve toptancı limitleri?")).toBe("PURCHASE_STOCK");
    expect(classifyQuestion("IBAN ödemeleri ve gerçek banka bakiyesi?")).toBe("FINANCE");
    expect(classifyQuestion("Alacak tahsilatı durumunu anlat")).toBe("RECEIVABLES");
  });
  it("anonim sayısal özet isim, email, ürün metni veya ID içermez", () => {
    const summary=anonymousSummary(sample(),"PURCHASE_STOCK");
    const encoded=JSON.stringify(summary);
    for(const forbidden of ["SECRET","private@example.com","PRIVATE-STATION-ID"]) expect(encoded).not.toContain(forbidden);
    expect(summary.creditBlockedProducts).toBe(1);
    expect(summary.bankBalanceMinor).toBeNull();
    expect(summary.liquidityForecast).toBeNull();
  });
  it("yetkisiz müşteri bakiyesi bilinmiyor kalır", () => {
    const summary=anonymousSummary(sample("FUEL_STAFF"),"RECEIVABLES");
    expect(summary.receivableBalanceMinor).toBeNull();
    expect(summary.openSupplierPayablesMinor).toBeNull();
  });
  it("üyeliği olmayan kişiye asistan verisi çıkarmaz", () => {
    const data=sample();data.member=null;
    expect(()=>anonymousSummary(data,"OVERVIEW")).toThrow();
  });
});

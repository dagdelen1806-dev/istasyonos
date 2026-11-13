import { describe, expect, it } from "vitest";
import {
  roleCanAccessPath,
  roleCanViewMarketCatalog,
  roleLandingPath,
} from "@shared/station";

describe("role landing path", () => {
  it.each([
    ["FUEL_STAFF", "/mobil/pompaci"],
    ["MARKET_STAFF", "/market"],
  ] as const)("routes %s to its task screen", (role, path) => {
    expect(roleLandingPath(role)).toBe(path);
  });

  it.each(["OWNER", "MANAGER", "ACCOUNTANT", "PURCHASER"] as const)(
    "preserves the selected dashboard route for %s",
    role => {
      expect(roleLandingPath(role)).toBeNull();
    }
  );

  it("keeps fuel and market staff inside their distinct task routes", () => {
    expect(roleCanAccessPath("FUEL_STAFF", "/market")).toBe(false);
    expect(roleCanAccessPath("FUEL_STAFF", "/mobil/pompaci")).toBe(true);
    expect(roleCanAccessPath("MARKET_STAFF", "/mobil/pompaci")).toBe(false);
    expect(roleCanAccessPath("MARKET_STAFF", "/slipler")).toBe(false);
    expect(roleCanAccessPath("MARKET_STAFF", "/market")).toBe(true);
  });

  it("does not restrict management and accounting routes by staff rules", () => {
    expect(roleCanAccessPath("MANAGER", "/personel")).toBe(true);
    expect(roleCanAccessPath("ACCOUNTANT", "/muhasebe")).toBe(true);
  });

  it("does not expose market catalog state to fuel staff", () => {
    expect(roleCanViewMarketCatalog("FUEL_STAFF")).toBe(false);
    expect(roleCanViewMarketCatalog("MARKET_STAFF")).toBe(true);
    expect(roleCanViewMarketCatalog("MANAGER")).toBe(true);
  });
});

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { amountInput, parseMoney, money } from "../../shared/station";

describe("İstemci para sözleşmesi", () => {
  it("Türkçe kuruşları kayan nokta çarpımına bırakmaz", () => {
    expect(parseMoney("1250,50")).toBe(125050);
    expect(parseMoney("0,01")).toBe(1);
    expect(parseMoney("100.2")).toBe(10020);
    expect(parseMoney(" 0 ")).toBe(0);
  });
  it("binlik ayırıcı ve belirsiz sayı biçimlerini reddeder", () => {
    for (const raw of ["1.250,50", "1,250.50", "-1", "12.345", "Infinity", "1e5", "", "0x10"]) expect(() => parseMoney(raw)).toThrow();
  });
  it("eksik bakiye sıfır değildir; tutar alanı tersine dönüştürülebilir", () => {
    expect(money(null)).toBe("—");
    expect(money(undefined)).toBe("—");
    expect(amountInput(null)).toBe("");
    for (const minor of [0, 1, 12345, 200000001]) expect(parseMoney(amountInput(minor))).toBe(minor);
  });
});

describe("PWA gizlilik sınırı", () => {
  const source = readFileSync(new URL("../../client/public/sw.js", import.meta.url), "utf8");
  const handlers = new Map<string, (event: any) => void>();
  const cacheReads: string[] = [];
  const cachedFiles: string[] = [];
  runInNewContext(source, {
    URL,
    self: { location: { origin: "https://station.example" }, addEventListener: (event: string, handler: any) => handlers.set(event, handler), skipWaiting: () => undefined, clients: { claim: async () => undefined } },
    caches: { open: async () => ({ addAll: async (files: string[]) => cachedFiles.push(...files), match: async (request: any) => { cacheReads.push(request.url || request); return null; } }), keys: async () => [], delete: async () => true, match: async (key: string) => { cacheReads.push(key); return "offline-public"; } },
    fetch: async () => { throw new Error("offline"); },
  });
  it("API, POST ve farklı origin isteklerini service worker yakalamaz", () => {
    for (const request of [
      { method: "GET", url: "https://station.example/api/stationos/state", mode: "cors" },
      { method: "POST", url: "https://station.example/api/stationos/payment", mode: "cors" },
      { method: "GET", url: "https://external.example/icon.png", mode: "no-cors" },
    ]) {
      let intercepted = false;
      handlers.get("fetch")!({ request, respondWith: () => { intercepted = true; } });
      expect(intercepted).toBe(false);
    }
  });
  it("yalnız veri içermeyen offline bilgi ve ikonları cache'e koyar", async () => {
    let promise: Promise<unknown> | undefined;
    handlers.get("install")!({ waitUntil: (p: Promise<unknown>) => { promise = p; } });
    await promise;
    expect(cachedFiles).toEqual(["/offline.html", "/station-icon.svg", "/station-icon-192.png", "/station-icon-512.png"]);
    expect(cachedFiles).not.toContain("/");
  });
  it("çevrimdışı navigasyonda kayıtlı bir hesap yerine bilgi sayfası gösterir", async () => {
    let response: Promise<unknown> | undefined;
    handlers.get("fetch")!({ request: { method: "GET", url: "https://station.example/vardiyalar", mode: "navigate" }, respondWith: (p: Promise<unknown>) => { response = p; } });
    expect(await response).toBe("offline-public");
    expect(cacheReads).toContain("/offline.html");
  });
});

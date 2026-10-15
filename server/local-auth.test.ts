import { afterEach, describe, expect, it, vi } from "vitest";
import { hashPassword, verifyPassword } from "./local-auth";
import { getSessionCookieOptions } from "./_core/cookies";

afterEach(() => vi.unstubAllEnvs());
describe("Bağımsız kimlik doğrulama", () => {
  it("parolayı farklı salt ile hashler ve yanlış parolayı reddeder", async () => {
    const password = "only-for-unit-test-1234";
    const a = await hashPassword(password), b = await hashPassword(password);
    expect(a).not.toBe(b);
    expect(a).not.toContain(password);
    expect(await verifyPassword(password, a)).toBe(true);
    expect(await verifyPassword("wrong-password-1234", a)).toBe(false);
    expect(await verifyPassword(password, "scrypt:broken:value")).toBe(false);
  });
  it("yerel oturumlarda güvenli cookie varsayar; HTTP açıkça seçilir", () => {
    vi.stubEnv("AUTH_PROVIDER", "local");
    vi.stubEnv("COOKIE_SECURE", "true");
    expect(getSessionCookieOptions({} as never)).toMatchObject({ secure: true, sameSite: "lax", httpOnly: true });
    vi.stubEnv("COOKIE_SECURE", "false");
    expect(getSessionCookieOptions({} as never).secure).toBe(false);
  });
});

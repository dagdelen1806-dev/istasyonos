import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { openInvitation, sealInvitation } from "./invitation-response";

const context = {
  actorId: 7,
  requestId: "test-request",
  payloadHash: "test-hash",
};
const response = {
  ok: true as const,
  result: {
    code: "unit-test-invitation-secret",
    expiresAt: "2026-11-01T00:00:00.000Z",
    invitedEmail: "staff@example.test",
  },
};
beforeEach(() => {
  vi.stubEnv("INVITATION_RESPONSE_ACTIVE_KEY", "test1");
  vi.stubEnv(
    "INVITATION_RESPONSE_KEYS",
    JSON.stringify({ test1: Buffer.alloc(32, 1).toString("base64") })
  );
});
afterEach(() => vi.unstubAllEnvs());

describe("Davet yanıtının kalıcı gizliliği", () => {
  it("ham kodu veya yanıtı açık saklamaz ve aynı sonucu çözer", () => {
    const stored = sealInvitation(response, context);
    expect(stored).not.toContain(response.result.code);
    expect(stored).not.toContain(response.result.expiresAt);
    expect(openInvitation(stored, context)).toEqual(response);
    expect(sealInvitation(response, context)).not.toBe(stored);
  });
  it("hedef giriş e-postasını şifreli idempotency yanıtında korur", () => {
    const stored = sealInvitation(response, context);
    expect(stored).not.toContain(response.result.invitedEmail);
    expect(openInvitation(stored, context)).toEqual(response);
  });
  it.each(["actorId", "requestId", "payloadHash"] as const)(
    "%s bağlamı değiştiğinde reddeder",
    field => {
      const stored = sealInvitation(response, context);
      expect(() =>
        openInvitation(stored, {
          ...context,
          [field]: field === "actorId" ? 8 : "different",
        })
      ).toThrow();
    }
  );
  it("değiştirilmiş ciphertext ve etiketi reddeder", () => {
    for (const field of ["ciphertext", "tag", "nonce"]) {
      const stored = JSON.parse(sealInvitation(response, context));
      const data = Buffer.from(stored[field], "base64");
      data[0] ^= 1;
      stored[field] = data.toString("base64");
      expect(() => openInvitation(JSON.stringify(stored), context)).toThrow();
    }
  });
  it("anahtar eksikliğinde açık metne dönmez", () => {
    vi.stubEnv("INVITATION_RESPONSE_KEYS", "{}");
    expect(() => sealInvitation(response, context)).toThrow("anahtarı");
  });
  it("rotasyon sırasında eski anahtarla eski yanıtı okuyabilir", () => {
    const stored = sealInvitation(response, context);
    vi.stubEnv(
      "INVITATION_RESPONSE_KEYS",
      JSON.stringify({
        test1: Buffer.alloc(32, 1).toString("base64"),
        test2: Buffer.alloc(32, 2).toString("base64"),
      })
    );
    vi.stubEnv("INVITATION_RESPONSE_ACTIVE_KEY", "test2");
    expect(openInvitation(stored, context)).toEqual(response);
    expect(JSON.parse(sealInvitation(response, context)).keyId).toBe("test2");
  });
  it("eski açık yanıtı değiştirmeden okuyabilir; bozuk yanıtı reddeder", () => {
    expect(openInvitation(JSON.stringify(response), context)).toEqual(response);
    expect(() => openInvitation('{"ok":true,"result":{}}', context)).toThrow();
    expect(() => openInvitation("broken", context)).toThrow();
  });
});

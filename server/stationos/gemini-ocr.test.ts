import { afterEach, describe, expect, it, vi } from "vitest";
import { extractGeminiDocument, geminiOcrModel } from "./gemini-ocr";
import { validateDocumentFields } from "./tanker-document";
import { tankerCompleteness } from "../../shared/tanker-document";
afterEach(() => vi.unstubAllEnvs());
const image = { mime: "image/png", bytes: Buffer.from("DEMO") };
const reply = (raw: unknown, finishReason = "STOP") =>
  new Response(
    JSON.stringify({
      candidates: [
        { finishReason, content: { parts: [{ text: JSON.stringify(raw) }] } },
      ],
    })
  );
describe("server Gemini OCR", () => {
  it("keeps the key only in a fixed-origin header and supports Turkish image JSON", async () => {
    vi.stubEnv("GEMINI_API_KEY", "DEMO-PRIVATE-KEY");
    vi.stubEnv("GEMINI_OCR_MODEL", "");
    const fetcher = vi.fn().mockResolvedValue(reply({ fields: [] }));
    await extractGeminiDocument([image], "INVOICE", fetcher);
    const [url, options] = fetcher.mock.calls[0];
    expect(url).toBe(
      "https://generativelanguage.googleapis.com/v1beta/models/" +
        geminiOcrModel() +
        ":generateContent"
    );
    expect(url).not.toContain("PRIVATE");
    expect(options.headers["x-goog-api-key"]).toBe("DEMO-PRIVATE-KEY");
    expect(options.body).not.toContain("PRIVATE");
    const body = JSON.parse(options.body);
    expect(body.contents[0].parts[0].text).toContain("Türkçe INVOICE");
    expect(body.generationConfig.responseMimeType).toBe("application/json");
    expect(body.contents[0].parts[1].inlineData.mimeType).toBe("image/png");
  });
  it("uses the POS_SLIP prompt while forbidding full PAN and CVV output", async () => {
    vi.stubEnv("GEMINI_API_KEY", "DEMO-PRIVATE-KEY");
    const fetcher = vi.fn().mockResolvedValue(reply({ fields: [] }));
    await extractGeminiDocument([image], "POS_SLIP", fetcher);
    const prompt = JSON.parse(fetcher.mock.calls[0][1].body).contents[0].parts[0].text;
    expect(prompt).toContain("POS_SLIP");
    expect(prompt).toContain("CVV/CVC");
    expect(prompt).toContain("banka teyidi değildir");
  });
  it("does not echo provider response secrets on quota failure", async () => {
    vi.stubEnv("GEMINI_API_KEY", "DEMO-PRIVATE-KEY");
    await expect(
      extractGeminiDocument(
        [image],
        "TANK",
        vi
          .fn()
          .mockResolvedValue(new Response("DEMO-PRIVATE-KEY", { status: 429 }))
      )
    ).rejects.toMatchObject({
      code: "GEMINI_ACCESS_ERROR",
      message: expect.not.stringContaining("DEMO-PRIVATE-KEY"),
    });
  });
  it("sanitizes network errors", async () => {
    vi.stubEnv("GEMINI_API_KEY", "DEMO-PRIVATE-KEY");
    await expect(
      extractGeminiDocument(
        [image],
        "TANK",
        vi.fn().mockRejectedValue(Error("DEMO-PRIVATE-KEY"))
      )
    ).rejects.toMatchObject({
      code: "GEMINI_NETWORK_ERROR",
      message: expect.not.stringContaining("PRIVATE"),
    });
  });
  it("refuses missing keys without a network call", async () => {
    vi.stubEnv("GEMINI_API_KEY", "");
    const fetcher = vi.fn();
    await expect(
      extractGeminiDocument([image], "TANKER", fetcher)
    ).rejects.toMatchObject({ code: "GEMINI_KEY_MISSING" });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("rejects incomplete and invalid JSON", async () => {
    vi.stubEnv("GEMINI_API_KEY", "DEMO");
    await expect(
      extractGeminiDocument(
        [image],
        "TANKER",
        vi.fn().mockResolvedValue(reply({}, "MAX_TOKENS"))
      )
    ).rejects.toMatchObject({ code: "GEMINI_INCOMPLETE" });
    await expect(
      extractGeminiDocument(
        [image],
        "TANKER",
        vi
          .fn()
          .mockResolvedValue(
            new Response(
              JSON.stringify({
                candidates: [
                  {
                    finishReason: "STOP",
                    content: { parts: [{ text: "bad" }] },
                  },
                ],
              })
            )
          )
      )
    ).rejects.toMatchObject({ code: "GEMINI_INVALID_OUTPUT" });
  });
  it("rejects URL injection in the model", async () => {
    vi.stubEnv("GEMINI_API_KEY", "DEMO");
    vi.stubEnv("GEMINI_OCR_MODEL", "https://example.invalid/key");
    const fetcher = vi.fn();
    await expect(
      extractGeminiDocument([image], "TANKER", fetcher)
    ).rejects.toMatchObject({ code: "GEMINI_MODEL_INVALID" });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("does not treat zero LPG capacity as real capacity", () => {
    const result = validateDocumentFields({
      kind: "TANK",
      fields: [{ label: "LPG kapasite", value: "0,000", unit: "L" }],
    });
    expect(result.fields[0].value).toBeNull();
  });
  it("requires completion of generic document fields", () => {
    const values = {
      documentNo: "DEMO2026000000001",
      issuer: "DEMO",
      documentDate: "2026-11-07",
      supplierId: null,
      lines: [],
      pages: [{ pageId: "DEMO", number: 1, total: 1 }],
      documentFields: validateDocumentFields({
        kind: "INVOICE",
        fields: [{ label: "Genel toplam", value: null, unit: "TL" }],
      }),
    };
    expect(tankerCompleteness(values)).not.toHaveLength(0);
    values.documentFields.fields[0].value = "100,00";
    expect(tankerCompleteness(values)).toHaveLength(0);
  });
});

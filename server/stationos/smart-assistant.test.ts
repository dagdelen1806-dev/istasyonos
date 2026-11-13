import { afterEach, describe, expect, it, vi } from "vitest";
import {
  assistantStationScope,
  rankAssistantFindings,
} from "./smart-assistant";
import {
  assistantModelPacket,
  explainSmartAssistant,
} from "./assistant-gemini";
import type {
  SmartAssistantReport,
  AssistantFinding,
} from "../../shared/smart-assistant";
const finding: AssistantFinding = {
  code: "PENDING_ACCOUNT",
  severity: "MEDIUM",
  title: "Bekleyen hesap",
  period: "CURRENT",
  formula: "SUBMITTED/IN_REVIEW sayısı",
  recommendation: "İki bağımsız onayı tamamlayın.",
  count: 1,
  metrics: { sourceMinor: 1500 },
  sources: [
    {
      type: "ACCOUNT",
      id: "private-record-id",
      stationId: "private-station-id",
      values: { sourceMinor: 1500 },
    },
  ],
};
const report = {
  generatedAt: "2026-11-07T00:00:00Z",
  scope: { companyId: "private-company", stationIds: ["private-station-id"] },
  findings: [finding],
  geminiAvailable: true,
} as SmartAssistantReport;
afterEach(() => vi.unstubAllEnvs());
describe("smart assistant authorized deterministic scope", () => {
  const stations = [
    { id: "a", company_id: "one" },
    { id: "b", company_id: "two" },
  ];
  it("intersects authorized company and station", () => {
    expect(assistantStationScope(stations, null, "one")).toEqual(["a"]);
    expect(assistantStationScope(stations, "b", null)).toEqual(["b"]);
  });
  it.each([
    ["foreign", null],
    [null, "foreign"],
    ["a", "two"],
  ])("rejects out-of-scope selection %s/%s", (s, c) =>
    expect(() => assistantStationScope(stations, s, c)).toThrow()
  );
  it("rejects empty authorization", () =>
    expect(() => assistantStationScope([], null, null)).toThrow());
  it("ranks deterministically without model input", () =>
    expect(
      rankAssistantFindings([
        { ...finding, code: "Z", severity: "INFO" },
        { ...finding, code: "A", severity: "HIGH" },
        finding,
      ]).map(f => f.code)
    ).toEqual(["A", "PENDING_ACCOUNT", "Z"]));
});
describe("Gemini read-only narrative boundary", () => {
  it("excludes record IDs, scope and dates from the transmitted packet", () => {
    expect(JSON.stringify(assistantModelPacket(report))).not.toMatch(
      /private|2026|sources|stationIds/
    );
    expect(assistantModelPacket(report)[0].metrics.sourceMinor).toBe(1500);
  });
  it("continues locally without a key, making no provider request", async () => {
    vi.stubEnv("GEMINI_API_KEY", "");
    const fetcher = vi.fn();
    expect((await explainSmartAssistant(report, fetcher)).mode).toBe("LOCAL");
    expect(fetcher).not.toHaveBeenCalled();
  });
  it.each([429, 500])(
    "keeps local findings on provider status %i",
    async status => {
      vi.stubEnv("GEMINI_API_KEY", "test-key");
      const result = await explainSmartAssistant(
        report,
        vi
          .fn()
          .mockResolvedValue(
            new Response("sensitive-provider-message", { status })
          )
      );
      expect(result.mode).toBe("LOCAL");
      expect(JSON.stringify(result)).not.toContain(
        "sensitive-provider-message"
      );
    }
  );
  it("handles network failure without exposing errors", async () => {
    vi.stubEnv("GEMINI_API_KEY", "test-key");
    const result = await explainSmartAssistant(
      report,
      vi.fn().mockRejectedValue(Error("test-key"))
    );
    expect(result.mode).toBe("LOCAL");
    expect(JSON.stringify(result)).not.toContain("test-key");
  });
  it("allows explanations only, has no tools, never transmits source records", async () => {
    vi.stubEnv("GEMINI_API_KEY", "test-key");
    vi.stubEnv("GEMINI_ASSISTANT_MODEL", "gemini-3.8-flash");
    const fetcher = vi
      .fn()
      .mockResolvedValue(
        new Response(
          JSON.stringify({
            candidates: [
              {
                content: {
                  parts: [
                    {
                      text: JSON.stringify({
                        suggestions: [
                          {
                            code: finding.code,
                            explanation: "Onay bekleniyor.",
                            recommendation: "Bağımsız inceleyin.",
                          },
                        ],
                      }),
                    },
                  ],
                },
              },
            ],
          })
        )
      );
    expect((await explainSmartAssistant(report, fetcher)).mode).toBe("GEMINI");
    const [url, options] = fetcher.mock.calls[0];
    expect(url).not.toContain("test-key");
    expect(url).toMatch(/^https:\/\/generativelanguage.googleapis.com/);
    const body = JSON.parse(options.body);
    expect(body.tools).toBeUndefined();
    expect(options.body).not.toContain("private");
    expect(report.findings[0]).toEqual(finding);
  });
  it("rejects invented finding codes and uses local recommendations", async () => {
    vi.stubEnv("GEMINI_API_KEY", "test-key");
    const fetcher = vi
      .fn()
      .mockResolvedValue(
        new Response(
          JSON.stringify({
            candidates: [
              {
                content: {
                  parts: [
                    {
                      text: '{"suggestions":[{"code":"INVENTED","explanation":"x","recommendation":"x"}]}',
                    },
                  ],
                },
              },
            ],
          })
        )
      );
    expect((await explainSmartAssistant(report, fetcher)).mode).toBe("LOCAL");
  });
});

import type {
  AssistantExplanation,
  SmartAssistantReport,
} from "../../shared/smart-assistant";
import { geminiOcrAvailable, geminiOcrModel } from "./gemini-ocr";

// Strict allowlist: neither source IDs, company/customer names nor user text
// leave the server. The provider has no tools and cannot execute SQL or writes.
export function assistantModelPacket(report: SmartAssistantReport) {
  return report.findings.map(f => ({
    code: f.code,
    severity: f.severity,
    period: f.period,
    count: f.count,
    metrics: f.metrics,
    formula: f.formula,
  }));
}
export function localAssistantExplanation(
  report: SmartAssistantReport,
  message = "Yerel hesaplanan rapor çalışıyor. Gemini bağlantısı yapılandırılmadı."
): AssistantExplanation {
  return {
    mode: "LOCAL",
    message,
    suggestions: report.findings.map(f => ({
      code: f.code,
      explanation: f.formula,
      recommendation: f.recommendation,
    })),
  };
}
export async function explainSmartAssistant(
  report: SmartAssistantReport,
  fetcher: typeof fetch = fetch
): Promise<AssistantExplanation> {
  if (!geminiOcrAvailable() || !report.findings.length)
    return localAssistantExplanation(report);
  const model =
    process.env.GEMINI_ASSISTANT_MODEL?.trim() || "gemini-3.5-flash-lite";
  if (!/^gemini-[a-z0-9.-]{1,70}-flash[a-z0-9.-]*$/.test(model))
    return localAssistantExplanation(
      report,
      "Gemini model ayarı geçersiz; yerel rapor korundu."
    );
  try {
    const response = await fetcher(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
      {
        method: "POST",
        redirect: "error",
        signal: AbortSignal.timeout(20000),
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": process.env.GEMINI_API_KEY!.trim(),
        },
        body: JSON.stringify({
          systemInstruction: {
            parts: [
              {
                text: "Türkçe işletme asistanısın. Yalnız verilen deterministik bulguları açıkla, birer kısa öneri yaz. Hesaplama, yeni sayısal iddia, risk sırası değişikliği veya işlem talimatı üretme. CURRENT güncel, PERIOD dönemdir. Banka/POS beyanı gerçekleşmiş banka hareketi değildir. Taslaklar satış değildir. Muhasebe kaydı kesinleştiremezsin. Her kodu bir kez kullan.",
              },
            ],
          },
          contents: [
            {
              role: "user",
              parts: [{ text: JSON.stringify(assistantModelPacket(report)) }],
            },
          ],
          generationConfig: {
            temperature: 0,
            responseMimeType: "application/json",
            maxOutputTokens: 3000,
            responseJsonSchema: {
              type: "object",
              additionalProperties: false,
              required: ["suggestions"],
              properties: {
                suggestions: {
                  type: "array",
                  maxItems: report.findings.length,
                  items: {
                    type: "object",
                    additionalProperties: false,
                    required: ["code", "explanation", "recommendation"],
                    properties: {
                      code: {
                        type: "string",
                        enum: report.findings.map(f => f.code),
                      },
                      explanation: { type: "string" },
                      recommendation: { type: "string" },
                    },
                  },
                },
              },
            },
          },
        }),
      }
    );
    if (!response.ok) throw Error("PROVIDER_UNAVAILABLE");
    const raw = await response.text();
    if (raw.length > 64000) throw Error("RESPONSE_LIMIT");
    const envelope = JSON.parse(raw);
    const text = envelope.candidates?.[0]?.content?.parts
      ?.map((p: { text?: string }) => p.text ?? "")
      .join("");
    const result = JSON.parse(text ?? "");
    if (
      !Array.isArray(result.suggestions) ||
      result.suggestions.length !== report.findings.length
    )
      throw Error("INVALID_OUTPUT");
    const codes = new Set<string>();
    for (const s of result.suggestions) {
      if (
        !report.findings.some(f => f.code === s.code) ||
        codes.has(s.code) ||
        typeof s.explanation !== "string" ||
        typeof s.recommendation !== "string" ||
        !s.explanation.trim() ||
        !s.recommendation.trim() ||
        s.explanation.length > 1500 ||
        s.recommendation.length > 1500
      )
        throw Error("INVALID_OUTPUT");
      codes.add(s.code);
    }
    return {
      mode: "GEMINI",
      message:
        "Gemini açıklaması öneridir. Hesaplama, kaynaklar ve risk sırası yerel rapora aittir.",
      suggestions: report.findings.map(f => {
        const s = result.suggestions.find(
          (x: { code: string }) => x.code === f.code
        );
        return {
          code: f.code,
          explanation: s.explanation,
          recommendation: s.recommendation,
        };
      }),
    };
  } catch {
    // Never forward provider bodies, key-bearing errors or prompts to logs/client.
    return localAssistantExplanation(
      report,
      "Gemini yanıt veremedi veya yanıt doğrulanamadı; yerel rapor ve öneriler korundu."
    );
  }
}

const calls = new Map<number, { at: number; busy: boolean }>();
export async function limitedAssistantExplanation(
  actorId: number,
  report: SmartAssistantReport
) {
  if (!geminiOcrAvailable()) return localAssistantExplanation(report);
  const now = Date.now(),
    previous = calls.get(actorId);
  if (previous && (previous.busy || now - previous.at < 60000))
    return localAssistantExplanation(
      report,
      "Gemini istek sınırı: bir dakika sonra deneyin. Yerel rapor hazır."
    );
  for (const [id, item] of calls)
    if (!item.busy && now - item.at > 60000) calls.delete(id);
  calls.set(actorId, { at: now, busy: true });
  try {
    return await explainSmartAssistant(report);
  } finally {
    calls.set(actorId, { at: now, busy: false });
  }
}

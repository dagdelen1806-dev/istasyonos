import { newRequestId } from "@/lib/id";
import { useRef, useState } from "react";
import { ArrowUpRight, Sparkles, ShieldCheck, RefreshCw } from "lucide-react";
import type { AppState } from "@shared/station";
import { ApiError, mutate } from "@/lib/station-api";
import { Empty, Panel } from "./Common";

type Reply = {
  text: string;
  generatedAt: string;
  role: string;
  sources: string[];
  privacy: string;
};
export default function AssistantPanel({ state }: { state: AppState }) {
  const [question, setQuestion] = useState("");
  const [reply, setReply] = useState<Reply | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const pending = useRef<{
    id: string;
    question: string;
    stationId?: string;
  } | null>(null);
  const [uncertain, setUncertain] = useState(false);
  const examples =
    state.member?.role === "PURCHASER"
      ? [
          "Haftalık sipariş listesinde hangi riskler var?",
          "Cari limit nedeniyle hangi siparişler bekliyor?",
          "Stok tükenmesini nasıl önleyebilirim?",
        ]
      : [
          "Vardiya onay kuyruğunda nelere dikkat etmeliyim?",
          "Açık alacaklarımızın durumunu özetle.",
          "Ödeme ve nakit risklerini açıkla.",
        ];
  async function ask(retry = false) {
    if (busy) return;
    const job = retry
      ? pending.current
      : {
          id: newRequestId(),
          question: question.trim(),
          stationId:
            state.member?.stationIds.length === 1
              ? state.member.stationIds[0]
              : undefined,
        };
    if (!job?.question) return;
    pending.current = job;
    setBusy(true);
    setError("");
    try {
      const response = await mutate(
        "/assistant",
        { question: job.question, stationId: job.stationId },
        job.id,
        state.csrfToken
      );
      setReply(response.result);
      pending.current = null;
      setUncertain(false);
    } catch (e) {
      const isUncertain =
        e instanceof ApiError &&
        ["NETWORK_UNCERTAIN", "RESPONSE_UNCERTAIN", "AI_PROCESSING"].includes(
          e.code
        );
      setUncertain(isUncertain);
      if (!isUncertain) pending.current = null;
      setError(e instanceof Error ? e.message : "Asistan yanıtı alınamadı.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="module-stack">
      <div className="notice">
        <ShieldCheck size={18} />
        <span>
          <strong>Yetkiniz kadar veri, yalnız salt okunur açıklama.</strong>{" "}
          Asistan ödeme, sipariş veya mali onay gerçekleştiremez.{" "}
          {window.__MANUS_CONFIG__?.authProvider === "manus"
            ? "Dış modele yalnız anonim sayısal özet gönderilir."
            : "Yerel kural tabanlı özet kullanılır; haricî AI servisine veri gönderilmez."}
        </span>
      </div>
      <Panel
        title="Operasyon asistanı"
        subtitle="Rolünüze göre vardiya, stok, sipariş ve cari risklerini konuşun."
        action={<Sparkles size={18} />}
      >
        <form
          className="form-grid"
          onSubmit={e => {
            e.preventDefault();
            void ask();
          }}
        >
          <label className="field full">
            <span>Sorunuz</span>
            <textarea
              required
              maxLength={1500}
              rows={4}
              value={question}
              disabled={busy || uncertain}
              onChange={e => setQuestion(e.target.value)}
              placeholder="Örn. Toptancı cari limitine göre sipariş risklerimizi özetle."
            />
          </label>
          <div className="field full">
            <div className="table-actions">
              {examples.map(text => (
                <button
                  className="button ghost"
                  type="button"
                  disabled={busy || uncertain}
                  key={text}
                  onClick={() => setQuestion(text)}
                >
                  {text}
                </button>
              ))}
            </div>
          </div>
          <div className="form-actions">
            <small>
              Dakikada en fazla üç istek. Yanıtlar mevcut kayıt kapsamına
              dayanır; günlük ciro veya gerçek banka bakiyesi diye yorumlanmaz.
            </small>
            {uncertain ? (
              <button
                className="button"
                type="button"
                disabled={busy}
                onClick={() => void ask(true)}
              >
                <RefreshCw size={16} />
                Aynı isteği kontrol et
              </button>
            ) : (
              <button
                className="button primary"
                disabled={busy || !question.trim()}
                type="submit"
              >
                {busy ? "Veriler inceleniyor…" : "Asistana sor"}
                <ArrowUpRight size={16} />
              </button>
            )}
          </div>
        </form>
        {error && (
          <div className="notice warning" role="alert">
            {error}
          </div>
        )}
      </Panel>
      <Panel
        title="Yanıt ve veri kapsamı"
        subtitle={
          reply
            ? `Oluşturulma: ${new Date(reply.generatedAt).toLocaleString("tr-TR")}`
            : "Yanıt yalnız yetkili kayıtlardan hazırlanır."
        }
      >
        {reply ? (
          <div className="assistant-response">
            <div style={{ whiteSpace: "pre-wrap" }}>{reply.text}</div>
            <div className="inline-note">
              <b>Veri kaynakları:</b> {reply.sources.join(" · ")}
              <br />
              {reply.privacy}
              <br />
              Bu açıklama hesap, banka doğrulaması veya kesin sipariş talimatı
              değildir.
            </div>
          </div>
        ) : (
          <Empty
            title="İlk sorunuzu sorun"
            text="Gerçek bakiyeler yoksa asistan eksik veriyi belirtir; bilinmeyen tutarı sıfır kabul etmez."
          />
        )}
      </Panel>
    </div>
  );
}

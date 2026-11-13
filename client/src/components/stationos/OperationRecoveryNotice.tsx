import type { RecoveryView } from "@/lib/operation-recovery";
import { Notice } from "./Common";

export function OperationRecoveryNotice({
  view,
  error,
  onCheck,
  onAcknowledge,
}: {
  view: RecoveryView | null;
  error: string;
  onCheck: () => void;
  onAcknowledge: () => void;
}) {
  if (error)
    return (
      <Notice warning>
        {error}{" "}
        <button className="btn" onClick={onCheck}>
          Yeniden kontrol et
        </button>
      </Notice>
    );
  if (!view) return null;
  const terminal = ["COMPLETED", "FAILED"].includes(view.status.state);
  const receipt = view.status.response?.result;
  return (
    <Notice warning={!terminal}>
      <p>{view.status.message}</p>
      <small>İşlem kimliği: {view.record.requestId}</small>
      {typeof receipt?.id === "string" && <p>Kayıt kimliği: {receipt.id}</p>}
      {typeof receipt?.code === "string" && (
        <p>
          Davet kodu: <code>{receipt.code}</code>
        </p>
      )}
      <div className="row-actions">
        <button className="btn" onClick={onCheck}>
          İşlem durumunu kontrol et
        </button>
        {terminal && (
          <button className="btn" onClick={onAcknowledge}>
            Sonucu gördüm
          </button>
        )}
      </div>
    </Notice>
  );
}

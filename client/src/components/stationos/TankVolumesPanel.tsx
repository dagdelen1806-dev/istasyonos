import { useState, type FormEvent } from "react";
import type { AppState } from "@shared/station";
import type { TankCard } from "@shared/tank";
import type { TankVolumesReport } from "@shared/tank-volumes";
import { litres, parseLitres } from "@shared/fuel";
import { Panel, Field, Notice } from "./Common";

export function TankVolumesPanel({
  tank,
  report,
  state,
  stationId,
  disabled,
  onAction,
  refresh,
}: {
  tank: TankCard;
  report: TankVolumesReport;
  state: AppState;
  stationId: string;
  disabled: boolean;
  onAction: (path: string, body: Record<string, unknown>) => Promise<boolean>;
  refresh: () => void;
}) {
  const [error, setError] = useState("");
  const current = report.states.find(r => r.tankId === tank.tankId);
  const history = report.resets.filter(r => r.tankId === tank.tankId);
  const reviewer = ["OWNER", "ACCOUNTANT"].includes(state.member?.role ?? "");
  const display = (n: number | null | undefined) =>
    n == null ? "Bilinmiyor" : litres(n) + " L";
  async function submit(
    e: FormEvent<HTMLFormElement>,
    action: string,
    extra: Record<string, unknown> = {}
  ) {
    e.preventDefault();
    setError("");
    const f = Object.fromEntries(new FormData(e.currentTarget)) as Record<
      string,
      string
    >;
    try {
      const body: Record<string, unknown> = {
        stationId,
        tankId: tank.tankId,
        expectedRevision: tank.revision,
        note: f.note,
        evidence: f.evidence,
        ...extra,
      };
      if (action === "dual-measure")
        Object.assign(body, {
          productMl: parseLitres(f.product),
          netMl: parseLitres(f.net),
          expectedReadingId: current?.readingId ?? null,
        });
      if (action === "variance-request") body.readingId = current?.readingId;
      if (action === "variance-review") body.decision = f.decision;
      if (await onAction("/tank/" + action, body)) refresh();
    } catch (e) {
      setError((e as Error).message);
    }
  }
  const proof = (
    <>
      <Field label="Açıklama">
        <input name="note" required maxLength={1000} />
      </Field>
      <Field label="Kanıt / belge referansı">
        <input name="evidence" required maxLength={500} />
      </Field>
    </>
  );
  return (
    <Panel
      title={tank.number + " · Ürün / net hacim ve dönem mutabakatı"}
      subtitle="Ham ürün−net farkı korunur. Dönem kapatma yalnız karşılaştırma referansını yeniler; stok düzeltmez."
    >
      <div className="business-form">
        {error && <Notice warning>{error}</Notice>}
        <p>
          Ürün: {display(current?.productMl)} · Net: {display(current?.netMl)} ·
          Ham fark: {display(current?.spreadMl)}
        </p>
        <p>
          Onaylı referans: {display(current?.baselineSpreadMl)} · Dönem farkı:{" "}
          {display(current?.periodDifferenceMl)}
        </p>
        {current?.readingId && !current.fresh && (
          <Notice warning>
            Stok değişti. Dönem kapatmadan önce yeni ürün/net ölçümü girin.
          </Notice>
        )}
        <form
          className="form-grid two"
          onSubmit={e => submit(e, "dual-measure")}
        >
          <Field label="Ürün hacmi (L)">
            <input name="product" inputMode="decimal" required />
          </Field>
          <Field label="Net hacim (L)">
            <input name="net" inputMode="decimal" required />
          </Field>
          {proof}
          <button className="btn primary" disabled={disabled}>
            İki hacmi kaydet
          </button>
        </form>
        <form
          className="form-grid two"
          onSubmit={e => submit(e, "variance-request")}
        >
          {proof}
          <button
            className="btn"
            disabled={
              disabled ||
              !current?.fresh ||
              history.some(r => r.readingId === current?.readingId)
            }
          >
            Dönem farkını kapatma talebi
          </button>
        </form>
        {history
          .filter(r => r.status === "PENDING")
          .map(r => (
            <div key={r.id}>
              <p>
                Bekleyen talep · Kapatılacak dönem farkı:{" "}
                {display(r.closedDifferenceMl)} · Yeni referans:{" "}
                {display(r.baselineSpreadMl)}
              </p>
              {reviewer && r.createdBy !== state.user.id && (
                <form
                  className="form-grid two"
                  onSubmit={e =>
                    submit(e, "variance-review", { varianceResetId: r.id })
                  }
                >
                  <Field label="Bağımsız karar">
                    <select name="decision">
                      <option value="APPROVE">Onayla</option>
                      <option value="REJECT">Reddet</option>
                    </select>
                  </Field>
                  {proof}
                  <button className="btn" disabled={disabled}>
                    Bağımsız kararı kaydet
                  </button>
                </form>
              )}
            </div>
          ))}
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Kayıt zamanı</th>
                <th>Ürün (L)</th>
                <th>Net (L)</th>
                <th>Ham fark (L)</th>
                <th>Kanıt</th>
              </tr>
            </thead>
            <tbody>
              {report.readings
                .filter(r => r.tankId === tank.tankId)
                .map(r => (
                  <tr key={r.id}>
                    <td>{new Date(r.createdAt).toLocaleString("tr-TR")}</td>
                    <td>{litres(r.productMl)}</td>
                    <td>{litres(r.netMl)}</td>
                    <td>{litres(r.spreadMl)}</td>
                    <td>{r.evidence}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Dönem talebi</th>
                <th>Kapanan fark</th>
                <th>Yeni referans</th>
                <th>Durum</th>
                <th>Kanıt</th>
              </tr>
            </thead>
            <tbody>
              {history.map(r => (
                <tr key={r.id}>
                  <td>{new Date(r.createdAt).toLocaleString("tr-TR")}</td>
                  <td>{display(r.closedDifferenceMl)}</td>
                  <td>{display(r.baselineSpreadMl)}</td>
                  <td>{r.status}</td>
                  <td>{r.evidence}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </Panel>
  );
}

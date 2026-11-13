import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent,
} from "react";
import type { AppState } from "@shared/station";
import type { PosSlipValues } from "@shared/pos-slip";
import { money, parseMoney } from "@shared/station";
import { Panel, Field, Notice } from "./Common";

type Draft = {
  id: string;
  accountId: string;
  staffUserId: number;
  staffName?: string;
  sourceHash: string;
  mimeType: string;
  provider: string;
  status: string;
  revision: number;
  values: PosSlipValues | null;
  ocr: {
    source?: Record<string, string | null>;
    warnings?: string[];
    reviewRequired?: boolean;
  } | null;
};
type Rect = { x: number; y: number; w: number; h: number };
const initialValues: PosSlipValues = {
  transactionAt: null,
  amountMinor: null,
  bank: null,
  terminal: null,
  reference: null,
  transactionType: null,
  settlementKind: null,
  maskedCard: null,
};
const imageData = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(Error("Fotoğraf okunamadı."));
    reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
    reader.readAsDataURL(blob);
  });

export function PosSlipPanel({
  state,
  stationId,
  busy,
  onAction,
  onQueueSlip,
  syncVersion = 0,
}: {
  state: AppState;
  stationId: string;
  busy: boolean;
  onAction: (
    path: string,
    payload: Record<string, unknown>
  ) => Promise<boolean>;
  onQueueSlip?: (
    payload: Record<string, unknown>,
    fingerprint: string
  ) => Promise<boolean>;
  syncVersion?: number;
}) {
  const staff = state.member?.role === "FUEL_STAFF";
  const reviewer = ["OWNER", "MANAGER", "ACCOUNTANT"].includes(
    state.member?.role ?? ""
  );
  const featureAvailable = state.posSlipAvailable === true;
  const station = stationId || state.stations[0]?.id || "";
  const account = useMemo(
    () =>
      state.accounts.find(
        a =>
          a.stationId === station &&
          a.userId === state.user.id &&
          a.businessUnit === "FUEL" &&
          a.status === "OPEN"
      ),
    [state.accounts, state.user.id, station]
  );
  const [drafts, setDrafts] = useState<Draft[]>([]),
    [selectedId, setSelectedId] = useState(""),
    [values, setValues] = useState<PosSlipValues>(initialValues),
    [provider, setProvider] = useState("LOCAL"),
    [externalConfirmed, setExternalConfirmed] = useState(false),
    [sensitiveChecked, setSensitiveChecked] = useState(false),
    [brightness, setBrightness] = useState(1.15),
    [contrast, setContrast] = useState(1.35),
    [rotation, setRotation] = useState(0),
    [preprocess, setPreprocess] = useState("BALANCED"),
    [imageUrl, setImageUrl] = useState(""),
    [error, setError] = useState(""),
    [working, setWorking] = useState(false),
    [amountOverride, setAmountOverride] = useState(false),
    [masks, setMasks] = useState<Rect[]>([]),
    [drag, setDrag] = useState<Rect | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null),
    sourceRef = useRef<HTMLImageElement | null>(null),
    selected = drafts.find(d => d.id === selectedId) ?? drafts[0];

  const reload = useCallback(async () => {
    if (!featureAvailable) {
      setDrafts([]);
      setSelectedId("");
      setError("");
      return;
    }
    if (!station || (!reviewer && !staff) || !navigator.onLine) return;
    try {
      const response = await fetch(
        `/api/stationos/pos-slip-drafts?${new URLSearchParams({ stationId: station, ...(staff && account ? { accountId: account.id } : {}) })}`,
        { credentials: "include", cache: "no-store" }
      );
      const data = await response.json();
      if (!response.ok)
        throw Error(data.error?.message ?? "Slip taslakları alınamadı.");
      setDrafts(data.drafts ?? []);
      setSelectedId(current =>
        (data.drafts ?? []).some((d: Draft) => d.id === current)
          ? current
          : (data.drafts?.[0]?.id ?? "")
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Slip taslakları alınamadı.");
    }
  }, [
    station,
    stationId,
    account?.id,
    reviewer,
    staff,
    syncVersion,
    featureAvailable,
  ]);
  useEffect(() => {
    void reload();
  }, [reload]);
  useEffect(() => {
    const d = drafts.find(x => x.id === selectedId) ?? drafts[0];
    setValues(d?.values ?? initialValues);
    setAmountOverride(false);
    if (d?.id && station)
      setImageUrl(
        `/api/stationos/pos-slip-draft/image?${new URLSearchParams({ stationId: station, draftId: d.id })}`
      );
    else setImageUrl("");
  }, [drafts, selectedId, station, stationId]);

  const drawCanvas = useCallback(() => {
    const canvas = canvasRef.current,
      image = sourceRef.current;
    if (!canvas || !image) return;
    const context = canvas.getContext("2d");
    if (!context) return;
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = "#fff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.save();
    context.translate(canvas.width / 2, canvas.height / 2);
    context.rotate((rotation * Math.PI) / 180);
    context.filter = `brightness(${brightness}) contrast(${contrast})${preprocess === "GRAY" || preprocess === "SHADOW" ? " grayscale(1)" : ""}`;
    context.drawImage(
      image,
      -canvas.width / 2,
      -canvas.height / 2,
      canvas.width,
      canvas.height
    );
    context.restore();
    context.filter = "none";
    if (preprocess === "SHADOW") {
      const frame = context.getImageData(0, 0, canvas.width, canvas.height),
        { data, width, height } = frame;
      const stride = width + 1,
        integral = new Uint32Array(stride * (height + 1)),
        radius = Math.max(12, Math.round(Math.min(width, height) * 0.018));
      for (let y = 0; y < height; y++) {
        let row = 0;
        for (let x = 0; x < width; x++) {
          const i = (y * width + x) * 4,
            lum = Math.round(
              data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114
            );
          data[i] = data[i + 1] = data[i + 2] = lum;
          row += lum;
          integral[(y + 1) * stride + x + 1] =
            integral[y * stride + x + 1] + row;
        }
      }
      for (let y = 0; y < height; y++)
        for (let x = 0; x < width; x++) {
          const x0 = Math.max(0, x - radius),
            x1 = Math.min(width, x + radius + 1),
            y0 = Math.max(0, y - radius),
            y1 = Math.min(height, y + radius + 1);
          const area = (x1 - x0) * (y1 - y0),
            sum =
              integral[y1 * stride + x1] -
              integral[y0 * stride + x1] -
              integral[y1 * stride + x0] +
              integral[y0 * stride + x0];
          const i = (y * width + x) * 4,
            local = sum / area,
            pixel = data[i] < local - 24 ? 0 : 255;
          data[i] = data[i + 1] = data[i + 2] = pixel;
        }
      context.putImageData(frame, 0, 0);
    }
    for (const rect of [...masks, ...(drag ? [drag] : [])]) {
      context.fillStyle = "#000";
      context.fillRect(rect.x, rect.y, rect.w, rect.h);
    }
  }, [brightness, contrast, rotation, preprocess, masks, drag, imageUrl]);
  useEffect(() => drawCanvas(), [drawCanvas]);

  function loadPhoto(file?: File) {
    if (!file) return;
    setError("");
    if (
      file.size > 5 * 1024 * 1024 ||
      !["image/jpeg", "image/png"].includes(file.type)
    ) {
      setError("Yalnız 5 MB sınırında JPEG/PNG fotoğraf kullanın.");
      return;
    }
    const url = URL.createObjectURL(file),
      img = new Image();
    img.onload = () => {
      const scale = Math.min(1, 2000 / Math.max(img.width, img.height));
      const canvas = canvasRef.current;
      if (canvas) {
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
      }
      sourceRef.current = img;
      setMasks([]);
      setDrag(null);
      setSensitiveChecked(false);
      setImageUrl(url);
      drawCanvas();
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      setError("Fotoğraf çözümlenemedi.");
    };
    img.src = url;
  }
  function point(e: PointerEvent<HTMLCanvasElement>) {
    const canvas = e.currentTarget,
      bounds = canvas.getBoundingClientRect();
    return {
      x: Math.max(
        0,
        Math.min(
          canvas.width,
          ((e.clientX - bounds.left) * canvas.width) / bounds.width
        )
      ),
      y: Math.max(
        0,
        Math.min(
          canvas.height,
          ((e.clientY - bounds.top) * canvas.height) / bounds.height
        )
      ),
    };
  }
  async function submitPhoto() {
    const canvas = canvasRef.current;
    if (!account || !canvas || !sourceRef.current) {
      setError("Önce kendi açık vardiya hesabınızı seçin ve fotoğraf ekleyin.");
      return;
    }
    if (!sensitiveChecked) {
      setError(
        "Kart bilgilerini maskelediğinizi veya görüntüde olmadığını teyit edin."
      );
      return;
    }
    setWorking(true);
    setError("");
    try {
      const blob = await new Promise<Blob>((resolve, reject) =>
        canvas.toBlob(
          value =>
            value ? resolve(value) : reject(Error("Fotoğraf işlenemedi.")),
          "image/jpeg",
          0.9
        )
      );
      if (blob.size > 5 * 1024 * 1024)
        throw Error("Aydınlatılmış fotoğraf 5 MB sınırını aşıyor.");
      const imageBase64 = await imageData(blob);
      const digest = await crypto.subtle.digest(
        "SHA-256",
        await blob.arrayBuffer()
      );
      const fingerprint = Array.from(new Uint8Array(digest), value =>
        value.toString(16).padStart(2, "0")
      ).join("");
      const payload = {
        stationId: station,
        accountId: account.id,
        expectedRevision: account.revision,
        sensitiveDataChecked: true,
        mime: "image/jpeg",
        imageBase64,
      };
      const ok = onQueueSlip
        ? await onQueueSlip(payload, fingerprint)
        : await onAction("/pos-slip-draft/import", payload);
      if (ok) await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Slip taslağı oluşturulamadı.");
    } finally {
      setWorking(false);
    }
  }
  async function readSlip() {
    if (!navigator.onLine) {
      setError(
        "İnternet yok. OCR yalnızca bağlantı geri geldiğinde kullanıcı işlemiyle başlatılır."
      );
      return;
    }
    if (!selected || !account || !provider) return;
    setWorking(true);
    setError("");
    const ok = await onAction("/pos-slip-draft/read", {
      stationId: station,
      accountId: account.id,
      expectedRevision: account.revision,
      draftId: selected.id,
      provider,
      externalConfirmed,
    });
    if (ok) await reload();
    setWorking(false);
  }
  async function confirmSlip() {
    if (!selected || !account) return;
    setWorking(true);
    setError("");
    const transactionAt = values.transactionAt;
    const ok = await onAction("/pos-slip-draft/confirm", {
      stationId: station,
      accountId: account.id,
      expectedRevision: account.revision,
      draftId: selected.id,
      draftRevision: selected.revision,
      ...values,
      transactionAt,
      staffConfirmed: true,
      amountOverrideConfirmed: amountOverride,
    });
    if (ok) await reload();
    setWorking(false);
  }
  const inputDate = values.transactionAt?.slice(0, 16) ?? "";
  const editable = staff && !!account && selected?.status === "DRAFT";
  const ocrAmount = selected?.values?.amountMinor ?? null;
  const currentAmount = values.amountMinor;
  const amountMismatch =
    ocrAmount !== null && currentAmount !== null && ocrAmount !== currentAmount;

  return (
    <div className="pos-slip-panel">
      <Notice>
        Fotoğraf telefonda işlenir. Tam kart no/CVV, IBAN, kart sahibi ve tam
        referans/onay kodu alanlarını maskeleyin. Sunucuya yalnız işlenmiş kopya
        gider; OCR banka teyidi değildir.
      </Notice>
      {error && <Notice warning>{error}</Notice>}
      {staff && (
        <Panel
          title="Telefon kamerası veya galeriden POS slipi"
          subtitle="Slip önce taslak olur; personel onayı olmadan ödeme kaydı açılmaz."
        >
          {!account ? (
            <Notice warning>
              Slip yüklemek için kendi açık akaryakıt vardiya hesabınız gerekli.
            </Notice>
          ) : (
            <>
              <div className="business-form form-grid two">
                <Field label="Kamerayla çek">
                  <input
                    type="file"
                    accept="image/jpeg,image/png"
                    capture="environment"
                    onChange={e => loadPhoto(e.target.files?.[0])}
                    disabled={busy || working}
                  />
                </Field>
                <Field label="Galeriden seç">
                  <input
                    type="file"
                    accept="image/jpeg,image/png"
                    onChange={e => loadPhoto(e.target.files?.[0])}
                    disabled={busy || working}
                  />
                </Field>
                <Field label={`Aydınlatma (${brightness.toFixed(2)}×)`}>
                  <input
                    type="range"
                    min="0.8"
                    max="1.6"
                    step="0.05"
                    value={brightness}
                    onChange={e => setBrightness(Number(e.target.value))}
                  />
                </Field>
                <Field label={`Kontrast (${contrast.toFixed(2)}×)`}>
                  <input
                    type="range"
                    min="0.8"
                    max="2.2"
                    step="0.05"
                    value={contrast}
                    onChange={e => setContrast(Number(e.target.value))}
                  />
                </Field>
                <Field label="Ön işleme">
                  <select
                    value={preprocess}
                    onChange={e => setPreprocess(e.target.value)}
                  >
                    <option value="BALANCED">Renkli / dengeli</option>
                    <option value="GRAY">Termal yazı / gri kontrast</option>
                    <option value="SHADOW">Gölge düzeltme / yerel eşik</option>
                  </select>
                </Field>
                <Field label={`Eğiklik düzeltme (${rotation.toFixed(1)}°)`}>
                  <input
                    type="range"
                    min="-5"
                    max="5"
                    step="0.2"
                    value={rotation}
                    onChange={e => setRotation(Number(e.target.value))}
                  />
                </Field>
                <p className="field-note">
                  Mavi damga baskıyı kapatıyorsa gri/yerel eşik ön işlemesini
                  deneyin. Kart, IBAN, isim ve tam işlem kodu alanlarını
                  sürükleyerek kapatın.
                </p>
              </div>
              {sourceRef.current && (
                <div className="pos-slip-canvas-wrap">
                  <canvas
                    ref={canvasRef}
                    onPointerDown={e => {
                      e.currentTarget.setPointerCapture(e.pointerId);
                      const p = point(e);
                      setDrag({ ...p, w: 0, h: 0 });
                    }}
                    onPointerMove={e => {
                      if (!drag) return;
                      const p = point(e);
                      setDrag({ ...drag, w: p.x - drag.x, h: p.y - drag.y });
                    }}
                    onPointerUp={() => {
                      if (drag && Math.abs(drag.w) > 4 && Math.abs(drag.h) > 4)
                        setMasks(old => [
                          ...old,
                          {
                            x: Math.min(drag.x, drag.x + drag.w),
                            y: Math.min(drag.y, drag.y + drag.h),
                            w: Math.abs(drag.w),
                            h: Math.abs(drag.h),
                          },
                        ]);
                      setDrag(null);
                    }}
                  />
                </div>
              )}
              {masks.length > 0 && (
                <button
                  type="button"
                  className="btn secondary"
                  onClick={() => setMasks([])}
                >
                  Maske alanlarını temizle
                </button>
              )}
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={sensitiveChecked}
                  onChange={e => setSensitiveChecked(e.target.checked)}
                />{" "}
                Kart/IBAN, kart sahibi ve tam işlem kodu alanlarının
                maskelendiğini kontrol ettim.
              </label>
              <button
                type="button"
                className="btn primary"
                disabled={
                  busy || working || !sourceRef.current || !sensitiveChecked
                }
                onClick={() => void submitPhoto()}
              >
                Maskeli fotoğrafı taslak olarak yükle
              </button>
            </>
          )}
        </Panel>
      )}
      {(staff || reviewer) && !featureAvailable && (
        <Panel
          title="POS slip OCR"
          subtitle="Slip özelliği veritabanı şema kontrolüyle açılır."
        >
          <Notice warning>
            POS slip migration şeması etkin değil. 0019 şeması doğrulanana kadar
            fotoğraf yükleme, OCR ve slip kayıt işlemleri kapalıdır.
          </Notice>
        </Panel>
      )}
      {(staff || reviewer) && featureAvailable && (
        <Panel
          title={
            reviewer ? "Muhasebe slip inceleme kuyruğu" : "Slip OCR taslaklarım"
          }
          subtitle="Personel, tutar ve işlem türünü doğrulamadan slip tahsilat sayılmaz."
        >
          <div className="form-grid two">
            <Field label="Slip taslağı">
              <select
                value={selected?.id ?? ""}
                onChange={e => setSelectedId(e.target.value)}
              >
                <option value="">Taslak seçin</option>
                {drafts.map(d => (
                  <option key={d.id} value={d.id}>
                    {d.staffName ?? "Personel"} · {d.id.slice(0, 8)} ·{" "}
                    {d.status} · {d.provider}
                  </option>
                ))}
              </select>
            </Field>
            {staff && selected?.status === "DRAFT" && (
              <Field label="OCR yöntemi">
                <select
                  value={provider}
                  onChange={e => setProvider(e.target.value)}
                >
                  <option value="LOCAL">Yerel Windows OCR</option>
                  <option value="MANUAL">Elle giriş</option>
                  {state.tenant?.isDemo && (
                    <option value="GEMINI">Gemini (yalnız DEMO + onay)</option>
                  )}
                </select>
              </Field>
            )}
          </div>
          {selected && (
            <>
              <div className="pos-slip-preview">
                {imageUrl && <img src={imageUrl} alt="Maskelenmiş POS slipi" />}
              </div>
              {selected.ocr?.warnings?.map((warning, i) => (
                <Notice key={i} warning>
                  {warning}
                </Notice>
              ))}
              <div className="form-grid two">
                <Field label="Tarih / saat">
                  <input
                    type="datetime-local"
                    value={inputDate}
                    disabled={!editable}
                    onChange={e =>
                      setValues(v => ({
                        ...v,
                        transactionAt: e.target.value
                          ? `${e.target.value}:00+03:00`
                          : null,
                      }))
                    }
                  />
                </Field>
                <Field label="Tutar (TL)">
                  <input
                    inputMode="decimal"
                    value={
                      currentAmount === null
                        ? ""
                        : (currentAmount / 100).toFixed(2).replace(".", ",")
                    }
                    disabled={!editable}
                    onChange={e => {
                      try {
                        setValues(v => ({
                          ...v,
                          amountMinor: e.target.value
                            ? parseMoney(e.target.value)
                            : null,
                        }));
                      } catch {
                        setValues(v => ({ ...v, amountMinor: null }));
                      }
                    }}
                  />
                </Field>
                <Field label="Banka / POS">
                  <input
                    value={values.bank ?? ""}
                    disabled={!editable}
                    onChange={e =>
                      setValues(v => ({ ...v, bank: e.target.value || null }))
                    }
                  />
                </Field>
                <Field label="Terminal">
                  <input
                    value={values.terminal ?? ""}
                    disabled={!editable}
                    onChange={e =>
                      setValues(v => ({
                        ...v,
                        terminal: e.target.value || null,
                      }))
                    }
                  />
                </Field>
                <Field label="İşlem referansı (son 4) ">
                  <input
                    value={values.reference ?? ""}
                    disabled={!editable}
                    onChange={e =>
                      setValues(v => ({
                        ...v,
                        reference: e.target.value || null,
                      }))
                    }
                  />
                </Field>
                <Field label="İşlem türü">
                  <select
                    value={values.transactionType ?? ""}
                    disabled={!editable}
                    onChange={e =>
                      setValues(v => ({
                        ...v,
                        transactionType: (e.target.value ||
                          null) as PosSlipValues["transactionType"],
                      }))
                    }
                  >
                    <option value="">Belirsiz</option>
                    <option value="SALE">Satış</option>
                    <option value="VOID">İptal</option>
                    <option value="REFUND">İade</option>
                  </select>
                </Field>
                <Field label="Tahsilat beyanı">
                  <select
                    value={values.settlementKind ?? ""}
                    disabled={!editable}
                    onChange={e =>
                      setValues(v => ({
                        ...v,
                        settlementKind: (e.target.value ||
                          null) as PosSlipValues["settlementKind"],
                      }))
                    }
                  >
                    <option value="">Belirsiz</option>
                    <option value="CARD_SLIP">Kart / POS slipi</option>
                    <option value="FAST">FAST (banka teyidi bekliyor)</option>
                  </select>
                </Field>
                <Field label="Maskelenmiş kart (varsa)">
                  <input
                    value={values.maskedCard ?? ""}
                    disabled={!editable}
                    placeholder="•••• 1234"
                    onChange={e =>
                      setValues(v => ({
                        ...v,
                        maskedCard: e.target.value || null,
                      }))
                    }
                  />
                </Field>
              </div>
              {selected.ocr?.source && (
                <details>
                  <summary>OCR kaynak alanları</summary>
                  <pre>{JSON.stringify(selected.ocr.source, null, 2)}</pre>
                </details>
              )}
              {amountMismatch && (
                <Notice warning>
                  Personel tutarı OCR tutarıyla uyuşmuyor: OCR{" "}
                  {money(ocrAmount)} / beyan {money(currentAmount)}. Fark
                  açıklanıp açıkça teyit edilmelidir.
                </Notice>
              )}
              {staff && selected.status === "DRAFT" && (
                <>
                  {provider === "GEMINI" && (
                    <label className="checkbox-label">
                      <input
                        type="checkbox"
                        checked={externalConfirmed}
                        onChange={e => setExternalConfirmed(e.target.checked)}
                      />{" "}
                      Maskelenmiş DEMO görselinin Google Gemini'ye
                      gönderilmesini onaylıyorum.
                    </label>
                  )}
                  <div className="button-group">
                    <button
                      type="button"
                      className="btn secondary"
                      disabled={
                        !navigator.onLine ||
                        busy ||
                        working ||
                        (provider === "GEMINI" && !externalConfirmed)
                      }
                      onClick={() => void readSlip()}
                    >
                      OCR oku / elle taslak aç
                    </button>
                    {values.transactionType && (
                      <button
                        type="button"
                        className="btn primary"
                        disabled={
                          !navigator.onLine ||
                          busy ||
                          working ||
                          (amountMismatch && !amountOverride)
                        }
                        onClick={() => void confirmSlip()}
                      >
                        Alanları doğrula ve kaydet
                      </button>
                    )}
                  </div>
                  {amountMismatch && (
                    <label className="checkbox-label">
                      <input
                        type="checkbox"
                        checked={amountOverride}
                        onChange={e => setAmountOverride(e.target.checked)}
                      />{" "}
                      Tutarı slip görüntüsüyle yeniden kontrol ettim; OCR
                      hatalı, personel beyanı doğru.
                    </label>
                  )}
                </>
              )}
              {selected.status !== "DRAFT" && (
                <Notice>
                  {selected.status === "PAYMENT_CREATED"
                    ? `Personel doğrulaması sonrası ${selected.values?.settlementKind === "FAST" ? "FAST beyanı" : "kart slipi beyanı"} oluşturuldu; banka teyidi değildir.`
                    : "İptal/iade olarak incelendi; ödeme veya tahsilat kaydı oluşturulmadı."}
                </Notice>
              )}
              {reviewer && (
                <p className="field-note">
                  Muhasebe görünümü salt okunurdur. Slip, mevcut vardiya hesabı
                  ve personel onay sürecinde ayrıca incelenir.
                </p>
              )}
            </>
          )}
          {!drafts.length && (
            <p className="field-note">
              Bu istasyon kapsamında slip taslağı yok.
            </p>
          )}
          <button
            type="button"
            className="btn secondary"
            onClick={() => void reload()}
          >
            Listeyi yenile
          </button>
        </Panel>
      )}
    </div>
  );
}

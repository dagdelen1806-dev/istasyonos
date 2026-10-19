import { lotCountPlan } from "@shared/lot-count";
import {
  LotReceiptFields,
  receiptLots,
  receiptLotPayload,
  type ReceiptLotInput,
} from "./LotReceiptFields";
import { useRef, useState } from "react";
import {
  Barcode,
  Smartphone,
  Plus,
  RefreshCw,
  FileDown,
  CheckCircle2,
} from "lucide-react";
import type { AppState } from "@shared/station";
import type { InventoryDraft, TerminalState } from "@shared/inventory";
import { money, parseMoney, amountInput } from "@shared/station";
import { useInventoryTerminal } from "./useInventoryTerminal";
import { marketCsv } from "./MarketStatement";
import "./market-accounting.css";
import "./inventory.css";

export default function InventoryTerminal(props: {
  state: AppState;
  stationId: string;
}) {
  return (
    <TerminalWorkspace
      key={`${props.state.user.id}:${props.stationId}`}
      {...props}
    />
  );
}
function TerminalWorkspace({
  state,
  stationId,
}: {
  state: AppState;
  stationId: string;
}) {
  const w = useInventoryTerminal(state, stationId),
    d = w.data,
    t = w.draft;
  const [barcode, setBarcode] = useState(""),
    [selectedLot, setSelectedLot] = useState(""),
    [quantity, setQuantity] = useState("1"),
    [mode, setMode] = useState("ADD"),
    [search, setSearch] = useState(""),
    [error, setError] = useState(""),
    [rebase, setRebase] = useState(""),
    [reason, setReason] = useState("");
  const scanRef = useRef<HTMLInputElement>(null);
  const open = t?.status === "DRAFT",
    scanLocked = w.locked || !d?.device?.enabled || !open;
  const scanProduct = d?.barcodes.find(
    b => b.barcode === barcode.trim()
  )?.productId;
  const scanLine = t?.lines.find(l => l.productId === scanProduct);
  async function scan(code = barcode) {
    if (!t) return;
    setError("");
    const n = Number(quantity);
    if (
      !/^\d+$/.test(quantity.trim()) ||
      !Number.isSafeInteger(n) ||
      n < 0 ||
      (n === 0 && mode !== "SET")
    ) {
      setError("Adet tam sayı olmalı. Sıfır için Miktarı değiştir seçin.");
      return;
    }
    const product = d?.barcodes.find(b => b.barcode === code.trim())?.productId,
      line = t.lines.find(l => l.productId === product);
    if (
      t.kind === "COUNT" &&
      line?.lotCounting &&
      !line.lots.some(l => l.id === selectedLot)
    ) {
      setError(
        "Ürünün gerçek parti etiketini kontrol edip sayılacak partiyi seçin."
      );
      return;
    }
    if (
      await w.action("draft-scan", {
        draftId: t.id,
        draftVersion: t.version,
        barcode: code.trim(),
        quantity: n,
        mode,
        ...(t.kind === "COUNT" && line?.lotCounting
          ? { lotId: selectedLot }
          : {}),
      })
    ) {
      setBarcode("");
      setQuantity("1");
      requestAnimationFrame(() => scanRef.current?.focus());
    }
  }
  if (!stationId)
    return <div className="notice">El terminali için bir istasyon seçin.</div>;
  if (!w.canRead)
    return (
      <div className="notice warning">Bu modülü kullanma yetkiniz yok.</div>
    );
  return (
    <div className="ma-root mi-terminal">
      <header className="ma-header">
        <div>
          <span className="ma-eyebrow">İSTASYONOS · STOK SAHADA</span>
          <h1>El terminali</h1>
          <p>
            Ortak mal kabul ve sayım taslakları · Android / Windows tarayıcı.
          </p>
        </div>
        <button
          className="btn"
          disabled={w.busy}
          onClick={() => void w.refresh().catch(e => setError(e.message))}
        >
          <RefreshCw size={16} />
          Yenile
        </button>
      </header>
      {(error || w.error) && (
        <p role="alert" className="notice warning">
          {error || w.error}
        </p>
      )}
      {w.notice && (
        <p role="status" className="notice">
          {w.notice}
        </p>
      )}
      {w.pending && (
        <div className="notice warning">
          <p>
            Sonucu beklenen işlem var; tekrar denemede aynı istek kimliği
            kullanılacak.
          </p>
          <button
            className="btn"
            disabled={w.busy}
            onClick={() => void w.retry()}
          >
            Aynı işlemin sonucunu kontrol et
          </button>
        </div>
      )}
      {!d ? (
        <p role="status">Terminal yükleniyor…</p>
      ) : !d.enabled ? (
        <div className="notice warning">
          Önce Market muhasebesi menüsünden ticari defteri başlatın.
        </div>
      ) : (
        <>
          <section className="ma-panel">
            <h2>
              <Smartphone size={18} /> Bu tarayıcının cihaz kaydı
            </h2>
            {d.device ? (
              <>
                <p>
                  <b>{d.device.name}</b> · {d.device.model} ·{" "}
                  {d.device.platform}
                </p>
                <p className={d.device.enabled ? "ma-good" : "ma-error"}>
                  {d.device.enabled
                    ? "Onaylı · okutmaya hazır"
                    : "Yönetici onayı bekleniyor veya cihaz devre dışı."}
                </p>
              </>
            ) : (
              <form
                onSubmit={e => {
                  e.preventDefault();
                  const f = new FormData(e.currentTarget);
                  void w.action("device-register", {
                    name: String(f.get("name")),
                    model: String(f.get("model")),
                    platform: String(f.get("platform")),
                  });
                }}
              >
                <fieldset disabled={w.locked}>
                  <div className="ma-form-grid">
                    <label>
                      Cihaz adı
                      <input
                        name="name"
                        required
                        maxLength={100}
                        placeholder="Depo terminali 1"
                      />
                    </label>
                    <label>
                      Marka / model
                      <input
                        name="model"
                        required
                        maxLength={100}
                        placeholder="Zebra TC73 veya elinizdeki model"
                      />
                    </label>
                    <label>
                      Platform
                      <select
                        name="platform"
                        aria-label="Cihaz platformu"
                        defaultValue={
                          /android/i.test(navigator.userAgent)
                            ? "ANDROID"
                            : "WINDOWS"
                        }
                      >
                        <option value="ANDROID">Android</option>
                        <option value="WINDOWS">Windows</option>
                        <option value="OTHER">Diğer</option>
                      </select>
                    </label>
                  </div>
                  <button className="btn primary">Cihazı kaydet</button>
                </fieldset>
              </form>
            )}
            <details>
              <summary>Okuyucu kurulumu ve bağlantı</summary>
              <p className="ma-hint">
                TC73 için DataWedge profilini tarayıcınıza bağlayın; Barcode
                Input ve Keystroke Output açık, son ek Enter olsun. Diğer
                cihazlar barkodu klavye olarak gönderebilir. Barkod alanına
                dokunup okutun. Bu kayıt tarayıcı kimliğidir; yerel depolamayı
                silince yeniden onay gerekir. Donanım SDK eşleştirmesi içermez.
              </p>
              <p className="ma-hint">
                Taslak ve okutmalar sunucuya kaydedilir. İnternet kesilse de
                yerel ağdaki sunucuya erişim gerekir; sunucu bağlantısı yokken
                yeni okutma kaydedilemez.
              </p>
            </details>
            {d.canApprove && (
              <details>
                <summary>Kayıtlı cihazları yönet ({d.devices.length})</summary>
                <div className="mi-device-list">
                  {d.devices.map(x => (
                    <div key={x.id}>
                      <span>
                        <b>{x.name}</b>
                        <small>
                          {x.model} · {x.platform} · {x.id.slice(0, 8)}
                        </small>
                      </span>
                      <button
                        className="btn"
                        disabled={w.locked}
                        onClick={() =>
                          void w.action("device-approve", {
                            deviceId: x.id,
                            enabled: !x.enabled,
                          })
                        }
                      >
                        {x.enabled ? "Devre dışı bırak" : "Onayla"}
                      </button>
                    </div>
                  ))}
                </div>
              </details>
            )}
          </section>
          <section className="ma-panel">
            <div className="ma-panel-head">
              <div>
                <h2>Mal kabul / sayım taslağı</h2>
                <p>
                  Birden fazla onaylı cihaz aynı taslakta çalışabilir. Her
                  okutma sürüm kontrollüdür.
                </p>
              </div>
            </div>
            <form
              onSubmit={e => {
                e.preventDefault();
                const f = new FormData(e.currentTarget);
                void w.action("draft-create", {
                  kind: String(f.get("kind")),
                  label: String(f.get("label")),
                });
              }}
            >
              <fieldset disabled={w.locked || !d.device?.enabled}>
                <div className="mi-create-grid">
                  <label>
                    İşlem
                    <select name="kind" aria-label="Taslak işlemi">
                      <option value="RECEIPT">Mal kabul</option>
                      <option value="COUNT">Stok sayımı</option>
                    </select>
                  </label>
                  <label>
                    Taslak adı
                    <input
                      name="label"
                      required
                      maxLength={100}
                      placeholder="Depo / teslimat / raf"
                    />
                  </label>
                  <button className="btn primary">
                    <Plus size={16} />
                    Taslak aç
                  </button>
                </div>
              </fieldset>
            </form>
            <label className="mi-draft-select">
              Kayıtlı taslak
              <select
                aria-label="Kayıtlı stok taslağı"
                value={w.selected}
                disabled={w.busy}
                onChange={e => w.setSelected(e.target.value)}
              >
                <option value="">Taslak seçin</option>
                {d.drafts.map(x => (
                  <option key={x.id} value={x.id}>
                    {x.label} · {x.kind === "COUNT" ? "Sayım" : "Mal kabul"} ·{" "}
                    {x.status === "DRAFT"
                      ? "Açık"
                      : x.status === "POSTED"
                        ? "İşlendi"
                        : "İptal"}{" "}
                    · {x.collected}/{x.total}
                  </option>
                ))}
              </select>
            </label>
          </section>
          {t && (
            <>
              <section className="ma-panel">
                <div className="ma-panel-head">
                  <div>
                    <h2>{t.label}</h2>
                    <p>
                      {t.kind === "COUNT" ? "Sayım" : "Mal kabul"} · sürüm{" "}
                      {t.version} ·{" "}
                      {open
                        ? "Açık"
                        : t.status === "POSTED"
                          ? "İşlendi"
                          : "İptal"}
                    </p>
                  </div>
                  <button
                    className="btn"
                    onClick={() =>
                      marketCsv(`stok-taslak-${t.id.slice(0, 8)}.csv`, [
                        [
                          "Ürün",
                          "Barkod",
                          "Birim",
                          "Başlangıç",
                          "Sayılan / alınan",
                          "Sayım yapan",
                          "Parti",
                          "SKT",
                          "Durum",
                        ],
                        ...t.lines.flatMap(l =>
                          l.lotCounting
                            ? l.lots.map(lot => [
                                l.name,
                                l.barcode,
                                l.unit,
                                lot.baselineQty ?? "",
                                lot.countedQty ?? "",
                                lot.countedBy ?? "",
                                lot.code,
                                lot.expiryDate ?? "",
                                lot.status,
                              ])
                            : [
                                [
                                  l.name,
                                  l.barcode,
                                  l.unit,
                                  l.baselineQty ?? "",
                                  l.countedQty ?? "",
                                  l.countedBy ?? "",
                                  "",
                                  "",
                                  "",
                                ],
                              ]
                        ),
                      ])
                    }
                  >
                    <FileDown size={16} />
                    Taslak CSV
                  </button>
                </div>
                {open && (
                  <>
                    <form
                      className="mi-scan"
                      onSubmit={e => {
                        e.preventDefault();
                        void scan();
                      }}
                    >
                      <fieldset disabled={scanLocked}>
                        <label>
                          <span>
                            <Barcode size={18} /> Barkod okut
                          </span>
                          <input
                            ref={scanRef}
                            aria-label="Terminal barkod"
                            autoComplete="off"
                            value={barcode}
                            onChange={e => setBarcode(e.target.value)}
                            placeholder="Okutun ve Enter"
                            required
                          />
                        </label>
                        {t.kind === "COUNT" && scanLine?.lotCounting && (
                          <label>
                            Sayılacak parti
                            <select
                              aria-label="Sayılacak parti"
                              value={
                                scanLine.lots.some(l => l.id === selectedLot)
                                  ? selectedLot
                                  : ""
                              }
                              onChange={e => setSelectedLot(e.target.value)}
                              required
                            >
                              <option value="">
                                Gerçek parti etiketini seçin
                              </option>
                              {scanLine.lots.map(l => (
                                <option key={l.id} value={l.id}>
                                  {l.code} · SKT {l.expiryDate ?? "bilinmiyor"}{" "}
                                  ·{" "}
                                  {l.status === "QUARANTINE"
                                    ? "Karantina"
                                    : "Satışa açık"}
                                </option>
                              ))}
                            </select>
                          </label>
                        )}
                        <div className="ma-form-grid">
                          <label>
                            Okutulan paket / adet
                            <input
                              aria-label="Terminal miktar"
                              inputMode="numeric"
                              value={quantity}
                              onChange={e => setQuantity(e.target.value)}
                            />
                          </label>
                          <label>
                            Miktar yöntemi
                            <select
                              aria-label="Miktar yöntemi"
                              value={mode}
                              onChange={e => setMode(e.target.value)}
                            >
                              <option value="ADD">Üzerine ekle</option>
                              <option value="SET">Miktarı değiştir</option>
                            </select>
                          </label>
                        </div>
                        <button className="btn primary">Okutmayı kaydet</button>
                      </fieldset>
                    </form>
                    <p className="ma-hint">
                      Koli barkodu tanımlıysa iç adedi otomatik uygulanır. Tam
                      adedi yazmak için ürünün ana barkodunu kullanın.
                      Sayılmayan ürün sıfır kabul edilmez; sıfır sayım için
                      Miktarı değiştir → 0 girin. Takipli sayımda gerçek partiyi
                      seçin; sayılmayan partiler değişmez.
                    </p>
                  </>
                )}
                <label>
                  Ürün / raf / barkod ara
                  <input
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    placeholder="Taslakta ara"
                  />
                </label>
                <div className="mi-count-lines">
                  {t.lines
                    .filter(l =>
                      `${l.name} ${l.barcode} ${l.lots.map(x => x.code).join(" ")} ${d.products.find(p => p.id === l.productId)?.shelf ?? ""}`
                        .toLocaleLowerCase("tr")
                        .includes(search.toLocaleLowerCase("tr"))
                    )
                    .slice(0, 100)
                    .map(l => (
                      <article
                        key={l.productId}
                        className={
                          l.stockChanged && t.kind === "COUNT" ? "mi-stale" : ""
                        }
                      >
                        <div>
                          <b>{l.name}</b>
                          <small>
                            {l.barcode} · {l.unit} ·{" "}
                            {d.products.find(p => p.id === l.productId)?.shelf}
                          </small>
                          <span>
                            {l.countedQty === null
                              ? "Henüz sayılmadı"
                              : `${l.lotCounting ? (d.canPost ? "Sayım sonrası toplam" : "Partilerde sayılan") : t.kind === "COUNT" ? "Sayılan" : "Alınan"}: ${l.countedQty}`}
                            {d.canPost && t.kind === "COUNT"
                              ? ` · Kayıtlı stok: ${l.currentQty}`
                              : ""}
                          </span>
                        </div>
                        {l.lotCounting && (
                          <details>
                            <summary>
                              Partiler · sayılan{" "}
                              {l.lots.filter(x => x.countedQty !== null).length}
                              /{l.lots.length}
                            </summary>
                            <div className="mi-count-lots">
                              {l.lots.map(lot => (
                                <div key={lot.id} className="notice">
                                  <b>{lot.code}</b>
                                  <small>
                                    SKT {lot.expiryDate ?? "bilinmiyor"} ·{" "}
                                    {lot.status === "QUARANTINE"
                                      ? "Karantina"
                                      : "Satışa açık"}
                                  </small>
                                  <p>
                                    {lot.countedQty === null
                                      ? "Henüz sayılmadı"
                                      : `Sayılan: ${lot.countedQty}`}
                                    {d.canPost
                                      ? ` · Kayıtlı: ${lot.currentQty}`
                                      : ""}
                                  </p>
                                  {open && (
                                    <button
                                      className="btn"
                                      disabled={scanLocked || l.stockChanged}
                                      onClick={() => {
                                        setBarcode(l.barcode);
                                        setSelectedLot(lot.id);
                                        setMode("SET");
                                        setQuantity(
                                          String(lot.countedQty ?? 0)
                                        );
                                        scanRef.current?.focus();
                                      }}
                                    >
                                      Partiyi say · {lot.code}
                                    </button>
                                  )}
                                </div>
                              ))}
                            </div>
                          </details>
                        )}
                        {open && (
                          <div className="ma-row-actions">
                            <button
                              className="btn"
                              disabled={
                                scanLocked ||
                                (l.stockChanged && t.kind === "COUNT")
                              }
                              onClick={() => {
                                setBarcode(l.barcode);
                                setMode("SET");
                                setQuantity(String(l.countedQty ?? 0));
                                scanRef.current?.focus();
                              }}
                            >
                              {l.lotCounting
                                ? "Parti seçerek say"
                                : "Miktar gir"}
                            </button>
                            {t.kind === "COUNT" && (
                              <button
                                className="btn"
                                disabled={scanLocked}
                                onClick={() => {
                                  setRebase(l.productId);
                                  setReason("");
                                }}
                              >
                                Yeniden say
                              </button>
                            )}
                          </div>
                        )}
                        {l.stockChanged && t.kind === "COUNT" && open && (
                          <p className="ma-error">
                            Stok değişti. Yeniden say ile eski sayımı temizleyip
                            ürünü tekrar sayın.
                          </p>
                        )}
                      </article>
                    ))}
                </div>
                <p className="ma-hint">
                  En fazla 100 eşleşen satır gösterilir; CSV bütün taslağı
                  içerir.
                </p>
                {open && rebase && (
                  <form
                    className="notice warning"
                    onSubmit={e => {
                      e.preventDefault();
                      void w
                        .action("draft-rebase", {
                          draftId: t.id,
                          draftVersion: t.version,
                          productId: rebase,
                          reason,
                        })
                        .then(ok => {
                          if (ok) setRebase("");
                        });
                    }}
                  >
                    <p>
                      Bu ürünün sayılan adedi temizlenecek ve güncel stok
                      başlangıç alınacak. Ardından fizikî ürünü tekrar sayın.
                    </p>
                    <label>
                      Yeniden sayım açıklaması
                      <input
                        value={reason}
                        onChange={e => setReason(e.target.value)}
                        minLength={5}
                        maxLength={500}
                        required
                      />
                    </label>
                    <button className="btn" disabled={scanLocked}>
                      Eski sayımı temizle
                    </button>
                    <button
                      type="button"
                      className="btn"
                      onClick={() => setRebase("")}
                    >
                      Vazgeç
                    </button>
                  </form>
                )}
                {open && (
                  <details>
                    <summary>Taslağı iptal et</summary>
                    <form
                      onSubmit={e => {
                        e.preventDefault();
                        const f = new FormData(e.currentTarget);
                        void w.action("draft-cancel", {
                          draftId: t.id,
                          draftVersion: t.version,
                          reason: String(f.get("reason")),
                        });
                      }}
                    >
                      <fieldset disabled={w.locked}>
                        <label>
                          İptal açıklaması
                          <input
                            name="reason"
                            minLength={5}
                            maxLength={500}
                            required
                          />
                        </label>
                        <button className="btn">Açıklamayla iptal et</button>
                      </fieldset>
                    </form>
                  </details>
                )}
              </section>
              {open && d.canPost && (
                <TerminalPosting
                  key={t.id}
                  data={d}
                  draft={t}
                  locked={w.locked}
                  action={w.action}
                />
              )}
              {open && !d.canPost && (
                <p className="notice">
                  Okutmalar kaydedildiğinde yetkili kullanıcı aynı taslaktan
                  stok ve mali defter onayını verebilir.
                </p>
              )}
              <section className="ma-panel">
                <h2>Son 50 işlem</h2>
                <div className="mi-events">
                  {t.events.map(x => (
                    <p key={x.id}>
                      <b>
                        {(
                          {
                            CREATE: "Taslak açıldı",
                            SCAN: "Okutma",
                            SET: "Miktar değişti",
                            REBASE: "Yeniden sayım",
                            CANCEL: "İptal",
                            POST: "Deftere işlendi",
                          } as Record<string, string>
                        )[x.action] ?? x.action}
                      </b>{" "}
                      · {x.actorName} · {x.createdAt}
                      <small>
                        {x.productId
                          ? t.lines.find(l => l.productId === x.productId)?.name
                          : ""}{" "}
                        {x.lotId
                          ? `· Parti ${t.lines.flatMap(l => l.lots).find(l => l.id === x.lotId)?.code ?? x.lotId}`
                          : ""}{" "}
                        {x.beforeQty ?? "—"} → {x.afterQty ?? "—"} {x.note}
                      </small>
                    </p>
                  ))}
                </div>
              </section>
            </>
          )}
        </>
      )}
    </div>
  );
}

const rounded = (n: bigint, d: bigint) => {
  const v = Number((n + d / 2n) / d);
  if (!Number.isSafeInteger(v)) throw Error("Tutar güvenli sınırı aşıyor.");
  return v;
};
const parseVat = (value: string) => {
  if (!/^\d{1,3}([.,]\d{1,2})?$/.test(value.trim()))
    throw Error("KDV en fazla iki ondalık basamak içermeli.");
  const [whole, decimal = ""] = value.trim().replace(",", ".").split(".");
  const result = Number(whole) * 100 + Number(decimal.padEnd(2, "0"));
  if (result > 10000) throw Error("KDV %0–100 aralığında olmalı.");
  return result;
};
function TerminalPosting({
  data,
  draft,
  locked,
  action,
}: {
  data: TerminalState;
  draft: InventoryDraft;
  locked: boolean;
  action: (path: string, payload: Record<string, unknown>) => Promise<boolean>;
}) {
  const [lotInputs, setLotInputs] = useState<Record<string, ReceiptLotInput[]>>(
    {}
  );
  const [costs, setCosts] = useState<Record<string, string>>({}),
    [vats, setVats] = useState<Record<string, string>>({}),
    [error, setError] = useState("");
  const lines = draft.lines.filter(
    l => l.countedQty !== null && (draft.kind === "COUNT" || l.countedQty > 0)
  );
  const cost = (l: InventoryDraft["lines"][number]) =>
    costs[l.productId] ??
    amountInput(
      (draft.kind === "COUNT"
        ? l.unitNetMinor
        : data.products.find(p => p.id === l.productId)?.unitNetMinor) ?? 0
    );
  const vat = (id: string) =>
    vats[id] ??
    String((data.products.find(p => p.id === id)?.vatBps ?? 0) / 100);
  let total = 0,
    gain = 0,
    loss = 0,
    previewError = "";
  try {
    for (const l of lines) {
      const unit = parseMoney(cost(l)),
        qty = l.countedQty!;
      if (draft.kind === "RECEIPT") {
        const rate = parseVat(vat(l.productId));
        if (!Number.isInteger(rate) || rate < 0 || rate > 10000)
          throw Error("KDV %0–100 arası, en fazla 2 ondalık olmalı.");
        const net = unit * qty;
        total += net + rounded(BigInt(net) * BigInt(rate), 10000n);
      } else if (l.lotCounting) {
        const plan = lotCountPlan(
          l.currentQty!,
          l.currentValueMinor!,
          l.lots.map(x => ({ before: x.currentQty!, after: x.countedQty })),
          unit
        );
        gain += plan.gainMinor;
        loss += plan.lossMinor;
      } else {
        const delta = qty - l.currentQty!;
        if (delta > 0) gain += delta * unit;
        else if (delta < 0)
          loss += rounded(
            BigInt(l.currentValueMinor!) * BigInt(-delta),
            BigInt(l.currentQty!)
          );
      }
    }
    if (![total, gain, loss].every(Number.isSafeInteger))
      throw Error("Toplam güvenli sınırı aşıyor.");
  } catch (e) {
    previewError = (e as Error).message;
  }
  return (
    <section className="ma-panel">
      <h2>Yetkili stok ve maliyet onayı</h2>
      <p className="ma-hint">
        Okutma stok değiştirmez. Bu onay,{" "}
        {draft.kind === "COUNT"
          ? "sayılan ürünlerin farklarını net maliyetiyle"
          : "alışı stok, KDV ve tedarikçi borcuyla"}{" "}
        birlikte işler.
      </p>
      {data.closedToday && (
        <p className="notice warning">
          Bugünün gün sonu kapalı. Taslak saklanır; bu güne mali kayıt
          yapılamaz.
        </p>
      )}
      {(error || previewError) && (
        <p role="alert" className="ma-error">
          {error || previewError}
        </p>
      )}
      <form
        onSubmit={e => {
          e.preventDefault();
          setError("");
          try {
            const f = new FormData(e.currentTarget),
              payload = {
                draftId: draft.id,
                draftVersion: draft.version,
                expectedRevision: draft.revision,
              };
            if (draft.kind === "RECEIPT") {
              void action("receipt-post", {
                ...payload,
                partyId: String(f.get("party")),
                reference: String(f.get("reference")),
                dueDate: String(f.get("due")),
                expectedTotalMinor: total,
                lines: lines.map(l => ({
                  productId: l.productId,
                  quantity: l.countedQty,
                  unitNetMinor: parseMoney(cost(l)),
                  vatBps: parseVat(vat(l.productId)),
                  ...(data.products.find(p => p.id === l.productId)?.lotTracking
                    ? {
                        lots: receiptLotPayload(
                          lotInputs[l.productId] ??
                            receiptLots(String(l.countedQty)),
                          l.countedQty!
                        ),
                      }
                    : {}),
                })),
              });
            } else {
              void action("count-post", {
                ...payload,
                reason: String(f.get("reason")),
                zeroCostAccepted: f.get("zero") === "on",
                expectedGainMinor: gain,
                expectedLossMinor: loss,
                unitCosts: lines
                  .filter(l =>
                    l.lotCounting
                      ? l.lots.some(
                          x =>
                            x.countedQty !== null &&
                            x.countedQty > x.currentQty!
                        )
                      : l.countedQty! > l.currentQty!
                  )
                  .map(l => ({
                    productId: l.productId,
                    unitNetMinor: parseMoney(cost(l)),
                  })),
              });
            }
          } catch (e) {
            setError((e as Error).message);
          }
        }}
      >
        <fieldset disabled={locked || data.closedToday}>
          {draft.kind === "RECEIPT" && (
            <div className="ma-form-grid">
              <label>
                Tedarikçi
                <select
                  name="party"
                  required
                  aria-label="Mal kabul tedarikçisi"
                >
                  <option value="">Seçin</option>
                  {data.suppliers.map(s => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Alış belge no
                <input name="reference" required maxLength={100} />
              </label>
              <label>
                Vade
                <input
                  name="due"
                  type="date"
                  defaultValue={data.today}
                  required
                />
              </label>
            </div>
          )}
          <div className="mi-posting-lines">
            {lines.map(l => {
              const delta = l.countedQty! - l.currentQty!;
              return (
                <div key={l.productId}>
                  <span>
                    <b>{l.name}</b>
                    <small>
                      {draft.kind === "COUNT"
                        ? `Stok ${l.currentQty} → ${l.countedQty} · Fark ${delta}${l.lotCounting ? " · Parti farkları aşağıda" : l.lotTracking ? " · Eski taslak: parti sayımı için yeniden sayın" : ""}`
                        : `Alınan ${l.countedQty} ${l.unit}`}
                    </small>
                  </span>
                  {l.lotCounting && (
                    <div className="ma-hint">
                      {l.lots
                        .filter(x => x.countedQty !== null)
                        .map(x => (
                          <p key={x.id}>
                            {x.code} · SKT {x.expiryDate ?? "bilinmiyor"}:{" "}
                            {x.currentQty} → {x.countedQty} (
                            {x.countedQty! - x.currentQty! > 0 ? "+" : ""}
                            {x.countedQty! - x.currentQty!})
                          </p>
                        ))}
                      <p>
                        Sayılmayan{" "}
                        {l.lots.filter(x => x.countedQty === null).length} parti
                        korunur; karantina ve SKT değişmez.
                      </p>
                    </div>
                  )}
                  {draft.kind === "RECEIPT" &&
                    data.products.find(p => p.id === l.productId)
                      ?.lotTracking && (
                      <LotReceiptFields
                        prefix={l.name}
                        today={data.today}
                        quantity={l.countedQty!}
                        value={
                          lotInputs[l.productId] ??
                          receiptLots(String(l.countedQty))
                        }
                        onChange={lots =>
                          setLotInputs({ ...lotInputs, [l.productId]: lots })
                        }
                      />
                    )}
                  {(draft.kind === "RECEIPT" ||
                    (l.lotCounting
                      ? l.lots.some(
                          x =>
                            x.countedQty !== null &&
                            x.countedQty > x.currentQty!
                        )
                      : delta > 0)) && (
                    <label>
                      KDV hariç birim maliyet (TL)
                      <input
                        aria-label={`${l.name} birim maliyet`}
                        inputMode="decimal"
                        value={cost(l)}
                        required
                        onChange={e =>
                          setCosts({ ...costs, [l.productId]: e.target.value })
                        }
                      />
                    </label>
                  )}
                  {draft.kind === "RECEIPT" && (
                    <label>
                      Alış KDV %
                      <input
                        aria-label={`${l.name} alış KDV`}
                        inputMode="decimal"
                        value={vat(l.productId)}
                        required
                        onChange={e =>
                          setVats({
                            ...vats,
                            [l.productId]: e.target.value.replace(",", "."),
                          })
                        }
                      />
                    </label>
                  )}
                </div>
              );
            })}
          </div>
          {draft.kind === "COUNT" && (
            <>
              <p className="ma-hint">
                Sayılmayan {draft.lines.length - lines.length} ürün
                değişmeyecek. Eksikler mevcut ağırlıklı maliyetle, fazlalar
                girdiğiniz net maliyetle işlenir.
              </p>
              <label>
                Sayım onay açıklaması
                <input name="reason" required minLength={5} maxLength={500} />
              </label>
              <label className="mi-check">
                <input name="zero" type="checkbox" />
                Varsa sıfır maliyetli stok fazlasını teyit ediyorum.
              </label>
            </>
          )}
          <div className="notice">
            {draft.kind === "RECEIPT"
              ? `Belge toplamı · KDV dahil: ${money(total)}`
              : `Stok fazlası ${money(gain)} · Stok eksiği ${money(loss)}`}
          </div>
          <button
            className="btn primary"
            disabled={
              !lines.length ||
              !!previewError ||
              (draft.kind === "COUNT" &&
                lines.some(
                  l =>
                    l.stockChanged ||
                    (l.lotTracking &&
                      !l.lotCounting &&
                      l.countedQty !== l.currentQty)
                ))
            }
          >
            <CheckCircle2 size={17} />
            {draft.kind === "COUNT"
              ? "Sayım farklarını işle"
              : "Mal kabulünü işle"}
          </button>
        </fieldset>
      </form>
    </section>
  );
}

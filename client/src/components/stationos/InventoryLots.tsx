import { useState, useEffect, useRef, type FormEvent } from "react";
import {
  RefreshCw,
  FileDown,
  ShieldCheck,
  CalendarClock,
  Plus,
} from "lucide-react";
import type { LotState, InventoryLot } from "@shared/lots";
import { money, parseMoney, amountInput } from "@shared/station";
import { loadLotState } from "@/lib/station-api";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { marketCsv } from "./MarketStatement";
type Product = LotState["products"][number];
type Modal =
  | { kind: "ENABLE"; product: Product; revision: number }
  | {
      kind: "STATUS" | "COUNT" | "WRITE_OFF";
      lot: InventoryLot;
      product: Product;
      revision: number;
    };
const labels: Record<string, string> = {
  ENABLE: "Parti takibi açıldı",
  OPENING: "Mevcut stok eşleştirme",
  PURCHASE: "Mal kabul",
  SALE: "FEFO satış",
  SALE_RETURN: "İade → karantina",
  PURCHASE_RETURN: "Tedarikçiye iade",
  STATUS: "Etiket / durum",
  LOT_COUNT: "Parti sayımı",
  LOT_WRITE_OFF: "Fire",
};
export function InventoryLots({
  stationId,
  revision,
  locked,
  action,
}: {
  stationId: string;
  revision: number;
  locked: boolean;
  action: (path: string, payload: Record<string, unknown>) => Promise<boolean>;
}) {
  const [data, setData] = useState<LotState | null>(null),
    [selected, setSelected] = useState(""),
    [offset, setOffset] = useState(0),
    [filter, setFilter] = useState("ALL"),
    [error, setError] = useState(""),
    [modal, setModal] = useState<Modal | null>(null),
    [loading, setLoading] = useState(false);
  const sequence = useRef(0);
  async function refresh() {
    const seq = ++sequence.current;
    setLoading(true);
    try {
      const result = await loadLotState(stationId, selected, offset);
      if (seq === sequence.current) {
        setData(result);
        setError("");
      }
    } catch (e) {
      if (seq === sequence.current) setError((e as Error).message);
    } finally {
      if (seq === sequence.current) setLoading(false);
    }
  }
  useEffect(() => {
    void refresh();
    return () => {
      sequence.current++;
    };
  }, [stationId, selected, offset, revision]);
  async function save(path: string, body: Record<string, unknown>) {
    const ok = await action("/market-accounting/inventory/" + path, body);
    if (ok) {
      setModal(null);
      await refresh();
    }
    return ok;
  }
  const current = data?.products.find(p => p.id === selected),
    disabled = locked || loading || !!data?.closedToday;
  const shown =
    data?.lots.filter(
      l =>
        filter === "ALL" ||
        (filter === "QUARANTINE" && l.status === "QUARANTINE") ||
        (filter === "EXPIRED" && l.daysLeft !== null && l.daysLeft < 0) ||
        (filter === "NEAR" &&
          l.daysLeft !== null &&
          l.daysLeft >= 0 &&
          l.daysLeft <= 30 &&
          l.status === "AVAILABLE")
    ) ?? [];
  return (
    <section className="ma-panel">
      <div className="ma-panel-head">
        <div>
          <h2>
            <CalendarClock size={18} />
            Lot, SKT ve karantina
          </h2>
          <p>
            Parti bazında izleme, tarihi en yakın kullanılabilir partiden satış
            ve açıklamalı fire.
          </p>
        </div>
        <button
          className="btn"
          disabled={locked || loading}
          onClick={() => void refresh()}
        >
          <RefreshCw size={16} />
          Partileri yenile
        </button>
      </div>
      {error && (
        <p role="alert" className="ma-error">
          {error}
        </p>
      )}
      {loading && <p role="status">Partiler yükleniyor…</p>}
      {data && (
        <>
          <div className="ma-wallet-grid">
            <div>
              <span>SKT geçmiş · adet</span>
              <strong className="ma-error">{data.expiredQty}</strong>
            </div>
            <div>
              <span>30 gün içinde SKT · adet</span>
              <strong>{data.nearQty}</strong>
            </div>
            <div>
              <span>Karantina · adet</span>
              <strong>{data.quarantineQty}</strong>
            </div>
            <div>
              <span>Seçili üründe satılabilir</span>
              <strong>{current ? current.saleableQty : "Ürün seçin"}</strong>
            </div>
          </div>
          <div className="ma-form-grid mi-lot-filters">
            <label>
              Lot ürünü
              <select
                aria-label="Lot ürünü"
                value={selected}
                disabled={locked}
                onChange={e => {
                  setSelected(e.target.value);
                  setOffset(0);
                }}
              >
                <option value="">Tüm ürünler</option>
                {data.products.map(p => (
                  <option key={p.id} value={p.id}>
                    {p.name} · {p.tracking ? "Takip açık" : "Takip kapalı"}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Bu sayfada filtre
              <select
                aria-label="Parti filtresi"
                value={filter}
                onChange={e => setFilter(e.target.value)}
              >
                <option value="ALL">Tümü</option>
                <option value="NEAR">30 günde yaklaşan</option>
                <option value="EXPIRED">SKT geçmiş</option>
                <option value="QUARANTINE">Karantina</option>
              </select>
            </label>
          </div>
          {current && (
            <div className="notice">
              <b>{current.name}</b> · Fizikî {current.quantity} · Satılabilir{" "}
              {current.saleableQty} ·{" "}
              {current.tracking ? (
                "Lot takibi açık"
              ) : (
                <button
                  className="btn primary"
                  disabled={disabled}
                  onClick={() =>
                    setModal({
                      kind: "ENABLE",
                      product: current,
                      revision: data.revision,
                    })
                  }
                >
                  <ShieldCheck size={16} />
                  Lot takibini aç
                </button>
              )}
            </div>
          )}
          <p className="ma-hint">
            Bugün {data.today} (Türkiye). SKT günü sonuna kadar satışa açık;
            tarihi geçmiş, SKT'siz veya karantinadaki parti satılmaz. FEFO,
            fizikî raftan doğru partiyi seçmenin yerine geçmez. Uyarılar seçili
            ürün kapsamının tamamını, tablo filtresi yalnız bu sayfayı kapsar.
          </p>
          <div className="ma-table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Ürün / parti</th>
                  <th>SKT</th>
                  <th>Kalan</th>
                  <th>Durum</th>
                  <th>Kaynak</th>
                  <th>İşlem</th>
                </tr>
              </thead>
              <tbody>
                {shown.map(l => {
                  const p = data.products.find(p => p.id === l.productId)!;
                  return (
                    <tr key={l.id}>
                      <td>
                        <b>{l.productName}</b>
                        <small>
                          {l.code} · #{l.id.slice(0, 8)}
                        </small>
                      </td>
                      <td>
                        {l.expiryDate ?? "Bilinmiyor"}
                        <small>
                          {l.daysLeft === null
                            ? "Kontrol gerekli"
                            : l.daysLeft < 0
                              ? `${-l.daysLeft} gün geçti`
                              : `${l.daysLeft} gün kaldı`}
                        </small>
                      </td>
                      <td>{l.quantity}</td>
                      <td>
                        <span className={l.saleable ? "ma-good" : "ma-error"}>
                          {l.status === "QUARANTINE"
                            ? "Karantina"
                            : l.saleable
                              ? "Satışa açık"
                              : "SKT nedeniyle kapalı"}
                        </span>
                      </td>
                      <td>
                        {labels[l.originKind] ?? l.originKind}
                        <small>{l.originId}</small>
                      </td>
                      <td>
                        <div className="ma-row-actions">
                          <button
                            className="btn"
                            disabled={disabled || !l.quantity}
                            onClick={() =>
                              setModal({
                                kind: "STATUS",
                                lot: l,
                                product: p,
                                revision: data.revision,
                              })
                            }
                          >
                            Etiket / karantina
                          </button>
                          <button
                            className="btn"
                            disabled={disabled}
                            onClick={() =>
                              setModal({
                                kind: "COUNT",
                                lot: l,
                                product: p,
                                revision: data.revision,
                              })
                            }
                          >
                            Partiyi say
                          </button>
                          <button
                            className="btn"
                            disabled={disabled || !l.quantity}
                            onClick={() =>
                              setModal({
                                kind: "WRITE_OFF",
                                lot: l,
                                product: p,
                                revision: data.revision,
                              })
                            }
                          >
                            Fire işle
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {!shown.length && (
            <p className="ma-hint">
              Bu sayfada filtreye uygun parti yok. Takibi kapalı üründe mevcut
              stoğu önce gerçek parti bilgisiyle eşleştirin.
            </p>
          )}
          <div className="ma-row-actions">
            <button
              className="btn"
              disabled={loading || !offset}
              onClick={() => setOffset(Math.max(0, offset - data.limit))}
            >
              Önceki partiler
            </button>
            <button
              className="btn"
              disabled={loading || offset + data.limit >= data.total}
              onClick={() => setOffset(offset + data.limit)}
            >
              Sonraki partiler
            </button>
            <span>
              {data.total} parti · sayfa {Math.floor(offset / data.limit) + 1}
            </span>
            <button
              className="btn"
              disabled={loading}
              onClick={() =>
                marketCsv("stok-lot-skt.csv", [
                  [
                    "Ürün",
                    "Parti",
                    "SKT",
                    "Adet",
                    "Durum",
                    "Kaynak türü",
                    "Kaynak kimliği",
                  ],
                  ...shown.map(l => [
                    l.productName,
                    l.code,
                    l.expiryDate,
                    l.quantity,
                    l.status,
                    l.originKind,
                    l.originId,
                  ]),
                ])
              }
            >
              <FileDown size={16} />
              Görünen partileri CSV indir
            </button>
          </div>
          <h3>Son 100 parti işlemi</h3>
          <div className="ma-table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Tarih UTC</th>
                  <th>Ürün</th>
                  <th>İşlem</th>
                  <th>Miktar farkı</th>
                  <th>Kullanıcı / açıklama</th>
                  <th>Kaynak kimliği</th>
                </tr>
              </thead>
              <tbody>
                {data.events.map(e => (
                  <tr key={e.id}>
                    <td>{e.createdAt}</td>
                    <td>
                      {e.productName}
                      <small>{e.lotId?.slice(0, 8)}</small>
                    </td>
                    <td>{labels[e.kind] ?? e.kind}</td>
                    <td>
                      {e.delta > 0 ? "+" : ""}
                      {e.delta}
                    </td>
                    <td>
                      {e.actorName}
                      <small>{e.note}</small>
                      {e.beforeLabel && <small>Önce: {e.beforeLabel}</small>}
                      {e.afterLabel && <small>Sonra: {e.afterLabel}</small>}
                    </td>
                    <td>{e.sourceId}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="ma-hint">
            Lot adedi fizikî stoktur. Maliyet ürünün ağırlıklı net maliyetidir;
            FEFO ayrı bir maliyet yöntemi değildir. Müşteri iadeleri kontrol
            edilene kadar SKT'siz karantinaya alınır. Fire maliyeti stok eksiği
            olarak aylık sonuca yansır. Takip açıldıktan sonra kapatma bu
            sürümde sunulmaz.
          </p>
          {modal && (
            <LotDialog
              modal={modal}
              locked={locked}
              close={() => setModal(null)}
              save={save}
            />
          )}
        </>
      )}
    </section>
  );
}
function LotDialog({
  modal,
  locked,
  close,
  save,
}: {
  modal: Modal;
  locked: boolean;
  close: () => void;
  save: (path: string, payload: Record<string, unknown>) => Promise<boolean>;
}) {
  const p = modal.product,
    l = modal.kind === "ENABLE" ? null : modal.lot;
  const [opening, setOpening] = useState(() =>
      p.quantity
        ? [{ code: "", expiryDate: "", quantity: String(p.quantity) }]
        : []
    ),
    [quantity, setQuantity] = useState(
      String(modal.kind === "WRITE_OFF" ? 1 : (l?.quantity ?? 0))
    ),
    [unit, setUnit] = useState(
      amountInput(
        p.quantity
          ? Number(
              (BigInt(p.valueMinor) + BigInt(p.quantity) / 2n) /
                BigInt(p.quantity)
            )
          : 0
      )
    ),
    [error, setError] = useState("");
  let amount = 0,
    previewError = "";
  try {
    if (modal.kind === "COUNT" || modal.kind === "WRITE_OFF") {
      const n = Number(quantity);
      if (
        !/^\d+$/.test(quantity) ||
        !Number.isSafeInteger(n) ||
        n < 0 ||
        (modal.kind === "WRITE_OFF" && n < 1)
      )
        throw Error("Geçerli tam sayı miktarı girin.");
      const delta = modal.kind === "COUNT" ? n - l!.quantity : -n;
      if (delta < 0) {
        if (-delta > p.quantity || -delta > l!.quantity)
          throw Error("Parti stoğu yetersiz.");
        amount = Number(
          (BigInt(p.valueMinor) * BigInt(-delta) + BigInt(p.quantity) / 2n) /
            BigInt(p.quantity)
        );
      } else amount = delta * parseMoney(unit);
      if (!Number.isSafeInteger(amount)) throw Error("Tutar sınırı aşıldı.");
    }
  } catch (e) {
    previewError = (e as Error).message;
  }
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");
    try {
      const f = new FormData(e.currentTarget),
        base = {
          productId: p.id,
          expectedVersion: p.stockVersion,
          expectedRevision: modal.revision,
          reason: String(f.get("reason")),
        };
      if (modal.kind === "ENABLE") {
        const lots = opening.map(l => ({ ...l, quantity: Number(l.quantity) }));
        if (lots.reduce((n, l) => n + l.quantity, 0) !== p.quantity)
          throw Error("Parti toplamı mevcut stokla eşit olmalı.");
        await save("lot-enable", { ...base, lots });
      } else if (modal.kind === "STATUS") {
        await save("lot-status", {
          ...base,
          lotId: l!.id,
          code: String(f.get("code")),
          expiryDate: String(f.get("expiry")) || null,
          status: String(f.get("status")),
          inspectionAccepted: f.get("inspection") === "on",
        });
      } else {
        if (previewError) throw Error(previewError);
        await save("lot-adjust", {
          ...base,
          lotId: l!.id,
          mode: modal.kind,
          quantity: Number(quantity),
          countedQty: Number(quantity),
          unitNetMinor: parseMoney(unit),
          zeroCostAccepted: f.get("zero") === "on",
          expectedCostMinor: amount,
        });
      }
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return (
    <Dialog
      open
      onOpenChange={open => {
        if (!open && !locked) close();
      }}
    >
      <DialogContent className="ma-dialog">
        <DialogTitle>
          {modal.kind === "ENABLE"
            ? "Lot takibini başlat"
            : modal.kind === "STATUS"
              ? "Parti etiketi ve karantina"
              : modal.kind === "COUNT"
                ? "Parti sayımı"
                : "Parti fire kaydı"}
        </DialogTitle>
        <DialogDescription>
          {p.name}
          {l ? " · " + l.code : ""} · Stok sürümü {p.stockVersion}
        </DialogDescription>
        <form onSubmit={submit}>
          <fieldset disabled={locked}>
            {modal.kind === "ENABLE" && (
              <>
                <p className="ma-hint">
                  Mevcut {p.quantity} adedi gerçek partilere dağıtın. Bilinmeyen
                  veya geçmiş SKT karantinaya alınır. Stok ve maliyet değişmez;
                  sonrasında alışlarda parti/SKT zorunlu olur.
                </p>
                {opening.map((x, i) => (
                  <div key={i} className="mi-lot-opening">
                    <label>
                      Parti kodu
                      <input
                        aria-label={`Açılış parti kodu ${i + 1}`}
                        required
                        maxLength={100}
                        value={x.code}
                        onChange={e =>
                          setOpening(xs =>
                            xs.map((l, j) =>
                              i === j ? { ...l, code: e.target.value } : l
                            )
                          )
                        }
                      />
                    </label>
                    <label>
                      SKT · bilinmiyorsa boş
                      <input
                        aria-label={`Açılış SKT ${i + 1}`}
                        type="date"
                        value={x.expiryDate}
                        onChange={e =>
                          setOpening(xs =>
                            xs.map((l, j) =>
                              i === j ? { ...l, expiryDate: e.target.value } : l
                            )
                          )
                        }
                      />
                    </label>
                    <label>
                      Parti adedi
                      <input
                        aria-label={`Açılış parti adedi ${i + 1}`}
                        type="number"
                        min={1}
                        step={1}
                        required
                        value={x.quantity}
                        onChange={e =>
                          setOpening(xs =>
                            xs.map((l, j) =>
                              i === j ? { ...l, quantity: e.target.value } : l
                            )
                          )
                        }
                      />
                    </label>
                    <button
                      type="button"
                      className="btn"
                      onClick={() =>
                        setOpening(xs => xs.filter((_, j) => i !== j))
                      }
                    >
                      Kaldır
                    </button>
                  </div>
                ))}
                {p.quantity > 0 && (
                  <button
                    type="button"
                    className="btn"
                    disabled={opening.length >= 50}
                    onClick={() =>
                      setOpening([
                        ...opening,
                        { code: "", expiryDate: "", quantity: "1" },
                      ])
                    }
                  >
                    <Plus size={16} />
                    Parti satırı ekle
                  </button>
                )}
              </>
            )}
            {modal.kind === "STATUS" && (
              <>
                <label>
                  Gerçek parti kodu
                  <input
                    name="code"
                    required
                    maxLength={100}
                    defaultValue={l!.code}
                  />
                </label>
                <label>
                  Etiketteki SKT
                  <input
                    name="expiry"
                    type="date"
                    defaultValue={l!.expiryDate ?? ""}
                  />
                </label>
                <label>
                  Parti durumu
                  <select
                    aria-label="Parti durumu"
                    name="status"
                    defaultValue={l!.status}
                  >
                    <option value="QUARANTINE">
                      Karantina · satışa kapalı
                    </option>
                    <option value="AVAILABLE">
                      Kontrol edildi · satışa açık
                    </option>
                  </select>
                </label>
                <label className="ma-check">
                  <input name="inspection" type="checkbox" required />
                  Gerçek etiketi ve fizikî ürün uygunluğunu kontrol ettim.
                </label>
                <p className="ma-hint">
                  Yeni tarih üretmeyin; yalnız doğruladığınız gerçek etiket
                  bilgisini girin. İşlem önceki/sonraki değerlerle kaydedilir.
                  Geçmiş SKT satışa açılamaz.
                </p>
              </>
            )}
            {(modal.kind === "COUNT" || modal.kind === "WRITE_OFF") && (
              <>
                <p className="ma-hint">
                  Parti stoğu {l!.quantity} · Ürün toplamı {p.quantity} · Net
                  stok maliyeti {money(p.valueMinor)}.
                </p>
                <label>
                  {modal.kind === "COUNT"
                    ? "Fizikî sayılan parti adedi"
                    : "Fireye ayrılan adet"}
                  <input
                    aria-label="Parti işlem adedi"
                    inputMode="numeric"
                    required
                    value={quantity}
                    onChange={e => setQuantity(e.target.value)}
                  />
                </label>
                {modal.kind === "COUNT" && Number(quantity) > l!.quantity && (
                  <>
                    <label>
                      Fazla stok net birim maliyeti (TL)
                      <input
                        aria-label="Parti fazlası birim maliyet"
                        inputMode="decimal"
                        value={unit}
                        required
                        onChange={e => setUnit(e.target.value)}
                      />
                    </label>
                    <label className="ma-check">
                      <input name="zero" type="checkbox" />
                      Varsa sıfır maliyetli fazlalığı teyit ediyorum.
                    </label>
                  </>
                )}
                <div className="notice">
                  İşlenecek net stok maliyeti: {money(amount)}
                </div>
                <p className="ma-hint">
                  Fire/sayım eksiği gider, fazlalık stok fazlası hesabına
                  işlenir. Banka veya tedarikçi borcu bu işlemle değişmez.
                </p>
              </>
            )}
            <label>
              İşlem açıklaması
              <textarea name="reason" required minLength={5} maxLength={500} />
            </label>
            {(error || previewError) && (
              <p role="alert" className="ma-error">
                {error || previewError}
              </p>
            )}
            <div className="ma-dialog-actions">
              <button type="button" className="btn" onClick={close}>
                Kapat
              </button>
              <button className="btn primary" disabled={!!previewError}>
                {modal.kind === "ENABLE"
                  ? "Parti eşleştirmesini onayla"
                  : modal.kind === "WRITE_OFF"
                    ? "Fireyi kaydet"
                    : "Parti işlemini kaydet"}
              </button>
            </div>
          </fieldset>
        </form>
      </DialogContent>
    </Dialog>
  );
}

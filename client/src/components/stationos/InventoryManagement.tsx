import { useEffect, useRef, useState, type FormEvent } from "react";
import { Search, Plus, FileDown, RefreshCw, Smartphone } from "lucide-react";
import type {
  InventoryItem,
  InventoryState,
  PriceList,
  InventoryMovements,
} from "@shared/inventory";
import type { MarketAccountingState } from "@shared/market-accounting";
import { money, parseMoney } from "@shared/station";
import { loadInventory, loadInventoryMovements } from "@/lib/station-api";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { marketCsv } from "./MarketStatement";
type ProductModal = {
  [K in "profile" | "barcode" | "price" | "movements"]: {
    kind: K;
    product: InventoryItem;
  };
}["profile" | "barcode" | "price" | "movements"];
type Modal = ProductModal | { kind: "list"; list?: PriceList };
const creditLabels = {
  NO_SUPPLIER: "Tedarikçi seçilmeli",
  VAT_MISSING: "Alış KDV eksik",
  CREDIT_BLOCKED: "Tahmini brüt tutara limit yetersiz",
  REVIEW: "Belge fiyatı/limit teyidi",
};
export function InventoryManagement({
  stationId,
  ledger,
  locked,
  canCreate,
  onCreate,
  onBasePrice,
  action,
}: {
  stationId: string;
  ledger: MarketAccountingState;
  locked: boolean;
  canCreate: boolean;
  onCreate: () => void;
  onBasePrice: (id: string) => void;
  action: (path: string, payload: Record<string, unknown>) => Promise<boolean>;
}) {
  const [data, setData] = useState<InventoryState | null>(null),
    [query, setQuery] = useState(""),
    [filter, setFilter] = useState("ALL"),
    [category, setCategory] = useState(""),
    [modal, setModal] = useState<Modal | null>(null),
    [error, setError] = useState("");
  const sequence = useRef(0);
  async function refresh() {
    const seq = ++sequence.current;
    try {
      const result = await loadInventory(stationId);
      if (seq === sequence.current) {
        setData(result);
        setError("");
      }
    } catch (e) {
      if (seq === sequence.current) setError((e as Error).message);
    }
  }
  useEffect(() => {
    void refresh();
    return () => {
      sequence.current++;
    };
  }, [stationId, ledger.revision, ledger.stock]);
  const filtered =
    data?.items.filter(
      p =>
        `${p.name} ${p.barcode} ${p.brand} ${p.shelf} ${p.catalogCode ?? ""}`
          .toLocaleLowerCase("tr")
          .includes(query.toLocaleLowerCase("tr")) &&
        (!category || p.category === category) &&
        (filter === "ALL" ||
          (filter === "CRITICAL" && p.critical) ||
          (filter === "ZERO" && p.quantity === 0) ||
          (filter === "STAGNANT" && p.stagnant))
    ) ?? [];
  async function save(path: string, payload: Record<string, unknown>) {
    const ok = await action("/market-accounting/inventory/" + path, payload);
    if (ok) await refresh();
    return ok;
  }
  return (
    <>
      <section className="ma-panel">
        <div className="ma-panel-head">
          <div>
            <h2>Stok kontrol ve ürün kartları</h2>
            <p>
              Raf, barkod, paket, fiyat listesi, minimum–maksimum stok ve
              tedarik planı.
            </p>
          </div>
          <div className="ma-row-actions">
            <a className="btn" href="/el-terminali">
              <Smartphone size={16} />
              El terminali
            </a>
            <button className="btn" onClick={() => void refresh()}>
              <RefreshCw size={16} />
              Yenile
            </button>
            {canCreate && (
              <button
                className="btn primary"
                disabled={locked}
                onClick={onCreate}
              >
                <Plus size={16} />
                Yeni ürün
              </button>
            )}
          </div>
        </div>
        {error && (
          <p role="alert" className="ma-error">
            {error}
          </p>
        )}
        {!data && <p>Stok yönetimi yükleniyor…</p>}
        {data && (
          <>
            <div className="ma-wallet-grid">
              <div>
                <span>Ürün kartı</span>
                <strong>{data.items.length}</strong>
              </div>
              <div>
                <span>Kritik stok</span>
                <strong>{data.items.filter(p => p.critical).length}</strong>
              </div>
              <div>
                <span>Stoku sıfır</span>
                <strong>
                  {data.items.filter(p => p.quantity === 0).length}
                </strong>
              </div>
              <div>
                <span>28 günlük kayıtta satışı olmayan</span>
                <strong>{data.items.filter(p => p.stagnant).length}</strong>
              </div>
            </div>
            <div className="ma-form-grid">
              <label>
                Ürün / barkod / raf ara
                <input
                  aria-label="Detaylı stok ara"
                  value={query}
                  onChange={e => setQuery(e.target.value)}
                />
              </label>
              <label>
                Stok filtresi
                <select
                  aria-label="Stok durumu filtresi"
                  value={filter}
                  onChange={e => setFilter(e.target.value)}
                >
                  <option value="ALL">Tüm ürünler</option>
                  <option value="CRITICAL">Kritik stok</option>
                  <option value="ZERO">Stok yok</option>
                  <option value="STAGNANT">Durgun stok</option>
                </select>
              </label>
              <label>
                Kategori
                <select
                  aria-label="Stok kategori filtresi"
                  value={category}
                  onChange={e => setCategory(e.target.value)}
                >
                  <option value="">Tüm kategoriler</option>
                  {[...new Set(data.items.map(p => p.category).filter(Boolean))]
                    .sort()
                    .map(c => (
                      <option key={c}>{c}</option>
                    ))}
                </select>
              </label>
            </div>
            <div className="ma-table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Ürün / Raf</th>
                    <th>Stok</th>
                    <th>Min / Maks</th>
                    <th>28 gün net satış</th>
                    <th>Yetecek gün</th>
                    <th>Alım önerisi</th>
                    <th>Stok değeri</th>
                    <th>Satış / KDV</th>
                    <th>İşlem</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.slice(0, 100).map(p => (
                    <tr key={p.id}>
                      <td>
                        <b>{p.name}</b>
                        {p.catalogCode && (
                          <small>Stok kodu: {p.catalogCode}</small>
                        )}
                        <small>
                          {p.barcode} · {p.category || "Kategorisiz"}
                        </small>
                        <small>
                          {p.brand} · {p.shelf || "Raf tanımsız"}
                        </small>
                        {p.critical && (
                          <span className="ma-warn-badge">Kritik stok</span>
                        )}
                      </td>
                      <td>
                        {p.quantity} {p.unit}
                        <small>Onaylı açık sipariş: {p.onOrderQty}</small>
                        {p.lotTracking && (
                          <small>
                            Satılabilir {p.saleableQty} · Kapalı {p.blockedQty}
                          </small>
                        )}
                      </td>
                      <td>
                        {p.minimumQty} / {p.maximumQty || "Otomatik"}
                      </td>
                      <td>{p.sold28}</td>
                      <td>
                        {p.coverDays === null
                          ? "Satış yok"
                          : p.coverDays.toFixed(1)}
                      </td>
                      <td>
                        <b>
                          {p.suggestedQty} {p.unit}
                        </b>
                        <small>{p.supplierName ?? "Tedarikçi seçilmedi"}</small>
                        <small>
                          {p.estimatedGrossMinor === null
                            ? "Brüt tutar hesaplanamadı"
                            : `Tahmini ${money(p.estimatedGrossMinor)}`}
                        </small>
                        <small>{creditLabels[p.creditStatus]}</small>
                      </td>
                      <td>
                        {money(p.valueMinor)}
                        <small>Ort. {money(p.averageCostMinor)}</small>
                      </td>
                      <td>
                        {money(p.salePriceMinor)}
                        <small>
                          {p.vatBps === null
                            ? "KDV tanımlanmalı"
                            : `%${p.vatBps / 100}`}
                        </small>
                      </td>
                      <td>
                        <div className="ma-row-actions mi-row-actions">
                          <button
                            className="btn"
                            disabled={locked}
                            onClick={() =>
                              setModal({ kind: "profile", product: p })
                            }
                          >
                            Kart / Planlama
                          </button>
                          <button
                            className="btn"
                            disabled={locked}
                            onClick={() =>
                              setModal({ kind: "barcode", product: p })
                            }
                          >
                            Barkodlar
                          </button>
                          <button
                            className="btn"
                            disabled={locked}
                            onClick={() => onBasePrice(p.id)}
                          >
                            Fiyat / KDV
                          </button>
                          <button
                            className="btn"
                            disabled={locked}
                            onClick={() =>
                              setModal({ kind: "price", product: p })
                            }
                          >
                            Liste fiyatı
                          </button>
                          <button
                            className="btn"
                            onClick={() =>
                              setModal({ kind: "movements", product: p })
                            }
                          >
                            Hareketler
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="ma-row-actions">
              <small>
                İlk 100 eşleşme gösterilir; CSV tüm {filtered.length} eşleşmeyi
                içerir.
              </small>
              <button
                className="btn"
                onClick={() =>
                  marketCsv("market-stok-onerileri.csv", [
                    [
                      "Ürün",
                      "Barkod",
                      "Kategori",
                      "Raf",
                      "Stok",
                      "Açık onaylı sipariş",
                      "Birim",
                      "Min",
                      "Maks",
                      "28 gün net satış",
                      "Öneri",
                      "Tedarikçi",
                      "Tahmini net TL",
                      "Tahmini brüt TL",
                      "Kontrol",
                    ],
                    ...filtered.map(p => [
                      p.name,
                      p.barcode,
                      p.category,
                      p.shelf,
                      p.quantity,
                      p.onOrderQty,
                      p.unit,
                      p.minimumQty,
                      p.maximumQty,
                      p.sold28,
                      p.suggestedQty,
                      p.supplierName,
                      p.estimatedNetMinor / 100,
                      p.estimatedGrossMinor === null
                        ? null
                        : p.estimatedGrossMinor / 100,
                      creditLabels[p.creditStatus],
                    ]),
                  ])
                }
              >
                <FileDown size={16} />
                Stok / alım önerilerini CSV indir
              </button>
            </div>
            <p className="ma-hint">
              Öneri son 28 günün satış eksi iadelerinden, tedarik + gözden
              geçirme + güvenlik günlerinden ve paket katından hesaplanır. Kredi
              bütçesi tahmini brüt tutarla kontrol edilir; tedarikçiye otomatik
              sipariş gönderilmez. Satış olmayan üründe minimum/maksimum
              değerleri kullanılır.
            </p>
            <div className="ma-panel-head">
              <div>
                <h3>Satış fiyat listeleri</h3>
                <p>
                  Fiyatlar temel birim için KDV dahildir. Kasada seçili liste
                  sunucudan doğrulanır.
                </p>
              </div>
              <button
                className="btn"
                disabled={locked}
                onClick={() => setModal({ kind: "list" })}
              >
                + Fiyat listesi
              </button>
            </div>
            <div className="mi-list-tags">
              {data.priceLists.map(l => (
                <button
                  key={l.id}
                  className="btn"
                  disabled={locked}
                  onClick={() => setModal({ kind: "list", list: l })}
                >
                  {l.name} · {l.active ? "Açık" : "Kapalı"} ·{" "}
                  {l.staffEnabled ? "Kasiyer kullanabilir" : "Yönetici satışı"}
                </button>
              ))}
            </div>
            <details className="ma-journal-entry">
              <summary>Son 100 fiyat değişikliği</summary>
              <div className="ma-table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Tarih</th>
                      <th>Ürün</th>
                      <th>Liste</th>
                      <th>Eski</th>
                      <th>Yeni</th>
                      <th>Kullanıcı</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.priceHistory.map(h => (
                      <tr key={h.id}>
                        <td>{h.createdAt} UTC</td>
                        <td>
                          {data.items.find(p => p.id === h.productId)?.name ??
                            h.productId}
                        </td>
                        <td>{h.listName ?? "Perakende"}</td>
                        <td>
                          {h.oldMinor === null
                            ? "İlk fiyat"
                            : money(h.oldMinor)}
                        </td>
                        <td>{money(h.newMinor)}</td>
                        <td>{h.actorName}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          </>
        )}
      </section>
      {modal &&
        data &&
        (modal.kind === "movements" ? (
          <MovementDialog
            stationId={stationId}
            product={modal.product}
            today={ledger.today}
            close={() => setModal(null)}
          />
        ) : (
          <InventoryDialog
            key={
              modal.kind +
              ("product" in modal
                ? modal.product.id
                : (modal.list?.id ?? "new"))
            }
            modal={modal}
            data={data}
            ledger={ledger}
            locked={locked}
            save={save}
            close={() => setModal(null)}
          />
        ))}
    </>
  );
}
function InventoryDialog({
  modal,
  data,
  ledger,
  locked,
  save,
  close,
}: {
  modal: Exclude<Modal, { kind: "movements" }>;
  data: InventoryState;
  ledger: MarketAccountingState;
  locked: boolean;
  save: (path: string, body: Record<string, unknown>) => Promise<boolean>;
  close: () => void;
}) {
  const [error, setError] = useState(""),
    [list, setList] = useState(data.priceLists[0]?.id ?? "");
  const p = "product" in modal ? modal.product : null;
  const title =
    modal.kind === "profile"
      ? "Ürün kartı ve stok planı"
      : modal.kind === "barcode"
        ? "Çoklu barkod ve koli"
        : modal.kind === "price"
          ? "Liste fiyatı"
          : "Fiyat listesi ayarı";
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");
    const form = e.currentTarget,
      f = new FormData(form);
    try {
      let path = "",
        body: Record<string, unknown> = {};
      if (modal.kind === "profile") {
        path = "product";
        body = {
          productId: p!.id,
          name: f.get("name"),
          category: f.get("category"),
          brand: f.get("brand"),
          unit: f.get("unit"),
          shelf: f.get("shelf"),
          minimumQty: Number(f.get("min")),
          maximumQty: Number(f.get("max")),
          leadDays: Number(f.get("lead")),
          reviewDays: Number(f.get("review")),
          safetyDays: Number(f.get("safety")),
          orderPackQty: Number(f.get("pack")),
          supplierId: f.get("supplier") || null,
          purchaseVatBps:
            String(f.get("vat")).trim() === ""
              ? null
              : Math.round(
                  Number(String(f.get("vat")).replace(",", ".")) * 100
                ),
        };
      } else if (modal.kind === "barcode") {
        path = "barcode";
        body = {
          productId: p!.id,
          barcode: f.get("barcode"),
          label: f.get("label"),
          packQty: Number(f.get("pack")),
        };
      } else if (modal.kind === "price") {
        path = "price";
        body = {
          productId: p!.id,
          listId: list,
          unitPriceMinor: parseMoney(String(f.get("price"))),
        };
      } else {
        path = "price-list";
        body = {
          listId: modal.list?.id,
          name: f.get("name"),
          active: f.get("active") === "on",
          staffEnabled: f.get("staff") === "on",
        };
      }
      if (await save(path, body)) {
        if (modal.kind !== "barcode") close();
        else form.reset();
      }
    } catch (e) {
      setError((e as Error).message);
    }
  }
  const number = (
    label: string,
    name: string,
    value: number,
    min = 0,
    max = 1000000000
  ) => (
    <label>
      {label}
      <input
        name={name}
        type="number"
        required
        min={min}
        max={max}
        step="1"
        defaultValue={value}
      />
    </label>
  );
  return (
    <Dialog
      open
      onOpenChange={open => {
        if (!open && !locked) close();
      }}
    >
      <DialogContent className="ma-dialog">
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription>
          {p?.name ?? "İstasyona özel, temel birim için fiyatlandırma"}
        </DialogDescription>
        <form onSubmit={submit}>
          <fieldset disabled={locked}>
            {modal.kind === "profile" && p && (
              <>
                <div className="ma-form-grid">
                  <label>
                    Ürün adı
                    <input
                      name="name"
                      defaultValue={p.name}
                      required
                      maxLength={190}
                    />
                  </label>
                  <label>
                    Kategori
                    <input
                      name="category"
                      defaultValue={p.category}
                      maxLength={100}
                    />
                  </label>
                  <label>
                    Marka
                    <input
                      name="brand"
                      defaultValue={p.brand}
                      maxLength={100}
                    />
                  </label>
                  <label>
                    Temel birim
                    <input
                      name="unit"
                      defaultValue={p.unit}
                      required
                      maxLength={32}
                    />
                  </label>
                  <label>
                    Raf / Konum
                    <input
                      name="shelf"
                      defaultValue={p.shelf}
                      maxLength={100}
                    />
                  </label>
                  <label>
                    Market tedarikçisi
                    <select
                      name="supplier"
                      aria-label="Ürün market tedarikçisi"
                      defaultValue={p.supplierId ?? ""}
                    >
                      <option value="">Seçilmedi</option>
                      {ledger.parties
                        .filter(s => s.kind !== "CUSTOMER")
                        .map(s => (
                          <option key={s.id} value={s.id}>
                            {s.name}
                          </option>
                        ))}
                    </select>
                  </label>
                  {number("Minimum stok", "min", p.minimumQty)}
                  {number("Maksimum stok · 0 = otomatik", "max", p.maximumQty)}
                  {number("Tedarik süresi · gün", "lead", p.leadDays, 0, 365)}
                  {number(
                    "Gözden geçirme aralığı · gün",
                    "review",
                    p.reviewDays,
                    1,
                    365
                  )}
                  {number(
                    "Güvenlik stoğu · gün",
                    "safety",
                    p.safetyDays,
                    0,
                    365
                  )}
                  {number("Alım paket katı", "pack", p.orderPackQty, 1, 10000)}
                  <label>
                    Alış KDV (%) · bilinmiyorsa boş
                    <input
                      name="vat"
                      inputMode="decimal"
                      pattern="[0-9]{1,3}([.,][0-9]{1,2})?"
                      defaultValue={
                        p.purchaseVatBps === null
                          ? ""
                          : String(p.purchaseVatBps / 100)
                      }
                    />
                  </label>
                </div>
                <p className="ma-hint">
                  Temel birim miktarları tamsayıdır. Kg/litre için kesirli
                  tartım bu sürümde uygulanmaz. Maksimum stok, minimumun altında
                  olamaz.
                </p>
              </>
            )}
            {modal.kind === "barcode" && p && (
              <>
                <div className="ma-table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Barkod</th>
                        <th>Temel birim adedi</th>
                        <th>Etiket</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {data.barcodes
                        .filter(b => b.productId === p.id)
                        .map(b => (
                          <tr key={b.barcode}>
                            <td>{b.barcode}</td>
                            <td>{b.packQty}</td>
                            <td>{b.label}</td>
                            <td>
                              <button
                                type="button"
                                className="btn"
                                disabled={locked || b.barcode === p.barcode}
                                onClick={() =>
                                  void save("barcode-remove", {
                                    barcode: b.barcode,
                                  })
                                }
                              >
                                Kaldır
                              </button>
                            </td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
                <label>
                  Yeni barkod
                  <input name="barcode" required maxLength={190} />
                </label>
                {number(
                  "Bir okutmadaki temel birim adedi",
                  "pack",
                  1,
                  1,
                  10000
                )}
                <label>
                  Barkod etiketi
                  <input
                    name="label"
                    maxLength={100}
                    placeholder="Örn. 12'li koli"
                  />
                </label>
                <p className="ma-hint">
                  Ana barkod 1 temel birimdir; koli barkodu ayrı olmalıdır. Aynı
                  barkod başka ürüne verilemez.
                </p>
              </>
            )}
            {modal.kind === "price" && p && (
              <>
                <label>
                  Fiyat listesi
                  <select
                    aria-label="Ürün fiyat listesi"
                    value={list}
                    onChange={e => setList(e.target.value)}
                    required
                  >
                    <option value="">Liste seçin</option>
                    {data.priceLists.map(l => (
                      <option key={l.id} value={l.id}>
                        {l.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label key={list}>
                  Temel birim KDV dahil fiyat (TL)
                  <input
                    name="price"
                    inputMode="decimal"
                    required
                    defaultValue={(
                      (data.prices.find(
                        v => v.productId === p.id && v.listId === list
                      )?.unitPriceMinor ?? p.salePriceMinor) / 100
                    )
                      .toFixed(2)
                      .replace(".", ",")}
                  />
                </label>
                <p className="ma-hint">
                  Perakende fiyatı Fiyat / KDV düğmesinden değiştirilir. Paket
                  okutulunca bu birim fiyat, temel birim adediyle çarpılır.
                </p>
              </>
            )}
            {modal.kind === "list" && (
              <>
                <label>
                  Liste adı
                  <input
                    name="name"
                    required
                    maxLength={100}
                    defaultValue={modal.list?.name}
                    placeholder="Örn. Toptan, Personel, Üye"
                  />
                </label>
                <label className="ma-check">
                  <input
                    type="checkbox"
                    name="active"
                    defaultChecked={modal.list?.active ?? true}
                  />
                  Liste satışa açık
                </label>
                <label className="ma-check">
                  <input
                    type="checkbox"
                    name="staff"
                    defaultChecked={modal.list?.staffEnabled ?? false}
                  />
                  Kasiyer bu listeyi seçebilir
                </label>
              </>
            )}
            {error && (
              <p role="alert" className="ma-error">
                {error}
              </p>
            )}
            <div className="ma-dialog-actions">
              <button
                type="button"
                className="btn"
                disabled={locked}
                onClick={close}
              >
                Kapat
              </button>
              <button className="btn primary" disabled={locked}>
                Kaydet
              </button>
            </div>
          </fieldset>
        </form>
      </DialogContent>
    </Dialog>
  );
}
function MovementDialog({
  stationId,
  product,
  today,
  close,
}: {
  stationId: string;
  product: InventoryItem;
  today: string;
  close: () => void;
}) {
  const [from, setFrom] = useState(today.slice(0, 7) + "-01"),
    [to, setTo] = useState(today),
    [cursors, setCursors] = useState([""]),
    [data, setData] = useState<InventoryMovements | null>(null),
    [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    void loadInventoryMovements(stationId, product.id, from, to, cursors.at(-1))
      .then(r => {
        if (active) {
          setData(r);
          setError("");
        }
      })
      .catch(e => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [stationId, product.id, from, to, cursors]);
  const labels: Record<string, string> = {
    RECEIPT: "Mal kabul",
    SALE: "Satış",
    ADJUSTMENT: "Sayım / Düzeltme",
    SALE_RETURN: "Satış iadesi",
    PURCHASE_RETURN: "Alış iadesi",
  };
  return (
    <Dialog
      open
      onOpenChange={open => {
        if (!open) close();
      }}
    >
      <DialogContent className="ma-dialog">
        <DialogTitle>Stok hareketleri · {product.name}</DialogTitle>
        <DialogDescription>
          Kayıtlı hareketlere göre dönem bakiyesi; tarihler Türkiye saatine göre
          filtrelenir.
        </DialogDescription>
        <div className="ma-form-grid">
          <label>
            Başlangıç
            <input
              type="date"
              value={from}
              onChange={e => {
                if (e.target.value) {
                  setFrom(e.target.value);
                  setCursors([""]);
                }
              }}
            />
          </label>
          <label>
            Bitiş
            <input
              type="date"
              value={to}
              onChange={e => {
                if (e.target.value) {
                  setTo(e.target.value);
                  setCursors([""]);
                }
              }}
            />
          </label>
        </div>
        {error && <p role="alert">{error}</p>}
        {data && (
          <>
            <p>
              Dönem başı {data.openingQty} · Dönem sonu {data.closingQty} ·
              Güncel {data.currentQty} {product.unit}
            </p>
            <div className="ma-table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Tarih</th>
                    <th>İşlem</th>
                    <th>Adet</th>
                    <th>Referans</th>
                    <th>Kullanıcı</th>
                  </tr>
                </thead>
                <tbody>
                  {data.rows.map(r => (
                    <tr key={r.id}>
                      <td>
                        {new Date(
                          r.date.replace(" ", "T") + "Z"
                        ).toLocaleString("tr-TR", {
                          timeZone: "Europe/Istanbul",
                        })}
                      </td>
                      <td>{labels[r.kind] ?? r.kind}</td>
                      <td>
                        {r.quantity > 0 ? "+" : ""}
                        {r.quantity}
                      </td>
                      <td>{r.reference}</td>
                      <td>{r.actorName}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="ma-row-actions">
              <button
                className="btn"
                disabled={cursors.length < 2}
                onClick={() => setCursors(c => c.slice(0, -1))}
              >
                Önceki
              </button>
              <button
                className="btn"
                disabled={!data.nextCursor}
                onClick={() => setCursors(c => [...c, data.nextCursor!])}
              >
                Sonraki
              </button>
              <button
                className="btn"
                onClick={() =>
                  marketCsv("stok-hareketleri.csv", [
                    [
                      "Tarih UTC",
                      "İşlem",
                      "Temel birim miktarı",
                      "Referans",
                      "Kullanıcı",
                    ],
                    ...data.rows.map(r => [
                      r.date,
                      labels[r.kind] ?? r.kind,
                      r.quantity,
                      r.reference,
                      r.actorName,
                    ]),
                  ])
                }
              >
                Bu sayfayı CSV indir
              </button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

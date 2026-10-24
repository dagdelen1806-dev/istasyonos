import { useEffect, useRef, useState } from "react";
import { Plus, RefreshCw, FileDown } from "lucide-react";
import { money, amountInput, parseMoney } from "@shared/station";
import type { InventoryState } from "@shared/inventory";
import type { MarketAccountingState } from "@shared/market-accounting";
import {
  orderStatusLabels,
  orderTotals,
  type OrderDetail,
  type OrderPage,
  type OrderLine,
} from "@shared/purchase-order";
import {
  loadPurchaseOrders,
  loadPurchaseOrder,
  loadInventory,
} from "@/lib/station-api";
import { newRequestId } from "@/lib/id";
import { marketCsv } from "./MarketStatement";
import {
  LotReceiptFields,
  receiptLots,
  receiptLotPayload,
  type ReceiptLotInput,
} from "./LotReceiptFields";
type EditLine = {
  productId: string;
  quantity: string;
  cost: string;
  vat: string;
};
type Editor = {
  id: string;
  existing: boolean;
  mode: "DRAFT" | "REPRICE";
  version: number;
  party: string;
  label: string;
  date: string;
  reason: string;
  lines: EditLine[];
};
const plusDays = (date: string, days: number) => {
  const d = new Date(date + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};
const percent = (v: string) => {
  const b = parseMoney(v);
  if (b > 10000) throw Error("KDV %0–100 arası olmalı.");
  return b;
};
const units = (v: string) => {
  if (
    !/^\d+$/.test(v) ||
    !Number.isSafeInteger(Number(v)) ||
    Number(v) > 1000000000
  )
    throw Error("Adet tam sayı ve en fazla 1 milyar olmalı.");
  return Number(v);
};
const editLines = (lines: OrderLine[]) =>
  lines.map(l => ({
    productId: l.productId,
    quantity: String(l.orderedQty - l.receivedQty),
    cost: amountInput(l.unitNetMinor),
    vat: amountInput(l.vatBps),
  }));
export function PurchaseOrders({
  stationId,
  ledger,
  locked,
  canApprove,
  action,
}: {
  stationId: string;
  ledger: MarketAccountingState;
  locked: boolean;
  canApprove: boolean;
  action: (path: string, body: Record<string, unknown>) => Promise<boolean>;
}) {
  const [page, setPage] = useState<OrderPage | null>(null),
    [inventory, setInventory] = useState<InventoryState | null>(null),
    [filter, setFilter] = useState("OPEN"),
    [stack, setStack] = useState([""]),
    [selected, setSelected] = useState(""),
    [detail, setDetail] = useState<OrderDetail | null>(null),
    [editor, setEditor] = useState<Editor | null>(null),
    [receiving, setReceiving] = useState(false),
    [loading, setLoading] = useState(false),
    [error, setError] = useState(""),
    [reason, setReason] = useState("");
  const sequence = useRef(0),
    selectedRef = useRef(selected);
  selectedRef.current = selected;
  const cursor = stack.at(-1)!;
  async function refresh(id = selectedRef.current) {
    const seq = ++sequence.current;
    setLoading(true);
    setError("");
    try {
      const [list, inv, order] = await Promise.all([
        loadPurchaseOrders(stationId, filter, cursor),
        loadInventory(stationId),
        id ? loadPurchaseOrder(stationId, id) : Promise.resolve(null),
      ]);
      if (seq === sequence.current) {
        setPage(list);
        setInventory(inv);
        setDetail(order);
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
  }, [stationId, filter, cursor, ledger.revision]);
  async function select(id: string) {
    setSelected(id);
    selectedRef.current = id;
    setEditor(null);
    setReceiving(false);
    setReason("");
    setDetail(null);
    await refresh(id);
  }
  async function run(
    path: string,
    body: Record<string, unknown>,
    id = selectedRef.current
  ) {
    const ok = await action("/market-accounting/inventory/" + path, body);
    if (ok) {
      setSelected(id);
      selectedRef.current = id;
      setEditor(null);
      setReceiving(false);
      setReason("");
    }
    await refresh(ok ? id : selectedRef.current);
    return ok;
  }
  function create() {
    setEditor({
      id: newRequestId(),
      existing: false,
      mode: "DRAFT",
      version: 0,
      party: "",
      label: "Market tedarik siparişi",
      date: ledger.today,
      reason: "",
      lines: [],
    });
    setReceiving(false);
  }
  const disabled = locked || loading;
  return (
    <section className="ma-panel">
      <div className="ma-panel-head">
        <div>
          <h2>Satın alma siparişleri</h2>
          <p>Kritik stoktan tedarik planına, onaydan kısmi teslimata.</p>
        </div>
        <div className="ma-row-actions">
          <button
            className="btn"
            disabled={disabled}
            onClick={() => void refresh()}
          >
            <RefreshCw size={16} />
            Siparişleri yenile
          </button>
          <button
            className="btn primary"
            disabled={disabled || !inventory}
            onClick={create}
          >
            <Plus size={16} />
            Yeni sipariş taslağı
          </button>
        </div>
      </div>
      <p className="notice">
        Sipariş ve onay stok, cari borç veya KDV kaydı oluşturmaz; kredi
        ayırmaz. Teslim alınan miktar, onaylı fiyat ve gerçek belgeyle mal kabul
        edilir.
      </p>
      {error && (
        <p role="alert" className="ma-error">
          {error}
        </p>
      )}
      {loading && <p role="status">Siparişler yükleniyor…</p>}
      <label>
        Sipariş durumu
        <select
          aria-label="Sipariş durum filtresi"
          value={filter}
          disabled={locked}
          onChange={e => {
            setFilter(e.target.value);
            setStack([""]);
            setPage(null);
          }}
        >
          <option value="OPEN">Açık siparişler</option>
          <option value="ALL">Bütün siparişler</option>
          {Object.entries(orderStatusLabels).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
      </label>
      {page && (
        <>
          <div className="ma-table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Sipariş / tedarikçi</th>
                  <th>Beklenen teslim / durum</th>
                  <th>Adet sipariş / teslim</th>
                  <th>Teslim edilmemiş plan</th>
                  <th>İşlem</th>
                </tr>
              </thead>
              <tbody>
                {page.rows.map(o => (
                  <tr key={o.id}>
                    <td>
                      <b>
                        #{o.number} · {o.label}
                      </b>
                      <small>{o.supplierName}</small>
                    </td>
                    <td>
                      {o.expectedDate}
                      <small className={o.overdue ? "ma-error" : ""}>
                        {orderStatusLabels[o.status]}
                        {o.overdue ? " · Teslim tarihi geçti" : ""}
                      </small>
                    </td>
                    <td>
                      {o.orderedQty} / {o.receivedQty}
                    </td>
                    <td>
                      {o.remainingQty} adet
                      <small>{money(o.remainingGrossMinor)}</small>
                    </td>
                    <td>
                      <button
                        className="btn"
                        disabled={disabled}
                        onClick={() => void select(o.id)}
                      >
                        Siparişi aç
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!page.rows.length && <p>Bu filtrede sipariş yok.</p>}
          <div className="ma-row-actions">
            <button
              className="btn"
              disabled={disabled || stack.length < 2}
              onClick={() => setStack(stack.slice(0, -1))}
            >
              Önceki sipariş sayfası
            </button>
            <span>Sayfa {stack.length} · En fazla 50 kayıt</span>
            <button
              className="btn"
              disabled={disabled || !page.nextCursor}
              onClick={() => setStack([...stack, page.nextCursor!])}
            >
              Sonraki sipariş sayfası
            </button>
          </div>
        </>
      )}
      {editor && inventory && (
        <OrderEditor
          key={editor.id + editor.mode}
          editor={editor}
          setEditor={setEditor}
          inventory={inventory}
          ledger={ledger}
          locked={disabled}
          stale={
            !!editor.existing &&
            detail?.id === editor.id &&
            detail.version !== editor.version
          }
          save={async values => {
            if (editor.mode === "REPRICE") {
              await run(
                "order-reprice",
                {
                  orderId: editor.id,
                  orderVersion: editor.version,
                  expectedDate: editor.date,
                  reason: editor.reason,
                  lines: values.map(l => ({
                    productId: l.productId,
                    unitNetMinor: l.unitNetMinor,
                    vatBps: l.vatBps,
                  })),
                  expectedTotalMinor: orderTotals(values).grossMinor,
                },
                editor.id
              );
            } else
              await run(
                "order-save",
                {
                  ...(editor.existing
                    ? { orderId: editor.id, orderVersion: editor.version }
                    : { newOrderId: editor.id }),
                  supplierId: editor.party,
                  label: editor.label,
                  expectedDate: editor.date,
                  lines: values,
                },
                editor.id
              );
          }}
        />
      )}
      {detail && (
        <section className="ma-panel" aria-label="Seçilen sipariş">
          <h3>
            Sipariş #{detail.number} · {detail.label}
          </h3>
          <p>
            {detail.supplierName} · {orderStatusLabels[detail.status]} · Sürüm{" "}
            {detail.version}
            <br />
            Beklenen teslim: {detail.expectedDate}
            <br />
            Oluşturan: {detail.createdBy} · İlk onay:{" "}
            {detail.approvedBy ?? "Henüz onaylanmadı"}
          </p>
          <button
            className="btn"
            onClick={() =>
              marketCsv(`siparis-${detail.number}.csv`, [
                [
                  "Sipariş no",
                  "Tedarikçi",
                  "Ürün",
                  "Barkod",
                  "Birim",
                  "Sipariş adedi",
                  "Teslim alınan",
                  "Teslim edilmemiş",
                  "Kalan için net TL",
                  "Kalan için KDV %",
                  "Durum",
                ],
                ...detail.lines.map(l => [
                  detail.number,
                  detail.supplierName,
                  l.name,
                  l.barcode,
                  l.unit,
                  l.orderedQty,
                  l.receivedQty,
                  l.remainingQty,
                  l.unitNetMinor / 100,
                  l.vatBps / 100,
                  orderStatusLabels[detail.status],
                ]),
              ])
            }
          >
            <FileDown size={16} />
            Sipariş CSV indir
          </button>
          <div className="ma-table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Ürün</th>
                  <th>Sipariş / teslim / kalan</th>
                  <th>Kalan için fiyat / KDV</th>
                </tr>
              </thead>
              <tbody>
                {detail.lines.map(l => (
                  <tr key={l.productId}>
                    <td>
                      {l.name}
                      <small>
                        {l.barcode} · {l.unit}
                        {l.lotTracking ? " · Lot/SKT takipli" : ""}
                      </small>
                    </td>
                    <td>
                      {l.orderedQty} / {l.receivedQty} / {l.remainingQty}
                    </td>
                    <td>
                      {money(l.unitNetMinor)} · %{l.vatBps / 100}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!editor && !receiving && (
            <div className="ma-row-actions">
              {detail.status === "DRAFT" && (
                <button
                  className="btn"
                  disabled={disabled}
                  onClick={() =>
                    setEditor({
                      id: detail.id,
                      existing: true,
                      mode: "DRAFT",
                      version: detail.version,
                      party: detail.supplierId,
                      label: detail.label,
                      date: detail.expectedDate,
                      reason: "",
                      lines: editLines(detail.lines),
                    })
                  }
                >
                  Taslağı düzenle
                </button>
              )}
              {["APPROVED", "PARTIAL"].includes(detail.status) && (
                <>
                  <button
                    className="btn primary"
                    disabled={disabled || ledger.closedToday}
                    onClick={() => setReceiving(true)}
                  >
                    Teslimat kaydet
                  </button>
                  {canApprove && (
                    <button
                      className="btn"
                      disabled={disabled}
                      onClick={() =>
                        setEditor({
                          id: detail.id,
                          existing: true,
                          mode: "REPRICE",
                          version: detail.version,
                          party: detail.supplierId,
                          label: detail.label,
                          date: detail.expectedDate,
                          reason: "",
                          lines: editLines(
                            detail.lines.filter(l => l.remainingQty > 0)
                          ),
                        })
                      }
                    >
                      Kalan fiyatı / tarihi revize et
                    </button>
                  )}
                </>
              )}
            </div>
          )}
          {ledger.closedToday && (
            <p className="notice warning">
              Gün sonu kapalı: sipariş planlama/onay sürebilir; mal kabul
              yapılamaz.
            </p>
          )}
          {canApprove &&
            !editor &&
            !receiving &&
            ["DRAFT", "APPROVED", "PARTIAL"].includes(detail.status) && (
              <form
                onSubmit={e => {
                  e.preventDefault();
                  const submit = (e.nativeEvent as SubmitEvent)
                    .submitter as HTMLButtonElement;
                  void run(
                    submit.value === "approve"
                      ? "order-approve"
                      : "order-close",
                    {
                      orderId: detail.id,
                      orderVersion: detail.version,
                      reason,
                      ...(submit.value === "approve"
                        ? {
                            expectedTotalMinor: orderTotals(
                              detail.lines.map(l => ({
                                quantity: l.orderedQty,
                                unitNetMinor: l.unitNetMinor,
                                vatBps: l.vatBps,
                              }))
                            ).grossMinor,
                          }
                        : {}),
                    }
                  );
                }}
              >
                <fieldset disabled={disabled}>
                  <label>
                    Yönetici işlem açıklaması
                    <input
                      aria-label="Sipariş yönetici açıklaması"
                      value={reason}
                      onChange={e => setReason(e.target.value)}
                      minLength={5}
                      maxLength={500}
                      required
                    />
                  </label>
                  <div className="ma-row-actions">
                    {detail.status === "DRAFT" && (
                      <button
                        className="btn primary"
                        name="operation"
                        value="approve"
                      >
                        Siparişi onayla
                      </button>
                    )}
                    <button className="btn" name="operation" value="close">
                      {detail.status === "PARTIAL"
                        ? "Kalan siparişi kapat"
                        : "Siparişi iptal et"}
                    </button>
                  </div>
                </fieldset>
              </form>
            )}
          {receiving && (
            <OrderReceipt
              key={detail.id + ":" + detail.version}
              order={detail}
              ledger={ledger}
              locked={disabled}
              cancel={() => setReceiving(false)}
              receive={body =>
                run("order-receive", {
                  orderId: detail.id,
                  orderVersion: detail.version,
                  expectedRevision: ledger.revision,
                  ...body,
                })
              }
            />
          )}
          <h3>Teslimat geçmişi · {detail.receiptCount} kayıt</h3>
          <p className="ma-hint">
            Son 100 teslimat gösterilir. Bunlar gerçek mal kabul belgeleridir;
            alış iadeleri siparişi kendiliğinden yeniden açmaz.
          </p>
          <div className="ma-table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Belge / UTC</th>
                  <th>Alan / onaylı sürüm</th>
                  <th>Gerçek brüt tutar</th>
                  <th>Ürünler</th>
                </tr>
              </thead>
              <tbody>
                {detail.receipts.map(r => (
                  <tr key={r.purchaseId}>
                    <td>
                      {r.reference}
                      <small>
                        {r.createdAt} · Vade {r.dueDate}
                      </small>
                    </td>
                    <td>
                      {r.receivedBy}
                      <small>Sipariş sürümü {r.approvedVersion}</small>
                    </td>
                    <td>{money(r.totalMinor)}</td>
                    <td>
                      {r.items.map(l => (
                        <p key={l.productId}>
                          {l.name}: {l.quantity} × {money(l.unitNetMinor)} + %
                          {l.vatBps / 100}
                        </p>
                      ))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <details>
            <summary>Son 100 sipariş işlemi</summary>
            {detail.events.map(e => (
              <p key={e.id}>
                <b>
                  {(
                    {
                      CREATE: "Taslak açıldı",
                      EDIT: "Taslak değişti",
                      APPROVE: "Onaylandı",
                      REPRICE: "Kalan plan revizyonu",
                      RECEIVE: "Teslimat",
                      CLOSE: "Kapatıldı",
                    } as Record<string, string>
                  )[e.kind] ?? e.kind}
                </b>{" "}
                · {e.actorName} · UTC {e.createdAt}
                <small>{e.reason}</small>
              </p>
            ))}
          </details>
        </section>
      )}
    </section>
  );
}
function OrderEditor({
  editor: e,
  setEditor,
  inventory,
  ledger,
  locked,
  stale,
  save,
}: {
  editor: Editor;
  setEditor: (e: Editor | null) => void;
  inventory: InventoryState;
  ledger: MarketAccountingState;
  locked: boolean;
  stale: boolean;
  save: (
    lines: {
      productId: string;
      quantity: number;
      unitNetMinor: number;
      vatBps: number;
    }[]
  ) => Promise<void>;
}) {
  const [pick, setPick] = useState(""),
    [error, setError] = useState("");
  const update = (id: string, k: keyof EditLine, v: string) =>
    setEditor({
      ...e,
      lines: e.lines.map(l => (l.productId === id ? { ...l, [k]: v } : l)),
    });
  const values = () =>
    e.lines.map(l => ({
      productId: l.productId,
      quantity: units(l.quantity),
      unitNetMinor: parseMoney(l.cost),
      vatBps: percent(l.vat),
    }));
  let estimate = "Fiyat ve KDV tamamlanmalı";
  try {
    estimate = money(orderTotals(values()).grossMinor);
  } catch {}
  function add(ids: string[]) {
    const selected = inventory.items.filter(
      p => ids.includes(p.id) && !e.lines.some(l => l.productId === p.id)
    );
    setEditor({
      ...e,
      lines: [
        ...e.lines,
        ...selected.map(p => ({
          productId: p.id,
          quantity: String(p.suggestedQty || 1),
          cost: amountInput(p.lastPurchaseMinor ?? p.averageCostMinor),
          vat: p.purchaseVatBps === null ? "" : amountInput(p.purchaseVatBps),
        })),
      ].slice(0, 100),
    });
  }
  const supplier = ledger.parties.find(p => p.id === e.party);
  return (
    <form
      className="ma-panel"
      aria-label="Sipariş planı"
      onSubmit={async event => {
        event.preventDefault();
        setError("");
        try {
          const ls = values();
          if (!ls.length || ls.some(l => l.quantity < 1))
            throw Error("En az bir ürün ve pozitif adet gerekir.");
          await save(ls);
        } catch (err) {
          setError((err as Error).message);
        }
      }}
    >
      <h3>
        {e.mode === "REPRICE"
          ? "Kalan fiyat ve teslim tarihi revizyonu"
          : e.existing
            ? "Sipariş taslağını düzenle"
            : "Yeni sipariş taslağı"}
      </h3>
      {(error || stale) && (
        <p role="alert" className="ma-error">
          {error ||
            "Sipariş değişti. Düzenlemeyi kapatıp güncel siparişi yeniden açın."}
        </p>
      )}
      <fieldset disabled={locked || stale}>
        <div className="ma-form-grid">
          <label>
            Tedarikçi
            <select
              aria-label="Sipariş tedarikçisi"
              value={e.party}
              required
              disabled={e.mode === "REPRICE"}
              onChange={ev => {
                setEditor({ ...e, party: ev.target.value, lines: [] });
                setPick("");
              }}
            >
              <option value="">Tedarikçi seçin</option>
              {ledger.parties
                .filter(p => p.kind === "SUPPLIER" || p.kind === "BOTH")
                .map(p => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
            </select>
          </label>
          <label>
            Sipariş adı
            <input
              aria-label="Sipariş adı"
              value={e.label}
              disabled={e.mode === "REPRICE"}
              onChange={ev => setEditor({ ...e, label: ev.target.value })}
              required
              maxLength={100}
            />
          </label>
          <label>
            Beklenen teslim
            <input
              aria-label="Beklenen sipariş teslimi"
              type="date"
              value={e.date}
              onChange={ev => setEditor({ ...e, date: ev.target.value })}
              required
            />
          </label>
        </div>
        {supplier && (
          <p className="ma-hint">
            Mevcut cari borç {money(supplier.payableMinor)} · Limit{" "}
            {supplier.payableLimitMinor === null
              ? "Sınırsız"
              : money(supplier.payableLimitMinor)}
            . Sipariş onayı kredi ayırmaz; gerçek kabulde limit kontrol edilir.
          </p>
        )}
        {e.mode === "DRAFT" && (
          <>
            <div className="ma-row-actions">
              <label>
                Ürün seç
                <select
                  aria-label="Siparişe eklenecek ürün"
                  value={pick}
                  onChange={ev => setPick(ev.target.value)}
                >
                  <option value="">Ürün seçin</option>
                  {inventory.items
                    .filter(p => !e.lines.some(l => l.productId === p.id))
                    .map(p => (
                      <option key={p.id} value={p.id}>
                        {p.name} · {p.barcode}
                      </option>
                    ))}
                </select>
              </label>
              <button
                type="button"
                className="btn"
                disabled={!pick || e.lines.length >= 100}
                onClick={() => {
                  add([pick]);
                  setPick("");
                }}
              >
                Ürünü siparişe ekle
              </button>
              <button
                type="button"
                className="btn"
                disabled={!e.party || e.lines.length >= 100}
                onClick={() =>
                  add(
                    inventory.items
                      .filter(
                        p =>
                          p.supplierId === e.party &&
                          p.critical &&
                          p.suggestedQty > 0
                      )
                      .map(p => p.id)
                  )
                }
              >
                Tedarikçinin kritik stoklarını ekle
              </button>
            </div>
            <p className="ma-hint">
              Öneriler mevcut satılabilir stok ve onaylı açık siparişleri
              dikkate alır; koli katına yuvarlanır. En fazla 100 ürün, miktarlar
              temel birimdedir. KDV'si bilinmeyen ürün için oranı girin. Aynı
              ihtiyacı elle tekrar eklemeden açık siparişleri kontrol edin.
            </p>
          </>
        )}
        <div className="mi-posting-lines">
          {e.lines.map(l => {
            const p = inventory.items.find(p => p.id === l.productId);
            return (
              <div key={l.productId}>
                <span>
                  <b>{p?.name ?? l.productId}</b>
                  <small>
                    {p?.barcode} · Açık sipariş {p?.onOrderQty ?? 0}
                  </small>
                </span>
                <label>
                  {e.mode === "REPRICE"
                    ? "Teslim edilmemiş adet"
                    : "Sipariş temel adedi"}
                  <input
                    aria-label={`${p?.name} sipariş adedi`}
                    type="number"
                    min={1}
                    max={1000000000}
                    value={l.quantity}
                    required
                    disabled={e.mode === "REPRICE"}
                    onChange={ev =>
                      update(l.productId, "quantity", ev.target.value)
                    }
                  />
                </label>
                <label>
                  KDV hariç birim fiyat
                  <input
                    aria-label={`${p?.name} sipariş net fiyat`}
                    inputMode="decimal"
                    value={l.cost}
                    required
                    onChange={ev =>
                      update(l.productId, "cost", ev.target.value)
                    }
                  />
                </label>
                <label>
                  Alış KDV %
                  <input
                    aria-label={`${p?.name} sipariş KDV`}
                    inputMode="decimal"
                    value={l.vat}
                    required
                    onChange={ev => update(l.productId, "vat", ev.target.value)}
                  />
                </label>
                {e.mode === "DRAFT" && (
                  <button
                    type="button"
                    className="btn"
                    onClick={() =>
                      setEditor({
                        ...e,
                        lines: e.lines.filter(x => x.productId !== l.productId),
                      })
                    }
                  >
                    Satırı kaldır
                  </button>
                )}
              </div>
            );
          })}
        </div>
        {e.mode === "REPRICE" && (
          <label>
            Revizyon açıklaması
            <input
              aria-label="Sipariş fiyat revizyon açıklaması"
              required
              minLength={5}
              maxLength={500}
              value={e.reason}
              onChange={ev => setEditor({ ...e, reason: ev.target.value })}
            />
          </label>
        )}
        <p className="notice">
          {e.mode === "REPRICE" ? "Kalan plan" : "Sipariş planı"} · KDV dahil{" "}
          {estimate}. Önceki teslimat bedelleri değişmez; gerçek belgelerin
          yuvarlaması farklı olabilir.
        </p>
        <button className="btn primary" disabled={!e.lines.length}>
          {e.mode === "REPRICE"
            ? "Kalan plan revizyonunu onayla"
            : "Sipariş taslağını kaydet"}
        </button>
      </fieldset>
      <button
        className="btn"
        type="button"
        disabled={locked}
        onClick={() => setEditor(null)}
      >
        Düzenlemeyi kapat
      </button>
    </form>
  );
}
function OrderReceipt({
  order,
  ledger,
  locked,
  cancel,
  receive,
}: {
  order: OrderDetail;
  ledger: MarketAccountingState;
  locked: boolean;
  cancel: () => void;
  receive: (body: Record<string, unknown>) => Promise<boolean>;
}) {
  const [qty, setQty] = useState<Record<string, string>>({}),
    [lots, setLots] = useState<Record<string, ReceiptLotInput[]>>({}),
    [error, setError] = useState("");
  const pending = order.lines.filter(l => l.remainingQty > 0),
    party = ledger.parties.find(p => p.id === order.supplierId);
  let estimated = "Adetleri tamamlayın";
  try {
    estimated = money(
      orderTotals(
        pending.map(l => ({
          quantity: units(qty[l.productId] || "0"),
          unitNetMinor: l.unitNetMinor,
          vatBps: l.vatBps,
        }))
      ).grossMinor
    );
  } catch {}
  return (
    <form
      className="ma-panel"
      aria-label="Sipariş teslimatı"
      onSubmit={async e => {
        e.preventDefault();
        setError("");
        try {
          const f = new FormData(e.currentTarget),
            lines = pending
              .map(l => ({ line: l, quantity: units(qty[l.productId] || "0") }))
              .filter(x => x.quantity > 0)
              .map(({ line: l, quantity }) => {
                if (quantity > l.remainingQty || quantity > 10000)
                  throw Error(
                    "Teslimat kalan adedi veya 10.000 sınırını aşıyor."
                  );
                return {
                  productId: l.productId,
                  quantity,
                  unitNetMinor: l.unitNetMinor,
                  vatBps: l.vatBps,
                  ...(l.lotTracking
                    ? {
                        lots: receiptLotPayload(
                          lots[l.productId] ?? receiptLots(String(quantity)),
                          quantity
                        ),
                      }
                    : {}),
                };
              });
          if (!lines.length) throw Error("En az bir teslim alınan ürün girin.");
          await receive({
            reference: String(f.get("reference")),
            dueDate: String(f.get("due")),
            lines,
            expectedTotalMinor: orderTotals(lines).grossMinor,
            deliveryAccepted: f.get("accepted") === "on",
          });
        } catch (err) {
          setError((err as Error).message);
        }
      }}
    >
      <h3>Onaylı siparişten mal kabul</h3>
      <p>
        Yalnız fiilen gelen adetleri girin. Fatura fiyatı/KDV farklıysa yönetici
        önce kalan planı revize etmelidir.
      </p>
      {error && (
        <p role="alert" className="ma-error">
          {error}
        </p>
      )}
      <fieldset disabled={locked || ledger.closedToday}>
        <div className="ma-form-grid">
          <label>
            Alış belge no
            <input
              name="reference"
              aria-label="Sipariş teslimat belge no"
              required
              maxLength={100}
            />
          </label>
          <label>
            Ödeme vadesi
            <input
              name="due"
              aria-label="Sipariş teslimat vadesi"
              type="date"
              defaultValue={plusDays(ledger.today, party?.termDays ?? 0)}
              required
            />
          </label>
        </div>
        <button
          type="button"
          className="btn"
          onClick={() =>
            setQty(
              Object.fromEntries(
                pending.map(l => [
                  l.productId,
                  String(Math.min(l.remainingQty, 10000)),
                ])
              )
            )
          }
        >
          Kalan adetleri doldur
        </button>
        {pending.map(l => (
          <div className="notice" key={l.productId}>
            <b>{l.name}</b>
            <p>
              Kalan {l.remainingQty} {l.unit} · Onaylı net fiyat{" "}
              {money(l.unitNetMinor)} + %{l.vatBps / 100}
            </p>
            <label>
              Teslim alınan temel adet
              <input
                aria-label={`${l.name} teslim alınan adet`}
                type="number"
                min={0}
                max={Math.min(l.remainingQty, 10000)}
                step={1}
                value={qty[l.productId] ?? ""}
                onChange={ev =>
                  setQty({ ...qty, [l.productId]: ev.target.value })
                }
              />
            </label>
            {l.lotTracking && Number(qty[l.productId]) > 0 && (
              <LotReceiptFields
                prefix={l.name}
                today={ledger.today}
                quantity={Number(qty[l.productId])}
                value={lots[l.productId] ?? receiptLots(qty[l.productId])}
                onChange={value => setLots({ ...lots, [l.productId]: value })}
              />
            )}
          </div>
        ))}
        <label className="ma-check">
          <input name="accepted" type="checkbox" required />
          Teslim alınan gerçek adetleri ve belgeyi kontrol ettim.
        </label>
        <p className="notice">
          Bu kabul · KDV dahil {estimated}. Stok/net maliyet, alış KDV ve cari
          borç birlikte işlenecek.
        </p>
        <button className="btn primary">Sipariş mal kabulünü işle</button>
      </fieldset>
      <button type="button" className="btn" disabled={locked} onClick={cancel}>
        Teslimat formunu kapat
      </button>
    </form>
  );
}

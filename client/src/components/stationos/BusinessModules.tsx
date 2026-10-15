import { useMemo, useState, type FormEvent } from "react";
import {
  ArrowDownToLine,
  ArrowUpRight,
  Banknote,
  Barcode,
  CalendarDays,
  CheckCircle2,
  CircleDollarSign,
  Download,
  FileText,
  Landmark,
  Package,
  Plus,
  Receipt,
  Search,
  ShoppingCart,
  Store,
  Truck,
  UserRound,
  UsersRound,
  WalletCards,
} from "lucide-react";
import type {
  AppRole,
  AppState,
  Debtor,
  PaymentKind,
  Payable,
  Product,
  Recommendation,
  Supplier,
} from "../../../../shared/station";
import { money, parseMoney } from "../../../../shared/station";
import {
  Badge,
  Empty,
  Field,
  fmtDate,
  formObject,
  Metric,
  Modal,
  MoneyInput,
  Notice,
  Panel,
  SubmitButton,
} from "./Common";
import "./business.css";

type BusinessView = "market" | "purchase" | "receivables" | "finance";

type BusinessModulesProps = {
  view: BusinessView;
  state: AppState;
  stationId: string;
  busy: boolean;
  onAction: (
    path: string,
    payload: Record<string, unknown>
  ) => Promise<boolean>;
};

const MANAGEMENT_ROLES: AppRole[] = ["OWNER", "MANAGER"];
const PROCUREMENT_ROLES: AppRole[] = ["OWNER", "MANAGER", "PURCHASER"];
const STOCK_SALE_ROLES: AppRole[] = ["OWNER", "MANAGER", "MARKET_STAFF"];
const COLLECTION_ROLES: AppRole[] = ["OWNER", "ACCOUNTANT"];
const DEBTOR_ROLES: AppRole[] = [
  "OWNER",
  "MANAGER",
  "ACCOUNTANT",
  "FUEL_STAFF",
  "MARKET_STAFF",
];
const PAYABLE_ROLES: AppRole[] = ["OWNER", "ACCOUNTANT", "PURCHASER"];

const viewMeta: Record<
  BusinessView,
  { eyebrow: string; title: string; description: string; icon: typeof Store }
> = {
  market: {
    eyebrow: "01 · MARKET",
    title: "Market operasyonu",
    description:
      "Ürün, adet stok ve mal kabul hareketlerini kaynaktan izleyin.",
    icon: Store,
  },
  purchase: {
    eyebrow: "02 · SATIN ALMA",
    title: "Satın alma ve toptancı cari",
    description:
      "Gerçek tedarikçi bakiyeleri, vadeler ve hesaplanmış öneriler.",
    icon: Truck,
  },
  receivables: {
    eyebrow: "03 · CARİ",
    title: "Alacaklar ve tahsilat",
    description: "Kişi/kurum borç defterini cirodan ayrı yönetin.",
    icon: UsersRound,
  },
  finance: {
    eyebrow: "04 · FİNANS",
    title: "Operasyonel finans",
    description: "Vadesi gelen yükümlülükler ve gerçek hesap hareketleri.",
    icon: Landmark,
  },
};

function requestId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function")
    return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function numberText(
  value: number | null | undefined,
  maximumFractionDigits = 0
) {
  if (value == null || !Number.isFinite(value)) return "—";
  return new Intl.NumberFormat("tr-TR", { maximumFractionDigits }).format(
    value
  );
}

function positiveInteger(raw: string, label: string, allowZero = false) {
  const value = raw.trim();
  const expression = allowZero ? /^(?:0|[1-9]\d*)$/ : /^[1-9]\d*$/;
  if (!expression.test(value))
    throw new Error(`${label} tam sayı olarak girilmeli.`);
  const number = Number(value);
  if (!Number.isSafeInteger(number) || (!allowZero && number < 1))
    throw new Error(`${label} geçerli bir tam sayı olmalı.`);
  return number;
}

function roleAllowed(role: AppRole | undefined, roles: AppRole[]) {
  return Boolean(role && roles.includes(role));
}

function ActionNote({ error, success }: { error?: string; success?: string }) {
  if (!error && !success) return null;
  return (
    <p className={`action-note ${error ? "error" : "success"}`} role="status">
      {error || success}
    </p>
  );
}

function StationMutationNotice({ hasStation }: { hasStation: boolean }) {
  if (hasStation) return null;
  return (
    <Notice warning>
      Bir istasyon seçmeden kayıt değişikliği yapılamaz. Bu görünüm yetkili tüm
      kayıtları sadece okuma amacıyla gösterir.
    </Notice>
  );
}

async function executeMutation(
  stationId: string,
  onAction: BusinessModulesProps["onAction"],
  path: string,
  payload: Record<string, unknown>,
  setError: (message: string) => void
) {
  if (!stationId.trim()) {
    setError("Önce tek bir istasyon seçin.");
    return false;
  }
  setError("");
  try {
    const ok = await onAction(path, { requestId: requestId(), ...payload });
    if (!ok)
      setError(
        "İşlem kaydedilemedi. Alanları koruduk; sunucu mesajını kontrol edin."
      );
    return ok;
  } catch (error) {
    setError(
      error instanceof Error
        ? error.message
        : "İşlem sırasında beklenmeyen bir hata oluştu."
    );
    return false;
  }
}

function EmptyAction({
  onClick,
  children,
}: {
  onClick?: () => void;
  children: React.ReactNode;
}) {
  if (!onClick) return null;
  return (
    <button className="btn secondary" type="button" onClick={onClick}>
      <Plus size={16} />
      {children}
    </button>
  );
}

function ProductModal({
  open,
  close,
  state,
  stationId,
  busy,
  onAction,
}: {
  open: boolean;
  close: () => void;
  state: AppState;
  stationId: string;
  busy: boolean;
  onAction: BusinessModulesProps["onAction"];
}) {
  const [name, setName] = useState("");
  const [barcode, setBarcode] = useState("");
  const [minimumQty, setMinimumQty] = useState("0");
  const [supplierId, setSupplierId] = useState("");
  const [error, setError] = useState("");

  if (!open) return null;

  const reset = () => {
    setName("");
    setBarcode("");
    setMinimumQty("0");
    setSupplierId("");
    setError("");
  };
  const handleClose = () => {
    reset();
    close();
  };
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const values = formObject(event.currentTarget);
    try {
      const minimum = positiveInteger(
        values.minimumQty || "0",
        "Minimum stok",
        true
      );
      const purchasePriceMinor = parseMoney(values.purchasePrice);
      const salePriceMinor = parseMoney(values.salePrice);
      const ok = await executeMutation(
        stationId,
        onAction,
        "/product",
        {
          stationId,
          name: values.name.trim(),
          barcode: values.barcode.trim(),
          minimumQty: minimum,
          purchasePriceMinor,
          salePriceMinor,
          ...(values.supplierId ? { supplierId: values.supplierId } : {}),
        },
        setError
      );
      if (ok) {
        reset();
        close();
      }
    } catch (mutationError) {
      setError(
        mutationError instanceof Error
          ? mutationError.message
          : "Ürün bilgilerini kontrol edin."
      );
    }
  };

  return (
    <Modal
      title="Yeni ürün"
      subtitle="Satın alma ve satış fiyatları gerçek ürün kaydı olarak saklanır."
      close={handleClose}
    >
      <form className="business-form" onSubmit={submit}>
        <div className="form-grid two">
          <Field label="Ürün adı">
            <input
              value={name}
              onChange={event => setName(event.target.value)}
              name="name"
              required
              maxLength={160}
              autoFocus
            />
          </Field>
          <Field label="Barkod">
            <input
              value={barcode}
              onChange={event => setBarcode(event.target.value)}
              name="barcode"
              required
              maxLength={80}
              inputMode="numeric"
            />
          </Field>
          <Field label="Minimum stok" hint="Adet">
            <input
              value={minimumQty}
              onChange={event => setMinimumQty(event.target.value)}
              name="minimumQty"
              type="number"
              min="0"
              step="1"
              required
            />
          </Field>
          <Field label="Toptancı" hint="İsteğe bağlı">
            <select
              value={supplierId}
              onChange={event => setSupplierId(event.target.value)}
              name="supplierId"
            >
              <option value="">Eşleştirme yok</option>
              {state.suppliers.map(supplier => (
                <option key={supplier.id} value={supplier.id}>
                  {supplier.name}
                </option>
              ))}
            </select>
          </Field>
          <Field
            label="Gerçek alış fiyatı"
            hint="Kuruş olarak sunucuya gönderilir"
          >
            <MoneyInput name="purchasePrice" />
          </Field>
          <Field
            label="Gerçek satış fiyatı"
            hint="KDV/ÖKC entegrasyonu iddiası yoktur"
          >
            <MoneyInput name="salePrice" />
          </Field>
        </div>
        <ActionNote error={error} />
        <div className="form-actions">
          <button className="btn ghost" type="button" onClick={handleClose}>
            Vazgeç
          </button>
          <SubmitButton busy={busy}>Ürünü kaydet</SubmitButton>
        </div>
      </form>
    </Modal>
  );
}

function StockMovementModal({
  product,
  kind,
  close,
  stationId,
  busy,
  onAction,
}: {
  product: Product | null;
  kind: "RECEIPT" | "SALE";
  close: () => void;
  stationId: string;
  busy: boolean;
  onAction: BusinessModulesProps["onAction"];
}) {
  const [quantity, setQuantity] = useState("1");
  const [reference, setReference] = useState("");
  const [error, setError] = useState("");
  if (!product) return null;
  const reset = () => {
    setQuantity("1");
    setReference("");
    setError("");
  };
  const handleClose = () => {
    reset();
    close();
  };
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const values = formObject(event.currentTarget);
    try {
      const parsedQuantity = positiveInteger(values.quantity, "Miktar");
      if (!values.reference.trim())
        throw new Error("Hareket referansı/notu zorunlu.");
      const ok = await executeMutation(
        stationId,
        onAction,
        "/stock",
        {
          stationId,
          productId: product.id,
          quantity: parsedQuantity,
          kind,
          reference: values.reference.trim(),
        },
        setError
      );
      if (ok) {
        reset();
        close();
      }
    } catch (mutationError) {
      setError(
        mutationError instanceof Error
          ? mutationError.message
          : "Stok hareketini kontrol edin."
      );
    }
  };
  const isReceipt = kind === "RECEIPT";
  return (
    <Modal
      title={isReceipt ? "Mal kabul" : "Market satış stoku"}
      subtitle={`${product.name} · mevcut adet ${numberText(product.stockQty)}`}
      close={handleClose}
    >
      <form className="business-form" onSubmit={submit}>
        <div className="movement-summary">
          <Package size={18} />
          <div>
            <strong>{product.name}</strong>
            <span>Barkod: {product.barcode || "—"}</span>
          </div>
          <Badge status={isReceipt ? "PENDING" : "ACTIVE"} />
        </div>
        <div className="form-grid two">
          <Field label="Miktar" hint="Pozitif tam sayı">
            <input
              value={quantity}
              onChange={event => setQuantity(event.target.value)}
              name="quantity"
              type="number"
              min="1"
              step="1"
              required
              autoFocus
            />
          </Field>
          <Field
            label={
              isReceipt ? "Mal kabul referansı / not" : "Satış referansı / not"
            }
            hint={
              isReceipt
                ? "Fatura eşleştirme otomatik değildir; e-fatura bağlantısı yok."
                : "Adet satış; yakıt hesabına yazılmaz."
            }
          >
            <input
              value={reference}
              onChange={event => setReference(event.target.value)}
              name="reference"
              required
              maxLength={240}
            />
          </Field>
        </div>
        <ActionNote error={error} />
        <div className="form-actions">
          <button className="btn ghost" type="button" onClick={handleClose}>
            Vazgeç
          </button>
          <SubmitButton busy={busy}>
            {isReceipt ? "Mal kabulü kaydet" : "Satışı kaydet"}
          </SubmitButton>
        </div>
      </form>
    </Modal>
  );
}

function MarketView({
  state,
  stationId,
  busy,
  onAction,
  role,
}: Omit<BusinessModulesProps, "view"> & { role?: AppRole }) {
  const [query, setQuery] = useState("");
  const [productOpen, setProductOpen] = useState(false);
  const [movement, setMovement] = useState<{
    product: Product;
    kind: "RECEIPT" | "SALE";
  } | null>(null);
  const hasStation = Boolean(stationId.trim());
  const scopedProducts = useMemo(
    () =>
      state.products.filter(
        product => !hasStation || product.stationId === stationId
      ),
    [hasStation, stationId, state.products]
  );
  const products = useMemo(
    () =>
      scopedProducts.filter(product => {
        const normalized = query.trim().toLocaleLowerCase("tr-TR");
        return (
          !normalized ||
          `${product.name} ${product.barcode}`
            .toLocaleLowerCase("tr-TR")
            .includes(normalized)
        );
      }),
    [query, scopedProducts]
  );
  const canProduct = roleAllowed(role, PROCUREMENT_ROLES);
  const canReceipt = roleAllowed(role, PROCUREMENT_ROLES);
  const canSale = roleAllowed(role, STOCK_SALE_ROLES);
  const riskProducts = scopedProducts.filter(
    product => product.stockQty <= 0 || product.stockQty <= product.minimumQty
  );

  return (
    <div className="business-stack">
      <Panel
        title="Stok görünümü"
        subtitle="Gerçek ürün kayıtları · adet bazlı stok."
        action={
          <div className="inline-actions">
            <button
              className="btn secondary"
              type="button"
              onClick={() => setProductOpen(true)}
              disabled={!canProduct || !hasStation}
            >
              <Plus size={16} />
              Yeni ürün
            </button>
          </div>
        }
      >
        <StationMutationNotice hasStation={hasStation} />
        {!canProduct && (
          <Notice warning>
            Ürün ve mal kabul işlemleri yalnız OWNER, MANAGER veya PURCHASER
            rolüne açıktır.
          </Notice>
        )}
        <div className="metric-grid three">
          <Metric
            label="Ürün çeşidi"
            value={numberText(scopedProducts.length)}
            detail="Gerçek ürün kaydı"
            icon={<Package size={17} />}
          />
          <Metric
            label="Stok riski"
            value={numberText(riskProducts.length)}
            detail="Minimum veya tükenmiş"
            icon={<ArrowDownToLine size={17} />}
            tone={riskProducts.length ? "amber" : ""}
          />
          <Metric
            label="Kayıt kapsamı"
            value={hasStation ? "Tek istasyon" : "Salt okunur"}
            detail={hasStation ? "Mutasyonlar açık" : "İstasyon seçin"}
            icon={<Store size={17} />}
          />
        </div>
        <div className="table-toolbar">
          <Field label="Ürün veya barkod ara">
            <div className="search-input">
              <Search size={16} />
              <input
                value={query}
                onChange={event => setQuery(event.target.value)}
                placeholder="Ara..."
              />
            </div>
          </Field>
        </div>
        {scopedProducts.length === 0 ? (
          <Empty
            title="Henüz ürün yok"
            text="İlk gerçek ürün kaydını açarak stok ekranını kullanmaya başlayın."
            action={
              <EmptyAction
                onClick={
                  canProduct && hasStation
                    ? () => setProductOpen(true)
                    : undefined
                }
              >
                Ürün ekle
              </EmptyAction>
            }
          />
        ) : products.length === 0 ? (
          <Empty
            title="Eşleşen ürün yok"
            text="Ürün adı veya barkod aramanızı değiştirin."
          />
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Ürün</th>
                  <th>Barkod</th>
                  <th>Stok</th>
                  <th>Minimum</th>
                  <th>Alış / satış</th>
                  <th>Risk</th>
                  <th aria-label="İşlemler" />
                </tr>
              </thead>
              <tbody>
                {products.map(product => {
                  const risk =
                    product.stockQty <= 0
                      ? "STOCKOUT"
                      : product.stockQty <= product.minimumQty
                        ? "PENDING"
                        : "ACTIVE";
                  return (
                    <tr key={product.id}>
                      <td>
                        <strong>{product.name}</strong>
                      </td>
                      <td className="mono">{product.barcode || "—"}</td>
                      <td className="number-cell">
                        {numberText(product.stockQty)}
                      </td>
                      <td className="number-cell">
                        {numberText(product.minimumQty)}
                      </td>
                      <td className="money-stack">
                        <span>{money(product.purchasePriceMinor)}</span>
                        <small>{money(product.salePriceMinor)}</small>
                      </td>
                      <td>
                        <Badge status={risk} />
                      </td>
                      <td>
                        <div className="row-actions">
                          {canReceipt && (
                            <button
                              className="icon-text-button"
                              type="button"
                              onClick={() =>
                                setMovement({ product, kind: "RECEIPT" })
                              }
                              disabled={!hasStation}
                              title="Mal kabul"
                            >
                              <ArrowDownToLine size={15} />
                              Kabul
                            </button>
                          )}
                          {canSale && (
                            <button
                              className="icon-text-button green"
                              type="button"
                              onClick={() =>
                                setMovement({ product, kind: "SALE" })
                              }
                              disabled={!hasStation}
                              title="Market satış stoku"
                            >
                              <ShoppingCart size={15} />
                              Satış
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <div className="market-footnote">
          <FileText size={15} />
          Mal kabul referansı tutulur; fatura eşleştirme ve e-fatura bağlantısı
          bu sürümde otomatik değildir. Adet satışları yakıt hesabına sessizce
          yazılmaz.
        </div>
      </Panel>
      <ProductModal
        open={productOpen}
        close={() => setProductOpen(false)}
        state={state}
        stationId={stationId}
        busy={busy}
        onAction={onAction}
      />
      <StockMovementModal
        product={movement?.product || null}
        kind={movement?.kind || "RECEIPT"}
        close={() => setMovement(null)}
        stationId={stationId}
        busy={busy}
        onAction={onAction}
      />
    </div>
  );
}

function SupplierModal({
  open,
  close,
  stationId,
  busy,
  onAction,
}: {
  open: boolean;
  close: () => void;
  stationId: string;
  busy: boolean;
  onAction: BusinessModulesProps["onAction"];
}) {
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  if (!open) return null;
  const reset = () => {
    setName("");
    setError("");
  };
  const handleClose = () => {
    reset();
    close();
  };
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const values = formObject(event.currentTarget);
    try {
      if (!values.name.trim()) throw new Error("Toptancı adı zorunlu.");
      const creditLimitMinor = parseMoney(values.creditLimit);
      const ok = await executeMutation(
        stationId,
        onAction,
        "/supplier",
        { stationId, name: values.name.trim(), creditLimitMinor },
        setError
      );
      if (ok) {
        reset();
        close();
      }
    } catch (mutationError) {
      setError(
        mutationError instanceof Error
          ? mutationError.message
          : "Toptancı bilgilerini kontrol edin."
      );
    }
  };
  return (
    <Modal
      title="Yeni toptancı"
      subtitle="Cari limit gerçek bir tedarikçi kaydı olarak tutulur."
      close={handleClose}
    >
      <form className="business-form" onSubmit={submit}>
        <div className="form-grid two">
          <Field label="Toptancı adı">
            <input
              value={name}
              onChange={event => setName(event.target.value)}
              name="name"
              required
              maxLength={160}
              autoFocus
            />
          </Field>
          <Field label="Cari limit">
            <MoneyInput name="creditLimit" />
          </Field>
        </div>
        <ActionNote error={error} />
        <div className="form-actions">
          <button className="btn ghost" type="button" onClick={handleClose}>
            Vazgeç
          </button>
          <SubmitButton busy={busy}>Toptancıyı kaydet</SubmitButton>
        </div>
      </form>
    </Modal>
  );
}

function PayableModal({
  open,
  close,
  state,
  stationId,
  busy,
  onAction,
}: {
  open: boolean;
  close: () => void;
  state: AppState;
  stationId: string;
  busy: boolean;
  onAction: BusinessModulesProps["onAction"];
}) {
  const [supplierId, setSupplierId] = useState(state.suppliers[0]?.id || "");
  const [dueDate, setDueDate] = useState("");
  const [reference, setReference] = useState("");
  const [error, setError] = useState("");
  if (!open) return null;
  const reset = () => {
    setSupplierId(state.suppliers[0]?.id || "");
    setDueDate("");
    setReference("");
    setError("");
  };
  const handleClose = () => {
    reset();
    close();
  };
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const values = formObject(event.currentTarget);
    try {
      if (!values.supplierId) throw new Error("Toptancı seçin.");
      if (!values.dueDate) throw new Error("Vade tarihi zorunlu.");
      const amountMinor = parseMoney(values.amount);
      if (!values.reference.trim()) throw new Error("Belge/referans zorunlu.");
      const ok = await executeMutation(
        stationId,
        onAction,
        "/payable",
        {
          stationId,
          supplierId: values.supplierId,
          amountMinor,
          dueDate: values.dueDate,
          reference: values.reference.trim(),
        },
        setError
      );
      if (ok) {
        reset();
        close();
      }
    } catch (mutationError) {
      setError(
        mutationError instanceof Error
          ? mutationError.message
          : "Borç kaydını kontrol edin."
      );
    }
  };
  return (
    <Modal
      title="Operasyonel borç kaydı"
      subtitle="Bu kayıt banka bakiyesi veya otomatik ödeme oluşturmaz."
      close={handleClose}
    >
      <form className="business-form" onSubmit={submit}>
        <div className="form-grid two">
          <Field label="Toptancı">
            <select
              value={supplierId}
              onChange={event => setSupplierId(event.target.value)}
              name="supplierId"
              required
            >
              <option value="">Seçin</option>
              {state.suppliers.map(supplier => (
                <option key={supplier.id} value={supplier.id}>
                  {supplier.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Borç tutarı">
            <MoneyInput name="amount" />
          </Field>
          <Field label="Vade tarihi">
            <input
              value={dueDate}
              onChange={event => setDueDate(event.target.value)}
              name="dueDate"
              type="date"
              required
            />
          </Field>
          <Field label="Belge / referans">
            <input
              value={reference}
              onChange={event => setReference(event.target.value)}
              name="reference"
              required
              maxLength={240}
            />
          </Field>
        </div>
        <ActionNote error={error} />
        <div className="form-actions">
          <button className="btn ghost" type="button" onClick={handleClose}>
            Vazgeç
          </button>
          <SubmitButton busy={busy}>Borcu kaydet</SubmitButton>
        </div>
      </form>
    </Modal>
  );
}

function csvCell(value: string | number | null | undefined) {
  let text = value == null ? "" : String(value);
  if (/^[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}

function exportRecommendations(rows: Recommendation[]) {
  if (!rows.length) return;
  const header = [
    "Ürün",
    "Toptancı",
    "Günlük ortalama",
    "Mevcut stok",
    "Gün kapsamı",
    "Önerilen adet",
    "Tahmini maliyet TL",
    "Kullanılabilir cari TL",
    "Durum",
  ];
  const lines = rows.map(row =>
    [
      row.productName,
      row.supplierName,
      row.averageDaily,
      row.stockQty,
      row.daysCover,
      row.recommendedQty,
      row.costMinor == null
        ? ""
        : (row.costMinor / 100).toFixed(2).replace(".", ","),
      row.availableCreditMinor == null
        ? ""
        : (row.availableCreditMinor / 100).toFixed(2).replace(".", ","),
      row.status,
    ]
      .map(csvCell)
      .join(";")
  );
  const blob = new Blob(
    [[header.map(csvCell).join(";"), ...lines].join("\r\n")],
    { type: "text/csv;charset=utf-8" }
  );
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `istasyonos-satin-alma-onerileri-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

function PurchaseView({
  state,
  stationId,
  busy,
  onAction,
  role,
}: Omit<BusinessModulesProps, "view"> & { role?: AppRole }) {
  const [supplierOpen, setSupplierOpen] = useState(false);
  const [payableOpen, setPayableOpen] = useState(false);
  const hasStation = Boolean(stationId.trim());
  const canSupplier = roleAllowed(role, ["OWNER", "PURCHASER"]);
  const canReceipt = roleAllowed(role, PROCUREMENT_ROLES);
  const canPayable = roleAllowed(role, PAYABLE_ROLES);
  const totalDueMinor = state.suppliers.reduce(
    (total, supplier) => total + supplier.dueMinor,
    0
  );
  const recommendations = state.recommendations;
  return (
    <div className="business-stack">
      <Panel
        title="Toptancı cari"
        subtitle="Kayıtlı toptancı borçları ve kullanılabilir cari limit."
        action={
          <div className="inline-actions">
            <button
              className="btn secondary"
              type="button"
              onClick={() => setSupplierOpen(true)}
              disabled={!canSupplier || !hasStation}
            >
              <Plus size={16} />
              Toptancı ekle
            </button>
            <button
              className="btn primary"
              type="button"
              onClick={() => setPayableOpen(true)}
              disabled={!canPayable || !hasStation}
            >
              <Receipt size={16} />
              Borç kaydı
            </button>
          </div>
        }
      >
        <StationMutationNotice hasStation={hasStation} />
        {!canSupplier && (
          <Notice warning>
            Toptancı oluşturma OWNER veya PURCHASER rolüne açıktır. Diğer roller
            gerçek cari kayıtlarını okuyabilir.
          </Notice>
        )}
        <div className="metric-grid three">
          <Metric
            label="Toptancı"
            value={numberText(state.suppliers.length)}
            detail="Gerçek tedarikçi sayısı"
            icon={<Truck size={17} />}
          />
          <Metric
            label="Vadesi gelen bakiye"
            value={state.suppliers.length ? money(totalDueMinor) : "—"}
            detail={
              state.suppliers.length
                ? "Kayıtlı vadesi gelen borçlar"
                : "Kayıt yok"
            }
            icon={<CircleDollarSign size={17} />}
            tone={totalDueMinor ? "amber" : ""}
          />
          <Metric
            label="Öneri satırı"
            value={numberText(recommendations.length)}
            detail="Stok ve cari limite göre öneri"
            icon={<ArrowUpRight size={17} />}
          />
        </div>
        {state.suppliers.length === 0 ? (
          <Empty
            title="Toptancı kaydı yok"
            text="Gerçek tedarikçi ve cari limit bilgisi eklenmeden borç kaydı açılamaz."
            action={
              <EmptyAction
                onClick={
                  canSupplier && hasStation
                    ? () => setSupplierOpen(true)
                    : undefined
                }
              >
                Toptancı ekle
              </EmptyAction>
            }
          />
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Toptancı</th>
                  <th>Cari limit</th>
                  <th>Cari bakiye</th>
                  <th>Vadesi gelen</th>
                  <th>Durum</th>
                </tr>
              </thead>
              <tbody>
                {state.suppliers.map(supplier => (
                  <tr key={supplier.id}>
                    <td>
                      <strong>{supplier.name}</strong>
                    </td>
                    <td>{money(supplier.creditLimitMinor)}</td>
                    <td>{money(supplier.balanceMinor)}</td>
                    <td>{money(supplier.dueMinor)}</td>
                    <td>
                      <Badge
                        status={
                          supplier.balanceMinor > supplier.creditLimitMinor
                            ? "CREDIT_BLOCKED"
                            : "ACTIVE"
                        }
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
      <Panel
        title="Satın alma önerileri"
        subtitle="Kural tabanlı hesaplama; otomatik sipariş veya harici servis çağrısı yok."
        action={
          <button
            className="btn secondary"
            type="button"
            onClick={() => exportRecommendations(recommendations)}
            disabled={!recommendations.length}
          >
            <Download size={16} />
            CSV dışa aktar
          </button>
        }
      >
        {!canReceipt && (
          <Notice warning>
            Mal kabulü yalnız OWNER, MANAGER veya PURCHASER rolü kaydedebilir.
            Öneriler mevcut gerçek state üzerinden okunur.
          </Notice>
        )}
        <div className="recommendation-note">
          <CheckCircle2 size={16} />
          CSV yalnız backend tarafından sağlanan yetkili öneri satırlarını
          içerir; formül başlangıçları güvenli biçimde kaçışlanır.
        </div>
        {recommendations.length === 0 ? (
          <Empty
            title="Satın alma önerisi yok"
            text="Backend öneri üretmediği için burada varsayımsal ürün, adet veya tutar gösterilmez."
          />
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Ürün</th>
                  <th>Toptancı</th>
                  <th>Günlük satış</th>
                  <th>Stok / kapsam</th>
                  <th>Önerilen adet</th>
                  <th>Maliyet</th>
                  <th>Cari kullanılabilir</th>
                  <th>Durum</th>
                </tr>
              </thead>
              <tbody>
                {recommendations.map(row => (
                  <tr key={row.productId}>
                    <td>
                      <strong>{row.productName}</strong>
                    </td>
                    <td>{row.supplierName || "—"}</td>
                    <td className="number-cell">
                      {numberText(row.averageDaily, 2)}
                    </td>
                    <td className="number-cell">
                      {numberText(row.stockQty)} /{" "}
                      {numberText(row.daysCover, 1)} gün
                    </td>
                    <td className="number-cell">
                      {numberText(row.recommendedQty)}
                    </td>
                    <td>{money(row.costMinor)}</td>
                    <td>{money(row.availableCreditMinor)}</td>
                    <td>
                      <Badge status={row.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <Notice warning>
          Öneri tablosu stok ve geçmiş gerçek verilerinden hesaplanır. Buradan
          sipariş oluşturulmaz; harici tedarikçi veya banka bağlantısı yoktur.
        </Notice>
      </Panel>
      <SupplierModal
        open={supplierOpen}
        close={() => setSupplierOpen(false)}
        stationId={stationId}
        busy={busy}
        onAction={onAction}
      />
      <PayableModal
        open={payableOpen}
        close={() => setPayableOpen(false)}
        state={state}
        stationId={stationId}
        busy={busy}
        onAction={onAction}
      />
    </div>
  );
}

function DebtorModal({
  open,
  close,
  stationId,
  busy,
  onAction,
}: {
  open: boolean;
  close: () => void;
  stationId: string;
  busy: boolean;
  onAction: BusinessModulesProps["onAction"];
}) {
  const [name, setName] = useState("");
  const [type, setType] = useState<"PERSON" | "COMPANY">("PERSON");
  const [error, setError] = useState("");
  if (!open) return null;
  const reset = () => {
    setName("");
    setType("PERSON");
    setError("");
  };
  const handleClose = () => {
    reset();
    close();
  };
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const values = formObject(event.currentTarget);
    try {
      if (!values.name.trim()) throw new Error("Kişi/kurum adı zorunlu.");
      const debtorType = values.type === "COMPANY" ? "COMPANY" : "PERSON";
      const ok = await executeMutation(
        stationId,
        onAction,
        "/debtor",
        { stationId, name: values.name.trim(), type: debtorType },
        setError
      );
      if (ok) {
        reset();
        close();
      }
    } catch (mutationError) {
      setError(
        mutationError instanceof Error
          ? mutationError.message
          : "Cari kaydını kontrol edin."
      );
    }
  };
  return (
    <Modal
      title="Yeni cari borçlu"
      subtitle="İlk sürümde yalnız minimal kişi/kurum adı tutulur."
      close={handleClose}
    >
      <form className="business-form" onSubmit={submit}>
        <div className="form-grid two">
          <Field label="Kişi / kurum adı">
            <input
              value={name}
              onChange={event => setName(event.target.value)}
              name="name"
              required
              maxLength={160}
              autoFocus
            />
          </Field>
          <Field label="Tür">
            <select
              value={type}
              onChange={event =>
                setType(event.target.value === "COMPANY" ? "COMPANY" : "PERSON")
              }
              name="type"
            >
              <option value="PERSON">Kişi</option>
              <option value="COMPANY">Kurum</option>
            </select>
          </Field>
        </div>
        <ActionNote error={error} />
        <div className="form-actions">
          <button className="btn ghost" type="button" onClick={handleClose}>
            Vazgeç
          </button>
          <SubmitButton busy={busy}>Borçluyu kaydet</SubmitButton>
        </div>
      </form>
    </Modal>
  );
}

function CollectionModal({
  debtor,
  close,
  stationId,
  busy,
  onAction,
}: {
  debtor: Debtor | null;
  close: () => void;
  stationId: string;
  busy: boolean;
  onAction: BusinessModulesProps["onAction"];
}) {
  const [reference, setReference] = useState("");
  const [error, setError] = useState("");
  if (!debtor) return null;
  const reset = () => {
    setReference("");
    setError("");
  };
  const handleClose = () => {
    reset();
    close();
  };
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const values = formObject(event.currentTarget);
    try {
      const amountMinor = parseMoney(values.amount);
      if (!values.reference.trim())
        throw new Error("Tahsilat referansı zorunlu.");
      const ok = await executeMutation(
        stationId,
        onAction,
        "/collection",
        {
          stationId,
          debtorId: debtor.id,
          amountMinor,
          reference: values.reference.trim(),
        },
        setError
      );
      if (ok) {
        reset();
        close();
      }
    } catch (mutationError) {
      setError(
        mutationError instanceof Error
          ? mutationError.message
          : "Tahsilat bilgisini kontrol edin."
      );
    }
  };
  return (
    <Modal
      title="Cari tahsilat"
      subtitle={`${debtor.name} · bakiye ${money(debtor.balanceMinor)}`}
      close={handleClose}
    >
      <form className="business-form" onSubmit={submit}>
        <div className="collection-summary">
          <WalletCards size={18} />
          <div>
            <strong>Eski cari nakit tahsilatı</strong>
            <span>Ciroya eklenmez; borç defterinden düşer.</span>
          </div>
        </div>
        <div className="form-grid two">
          <Field
            label="Tahsilat tutarı"
            hint="Sunucu borç bakiyesini aşan tutarı reddeder"
          >
            <MoneyInput name="amount" />
          </Field>
          <Field label="Referans / makbuz">
            <input
              value={reference}
              onChange={event => setReference(event.target.value)}
              name="reference"
              required
              maxLength={240}
            />
          </Field>
        </div>
        <ActionNote error={error} />
        <div className="form-actions">
          <button className="btn ghost" type="button" onClick={handleClose}>
            Vazgeç
          </button>
          <SubmitButton busy={busy}>Tahsilatı kaydet</SubmitButton>
        </div>
      </form>
    </Modal>
  );
}

function ReceivablesView({
  state,
  stationId,
  busy,
  onAction,
  role,
}: Omit<BusinessModulesProps, "view"> & { role?: AppRole }) {
  const [debtorOpen, setDebtorOpen] = useState(false);
  const [collectionDebtor, setCollectionDebtor] = useState<Debtor | null>(null);
  const hasStation = Boolean(stationId.trim());
  const canCreate = roleAllowed(role, DEBTOR_ROLES);
  const canCollect = roleAllowed(role, COLLECTION_ROLES);
  const hasBalanceAccess = state.debtors.every(
    debtor => debtor.balanceMinor !== null
  );
  const totalBalanceMinor = hasBalanceAccess
    ? state.debtors.reduce(
        (total, debtor) => total + (debtor.balanceMinor ?? 0),
        0
      )
    : null;
  return (
    <div className="business-stack">
      <Panel
        title="Cari borçlular"
        subtitle="Yetkili kişi/kurum borçları; banka ve ciro bakiyesinden ayrı tutulur."
        action={
          <button
            className="btn primary"
            type="button"
            onClick={() => setDebtorOpen(true)}
            disabled={!canCreate || !hasStation}
          >
            <Plus size={16} />
            Yeni borçlu
          </button>
        }
      >
        <StationMutationNotice hasStation={hasStation} />
        {!canCreate && (
          <Notice warning>
            Minimal borçlu kaydı OWNER, MANAGER, ACCOUNTANT veya FUEL_STAFF
            rolüne açıktır. Tahsilat yetkisi ayrı olarak ACCOUNTANT/OWNER
            kapsamındadır.
          </Notice>
        )}
        {!canCollect && (
          <Notice warning>
            Bu rolde cari tahsilatı kaydedemezsiniz; gerçek borç bakiyelerini
            yalnızca okuyabilirsiniz.
          </Notice>
        )}
        <div className="metric-grid three">
          <Metric
            label="Borçlu sayısı"
            value={numberText(state.debtors.length)}
            detail="Gerçek kişi/kurum kaydı"
            icon={<UsersRound size={17} />}
          />
          <Metric
            label="Toplam açık bakiye"
            value={
              state.debtors.length && hasBalanceAccess
                ? money(totalBalanceMinor)
                : "—"
            }
            detail={
              !hasBalanceAccess
                ? "Bakiye için mali erişim gerekir"
                : state.debtors.length
                  ? "Bakiye toplamı"
                  : "Kayıt yok"
            }
            icon={<CircleDollarSign size={17} />}
            tone={totalBalanceMinor ? "amber" : ""}
          />
          <Metric
            label="Tahsilat ilkesi"
            value="Ayrı defter"
            detail="Ciroya eklenmez"
            icon={<WalletCards size={17} />}
          />
        </div>
        {state.debtors.length === 0 ? (
          <Empty
            title="Cari borçlu yok"
            text="Gerçek kişi veya kurum eklenmeden tahsilat formu açılamaz."
            action={
              <EmptyAction
                onClick={
                  canCreate && hasStation
                    ? () => setDebtorOpen(true)
                    : undefined
                }
              >
                Borçlu ekle
              </EmptyAction>
            }
          />
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Borçlu</th>
                  <th>Tür</th>
                  <th>Açık bakiye</th>
                  <th>İşlem</th>
                </tr>
              </thead>
              <tbody>
                {state.debtors.map(debtor => (
                  <tr key={debtor.id}>
                    <td>
                      <div className="person-cell">
                        <span className="avatar">
                          <UserRound size={15} />
                        </span>
                        <strong>{debtor.name}</strong>
                      </div>
                    </td>
                    <td>{debtor.type === "COMPANY" ? "Kurum" : "Kişi"}</td>
                    <td className="amount-emphasis">
                      {money(debtor.balanceMinor)}
                    </td>
                    <td>
                      <button
                        className="icon-text-button green"
                        type="button"
                        disabled={
                          !canCollect ||
                          !hasStation ||
                          debtor.balanceMinor == null ||
                          debtor.balanceMinor <= 0
                        }
                        onClick={() => setCollectionDebtor(debtor)}
                      >
                        <Banknote size={15} />
                        Tahsilat
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <Notice>
          Sunucu, tahsilatı ilgili borçlunun gerçek bakiyesiyle sınırlar. Bu
          modül yeni ciro veya banka bakiyesi üretmez.
        </Notice>
      </Panel>
      <DebtorModal
        open={debtorOpen}
        close={() => setDebtorOpen(false)}
        stationId={stationId}
        busy={busy}
        onAction={onAction}
      />
      <CollectionModal
        debtor={collectionDebtor}
        close={() => setCollectionDebtor(null)}
        stationId={stationId}
        busy={busy}
        onAction={onAction}
      />
    </div>
  );
}

function paymentMethodLabel(kind: PaymentKind) {
  const labels: Record<PaymentKind, string> = {
    CASH: "Nakit satış",
    IBAN: "IBAN satış beyanı",
    DEBT: "Borçlu satış",
    AR_COLLECTION: "Eski cari tahsilatı",
  };
  return labels[kind];
}

function dateAtNoon(value: string) {
  const parsed = new Date(`${value}T12:00:00+03:00`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function FinanceView({
  state,
  stationId,
  busy,
  onAction,
  role,
}: Omit<BusinessModulesProps, "view"> & { role?: AppRole }) {
  const [payableOpen, setPayableOpen] = useState(false);
  const hasStation = Boolean(stationId.trim());
  const canPayable = roleAllowed(role, PAYABLE_ROLES);
  const accountIds = useMemo(
    () =>
      new Set(
        state.accounts
          .filter(account => !hasStation || account.stationId === stationId)
          .map(account => account.id)
      ),
    [hasStation, stationId, state.accounts]
  );
  const payments = useMemo(
    () =>
      state.payments.filter(
        payment =>
          payment.accountId === null || accountIds.has(payment.accountId)
      ),
    [accountIds, state.payments]
  );
  const methods: PaymentKind[] = ["CASH", "IBAN", "DEBT", "AR_COLLECTION"];
  const paymentTotal = (kind: PaymentKind) =>
    payments
      .filter(payment => payment.kind === kind)
      .reduce((total, payment) => total + payment.amountMinor, 0);
  const todayKey = new Date().toLocaleDateString("en-CA", {
    timeZone: "Europe/Istanbul",
  });
  const todayDate = new Date(`${todayKey}T00:00:00+03:00`);
  const upcoming = useMemo(
    () =>
      state.payables
        .map(payable => ({ payable, date: dateAtNoon(payable.dueDate) }))
        .filter(item => item.date && item.payable.status !== "PAID")
        .filter(item => {
          const days = Math.floor(
            (item.date!.getTime() - todayDate.getTime()) / 86400000
          );
          return days >= 0 && days < 7;
        })
        .sort((a, b) => a.date!.getTime() - b.date!.getTime()),
    [state.payables, todayDate.getTime()]
  );
  const maxUpcoming = Math.max(
    ...upcoming.map(item => item.payable.amountMinor),
    0
  );
  return (
    <div className="business-stack">
      <Panel
        title="Operasyonel finans"
        subtitle="Yalnız gerçek hesap hareketleri ve vade kayıtları; kullanılabilir nakit tahmini yapılmaz."
        action={
          <button
            className="btn primary"
            type="button"
            onClick={() => setPayableOpen(true)}
            disabled={!canPayable || !hasStation}
          >
            <Plus size={16} />
            Borç kaydı
          </button>
        }
      >
        <StationMutationNotice hasStation={hasStation} />
        {!canPayable && (
          <Notice warning>
            Payable kaydı OWNER, ACCOUNTANT veya PURCHASER rolüne açıktır. Diğer
            roller finans kayıtlarını okuyabilir.
          </Notice>
        )}
        <div className="metric-grid four">
          <Metric
            label="Banka kullanılabilir"
            value="—"
            detail={
              state.integrationStatus.bank === "ENABLED"
                ? "Banka bakiyesi state'te yok"
                : "Banka bağlantısı yok"
            }
            icon={<Landmark size={17} />}
          />
          <Metric
            label="Nakit kullanılabilir"
            value="—"
            detail="Kasa sayımı bu tahmin değildir"
            icon={<Banknote size={17} />}
          />
          <Metric
            label="Tahmini net kâr"
            value="—"
            detail="Gelir/maliyet dönemi eşleşmesi yok"
            icon={<CircleDollarSign size={17} />}
          />
          <Metric
            label="7 gün vadesi"
            value={
              upcoming.length
                ? money(
                    upcoming.reduce(
                      (sum, item) => sum + item.payable.amountMinor,
                      0
                    )
                  )
                : "—"
            }
            detail={
              upcoming.length
                ? "Kayıtlı vade tutarları"
                : "Yaklaşan gerçek kayıt yok"
            }
            icon={<CalendarDays size={17} />}
            tone={upcoming.length ? "amber" : ""}
          />
        </div>
        <Notice warning>
          Mevcut banka veya kasa bakiyesi henüz tanımlanmadı. Bu nedenle nakit
          akışında sahte bakiye, kâr veya net değer gösterilmez.
        </Notice>
      </Panel>
      <Panel
        title="Hesap hareketleri · yönteme göre"
        subtitle="Account payment kayıtlarından; satış toplamı veya kullanılabilir nakit değildir."
      >
        {payments.length === 0 ? (
          <Empty
            title="Hesap hareketi yok"
            text="Seçili istasyon için gerçek payment kaydı gelmedi; yöntem bazında tutar üretilmedi."
          />
        ) : (
          <div className="payment-method-grid">
            {methods.map(kind => (
              <div className="method-card" key={kind}>
                <span>{paymentMethodLabel(kind)}</span>
                <strong>{money(paymentTotal(kind))}</strong>
                <small>
                  {numberText(
                    payments.filter(payment => payment.kind === kind).length
                  )}{" "}
                  gerçek kayıt
                </small>
              </div>
            ))}
          </div>
        )}
      </Panel>
      <Panel
        title="Yaklaşan ödeme yükü"
        subtitle="Önümüzdeki 7 gün içindeki gerçek vade tutarları. Bu grafik kullanılabilir nakit tahmini değildir."
        action={<span className="panel-index">DUE · 7 GÜN</span>}
      >
        {upcoming.length === 0 ? (
          <Empty
            title="7 günlük gerçek vade yok"
            text="Ödenmemiş ve önümüzdeki 7 gün içinde vadesi olan payable kaydı bulunmuyor."
          />
        ) : (
          <div className="timeline">
            {upcoming.map(({ payable, date }) => (
              <div className="timeline-row" key={payable.id}>
                <div className="timeline-date">
                  <strong>{fmtDate(date!.toISOString(), false)}</strong>
                  <small>{payable.supplierName}</small>
                </div>
                <div className="timeline-track">
                  <span
                    style={{
                      width: `${Math.max(4, Math.round((payable.amountMinor / maxUpcoming) * 100))}%`,
                    }}
                  />
                </div>
                <div className="timeline-amount">
                  {money(payable.amountMinor)}
                  <Badge status={payable.status} />
                </div>
              </div>
            ))}
          </div>
        )}
      </Panel>
      <Panel
        title="Tüm operasyonel payable kayıtları"
        subtitle="Gerçek borç tutarı, tedarikçi ve vade; banka ödeme durumu değildir."
      >
        {state.payables.length === 0 ? (
          <Empty
            title="Payable kaydı yok"
            text="Vade görünümü için backend'den gerçek borç kaydı gelmesi gerekir."
          />
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Toptancı</th>
                  <th>Tutar</th>
                  <th>Vade</th>
                  <th>Durum</th>
                </tr>
              </thead>
              <tbody>
                {state.payables.map(payable => (
                  <tr key={payable.id}>
                    <td>
                      <strong>{payable.supplierName}</strong>
                    </td>
                    <td>{money(payable.amountMinor)}</td>
                    <td>{fmtDate(`${payable.dueDate}T12:00:00`, false)}</td>
                    <td>
                      <Badge status={payable.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
      <PayableModal
        open={payableOpen}
        close={() => setPayableOpen(false)}
        state={state}
        stationId={stationId}
        busy={busy}
        onAction={onAction}
      />
    </div>
  );
}

export function BusinessModules({
  view,
  state,
  stationId,
  busy,
  onAction,
}: BusinessModulesProps) {
  const role = state.member?.role;
  const meta = viewMeta[view];
  const Icon = meta.icon;
  return (
    <div className="business-module">
      <header className="business-header">
        <div>
          <span className="business-eyebrow">{meta.eyebrow}</span>
          <h1>{meta.title}</h1>
          <p>{meta.description}</p>
        </div>
        <div className="business-context">
          <Icon size={18} />
          <span>
            {stationId
              ? state.stations.find(station => station.id === stationId)
                  ?.name || stationId
              : "Tüm yetkili istasyonlar"}
          </span>
          <small>{role || "Üyelik yok"}</small>
        </div>
      </header>
      {view === "market" && (
        <MarketView
          state={state}
          stationId={stationId}
          busy={busy}
          onAction={onAction}
          role={role}
        />
      )}
      {view === "purchase" && (
        <PurchaseView
          state={state}
          stationId={stationId}
          busy={busy}
          onAction={onAction}
          role={role}
        />
      )}
      {view === "receivables" && (
        <ReceivablesView
          state={state}
          stationId={stationId}
          busy={busy}
          onAction={onAction}
          role={role}
        />
      )}
      {view === "finance" && (
        <FinanceView
          state={state}
          stationId={stationId}
          busy={busy}
          onAction={onAction}
          role={role}
        />
      )}
    </div>
  );
}

export default BusinessModules;

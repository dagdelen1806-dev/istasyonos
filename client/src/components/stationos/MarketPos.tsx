import { useEffect, useRef, useState } from "react";
import {
  Barcode,
  Search,
  Pause,
  Play,
  Trash2,
  Star,
  RefreshCw,
  ShoppingBasket,
  Minus,
  Plus,
  Monitor,
  Wallet,
  Clock3,
  History,
} from "lucide-react";
import type { AppState } from "@shared/station";
import type { PosCart, PosCartLine } from "@shared/pos";
import { money, parseMoney } from "@shared/station";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { usePosWorkspace } from "./usePosWorkspace";
import { PosPayment } from "./PosPayment";
import "./pos.css";

const cartTotal = (c: PosCart) =>
  c.lines.reduce((n, l) => n + l.quantity * l.expectedUnitPriceMinor, 0);
const time = (date: string) =>
  new Intl.DateTimeFormat("tr-TR", {
    timeZone: "Europe/Istanbul",
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(date.endsWith("Z") ? date : date.replace(" ", "T") + "Z"));
type ModalState =
  | { kind: "hold" }
  | { kind: "reduce"; line: PosCartLine; quantity?: number }
  | { kind: "cancel" };

export default function MarketPos(props: {
  state: AppState;
  stationId: string;
}) {
  return (
    <PosWorkspace
      key={`${props.state.user.id}:${props.stationId}`}
      {...props}
    />
  );
}
function PosWorkspace({
  state,
  stationId,
}: {
  state: AppState;
  stationId: string;
}) {
  const w = usePosWorkspace(state, stationId);
  const { data, locked, deviceId } = w;
  const cart = data?.activeCart ?? null;
  const lines = cart?.lines ?? [];
  const [registerId, setRegisterId] = useState("");
  const [barcode, setBarcode] = useState("");
  const [search, setSearch] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [priceList, setPriceList] = useState("");
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const favoriteKey = `stationos-pos-favorites:${state.user.id}:${stationId}`;
  const [favorites, setFavorites] = useState<string[]>(() => {
    try {
      const x = JSON.parse(localStorage.getItem(favoriteKey) ?? "[]");
      return Array.isArray(x)
        ? x.filter(v => typeof v === "string").slice(0, 100)
        : [];
    } catch {
      return [];
    }
  });
  const [modal, setModal] = useState<ModalState | null>(null);
  const [heldOpen, setHeldOpen] = useState(false);
  const scanInput = useRef<HTMLInputElement>(null),
    cashInput = useRef<HTMLInputElement>(null);
  const management = ["OWNER", "MANAGER"].includes(state.member?.role ?? "");
  const canSell = ["OWNER", "MANAGER", "MARKET_STAFF"].includes(
    state.member?.role ?? ""
  );
  const session = data?.sessions.find(
    s =>
      s.registerId === registerId &&
      !s.closedAt &&
      s.userId === state.user.id &&
      s.deviceIds.includes(deviceId)
  );
  const ownOpenSession = data?.sessions.find(
    s =>
      s.registerId === registerId && !s.closedAt && s.userId === state.user.id
  );
  const occupied = data?.sessions.some(
    s => s.registerId === registerId && !s.closedAt
  );
  const cartSession = data?.sessions.find(s => s.id === cart?.sessionId);
  const editable =
    !!session && (!cart || cart.sessionId === session.id) && canSell;
  const total = cart ? cartTotal(cart) : 0;
  function currentPrice(productId: string, listId = priceList) {
    if (!listId)
      return data?.products.find(p => p.id === productId)?.salePriceMinor;
    if (!data?.priceLists.some(l => l.id === listId)) return undefined;
    return data.prices.find(
      p => p.productId === productId && p.listId === listId
    )?.unitPriceMinor;
  }
  const priceChanged = lines.some(
    l =>
      currentPrice(l.productId, l.priceListId ?? "") !==
      l.expectedUnitPriceMinor
  );
  useEffect(() => {
    if (cartSession) setRegisterId(cartSession.registerId);
    else if (!registerId && data?.registers.length === 1)
      setRegisterId(data.registers[0].id);
  }, [cartSession?.id, data?.registers.length, registerId]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.altKey || e.ctrlKey || e.metaKey || modal || heldOpen) return;
      if (e.key === "F2") {
        e.preventDefault();
        scanInput.current?.focus();
      }
      if (e.key === "F4") {
        e.preventDefault();
        setHeldOpen(true);
      }
      if (e.key === "F8" && cart?.lines.length && !locked) {
        e.preventDefault();
        setModal({ kind: "hold" });
      }
      if (e.key === "F9") {
        e.preventDefault();
        cashInput.current?.focus();
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [modal, heldOpen, cart, locked]);
  function cartPayload() {
    return cart ? { cartId: cart.id, cartVersion: cart.version } : {};
  }
  async function add(productId: string, pack = 1, listId = priceList) {
    if (locked || !editable || !session) return;
    const units = Number(quantity),
      count = units * pack;
    if (
      !Number.isSafeInteger(units) ||
      units < 1 ||
      !Number.isSafeInteger(count) ||
      count < 1 ||
      count > 10000
    ) {
      w.setError("Adet 1–10.000 arasında tam sayı olmalıdır.");
      return;
    }
    const success = await w.action("/pos/cart/add", {
      sessionId: session.id,
      ...cartPayload(),
      productId,
      quantity: count,
      priceListId: listId || null,
    });
    if (success) {
      setBarcode("");
      setQuantity("1");
      requestAnimationFrame(() => scanInput.current?.focus());
    }
  }
  function toggleFavorite(id: string) {
    const next = favorites.includes(id)
      ? favorites.filter(x => x !== id)
      : [...favorites, id].slice(-100);
    setFavorites(next);
    try {
      localStorage.setItem(favoriteKey, JSON.stringify(next));
    } catch {
      /* Favorites are optional browser preferences. */
    }
  }
  const matching =
    data?.products
      .filter(
        p =>
          (!favoritesOnly || favorites.includes(p.id)) &&
          `${p.name} ${p.barcode}`
            .toLocaleLowerCase("tr-TR")
            .includes(search.toLocaleLowerCase("tr-TR"))
      )
      .slice(0, 60) ?? [];
  if (!stationId)
    return (
      <div className="notice">Satış için üst menüden bir istasyon seçin.</div>
    );
  return (
    <div className="pos-root">
      <div className="pos-heading">
        <div>
          <span className="pos-eyebrow">İSTASYONOS MARKET</span>
          <h1>Satış kasası</h1>
          <p>Hızlı satış, kayıtlı sepetler ve ortak kasa.</p>
        </div>
        <div className="pos-connection">
          <span className={w.reachable ? "pos-online" : "pos-offline"} />
          {w.reachable ? "Sunucu bağlı" : "Sunucu bağlantısı bekleniyor"}
          <span className="pos-demo">DEMO</span>
        </div>
      </div>
      <div className="pos-toolbar">
        <label>
          Satış kasası
          <select
            aria-label="Satış kasası"
            value={registerId}
            disabled={locked || !!cart}
            onChange={e => setRegisterId(e.target.value)}
          >
            <option value="">Kasa seçin</option>
            {data?.registers.map(r => (
              <option value={r.id} key={r.id}>
                {r.code} · {r.name}
              </option>
            ))}
          </select>
        </label>
        <div className="pos-session-status">
          <Monitor size={18} />
          <span>
            {session
              ? `${state.user.name} · ${session.deviceIds.length} bilgisayar`
              : "Bu bilgisayarda açık kasa yok"}
            {session && (
              <small>Ortak çekmece: {money(session.expectedCashMinor)}</small>
            )}
          </span>
        </div>
        <button
          className="btn"
          onClick={() => void w.refresh().catch(e => w.setError(e.message))}
        >
          <RefreshCw size={16} />
          Yenile
        </button>
        <button className="btn" onClick={() => setHeldOpen(true)}>
          <Clock3 size={17} />
          Bekleyen sepetler{" "}
          <b className="pos-count">{data?.heldCarts.length ?? 0}</b>
          <kbd>F4</kbd>
        </button>
      </div>
      {w.error && (
        <div role="alert" className="notice warning">
          {w.error}
        </div>
      )}
      {w.notice && (
        <div role="status" className="notice">
          {w.notice}
        </div>
      )}
      {w.pending && (
        <div className="notice warning pos-retry">
          <span>Sonucu beklenen işlem var. Aynı istek kimliği korunuyor.</span>
          <button
            className="btn"
            disabled={w.busy}
            onClick={() => void w.retry()}
          >
            Aynı isteği kontrol et
          </button>
        </div>
      )}
      {!data && <p>Kasa bilgileri yükleniyor…</p>}
      {data && (
        <>
          {!data.isDemo && (
            <div className="notice warning">
              Bu firma DEMO değil. Mali belge ve cihaz akışı doğrulanana kadar
              satış kaydı kapalıdır.
            </div>
          )}
          {management && (
            <details className="pos-setup">
              <summary>Yeni kasa tanımla</summary>
              <form
                onSubmit={e => {
                  e.preventDefault();
                  const f = new FormData(e.currentTarget);
                  void w.action("/pos/register", {
                    name: f.get("name"),
                    code: f.get("code"),
                  });
                }}
              >
                <label>
                  Kasa adı
                  <input
                    name="name"
                    required
                    maxLength={100}
                    placeholder="Market ana kasa"
                    disabled={locked}
                  />
                </label>
                <label>
                  Kasa kodu
                  <input
                    name="code"
                    required
                    maxLength={32}
                    pattern="[A-Za-z0-9][A-Za-z0-9_-]*"
                    placeholder="KASA-1"
                    disabled={locked}
                  />
                </label>
                <button className="btn" disabled={locked}>
                  Kasa oluştur
                </button>
              </form>
            </details>
          )}
          {registerId && !session && canSell && (
            <form
              className="pos-open"
              onSubmit={e => {
                e.preventDefault();
                try {
                  const f = new FormData(e.currentTarget);
                  void w.action("/pos/open", {
                    registerId,
                    openingFloatMinor: parseMoney(String(f.get("float"))),
                  });
                } catch (e) {
                  w.setError((e as Error).message);
                }
              }}
            >
              {ownOpenSession ? (
                <>
                  <p>
                    Bu kullanıcıyla açık kasaya katılın. Sepetler ayrı, bakiye
                    ortak tutulur.
                  </p>
                  <button
                    type="button"
                    className="btn primary"
                    disabled={locked}
                    onClick={() =>
                      void w.action("/pos/join", {
                        registerId,
                        sessionId: ownOpenSession.id,
                      })
                    }
                  >
                    Mevcut kasaya katıl
                  </button>
                </>
              ) : occupied ? (
                <p>Bu kasa başka kullanıcıda açık. Uygun başka kasa seçin.</p>
              ) : (
                <>
                  <label>
                    Açılış para üstü (TL)
                    <input
                      name="float"
                      inputMode="decimal"
                      defaultValue="0,00"
                      required
                      disabled={locked}
                    />
                  </label>
                  <button className="btn primary" disabled={locked}>
                    Kasayı aç
                  </button>
                </>
              )}
            </form>
          )}
          {cart && !editable && (
            <div className="notice warning">
              Kayıtlı sepetin kasa oturumu kapalı veya bu bilgisayar katılmamış.
              Sepeti beklemeye alıp açık kasada çağırabilirsiniz.
            </div>
          )}
          <div className="pos-workspace">
            <section className="pos-catalog" aria-label="Ürün kataloğu">
              <form
                className="pos-scan"
                onSubmit={e => {
                  e.preventDefault();
                  const alias = data.barcodes.find(
                    b => b.barcode === barcode.trim()
                  );
                  const p = data.products.find(
                    p => p.barcode === barcode.trim()
                  );
                  if (alias) void add(alias.productId, alias.packQty);
                  else if (p) void add(p.id);
                  else w.setError("Barkod bu istasyonda bulunamadı.");
                }}
              >
                <label className="pos-barcode-label">
                  <span>
                    <Barcode size={17} />
                    Barkod okut <kbd>F2</kbd>
                  </span>
                  <input
                    ref={scanInput}
                    name="barcode"
                    autoComplete="off"
                    value={barcode}
                    onChange={e => setBarcode(e.target.value)}
                    disabled={!editable || locked}
                    placeholder="Barkodu okutun ve Enter"
                  />
                </label>
                <label className="pos-quantity">
                  Adet
                  <input
                    aria-label="Eklenecek adet"
                    inputMode="numeric"
                    value={quantity}
                    onChange={e => setQuantity(e.target.value)}
                    disabled={locked || !editable}
                  />
                </label>
                <button className="btn primary" disabled={!editable || locked}>
                  Ekle
                </button>
              </form>
              <label className="pos-price-list">
                Satış fiyat listesi
                <select
                  aria-label="Satış fiyat listesi"
                  value={priceList}
                  disabled={locked}
                  onChange={e => setPriceList(e.target.value)}
                >
                  <option value="">Perakende</option>
                  {data.priceLists.map(l => (
                    <option key={l.id} value={l.id}>
                      {l.name}
                    </option>
                  ))}
                </select>
                <small>
                  Yeni eklenen ürünlerde uygulanır; sepet satırı kendi listesini
                  korur.
                </small>
              </label>
              <div className="pos-search">
                <Search size={18} />
                <input
                  aria-label="Ürün ara"
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  placeholder="Ürün adı veya barkod ile ara"
                />
              </div>
              <div className="pos-catalog-tabs">
                <button
                  aria-pressed={!favoritesOnly}
                  className={!favoritesOnly ? "selected" : ""}
                  onClick={() => setFavoritesOnly(false)}
                >
                  Tüm ürünler
                </button>
                <button
                  aria-pressed={favoritesOnly}
                  className={favoritesOnly ? "selected" : ""}
                  onClick={() => setFavoritesOnly(true)}
                >
                  <Star size={15} />
                  Favoriler
                </button>
                <small>{matching.length} ürün gösteriliyor</small>
              </div>
              <div className="pos-products">
                {matching.map(p => (
                  <div className="pos-product-tile" key={p.id}>
                    <button
                      className="pos-product"
                      onClick={() => void add(p.id)}
                      disabled={
                        !editable ||
                        locked ||
                        p.stockQty < 1 ||
                        currentPrice(p.id) === undefined
                      }
                    >
                      <span className="pos-product-symbol">
                        {p.name.slice(0, 1).toLocaleUpperCase("tr-TR")}
                      </span>
                      <b>{p.name}</b>
                      <strong>
                        {currentPrice(p.id) === undefined
                          ? "Fiyat tanımsız"
                          : money(currentPrice(p.id)!)}
                      </strong>
                      <small>
                        {p.stockQty > 0
                          ? `${p.stockQty} adet stok`
                          : "Stok tükendi"}
                      </small>
                    </button>
                    <button
                      className={`pos-favorite ${favorites.includes(p.id) ? "selected" : ""}`}
                      aria-label={`${p.name} favori`}
                      aria-pressed={favorites.includes(p.id)}
                      onClick={() => toggleFavorite(p.id)}
                    >
                      <Star
                        size={16}
                        fill={
                          favorites.includes(p.id) ? "currentColor" : "none"
                        }
                      />
                    </button>
                  </div>
                ))}
              </div>
              {!matching.length && (
                <div className="pos-empty">
                  <Search size={30} />
                  <h3>
                    {favoritesOnly
                      ? "Henüz favori ürün yok"
                      : "Ürün bulunamadı"}
                  </h3>
                  <p>
                    {favoritesOnly
                      ? "Ürün kartındaki yıldızla sık satılanları buraya ekleyin."
                      : "Aramayı değiştirin veya Market ve stok ekranından ürün ekleyin."}
                  </p>
                </div>
              )}
              <div className="pos-shortcuts">
                <span>
                  <kbd>F2</kbd>Barkod
                </span>
                <span>
                  <kbd>F4</kbd>Bekleyenler
                </span>
                <span>
                  <kbd>F8</kbd>Beklet
                </span>
                <span>
                  <kbd>F9</kbd>Nakit alanı
                </span>
              </div>
            </section>
            <section className="pos-cart" aria-label="Satış sepeti">
              <div className="pos-cart-head">
                <div>
                  <h2>
                    <ShoppingBasket size={21} />
                    Müşteri sepeti
                  </h2>
                  <small>
                    {cart
                      ? `#${cart.id.slice(0, 8)} · sunucuda kayıtlı`
                      : "Yeni satış"}
                  </small>
                </div>
                <span className="pos-count">
                  {lines.reduce((n, l) => n + l.quantity, 0)} adet
                </span>
              </div>
              <div className="pos-cart-lines">
                {lines.map(l => (
                  <div className="pos-line" key={l.productId}>
                    <div>
                      <b>{l.productName}</b>
                      <small>
                        {l.quantity} × {money(l.expectedUnitPriceMinor)}
                        {l.priceListName
                          ? ` · ${l.priceListName}`
                          : " · Perakende"}
                      </small>
                      <div className="pos-stepper">
                        <button
                          aria-label={`${l.productName} adet azalt`}
                          disabled={locked || !editable}
                          onClick={() =>
                            setModal({ kind: "reduce", line: l, quantity: 1 })
                          }
                        >
                          <Minus size={14} />
                        </button>
                        <span>{l.quantity}</span>
                        <button
                          aria-label={`${l.productName} adet artır`}
                          disabled={locked || !editable}
                          onClick={() =>
                            void add(l.productId, 1, l.priceListId ?? "")
                          }
                        >
                          <Plus size={14} />
                        </button>
                      </div>
                    </div>
                    <strong>
                      {money(l.quantity * l.expectedUnitPriceMinor)}
                    </strong>
                    <button
                      className="pos-remove"
                      aria-label={`${l.productName} iptal et`}
                      disabled={locked || !editable}
                      onClick={() => setModal({ kind: "reduce", line: l })}
                    >
                      <Trash2 size={17} />
                    </button>
                  </div>
                ))}
              </div>
              {!lines.length && (
                <div className="pos-empty">
                  <ShoppingBasket size={38} />
                  <h3>Sepetiniz hazır</h3>
                  <p>Barkod okutun veya soldaki ürünlerden seçin.</p>
                </div>
              )}
              {priceChanged && (
                <div className="notice warning">
                  Fiyatı değişen ürün var. Güncel fiyatları alıp toplamı kontrol
                  edin.
                </div>
              )}
              <div className="pos-cart-actions">
                <button
                  className="btn"
                  disabled={locked || !lines.length || !canSell}
                  onClick={() => setModal({ kind: "hold" })}
                >
                  <Pause size={16} />
                  Beklemeye al
                </button>
                <button
                  className="btn"
                  disabled={locked || !cart || !canSell}
                  onClick={() => setModal({ kind: "cancel" })}
                >
                  <Trash2 size={15} />
                  Sepeti iptal et
                </button>
                <button
                  className="btn"
                  disabled={locked || !cart || !editable}
                  onClick={() =>
                    void w.action("/pos/cart/reprice", {
                      sessionId: session!.id,
                      ...cartPayload(),
                    })
                  }
                >
                  <RefreshCw size={15} />
                  Güncel fiyatlar
                </button>
              </div>
              <div className="pos-total">
                <span>Ödenecek toplam</span>
                <strong>{money(total)}</strong>
              </div>
              <PosPayment
                key={`${cart?.id}:${cart?.version}`}
                total={total}
                customers={data.marketCustomers}
                creditEnabled={data.marketAccountingEnabled}
                busy={w.busy}
                cashInput={cashInput}
                disabled={
                  locked ||
                  !editable ||
                  !lines.length ||
                  !data.isDemo ||
                  priceChanged
                }
                onPay={payload =>
                  w.action("/pos/checkout", {
                    sessionId: session!.id,
                    ...cartPayload(),
                    ...payload,
                  })
                }
              />
              <p className="pos-fiscal-note">
                DEMO satışıdır. Mali belge düzenlenmez.
              </p>
            </section>
          </div>
          <div className="pos-bottom-panels">
            {session && (
              <details className="pos-close">
                <summary>
                  <Wallet size={18} />
                  Kasa özeti ve kapanış
                </summary>
                <div className="pos-summary">
                  <span>
                    Açılış<b>{money(session.openingFloatMinor)}</b>
                  </span>
                  <span>
                    Nakit satış<b>{money(session.cashSalesMinor)}</b>
                  </span>
                  <span>
                    Kart beyanı<b>{money(session.cardDeclaredMinor)}</b>
                  </span>
                  {data.marketAccountingEnabled && (
                    <span>
                      Veresiye satış<b>{money(session.receivableSalesMinor)}</b>
                    </span>
                  )}
                  <span>
                    Beklenen çekmece<b>{money(session.expectedCashMinor)}</b>
                  </span>
                </div>
                <p>
                  {session.deviceIds.length} bilgisayar bu kasaya bağlı. Kapanış
                  tüm bilgisayarlarda yeni satışı durdurur. Bekleyen sepetler
                  korunur.
                </p>
                <form
                  onSubmit={e => {
                    e.preventDefault();
                    try {
                      const f = new FormData(e.currentTarget);
                      if (
                        session.deviceIds.length > 1 &&
                        !window.confirm(
                          "Kasayı kapatmak bağlı tüm bilgisayarlarda yeni satışı durdurur. Kapatılsın mı?"
                        )
                      )
                        return;
                      void w.action("/pos/close", {
                        sessionId: session.id,
                        countedCashMinor: parseMoney(String(f.get("counted"))),
                        note: f.get("note"),
                        cashTransferred: f.get("transferred") === "on",
                      });
                    } catch (e) {
                      w.setError((e as Error).message);
                    }
                  }}
                >
                  <label>
                    Sayılan nakit (TL)
                    <input
                      name="counted"
                      required
                      inputMode="decimal"
                      disabled={locked}
                    />
                  </label>
                  <label>
                    Fark açıklaması
                    <input name="note" maxLength={500} disabled={locked} />
                  </label>
                  {data.marketAccountingEnabled && (
                    <label className="pos-check">
                      <input
                        name="transferred"
                        type="checkbox"
                        required
                        disabled={locked}
                      />
                      Sayılan nakdi merkez kasaya devrettim.
                    </label>
                  )}
                  <button className="btn" disabled={locked || !!cart}>
                    Kasayı kapat
                  </button>
                </form>
              </details>
            )}
            <details className="pos-history">
              <summary>
                <History size={18} />
                Son satışlar
              </summary>
              {data.sales.map(s => (
                <div className="pos-line" key={s.id}>
                  <div>
                    <b>#{s.id.slice(0, 8)}</b>
                    <small>
                      {time(s.createdAt)} ·{" "}
                      {data.registers.find(r => r.id === s.registerId)?.code}
                    </small>
                    <small>
                      {s.paymentKind === "CASH"
                        ? "Nakit"
                        : s.paymentKind === "MIXED"
                          ? "Nakit + kart beyanı"
                          : s.paymentKind === "ON_ACCOUNT"
                            ? "Veresiye satış"
                            : "Kart beyanı"}{" "}
                      · Bilgisayar {s.deviceId.slice(0, 8)}
                    </small>
                    {s.paymentKind === "MIXED" && (
                      <small>
                        Nakit {money(s.cashAmountMinor)} · Kart{" "}
                        {money(s.cardAmountMinor)}
                      </small>
                    )}
                  </div>
                  <strong>{money(s.totalMinor)}</strong>
                </div>
              ))}
            </details>
            <details className="pos-history">
              <summary>
                <Trash2 size={18} />
                İptal geçmişi
              </summary>
              {!data.cancellations.length && <p>Henüz iptal kaydı yok.</p>}
              {data.cancellations.map(e => (
                <div className="pos-audit" key={e.id}>
                  <div>
                    <b>
                      {e.action === "CANCEL"
                        ? "Sepet iptali"
                        : "Ürün / adet iptali"}
                    </b>
                    <small>
                      {time(e.createdAt)} · {e.actorName} · Bilgisayar{" "}
                      {e.deviceId.slice(0, 8)}
                    </small>
                  </div>
                  <p>{e.reason}</p>
                  {e.beforeLines
                    .filter(
                      l =>
                        l.quantity !==
                        (e.afterLines.find(a => a.productId === l.productId)
                          ?.quantity ?? 0)
                    )
                    .map(l => (
                      <small key={l.productId}>
                        {l.productName}: {l.quantity} →{" "}
                        {e.afterLines.find(a => a.productId === l.productId)
                          ?.quantity ?? 0}{" "}
                        adet
                      </small>
                    ))}
                  <small>Sepet #{e.cartId.slice(0, 8)}</small>
                </div>
              ))}
            </details>
          </div>
          <details className="pos-capabilities">
            <summary>Bağlantı ve cihaz bilgileri</summary>
            <p>
              Barkod okuyucu: klavye girişi ve Enter. Yazıcı, çekmece, mali
              belge ve merkez aktarımı henüz bağlı değil. İnternet kesintisinde
              market içindeki sunucuya yerel ağdan erişim gerekir. Sunucu
              bağlantısı kesildiğinde satış sonucu doğrulanmadan yeni işlem
              yapılmaz.
            </p>
          </details>
        </>
      )}
      <Dialog open={heldOpen} onOpenChange={setHeldOpen}>
        <DialogContent className="pos-dialog pos-held-dialog">
          <DialogTitle>Bekleyen sepetler</DialogTitle>
          <DialogDescription>
            Aynı markette kayıtlı sepeti bu bilgisayara alın. Bir sepet aynı
            anda tek bilgisayarda kullanılabilir.
          </DialogDescription>
          {w.error && (
            <p role="alert" className="pos-field-error">
              {w.error}
            </p>
          )}
          {cart && (
            <p className="notice warning">
              Önce aktif sepetinizi bekletin veya iptal edin.
            </p>
          )}
          <div className="pos-held-list">
            {!data?.heldCarts.length && <p>Bekleyen sepet yok.</p>}
            {data?.heldCarts.map(c => (
              <div className="pos-held" key={c.id}>
                <div>
                  <b>{c.label || `Sepet #${c.id.slice(0, 8)}`}</b>
                  <small>
                    {time(c.updatedAt)} ·{" "}
                    {c.lines.reduce((n, l) => n + l.quantity, 0)} adet
                  </small>
                  <small>
                    {c.lines
                      .slice(0, 3)
                      .map(l => l.productName)
                      .join(", ")}
                    {c.lines.length > 3 ? "…" : ""}
                  </small>
                  <strong>{money(cartTotal(c))}</strong>
                </div>
                <button
                  className="btn primary"
                  disabled={locked || !!cart || !session || !canSell}
                  onClick={async () => {
                    if (
                      await w.action("/pos/cart/resume", {
                        sessionId: session!.id,
                        cartId: c.id,
                        cartVersion: c.version,
                      })
                    ) {
                      setHeldOpen(false);
                      scanInput.current?.focus();
                    }
                  }}
                >
                  <Play size={16} />
                  Sepeti çağır
                </button>
              </div>
            ))}
          </div>
        </DialogContent>
      </Dialog>
      {modal && cart && (
        <CartOperationDialog
          key={`${modal.kind}:${cart.id}:${cart.version}`}
          modal={modal}
          cart={cart}
          busy={locked}
          error={w.error}
          close={() => setModal(null)}
          submit={async payload => {
            const path =
              modal.kind === "hold"
                ? "hold"
                : modal.kind === "reduce"
                  ? "reduce"
                  : "cancel";
            const success = await w.action(`/pos/cart/${path}`, {
              ...cartPayload(),
              ...(modal.kind === "reduce"
                ? { sessionId: session?.id, productId: modal.line.productId }
                : {}),
              ...payload,
            });
            if (success) {
              setModal(null);
              scanInput.current?.focus();
            }
          }}
        />
      )}
    </div>
  );
}
function CartOperationDialog({
  modal,
  cart,
  busy,
  error,
  close,
  submit,
}: {
  modal: ModalState;
  cart: PosCart;
  busy: boolean;
  error: string;
  close: () => void;
  submit: (payload: Record<string, unknown>) => Promise<void>;
}) {
  const [reason, setReason] = useState("");
  const [quantity, setQuantity] = useState(
    modal.kind === "reduce" ? (modal.quantity ?? modal.line.quantity) : 1
  );
  const hold = modal.kind === "hold";
  return (
    <Dialog
      open
      onOpenChange={open => {
        if (!open) close();
      }}
    >
      <DialogContent className="pos-dialog">
        <DialogTitle>
          {hold
            ? "Sepeti beklemeye al"
            : modal.kind === "reduce"
              ? "Ürün iptali / adet azaltma"
              : "Sepeti açıklamayla iptal et"}
        </DialogTitle>
        <DialogDescription>
          {hold
            ? "Sepet sunucuda saklanır. Stoktan düşülmez; başka müşteriye başlayabilirsiniz."
            : "Açıklama, kasiyer, bilgisayar ve saat iptal geçmişine kaydedilir."}
        </DialogDescription>
        {error && (
          <p role="alert" className="pos-field-error">
            {error}
          </p>
        )}
        <form
          onSubmit={e => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            void submit(
              hold
                ? { label: f.get("label") }
                : { reason, ...(modal.kind === "reduce" ? { quantity } : {}) }
            );
          }}
        >
          {hold ? (
            <label>
              Sepet etiketi (isteğe bağlı)
              <input
                name="label"
                maxLength={100}
                defaultValue={cart.label ?? ""}
                placeholder="Örn. Mavi sepet"
                disabled={busy}
              />
            </label>
          ) : (
            <>
              {modal.kind === "reduce" && (
                <>
                  <b>{modal.line.productName}</b>
                  <label>
                    İptal edilecek adet
                    <input
                      type="number"
                      min={1}
                      max={modal.line.quantity}
                      step={1}
                      value={quantity}
                      onChange={e => setQuantity(Number(e.target.value))}
                      required
                      disabled={busy}
                    />
                  </label>
                  <small>
                    Sepette {modal.line.quantity} adet var. İptal sonrası{" "}
                    {Math.max(0, modal.line.quantity - quantity)} adet kalacak.
                  </small>
                </>
              )}
              <div className="pos-reasons">
                {["Yanlış okutma", "Müşteri vazgeçti", "Miktar düzeltme"].map(
                  r => (
                    <button
                      type="button"
                      key={r}
                      disabled={busy}
                      onClick={() => setReason(r)}
                    >
                      {r}
                    </button>
                  )
                )}
              </div>
              <label>
                İptal açıklaması
                <textarea
                  required
                  minLength={5}
                  maxLength={500}
                  value={reason}
                  onChange={e => setReason(e.target.value)}
                  disabled={busy}
                  placeholder="İptal nedenini yazın"
                />
              </label>
            </>
          )}
          <div className="pos-dialog-actions">
            <button
              type="button"
              className="btn"
              disabled={busy}
              onClick={close}
            >
              Vazgeç
            </button>
            <button
              className={`btn ${hold ? "primary" : "pos-danger"}`}
              disabled={busy}
            >
              {busy
                ? "Kaydediliyor…"
                : hold
                  ? "Beklemeye al"
                  : "Açıklamayla iptal et"}
            </button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

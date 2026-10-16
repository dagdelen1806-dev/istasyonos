import { useEffect, useRef, useState, type FormEvent } from "react";
import type { AppState } from "@shared/station";
import { money, parseMoney } from "@shared/station";
import type { PosLineInput, PosState } from "@shared/pos";
import {
  ApiError,
  getDeviceIdentity,
  loadPosState,
  mutate,
} from "@/lib/station-api";
import { newRequestId } from "@/lib/id";
import "./pos.css";

type Pending = { path: string; payload: Record<string, unknown>; id: string };
const paths = [
  "/pos/register",
  "/pos/open",
  "/pos/join",
  "/pos/checkout",
  "/pos/close",
];

export default function MarketPos({
  state,
  stationId,
}: {
  state: AppState;
  stationId: string;
}) {
  const [data, setData] = useState<PosState | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [registerId, setRegisterId] = useState("");
  const [cart, setCart] = useState<PosLineInput[]>([]);
  const [barcode, setBarcode] = useState("");
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<Pending | null>(null);
  const [pendingLoaded, setPendingLoaded] = useState(false);
  const [paymentKind, setPaymentKind] = useState<"CASH" | "CARD_MANUAL">(
    "CASH"
  );
  const [tendered, setTendered] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const scanInput = useRef<HTMLInputElement>(null);
  const inFlight = useRef(false);
  const sequence = useRef(0);
  const deviceId = getDeviceIdentity().deviceId;
  const storageKey = `stationos-pos-pending:${state.user.id}:${stationId}:${deviceId}`;
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
  const total = cart.reduce(
    (sum, line) => sum + line.quantity * line.expectedUnitPriceMinor,
    0
  );
  const locked = busy || !!pending || !pendingLoaded;

  async function refresh() {
    const current = ++sequence.current;
    const next = await loadPosState(stationId);
    if (current === sequence.current) setData(next);
  }
  useEffect(() => {
    if (!stationId) {
      setPendingLoaded(true);
      return;
    }
    let active = true;
    const update = () => {
      void refresh().catch(e => {
        if (active) setError(e.message);
      });
    };
    update();
    const timer = window.setInterval(update, 15000);
    try {
      const raw = sessionStorage.getItem(storageKey);
      if (raw) {
        const saved = JSON.parse(raw) as Pending;
        if (
          !paths.includes(saved.path) ||
          saved.payload.stationId !== stationId ||
          !/^[a-f0-9-]{36}$/i.test(saved.id)
        )
          throw new Error(
            "Bekleyen kayıt okunamadı. Yeni satış başlatmadan destek alın."
          );
        setPending(saved);
        setNotice(
          "Önceki isteğin sonucu kontrol edilmeli. Aynı isteği yeniden sorgulayın."
        );
      }
      setPendingLoaded(true);
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Tarayıcı depolaması kullanılamıyor."
      );
    }
    return () => {
      active = false;
      sequence.current++;
      window.clearInterval(timer);
    };
  }, [storageKey]);
  useEffect(() => {
    if (!registerId && data?.registers.length === 1)
      setRegisterId(data.registers[0].id);
  }, [data, registerId]);

  async function action(
    path: string,
    payload: Record<string, unknown>,
    retry?: Pending
  ) {
    if (inFlight.current || (!retry && locked)) return;
    const operation = retry ?? {
      path,
      payload: { ...payload, stationId },
      id: newRequestId(),
    };
    inFlight.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      // Persist BEFORE sending. A reload after a lost response retains the same ID.
      sessionStorage.setItem(storageKey, JSON.stringify(operation));
      setPending(operation);
      let result;
      try {
        result = await mutate(
          operation.path,
          operation.payload,
          operation.id,
          state.csrfToken
        );
      } catch (e) {
        const uncertain =
          !(e instanceof ApiError) ||
          !e.status ||
          e.status >= 500 ||
          e.status === 401 ||
          e.status === 403;
        if (!uncertain) {
          sessionStorage.removeItem(storageKey);
          setPending(null);
        }
        throw e;
      }
      sessionStorage.removeItem(storageKey);
      setPending(null);
      if (operation.path === "/pos/checkout") {
        setCart([]);
        setTendered("");
        setConfirmed(false);
        setNotice(
          `DEMO satış kaydedildi: ${money(result.result.totalMinor)}. Para üstü: ${money(result.result.changeMinor)}. Mali fiş üretilmedi.`
        );
      } else if (operation.path === "/pos/register") {
        setRegisterId(result.result.id);
        setNotice("Kasa tanımlandı.");
      } else if (operation.path === "/pos/close") {
        setCart([]);
        setNotice(
          `Kasa kapandı. Nakit farkı: ${money(result.result.differenceMinor)}.`
        );
      } else if (operation.path === "/pos/join")
        setNotice(
          "Ortak kasaya katıldınız. Açılış para üstü yeniden eklenmedi."
        );
      else setNotice("Kasa oturumu açıldı.");
      await refresh();
      scanInput.current?.focus();
    } catch (e) {
      setError(e instanceof Error ? e.message : "İşlem tamamlanamadı.");
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }
  function add(productId: string) {
    if (locked || !session) return;
    const product = data?.products.find(p => p.id === productId);
    if (!product) {
      setError("Barkod bu istasyonda bulunamadı.");
      return;
    }
    const previous = cart.find(l => l.productId === productId);
    if ((previous?.quantity ?? 0) >= product.stockQty) {
      setError("Bu ürün için yeterli stok yok.");
      return;
    }
    if (!previous && cart.length >= 100) {
      setError("Sepet en fazla 100 farklı ürün içerebilir.");
      return;
    }
    setCart(lines => {
      const current = lines.find(l => l.productId === productId);
      if ((current?.quantity ?? 0) >= Math.min(product.stockQty, 10000))
        return lines;
      return current
        ? lines.map(l =>
            l.productId === productId ? { ...l, quantity: l.quantity + 1 } : l
          )
        : [
            ...lines,
            {
              productId,
              quantity: 1,
              expectedUnitPriceMinor: product.salePriceMinor,
            },
          ];
    });
    setError("");
    setBarcode("");
    setConfirmed(false);
    scanInput.current?.focus();
  }
  function submitSale(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!session || !cart.length || !data?.isDemo) return;
    try {
      const payload = {
        sessionId: session.id,
        lines: cart,
        paymentKind,
        ...(paymentKind === "CASH"
          ? { tenderedMinor: parseMoney(tendered) }
          : { cardConfirmed: confirmed }),
      };
      void action("/pos/checkout", payload);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Tutar geçersiz.");
    }
  }
  const matching =
    data?.products
      .filter(p =>
        `${p.name} ${p.barcode}`
          .toLocaleLowerCase("tr-TR")
          .includes(search.toLocaleLowerCase("tr-TR"))
      )
      .slice(0, 60) ?? [];
  if (!stationId)
    return (
      <div className="notice">
        Satış kasası için üst menüden bir istasyon seçin.
      </div>
    );
  return (
    <div className="pos-root">
      <div className="notice warning">
        <strong>DEMO kasa pilotu.</strong> Mali fiş, banka doğrulaması, otomatik
        yazıcı/çekmece bağlantısı ve merkez senkronizasyonu henüz yok. İnternet
        kesildiğinde yerel sunucuya erişim gerekir.
      </div>
      {!data?.isDemo && data && (
        <div className="notice warning">
          Bu firma DEMO değil. Cihaz ve mali belge akışı doğrulanana kadar satış
          kaydı kapalı; ürün ve kasa tanımları hazırlanabilir.
        </div>
      )}
      {error && (
        <div role="alert" className="notice warning">
          {error}
        </div>
      )}
      {notice && (
        <div role="status" className="notice">
          {notice}
        </div>
      )}
      {pending && (
        <div className="notice warning pos-retry">
          Sonuç kontrolü bekleyen istek var. Yeni işlem başlatmayın.
          <button
            className="btn"
            disabled={busy}
            onClick={() => void action(pending.path, pending.payload, pending)}
          >
            Aynı isteği kontrol et
          </button>
        </div>
      )}
      {!data && <p>Kasa bilgileri yükleniyor…</p>}
      {data && (
        <>
          <div className="pos-toolbar">
            <label>
              Satış kasası
              <select
                aria-label="Satış kasası"
                value={registerId}
                disabled={locked || cart.length > 0}
                onChange={e => {
                  setRegisterId(e.target.value);
                  setTendered("");
                  setConfirmed(false);
                }}
              >
                <option value="">Kasa seçin</option>
                {data.registers.map(r => (
                  <option value={r.id} key={r.id}>
                    {r.code} · {r.name}
                  </option>
                ))}
              </select>
            </label>
            <span>
              {session
                ? `Kasa açık · ${session.deviceIds.length} bilgisayar · ortak bakiye`
                : "Bu tarayıcıda açık kasa yok"}
            </span>
            <button
              className="btn"
              onClick={() => void refresh().catch(e => setError(e.message))}
            >
              Yenile
            </button>
          </div>
          {management && (
            <details className="pos-setup">
              <summary>Yeni kasa tanımla</summary>
              <form
                onSubmit={e => {
                  e.preventDefault();
                  const f = new FormData(e.currentTarget);
                  void action("/pos/register", {
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
                  void action("/pos/open", {
                    registerId,
                    openingFloatMinor: parseMoney(String(f.get("float"))),
                  });
                } catch (e) {
                  setError((e as Error).message);
                }
              }}
            >
              {ownOpenSession ? (
                <>
                  <p>
                    Bu kullanıcıyla açık kasa var. Aynı kasa bakiyesine
                    katılabilirsiniz; sepetler bilgisayarlarda ayrı tutulur.
                  </p>
                  <button
                    type="button"
                    className="btn primary"
                    disabled={locked}
                    onClick={() =>
                      void action("/pos/join", {
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
          <div className="pos-workspace">
            <section className="pos-catalog" aria-label="Ürün kataloğu">
              <form
                className="pos-scan"
                onSubmit={e => {
                  e.preventDefault();
                  const p = data.products.find(
                    p => p.barcode === barcode.trim()
                  );
                  if (p) add(p.id);
                  else setError("Barkod bu istasyonda bulunamadı.");
                }}
              >
                <label>
                  Barkod okut
                  <input
                    ref={scanInput}
                    name="barcode"
                    autoComplete="off"
                    value={barcode}
                    onChange={e => setBarcode(e.target.value)}
                    disabled={!session || locked}
                    placeholder="Barkodu okutun ve Enter"
                  />
                </label>
                <button className="btn" disabled={!session || locked}>
                  Ekle
                </button>
              </form>
              <label>
                Ürün ara
                <input
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  placeholder="Ad veya barkod"
                />
              </label>
              <div className="pos-products">
                {matching.map(p => (
                  <button
                    className="pos-product"
                    key={p.id}
                    onClick={() => add(p.id)}
                    disabled={!session || locked || p.stockQty < 1}
                  >
                    <b>{p.name}</b>
                    <strong>{money(p.salePriceMinor)}</strong>
                    <small>Stok: {p.stockQty} adet</small>
                  </button>
                ))}
              </div>
              {!matching.length && (
                <p>
                  Ürün bulunamadı. Market ve stok ekranından ürün/mal kabul
                  ekleyin.
                </p>
              )}
              <small>
                İlk 60 eşleşme gösterilir. Tartılı ürün, kampanya ve KDV/mali
                hesaplama bu pilotta yoktur.
              </small>
            </section>
            <section className="pos-cart" aria-label="Satış sepeti">
              <h2>
                Sepet{" "}
                <small>{cart.reduce((n, l) => n + l.quantity, 0)} adet</small>
              </h2>
              {cart.map(l => (
                <div className="pos-line" key={l.productId}>
                  <div>
                    <b>
                      {data.products.find(p => p.id === l.productId)?.name ??
                        "Ürün"}
                    </b>
                    <small>
                      {l.quantity} × {money(l.expectedUnitPriceMinor)}
                    </small>
                  </div>
                  <strong>
                    {money(l.quantity * l.expectedUnitPriceMinor)}
                  </strong>
                  <button
                    className="btn"
                    aria-label={`${data.products.find(p => p.id === l.productId)?.name} bir adet azalt`}
                    disabled={locked}
                    onClick={() => {
                      setCart(lines =>
                        lines.flatMap(x =>
                          x.productId !== l.productId
                            ? [x]
                            : x.quantity > 1
                              ? [{ ...x, quantity: x.quantity - 1 }]
                              : []
                        )
                      );
                      setConfirmed(false);
                    }}
                  >
                    −
                  </button>
                </div>
              ))}
              {!cart.length && (
                <p>Barkod okutarak veya ürün düğmesine basarak başlayın.</p>
              )}
              <div className="pos-total">
                <span>Toplam</span>
                <strong>{money(total)}</strong>
              </div>
              <form onSubmit={submitSale} className="pos-payment">
                <label>
                  Ödeme türü
                  <select
                    value={paymentKind}
                    disabled={locked}
                    onChange={e => {
                      setPaymentKind(e.target.value as typeof paymentKind);
                      setConfirmed(false);
                    }}
                  >
                    <option value="CASH">Nakit</option>
                    <option value="CARD_MANUAL">Kart · kasiyer beyanı</option>
                  </select>
                </label>
                {paymentKind === "CASH" ? (
                  <label>
                    Alınan nakit (TL)
                    <input
                      inputMode="decimal"
                      required
                      value={tendered}
                      onChange={e => setTendered(e.target.value)}
                      disabled={locked}
                    />
                  </label>
                ) : (
                  <label className="pos-check">
                    <input
                      type="checkbox"
                      checked={confirmed}
                      disabled={locked}
                      onChange={e => setConfirmed(e.target.checked)}
                    />
                    Ayrı POS cihazındaki tahsilat sonucunu teyit ettim. Bu
                    uygulama bankadan doğrulama almadı.
                  </label>
                )}
                <button
                  className="btn primary pos-pay"
                  disabled={
                    locked ||
                    !session ||
                    !cart.length ||
                    !data.isDemo ||
                    !canSell ||
                    (paymentKind === "CARD_MANUAL" && !confirmed)
                  }
                >
                  {busy ? "Kaydediliyor…" : "DEMO satışı kaydet"}
                </button>
              </form>
              <div className="pos-cart-actions">
                <button
                  className="btn"
                  disabled={locked || !cart.length}
                  onClick={() => {
                    setCart([]);
                    setTendered("");
                    setConfirmed(false);
                  }}
                >
                  Sepeti temizle
                </button>
                <button
                  className="btn"
                  disabled={locked || !cart.length}
                  onClick={() => {
                    setCart(lines =>
                      lines.map(l => ({
                        ...l,
                        expectedUnitPriceMinor:
                          data.products.find(p => p.id === l.productId)
                            ?.salePriceMinor ?? l.expectedUnitPriceMinor,
                      }))
                    );
                    setConfirmed(false);
                    setNotice(
                      "Sepet fiyatları güncellendi. Yeni toplamı kontrol edin."
                    );
                  }}
                >
                  Güncel fiyatları al
                </button>
              </div>
            </section>
          </div>
          {session && session.deviceIds.length > 1 && (
            <p>
              Bu kasa {session.deviceIds.length} bilgisayarda ortak
              kullanılıyor. Bakiye en geç 15 saniyede veya Yenile ile
              güncellenir. Bir bilgisayardan kapanış tüm kasa oturumunu kapatır.
            </p>
          )}
          {session && (
            <details className="pos-close">
              <summary>Kasa özeti ve kapanış</summary>
              <div className="pos-summary">
                <span>
                  Açılış: <b>{money(session.openingFloatMinor)}</b>
                </span>
                <span>
                  Nakit satış: <b>{money(session.cashSalesMinor)}</b>
                </span>
                <span>
                  Kart beyanı: <b>{money(session.cardDeclaredMinor)}</b>
                </span>
                <span>
                  Beklenen çekmece: <b>{money(session.expectedCashMinor)}</b>
                </span>
              </div>
              <form
                onSubmit={e => {
                  e.preventDefault();
                  try {
                    if (cart.length)
                      throw new Error(
                        "Kapanıştan önce sepeti tamamlayın veya temizleyin."
                      );
                    const f = new FormData(e.currentTarget);
                    if (
                      session.deviceIds.length > 1 &&
                      !window.confirm(
                        "Bu kasayı kapatmak bağlı bütün bilgisayarlarda yeni satışı durdurur. Diğer bilgisayarlardaki sepetleri kontrol ettiniz mi?"
                      )
                    )
                      return;
                    void action("/pos/close", {
                      sessionId: session.id,
                      countedCashMinor: parseMoney(String(f.get("counted"))),
                      note: f.get("note"),
                    });
                  } catch (e) {
                    setError((e as Error).message);
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
                <button className="btn" disabled={locked || cart.length > 0}>
                  Kasayı kapat
                </button>
              </form>
            </details>
          )}
          <details className="pos-history">
            <summary>Son demo satışları</summary>
            {data.sales.map(s => (
              <div className="pos-line" key={s.id}>
                <span>
                  {s.id.slice(0, 8)} ·{" "}
                  {data.registers.find(r => r.id === s.registerId)?.code} ·{" "}
                  {s.paymentKind === "CASH" ? "Nakit" : "Kart beyanı"}
                </span>
                <strong>{money(s.totalMinor)}</strong>
                <small>Mali belge yok</small>
                <small title={s.deviceId}>
                  Bilgisayar: {s.deviceId.slice(0, 8)}
                </small>
              </div>
            ))}
          </details>
        </>
      )}
    </div>
  );
}

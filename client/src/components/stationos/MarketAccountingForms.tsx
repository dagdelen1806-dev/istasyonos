import { useState, type ReactNode } from "react";
import type {
  MarketAccountingState,
  MarketParty,
  MarketStock,
  MarketJournal,
} from "@shared/market-accounting";
import { money, parseMoney, amountInput } from "@shared/station";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { newRequestId } from "@/lib/id";
export type MarketAction = (
  path: string,
  payload: Record<string, unknown>
) => Promise<boolean>;
export type AccountingModal =
  | { kind: "party"; party?: MarketParty }
  | {
      kind: "settlement";
      party: MarketParty;
      direction: "PAYMENT" | "COLLECTION";
    }
  | { kind: "product" | "stock"; product: MarketStock }
  | { kind: "new-product" | "expense" | "transfer" | "capital" | "bank" }
  | { kind: "reverse"; entry: MarketJournal };
const num = (f: FormData, name: string) => {
  const n = Number(f.get(name));
  if (!Number.isSafeInteger(n) || n < 0)
    throw Error("Adet/gün alanı sıfır veya pozitif tam sayı olmalıdır.");
  return n;
};
const amount = (f: FormData, name: string) =>
  parseMoney(String(f.get(name) ?? "0"));
export const uiVat = (s: string) => {
  const n = parseMoney(s);
  if (n > 10000) throw Error("KDV oranı %0–100 arasında olmalıdır.");
  return n;
};
export function AmountField({
  label,
  name,
  value = 0,
  required = true,
}: {
  label: string;
  name: string;
  value?: number;
  required?: boolean;
}) {
  return (
    <label>
      {label}
      <input
        name={name}
        inputMode="decimal"
        defaultValue={amountInput(value)}
        required={required}
        placeholder="0,00"
      />
    </label>
  );
}
function WalletField({ name = "wallet" }: { name?: string }) {
  return (
    <label>
      Hesap
      <select name={name} aria-label="Hesap">
        <option value="CASH_SAFE">Merkez kasa</option>
        <option value="BANK">Banka · manuel kayıt</option>
      </select>
    </label>
  );
}
export function StartMarketBook({
  data,
  locked,
  error,
  action,
}: {
  data: MarketAccountingState;
  locked: boolean;
  error: string;
  action: MarketAction;
}) {
  const [localError, setLocalError] = useState("");
  return (
    <section className="ma-panel ma-start">
      <span className="ma-eyebrow">BAŞLANGIÇ BAKİYELERİ</span>
      <h2>Market ön muhasebesini başlat</h2>
      <p>
        Mevcut ürünler açılış stokuna alınır. Cari açılış bakiyelerini daha
        sonra cari kartında tanımlayabilirsiniz. Açılış tutarları satış geliri
        sayılmaz.
      </p>
      <div className="ma-opening-summary">
        <span>
          Mevcut stok maliyeti
          <strong>{money(data.openingInventoryMinor)}</strong>
        </span>
        <span>
          Açık satış kasası<strong>{data.openRegisterCount}</strong>
        </span>
        <span>
          0 maliyetli stok kartı<strong>{data.unvaluedStockCount}</strong>
        </span>
      </div>
      <form
        onSubmit={async e => {
          e.preventDefault();
          try {
            setLocalError("");
            const f = new FormData(e.currentTarget);
            await action("/market-accounting/start", {
              cashMinor: amount(f, "cash"),
              bankMinor: amount(f, "bank"),
              cardMinor: amount(f, "card"),
              expectedInventoryMinor: data.openingInventoryMinor,
              openingStockAccepted: f.get("accepted") === "on",
            });
          } catch (e) {
            setLocalError((e as Error).message);
          }
        }}
      >
        <fieldset disabled={locked}>
          <div className="ma-form-grid">
            <AmountField
              label="Merkez kasadaki açılış nakdi (TL)"
              name="cash"
            />
            <AmountField label="Banka açılış bakiyesi (TL)" name="bank" />
            <AmountField
              label="Bankaya geçmemiş kart alacağı (TL)"
              name="card"
            />
          </div>
          <label className="ma-check">
            <input type="checkbox" name="accepted" required />
            Mevcut stok adetlerini ve ürün alış fiyatlarının KDV hariç açılış
            maliyeti olduğunu doğruladım.
          </label>
          {data.openRegisterCount > 0 && (
            <p className="ma-warning">
              Başlatmadan önce <a href="/kasa">açık satış kasalarını kapatın</a>
              .
            </p>
          )}
          {(error || localError) && (
            <p role="alert" className="ma-error">
              {localError || error}
            </p>
          )}
          <button
            className="btn primary"
            disabled={locked || data.openRegisterCount > 0}
          >
            Açılışı kaydet ve başlat
          </button>
        </fieldset>
      </form>
    </section>
  );
}
export function MarketAccountingDialog({
  modal,
  data,
  allowOpening,
  locked,
  error,
  close,
  action,
}: {
  modal: AccountingModal;
  allowOpening: boolean;
  data: MarketAccountingState;
  locked: boolean;
  error: string;
  close: () => void;
  action: MarketAction;
}) {
  const [localError, setLocalError] = useState(""),
    [partyKind, setPartyKind] = useState(
      modal.kind === "party" ? (modal.party?.kind ?? "SUPPLIER") : "SUPPLIER"
    ),
    [gross, setGross] = useState(amountInput(data.balances.CARD_CLEARING ?? 0)),
    [fee, setFee] = useState("0,00");
  const titles: Record<AccountingModal["kind"], string> = {
    party:
      modal.kind === "party" && modal.party
        ? "Cari limit ve vade"
        : "Yeni market carisi",
    settlement:
      modal.kind === "settlement" && modal.direction === "PAYMENT"
        ? "Tedarikçiye ödeme"
        : "Müşteriden tahsilat",
    product: "Satış fiyatı ve KDV",
    stock: "Stok sayım farkı",
    "new-product": "Yeni ürün kartı",
    expense: "Gider kaydı",
    transfer: "Kasa–banka transferi",
    capital: "İşletmeye kaynak girişi",
    bank: "Kart alacağının bankaya geçişi",
    reverse: "Açıklamalı ters kayıt",
  };
  let content: ReactNode = null;
  if (modal.kind === "party")
    content = (
      <>
        <label>
          Cari adı
          <input
            name="name"
            required
            maxLength={190}
            defaultValue={modal.party?.name}
          />
        </label>
        {!modal.party && (
          <label>
            Cari türü
            <select
              name="kind"
              aria-label="Cari türü"
              value={partyKind}
              onChange={e => setPartyKind(e.target.value as typeof partyKind)}
            >
              <option value="SUPPLIER">Tedarikçi</option>
              <option value="CUSTOMER">Müşteri</option>
              <option value="BOTH">Müşteri ve tedarikçi</option>
            </select>
          </label>
        )}
        <label>
          Vergi / kimlik no (isteğe bağlı)
          <input
            name="tax"
            maxLength={32}
            defaultValue={modal.party?.taxNumber ?? ""}
          />
        </label>
        <div className="ma-form-grid">
          <AmountField
            name="arLimit"
            label="Müşteri veresiye limiti (TL)"
            value={modal.party?.receivableLimitMinor ?? 0}
          />
          <label>
            Tedarikçi limiti (TL, boş = limitsiz)
            <input
              name="apLimit"
              inputMode="decimal"
              defaultValue={
                modal.party?.payableLimitMinor == null
                  ? ""
                  : amountInput(modal.party.payableLimitMinor)
              }
            />
          </label>
          <label>
            Varsayılan vade (gün)
            <input
              name="term"
              type="number"
              min={0}
              max={365}
              step={1}
              defaultValue={modal.party?.termDays ?? 0}
              required
            />
          </label>
        </div>
        {!modal.party && allowOpening && (
          <details>
            <summary>Açılış cari bakiyesi</summary>
            <div className="ma-form-grid">
              {partyKind !== "SUPPLIER" && (
                <AmountField label="Devreden müşteri alacağı (TL)" name="ar" />
              )}
              {partyKind !== "CUSTOMER" && (
                <AmountField label="Devreden tedarikçi borcu (TL)" name="ap" />
              )}
            </div>
            <label>
              Açılış açıklaması
              <input
                name="openingNote"
                maxLength={500}
                placeholder="Bakiye varsa en az 5 karakter açıklama"
              />
            </label>
          </details>
        )}
      </>
    );
  if (modal.kind === "settlement")
    content = (
      <>
        <div className="ma-form-summary">
          <b>{modal.party.name}</b>
          <span>
            Açık bakiye:{" "}
            {money(
              modal.direction === "COLLECTION"
                ? modal.party.receivableMinor
                : modal.party.payableMinor
            )}
          </span>
        </div>
        <AmountField
          label={
            modal.direction === "COLLECTION"
              ? "Tahsil edilen tutar (TL)"
              : "Ödenen tutar (TL)"
          }
          name="amount"
          value={
            modal.direction === "COLLECTION"
              ? modal.party.receivableMinor
              : modal.party.payableMinor
          }
        />
        <WalletField />
        <label>
          İşlem açıklaması
          <input
            name="description"
            required
            minLength={5}
            maxLength={500}
            defaultValue={
              modal.direction === "COLLECTION"
                ? "Market cari tahsilatı"
                : "Market tedarikçi ödemesi"
            }
          />
        </label>
        <label>
          Referans / dekont no
          <input name="reference" maxLength={150} />
        </label>
        <p className="ma-hint">
          Ödeme en eski vadeli açık belgelere dağıtılır. Banka seçimi manuel
          beyan kaydıdır.
        </p>
      </>
    );
  if (modal.kind === "product")
    content = (
      <>
        <b>{modal.product.name}</b>
        <AmountField
          label="KDV dahil satış fiyatı (TL)"
          name="price"
          value={modal.product.salePriceMinor}
        />
        <label>
          Ürünün satış KDV oranı (%)
          <input
            name="vat"
            inputMode="decimal"
            required
            defaultValue={
              modal.product.vatBps === null
                ? ""
                : String(modal.product.vatBps / 100).replace(".", ",")
            }
            placeholder="Belgeye/ürüne uygun oran"
          />
        </label>
        <p className="ma-hint">
          Oran işletme tarafından doğrulanmalıdır. Bekleyen sepetlerde fiyat
          değişikliği ayrıca kontrol edilir.
        </p>
      </>
    );
  if (modal.kind === "stock")
    content = (
      <>
        <b>{modal.product.name}</b>
        <p>
          Kayıtlı adet: {modal.product.quantity} · Maliyet değeri:{" "}
          {money(modal.product.valueMinor)}
        </p>
        <label>
          Fiziksel sayılan adet
          <input
            name="counted"
            type="number"
            min={0}
            step={1}
            required
            defaultValue={modal.product.quantity}
          />
        </label>
        <AmountField
          label="Stok fazlası varsa KDV hariç birim maliyet (TL)"
          name="cost"
          value={modal.product.averageCostMinor}
        />
        <label>
          Sayım farkı açıklaması
          <textarea name="description" required minLength={5} maxLength={500} />
        </label>
        <p className="ma-hint">
          Eksik stok mevcut ağırlıklı maliyetten düşülür. Fark ayrı hareket
          olarak kaydedilir.
        </p>
      </>
    );
  if (modal.kind === "new-product")
    content = (
      <>
        <label>
          Ürün adı
          <input name="name" required maxLength={190} />
        </label>
        <label>
          Barkod
          <input name="barcode" required maxLength={190} />
        </label>
        <AmountField name="price" label="KDV dahil satış fiyatı (TL)" />
        <label>
          Minimum stok (adet)
          <input
            name="minimum"
            type="number"
            min={0}
            step={1}
            defaultValue={0}
            required
          />
        </label>
        <p className="ma-hint">
          Ürün sıfır stokla açılır. Stoku Alış ve mal kabul bölümünden ekleyin;
          satış KDV oranını stok kartında tanımlayın.
        </p>
      </>
    );
  if (modal.kind === "expense")
    content = (
      <>
        <AmountField name="net" label="KDV hariç gider tutarı (TL)" />
        <label>
          Belgedeki gider KDV oranı (%)
          <input
            name="vat"
            inputMode="decimal"
            required
            placeholder="Örn. 0 veya belgedeki oran"
          />
        </label>
        <WalletField />
        <label>
          Gider açıklaması
          <input name="description" required minLength={5} maxLength={500} />
        </label>
        <label>
          Belge referansı
          <input name="reference" maxLength={150} />
        </label>
      </>
    );
  if (modal.kind === "transfer")
    content = (
      <>
        <label>
          Çıkış hesabı
          <select name="from" aria-label="Çıkış hesabı">
            <option value="BANK">Banka → Merkez kasa</option>
            <option value="CASH_SAFE">Merkez kasa → Banka</option>
          </select>
        </label>
        <AmountField name="amount" label="Transfer tutarı (TL)" />
        <label>
          Transfer açıklaması
          <input name="description" required minLength={5} maxLength={500} />
        </label>
        <p className="ma-hint">
          İşletme içi transfer gelir veya gider oluşturmaz.
        </p>
      </>
    );
  if (modal.kind === "capital")
    content = (
      <>
        <AmountField name="amount" label="Kaynak giriş tutarı (TL)" />
        <WalletField />
        <label>
          Kaynağın açıklaması
          <input name="description" required minLength={5} maxLength={500} />
        </label>
        <p className="ma-hint">
          Bu işlem sermaye/işletme kaynağıdır; satış geliri sayılmaz.
        </p>
      </>
    );
  if (modal.kind === "bank") {
    let net: string = "—";
    try {
      net = money(parseMoney(gross) - parseMoney(fee));
    } catch {}
    content = (
      <>
        <label>
          Bankaya geçen brüt kart tutarı (TL)
          <input
            name="gross"
            inputMode="decimal"
            value={gross}
            onChange={e => setGross(e.target.value)}
            required
          />
        </label>
        <label>
          Banka komisyonu (TL)
          <input
            name="fee"
            inputMode="decimal"
            value={fee}
            onChange={e => setFee(e.target.value)}
            required
          />
        </label>
        <div className="ma-form-summary">
          Bankaya net giriş<strong>{net}</strong>
        </div>
        <label>
          Banka işlem referansı
          <input name="reference" required minLength={3} maxLength={150} />
        </label>
        <p className="ma-hint">
          Banka hareketini kontrol ederek kaydedin. Uygulama bankaya bağlanıp
          teyit almaz.
        </p>
      </>
    );
  }
  if (modal.kind === "reverse")
    content = (
      <>
        <div className="ma-form-summary">
          <b>
            #{modal.entry.number} · {modal.entry.description}
          </b>
          <span>Asıl kayıt korunur; ters yönlü yeni fiş oluşur.</span>
        </div>
        <label>
          Ters kayıt açıklaması
          <textarea name="reason" minLength={5} maxLength={500} required />
        </label>
        <p className="ma-hint">
          Tahsilat/ödeme ters kaydında ilgili belge dağılımları da geri alınır.
          Bu işlem bankadan otomatik para iadesi yapmaz.
        </p>
      </>
    );
  return (
    <Dialog
      open
      onOpenChange={open => {
        if (!open) close();
      }}
    >
      <DialogContent className="ma-dialog">
        <DialogTitle>{titles[modal.kind]}</DialogTitle>
        <DialogDescription>
          İşlem market defterine kullanıcı ve zamanı ile kaydedilir.
        </DialogDescription>
        <form
          onSubmit={async e => {
            e.preventDefault();
            setLocalError("");
            try {
              const f = new FormData(e.currentTarget);
              let path = "",
                body: Record<string, unknown> = {};
              if (modal.kind === "party") {
                path = modal.party
                  ? "/market-accounting/party-update"
                  : "/market-accounting/party";
                body = {
                  ...(modal.party
                    ? { partyId: modal.party.id }
                    : {
                        kind: partyKind,
                        openingReceivableMinor: amount(f, "ar"),
                        openingPayableMinor: amount(f, "ap"),
                        openingNote: f.get("openingNote"),
                      }),
                  name: f.get("name"),
                  taxNumber: f.get("tax"),
                  receivableLimitMinor: amount(f, "arLimit"),
                  payableLimitMinor:
                    String(f.get("apLimit") ?? "").trim() === ""
                      ? null
                      : amount(f, "apLimit"),
                  termDays: num(f, "term"),
                };
              }
              if (modal.kind === "settlement") {
                path = "/market-accounting/settlement";
                body = {
                  partyId: modal.party.id,
                  direction: modal.direction,
                  amountMinor: amount(f, "amount"),
                  wallet: f.get("wallet"),
                  description: f.get("description"),
                  reference: f.get("reference"),
                };
              }
              if (modal.kind === "product") {
                path = "/market-accounting/product";
                body = {
                  productId: modal.product.id,
                  salePriceMinor: amount(f, "price"),
                  vatBps: uiVat(String(f.get("vat"))),
                };
              }
              if (modal.kind === "stock") {
                path = "/market-accounting/stock-adjust";
                body = {
                  productId: modal.product.id,
                  expectedQty: modal.product.quantity,
                  countedQty: num(f, "counted"),
                  unitNetMinor: amount(f, "cost"),
                  description: f.get("description"),
                };
              }
              if (modal.kind === "new-product") {
                path = "/product";
                body = {
                  name: f.get("name"),
                  barcode: f.get("barcode"),
                  minimumQty: num(f, "minimum"),
                  purchasePriceMinor: 0,
                  salePriceMinor: amount(f, "price"),
                  supplierId: null,
                };
              }
              if (modal.kind === "expense") {
                path = "/market-accounting/expense";
                body = {
                  netMinor: amount(f, "net"),
                  vatBps: uiVat(String(f.get("vat"))),
                  wallet: f.get("wallet"),
                  description: f.get("description"),
                  reference: f.get("reference"),
                };
              }
              if (modal.kind === "transfer") {
                path = "/market-accounting/transfer";
                body = {
                  from: f.get("from"),
                  amountMinor: amount(f, "amount"),
                  description: f.get("description"),
                };
              }
              if (modal.kind === "capital") {
                path = "/market-accounting/capital";
                body = {
                  amountMinor: amount(f, "amount"),
                  wallet: f.get("wallet"),
                  description: f.get("description"),
                };
              }
              if (modal.kind === "bank") {
                path = "/market-accounting/bank-settlement";
                body = {
                  grossMinor: amount(f, "gross"),
                  feeMinor: amount(f, "fee"),
                  reference: f.get("reference"),
                };
              }
              if (modal.kind === "reverse") {
                path = "/market-accounting/reverse";
                body = { entryId: modal.entry.id, reason: f.get("reason") };
              }
              if (await action(path, body)) close();
            } catch (e) {
              setLocalError((e as Error).message);
            }
          }}
        >
          <fieldset disabled={locked}>
            {content}
            {(localError || error) && (
              <p role="alert" className="ma-error">
                {localError || error}
              </p>
            )}
            <div className="ma-dialog-actions">
              <button
                type="button"
                className="btn"
                disabled={locked}
                onClick={close}
              >
                Vazgeç
              </button>
              <button className="btn primary" disabled={locked}>
                {locked ? "Kaydediliyor…" : "Kaydı oluştur"}
              </button>
            </div>
          </fieldset>
        </form>
      </DialogContent>
    </Dialog>
  );
}

type PurchaseLine = {
  id: string;
  productId: string;
  quantity: string;
  net: string;
  vat: string;
};
export function MarketPurchase({
  data,
  locked,
  error,
  action,
}: {
  data: MarketAccountingState;
  locked: boolean;
  error: string;
  action: MarketAction;
}) {
  const fresh = (): PurchaseLine => ({
    id: newRequestId(),
    productId: "",
    quantity: "1",
    net: "0,00",
    vat: "",
  });
  const [draft, setDraft] = useState<PurchaseLine[]>(() => [fresh()]),
    [localError, setLocalError] = useState(""),
    [dueDate, setDueDate] = useState(data.today),
    [key, setKey] = useState(0);
  const change = (id: string, fields: Partial<PurchaseLine>) =>
    setDraft(ls => ls.map(l => (l.id === id ? { ...l, ...fields } : l)));
  let preview: {
    net: number;
    vat: number;
    total: number;
    lines: {
      productId: string;
      quantity: number;
      unitNetMinor: number;
      vatBps: number;
    }[];
  } | null = null;
  try {
    let net = 0,
      tax = 0;
    const seen = new Set<string>();
    const lines = draft.map(l => {
      if (!l.productId || seen.has(l.productId))
        throw Error("Ürün satırları seçilmeli ve tekrarlanmamalı.");
      seen.add(l.productId);
      const q = Number(l.quantity),
        cost = parseMoney(l.net),
        v = uiVat(l.vat);
      if (!Number.isSafeInteger(q) || q < 1 || q > 10000)
        throw Error("Adet 1–10.000 olmalıdır.");
      const n = q * cost;
      if (!Number.isSafeInteger(n)) throw Error("Tutar sınırı aşılıyor.");
      const t = Number((BigInt(n) * BigInt(v) + 5000n) / 10000n);
      net += n;
      tax += t;
      if (!Number.isSafeInteger(net + tax))
        throw Error("Toplam sınırı aşılıyor.");
      return {
        productId: l.productId,
        quantity: q,
        unitNetMinor: cost,
        vatBps: v,
      };
    });
    preview = { net, vat: tax, total: net + tax, lines };
  } catch {
    /* Complete rows before showing an invoice total. */
  }
  return (
    <section className="ma-panel">
      <div className="ma-panel-head">
        <div>
          <h2>Alış ve mal kabul</h2>
          <p>Stok, alış KDV’si ve tedarikçi borcu tek kayıtla oluşur.</p>
        </div>
      </div>
      <form
        key={key}
        onSubmit={async e => {
          e.preventDefault();
          setLocalError("");
          try {
            if (!preview)
              throw Error(
                "Ürün, adet, birim maliyet ve KDV alanlarını tamamlayın."
              );
            const f = new FormData(e.currentTarget);
            if (
              await action("/market-accounting/purchase", {
                partyId: f.get("party"),
                reference: f.get("reference"),
                dueDate: f.get("due"),
                expectedTotalMinor: preview.total,
                lines: preview.lines,
              })
            ) {
              setDraft([fresh()]);
              setDueDate(data.today);
              setKey(n => n + 1);
            }
          } catch (e) {
            setLocalError((e as Error).message);
          }
        }}
      >
        <fieldset disabled={locked}>
          <div className="ma-form-grid">
            <label>
              Tedarikçi
              <select
                name="party"
                aria-label="Tedarikçi"
                required
                onChange={e => {
                  const party = data.parties.find(p => p.id === e.target.value),
                    date = new Date(data.today + "T12:00:00Z");
                  date.setUTCDate(date.getUTCDate() + (party?.termDays ?? 0));
                  setDueDate(date.toISOString().slice(0, 10));
                }}
              >
                <option value="">Tedarikçi seçin</option>
                {data.parties
                  .filter(p => p.kind !== "CUSTOMER")
                  .map(p => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
              </select>
            </label>
            <label>
              Alış belge no
              <input name="reference" required maxLength={100} />
            </label>
            <label>
              Vade tarihi
              <input
                name="due"
                type="date"
                value={dueDate}
                onChange={e => setDueDate(e.target.value)}
                required
              />
            </label>
          </div>
          <div className="ma-purchase-lines">
            {draft.map(l => (
              <div className="ma-purchase-line" key={l.id}>
                <label>
                  Ürün
                  <select
                    value={l.productId}
                    aria-label="Ürün"
                    required
                    onChange={e => {
                      const p = data.stock.find(p => p.id === e.target.value);
                      change(l.id, {
                        productId: e.target.value,
                        net: amountInput(p?.averageCostMinor ?? 0),
                        vat: p?.vatBps == null ? "" : String(p.vatBps / 100),
                      });
                    }}
                  >
                    <option value="">Ürün seçin</option>
                    {data.stock.map(p => (
                      <option key={p.id} value={p.id}>
                        {p.name} · {p.barcode}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Adet
                  <input
                    type="number"
                    min={1}
                    max={10000}
                    step={1}
                    value={l.quantity}
                    onChange={e => change(l.id, { quantity: e.target.value })}
                    required
                  />
                </label>
                <label>
                  Birim maliyet · KDV hariç
                  <input
                    inputMode="decimal"
                    value={l.net}
                    onChange={e => change(l.id, { net: e.target.value })}
                    required
                  />
                </label>
                <label>
                  Alış KDV (%)
                  <input
                    inputMode="decimal"
                    value={l.vat}
                    onChange={e => change(l.id, { vat: e.target.value })}
                    required
                  />
                </label>
                <button
                  type="button"
                  className="btn"
                  disabled={locked || draft.length === 1}
                  aria-label="Alış satırını kaldır"
                  onClick={() => setDraft(ls => ls.filter(x => x.id !== l.id))}
                >
                  ×
                </button>
              </div>
            ))}
          </div>
          <button
            type="button"
            className="btn"
            disabled={locked || draft.length >= 100}
            onClick={() => setDraft(ls => [...ls, fresh()])}
          >
            + Ürün satırı
          </button>
          <div className="ma-purchase-total">
            <span>
              KDV hariç <b>{preview ? money(preview.net) : "—"}</b>
            </span>
            <span>
              KDV <b>{preview ? money(preview.vat) : "—"}</b>
            </span>
            <span>
              Belge toplamı{" "}
              <strong>{preview ? money(preview.total) : "—"}</strong>
            </span>
          </div>
          {(localError || error) && (
            <p role="alert" className="ma-error">
              {localError || error}
            </p>
          )}
          <button
            className="btn primary"
            disabled={locked || !preview || preview.total <= 0}
          >
            Mal kabulü ve cari borcu kaydet
          </button>
          <p className="ma-hint">
            Ödeme ayrıca cari kartından kaydedilir. Bu belge resmî e-Fatura
            düzenlemez.
          </p>
        </fieldset>
      </form>
    </section>
  );
}

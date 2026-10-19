import { useEffect, useRef, useState, type FormEvent } from "react";
import { RefreshCw, Search, Undo2, FileDown } from "lucide-react";
import type {
  MarketAccountingState,
  MarketReturnSource,
  MarketReturnSummary,
} from "@shared/market-accounting";
import { returnAmounts } from "@shared/market-return-math";
import { money } from "@shared/station";
import {
  loadMarketReturnSource,
  loadMarketReturnSources,
} from "@/lib/station-api";
import { marketCsv } from "./MarketStatement";

const round = (value: number, q: number, total: number) =>
  Number((BigInt(value) * BigInt(q) + BigInt(total) / 2n) / BigInt(total));
export function MarketReturns({
  stationId,
  data,
  locked,
  readLocked,
  canWrite,
  action,
}: {
  stationId: string;
  data: MarketAccountingState;
  locked: boolean;
  readLocked: boolean;
  canWrite: boolean;
  action: (path: string, payload: Record<string, unknown>) => Promise<boolean>;
}) {
  const [kind, setKind] = useState<"POS_SALE" | "PURCHASE">("POS_SALE"),
    [from, setFrom] = useState(data.startedOn ?? data.today),
    [to, setTo] = useState(data.today),
    [q, setQ] = useState(""),
    [cursors, setCursors] = useState([0]),
    [list, setList] = useState<{
      rows: MarketReturnSummary[];
      nextCursor: number | null;
    } | null>(null),
    [source, setSource] = useState<MarketReturnSource | null>(null),
    [quantities, setQuantities] = useState<Record<string, string>>({}),
    [wallet, setWallet] = useState("CASH_SAFE"),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(false);
  const [returnLot, setReturnLot] = useState<Record<string, string>>({});
  const sequence = useRef(0);
  useEffect(() => {
    void search(0);
    return () => {
      sequence.current++;
    };
  }, [kind]);
  async function search(cursor: number) {
    const seq = ++sequence.current;
    setLoading(true);
    setError("");
    setSource(null);
    try {
      const result = await loadMarketReturnSources(
        stationId,
        kind,
        from,
        to,
        q.trim(),
        cursor
      );
      if (seq === sequence.current) setList(result);
    } catch (e) {
      if (seq === sequence.current) {
        setError((e as Error).message);
        setList(null);
      }
    } finally {
      if (seq === sequence.current) setLoading(false);
    }
  }
  async function select(id: string) {
    const seq = ++sequence.current;
    setLoading(true);
    setError("");
    try {
      const result = await loadMarketReturnSource(stationId, id);
      if (seq === sequence.current) {
        setSource(result);
        setQuantities({});
        setReturnLot({});
      }
    } catch (e) {
      if (seq === sequence.current) setError((e as Error).message);
    } finally {
      if (seq === sequence.current) setLoading(false);
    }
  }
  let preview: {
    gross: number;
    net: number;
    vat: number;
    cost: number;
    credit: number;
    refund: number;
    lines: {
      productId: string;
      quantity: number;
      lots?: { lotId: string; quantity: number }[];
    }[];
  } | null = null;
  let previewError = "";
  if (source) {
    try {
      let gross = 0,
        net = 0,
        vat = 0,
        cost = 0;
      const lines = [];
      for (const l of source.items) {
        const qty = Number(quantities[l.productId] || 0);
        if (!Number.isSafeInteger(qty) || qty < 0)
          throw Error("İade adedi sıfır veya pozitif tamsayı olmalıdır.");
        if (!qty) continue;
        if (source.kind === "PURCHASE" && qty > l.stockQuantity)
          throw Error(`${l.name}: mevcut stok yetersiz.`);
        const amount = returnAmounts(
          l,
          {
            quantity: l.returnedQuantity,
            grossMinor: l.returnedGrossMinor,
            netMinor: l.returnedNetMinor,
          },
          qty
        );
        const lineCost =
          source.kind === "POS_SALE"
            ? round(l.costMinor, l.returnedQuantity + qty, l.quantity) -
              l.returnedCostMinor
            : round(l.stockValueMinor, qty, l.stockQuantity);
        gross += amount.grossMinor;
        net += amount.netMinor;
        vat += amount.vatMinor;
        cost += lineCost;
        if (![gross, net, vat, cost].every(Number.isSafeInteger))
          throw Error("İade toplamı güvenli tutarı aşıyor.");
        const lot =
          source.kind === "PURCHASE" && l.lotTracking
            ? l.lots.find(x => x.id === returnLot[l.productId])
            : null;
        if (
          source.kind === "PURCHASE" &&
          l.lotTracking &&
          (!lot || lot.quantity < qty)
        )
          throw Error(
            `${l.name}: iade miktarını karşılayan gerçek partiyi seçin.`
          );
        lines.push({
          productId: l.productId,
          quantity: qty,
          ...(lot ? { lots: [{ lotId: lot.id, quantity: qty }] } : {}),
        });
      }
      if (lines.length) {
        const credit = Math.min(gross, source.openDocumentMinor);
        preview = {
          gross,
          net,
          vat,
          cost,
          credit,
          refund: gross - credit,
          lines,
        };
      }
    } catch (e) {
      previewError = (e as Error).message;
    }
  }
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!preview || !source || locked || loading || !canWrite) return;
    const f = new FormData(e.currentTarget);
    const ok = await action("/market-accounting/return", {
      sourceEntryId: source.id,
      expectedRevision: source.revision,
      lines: preview.lines,
      expectedTotalMinor: preview.gross,
      expectedCreditedMinor: preview.credit,
      expectedCostMinor: preview.cost,
      wallet,
      reference: f.get("reference"),
      reason: f.get("reason"),
      moneyConfirmed: f.get("moneyConfirmed") === "on",
    });
    if (ok) {
      setSource(null);
      setCursors([0]);
      void search(0);
    }
  }
  return (
    <>
      <section className="ma-panel ma-return-panel">
        <div className="ma-panel-head">
          <div>
            <h2>Kaynak belgeli satış ve alış iadeleri</h2>
            <p>
              İade adedini ilk belgeden seçin. Stok, maliyet, KDV ve cari aynı
              işlemde güncellenir.
            </p>
          </div>
          <Undo2 size={22} />
        </div>
        <form
          onSubmit={e => {
            e.preventDefault();
            setCursors([0]);
            void search(0);
          }}
        >
          <fieldset disabled={readLocked || loading}>
            <div className="ma-form-grid">
              <label>
                İade türü
                <select
                  aria-label="İade türü"
                  value={kind}
                  onChange={e => {
                    setKind(e.target.value as typeof kind);
                    setCursors([0]);
                  }}
                >
                  <option value="POS_SALE">Müşteriden satış iadesi</option>
                  <option value="PURCHASE">Tedarikçiye alış iadesi</option>
                </select>
              </label>
              <label>
                Belge başlangıç tarihi
                <input
                  type="date"
                  aria-label="İade belge başlangıç tarihi"
                  value={from}
                  onChange={e => setFrom(e.target.value)}
                  required
                />
              </label>
              <label>
                Belge bitiş tarihi
                <input
                  type="date"
                  aria-label="İade belge bitiş tarihi"
                  value={to}
                  onChange={e => setTo(e.target.value)}
                  required
                />
              </label>
              <label>
                Belge / satış kimliği veya cari
                <input
                  aria-label="İade kaynak belge ara"
                  value={q}
                  onChange={e => setQ(e.target.value)}
                  maxLength={100}
                  placeholder="Belge no, satış kimliği veya cari"
                />
              </label>
            </div>
            <button className="btn">
              <Search size={16} />
              Belgeleri bul
            </button>
          </fieldset>
        </form>
        {loading && <p role="status">Belge yükleniyor…</p>}
        {error && (
          <p role="alert" className="ma-error">
            {error}
          </p>
        )}
        {list && (
          <>
            <div className="ma-table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Tarih / Fiş</th>
                    <th>Kaynak belge / Cari</th>
                    <th>Brüt tutar</th>
                    <th>İşlem</th>
                  </tr>
                </thead>
                <tbody>
                  {list.rows.map(s => (
                    <tr key={s.id}>
                      <td>
                        {s.date}
                        <small>#{s.number}</small>
                      </td>
                      <td>
                        <b>{s.reference ?? s.id}</b>
                        <small>{s.partyName ?? "Peşin / kartlı satış"}</small>
                      </td>
                      <td>{money(s.grossMinor)}</td>
                      <td>
                        <button
                          type="button"
                          className="btn"
                          disabled={readLocked || loading}
                          onClick={() => void select(s.id)}
                        >
                          İade satırlarını aç
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!list.rows.length && (
              <p className="ma-empty">
                Bu filtrede muhasebeleştirilmiş kaynak belge yok. Açılıştan
                önceki satışlar bu listede yer almaz.
              </p>
            )}
            <div className="ma-row-actions">
              <button
                className="btn"
                disabled={readLocked || loading || cursors.length < 2}
                onClick={() => {
                  const next = cursors.slice(0, -1);
                  setCursors(next);
                  void search(next.at(-1)!);
                }}
              >
                Önceki belgeler
              </button>
              <button
                className="btn"
                disabled={readLocked || loading || list.nextCursor === null}
                onClick={() => {
                  if (list.nextCursor !== null) {
                    setCursors([...cursors, list.nextCursor]);
                    void search(list.nextCursor);
                  }
                }}
              >
                Sonraki belgeler
              </button>
              <small>
                Sayfa başına 50 belge · tarih aralığı değiştirilebilir
              </small>
            </div>
          </>
        )}
        {!canWrite && (
          <p className="ma-hint">
            İade kaydı firma sahibi veya muhasebeci tarafından yapılır.
          </p>
        )}
      </section>
      {source && (
        <section className="ma-panel">
          <div className="ma-panel-head">
            <div>
              <h2>İade önizlemesi · #{source.number}</h2>
              <p>
                {source.reference} · {source.date} ·{" "}
                {source.partyName ?? "Peşin / kartlı satış"}
              </p>
            </div>
            <button
              className="btn"
              disabled={readLocked || loading}
              onClick={() => void select(source.id)}
            >
              <RefreshCw size={16} />
              Belgeyi yenile
            </button>
          </div>
          <form key={source.id} onSubmit={submit}>
            <fieldset disabled={locked || loading || !canWrite}>
              <div className="ma-table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Ürün / Barkod</th>
                      <th>Belge adedi</th>
                      <th>Önceki iade</th>
                      <th>Kalan</th>
                      <th>İade adedi</th>
                    </tr>
                  </thead>
                  <tbody>
                    {source.items.map(l => (
                      <tr key={l.productId}>
                        <td>
                          <b>{l.name}</b>
                          <small>{l.barcode}</small>
                          {source.kind === "PURCHASE" && (
                            <small>Mevcut stok: {l.stockQuantity}</small>
                          )}
                        </td>
                        <td>{l.quantity}</td>
                        <td>{l.returnedQuantity}</td>
                        <td>{l.quantity - l.returnedQuantity}</td>
                        <td>
                          <input
                            className="ma-return-quantity"
                            type="number"
                            min="0"
                            max={
                              source.kind === "PURCHASE"
                                ? Math.min(
                                    l.stockQuantity,
                                    l.quantity - l.returnedQuantity
                                  )
                                : l.quantity - l.returnedQuantity
                            }
                            step="1"
                            aria-label={`${l.name} iade adedi`}
                            value={quantities[l.productId] ?? "0"}
                            onChange={e =>
                              setQuantities({
                                ...quantities,
                                [l.productId]: e.target.value,
                              })
                            }
                          />
                          {source.kind === "PURCHASE" && l.lotTracking && (
                            <label>
                              İade partisi
                              <select
                                aria-label={`${l.name} iade partisi`}
                                value={returnLot[l.productId] ?? ""}
                                onChange={e =>
                                  setReturnLot({
                                    ...returnLot,
                                    [l.productId]: e.target.value,
                                  })
                                }
                              >
                                <option value="">Gerçek partiyi seçin</option>
                                {l.lots.map(x => (
                                  <option key={x.id} value={x.id}>
                                    {x.code} ·{" "}
                                    {x.expiryDate ?? "SKT bilinmiyor"} ·{" "}
                                    {x.quantity} adet ·{" "}
                                    {x.status === "QUARANTINE"
                                      ? "Karantina"
                                      : "Stok"}
                                  </option>
                                ))}
                              </select>
                            </label>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="ma-hint">
                Lot takibi açık müşteri iadeleri kontrol için SKT'siz
                karantinaya alınır; doğrudan satılamaz. Takibi kapalı üründe
                yalnız tekrar satılabilir ürün seçin. Tedarikçi iadesinde gerçek
                partiyi seçin; bir satırda tek parti seçilebilir.
              </p>
              {previewError && (
                <p role="alert" className="ma-error">
                  {previewError}
                </p>
              )}
              {preview && (
                <>
                  <dl className="ma-totals">
                    <div>
                      <dt>KDV hariç iade / KDV</dt>
                      <dd>
                        {money(preview.net)} / {money(preview.vat)}
                      </dd>
                    </div>
                    <div>
                      <dt>Toplam iade</dt>
                      <dd>{money(preview.gross)}</dd>
                    </div>
                    <div>
                      <dt>Kaynak belgenin açık borcundan düşülecek</dt>
                      <dd>{money(preview.credit)}</dd>
                    </div>
                    <div>
                      <dt>
                        {source.kind === "POS_SALE"
                          ? "Müşteriye geri ödenecek"
                          : "Tedarikçiden geri alınacak"}
                      </dt>
                      <dd>{money(preview.refund)}</dd>
                    </div>
                    <div>
                      <dt>
                        Stok maliyeti{" "}
                        {source.kind === "POS_SALE" ? "artışı" : "azalışı"}
                      </dt>
                      <dd>{money(preview.cost)}</dd>
                    </div>
                    {source.kind === "PURCHASE" && (
                      <div>
                        <dt>
                          Alış iadesi maliyet farkı · gider (+) / gelir (−)
                        </dt>
                        <dd>{money(preview.cost - preview.net)}</dd>
                      </div>
                    )}
                  </dl>
                  <div className="ma-form-grid">
                    <label>
                      İade belge no
                      <input
                        name="reference"
                        required
                        maxLength={100}
                        placeholder="Örn. IADE-2026-001"
                      />
                    </label>
                    <label>
                      İade açıklaması
                      <input
                        name="reason"
                        required
                        minLength={5}
                        maxLength={500}
                      />
                    </label>
                    {preview.refund > 0 && (
                      <label>
                        Para hareketi hesabı
                        <select
                          aria-label="İade para hesabı"
                          value={wallet}
                          onChange={e => setWallet(e.target.value)}
                        >
                          <option value="CASH_SAFE">Merkez kasa</option>
                          <option value="BANK">Banka · manuel kayıt</option>
                        </select>
                      </label>
                    )}
                  </div>
                  {preview.refund > 0 && (
                    <label className="ma-check">
                      <input
                        key={`${source.id}:${preview.refund}:${wallet}`}
                        type="checkbox"
                        name="moneyConfirmed"
                        required
                      />
                      {source.kind === "POS_SALE"
                        ? "Müşteriye belirtilen tutarı seçtiğim hesaptan geri ödedim."
                        : "Tedarikçiden belirtilen tutarı seçtiğim hesaba geri aldım."}
                    </label>
                  )}
                  <p className="ma-hint">
                    İade bugünün defterine yazılır. Bankadan otomatik işlem
                    yapılmaz; kart alacağı bu kayıtla kendiliğinden kapanmaz.
                    İade belgesi kaydedildikten sonra genel ters fişle
                    silinemez.
                  </p>
                  <button
                    className="btn primary"
                    disabled={locked || loading || !canWrite}
                  >
                    <Undo2 size={16} />
                    İadeyi kaydet
                  </button>
                </>
              )}
            </fieldset>
          </form>
        </section>
      )}
      <section className="ma-panel">
        <div className="ma-panel-head">
          <div>
            <h2>Kaydedilmiş iadeler</h2>
            <p>Son 50 iade · kaynak belge ve para hareketi ayrı izlenir.</p>
          </div>
          <button
            className="btn"
            onClick={() =>
              marketCsv("market-iadeler.csv", [
                [
                  "Tarih",
                  "Tür",
                  "İade no",
                  "Kaynak belge",
                  "Açıklama",
                  "Toplam TL",
                  "Cari mahsup TL",
                  "Para hareketi TL",
                  "Hesap",
                ],
                ...data.returns.map(r => [
                  r.date,
                  r.kind === "SALE_RETURN" ? "Satış iadesi" : "Alış iadesi",
                  r.reference,
                  r.sourceReference,
                  r.reason,
                  r.grossMinor / 100,
                  r.creditedMinor / 100,
                  r.refundMinor / 100,
                  r.wallet,
                ]),
              ])
            }
          >
            <FileDown size={16} />
            Görünen iadeleri CSV indir
          </button>
        </div>
        <div className="ma-table-wrap">
          <table>
            <thead>
              <tr>
                <th>Tarih / Tür</th>
                <th>İade / Kaynak belge</th>
                <th>Toplam</th>
                <th>Cari mahsup</th>
                <th>Para hareketi</th>
                <th>Açıklama</th>
              </tr>
            </thead>
            <tbody>
              {data.returns.map(r => (
                <tr key={r.id}>
                  <td>
                    {r.date}
                    <small>
                      {r.kind === "SALE_RETURN"
                        ? "Satış iadesi"
                        : "Alış iadesi"}
                    </small>
                  </td>
                  <td>
                    <b>{r.reference}</b>
                    <small>{r.sourceReference}</small>
                  </td>
                  <td>{money(r.grossMinor)}</td>
                  <td>{money(r.creditedMinor)}</td>
                  <td>
                    {money(r.refundMinor)}
                    <small>
                      {r.wallet === "BANK"
                        ? "Banka · manuel"
                        : r.wallet === "CASH_SAFE"
                          ? "Merkez kasa"
                          : "Para hareketi yok"}
                    </small>
                  </td>
                  <td>{r.reason}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!data.returns.length && (
          <p className="ma-empty">Henüz kaydedilmiş iade yok.</p>
        )}
      </section>
    </>
  );
}

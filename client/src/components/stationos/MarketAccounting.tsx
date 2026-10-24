import { ShelfLabels } from "./ShelfLabels";
import { PurchaseOrders } from "./PurchaseOrders";
import { CountReports } from "./CountReports";
import { InventoryManagement } from "./InventoryManagement";
import { CatalogImport } from "./CatalogImport";
import { InventoryLots } from "./InventoryLots";
import { MonthlyMarketReport } from "./MonthlyMarketReport";
import { useState } from "react";
import {
  BookOpen,
  Package,
  Users,
  Wallet,
  CalendarCheck,
  ArrowDownLeft,
  ArrowUpRight,
  Plus,
  RefreshCw,
  FileDown,
  CheckCircle2,
  AlertTriangle,
  Search,
  Receipt,
  Undo2,
} from "lucide-react";
import type { AppState } from "@shared/station";
import { money, parseMoney } from "@shared/station";
import {
  marketAccounts,
  type MarketParty,
  type MarketAccountingState,
} from "@shared/market-accounting";
import { useMarketAccounting } from "./useMarketAccounting";
import { MarketReturns } from "./MarketReturns";
import {
  MarketAccountingDialog,
  MarketPurchase,
  StartMarketBook,
  AmountField,
  type AccountingModal,
} from "./MarketAccountingForms";
import {
  MarketStatement,
  marketCsv,
  marketKindLabels,
} from "./MarketStatement";
import "./market-accounting.css";
import "./inventory.css";
const tabs = [
  ["overview", "Özet", BookOpen],
  ["stock", "Stok ve fiyat", Package],
  ["shelf", "Raf etiketleri", Package],
  ["catalog", "Ürün aktarımı", Package],
  ["lots", "Lot ve SKT", Package],
  ["counts", "Sayım raporları", Package],
  ["monthly", "Aylık kâr–zarar", BookOpen],
  ["orders", "Satın alma siparişleri", Package],
  ["purchase", "Alış ve mal kabul", Receipt],
  ["returns", "İadeler", Undo2],
  ["parties", "Cariler", Users],
  ["money", "Kasa ve banka", Wallet],
  ["dayend", "Gün sonu", CalendarCheck],
  ["journal", "Hareket defteri", BookOpen],
] as const;
type Tab = (typeof tabs)[number][0];
function Metric({
  label,
  value,
  detail,
  tone = "",
}: {
  label: string;
  value: string;
  detail: string;
  tone?: string;
}) {
  return (
    <div className={`ma-metric ${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{detail}</small>
    </div>
  );
}
export default function MarketAccounting(props: {
  state: AppState;
  stationId: string;
}) {
  return (
    <MarketAccountingWorkspace
      key={`${props.state.user.id}:${props.stationId}`}
      {...props}
    />
  );
}
function MarketAccountingWorkspace({
  state,
  stationId,
}: {
  state: AppState;
  stationId: string;
}) {
  const w = useMarketAccounting(state, stationId),
    d = w.data;
  const [tab, setTab] = useState<Tab>("overview"),
    [modal, setModal] = useState<AccountingModal | null>(null),
    [statement, setStatement] = useState<MarketParty | null>(null),
    [search, setSearch] = useState("");
  const canClose = ["OWNER", "ACCOUNTANT"].includes(state.member?.role ?? ""),
    owner = state.member?.role === "OWNER",
    canProduct = ["OWNER", "MANAGER"].includes(state.member?.role ?? "");
  const locked = w.locked || !!d?.closedToday;
  if (!stationId)
    return (
      <div className="notice">
        Market ön muhasebesi için üst menüden bir istasyon seçin.
      </div>
    );
  if (!w.canRead)
    return (
      <div className="notice">
        Market ön muhasebesi firma sahibi, yönetici ve muhasebeciye açıktır.
        Kasiyerler satış ekranından işlem yapabilir.
      </div>
    );
  const balance = (code: keyof typeof marketAccounts) => d?.balances[code] ?? 0;
  const stock =
    d?.stock
      .filter(p =>
        `${p.name} ${p.barcode}`
          .toLocaleLowerCase("tr-TR")
          .includes(search.toLocaleLowerCase("tr-TR"))
      )
      .slice(0, 100) ?? [];
  const parties =
    d?.parties
      .filter(p =>
        `${p.name} ${p.taxNumber ?? ""}`
          .toLocaleLowerCase("tr-TR")
          .includes(search.toLocaleLowerCase("tr-TR"))
      )
      .slice(0, 100) ?? [];
  return (
    <div className="ma-root">
      <header className="ma-header">
        <div>
          <span className="ma-eyebrow">MARKET ÖN MUHASEBE</span>
          <h1>Marketin tüm hesabı, aynı defterde.</h1>
          <p>Stok maliyeti, ticari cari, tahsilat ve gün sonu.</p>
        </div>
        <div className="ma-header-actions">
          <label>
            Rapor tarihi
            <input
              type="date"
              value={w.date}
              disabled={w.locked || tab === "dayend"}
              onChange={e => setDateSafely(e.target.value)}
            />
          </label>
          <button
            className="btn"
            onClick={() => void w.refresh().catch(() => {})}
          >
            <RefreshCw size={16} />
            Yenile
          </button>
        </div>
      </header>
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
        <div className="notice warning ma-pending">
          <span>
            Sonucu beklenen mali istek var. Yeni işlemden önce aynı isteği
            kontrol edin.
          </span>
          <button
            className="btn"
            disabled={w.busy}
            onClick={() => void w.retry()}
          >
            Aynı muhasebe isteğini kontrol et
          </button>
        </div>
      )}
      {!d && <p>Market hesapları yükleniyor…</p>}
      {d &&
        !d.enabled &&
        (owner ? (
          <StartMarketBook
            data={d}
            locked={w.locked}
            error={w.error}
            action={w.action}
          />
        ) : (
          <div className="notice">
            Market defteri henüz başlamadı. Açılışı firma sahibi yapabilir.
          </div>
        ))}
      {d && !d.enabled && (
        <CatalogImport
          stationId={stationId}
          csrfToken={state.csrfToken}
          isDemo={state.tenant?.isDemo ?? false}
          closedToday={d.closedToday}
          locked={w.locked}
          canWrite={canProduct}
          action={w.action}
        />
      )}
      {d?.enabled && (
        <>
          <nav className="ma-tabs" aria-label="Market muhasebe bölümleri">
            {tabs.map(([id, label, Icon]) => (
              <button
                key={id}
                disabled={w.locked}
                aria-pressed={tab === id}
                className={tab === id ? "selected" : ""}
                onClick={() => {
                  setTab(id);
                  setSearch("");
                  if (id === "dayend") w.setDate(d.today);
                }}
              >
                <Icon size={16} />
                {label}
              </button>
            ))}
          </nav>
          {d.closedToday && (
            <div className="notice">
              Bugünün gün sonu kapalı. Yeni mali kayıtlar sonraki takvim gününde
              alınır. Kaydedilmiş raporları inceleyebilirsiniz.
            </div>
          )}
          {tab === "overview" && (
            <>
              <div className="ma-metrics">
                <Metric
                  label="İade sonrası net satış"
                  value={money(d.daily.salesNetMinor)}
                  detail={`${d.daily.date} · ${d.daily.saleCount} satış`}
                />
                <Metric
                  label="Brüt kâr"
                  value={money(d.daily.grossProfitMinor)}
                  detail={`Satılan mal maliyeti ${money(d.daily.cogsMinor)}`}
                  tone="green"
                />
                <Metric
                  label="Operasyonel sonuç"
                  value={money(d.daily.operatingResultMinor)}
                  detail="Satış − maliyet − gider + sayım farkları"
                />
                <Metric
                  label="Stok maliyet değeri"
                  value={money(d.stockValueMinor)}
                  detail="Güncel, KDV hariç ağırlıklı maliyet"
                />
              </div>
              <section className="ma-panel">
                <div className="ma-panel-head">
                  <div>
                    <h2>Para ve cari bakiyeleri</h2>
                    <p>
                      Güncel kayıt bakiyeleri. Banka ve kart hareketleri manuel
                      beyana dayanır.
                    </p>
                  </div>
                  <button className="btn" onClick={() => setTab("money")}>
                    Hesapları aç <ArrowUpRight size={15} />
                  </button>
                </div>
                <div className="ma-wallet-grid">
                  {(
                    [
                      "CASH_SAFE",
                      "CASH_DRAWER",
                      "BANK",
                      "CARD_CLEARING",
                    ] as const
                  ).map(code => (
                    <div key={code}>
                      <span>{marketAccounts[code]}</span>
                      <strong>{money(balance(code))}</strong>
                    </div>
                  ))}
                </div>
                <div className="ma-cari-totals">
                  <span>
                    Müşterilerden alacak
                    <strong>{money(balance("RECEIVABLE"))}</strong>
                  </span>
                  <span>
                    Tedarikçilere borç
                    <strong>{money(-balance("PAYABLE"))}</strong>
                  </span>
                  <span>
                    Geciken müşteri alacağı
                    <strong>
                      {money(
                        d.parties.reduce(
                          (n, p) => n + p.overdueReceivableMinor,
                          0
                        )
                      )}
                    </strong>
                  </span>
                  <span>
                    Geciken tedarikçi borcu
                    <strong>
                      {money(
                        d.parties.reduce((n, p) => n + p.overduePayableMinor, 0)
                      )}
                    </strong>
                  </span>
                </div>
              </section>
              <div className="ma-two-columns">
                <section className="ma-panel">
                  <h2>Günün hareketleri</h2>
                  <dl className="ma-totals">
                    <div>
                      <dt>İade sonrası KDV dahil satış</dt>
                      <dd>{money(d.daily.salesGrossMinor)}</dd>
                    </div>
                    <div>
                      <dt>Satış iadesi · {d.daily.saleReturnCount} belge</dt>
                      <dd>{money(d.daily.salesReturnsGrossMinor)}</dd>
                    </div>
                    <div>
                      <dt>Alış iadesi · KDV dahil</dt>
                      <dd>{money(d.daily.purchaseReturnsGrossMinor)}</dd>
                    </div>
                    <div>
                      <dt>Cari tahsilat</dt>
                      <dd>{money(d.daily.collectionsMinor)}</dd>
                    </div>
                    <div>
                      <dt>Tedarikçi ödemesi</dt>
                      <dd>{money(d.daily.supplierPaymentsMinor)}</dd>
                    </div>
                    <div>
                      <dt>İade sonrası mal kabul · KDV hariç</dt>
                      <dd>{money(d.daily.purchasesNetMinor)}</dd>
                    </div>
                    <div>
                      <dt>Gider / komisyon / eksikler</dt>
                      <dd>{money(d.daily.expensesMinor)}</dd>
                    </div>
                    <div>
                      <dt>Satış KDV / Alış ve gider KDV</dt>
                      <dd>
                        {money(d.daily.outputVatMinor)} /{" "}
                        {money(d.daily.inputVatMinor)}
                      </dd>
                    </div>
                  </dl>
                </section>
                <section className="ma-panel">
                  <h2>Kontrol noktaları</h2>
                  <p
                    className={
                      d.trialDifferenceMinor === 0 ? "ma-good" : "ma-error"
                    }
                  >
                    <CheckCircle2 size={17} />
                    Defter borç/alacak farkı: {money(d.trialDifferenceMinor)}
                  </p>
                  <p
                    className={
                      d.stockValueMinor === balance("INVENTORY")
                        ? "ma-good"
                        : "ma-error"
                    }
                  >
                    <Package size={17} />
                    Stok / maliyet defteri farkı:{" "}
                    {money(d.stockValueMinor - balance("INVENTORY"))}
                  </p>
                  <p>
                    <Wallet size={17} />
                    {d.openRegisterCount} açık satış kasası
                  </p>
                  {d.unvaluedStockCount > 0 && (
                    <p className="ma-warning">
                      <AlertTriangle size={17} />
                      {d.unvaluedStockCount} stok kartının maliyet değeri sıfır.
                      Maliyet kaynağını kontrol edin.
                    </p>
                  )}
                  <p className="ma-hint">
                    Açılış {d.startedOn}. Bu bölüm resmî mali defter veya vergi
                    beyannamesi düzenlemez.
                  </p>
                </section>
              </div>
            </>
          )}
          {tab === "stock" && (
            <InventoryManagement
              stationId={stationId}
              ledger={d}
              locked={w.locked}
              canCreate={canProduct}
              onCreate={() => setModal({ kind: "new-product" })}
              onBasePrice={id => {
                const product = d.stock.find(p => p.id === id);
                if (product) setModal({ kind: "product", product });
              }}
              action={w.action}
            />
          )}
          {tab === "catalog" && (
            <CatalogImport
              stationId={stationId}
              csrfToken={state.csrfToken}
              isDemo={state.tenant?.isDemo ?? false}
              closedToday={d.closedToday}
              locked={w.locked}
              canWrite={canProduct}
              action={w.action}
            />
          )}
          {tab === "shelf" && (
            <ShelfLabels
              stationId={stationId}
              refreshKey={d.stock}
              locked={w.locked}
              action={w.action}
            />
          )}
          {tab === "counts" && (
            <CountReports stationId={stationId} today={d.today} />
          )}
          {tab === "monthly" && (
            <MonthlyMarketReport stationId={stationId} today={d.today} />
          )}
          {tab === "lots" && (
            <InventoryLots
              stationId={stationId}
              revision={d.revision}
              locked={w.locked}
              action={w.action}
            />
          )}
          {tab === "orders" && (
            <PurchaseOrders
              stationId={stationId}
              ledger={d}
              locked={w.locked}
              canApprove={canProduct}
              action={w.action}
            />
          )}
          {tab === "purchase" && (
            <MarketPurchase
              data={d}
              locked={locked}
              error={w.error}
              action={w.action}
            />
          )}
          {tab === "returns" && (
            <MarketReturns
              stationId={stationId}
              data={d}
              locked={locked}
              readLocked={w.locked}
              canWrite={canClose}
              action={w.action}
            />
          )}
          {tab === "parties" && (
            <>
              <section className="ma-panel">
                <div className="ma-panel-head">
                  <div>
                    <h2>Market carileri</h2>
                    <p>
                      Müşteri alacağı, tedarikçi borcu, limit ve vade takibi.
                    </p>
                  </div>
                  <button
                    className="btn primary"
                    disabled={locked}
                    onClick={() => setModal({ kind: "party" })}
                  >
                    <Plus size={16} />
                    Yeni cari
                  </button>
                </div>
                <label className="ma-search">
                  <Search size={17} />
                  <input
                    aria-label="Market cari ara"
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    placeholder="Cari adı veya vergi no"
                  />
                </label>
                <div className="ma-table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Cari</th>
                        <th>Müşteri alacağı</th>
                        <th>Tedarikçi borcu</th>
                        <th>Vade / Limit</th>
                        <th>İşlem</th>
                      </tr>
                    </thead>
                    <tbody>
                      {parties.map(p => (
                        <tr key={p.id}>
                          <td>
                            <b>{p.name}</b>
                            <small>
                              {p.kind === "CUSTOMER"
                                ? "Müşteri"
                                : p.kind === "SUPPLIER"
                                  ? "Tedarikçi"
                                  : "Müşteri ve tedarikçi"}
                            </small>
                          </td>
                          <td>
                            {money(p.receivableMinor)}
                            {p.overdueReceivableMinor > 0 && (
                              <small className="ma-error">
                                Geciken {money(p.overdueReceivableMinor)}
                              </small>
                            )}
                          </td>
                          <td>
                            {money(p.payableMinor)}
                            {p.overduePayableMinor > 0 && (
                              <small className="ma-error">
                                Geciken {money(p.overduePayableMinor)}
                              </small>
                            )}
                          </td>
                          <td>
                            {p.termDays} gün
                            <small>
                              Veresiye limiti {money(p.receivableLimitMinor)}
                            </small>
                            <button
                              className="ma-text-button"
                              disabled={w.locked}
                              onClick={() =>
                                setModal({ kind: "party", party: p })
                              }
                            >
                              Limit ve vade düzenle
                            </button>
                          </td>
                          <td>
                            <div className="ma-row-actions">
                              <button
                                className="btn"
                                onClick={() => setStatement(p)}
                              >
                                Ekstre
                              </button>
                              {p.kind !== "SUPPLIER" && (
                                <button
                                  className="btn"
                                  disabled={
                                    !canClose ||
                                    locked ||
                                    p.receivableMinor <= 0
                                  }
                                  onClick={() =>
                                    setModal({
                                      kind: "settlement",
                                      party: p,
                                      direction: "COLLECTION",
                                    })
                                  }
                                >
                                  <ArrowDownLeft size={14} />
                                  Tahsilat
                                </button>
                              )}
                              {p.kind !== "CUSTOMER" && (
                                <button
                                  className="btn"
                                  disabled={
                                    !canClose || locked || p.payableMinor <= 0
                                  }
                                  onClick={() =>
                                    setModal({
                                      kind: "settlement",
                                      party: p,
                                      direction: "PAYMENT",
                                    })
                                  }
                                >
                                  <ArrowUpRight size={14} />
                                  Ödeme
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {!d.parties.length && (
                  <div className="ma-empty">
                    Alış için tedarikçi, veresiye satış için müşteri carisi
                    ekleyin.
                  </div>
                )}
                <small>İlk 100 eşleşme gösterilir.</small>
              </section>
              <Documents data={d} />
            </>
          )}
          {tab === "money" && (
            <section className="ma-panel">
              <div className="ma-panel-head">
                <div>
                  <h2>Kasa, banka ve kart alacağı</h2>
                  <p>
                    Merkez kasa ile satış çekmeceleri ayrı izlenir. Ödeme ve
                    banka geçişleri manuel kayıttır.
                  </p>
                </div>
              </div>
              <div className="ma-wallet-grid">
                {(
                  ["CASH_SAFE", "CASH_DRAWER", "BANK", "CARD_CLEARING"] as const
                ).map(code => (
                  <div key={code}>
                    <span>{marketAccounts[code]}</span>
                    <strong>{money(balance(code))}</strong>
                  </div>
                ))}
              </div>
              <div className="ma-action-grid">
                <button
                  className="btn"
                  disabled={locked || !canClose}
                  onClick={() => setModal({ kind: "expense" })}
                >
                  Gider kaydet
                </button>
                <button
                  className="btn"
                  disabled={locked || !canClose}
                  onClick={() => setModal({ kind: "transfer" })}
                >
                  Kasa–banka transferi
                </button>
                {canClose && (
                  <button
                    className="btn"
                    disabled={locked || balance("CARD_CLEARING") <= 0}
                    onClick={() => setModal({ kind: "bank" })}
                  >
                    Kart → banka ve komisyon
                  </button>
                )}
                {owner && (
                  <button
                    className="btn"
                    disabled={locked}
                    onClick={() => setModal({ kind: "capital" })}
                  >
                    İşletmeye kaynak girişi
                  </button>
                )}
              </div>
              <p className="ma-hint">
                Tedarikçi ödemesi ve müşteri tahsilatı Cariler bölümünden ilgili
                karta bağlanarak kaydedilir. Satış çekmecesindeki nakit, kasa
                kapanışında merkez kasaya devredilir.
              </p>
            </section>
          )}
          {tab === "dayend" && (
            <DayEnd
              data={d}
              locked={w.locked}
              canClose={canClose}
              error={w.error}
              action={w.action}
            />
          )}
          {tab === "journal" && (
            <section className="ma-panel">
              <div className="ma-panel-head">
                <div>
                  <h2>Hareket defteri · {d.reportDate}</h2>
                  <p>
                    Her işlem dengeli fiş oluşturur. Asıl kayıtlar korunur;
                    düzeltmeler ayrıca izlenir.
                  </p>
                </div>
                <button
                  className="btn"
                  onClick={() =>
                    marketCsv(`market-defter-${d.reportDate}.csv`, [
                      [
                        "Tarih",
                        "Fiş no",
                        "İşlem",
                        "Açıklama",
                        "Referans",
                        "Hesap",
                        "Cari",
                        "Borç TL",
                        "Alacak TL",
                      ],
                      ...d.journal.flatMap(e =>
                        e.lines.map(l => [
                          e.date,
                          e.number,
                          marketKindLabels[e.kind] ?? e.kind,
                          e.description,
                          e.reference,
                          marketAccounts[l.account],
                          l.partyName,
                          l.debitMinor / 100,
                          l.creditMinor / 100,
                        ])
                      ),
                    ])
                  }
                >
                  <FileDown size={16} />
                  Görünen fişleri CSV indir
                </button>
              </div>
              {d.journal.map(e => (
                <details className="ma-journal-entry" key={e.id}>
                  <summary>
                    <span>
                      <b>
                        #{e.number} · {marketKindLabels[e.kind] ?? e.kind}
                      </b>
                      <small>
                        {e.description} · {e.actorName}
                      </small>
                    </span>
                    <strong>
                      {money(e.lines.reduce((n, l) => n + l.debitMinor, 0))}
                    </strong>
                    {e.reversed && (
                      <span className="ma-warn-badge">Ters kaydı var</span>
                    )}
                  </summary>
                  <div className="ma-table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>Hesap</th>
                          <th>Cari</th>
                          <th>Borç</th>
                          <th>Alacak</th>
                        </tr>
                      </thead>
                      <tbody>
                        {e.lines.map((l, i) => (
                          <tr key={i}>
                            <td>{marketAccounts[l.account]}</td>
                            <td>{l.partyName ?? "—"}</td>
                            <td>{money(l.debitMinor)}</td>
                            <td>{money(l.creditMinor)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {canClose &&
                    !e.reversed &&
                    [
                      "PAYMENT",
                      "COLLECTION",
                      "EXPENSE",
                      "TRANSFER",
                      "CAPITAL",
                      "BANK_SETTLEMENT",
                    ].includes(e.kind) && (
                      <button
                        className="btn"
                        disabled={locked}
                        onClick={() => setModal({ kind: "reverse", entry: e })}
                      >
                        Açıklamalı ters kayıt oluştur
                      </button>
                    )}
                </details>
              ))}
              {!d.journal.length && <p>Seçilen tarihte mali fiş yok.</p>}
              <small>
                Son 100 fiş gösterilir; günlük özetler günün tüm fişlerinden
                hesaplanır. Cari ekstre tarih aralığıyla ayrıca sayfalanır.
              </small>
            </section>
          )}
          <footer className="ma-footnote">
            Operasyonel ön muhasebe · KDV oranları ve açılış maliyetleri işletme
            tarafından doğrulanır. Banka entegrasyonu ve resmî mali belge
            düzenleme bağlı değildir.
          </footer>
        </>
      )}
      {modal && d && (
        <MarketAccountingDialog
          key={`${modal.kind}:${"party" in modal ? (modal.party?.id ?? "new") : "product" in modal ? modal.product.id : "entry" in modal ? modal.entry.id : "new"}`}
          modal={modal}
          allowOpening={canClose}
          data={d}
          locked={w.locked}
          error={w.error}
          close={() => setModal(null)}
          action={w.action}
        />
      )}
      {statement && d && (
        <MarketStatement
          key={statement.id}
          stationId={stationId}
          party={statement}
          today={d.today}
          startedOn={d.startedOn}
          close={() => setStatement(null)}
        />
      )}
    </div>
  );
  function setDateSafely(value: string) {
    if (value) w.setDate(value);
  }
}
function Documents({ data }: { data: MarketAccountingState }) {
  return (
    <section className="ma-panel">
      <h2>Vade ve belge bakiyeleri</h2>
      <div className="ma-table-wrap">
        <table>
          <thead>
            <tr>
              <th>Cari / Belge</th>
              <th>Tür</th>
              <th>Vade</th>
              <th>Toplam</th>
              <th>Kapanan</th>
              <th>İade mahsubu</th>
              <th>Kalan</th>
            </tr>
          </thead>
          <tbody>
            {data.documents.map(d => (
              <tr key={d.id}>
                <td>
                  <b>{d.partyName}</b>
                  <small>{d.reference}</small>
                </td>
                <td>
                  {d.kind === "PURCHASE"
                    ? "Alış"
                    : d.kind === "CREDIT_SALE"
                      ? "Veresiye satış"
                      : "Açılış"}
                </td>
                <td>
                  <span
                    className={
                      d.totalMinor > d.settledMinor + d.creditedMinor &&
                      d.dueDate < data.today
                        ? "ma-warn-badge"
                        : ""
                    }
                  >
                    {d.dueDate}
                  </span>
                </td>
                <td>{money(d.totalMinor)}</td>
                <td>{money(d.settledMinor)}</td>
                <td>{money(d.creditedMinor)}</td>
                <td>
                  {money(d.totalMinor - d.settledMinor - d.creditedMinor)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <small>
        En eski vadeli açık belgeler önce, en fazla 200 belge gösterilir.
      </small>
    </section>
  );
}
function DayEnd({
  data: d,
  locked,
  canClose,
  error,
  action,
}: {
  data: MarketAccountingState;
  locked: boolean;
  canClose: boolean;
  error: string;
  action: (path: string, payload: Record<string, unknown>) => Promise<boolean>;
}) {
  const [localError, setLocalError] = useState("");
  const current = d.reportDate === d.today;
  return (
    <>
      <section className="ma-panel">
        <div className="ma-panel-head">
          <div>
            <h2>Gün sonu · {d.today}</h2>
            <p>
              Satış kasaları kapatılıp nakit merkez kasaya devredildikten sonra
              sayımı kaydedin.
            </p>
          </div>
          <span className={d.closedToday ? "ma-good-badge" : "ma-warn-badge"}>
            {d.closedToday ? "Kapalı" : "Kapanış bekliyor"}
          </span>
        </div>
        <div className="ma-metrics">
          <Metric
            label="Açık satış kasası"
            value={String(d.openRegisterCount)}
            detail="Kapanış için sıfır olmalı"
          />
          <Metric
            label="Beklenen merkez kasa"
            value={money(d.balances.CASH_SAFE ?? 0)}
            detail="Fiziksel sayımla karşılaştırılır"
          />
          <Metric
            label="Günün brüt satışı"
            value={current ? money(d.daily.salesGrossMinor) : "Yükleniyor…"}
            detail="Tahsilat ve sermaye hariç"
          />
          <Metric
            label="Operasyonel sonuç"
            value={
              current ? money(d.daily.operatingResultMinor) : "Yükleniyor…"
            }
            detail="Vergi beyannamesi sonucu değildir"
          />
        </div>
        {canClose && !d.closedToday && (
          <form
            onSubmit={async e => {
              e.preventDefault();
              setLocalError("");
              try {
                const f = new FormData(e.currentTarget);
                await action("/market-accounting/day-close", {
                  expectedRevision: d.revision,
                  countedCashMinor: parseMoney(String(f.get("counted"))),
                  note: f.get("note"),
                });
              } catch (e) {
                setLocalError((e as Error).message);
              }
            }}
          >
            <fieldset disabled={locked || !current}>
              <div className="ma-form-grid">
                <label>
                  Fiziksel sayılan merkez kasa (TL)
                  <input
                    name="counted"
                    inputMode="decimal"
                    required
                    placeholder="Sayım tutarını girin"
                  />
                </label>
                <label>
                  Sayım farkı açıklaması
                  <input
                    name="note"
                    maxLength={500}
                    placeholder="Fark varsa en az 5 karakter"
                  />
                </label>
              </div>
              <label className="ma-check">
                <input type="checkbox" required />
                Bugünün mali kayıtlarını kapatıyorum; yeni kayıtların sonraki
                takvim gününde alınacağını biliyorum.
              </label>
              {(localError || error) && (
                <p role="alert" className="ma-error">
                  {localError || error}
                </p>
              )}
              <button
                className="btn primary"
                disabled={locked || !current || d.openRegisterCount > 0}
              >
                Sayımı kaydet ve gün sonunu kapat
              </button>
            </fieldset>
          </form>
        )}
        {d.openRegisterCount > 0 && (
          <p className="ma-warning">
            Önce{" "}
            <a href="/kasa">
              {d.openRegisterCount} açık satış kasasını kapatın
            </a>
            .
          </p>
        )}
      </section>
      <section className="ma-panel">
        <h2>Kaydedilmiş gün sonları</h2>
        {!d.closes.length && <p>Henüz kaydedilmiş gün sonu yok.</p>}
        {d.closes.map(c => (
          <details className="ma-journal-entry" key={c.id}>
            <summary>
              <span>
                <b>{c.date}</b>
                <small>Sayım farkı {money(c.differenceMinor)}</small>
              </span>
              <strong>{money(c.countedCashMinor)}</strong>
            </summary>
            <dl className="ma-totals">
              <div>
                <dt>Beklenen nakit</dt>
                <dd>{money(c.expectedCashMinor)}</dd>
              </div>
              <div>
                <dt>Sayılan nakit</dt>
                <dd>{money(c.countedCashMinor)}</dd>
              </div>
              <div>
                <dt>KDV dahil satış</dt>
                <dd>{money(c.snapshot.daily.salesGrossMinor)}</dd>
              </div>
              <div>
                <dt>Satılan mal maliyeti</dt>
                <dd>{money(c.snapshot.daily.cogsMinor)}</dd>
              </div>
              <div>
                <dt>Operasyonel sonuç</dt>
                <dd>{money(c.snapshot.daily.operatingResultMinor)}</dd>
              </div>
            </dl>
            <p>{c.note}</p>
            <small>Kayıt özeti {c.hash.slice(0, 16)}</small>
          </details>
        ))}
      </section>
    </>
  );
}

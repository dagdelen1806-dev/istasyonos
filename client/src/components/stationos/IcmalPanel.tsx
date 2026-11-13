import { useEffect, useState, type FormEvent } from "react";
import { type AppState, money, parseMoney } from "@shared/station";
import { litres, parseLitres } from "@shared/fuel";
import {
  specialKinds,
  specialLabels,
  type SpecialKind,
  type IcmalAccount,
} from "@shared/icmal";
import { Panel, Field, Notice, Metric } from "./Common";
import { downloadIcmal, printIcmal } from "@/lib/icmal-export";
type Equipment = {
  id: string;
  label: string;
  pump: string;
  tank: string;
  tankId: string;
};
type Props = {
  state: AppState;
  stationId: string;
  busy: boolean;
  onAction: (
    path: string,
    payload: Record<string, unknown>
  ) => Promise<boolean>;
};
const today = () =>
  new Date(Date.now() + 3 * 3600_000).toISOString().slice(0, 10);
export function IcmalPanel({ state, stationId, busy, onAction }: Props) {
  const [day, setDay] = useState(today),
    [person, setPerson] = useState(""),
    [accounts, setAccounts] = useState<IcmalAccount[]>([]),
    [equipment, setEquipment] = useState<Equipment[]>([]),
    [selectedAccount, setSelectedAccount] = useState(""),
    [kind, setKind] = useState<SpecialKind>("TTS"),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(false),
    [version, setVersion] = useState(0);
  const station = stationId || state.stations[0]?.id || "",
    role = state.member?.role || "",
    permitted = ["OWNER", "MANAGER", "ACCOUNTANT", "FUEL_STAFF"].includes(role),
    financial = ["OWNER", "ACCOUNTANT"].includes(role);
  const revisions = state.accounts.map(a => a.id + ":" + a.revision).join(",");
  useEffect(() => {
    let active = true;
    setError("");
    setAccounts([]);
    setEquipment([]);
    if (!station || !permitted) return;
    setLoading(true);
    const params = new URLSearchParams({
      stationId: station,
      ...(day ? { day } : {}),
      ...(person ? { userId: person } : {}),
    });
    fetch("/api/stationos/icmal?" + params, {
      credentials: "include",
      cache: "no-store",
    })
      .then(async r => {
        const data = await r.json();
        if (!r.ok) throw Error(data.error?.message || "İcmal okunamadı.");
        if (active) {
          setAccounts(data.accounts);
          setEquipment(data.equipment);
        }
      })
      .catch(e => {
        if (active) setError(e.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [station, day, person, permitted, revisions, version]);
  const account =
      accounts.find(a => a.id === selectedAccount) ??
      accounts.find(a => a.userId === state.user.id && a.status === "OPEN") ??
      accounts[0],
    details = account?.fuel?.icmal;
  const writable =
    !!account &&
    account.status === "OPEN" &&
    account.userId === state.user.id &&
    !busy &&
    !loading &&
    !!state.tenant?.isDemo;
  const reviewer =
    !!account &&
    account.status === "OPEN" &&
    account.userId !== state.user.id &&
    financial &&
    !busy &&
    !loading &&
    !!state.tenant?.isDemo;
  const operations = details?.operations ?? [],
    card = ["TTS", "GIFT_LOAD", "GIFT_USE", "PARTNER"].includes(kind),
    tanks = equipment.filter(
      (n, i, all) => all.findIndex(v => v.tankId === n.tankId) === i
    );
  const totals = (fn: (a: IcmalAccount) => number) =>
    accounts.reduce((s, a) => s + fn(a), 0);
  const filter = `Gün: ${day || "Tüm günler"} · Personel: ${person ? state.members.find(m => String(m.userId) === person)?.name || person : "Yetkili kapsam"}`;
  async function submit(e: FormEvent<HTMLFormElement>, action: string) {
    e.preventDefault();
    setError("");
    if (!account) return;
    const f = Object.fromEntries(new FormData(e.currentTarget)) as Record<
      string,
      string
    >;
    try {
      let payload: Record<string, unknown> = {
        accountId: account.id,
        expectedRevision: account.revision,
      };
      if (action === "special")
        payload = {
          ...payload,
          ...f,
          kind,
          amountMinor: card ? parseMoney(f.amount) : 0,
          volumeMl: kind === "GIFT_LOAD" ? 0 : parseLitres(f.volume),
          ...(kind === "TEST_OUT"
            ? {
                startMeterMl: parseLitres(f.start),
                endMeterMl: parseLitres(f.end),
              }
            : {}),
          ...(kind === "TANKER_IN"
            ? { documentMl: parseLitres(f.document) }
            : {}),
        };
      else if (action === "tank")
        payload = {
          ...payload,
          tankId: f.tankId,
          openingMl: parseLitres(f.opening),
          closingMl: parseLitres(f.closing),
          evidence: f.evidence,
        };
      else payload = { ...payload, ...f };
      if (await onAction("/icmal/" + action, payload)) setVersion(v => v + 1);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  const text = (
    name: string,
    label: string,
    maxLength = 190,
    required = true
  ) => (
    <Field label={label}>
      <input name={name} maxLength={maxLength} required={required} />
    </Field>
  );
  const decimal = (name: string, label: string) => (
    <Field label={label}>
      <input name={name} inputMode="decimal" required />
    </Field>
  );
  const proof = (
    <>
      {text("note", "Gerekçe / model kararı", 1000)}
      {text("evidence", "Kanıt referansı", 500)}
    </>
  );
  if (!permitted)
    return (
      <Notice warning>
        İcmal için akaryakıt veya yönetim/muhasebe yetkisi gerekir.
      </Notice>
    );
  return (
    <div className="icmal-panel">
      <Notice>
        Operasyonel icmal. Özel kayıtlar yalnız DEMO firmada düzenlenir. Kartlar
        taslak başlar; gerçek mali defter veya otomatik banka/sağlayıcı teyidi
        oluşturulmaz.
      </Notice>
      {error && <Notice warning>{error}</Notice>}
      <Panel
        title="Günlük ve personel filtresi"
        subtitle="Türkiye vardiya başlangıç tarihine göre filtrelenir; gece vardiyası başlangıç günündedir."
      >
        <div className="form-grid">
          <Field label="Gün (boş: tüm günler)">
            <input
              name="icmalDay"
              type="date"
              value={day}
              onChange={e => setDay(e.target.value)}
            />
          </Field>
          <Field label="Personel">
            <select
              name="icmalPerson"
              value={person}
              onChange={e => setPerson(e.target.value)}
            >
              <option value="">Yetkili kapsam</option>
              {(role === "FUEL_STAFF"
                ? state.members.filter(m => m.userId === state.user.id)
                : state.members
              ).map(m => (
                <option key={m.userId} value={m.userId}>
                  {m.name}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <button
          className="btn"
          disabled={loading || !accounts.length}
          onClick={() => {
            try {
              downloadIcmal(
                accounts,
                state.stations.find(s => s.id === station)?.name || "",
                filter
              );
            } catch (e) {
              setError((e as Error).message);
            }
          }}
        >
          Excel (.xlsx) indir
        </button>{" "}
        <button
          className="btn"
          disabled={loading || !accounts.length}
          onClick={() => {
            try {
              printIcmal(
                accounts,
                state.stations.find(s => s.id === station)?.name || "",
                filter
              );
            } catch (e) {
              setError((e as Error).message);
            }
          }}
        >
          PDF / Yazdır
        </button>
        {loading && <p>İcmal yükleniyor…</p>}
      </Panel>
      <div className="metric-grid">
        <Metric
          label="Sayaç tutarı (test dahil)"
          detail="Fiziksel sayaç değeri"
          icon={null}
          value={money(totals(a => a.fuel?.meterExpectedMinor ?? 0))}
        />
        <Metric
          label="Ticari satış"
          detail="Test çıkışı hariç"
          icon={null}
          value={money(totals(a => a.fuel?.expectedMinor ?? 0))}
        />
        <Metric
          label="Nakit satış + kart slip"
          detail="IBAN ve alacaklar hariç"
          icon={null}
          value={money(totals(a => a.cashMinor + a.cardMinor))}
        />
        <Metric
          label="Cari satış"
          detail="Mevcut cari defteri"
          icon={null}
          value={money(totals(a => a.debtMinor))}
        />
      </div>
      <Panel
        title="Vardiya Mali Hesap"
        subtitle="Özel satışlar ticari satışın alt kırılımıdır; toplama tekrar eklenmez."
      >
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Vardiya / personel</th>
                <th>Sayaç L</th>
                <th>Test L</th>
                <th>Ticari L / TL</th>
                <th>Nakit / kart</th>
                <th>IBAN / FAST teyitsiz / cari</th>
                <th>Özel karşılık</th>
                <th>Litre farkı</th>
                <th>Tutar farkı</th>
                <th>Durum</th>
              </tr>
            </thead>
            <tbody>
              {accounts.map(a => (
                <tr key={a.id}>
                  <td>
                    <button
                      className="btn"
                      onClick={() => setSelectedAccount(a.id)}
                    >
                      {a.shiftLabel} / {a.userName}
                    </button>
                  </td>
                  <td>{a.fuel ? litres(a.fuel.soldMl) : "—"}</td>
                  <td>{litres(a.fuel?.icmal?.testMl ?? 0)}</td>
                  <td>
                    {a.fuel
                      ? litres(a.fuel.icmal?.commercialMl ?? a.fuel.soldMl)
                      : "—"}{" "}
                    / {money(a.fuel?.expectedMinor)}
                  </td>
                  <td>
                    {money(a.cashMinor)} / {money(a.cardMinor)}
                  </td>
                  <td>
                    {money(a.ibanMinor)} / {money(a.fastMinor)} / {money(a.debtMinor)}
                  </td>
                  <td>{money(a.specialCoveredMinor)}</td>
                  <td>
                    {a.fuel?.litreDifferenceMl == null
                      ? "—"
                      : litres(a.fuel.litreDifferenceMl)}
                  </td>
                  <td>{money(a.fuel?.amountDifferenceMinor)}</td>
                  <td>{a.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!loading && !accounts.length && (
          <p>
            Bu filtrede hesap yok. Sayaç ekranından DEMO hesabı açabilirsiniz.
          </p>
        )}
      </Panel>
      {account && (
        <>
          <Panel
            title="Seçili icmal ve özel işlem kırılımı"
            subtitle={account.shiftLabel + " · " + account.userName}
          >
            <Field label="Vardiya hesabı">
              <select
                name="icmalAccount"
                value={account.id}
                onChange={e => setSelectedAccount(e.target.value)}
              >
                {accounts.map(a => (
                  <option value={a.id} key={a.id}>
                    {a.shiftLabel} / {a.userName} / {a.status}
                  </option>
                ))}
              </select>
            </Field>
            <p>
              Eski cari tahsilatı (satış hariç):{" "}
              {money(account.arCollectionMinor)} · Gift nakit yüklemesi (satış
              hariç): {money(account.prepaymentCashMinor)} · Beklenen fizikî
              nakit (avans hariç): {money(account.expectedCashMinor)}
            </p>
            <p>
              Fizikî nakit sayım farkı: {money(account.cashDifferenceMinor)} ·
              Cari defter − satış farkı:{" "}
              {money(account.receivableDifferenceMinor)}. Nakit sayımı
              yapılmadıysa fark bilinmiyor gösterilir.
            </p>
            <p>
              Cari satış defteri: {money(account.receivableLedgerMinor)} · Ayrı
              operasyonel sağlayıcı alacağı:{" "}
              {money(account.providerReceivableMinor)} · Ön ödemeden karşılanan
              satış: {money(account.giftAppliedMinor)}.
            </p>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>TTS</th>
                    <th>Gift yükleme (satış değil)</th>
                    <th>Gift kullanım</th>
                    <th>Partner</th>
                    <th>Excel: TTS + Gift kullanım</th>
                    <th>Taslak / bekleyen</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>{money(details?.ttsMinor ?? 0)}</td>
                    <td>{money(details?.giftLoadMinor ?? 0)}</td>
                    <td>{money(details?.giftUseMinor ?? 0)}</td>
                    <td>{money(details?.partnerMinor ?? 0)}</td>
                    <td>{money(details?.excelTtsGiftMinor ?? 0)}</td>
                    <td>
                      {details?.draftCount ?? 0} / {details?.pendingCount ?? 0}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
            <p>
              Gift yükleme birleşik Excel satırına katılmaz. Sağlayıcı alacağı
              ve ön ödeme karşılığı tahsil edilmiş nakit/banka bakiyesi
              değildir.
            </p>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Kategori</th>
                    <th>Kaynak / sağlayıcı / ref</th>
                    <th>Plaka / müşteri / cüzdan</th>
                    <th>Tutar / litre</th>
                    <th>Model / durum</th>
                    <th>Hesaplaşma</th>
                    <th>Kanıt</th>
                  </tr>
                </thead>
                <tbody>
                  {operations.map(o => (
                    <tr key={o.id}>
                      <td>{specialLabels[o.kind]}</td>
                      <td>
                        {o.source} / {o.provider} / {o.reference}
                      </td>
                      <td>
                        {o.plate || "—"} / {o.customer || "—"} /{" "}
                        {o.instrument || "—"}
                      </td>
                      <td>
                        {money(o.amountMinor)} / {litres(o.volumeMl)} L
                      </td>
                      <td>
                        {o.model} / {o.status}
                      </td>
                      <td>
                        {o.settlement} / {o.settlementMethod}
                      </td>
                      <td>{o.evidence}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {writable && (
              <details>
                <summary>Özel işlem kaydet</summary>
                <form
                  key={account.id + ":" + account.revision + kind}
                  className="form-grid"
                  onSubmit={e => submit(e, "special")}
                >
                  <Field label="İşlem kategorisi">
                    <select
                      name="specialKind"
                      value={kind}
                      onChange={e => setKind(e.target.value as SpecialKind)}
                    >
                      {specialKinds.map(k => (
                        <option key={k} value={k}>
                          {specialLabels[k]}
                        </option>
                      ))}
                    </select>
                  </Field>
                  {text("source", "İşlem kaynağı")}
                  {text("provider", "Sağlayıcı / teslim eden")}
                  {text("reference", "Benzersiz referans")}
                  {card && (
                    <>
                      {decimal("amount", "Tutar (TL)")}
                      {text("plate", "Plaka", 32, false)}
                      {text(
                        "customer",
                        "Müşteri / cari açıklaması",
                        190,
                        false
                      )}
                      {text(
                        "instrument",
                        "Maskeli kart / cüzdan kodu (tam kart numarası girmeyin)",
                        64,
                        false
                      )}
                    </>
                  )}
                  {kind !== "GIFT_LOAD" && decimal("volume", "Litre")}
                  {!card && (
                    <Field label="Tank">
                      <select name="tankId" required>
                        {tanks.map(t => (
                          <option key={t.tankId} value={t.tankId}>
                            {t.tank}
                          </option>
                        ))}
                      </select>
                    </Field>
                  )}
                  {kind === "TEST_OUT" && (
                    <>
                      <Field label="Tabanca">
                        <select name="nozzleId">
                          {equipment.map(n => (
                            <option key={n.id} value={n.id}>
                              {n.pump} / {n.label}
                            </option>
                          ))}
                        </select>
                      </Field>
                      {decimal("start", "Test başlangıç sayacı (L)")}
                      {decimal("end", "Test bitiş sayacı (L)")}
                    </>
                  )}
                  {kind === "TEST_RETURN" && (
                    <Field label="Bağlı test çıkışı">
                      <select name="relatedId" required>
                        {operations
                          .filter(
                            o =>
                              o.kind === "TEST_OUT" && o.status === "RECORDED"
                          )
                          .map(o => (
                            <option value={o.id} key={o.id}>
                              {o.reference} / {litres(o.volumeMl)} L
                            </option>
                          ))}
                      </select>
                    </Field>
                  )}
                  {kind === "TANKER_IN" &&
                    decimal("document", "İrsaliye / belge litresi")}
                  {proof}
                  <button className="btn primary">
                    {card
                      ? "Taslak kart işlemini kaydet"
                      : "Fiziksel hareketi kaydet"}
                  </button>
                </form>
              </details>
            )}
            {reviewer &&
              operations.some(
                o =>
                  o.status === "DRAFT" ||
                  (o.kind === "TANKER_IN" &&
                    o.status === "RECORDED" &&
                    o.documentMl !== o.volumeMl &&
                    o.reviewerId === null)
              ) && (
                <details>
                  <summary>Kart modelini bağımsız incele</summary>
                  <form
                    key={account.revision + "review"}
                    className="form-grid"
                    onSubmit={e => submit(e, "review")}
                  >
                    <Field label="Taslak işlem">
                      <select name="operationId">
                        {operations
                          .filter(
                            o =>
                              o.status === "DRAFT" ||
                              (o.kind === "TANKER_IN" &&
                                o.status === "RECORDED" &&
                                o.documentMl !== o.volumeMl &&
                                o.reviewerId === null)
                          )
                          .map(o => (
                            <option value={o.id} key={o.id}>
                              {specialLabels[o.kind]} / {o.reference}
                            </option>
                          ))}
                      </select>
                    </Field>
                    <Field label="Onaylanan operasyon modeli">
                      <select name="model">
                        <option value="EXISTING_PAYMENT">
                          Mevcut satış ödemesine etiket (ikinci gelir yok)
                        </option>
                        <option value="RECEIVABLE">
                          TTS/Partner: geçici sağlayıcı alacağı
                        </option>
                        <option value="PREPAID">
                          Gift: yerel operasyonel ön ödeme bakiyesi
                        </option>
                        <option value="PHYSICAL">
                          Tanker ölçüm farkı: gerekçeli fiziksel kabul
                        </option>
                      </select>
                    </Field>
                    <Field label="Bağlı satış ödemesi">
                      <select name="paymentId">
                        <option value="">Yok</option>
                        {state.payments
                          .filter(
                            p =>
                              p.accountId === account.id &&
                              p.kind !== "AR_COLLECTION"
                          )
                          .map(p => (
                            <option value={p.id} key={p.id}>
                              {p.kind} / {money(p.amountMinor)} / {p.reference}
                            </option>
                          ))}
                      </select>
                    </Field>
                    <Field label="Bağlı kart slipi (ödeme yerine)">
                      <select name="slipId">
                        <option value="">Yok</option>
                        {state.slips
                          .filter(s => s.accountId === account.id)
                          .map(s => (
                            <option value={s.id} key={s.id}>
                              {money(s.amountMinor)} / {s.reference}
                            </option>
                          ))}
                      </select>
                    </Field>
                    {proof}
                    <button className="btn primary">
                      Modeli kaydet (hesaplaşma bekler)
                    </button>
                  </form>
                </details>
              )}
            {reviewer &&
              operations.some(
                o => o.status === "RECORDED" && o.settlement === "PENDING"
              ) && (
                <details>
                  <summary>Manuel hesaplaşma / yükleme teyidi</summary>
                  <form
                    key={account.revision + "settle"}
                    className="form-grid"
                    onSubmit={e => submit(e, "settle")}
                  >
                    <Field label="Bekleyen işlem">
                      <select name="operationId">
                        {operations
                          .filter(
                            o =>
                              o.status === "RECORDED" &&
                              o.settlement === "PENDING"
                          )
                          .map(o => (
                            <option value={o.id} key={o.id}>
                              {specialLabels[o.kind]} / {o.reference}
                            </option>
                          ))}
                      </select>
                    </Field>
                    <Field label="Kanıtlanan yöntem">
                      <select name="method">
                        <option value="PROVIDER">Sağlayıcı belge teyidi</option>
                        <option value="BANK">Banka belgesi (manuel)</option>
                        <option value="CASH">
                          Fizikî nakit (Gift yüklemesi kasa beklentisine
                          eklenir)
                        </option>
                      </select>
                    </Field>
                    {proof}
                    <button className="btn primary">
                      Manuel belge teyidini kaydet
                    </button>
                  </form>
                </details>
              )}
            {(writable || reviewer) &&
              operations.some(o => o.status !== "VOID") && (
                <details>
                  <summary>Özel işlem iptali / storno</summary>
                  <form className="form-grid" onSubmit={e => submit(e, "void")}>
                    <Field label="İşlem">
                      <select name="operationId">
                        {operations
                          .filter(o => o.status !== "VOID")
                          .map(o => (
                            <option key={o.id} value={o.id}>
                              {specialLabels[o.kind]} / {o.reference}
                            </option>
                          ))}
                      </select>
                    </Field>
                    {proof}
                    <button className="btn">İptal kaydı oluştur</button>
                    <p>
                      İptal fiziksel yakıt/para iadesi yapmaz. Kullanılmış Gift
                      yüklemesi iptal edilemez. Kabul edilmiş hesap kilitlidir.
                    </p>
                  </form>
                </details>
              )}
          </Panel>
          <Panel
            title="Tank ve litre mutabakatı"
            subtitle="İlk + tanker girişi + test dönüşü − tüm sayaç çıkışı = beklenen son."
          >
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Tank</th>
                    <th>İlk L</th>
                    <th>Tanker giriş L</th>
                    <th>Test dönüş L</th>
                    <th>Sayaç çıkış L</th>
                    <th>Beklenen son L</th>
                    <th>Ölçülen son L</th>
                    <th>Fark L</th>
                  </tr>
                </thead>
                <tbody>
                  {details?.tanks.map(t => (
                    <tr key={t.tankId}>
                      <td>{t.label}</td>
                      <td>
                        {t.openingMl === null
                          ? "Bilinmiyor"
                          : litres(t.openingMl)}
                      </td>
                      <td>{litres(t.deliveryMl)}</td>
                      <td>{litres(t.returnMl)}</td>
                      <td>{litres(t.meterOutMl)}</td>
                      <td>
                        {t.expectedClosingMl === null
                          ? "Bilinmiyor"
                          : litres(t.expectedClosingMl)}
                      </td>
                      <td>
                        {t.closingMl === null
                          ? "Bilinmiyor"
                          : litres(t.closingMl)}
                      </td>
                      <td>
                        {t.differenceMl === null
                          ? "Bilinmiyor"
                          : litres(t.differenceMl)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p>
              Tanker kabul − belge farkı:{" "}
              {details
                ? litres(details.deliveryDocumentDifferenceMl) + " L"
                : "Bilinmiyor"}
              . Tolerans varsayılmaz.
            </p>
            {!!details?.centralTanks?.length && (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Merkezî tank</th>
                      <th>Onaylı defter stoku L</th>
                      <th>Son ölçüm L</th>
                      <th>Güncel fark L</th>
                      <th>Vardiya stok kaydı</th>
                    </tr>
                  </thead>
                  <tbody>
                    {details.centralTanks.map(t => (
                      <tr key={t.tankId}>
                        <td>
                          {details.tanks.find(x => x.tankId === t.tankId)
                            ?.label || t.tankId}
                        </td>
                        <td>
                          {t.stockMl === null
                            ? "Bilinmiyor"
                            : litres(t.stockMl)}
                        </td>
                        <td>
                          {t.measuredMl === null
                            ? "Bilinmiyor"
                            : litres(t.measuredMl)}{" "}
                          {!t.measurementFresh && "(güncel değil)"}
                        </td>
                        <td>
                          {t.differenceMl === null
                            ? "Bilinmiyor"
                            : litres(t.differenceMl)}
                        </td>
                        <td>
                          {t.posted
                            ? "Deftere geçti"
                            : "Onay / başlangıç bekliyor"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p>
                  <a href="/tanklar">
                    Merkezî tank stok defteri ve tanker kabulü
                  </a>
                  . İcmaldeki teslim eşleştirilir; stok ikinci kez artırılmaz.
                </p>
              </div>
            )}
            {writable && (
              <details>
                <summary>Tank ölçümünü kaydet / düzelt</summary>
                <form
                  key={account.revision + "tank"}
                  className="form-grid"
                  onSubmit={e => submit(e, "tank")}
                >
                  <Field label="Tank">
                    <select name="tankId">
                      {tanks.map(t => (
                        <option key={t.tankId} value={t.tankId}>
                          {t.tank}
                        </option>
                      ))}
                    </select>
                  </Field>
                  {decimal("opening", "Ölçülen ilk stok (L)")}
                  {decimal("closing", "Ölçülen son stok (L)")}
                  {text("evidence", "Ölçüm kanıtı", 500)}
                  <button className="btn primary">Tank ölçümünü kaydet</button>
                </form>
              </details>
            )}
            <p>
              <a href="/sayaclar">Sayaç ve fiyat okumaları</a> ·{" "}
              <a href="/slipler">Ödeme / cari satış</a> ·{" "}
              <a href="/vardiyalar">Teslim ve iki bağımsız onay</a>
            </p>
          </Panel>
        </>
      )}
    </div>
  );
}

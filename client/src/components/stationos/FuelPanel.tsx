import { useEffect, useState, type FormEvent } from "react";
import { type AppState, money, parseMoney } from "@shared/station";
import { litres, parseLitres, calculateFuel } from "@shared/fuel";
import { Panel, Field, Notice } from "./Common";

type Equipment = {
  id: string;
  label: string;
  tank: string;
  pump: string;
  fuel: string;
};
type Reading = {
  nozzleId: string;
  sequenceNo: number;
  kind: string;
  meterMl: number;
  priceMinor: number;
  readingAt: string;
};
type Batch = {
  accountId: string;
  closed: boolean;
  reportedMl: number | null;
  note: string | null;
  evidence: string | null;
  readings: Reading[];
  soldMl: number;
  expectedMinor: number;
  collectedMinor: number;
  litreDifferenceMl: number | null;
  amountDifferenceMinor: number;
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
const inputMl = (n: number) => (n / 1000).toFixed(3).replace(".", ",");
const inputPrice = (n: number) => (n / 100).toFixed(2).replace(".", ",");
export function FuelPanel({ state, stationId, busy, onAction }: Props) {
  const [equipment, setEquipment] = useState<Equipment[]>([]),
    [batches, setBatches] = useState<Batch[]>([]);
  const [accountId, setAccountId] = useState(""),
    [error, setError] = useState(""),
    [version, setVersion] = useState(0),
    [loading, setLoading] = useState(false);
  const selected = stationId || state.stations[0]?.id || "";
  const permitted = ["OWNER", "MANAGER", "ACCOUNTANT", "FUEL_STAFF"].includes(
    state.member?.role || ""
  );
  const config = ["OWNER", "MANAGER"].includes(state.member?.role || "");
  const canOpen = ["OWNER", "MANAGER", "FUEL_STAFF"].includes(
    state.member?.role || ""
  );
  const revisions = state.accounts.map(a => `${a.id}:${a.revision}`).join(",");
  useEffect(() => {
    let active = true;
    setEquipment([]);
    setBatches([]);
    setError("");
    if (!selected || !permitted) return;
    setLoading(true);
    fetch(`/api/stationos/fuel?stationId=${encodeURIComponent(selected)}`, {
      credentials: "include",
      cache: "no-store",
    })
      .then(async r => {
        const data = await r.json();
        if (!r.ok)
          throw Error(data.error?.message || "Sayaç verisi okunamadı.");
        if (active) {
          setEquipment(data.equipment);
          setBatches(data.batches);
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
  }, [selected, permitted, revisions, version]);
  const accounts = state.accounts.filter(
    a => a.stationId === selected && a.businessUnit === "FUEL"
  );
  const account =
    accounts.find(a => a.id === accountId) ??
    accounts.find(a => a.userId === state.user.id && a.status === "OPEN") ??
    accounts[0];
  const batch = batches.find(b => b.accountId === account?.id);
  const writable =
    !!account &&
    account.userId === state.user.id &&
    account.status === "OPEN" &&
    !busy &&
    !loading;
  const last = (id: string) =>
    batch?.readings.filter(r => r.nozzleId === id).at(-1);
  async function submit(e: FormEvent<HTMLFormElement>, kind: string) {
    e.preventDefault();
    setError("");
    const form = e.currentTarget,
      f = Object.fromEntries(new FormData(form)) as Record<string, string>;
    try {
      let path = "/fuel/" + kind,
        payload: Record<string, unknown> = { stationId: selected };
      if (kind === "equipment") payload = { ...payload, ...f };
      else if (kind === "open") {
        path = "/account/open";
        payload = {
          stationId: selected,
          shiftId: f.shiftId,
          businessUnit: "FUEL",
          openingFloatMinor: parseMoney(f.float),
          readingAt: new Date().toISOString(),
          openingReadings: equipment.map(n => ({
            nozzleId: n.id,
            meterMl: parseLitres(f["meter-" + n.id]),
            priceMinor: parseMoney(f["price-" + n.id]),
          })),
        };
      } else {
        if (!account) throw Error("Vardiya hesabı seçin.");
        payload = {
          accountId: account.id,
          expectedRevision: account.revision,
          readingAt: new Date().toISOString(),
          note: f.note,
          evidence: f.evidence,
        };
        if (kind === "price" || kind === "correct")
          payload = {
            ...payload,
            nozzleId: kind === "correct" ? f.point.split(":")[0] : f.nozzleId,
            ...(kind === "correct"
              ? { sequenceNo: Number(f.point.split(":")[1]) }
              : {}),
            meterMl: parseLitres(f.meter),
            priceMinor: parseMoney(f.price),
          };
        else
          payload = {
            ...payload,
            reportedMl: parseLitres(f.reported),
            readings: equipment.map(n => ({
              nozzleId: n.id,
              meterMl: parseLitres(f["meter-" + n.id]),
              priceMinor: last(n.id)!.priceMinor,
            })),
          };
      }
      if (await onAction(path, payload)) {
        setVersion(v => v + 1);
        if (kind === "equipment" || kind === "price") form.reset();
      }
    } catch (e) {
      setError((e as Error).message);
    }
  }
  if (!permitted)
    return (
      <Notice warning>
        Sayaç ekranı için akaryakıt veya yönetim/muhasebe yetkisi gerekli.
      </Notice>
    );
  const fields = (opening: boolean) => (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Tank / pompa / tabanca / yakıt</th>
            <th>{opening ? "Açılış sayacı (L)" : "Kapanış sayacı (L)"}</th>
            <th>{opening ? "Fiyat (TL/L)" : "Geçerli fiyat"}</th>
          </tr>
        </thead>
        <tbody>
          {equipment.map(n => (
            <tr key={n.id}>
              <td>
                {n.tank} / {n.pump} / {n.label} / {n.fuel}
              </td>
              <td>
                <input
                  aria-label={`${n.label} ${opening ? "açılış" : "kapanış"}`}
                  name={"meter-" + n.id}
                  inputMode="decimal"
                  required
                  defaultValue={
                    opening
                      ? ""
                      : last(n.id)
                        ? inputMl(last(n.id)!.meterMl)
                        : ""
                  }
                />
              </td>
              <td>
                {opening ? (
                  <input
                    aria-label={`${n.label} fiyat`}
                    name={"price-" + n.id}
                    inputMode="decimal"
                    required
                  />
                ) : (
                  money(last(n.id)?.priceMinor)
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
  return (
    <div className="fuel-panel">
      <Notice>
        Manuel sayaç kaydıdır. Fiyat değişiminde ara sayaç okuyun. Litre ve
        tutar farkları çözülmeden teslim/onay yapılamaz. IBAN beyanı banka
        teyidi değildir; gerçek mali defter kaydı üretilmez.
      </Notice>
      {!stationId && state.stations.length > 1 && (
        <Notice>
          İlk istasyon gösteriliyor. Üstteki istasyon filtresinden başka
          istasyon seçebilirsiniz.
        </Notice>
      )}
      {error && <Notice warning>{error}</Notice>}
      {loading && <p>Okumalar yükleniyor…</p>}
      <Panel
        title="Tank, pompa ve tabancalar"
        subtitle={
          state.stations.find(s => s.id === selected)?.name || "İstasyon seçin"
        }
      >
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Tank</th>
                <th>Pompa</th>
                <th>Tabanca</th>
                <th>Yakıt türü</th>
              </tr>
            </thead>
            <tbody>
              {equipment.map(n => (
                <tr key={n.id}>
                  <td>{n.tank}</td>
                  <td>{n.pump}</td>
                  <td>{n.label}</td>
                  <td>{n.fuel}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {config && (
          <details>
            <summary>Donanım ekle</summary>
            <form onSubmit={e => submit(e, "equipment")} className="form-grid">
              {["fuel", "tank", "pump", "nozzle"].map((key, i) => (
                <Field
                  key={key}
                  label={
                    ["Yakıt türü", "Tank adı", "Pompa adı", "Tabanca adı"][i]
                  }
                >
                  <input name={key} maxLength={64} required />
                </Field>
              ))}
              <button
                className="btn primary"
                disabled={busy || loading || !selected}
              >
                Tabancayı ekle
              </button>
              <p>
                Aynı adla tank/pompa yeniden kullanılır. Açık sayaç hesabı
                varken donanım değişmez.
              </p>
            </form>
          </details>
        )}
      </Panel>
      {!!equipment.length && canOpen && (
        <Panel
          title="Sayaçla vardiya hesabı aç"
          subtitle="Tüm tabancaların açılışı tek işlemde kaydedilir; tabanca vardiyada yalnız bir hesaba atanır."
        >
          <form onSubmit={e => submit(e, "open")} key={selected}>
            <Field label="Açık vardiya">
              <select name="shiftId" required>
                <option value="">Vardiya seçin</option>
                {state.shifts
                  .filter(s => s.stationId === selected && s.status === "OPEN")
                  .map(s => (
                    <option key={s.id} value={s.id}>
                      {s.label}
                    </option>
                  ))}
              </select>
            </Field>
            <Field label="Açılış nakit avansı (TL)">
              <input
                name="float"
                defaultValue="0"
                inputMode="decimal"
                required
              />
            </Field>
            {fields(true)}
            <button className="btn primary" disabled={busy || loading}>
              Sayaçları kaydet ve hesap aç
            </button>
          </form>
        </Panel>
      )}
      <Panel
        title="Litre ve tutar mutabakatı"
        subtitle="Tahsilat beyanı; FAST ve IBAN ayrı, banka teyidi bekleyen beyanlardır. Nakit, kart ve cari ayrı gösterilir."
      >
        <Field label="Akaryakıt hesabı">
          <select
            value={account?.id || ""}
            onChange={e => setAccountId(e.target.value)}
          >
            <option value="">Hesap seçin</option>
            {accounts.map(a => (
              <option key={a.id} value={a.id}>
                {a.userName} ·{" "}
                {state.shifts.find(s => s.id === a.shiftId)?.label} · {a.status}
              </option>
            ))}
          </select>
        </Field>
        {account && (
          <p>
            Nakit: {money(account.cashSalesMinor)} · Kart:{" "}
            {money(account.cardTotalMinor)} · Cari satış:{" "}
            {money(account.debtMinor)} · IBAN (bekliyor):{" "}
            {money(account.ibanMinor)} · FAST (banka teyidi bekliyor):{" "}
            {money(account.fastMinor)} · Eski cari tahsilatı (hariç):{" "}
            {money(account.arCollectionMinor)}
          </p>
        )}
        {batch ? (
          <>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Sayaç litresi</th>
                    <th>Beyan litresi</th>
                    <th>Litre farkı</th>
                    <th>Beklenen ticari satış</th>
                    <th>Satış ödeme toplamı</th>
                    <th>Tutar farkı</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>
                      {litres(batch.soldMl)} L{!batch.closed && " (ara)"}
                    </td>
                    <td>
                      {batch.reportedMl === null
                        ? "—"
                        : litres(batch.reportedMl) + " L"}
                    </td>
                    <td>
                      {batch.litreDifferenceMl === null
                        ? "—"
                        : litres(batch.litreDifferenceMl) + " L"}
                    </td>
                    <td>{money(batch.expectedMinor)}</td>
                    <td>{money(batch.collectedMinor)}</td>
                    <td>{money(batch.amountDifferenceMinor)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <p>
              Açıklama: {batch.note || "—"} · Kanıt referansı:{" "}
              {batch.evidence || "—"}
            </p>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Pompa / tabanca / yakıt</th>
                    <th>Açılış (L)</th>
                    <th>Son sayaç (L)</th>
                    <th>Sayaç farkı (L)</th>
                    <th>Sayaç tutarı (test dahil)</th>
                  </tr>
                </thead>
                <tbody>
                  {equipment
                    .filter(n => batch.readings.some(r => r.nozzleId === n.id))
                    .map(n => {
                      const points = batch.readings.filter(
                        r => r.nozzleId === n.id
                      );
                      const total =
                        points.length > 1
                          ? calculateFuel(points)
                          : { soldMl: 0, expectedMinor: 0 };
                      return (
                        <tr key={n.id}>
                          <td>
                            {n.pump} / {n.label} / {n.fuel}
                          </td>
                          <td>{litres(points[0].meterMl)}</td>
                          <td>{litres(points.at(-1)!.meterMl)}</td>
                          <td>{litres(total.soldMl)}</td>
                          <td>{money(total.expectedMinor)}</td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            </div>
            <details>
              <summary>Okuma ve fiyat geçmişi</summary>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Tabanca</th>
                      <th>Tür</th>
                      <th>Sayaç (L)</th>
                      <th>Fiyat (TL/L)</th>
                      <th>Okuma zamanı (UTC)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {batch.readings.map(r => (
                      <tr key={r.nozzleId + ":" + r.sequenceNo}>
                        <td>
                          {equipment.find(n => n.id === r.nozzleId)?.label}
                        </td>
                        <td>{r.kind}</td>
                        <td>{litres(r.meterMl)}</td>
                        <td>{money(r.priceMinor)}</td>
                        <td>{r.readingAt}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
            {writable && !batch.closed && (
              <details>
                <summary>Fiyat değişimini ara sayaçla kaydet</summary>
                <form
                  key={account!.revision + "price"}
                  className="form-grid"
                  onSubmit={e => submit(e, "price")}
                >
                  <Field label="Tabanca">
                    <select name="nozzleId">
                      {equipment.map(n => (
                        <option value={n.id} key={n.id}>
                          {n.pump} / {n.label} / {n.fuel}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Değişim anındaki sayaç (L)">
                    <input name="meter" inputMode="decimal" required />
                  </Field>
                  <Field label="Yeni fiyat (TL/L)">
                    <input name="price" inputMode="decimal" required />
                  </Field>
                  <Field label="Fiyat değişim açıklaması">
                    <input name="note" maxLength={1000} required />
                  </Field>
                  <Field label="Kanıt referansı (fiyat listesi / sayaç fotoğraf numarası)">
                    <input name="evidence" maxLength={500} required />
                  </Field>
                  <button className="btn primary">Ara okumayı kaydet</button>
                </form>
              </details>
            )}
            {writable && (
              <details>
                <summary>
                  Hatalı okuma / fiyat noktasını gerekçeyle düzelt
                </summary>
                <form
                  key={account!.revision + "correct"}
                  className="form-grid"
                  onSubmit={e => submit(e, "correct")}
                >
                  <Field label="Düzeltilecek kayıt">
                    <select name="point">
                      {batch.readings.map(r => (
                        <option
                          key={r.nozzleId + ":" + r.sequenceNo}
                          value={r.nozzleId + ":" + r.sequenceNo}
                        >
                          {equipment.find(n => n.id === r.nozzleId)?.label} ·{" "}
                          {r.kind} · {litres(r.meterMl)} L ·{" "}
                          {money(r.priceMinor)}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Doğru sayaç (L)">
                    <input name="meter" required inputMode="decimal" />
                  </Field>
                  <Field label="Doğru fiyat (TL/L)">
                    <input name="price" required inputMode="decimal" />
                  </Field>
                  <Field label="Düzeltme gerekçesi">
                    <input name="note" maxLength={1000} required />
                  </Field>
                  <Field label="Kanıt referansı">
                    <input name="evidence" maxLength={500} required />
                  </Field>
                  <button className="btn primary">
                    Gerekçeli düzeltmeyi kaydet
                  </button>
                  <p>
                    Açılış sayacı sabittir. Sonraki vardiya açılmışsa önceki
                    okumalar değişmez. Teslim edilmiş hesap önce bağımsız
                    yetkili tarafından düzeltmeye gönderilmelidir.
                  </p>
                </form>
              </details>
            )}
            {writable && (
              <form
                key={account!.revision + "close"}
                onSubmit={e => submit(e, "close")}
              >
                <h3>Kapanış okumaları{batch.closed ? " · düzeltme" : ""}</h3>
                {fields(false)}
                <Field label="Bağımsız satış litre beyanı (L)">
                  <input
                    name="reported"
                    inputMode="decimal"
                    required
                    defaultValue={
                      batch.reportedMl === null ? "" : inputMl(batch.reportedMl)
                    }
                  />
                </Field>
                <Field label="Açıklama / fark nedeni">
                  <textarea
                    name="note"
                    maxLength={1000}
                    required
                    defaultValue={batch.note || ""}
                  />
                </Field>
                <Field label="Kanıt referansı (sayaç fotoğrafı / dosya numarası)">
                  <input
                    name="evidence"
                    maxLength={500}
                    required
                    defaultValue={batch.evidence || ""}
                  />
                </Field>
                <button className="btn primary">
                  Kapanışı hesapla ve kaydet
                </button>
                <p>
                  Her fiyat dilimi ayrı kuruşa yuvarlanır. Farklı fiyatla
                  kapanış için önce ara okuma gerekir. Kapanış düzeltmeleri
                  işlem geçmişinde saklanır.
                </p>
              </form>
            )}
          </>
        ) : (
          <p>
            Bu hesap için sayaç açılışı bulunmuyor. Donanım tanımlandıktan sonra
            yeni hesabı yukarıdaki sayaç açılış formundan açın. Eski hesaplar
            geriye dönük değiştirilmez.
          </p>
        )}
        <p>
          <a href="/slipler">Ödeme / slip kaydı</a> ·{" "}
          <a href="/vardiyalar">Vardiya teslimi</a> ·{" "}
          <a href="/muhasebe">Bağımsız onay kuyruğu</a>
        </p>
      </Panel>
    </div>
  );
}

import { useEffect, useState, type FormEvent } from "react";
import type { AppState } from "@shared/station";
import { litres, parseLitres } from "@shared/fuel";
import { tankMovementLabels, type TankReport } from "@shared/tank";
import { Panel, Field, Notice } from "./Common";
import { downloadSheets, printSheets } from "@/lib/icmal-export";
import { TankVolumesPanel } from "./TankVolumesPanel";
type Equipment = {
  id: string;
  label: string;
  tankId: string;
  tank: string;
  pump: string;
  fuel: string;
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
export function TankPanel({ state, stationId, busy, onAction }: Props) {
  const [report, setReport] = useState<TankReport | null>(null),
    [deliveries, setDeliveries] = useState<
      {
        id: string;
        reference: string;
        provider: string;
        volumeMl: number;
        tankId: string;
      }[]
    >([]),
    [equipment, setEquipment] = useState<Equipment[]>([]),
    [selected, setSelected] = useState(""),
    [period, setPeriod] = useState("day"),
    [date, setDate] = useState(() =>
      new Date(Date.now() + 10800000).toISOString().slice(0, 10)
    ),
    [month, setMonth] = useState(() =>
      new Date(Date.now() + 10800000).toISOString().slice(0, 7)
    ),
    [shift, setShift] = useState(""),
    [version, setVersion] = useState(0),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(false),
    [kind, setKind] = useState("DELIVERY");
  const station = stationId || state.stations[0]?.id || "",
    role = state.member?.role || "",
    allowed = ["OWNER", "MANAGER", "ACCOUNTANT", "FUEL_STAFF"].includes(role),
    config = ["OWNER", "MANAGER"].includes(role),
    reviewer = ["OWNER", "ACCOUNTANT"].includes(role),
    writable = !!state.tenant?.isDemo && !busy && !loading;
  useEffect(() => {
    let active = true;
    setReport(null);
    setEquipment([]);
    setDeliveries([]);
    if (!station || !allowed) return;
    setLoading(true);
    setError("");
    const query = new URLSearchParams({
      stationId: station,
      ...(period === "day" && date ? { day: date } : {}),
      ...(period === "month" && month ? { month } : {}),
      ...(period === "shift" && shift ? { shiftId: shift } : {}),
    });
    fetch("/api/stationos/tanks?" + query, {
      credentials: "include",
      cache: "no-store",
    })
      .then(async r => {
        const d = await r.json();
        if (!r.ok) throw Error(d.error?.message || "Tank raporu okunamadı.");
        if (active) {
          setReport(d);
          setEquipment(d.equipment);
          setDeliveries(d.deliveryOperations ?? []);
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
  }, [station, allowed, period, date, month, shift, version, state]);
  const tank =
      report?.cards.find(t => t.tankId === selected) ?? report?.cards[0],
    tanks = equipment.filter(
      (n, i, all) => all.findIndex(x => x.tankId === n.tankId) === i
    );
  const requests =
    report?.requests.filter(q => q.tankId === tank?.tankId) ?? [];
  async function submit(e: FormEvent<HTMLFormElement>, action: string) {
    e.preventDefault();
    setError("");
    const f = Object.fromEntries(new FormData(e.currentTarget)) as Record<
      string,
      string
    >;
    try {
      let body: Record<string, unknown> = {
        stationId: station,
        tankId: tank?.tankId,
        expectedRevision: tank?.revision,
        ...f,
      };
      if (action === "card") {
        const old = report?.cards.find(c => c.tankId === f.tankId);
        body = {
          ...body,
          expectedRevision: old?.revision,
          capacityMl: parseLitres(f.capacity),
          criticalMl: parseLitres(f.critical),
          toleranceMl: parseLitres(f.tolerance),
        };
      }
      if (action === "request")
        body = {
          ...body,
          kind,
          ...(kind === "DELIVERY"
            ? {
                documentMl: parseLitres(f.document),
                measuredMl: parseLitres(f.measured),
              }
            : { targetMl: parseLitres(f.target) }),
        };
      if (action === "measure")
        body = { ...body, measuredMl: parseLitres(f.measured) };
      if (await onAction("/tank/" + action, body)) setVersion(v => v + 1);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  const input = (name: string, label: string, value?: string) => (
    <Field label={label}>
      <input
        name={name}
        required
        maxLength={name === "evidence" ? 500 : name === "note" ? 1000 : 190}
        defaultValue={value}
      />
    </Field>
  );
  const proof = (
    <>
      {input("note", "Açıklama / fark nedeni")}
      {input("evidence", "Kanıt referansı")}
    </>
  );
  function sheets() {
    if (!report) return [];
    const movementRows = report.movements.map(m => [
      m.createdAt,
      m.tankNumber,
      tankMovementLabels[m.kind],
      m.deltaMl / 1000,
      m.beforeMl / 1000,
      m.afterMl / 1000,
      m.shiftLabel,
      m.reference,
      m.actorName,
      m.note,
      m.evidence,
    ]);
    const grouped = new Map<
      string,
      {
        tank: string;
        day: string;
        shift: string;
        net: number;
        sale: number;
        test: number;
        delivery: number;
        returned: number;
      }
    >();
    for (const m of report.movements) {
      const day = new Date(new Date(m.createdAt).getTime() + 10800000)
          .toISOString()
          .slice(0, 10),
        key = m.tankId + ":" + day + ":" + (m.shiftLabel || "Vardiya dışı");
      const r = grouped.get(key) ?? {
        tank: m.tankNumber,
        day,
        shift: m.shiftLabel || "Vardiya dışı",
        net: 0,
        sale: 0,
        test: 0,
        delivery: 0,
        returned: 0,
      };
      r.net += m.deltaMl;
      if (m.kind === "SALE") r.sale -= m.deltaMl;
      if (m.kind === "TEST_OUT") r.test -= m.deltaMl;
      if (m.kind === "DELIVERY") r.delivery += m.deltaMl;
      if (m.kind === "TEST_RETURN") r.returned += m.deltaMl;
      grouped.set(key, r);
    }
    return [
      {
        name: "Ürün net ölçümleri",
        rows: [
          [
            "Kayıt zamanı UTC",
            "Tank",
            "Ürün L",
            "Net L",
            "Ham fark L",
            "Açıklama",
            "Kanıt",
          ],
          ...(report.volumes?.readings ?? []).map(r => [
            r.createdAt,
            report.cards.find(c => c.tankId === r.tankId)?.number ?? r.tankId,
            r.productMl / 1000,
            r.netMl / 1000,
            r.spreadMl / 1000,
            r.note,
            r.evidence,
          ]),
        ],
      },
      {
        name: "Dönem fark kapatma",
        rows: [
          [
            "Kayıt zamanı UTC",
            "Tank",
            "Önceki referans L",
            "Yeni referans L",
            "Kapanan fark L",
            "Durum",
            "Açıklama",
            "Kanıt",
          ],
          ...(report.volumes?.resets ?? []).map(r => [
            r.createdAt,
            report.cards.find(c => c.tankId === r.tankId)?.number ?? r.tankId,
            r.previousSpreadMl === null ? null : r.previousSpreadMl / 1000,
            r.baselineSpreadMl / 1000,
            r.closedDifferenceMl === null ? null : r.closedDifferenceMl / 1000,
            r.status,
            r.note,
            r.evidence,
          ]),
        ],
      },
      {
        name: "Tank kartları",
        rows: [
          ["İstasyonOS manuel DEMO tank stok raporu"],
          [
            "Dönem",
            period === "day"
              ? date
              : period === "month"
                ? month
                : shift || "Tüm vardiyalar",
          ],
          ["Kartlar güncel, hareketler filtreli; sensör bağlantısı yok."],
          [
            "Tank",
            "Yakıt",
            "Kapasite L",
            "Onaylı stok L",
            "Doluluk %",
            "Kritik L",
            "Tolerans L",
            "Son ölçüm L",
            "Güncel fark L",
            "Pompalar",
          ],
          ...report.cards.map(t => [
            t.number,
            t.fuel,
            t.capacityMl / 1000,
            t.stockMl === null ? null : t.stockMl / 1000,
            t.fillPercent,
            t.criticalMl / 1000,
            t.toleranceMl / 1000,
            t.measuredMl === null ? null : t.measuredMl / 1000,
            t.differenceMl === null ? null : t.differenceMl / 1000,
            t.pumps,
          ]),
        ],
      },
      {
        name: "Stok defteri",
        rows: [
          [
            "Onay zamanı UTC",
            "Tank",
            "Tür",
            "Hareket L",
            "Önce L",
            "Sonra L",
            "Vardiya",
            "Referans",
            "İşleyen",
            "Açıklama",
            "Kanıt",
          ],
          ...movementRows,
        ],
      },
      {
        name: "Dönem özeti",
        rows: [
          [
            "Gün (Türkiye)",
            "Tank",
            "Vardiya",
            "Ticari çıkış L",
            "Test çıkış L",
            "Tanker giriş L",
            "Test dönüş L",
            "Net hareket L",
          ],
          ...[...grouped.values()].map(g => [
            g.day,
            g.tank,
            g.shift,
            g.sale / 1000,
            g.test / 1000,
            g.delivery / 1000,
            g.returned / 1000,
            g.net / 1000,
          ]),
        ],
      },
      {
        name: "Tanker ve onaylar",
        rows: [
          [
            "Tank",
            "Tür",
            "Durum",
            "Tedarikçi",
            "İrsaliye/ref",
            "Belge L",
            "Ölçülen L",
            "Teslim farkı L",
            "Hedef stok L",
            "Açıklama",
            "Kanıt",
          ],
          ...report.requests.map(q => [
            report.cards.find(c => c.tankId === q.tankId)?.number || q.tankId,
            q.kind,
            q.status,
            q.supplierName,
            q.reference,
            q.documentMl === null ? null : q.documentMl / 1000,
            q.measuredMl === null ? null : q.measuredMl / 1000,
            q.differenceMl === null ? null : q.differenceMl / 1000,
            q.targetMl === null ? null : q.targetMl / 1000,
            q.note,
            q.evidence,
          ]),
        ],
      },
      {
        name: "Ölçüm farkları",
        rows: [
          [
            "Tarih UTC",
            "Tank",
            "Ölçülen L",
            "Teorik L",
            "Fark L",
            "Tolerans içinde",
            "Açıklama",
            "Kanıt",
          ],
          ...report.measurements.map(m => [
            m.createdAt,
            report.cards.find(c => c.tankId === m.tankId)?.number || m.tankId,
            m.measuredMl / 1000,
            m.theoreticalMl === null ? null : m.theoreticalMl / 1000,
            m.differenceMl === null ? null : m.differenceMl / 1000,
            m.withinTolerance === null
              ? "Bilinmiyor"
              : m.withinTolerance
                ? "Evet"
                : "Hayır",
            m.note,
            m.evidence,
          ]),
        ],
      },
    ];
  }
  if (!allowed)
    return (
      <Notice warning>
        Tank ekranı için akaryakıt veya yönetim/muhasebe yetkisi gerekir.
      </Notice>
    );
  return (
    <div className="tank-panel">
      {tank && report?.volumes && (
        <TankVolumesPanel
          key={tank.tankId}
          tank={tank}
          report={report.volumes}
          state={state}
          stationId={station}
          disabled={!writable}
          onAction={onAction}
          refresh={() => setVersion(v => v + 1)}
        />
      )}
      <Notice>
        Manuel DEMO stok yönetimi. Onaylı defter stoku gösterilir;
        sensör/otomasyon bağlantısı yoktur. Ölçüm stok düzeltmez. Kartlar
        günceldir; rapor filtresi hareketlerin onay tarihine uygulanır.
      </Notice>
      {error && <Notice warning>{error}</Notice>}
      {!!report?.pendingAccounts && (
        <Notice warning>
          {report.pendingAccounts} vardiya henüz stok defterine geçmedi; görünen
          onaylı stok bu çıkışları içermez.
        </Notice>
      )}
      <Panel title="Tank kartları ve kritik seviyeler">
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Tank / yakıt</th>
                <th>Kapasite</th>
                <th>Onaylı stok</th>
                <th>Doluluk</th>
                <th>Kritik</th>
                <th>Son ölçüm</th>
                <th>Güncel fark</th>
                <th>Bağlı pompalar</th>
              </tr>
            </thead>
            <tbody>
              {report?.cards.map(t => (
                <tr key={t.tankId}>
                  <td>
                    <button
                      className="btn"
                      onClick={() => setSelected(t.tankId)}
                    >
                      {t.number} / {t.fuel}
                    </button>
                  </td>
                  <td>{litres(t.capacityMl)} L</td>
                  <td>
                    {t.stockMl === null
                      ? "Başlangıç bekliyor"
                      : litres(t.stockMl) + " L"}
                  </td>
                  <td>{t.fillPercent === null ? "—" : t.fillPercent + " %"}</td>
                  <td>
                    {t.critical
                      ? "KRİTİK STOK"
                      : t.critical === null
                        ? "Bilinmiyor"
                        : "Normal"}{" "}
                    / {litres(t.criticalMl)} L
                  </td>
                  <td>
                    {t.measuredMl === null
                      ? "Ölçüm yok"
                      : litres(t.measuredMl) + " L"}{" "}
                    {!t.measurementFresh && t.measuredMl !== null && "(eski)"}
                  </td>
                  <td>
                    {t.differenceMl === null
                      ? "Bilinmiyor"
                      : litres(t.differenceMl) + " L"}{" "}
                    {t.withinTolerance === false
                      ? "TOLERANS DIŞI"
                      : t.withinTolerance === true
                        ? "Tolerans içinde"
                        : ""}
                  </td>
                  <td>{t.pumps}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {loading && <p>Tank verileri yükleniyor…</p>}
        {config && writable && (
          <details>
            <summary>Tank kartını tanımla / güncelle</summary>
            <form
              key={station + ":" + version + "card"}
              className="form-grid"
              onSubmit={e => submit(e, "card")}
            >
              <Field label="Mevcut tank / yakıt">
                <select name="tankId">
                  {tanks.map(t => (
                    <option key={t.tankId} value={t.tankId}>
                      {t.tank} / {t.fuel}
                    </option>
                  ))}
                </select>
              </Field>
              {input("number", "Tank numarası")}
              {input("capacity", "Kapasite (L)")}
              {input("critical", "Kritik stok (L)")}
              {input("tolerance", "Mutlak tolerans (L)")}
              {proof}
              <button className="btn primary">Tank kartını kaydet</button>
              <p>
                Yeni fiziksel tank/yakıt ilişkisi Sayaç ekranında tanımlanır;
                mevcut tankın yakıtı değiştirilmez.
              </p>
            </form>
          </details>
        )}
      </Panel>
      {tank && (
        <Panel
          title="Tanker kabulü, başlangıç ve stok düzeltme"
          subtitle={tank.number + " · Onay öncesinde defter stoku değişmez."}
        >
          <Field label="Tank seçimi">
            <select
              name="tankSelection"
              value={tank.tankId}
              onChange={e => setSelected(e.target.value)}
            >
              {report?.cards.map(t => (
                <option key={t.tankId} value={t.tankId}>
                  {t.number} / {t.fuel}
                </option>
              ))}
            </select>
          </Field>
          {writable && (
            <details>
              <summary>Stok talebi oluştur</summary>
              <form
                key={tank.tankId + ":" + tank.revision + kind}
                className="form-grid"
                onSubmit={e => submit(e, "request")}
              >
                <Field label="İşlem türü">
                  <select
                    name="tankRequestKind"
                    value={kind}
                    onChange={e => setKind(e.target.value)}
                  >
                    <option value="DELIVERY">Tanker teslimi</option>
                    <option value="OPENING">Başlangıç stoku</option>
                    <option value="ADJUSTMENT">
                      Ölçüme dayalı stok düzeltme
                    </option>
                  </select>
                </Field>
                {input("reference", "İrsaliye / benzersiz referans")}
                {kind === "DELIVERY" ? (
                  <>
                    <Field label="Tedarikçi">
                      <select name="supplierId" required>
                        {state.suppliers.map(s => (
                          <option value={s.id} key={s.id}>
                            {s.name}
                          </option>
                        ))}
                      </select>
                    </Field>
                    {input("document", "İrsaliye gelen litre (L)")}
                    {input("measured", "Ölçülen / kabul litre (L)")}
                    <Field label="Bağlı vardiya tanker teslimi (varsa)">
                      <select name="operationId">
                        <option value="">
                          Vardiya dışı / bağlantısız teslim
                        </option>
                        {deliveries
                          .filter(d => d.tankId === tank.tankId)
                          .map(d => (
                            <option value={d.id} key={d.id}>
                              {d.reference} / {d.provider} /{" "}
                              {litres(d.volumeMl)} L
                            </option>
                          ))}
                      </select>
                    </Field>
                  </>
                ) : (
                  input("target", "Ölçülen hedef stok (L)")
                )}
                {proof}
                <button className="btn primary">Bağımsız onaya gönder</button>
              </form>
            </details>
          )}
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Tür / ref</th>
                  <th>Tedarikçi</th>
                  <th>Belge L</th>
                  <th>Kabul L</th>
                  <th>Teslim farkı L</th>
                  <th>Hedef L</th>
                  <th>Durum</th>
                </tr>
              </thead>
              <tbody>
                {requests.map(q => (
                  <tr key={q.id}>
                    <td>
                      {q.kind} / {q.reference}
                    </td>
                    <td>{q.supplierName || "—"}</td>
                    <td>
                      {q.documentMl === null ? "—" : litres(q.documentMl)}
                    </td>
                    <td>
                      {q.measuredMl === null ? "—" : litres(q.measuredMl)}
                    </td>
                    <td>
                      {q.differenceMl === null ? "—" : litres(q.differenceMl)}
                    </td>
                    <td>{q.targetMl === null ? "—" : litres(q.targetMl)}</td>
                    <td>{q.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {reviewer &&
            writable &&
            requests.some(
              q => q.status === "PENDING" && q.createdBy !== state.user.id
            ) && (
              <details>
                <summary>Bağımsız tanker / stok onayı</summary>
                <form
                  key={tank.revision + "review"}
                  className="form-grid"
                  onSubmit={e => submit(e, "review")}
                >
                  <Field label="Bekleyen talep">
                    <select name="stockRequestId">
                      {requests
                        .filter(
                          q =>
                            q.status === "PENDING" &&
                            q.createdBy !== state.user.id
                        )
                        .map(q => (
                          <option value={q.id} key={q.id}>
                            {q.kind} / {q.reference}
                          </option>
                        ))}
                    </select>
                  </Field>
                  <Field label="Karar">
                    <select name="decision">
                      <option value="APPROVE">Kanıtla onayla</option>
                      <option value="REJECT">Reddet</option>
                    </select>
                  </Field>
                  {proof}
                  <button className="btn primary">Kararı kaydet</button>
                  <p>
                    Stok/ayar değişmişse eski talepler onaylanmaz; reddedilip
                    güncel stokla yeniden hazırlanır.
                  </p>
                </form>
              </details>
            )}
          {reviewer &&
            writable &&
            requests.some(
              q =>
                q.kind === "DELIVERY" &&
                q.status !== "REJECTED" &&
                !q.operationId
            ) && (
              <details>
                <summary>Mevcut kabulü Faz 4B teslimine bağla</summary>
                <form className="form-grid" onSubmit={e => submit(e, "link")}>
                  <Field label="Tanker kabulü">
                    <select name="stockRequestId">
                      {requests
                        .filter(
                          q =>
                            q.kind === "DELIVERY" &&
                            q.status !== "REJECTED" &&
                            !q.operationId
                        )
                        .map(q => (
                          <option value={q.id} key={q.id}>
                            {q.reference}
                          </option>
                        ))}
                    </select>
                  </Field>
                  <Field label="Açık vardiyadaki tanker teslimi">
                    <select name="operationId" required>
                      <option value="">Teslim seçin</option>
                      {deliveries
                        .filter(d => d.tankId === tank.tankId)
                        .map(d => (
                          <option value={d.id} key={d.id}>
                            {d.reference} / {d.provider} / {litres(d.volumeMl)}{" "}
                            L
                          </option>
                        ))}
                    </select>
                  </Field>
                  {proof}
                  <button className="btn">Aynı teslimi eşleştir</button>
                  <p>
                    Aynı tank/irsaliye/tedarikçi ve litreler eşleşmeli; ikinci
                    stok girişi oluşturulmaz.
                  </p>
                </form>
              </details>
            )}
        </Panel>
      )}
      {tank && (
        <Panel
          title="Teorik stok / fiziksel ölçüm"
          subtitle="Ölçüm ve fark kanıtıyla saklanır; tolerans içinde olsa da otomatik düzeltme yapılmaz."
        >
          {writable && (
            <form
              key={tank.tankId + ":" + tank.revision + "measure"}
              className="form-grid"
              onSubmit={e => submit(e, "measure")}
            >
              {input("measured", "Manuel fiziksel stok (L)")}
              {proof}
              <button className="btn primary">Ölçümü kaydet</button>
            </form>
          )}
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Tarih</th>
                  <th>Ölçülen L</th>
                  <th>Teorik L</th>
                  <th>Fark L</th>
                  <th>Tolerans</th>
                  <th>Açıklama / kanıt</th>
                </tr>
              </thead>
              <tbody>
                {report?.measurements
                  .filter(m => m.tankId === tank.tankId)
                  .map(m => (
                    <tr key={m.id}>
                      <td>
                        {new Date(m.createdAt).toLocaleString("tr-TR", {
                          timeZone: "Europe/Istanbul",
                        })}
                      </td>
                      <td>{litres(m.measuredMl)}</td>
                      <td>
                        {m.theoreticalMl === null
                          ? "—"
                          : litres(m.theoreticalMl)}
                      </td>
                      <td>
                        {m.differenceMl === null
                          ? "Bilinmiyor"
                          : litres(m.differenceMl)}
                      </td>
                      <td>
                        {m.withinTolerance === null
                          ? "Bilinmiyor"
                          : m.withinTolerance
                            ? "İçinde"
                            : "DIŞINDA"}
                      </td>
                      <td>
                        {m.note} / {m.evidence}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </Panel>
      )}
      <Panel
        title="Vardiya / günlük / aylık stok hareket defteri"
        subtitle="Satış ve test ayrı çıkışlardır. Tüm hareketler bağımsız onaylıdır; geçmiş satırlar silinmez."
      >
        <div className="form-grid">
          <Field label="Rapor dönemi">
            <select
              name="tankPeriod"
              value={period}
              onChange={e => setPeriod(e.target.value)}
            >
              <option value="day">Günlük</option>
              <option value="month">Aylık</option>
              <option value="shift">Vardiya</option>
              <option value="all">Tüm hareketler</option>
            </select>
          </Field>
          {period === "day" && (
            <Field label="Gün">
              <input
                name="tankDay"
                type="date"
                value={date}
                onChange={e => setDate(e.target.value)}
              />
            </Field>
          )}
          {period === "month" && (
            <Field label="Ay">
              <input
                name="tankMonth"
                type="month"
                value={month}
                onChange={e => setMonth(e.target.value)}
              />
            </Field>
          )}
          {period === "shift" && (
            <Field label="Vardiya">
              <select
                name="tankShift"
                value={shift}
                onChange={e => setShift(e.target.value)}
              >
                <option value="">Tüm vardiyalar ve vardiya dışı</option>
                {state.shifts.map(s => (
                  <option value={s.id} key={s.id}>
                    {s.label}
                  </option>
                ))}
              </select>
            </Field>
          )}
        </div>
        <p>
          Filtreli toplamlar: ticari çıkış{" "}
          {litres(
            report?.movements
              .filter(m => m.kind === "SALE")
              .reduce((s, m) => s - m.deltaMl, 0) ?? 0
          )}{" "}
          L · test çıkışı{" "}
          {litres(
            report?.movements
              .filter(m => m.kind === "TEST_OUT")
              .reduce((s, m) => s - m.deltaMl, 0) ?? 0
          )}{" "}
          L · test dönüşü{" "}
          {litres(
            report?.movements
              .filter(m => m.kind === "TEST_RETURN")
              .reduce((s, m) => s + m.deltaMl, 0) ?? 0
          )}{" "}
          L · tanker girişi{" "}
          {litres(
            report?.movements
              .filter(m => m.kind === "DELIVERY")
              .reduce((s, m) => s + m.deltaMl, 0) ?? 0
          )}{" "}
          L.
        </p>
        <button
          className="btn"
          disabled={!report || loading}
          onClick={() => downloadSheets(sheets(), "istasyonos-tank-stok.xlsx")}
        >
          Tank Excel indir
        </button>{" "}
        <button
          className="btn"
          disabled={!report || loading}
          onClick={() => {
            try {
              printSheets(sheets(), "İstasyonOS tank stok raporu");
            } catch (e) {
              setError((e as Error).message);
            }
          }}
        >
          Tank PDF / Yazdır
        </button>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Onay zamanı</th>
                <th>Tank</th>
                <th>Tür</th>
                <th>Hareket L</th>
                <th>Önce L</th>
                <th>Sonra L</th>
                <th>Vardiya / referans</th>
                <th>Kanıt</th>
              </tr>
            </thead>
            <tbody>
              {report?.movements.map(m => (
                <tr key={m.id}>
                  <td>
                    {new Date(m.createdAt).toLocaleString("tr-TR", {
                      timeZone: "Europe/Istanbul",
                    })}
                  </td>
                  <td>{m.tankNumber}</td>
                  <td>{tankMovementLabels[m.kind]}</td>
                  <td>{litres(m.deltaMl)}</td>
                  <td>{litres(m.beforeMl)}</td>
                  <td>{litres(m.afterMl)}</td>
                  <td>
                    {m.shiftLabel || "Vardiya dışı"} / {m.reference}
                  </td>
                  <td>{m.evidence}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p>
          <a href="/icmal">Vardiya mali hesap ve tank stok farkları</a>
        </p>
      </Panel>
    </div>
  );
}

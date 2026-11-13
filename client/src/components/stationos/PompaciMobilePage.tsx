import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { Badge, Empty, Field, MoneyInput, Notice, Panel } from "./Common";
import { PosSlipPanel } from "./PosSlipPanel";
import {
  accountDeclaredTotalMinor,
  amountInput,
  money,
  parseMoney,
  type AppState,
  type PaymentKind,
} from "@shared/station";
import { ApiError, loadState, mutate } from "@/lib/station-api";
import { startLogin } from "@/const";
import { buildOseeSalesSummary } from "@shared/oesse-sales-summary";
import {
  deleteAcknowledgedOperation,
  mobileRequestFor,
  mobileScopeConflict,
  mobileSyncFailure,
  enqueueMobileOperation,
  listMobileOperations,
  operationStatusLabel,
  readMobilePayload,
  readMobileSyncPayload,
  recoverInterruptedOperations,
  requirePositiveMobilePaymentAmount,
  saveMobileSyncPayload,
  updateMobileOperation,
  withMobileSyncLock,
  type MobileQueueItem,
  type MobileQueueKind,
} from "@/lib/mobile-outbox";
import {
  Banknote,
  CloudUpload,
  RefreshCw,
  Send,
  Smartphone,
  Trash2,
} from "lucide-react";

type Props = {
  state: AppState;
  busy: boolean;
  offlineOnly?: boolean;
  offlineContextSavedAt: string | null;
  offlineStorageWarning: string;
  onRefresh: () => Promise<unknown>;
  onSyncVersion: () => void;
  onAction: (
    path: string,
    payload: Record<string, unknown>
  ) => Promise<boolean>;
};

type StationNozzleView = {
  id: string;
  label: string;
  pump: string;
  tank: string;
  fuel: string;
};

export function PompaciMobilePage({
  state,
  busy,
  offlineOnly = false,
  offlineContextSavedAt,
  offlineStorageWarning,
  onRefresh,
  onSyncVersion,
  onAction,
}: Props) {
  const assignedStations = useMemo(
    () => state.stations.filter(s => state.member?.stationIds.includes(s.id)),
    [state.stations, state.member?.stationIds]
  );
  const [stationId, setStationId] = useState(
    () => assignedStations[0]?.id ?? ""
  );
  const station =
    assignedStations.find(s => s.id === stationId) ?? assignedStations[0];
  const stationAccounts = state.accounts.filter(
    a =>
      a.userId === state.user.id &&
      a.stationId === station?.id &&
      a.businessUnit === "FUEL"
  );
  const account = stationAccounts.find(a => a.status === "OPEN");
  const openShifts = state.shifts.filter(
    s =>
      s.stationId === station?.id &&
      s.status === "OPEN" &&
      state.staffingFeaturesAvailable === true &&
      s.assignedUserIds?.includes(state.user.id)
  );
  const blockedShiftAccount = stationAccounts.find(
    a =>
      openShifts.some(s => s.id === a.shiftId) &&
      ["SUBMITTED", "IN_REVIEW", "NEEDS_INFO"].includes(a.status)
  );
  const [shiftId, setShiftId] = useState("");
  const [paymentKind, setPaymentKind] = useState<PaymentKind>("CASH");
  const [error, setError] = useState("");
  const [online, setOnline] = useState(
    () => typeof navigator === "undefined" || navigator.onLine
  );
  const [stationNozzles, setStationNozzles] = useState<StationNozzleView[]>([]);
  const [stationNozzlesLoading, setStationNozzlesLoading] = useState(false);
  const [stationNozzlesError, setStationNozzlesError] = useState("");
  const [queue, setQueue] = useState<MobileQueueItem[]>([]);
  const [syncing, setSyncing] = useState(false);
  const [syncMessage, setSyncMessage] = useState("");
  const [syncVersion, setSyncVersion] = useState(0);
  const [needsLogin, setNeedsLogin] = useState(false);
  const syncLock = useRef(false);
  const saveLock = useRef(false);
  useEffect(() => {
    let active = true;
    setStationNozzles([]);
    setStationNozzlesError("");
    setStationNozzlesLoading(false);
    if (!station || offlineOnly || !online) return;
    setStationNozzlesLoading(true);
    fetch("/api/stationos/fuel?stationId=" + encodeURIComponent(station.id), {
      credentials: "include",
      cache: "no-store",
    })
      .then(async response => {
        const data = await response.json();
        if (!response.ok)
          throw new Error(data.error?.message || "Pompa listesi okunamadı.");
        const equipment = Array.isArray(data.equipment)
          ? data.equipment.filter(
              (item: unknown): item is StationNozzleView =>
                !!item &&
                typeof item === "object" &&
                "id" in item &&
                typeof item.id === "string" &&
                "label" in item &&
                typeof item.label === "string" &&
                "pump" in item &&
                typeof item.pump === "string" &&
                "tank" in item &&
                typeof item.tank === "string" &&
                "fuel" in item &&
                typeof item.fuel === "string"
            )
          : [];
        if (active) setStationNozzles(equipment);
      })
      .catch(cause => {
        if (active)
          setStationNozzlesError(
            cause instanceof Error ? cause.message : "Pompa listesi okunamadı."
          );
      })
      .finally(() => {
        if (active) setStationNozzlesLoading(false);
      });
    return () => {
      active = false;
    };
  }, [station?.id, offlineOnly, online]);
  const scopeFor = (accountForScope = account) => {
    if (!state.member || !state.tenant?.id || !station || !accountForScope)
      throw new Error("Doğrulanmış vardiya kapsamı bulunamadı.");
    if (
      state.member.role !== "FUEL_STAFF" ||
      accountForScope.userId !== state.user.id ||
      accountForScope.stationId !== station.id ||
      accountForScope.businessUnit !== "FUEL"
    )
      throw new Error(
        "Yalnız kendi yetkili akaryakıt hesabınıza işlem ekleyebilirsiniz."
      );
    return {
      userId: state.user.id,
      tenantId: state.tenant.id,
      stationId: station.id,
      shiftId: accountForScope.shiftId,
      accountId: accountForScope.id,
    };
  };

  const reloadQueue = useCallback(async () => {
    try {
      setQueue(await listMobileOperations(state.user.id));
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Yerel kuyruk okunamadı."
      );
    }
  }, [state.user.id]);

  const syncQueue = useCallback(async () => {
    if (offlineOnly || !navigator.onLine || syncLock.current) return;
    syncLock.current = true;
    setSyncing(true);
    setNeedsLogin(false);
    setSyncMessage("");
    try {
      const lockResult = await withMobileSyncLock(async () => {
        try {
          const queued = await recoverInterruptedOperations(
            state.user.id,
            true
          );
          setQueue(queued);
          for (const item of queued) {
            if (item.status === "SYNCED") continue;
            if (
              item.status === "CONFLICT" ||
              (item.status === "FAILED" && !item.retryable)
            ) {
              setSyncMessage(
                "Kuyrukta çözümlenmemiş bir kayıt var. Sonraki kayıtların sırası korunuyor; önce bu kayıt incelenmeli."
              );
              break;
            }
            if (
              item.status !== "PENDING_SYNC" &&
              !(item.status === "FAILED" && item.retryable)
            )
              continue;
            if (!navigator.onLine) {
              setSyncMessage(
                "Bağlantı kesildi; kalan kayıtlar cihazda bekliyor."
              );
              break;
            }
            try {
              const live = await loadState(item.stationId);
              const liveAccount = live.accounts.find(
                a => a.id === item.accountId
              );
              const scopeError = mobileScopeConflict(
                item,
                live,
                liveAccount,
                !!item.encryptedSyncPayload
              );
              if (scopeError) {
                await updateMobileOperation(item.clientOperationId, {
                  status: "CONFLICT",
                  retryable: false,
                  errorCode: scopeError,
                });
                setSyncMessage(
                  "Kullanıcı, şirket veya istasyon kapsamı değişmiş. Kayıt silinmedi; yönetici incelemesi gerekli."
                );
                await reloadQueue();
                break;
              }
              const original = await readMobilePayload(item);
              if (
                item.kind === "PAYMENT" &&
                original.kind === "FAST" &&
                !live.fastPaymentAvailable
              ) {
                setSyncMessage(
                  "FAST migrationı sunucuda etkin değil. Bu kayıt değişmeden cihaz kuyruğunda kaldı; IBAN'a çevrilmedi."
                );
                break;
              }
              let body = await readMobileSyncPayload(item);
              if (!body) {
                body = mobileRequestFor(item, original, liveAccount!).body;
                await saveMobileSyncPayload(item.clientOperationId, body);
              }
              await updateMobileOperation(item.clientOperationId, {
                status: "SYNCING",
                attemptCount: item.attemptCount + 1,
                errorCode: undefined,
              });
              const route = mobileRequestFor(item, {}, liveAccount!).path;
              await mutate(route, body, item.clientOperationId, live.csrfToken);
              await updateMobileOperation(item.clientOperationId, {
                status: "SYNCED",
                acknowledgedAt: new Date().toISOString(),
                retryable: false,
                errorCode: undefined,
                encryptedPayload: null,
                encryptedSyncPayload: null,
              });
              await reloadQueue();
              onSyncVersion();
              setSyncVersion(value => value + 1);
              await onRefresh();
            } catch (cause) {
              const status = cause instanceof ApiError ? cause.status : 0;
              const code =
                cause instanceof ApiError ? cause.code : "SYNC_FAILED";
              const failure = mobileSyncFailure(status, code);
              await updateMobileOperation(item.clientOperationId, {
                status: failure.status,
                retryable: failure.retryable,
                errorCode: failure.errorCode,
              });
              if (failure.category === "NETWORK") {
                setSyncMessage(
                  "Sunucu yanıtı kesinleşmedi. Aynı işlem kimliğiyle yeniden denenecek; kayıt cihazda korundu."
                );
              } else if (failure.category === "SESSION") {
                setNeedsLogin(true);
                setSyncMessage(
                  "Oturum süresi dolmuş. Yeniden girişten sonra aynı işlem kimliğiyle devam edin."
                );
              } else if (failure.category === "CONFLICT") {
                setSyncMessage(
                  "Sunucu yetki veya kayıt çakışması bildirdi. Kayıt silinmedi; inceleme gerekli."
                );
              } else {
                setSyncMessage(
                  "Sunucu kaydı reddetti. İçerik cihazda korundu; düzeltme/inceleme gerekli."
                );
              }
              await reloadQueue();
              break;
            }
          }
        } catch (cause) {
          setSyncMessage(
            cause instanceof Error
              ? cause.message
              : "Senkronizasyon tamamlanamadı; kayıtlar korundu."
          );
        }
      });
      if (!lockResult.acquired) {
        setSyncMessage(
          "Baska bir sekme esitleme yapiyor veya tarayici kilidi desteklemiyor. Kuyruk korundu; tek sekme kullanin."
        );
      }
    } catch (cause) {
      setSyncMessage(
        cause instanceof Error
          ? cause.message
          : "Senkronizasyon kilidi alinamadi; kayitlar korundu."
      );
    } finally {
      syncLock.current = false;
      setSyncing(false);
    }
  }, [offlineOnly, state.user.id, reloadQueue, onRefresh, onSyncVersion]);

  const queueOperation = async (
    kind: MobileQueueKind,
    payload: Record<string, unknown>,
    fingerprint?: string
  ) => {
    if (saveLock.current) return false;
    saveLock.current = true;
    try {
      const accountScope = scopeFor();
      await enqueueMobileOperation(
        { ...accountScope, ...(fingerprint ? { fingerprint } : {}) },
        kind,
        payload
      );
      await reloadQueue();
      if ("serviceWorker" in navigator) {
        void navigator.serviceWorker.ready
          .then(registration => {
            const syncRegistration =
              registration as ServiceWorkerRegistration & {
                sync?: { register: (tag: string) => Promise<void> };
              };
            return syncRegistration.sync?.register("stationos-mobile-outbox");
          })
          .catch(() => undefined);
      }
      if (navigator.onLine && !offlineOnly) await syncQueue();
      return true;
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Kayıt cihazda saklanamadı."
      );
      return false;
    } finally {
      saveLock.current = false;
    }
  };

  useEffect(() => {
    void reloadQueue();
  }, [reloadQueue]);
  useEffect(() => {
    if (!offlineOnly && navigator.onLine) void syncQueue();
  }, [offlineOnly, syncQueue]);
  useEffect(() => {
    const onlineHandler = () => {
      setOnline(true);
      if (!offlineOnly) void syncQueue();
    };
    const offlineHandler = () => setOnline(false);
    const messageHandler = (event: MessageEvent) => {
      if (event.data?.type === "STATIONOS_SYNC_OUTBOX") void syncQueue();
    };
    const visibilityHandler = () => {
      if (
        document.visibilityState === "visible" &&
        navigator.onLine &&
        !offlineOnly
      )
        void syncQueue();
    };
    window.addEventListener("online", onlineHandler);
    window.addEventListener("offline", offlineHandler);
    navigator.serviceWorker?.addEventListener("message", messageHandler);
    document.addEventListener("visibilitychange", visibilityHandler);
    return () => {
      window.removeEventListener("online", onlineHandler);
      window.removeEventListener("offline", offlineHandler);
      navigator.serviceWorker?.removeEventListener("message", messageHandler);
      document.removeEventListener("visibilitychange", visibilityHandler);
    };
  }, [offlineOnly, syncQueue]);

  async function openAccount(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (offlineOnly || !navigator.onLine) {
      setError(
        "Vardiya hesabı yalnız çevrimiçiyken sunucudan açılabilir. Önceden sunucuda açılmış kendi hesabınızda çevrimdışı kayıt yapabilirsiniz."
      );
      return;
    }
    const form = new FormData(event.currentTarget);
    try {
      const openingFloatMinor = parseMoney(
        String(form.get("openingFloat") ?? "0")
      );
      const ok = await onAction("/account/open", {
        stationId: station?.id,
        shiftId: String(form.get("shiftId") ?? ""),
        businessUnit: "FUEL",
        openingFloatMinor,
      });
      if (ok) setError("");
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Bilgileri kontrol edin."
      );
    }
  }

  async function addPayment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!account) return;
    const form = new FormData(event.currentTarget);
    try {
      if (paymentKind === "FAST" && !state.fastPaymentAvailable)
        throw new Error(
          "FAST gönderimi için 0018 veritabanı migrationı gerekir."
        );
      const debtorId = String(form.get("debtorId") ?? "");
      const ok = await queueOperation("PAYMENT", {
        kind: paymentKind,
        amountMinor: requirePositiveMobilePaymentAmount(
          parseMoney(String(form.get("amount") ?? ""))
        ),
        ...(paymentKind === "DEBT" && debtorId ? { debtorId } : {}),
        reference: String(form.get("reference") ?? "").trim(),
      });
      if (ok) (event.currentTarget as HTMLFormElement).reset();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Ödeme bilgilerini kontrol edin."
      );
    }
  }

  async function submitAccount(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!account) return;
    const form = new FormData(event.currentTarget);
    try {
      const ok = await queueOperation("ACCOUNT_SUBMIT", {
        countedCashMinor: parseMoney(String(form.get("countedCash") ?? "")),
      });
      if (ok) setError("");
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Kasa tutarını kontrol edin."
      );
    }
  }

  if (!assignedStations.length) {
    return (
      <Empty
        title="İstasyon erişimi bulunamadı"
        text="Hesabınıza istasyon yetkisi tanımlanması için yöneticinize başvurun."
      />
    );
  }

  const declaredAccountControlTotal = account
    ? accountDeclaredTotalMinor(account)
    : 0;
  const selectedShift = account
    ? state.shifts.find(shift => shift.id === account.shiftId)
    : null;
  const businessDate = selectedShift
    ? new Intl.DateTimeFormat("en-CA", {
        timeZone: "Europe/Istanbul",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(new Date(selectedShift.startsAt))
    : "";
  const salesSummary = buildOseeSalesSummary({
    declarations: {
      cashMinor: account?.cashSalesMinor ?? 0,
      cardSlipMinor: account?.cardTotalMinor ?? 0,
      ibanMinor: account?.ibanMinor ?? 0,
      fastMinor: account?.fastMinor ?? 0,
      debtMinor: account?.debtMinor ?? 0,
      specialOperationsMinor: account?.specialCoveredMinor ?? 0,
    },
    expectedScope:
      account && state.tenant?.id && businessDate
        ? {
            tenantId: state.tenant.id,
            stationId: account.stationId,
            businessDate,
            shiftId: account.shiftId,
            staffUserId: account.userId,
          }
        : null,
    // This screen has no person-level automation report source. The account's
    // legacy control total is deliberately not treated as that evidence.
    automation: null,
  });
  const accountHasUnresolvedQueue =
    !!account &&
    queue.some(
      item => item.accountId === account.id && item.status !== "SYNCED"
    );
  const sourceReady =
    !!account?.sourceRef &&
    account.sourceSalesMinor !== null &&
    account.sourceSalesMinor === declaredAccountControlTotal &&
    !accountHasUnresolvedQueue;
  const expectedPhysicalCash = account
    ? account.expectedCashMinor + account.openingFloatMinor
    : 0;

  return (
    <div className="pompaci-mobile">
      <Panel
        title="ÖSSE Mobil"
        subtitle="Çevrimdışı beyanlar cihazda şifreli sıraya alınır; sunucu yanıtı gelince kaydedilmiş sayılır."
      >
        <div className="pompaci-mobile-heading">
          <Smartphone size={22} />
          <span>
            Merhaba, <b>{state.user.name}</b>
          </span>
        </div>
        {offlineOnly && offlineContextSavedAt && (
          <Notice warning>
            Çevrimdışı, son yetki doğrulaması{" "}
            {new Date(offlineContextSavedAt).toLocaleString("tr-TR")} tarihinde
            alındı. Bu oturum en fazla 24 saatlik şifreli yerel kapsamı
            kullanır; sunucu kayıtları yeniden doğrulayacaktır.
          </Notice>
        )}
        {offlineStorageWarning && (
          <Notice warning>{offlineStorageWarning}</Notice>
        )}
        {error && (
          <div role="alert" aria-live="assertive">
            <Notice warning>{error}</Notice>
          </div>
        )}
        <Field label="Yetkili istasyon">
          <select
            value={station?.id ?? ""}
            onChange={event => {
              setStationId(event.target.value);
              setShiftId("");
            }}
          >
            {assignedStations.map(item => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </Field>
        <details>
          <summary>
            İstasyon pompa/tabanca listesi{" "}
            {stationNozzlesLoading
              ? "· yükleniyor"
              : "· " + stationNozzles.length + " tabanca"}
          </summary>
          <Notice>
            Liste seçili yetkili istasyonun salt-okunur ekipman görünümüdür. Bir
            satışın ÖSSE’ye ait olduğunu tek başına kanıtlamaz ve sayaç
            hesabının tabanca kilidini değiştirmez.
          </Notice>
          {stationNozzlesError && (
            <Notice warning>{stationNozzlesError}</Notice>
          )}
          {offlineOnly || !online ? (
            <p>Çevrimdışıyken canlı pompa listesi alınamıyor.</p>
          ) : stationNozzles.length ? (
            <ul>
              {stationNozzles.map(nozzle => (
                <li key={nozzle.id}>
                  {nozzle.pump} · Tabanca {nozzle.label} · {nozzle.tank} ·{" "}
                  {nozzle.fuel}
                </li>
              ))}
            </ul>
          ) : (
            !stationNozzlesLoading &&
            !stationNozzlesError && (
              <p>Bu istasyonda pompa/tabanca kaydı yok.</p>
            )
          )}
        </details>
        {queue.some(
          item => item.stationId !== station?.id && item.status !== "SYNCED"
        ) && (
          <Notice warning>
            Başka istasyon kapsamındaki çevrimdışı kayıtlar kuyrukta korunuyor.
            İstasyon değişikliği bu kayıtları taşımaz; her kayıt kendi vardiya
            ve hesap kapsamıyla eşitlenir.
          </Notice>
        )}
        {account ? (
          <div className="pompaci-account-status">
            <div>
              <span>{station?.name}</span>
              <b>
                {state.shifts.find(s => s.id === account.shiftId)?.label ??
                  "Vardiya"}
              </b>
            </div>
            <Badge status={account.status} />
          </div>
        ) : blockedShiftAccount ? (
          <Notice>
            Bu vardiyadaki hesabınız muhasebe sürecinde (
            {blockedShiftAccount.status}). Hesap kilidini muhasebe/yönetici
            süreci yönetir.
          </Notice>
        ) : offlineOnly ? (
          <Notice warning>
            Yeni vardiya hesabı çevrimdışıyken açılamaz. Daha önce sunucuda
            açılmış kendi vardiya hesabı bulununca kayıt ekleyebilirsiniz.
          </Notice>
        ) : !state.staffingFeaturesAvailable ? (
          <Notice warning>
            ÖSSE için vardiya atama şeması etkin değil. Yeni hesap açma, atama
            doğrulaması yapılana kadar güvenlik gereği kapalıdır. Yöneticiye
            başvurun.
          </Notice>
        ) : openShifts.length ? (
          <form className="pompaci-mobile-form" onSubmit={openAccount}>
            <h3>Vardiyaya başla</h3>
            <Field label="Açık vardiya">
              <select
                required
                value={shiftId}
                name="shiftId"
                onChange={event => setShiftId(event.target.value)}
              >
                <option value="">Vardiya seçin</option>
                {openShifts.map(shift => (
                  <option key={shift.id} value={shift.id}>
                    {shift.label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Vardiya açılış avansı">
              <MoneyInput name="openingFloat" defaultValue="0,00" />
            </Field>
            <button
              className="btn primary"
              disabled={busy || !openShifts.some(shift => shift.id === shiftId)}
            >
              <Banknote size={17} /> Hesabımı aç
            </button>
          </form>
        ) : (
          <Notice warning>
            Bu istasyonda size atanmış açık vardiya yok. Yetkili yöneticiniz
            vardiya tanımlayıp sizi atadığında burada görünür.
          </Notice>
        )}
      </Panel>

      {account && (
        <>
          <Panel
            title="Vardiya satış özeti"
            subtitle="Satış toplamı ile ödeme/cari beyanı ayrı kavramlardır."
          >
            <div className="pompaci-summary-grid">
              <div>
                <span>ÖSSE ödeme/cari beyan toplamı</span>
                <b>{money(salesSummary.declaredTotalMinor)}</b>
              </div>
              <div>
                <span>Otomasyon personel satış toplamı</span>
                <b>
                  {salesSummary.automationSalesMinor === null
                    ? "Doğrulanmış kaynak yok"
                    : money(salesSummary.automationSalesMinor)}
                </b>
              </div>
              <div>
                <span>Satış / beyan farkı</span>
                <b>
                  {salesSummary.differenceMinor === null
                    ? "Hesaplanmadı"
                    : money(salesSummary.differenceMinor)}
                </b>
              </div>
            </div>
            <Notice warning>
              Personel, istasyon, tarih ve vardiya kapsamındaki otomasyon satırı
              bu mobil hesap kaynağında doğrulanmış değil. Fark bu nedenle
              hesaplanmıyor; ödeme türü toplamları otomasyon satış toplamı
              yerine kullanılmıyor.
            </Notice>
            <small>Kaynak durumu: {salesSummary.status}</small>
          </Panel>
          <div className="pompaci-summary-grid">
            <div>
              <span>Nakit beyanı</span>
              <b>{money(account.cashSalesMinor)}</b>
            </div>
            <div>
              <span>Kart slipleri</span>
              <b>{money(account.cardTotalMinor)}</b>
            </div>
            <div>
              <span>Havale beyanı</span>
              <b>{money(account.ibanMinor)}</b>
            </div>
            <div>
              <span>FAST · teyit bekliyor</span>
              <b>{money(account.fastMinor)}</b>
            </div>
            <div>
              <span>Cari/borç satışı</span>
              <b>{money(account.debtMinor)}</b>
            </div>
            <div>
              <span>TTS/özel işlem (ayrı)</span>
              <b>{money(salesSummary.specialOperationsMinor)}</b>
            </div>
            <div>
              <span>Fizikî kasa hedefi</span>
              <b>{money(expectedPhysicalCash)}</b>
            </div>
          </div>
          <Panel
            title="Tahsilat veya cari satış kaydet"
            subtitle="FAST ve havale personel beyanıdır; banka teyidi sayılmaz. Cari satış tahsilat toplamına eklenmez."
          >
            <form className="pompaci-mobile-form" onSubmit={addPayment}>
              <Field label="İşlem türü">
                <select
                  value={paymentKind}
                  onChange={e => setPaymentKind(e.target.value as PaymentKind)}
                >
                  <option value="CASH">Nakit</option>
                  <option value="IBAN">Havale / IBAN</option>
                  <option value="FAST" disabled={!state.fastPaymentAvailable}>
                    FAST
                    {state.fastPaymentAvailable ? "" : " · migration gerekli"}
                  </option>
                  <option value="DEBT">Cari / borç satışı</option>
                </select>
              </Field>
              {paymentKind === "DEBT" && (
                <Field label="Müşteri / cari">
                  <select name="debtorId" required defaultValue="">
                    <option value="">Cari seçin</option>
                    {state.debtors
                      .filter(d => d.stationId === station?.id)
                      .map(d => (
                        <option key={d.id} value={d.id}>
                          {d.name}
                        </option>
                      ))}
                  </select>
                </Field>
              )}
              <Field label="Tutar">
                <MoneyInput name="amount" />
              </Field>
              <Field label="Açıklama / referans (isteğe bağlı)">
                <input name="reference" maxLength={190} autoComplete="off" />
              </Field>
              <button className="btn primary" disabled={busy || syncing}>
                <Banknote size={17} />{" "}
                {online
                  ? "Beyanı kaydet ve eşitle"
                  : "Beyanı cihazda sıraya al"}
              </button>
            </form>
            <Notice warning>
              FAST ve havale ayrı beyanlardır; FAST banka teyidi değildir. 0018
              migrationı bulunmadığında FAST seçimi/gönderimi kapalıdır; daha
              önce kuyruklanmış FAST kaydı sunucu reddederse cihaz kuyruğunda
              kalır.
            </Notice>
          </Panel>

          <PosSlipPanel
            state={state}
            stationId={station?.id ?? ""}
            busy={busy || syncing}
            onAction={onAction}
            syncVersion={syncVersion}
            onQueueSlip={(payload, fingerprint) =>
              queueOperation("POS_SLIP_IMAGE", payload, fingerprint)
            }
          />

          <Panel
            title="Hesabı muhasebeye gönder"
            subtitle="Gönderim hesabı kilitler; düzeltme gerekiyorsa muhasebe hesabı iade eder."
          >
            {!sourceReady && (
              <Notice warning>
                Gönderim kilitli: mevcut hesap teslim kontrolü için kaynak
                kontrol tutarı ve referansı gerekir; bu kontrol tutarı otomasyon
                personel satış raporunun doğrulandığı anlamına gelmez. Yetkili
                yönetici/muhasebe kaynağı bağlar.
              </Notice>
            )}
            {account.sourceSalesMinor !== null && (
              <p className="pompaci-reconcile">
                Hesap teslim kontrol tutarı:{" "}
                <b>{money(account.sourceSalesMinor)}</b> · ödeme/cari beyan
                kontrol toplamı: <b>{money(declaredAccountControlTotal)}</b> ·
                kontrol farkı:{" "}
                <b>
                  {money(
                    account.sourceSalesMinor - declaredAccountControlTotal
                  )}
                </b>
                {account.sourceRef
                  ? ` · ${account.sourceRef}`
                  : " · kaynak referansı yok"}
              </p>
            )}
            <form className="pompaci-mobile-form" onSubmit={submitAccount}>
              <Field label="Sayılmış fizikî kasa">
                <MoneyInput
                  name="countedCash"
                  defaultValue={amountInput(expectedPhysicalCash)}
                />
              </Field>
              <small>
                Kasadaki gerçek nakit miktarını sayıp girin. Beklenen değer
                açılış avansını içerir; fark varsa backend teslimi reddeder ve
                inceleme gerekir.
              </small>
              <button className="btn primary" disabled={busy || !sourceReady}>
                <Send size={17} />{" "}
                {online
                  ? "Muhasebeye gönder"
                  : "Gönderim isteğini cihazda sıraya al"}
              </button>
            </form>
          </Panel>
        </>
      )}

      <Panel
        title="Çevrimdışı kayıt kuyruğu"
        subtitle="Sunucu yanıtı gelmeden kayıtlar alınmış veya muhasebeye gönderilmiş sayılmaz."
      >
        <Notice>
          Çevrimdışı kuyruk yalnız bu tarayıcı profilinde saklanır.
          Tarayıcı/uygulama verilerini temizlemek veya cihazı kaybetmek
          senkronize olmamış kayıtları kurtarılamaz hâle getirebilir. Senkronize
          kayıt yerel kopyadan yalnız sunucu yanıtı doğrulandıktan sonra
          temizlenebilir.
        </Notice>
        <div className="pompaci-sync-bar">
          <span className={online ? "pompaci-online" : "pompaci-offline"}>
            {online ? "Bağlantı var" : "Çevrimdışı"} ·{" "}
            {
              queue.filter(
                item =>
                  item.status === "PENDING_SYNC" || item.status === "SYNCING"
              ).length
            }{" "}
            bekleyen
          </span>
          <button
            type="button"
            className="btn secondary"
            disabled={syncing || offlineOnly || !online}
            onClick={() => void syncQueue()}
          >
            <RefreshCw size={16} /> Şimdi senkronize et
          </button>
        </div>
        {needsLogin && (
          <Notice warning>
            <button
              className="btn secondary"
              type="button"
              onClick={() => startLogin()}
            >
              Yeniden giriş yap
            </button>{" "}
            Oturum yenilendikten sonra bekleyenler aynı işlem kimliğiyle
            denenir.
          </Notice>
        )}
        {syncMessage && (
          <div role="status" aria-live="polite">
            <Notice warning>{syncMessage}</Notice>
          </div>
        )}
        {offlineOnly && (
          <Notice>
            Bu cihazdaki kayıtları bu eski yetki kapsamıyla yalnız yerel kuyruğa
            ekleyebilirsiniz. Sunucuya gönderim için çevrimiçi olarak yeniden
            giriş yapın.
          </Notice>
        )}
        {queue.length ? (
          <div className="pompaci-queue-list">
            {queue.map(item => (
              <div className="pompaci-queue-item" key={item.clientOperationId}>
                <div>
                  <b>
                    {item.kind === "PAYMENT"
                      ? "Ödeme / cari beyanı"
                      : item.kind === "POS_SLIP_IMAGE"
                        ? "Maskeli slip fotoğrafı"
                        : "Vardiya gönderim isteği"}
                  </b>
                  <small>
                    {new Date(item.createdAt).toLocaleString("tr-TR")} ·{" "}
                    {item.clientOperationId.slice(0, 8)}
                  </small>
                </div>
                <span
                  className={`pompaci-queue-status status-${item.status.toLowerCase()}`}
                >
                  {operationStatusLabel(item.status)}
                </span>
                {item.status === "FAILED" && item.retryable && (
                  <button
                    type="button"
                    className="inline-link"
                    disabled={syncing || !online || offlineOnly}
                    onClick={() =>
                      void updateMobileOperation(item.clientOperationId, {
                        status: "PENDING_SYNC",
                      }).then(() => syncQueue())
                    }
                  >
                    Tekrar dene
                  </button>
                )}
                {item.status === "SYNCED" && (
                  <button
                    type="button"
                    className="icon-button"
                    aria-label="Sunucu onaylı kaydı cihazdan temizle"
                    title="Sunucu yanıtı doğrulandı; cihaz kopyasını temizle"
                    onClick={() =>
                      void deleteAcknowledgedOperation(item).then(reloadQueue)
                    }
                  >
                    <Trash2 size={15} />
                  </button>
                )}
              </div>
            ))}
          </div>
        ) : (
          <p className="field-note">
            Bu kullanıcı için cihazda bekleyen kayıt yok.
          </p>
        )}
      </Panel>
    </div>
  );
}

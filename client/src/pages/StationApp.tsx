import LocalLoginForm from "./LocalLoginForm";
import { TankValidationPanel } from "@/components/stationos/TankValidationPanel";
import { TankerDocumentPanel } from "@/components/stationos/TankerDocumentPanel";
import { PosSlipPanel } from "@/components/stationos/PosSlipPanel";
import { PompaciMobilePage } from "@/components/stationos/PompaciMobilePage";
import { loadOfflineContext, saveOfflineContext } from "@/lib/mobile-outbox";
import { TankPanel } from "@/components/stationos/TankPanel";
import { IcmalPanel } from "@/components/stationos/IcmalPanel";
import { FuelPanel } from "@/components/stationos/FuelPanel";
import { ProfilePanel } from "@/components/stationos/ProfilePanel";
import { PersonnelPanel } from "@/components/stationos/PersonnelPanel";
import { useOperationRecovery } from "@/hooks/useOperationRecovery";
import { OperationRecoveryNotice } from "@/components/stationos/OperationRecoveryNotice";
import { isRecoverableOperation } from "@shared/operation-recovery";
import { HistoricalDashboard } from "@/components/stationos/HistoricalDashboard";
import { SmartAssistantPanel } from "@/components/stationos/SmartAssistantPanel";
import {
  formatTurkeyInstant,
  turkeyDateTimeInput,
  turkeyInputToIso,
} from "@shared/datetime";
import { MessageSquare } from "lucide-react";
import { lazy, Suspense } from "react";
const AssistantPanel = lazy(
  () => import("@/components/stationos/AssistantPanel")
);
const DailyReportPanel = lazy(() =>
  import("@/components/stationos/DailyReportPanel").then(module => ({
    default: module.DailyReportPanel,
  }))
);
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/_core/hooks/useAuth";
import { startLogin } from "@/const";
import {
  ApiError,
  loadState,
  mutate,
  getDeviceIdentity,
} from "@/lib/station-api";
import {
  money,
  parseMoney,
  amountInput,
  roleLabels,
  paymentLabels,
  roleLandingPath,
  roleCanAccessPath,
  accountDeclaredTotalMinor,
  type AppState,
  type Account,
  type AppRole,
} from "@shared/station";
import {
  Badge,
  Empty,
  Field,
  Metric,
  Modal,
  MoneyInput,
  Notice,
  Panel,
  SubmitButton,
  fmtDate,
  formObject,
} from "@/components/stationos/Common";
import { BusinessModules } from "@/components/stationos/BusinessModules";
import {
  Activity,
  ArrowDownLeft,
  ArrowRight,
  ArrowUpRight,
  Banknote,
  Building2,
  ChevronDown,
  Clock3,
  CreditCard,
  FileCheck2,
  Fuel,
  LayoutDashboard,
  Link2,
  LogOut,
  Menu,
  Package,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  ShoppingCart,
  Users,
  Wallet,
  X,
  CheckCheck,
  CircleHelp,
  LockKeyhole,
  Download,
  Monitor,
  Smartphone,
} from "lucide-react";
import { toast } from "sonner";

const navItems = [
  {
    path: "/",
    label: "Genel bakış",
    icon: LayoutDashboard,
    group: "OPERASYON",
  },
  { path: "/vardiyalar", label: "Vardiya hesapları", icon: Clock3 },
  { path: "/mobil/pompaci", label: "ÖSSE Mobil", icon: Smartphone },
  { path: "/sayaclar", label: "Sayaç mutabakatı", icon: Fuel },
  { path: "/icmal", label: "Vardiya Mali Hesap", icon: FileCheck2 },
  { path: "/tanklar", label: "Tank ve yakıt stoku", icon: Fuel },
  { path: "/tank-dogrulama", label: "Tank veri doğrulama", icon: ShieldCheck },
  { path: "/gunluk-rapor", label: "Günlük rapor aktarımı", icon: FileCheck2 },
  { path: "/tanker-belge", label: "Tanker evrakı", icon: FileCheck2 },
  { path: "/slipler", label: "Slip ve ödeme", icon: CreditCard },
  { path: "/muhasebe", label: "Onay kuyruğu", icon: FileCheck2 },
  { path: "/market", label: "Market ve stok", icon: Package, group: "İŞLETME" },
  { path: "/satinalma", label: "Satın alma", icon: ShoppingCart },
  { path: "/cari", label: "Cari ve alacak", icon: Users },
  { path: "/finans", label: "Finansal görünüm", icon: Wallet },
  {
    path: "/kurulum",
    label: "Firma ve istasyon",
    icon: Building2,
    group: "YÖNETİM",
  },
  { path: "/entegrasyon", label: "Entegrasyonlar", icon: Link2 },
  { path: "/personel", label: "Personel", icon: Users },
  { path: "/asistan", label: "Akıllı Asistan", icon: MessageSquare },
  { path: "/denetim", label: "İşlem geçmişi", icon: ShieldCheck },
  { path: "/profil", label: "Profilim", icon: LockKeyhole },
];
const pageInfo: Record<string, [string, string]> = {
  "/tanker-belge": [
    "Tanker evrakı ve yakıt kabulü",
    "Belge okuma önerisi, kullanıcı kontrolü ve bağımsız stok onayı.",
  ],
  "/gunluk-rapor": [
    "Günlük rapor aktarımı",
    "ZIP kaynakları, fotoğraflar ve kullanıcı doğrulamalı DEMO taslakları.",
  ],
  "/tank-dogrulama": [
    "Tank veri doğrulama",
    "Kaynak fotoğraf, önerilen değer ve DEMO taslak kararı.",
  ],
  "/tanklar": [
    "Tank ve yakıt stok yönetimi",
    "Onaylı stok defteri, tanker kabulü ve manuel ölçüm mutabakatı.",
  ],
  "/icmal": [
    "Vardiya Mali Hesap",
    "Sayaç, ticari satış, özel işlemler ve tank mutabakatı.",
  ],
  "/sayaclar": [
    "Pompa ve sayaç mutabakatı",
    "Manuel açılış, fiyat ara okuması ve litre–tutar kontrolü.",
  ],
  "/": [
    "İşletmenizin operasyon görünümü",
    "Seçili kapsamdaki kayıtlar, vardiyadan merkeze tek ekranda.",
  ],
  "/vardiyalar": [
    "Vardiya hesapları",
    "Kendi hesabınızı açın, ödemelerinizi kaydedin ve teslim edin.",
  ],
  "/slipler": [
    "Slip ve ödeme kayıtları",
    "Her kart işlemi ayrı referansla, mükerrer kayda karşı kontrollü.",
  ],
  "/muhasebe": [
    "Muhasebe onay kuyruğu",
    "Fizikî teslim, kaynak kontrolü ve iki ayrı kişinin mali onayı.",
  ],
  "/market": [
    "Market ve stok",
    "Adet bazlı ürün hareketleri ve anlık stok kontrolü.",
  ],
  "/satinalma": [
    "Satın alma ve sipariş yardımcısı",
    "Stok riski ve toptancı cari limitine göre kural tabanlı öneriler.",
  ],
  "/cari": [
    "Cari ve alacak defteri",
    "Borçlu satış ve sonraki tahsilatı, satış gelirinden ayrı izleyin.",
  ],
  "/finans": [
    "Finansal görünüm",
    "Beyan, tahsilat ve yaklaşan ödeme yükü birbirinden ayrı.",
  ],
  "/kurulum": [
    "Firma ve istasyon kurulumu",
    "İşletme yapısı, personel davetleri ve yetki kapsamı.",
  ],
  "/entegrasyon": [
    "Entegrasyon merkezi",
    "Yetkili veri bağlantıları ve güvenli geçiş durumu.",
  ],
  "/asistan": [
    "Akıllı Asistan",
    "Yetkili, anonim sayısal kayıtlarınıza dayalı salt okunur açıklama.",
  ],
  "/denetim": ["İşlem geçmişi", "Gerçek kullanıcı, işlem zamanı ve kayıt izi."],
  "/profil": ["Profilim", "Hesap bilgileriniz ve şifre güvenliğiniz."],
  "/personel": [
    "Personel yönetimi",
    "Kullanıcılar, roller ve istasyon erişimleri.",
  ],
};
function Logo({ inverse = false }: { inverse?: boolean }) {
  return (
    <div className={`wordmark ${inverse ? "inverse" : ""}`}>
      <span className="logo-mark">
        <i />
        <i />
        <b />
      </span>
      <div>
        istasyon<span>os</span>
        <small>OPERASYON PLATFORMU</small>
      </div>
    </div>
  );
}
function dateTimeLocal() {
  return turkeyDateTimeInput();
}
function isoTr(s: string) {
  return turkeyInputToIso(s);
}
function sum(values: (number | null)[]) {
  if (values.some(value => value === null)) return null;
  return values.reduce<number>((a, b) => a + (Number(b) || 0), 0);
}
function initials(name: string) {
  return name
    .split(" ")
    .slice(0, 2)
    .map(s => s[0])
    .join("")
    .toUpperCase();
}

export default function StationApp() {
  const auth = useAuth();
  const [location, navigate] = useLocation();
  const path = location.split("?")[0];
  const knownUnauthorized =
    (auth.error as { data?: { code?: string } } | null)?.data?.code ===
    "UNAUTHORIZED";
  const offlineAuthError = auth.error && !knownUnauthorized;
  const [state, setState] = useState<AppState | null>(null);
  const [networkOnline, setNetworkOnline] = useState(() => navigator.onLine);
  const [offlineContext, setOfflineContext] = useState<{
    state: AppState;
    savedAt: string;
  } | null>(null);
  const [offlineStorageWarning, setOfflineStorageWarning] = useState("");
  const [syncVersion, setSyncVersion] = useState(0);
  const [loadError, setLoadError] = useState("");
  const [stationId, setStationId] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [mobileMenu, setMobileMenu] = useState(false);
  const [modal, setModal] = useState<string | null>(null);
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(
    null
  );
  const [search, setSearch] = useState("");
  const [inviteCode, setInviteCode] = useState("");
  const [inviteEmail, setInviteEmail] = useState("");
  const [formError, setFormError] = useState("");
  const [pending, setPending] = useState<{
    path: string;
    payload: Record<string, unknown>;
    id: string;
  } | null>(null);
  const [installPrompt, setInstallPrompt] = useState<any>(null);
  const recoveryOwner =
    state?.tenant && state.user.id === auth.user?.id
      ? { userId: state.user.id, tenantId: state.tenant.id }
      : null;
  const recovery = useOperationRecovery(recoveryOwner);
  const writeBlocked = busy || !!pending || recovery.blocked;
  const stateRef = useRef<AppState | null>(null);
  const selectedRef = useRef(stationId);
  const refreshSequence = useRef(0);
  stateRef.current = state;
  selectedRef.current = stationId;

  useEffect(() => {
    const online = () => setNetworkOnline(true);
    const offline = () => setNetworkOnline(false);
    window.addEventListener("online", online);
    window.addEventListener("offline", offline);
    return () => {
      window.removeEventListener("online", online);
      window.removeEventListener("offline", offline);
    };
  }, []);

  const refresh = useCallback(async () => {
    const sequence = ++refreshSequence.current;
    const scope = selectedRef.current;
    try {
      const next = await loadState(scope || undefined);
      if (sequence !== refreshSequence.current || scope !== selectedRef.current)
        return;
      setState(next);
      if (next.member?.role === "FUEL_STAFF")
        void saveOfflineContext(next)
          .then(() => setOfflineStorageWarning(""))
          .catch(() =>
            setOfflineStorageWarning(
              "Önceden doğrulanmış çevrimdışı vardiya kapsamı saklanamadı; sayfa yeniden açılırsa internet gerekebilir."
            )
          );
      setLoadError("");
    } catch (e) {
      if (sequence === refreshSequence.current)
        setLoadError(e instanceof Error ? e.message : "Veriler yüklenemedi.");
    } finally {
      if (sequence === refreshSequence.current) setLoading(false);
    }
  }, []);
  useEffect(() => {
    if (
      auth.user ||
      auth.loading ||
      path !== "/mobil/pompaci" ||
      (networkOnline && !offlineAuthError)
    )
      return;
    let active = true;
    void loadOfflineContext()
      .then(context => {
        if (active) setOfflineContext(context);
      })
      .catch(() => {
        if (active) setOfflineContext(null);
      });
    return () => {
      active = false;
    };
  }, [
    auth.user?.id,
    auth.loading,
    auth.error,
    path,
    offlineAuthError,
    networkOnline,
  ]);
  useEffect(() => {
    setInviteCode("");
    setPending(null);
  }, [auth.user?.id]);
  const recoveredId = useRef("");
  useEffect(() => {
    const current = recovery.view;
    if (
      !current ||
      current.status.state !== "COMPLETED" ||
      recoveredId.current === current.record.requestId
    )
      return;
    recoveredId.current = current.record.requestId;
    const result = current.status.response?.result;
    if (
      current.record.operation === "/invite" &&
      typeof result?.code === "string"
    )
      setInviteCode(result.code);
    void refresh();
  }, [recovery.view, refresh]);
  useEffect(() => {
    if (!auth.user) {
      setState(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    void refresh();
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, 30000);
    return () => clearInterval(timer);
  }, [auth.user?.id, stationId, refresh]);
  useEffect(() => {
    setMobileMenu(false);
    setSearch("");
  }, [path]);
  useEffect(() => {
    if (loading || path !== "/" || !state?.member) return;
    const landingPath = roleLandingPath(state.member.role);
    if (landingPath) navigate(landingPath, { replace: true });
  }, [loading, navigate, path, state?.member?.role]);
  useEffect(() => {
    const handler = (e: Event) => {
      e.preventDefault();
      setInstallPrompt(e);
    };
    window.addEventListener("beforeinstallprompt", handler);
    return () => window.removeEventListener("beforeinstallprompt", handler);
  }, []);

  const run = async (
    route: string,
    payload: Record<string, unknown>,
    retry?: { id: string }
  ) => {
    if (isRecoverableOperation(route)) {
      if (!recoveryOwner || busy || pending || recovery.blocked) return false;
      setBusy(true);
      setFormError("");
      try {
        const response = await recovery.submit(
          route,
          payload,
          stateRef.current?.csrfToken
        );
        if (!response) return false;
        if (route === "/invite" && typeof response.result.code === "string") {
          setInviteCode(response.result.code);
          setInviteEmail(String(response.result.invitedEmail ?? ""));
        }
        toast.success(
          typeof response.result.message === "string"
            ? response.result.message
            : "Kayıt başarıyla işlendi."
        );
        await recovery.acknowledge();
        await refresh();
        return true;
      } catch (failure) {
        const message =
          failure instanceof Error
            ? failure.message
            : "Kalıcı işlem takibi doğrulanamadı.";
        setFormError(message);
        toast.error(message);
        return false;
      } finally {
        setBusy(false);
      }
    }
    if (busy || (pending && !retry)) return false;
    const id = retry?.id || crypto.randomUUID();
    setBusy(true);
    setFormError("");
    try {
      const response = await mutate(
        route,
        payload,
        id,
        stateRef.current?.csrfToken
      );
      setPending(null);
      if (route === "/invite")
        setInviteCode(response.result?.code || response.code || "");
      toast.success(response.result?.message || "Kayıt başarıyla işlendi.");
      await refresh();
      return true;
    } catch (e) {
      const error =
        e instanceof ApiError
          ? e
          : new ApiError(
              "UNKNOWN",
              e instanceof Error ? e.message : "İşlem tamamlanamadı."
            );
      if (!error.status || error.status >= 500)
        setPending({ path: route, payload, id });
      else {
        setPending(null);
        if (error.status === 409 || error.status === 412) await refresh();
      }
      setFormError(error.message);
      toast.error(error.message);
      return false;
    } finally {
      setBusy(false);
    }
  };
  const onAction = (route: string, payload: Record<string, unknown>) =>
    run(route, payload);
  const openModal = (name: string, account?: Account) => {
    setFormError("");
    if (name === "invite") {
      setInviteCode("");
      setInviteEmail("");
    }
    if (account) setSelectedAccountId(account.id);
    setModal(name);
  };
  const closeModal = () => {
    if (!busy) {
      setModal(null);
      setFormError("");
    }
  };
  const ownerOrManager =
    state?.member && ["OWNER", "MANAGER"].includes(state.member.role);
  const financial =
    state?.member && ["OWNER", "ACCOUNTANT"].includes(state.member.role);
  const staff =
    state?.member && ["FUEL_STAFF", "MARKET_STAFF"].includes(state.member.role);
  const account =
    state?.accounts.find(a => a.id === selectedAccountId) ||
    state?.accounts.find(
      a => a.userId === state.user.id && a.status === "OPEN"
    ) ||
    state?.accounts[0];
  const selectedStation = state?.stations.find(s => s.id === stationId);
  const scopeName = selectedStation?.name || "Tüm yetkili istasyonlar";

  function modalPayload(form: HTMLFormElement) {
    const f = formObject(form);
    const revision = account
      ? { accountId: account.id, expectedRevision: account.revision }
      : {};
    switch (modal) {
      case "company":
        return {
          route: "/company",
          payload: { name: f.name, taxNumber: f.taxNumber },
        };
      case "station":
        return {
          route: "/station",
          payload: {
            companyId: f.companyId,
            name: f.name,
            code: f.code,
            address: f.address,
          },
        };
      case "invite":
        return {
          route: "/invite",
          payload: {
            email: f.email,
            role: f.role,
            stationIds: [f.stationId],
          },
        };
      case "shift":
        return {
          route: "/shift",
          payload: {
            stationId: f.stationId,
            label: f.label,
            startsAt: isoTr(f.startsAt),
            endsAt: isoTr(f.endsAt),
          },
        };
      case "account":
        return {
          route: "/account/open",
          payload: {
            stationId: f.stationId,
            shiftId: f.shiftId,
            businessUnit: f.businessUnit,
            openingFloatMinor: parseMoney(f.amount),
          },
        };
      case "payment":
        return {
          route: "/payment",
          payload: {
            ...revision,
            kind: f.kind,
            amountMinor: parseMoney(f.amount),
            ...(f.debtorId ? { debtorId: f.debtorId } : {}),
            reference: f.reference,
          },
        };
      case "slip":
        return {
          route: "/slip",
          payload: {
            ...revision,
            amountMinor: parseMoney(f.amount),
            reference: f.reference,
            terminalId: f.terminalId,
            transactionAt: isoTr(f.transactionAt),
            note: f.note,
          },
        };
      case "source":
        return {
          route: "/account/source",
          payload: {
            ...revision,
            sourceSalesMinor: parseMoney(f.amount),
            sourceRef: f.reference,
          },
        };
      case "submit":
        return {
          route: "/account/submit",
          payload: { ...revision, countedCashMinor: parseMoney(f.amount) },
        };
      case "receive":
        return {
          route: "/account/cash-receive",
          payload: {
            ...revision,
            receivedMinor: parseMoney(f.amount),
            note: f.note,
          },
        };
      case "approve":
        return {
          route: "/account/approve",
          payload: { ...revision, note: f.note },
        };
      case "return":
        return {
          route: "/account/return",
          payload: { ...revision, note: f.note },
        };
      default:
        throw new Error("İşlem seçilmedi.");
    }
  }
  async function submitModal(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    try {
      const { route, payload } = modalPayload(e.currentTarget);
      if (await onAction(route, payload)) closeModal();
    } catch (error) {
      setFormError(
        error instanceof Error ? error.message : "Alanları kontrol edin."
      );
    }
  }

  if (auth.loading)
    return (
      <div className="app-loading">
        <Logo />
        <div className="loading-line" />
        <p>Güvenli oturum kontrol ediliyor…</p>
      </div>
    );
  if (
    !auth.user &&
    path === "/mobil/pompaci" &&
    !knownUnauthorized &&
    (!networkOnline || offlineAuthError) &&
    offlineContext
  )
    return (
      <PompaciMobilePage
        state={offlineContext.state}
        busy={false}
        offlineOnly
        offlineContextSavedAt={offlineContext.savedAt}
        offlineStorageWarning=""
        onRefresh={() => Promise.resolve()}
        onSyncVersion={() => setSyncVersion(value => value + 1)}
        onAction={onAction}
      />
    );
  if (!auth.user)
    return (
      <LoginScreen
        onLogin={() => {
          try {
            startLogin();
          } catch (e) {
            toast.error(e instanceof Error ? e.message : "Giriş açılamadı.");
          }
        }}
      />
    );

  if (state?.member && !roleCanAccessPath(state.member.role, path))
    return (
      <main className="workspace-main" role="alert">
        <Notice warning>Bu ekran görev rolünüz için kullanılamaz.</Notice>
        <button
          className="btn secondary"
          onClick={() => {
            const landing = roleLandingPath(state.member!.role);
            navigate(landing || "/");
          }}
        >
          Görev ekranıma dön
        </button>
      </main>
    );

  const accounts = state?.accounts || [];
  const myAccounts = accounts.filter(a => a.userId === state?.user.id);
  const pendingAccounts = accounts.filter(a =>
    ["SUBMITTED", "IN_REVIEW", "NEEDS_INFO"].includes(a.status)
  );
  const displayedAccounts = (staff ? myAccounts : accounts).filter(
    a =>
      !search ||
      `${a.userName} ${a.id}`
        .toLocaleLowerCase("tr")
        .includes(search.toLocaleLowerCase("tr"))
  );
  const currentTitle = pageInfo[path] || pageInfo["/"];
  const newAccountButton = (
    <button
      className="btn primary"
      onClick={() => openModal("account")}
      disabled={busy || !state?.shifts.length}
    >
      <Plus size={16} />
      Hesabımı aç
    </button>
  );
  return (
    <div className="app-shell">
      {mobileMenu && (
        <div className="mobile-scrim" onClick={() => setMobileMenu(false)} />
      )}
      <aside className={`sidebar ${mobileMenu ? "mobile-open" : ""}`}>
        <div className="sidebar-brand">
          <Logo inverse />
          <button
            className="mobile-close icon-button"
            aria-label="Menüyü kapat"
            onClick={() => setMobileMenu(false)}
          >
            <X size={20} />
          </button>
        </div>
        <div className="workspace-label">
          <span className="workspace-dot" />
          {state?.tenant?.name || "Firma kurulumu"}
          <ChevronDown size={13} />
        </div>
        <nav aria-label="Ana menü">
          {navItems
            .filter(n => n.path !== "/personel" || !!ownerOrManager)
            .filter(
              n =>
                !staff ||
                roleCanAccessPath(state!.member!.role, n.path)
            )
            .map(item => (
              <div key={item.path}>
                {item.group && <div className="nav-group">{item.group}</div>}
                <button
                  className={`nav-item ${path === item.path ? "active" : ""}`}
                  onClick={() => navigate(item.path)}
                >
                  <item.icon size={18} />
                  <span>{item.label}</span>
                  {item.path === "/muhasebe" && pendingAccounts.length > 0 && (
                    <b className="nav-count">{pendingAccounts.length}</b>
                  )}
                </button>
              </div>
            ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="pilot-tag">
            <ShieldCheck size={17} />
            <div>
              Kontrollü pilot<small>Gerçek giriş · kalıcı kayıt</small>
            </div>
          </div>
          <button
            className="nav-item"
            onClick={() => {
              if (installPrompt) {
                void installPrompt.prompt();
              } else
                toast.info(
                  "Android Chrome: menü → Ana ekrana ekle. iPhone Safari: Paylaş → Ana Ekrana Ekle. İnternet bağlantısı mali işlemler için gereklidir."
                );
            }}
          >
            <Smartphone size={17} />
            <span>Telefonuma kur</span>
            <Download size={14} />
          </button>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div className="topbar-left">
            <button
              className="icon-button mobile-toggle"
              aria-label="Menüyü aç"
              onClick={() => setMobileMenu(true)}
            >
              <Menu size={21} />
            </button>
            <span className="topbar-breadcrumb">
              Çalışma alanı <span>/</span>{" "}
              <b>
                {navItems.find(n => n.path === path)?.label || "Genel bakış"}
              </b>
            </span>
          </div>
          <div className="topbar-right">
            <span className="secure-label">
              <i />
              Güvenli oturum
            </span>
            <button
              className="icon-button"
              aria-label="Verileri yenile"
              onClick={() => void refresh()}
              disabled={busy}
            >
              <RefreshCw size={17} />
            </button>
            <div className="user-profile">
              <span className="avatar">
                {initials(auth.user.name || "Kullanıcı")}
              </span>
              <div>
                <b>{auth.user.name || "Kullanıcı"}</b>
                <small>
                  {state?.member
                    ? roleLabels[state.member.role]
                    : "Üyelik bekliyor"}
                </small>
              </div>
            </div>
            <button
              className="icon-button"
              aria-label="Profilim"
              onClick={() => navigate("/profil")}
            >
              <LockKeyhole size={16} />
            </button>
            <button
              className="icon-button"
              aria-label="Oturumu kapat"
              onClick={() => void auth.logout()}
            >
              <LogOut size={16} />
            </button>
          </div>
        </header>
        <main className="workspace-main">
          <div className="page-head">
            <div>
              <div className="eyebrow">
                İSTASYONOS /{" "}
                {state?.tenant?.isDemo ? "ÖRNEK ÇALIŞMA ALANI" : "OPERASYON"}
              </div>
              <h1>{currentTitle[0]}</h1>
              <p>{currentTitle[1]}</p>
            </div>
            <div className="page-controls">
              <label className="station-select">
                <Fuel size={15} />
                <select
                  aria-label="İstasyon filtresi"
                  value={stationId}
                  onChange={e => setStationId(e.target.value)}
                >
                  <option value="">Tüm istasyonlar</option>
                  {(state?.stations || []).map(s => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </label>
              <span className="today-label">
                {new Intl.DateTimeFormat("tr-TR", {
                  timeZone: "Europe/Istanbul",
                  day: "numeric",
                  month: "long",
                  year: "numeric",
                }).format(new Date())}
              </span>
            </div>
          </div>
          {state?.tenant?.isDemo && (
            <Notice warning>
              Bu çalışma alanı açıkça oluşturulmuş örnek veriler içerir. Gerçek
              istasyon/banka bakiyesi veya canlı sağlayıcı bağlantısı değildir.
            </Notice>
          )}
          {pending && (
            <Notice warning>
              <strong>İşlem sonucu belirsiz.</strong> Yeni kayıtlar güvenli
              biçimde durduruldu. Aynı olay kimliğiyle{" "}
              <button
                className="inline-link"
                disabled={busy}
                onClick={() =>
                  void run(pending.path, pending.payload, { id: pending.id })
                }
              >
                sonucu tekrar al
              </button>
              . Sayfayı kapatmadan sonuç alın.
            </Notice>
          )}
          <OperationRecoveryNotice
            view={recovery.view}
            error={recovery.error}
            onCheck={() => void recovery.check()}
            onAcknowledge={() => {
              void recovery
                .acknowledge()
                .then(() => refresh())
                .catch(error =>
                  toast.error(
                    error instanceof Error
                      ? error.message
                      : "İşlem sonucu doğrulanamadı."
                  )
                );
            }}
          />
          {loadError && (
            <Notice warning>
              {loadError}{" "}
              <button className="inline-link" onClick={() => void refresh()}>
                Tekrar yükle
              </button>
            </Notice>
          )}
          {loading && !state ? (
            <div className="panel skeleton">
              <div />
              <div />
              <div />
            </div>
          ) : !state ? (
            <Empty
              title="Çalışma alanı yüklenemedi"
              text="Oturum ve veritabanı bağlantısını kontrol ederek yeniden deneyin."
              action={
                <button
                  className="btn secondary"
                  onClick={() => void refresh()}
                >
                  Yeniden dene
                </button>
              }
            />
          ) : path === "/profil" ? (
            <ProfilePanel
              name={auth.user.name || "Kullanıcı"}
              email={auth.user.email}
            />
          ) : !state.member ? (
            <SetupScreen
              state={state}
              busy={writeBlocked}
              onAction={onAction}
            />
          ) : (
            <>
              {path === "/" && (
                <>
                  {state.tenant?.isDemo &&
                    ["OWNER", "MANAGER", "ACCOUNTANT"].includes(
                      state.member.role
                    ) && (
                      <HistoricalDashboard
                        state={state}
                        stationId={stationId}
                      />
                    )}
                  {["OWNER", "MANAGER", "ACCOUNTANT"].includes(
                    state.member.role
                  ) && (
                    <SmartAssistantPanel state={state} stationId={stationId} />
                  )}
                  <div className="overview-intro">
                    <div>
                      <span className="live-dot" />
                      <b>{scopeName}</b>
                      <span>
                        {state.stations.length} istasyon erişimi ·{" "}
                        {roleLabels[state.member.role]}
                      </span>
                    </div>
                    <small>30 saniyede yenilenir</small>
                  </div>
                  <div className="metric-grid">
                    <Metric
                      label="Hesaplarda satış beyanı"
                      value={money(
                        sum(accounts.map(a => accountDeclaredTotalMinor(a)))
                      )}
                      detail="Açık ve teslimli hesaplar · banka bakiyesi değil"
                      icon={<Banknote size={18} />}
                    />
                    <Metric
                      label="Teyitli kart slipleri"
                      value={money(sum(accounts.map(a => a.cardTotalMinor)))}
                      detail={`${state.slips.filter(s => s.status === "VERIFIED").length} kayıt · manuel teyitli`}
                      icon={<CreditCard size={18} />}
                    />
                    <Metric
                      label="Açık cari alacak"
                      value={money(sum(state.debtors.map(d => d.balanceMinor)))}
                      detail={`${state.debtors.length} kişi / kurum kaydı`}
                      icon={<Users size={18} />}
                    />
                    <Metric
                      label="Muhasebe kuyruğu"
                      value={pendingAccounts.length}
                      detail="Kendi dosyanızı mali onaylayamazsınız"
                      icon={<FileCheck2 size={18} />}
                      tone="accent"
                    />
                  </div>
                  <div className="two-columns overview-columns">
                    <Panel
                      title="Vardiya operasyonu"
                      subtitle="Personel hesapları ve son durumları"
                      action={
                        <button
                          className="inline-link"
                          onClick={() => navigate("/vardiyalar")}
                        >
                          Tüm hesaplar <ArrowRight size={14} />
                        </button>
                      }
                    >
                      {accounts.length ? (
                        <div className="table-wrap">
                          <table>
                            <thead>
                              <tr>
                                <th>Personel / hesap</th>
                                <th>İş alanı</th>
                                <th className="numeric">Beyan toplamı</th>
                                <th>Durum</th>
                              </tr>
                            </thead>
                            <tbody>
                              {accounts.slice(0, 6).map(a => (
                                <tr
                                  key={a.id}
                                  className="clickable"
                                  onClick={() => {
                                    setSelectedAccountId(a.id);
                                    navigate("/vardiyalar");
                                  }}
                                >
                                  <td>
                                    <b>{a.userName}</b>
                                    <small>
                                      {
                                        state.stations.find(
                                          s => s.id === a.stationId
                                        )?.name
                                      }
                                    </small>
                                  </td>
                                  <td>
                                    {a.businessUnit === "FUEL"
                                      ? "Akaryakıt"
                                      : "Market"}
                                  </td>
                                  <td className="numeric">
                                    {money(accountDeclaredTotalMinor(a))}
                                  </td>
                                  <td>
                                    <Badge status={a.status} />
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      ) : (
                        <Empty
                          title="İlk vardiyanız için hazır"
                          text="Bir vardiya tanımlayıp personel hesabını açtığınızda operasyon burada görünür."
                          action={
                            <button
                              className="btn secondary"
                              onClick={() => navigate("/vardiyalar")}
                            >
                              Vardiyalara git <ArrowRight size={15} />
                            </button>
                          }
                        />
                      )}
                    </Panel>
                    <Panel
                      title="Kontrol merkezi"
                      subtitle="Bugün dikkat gerektiren operasyonlar"
                    >
                      <div className="control-list">
                        <button onClick={() => navigate("/muhasebe")}>
                          <span className="control-icon amber">
                            <FileCheck2 size={19} />
                          </span>
                          <div>
                            <b>
                              {pendingAccounts.length} hesap inceleme bekliyor
                            </b>
                            <small>
                              Kaynak tutarı ve fizikî teslim kontrolü
                            </small>
                          </div>
                          <ArrowUpRight size={17} />
                        </button>
                        <button onClick={() => navigate("/market")}>
                          <span className="control-icon green">
                            <Package size={19} />
                          </span>
                          <div>
                            <b>
                              {
                                state.products.filter(
                                  p => p.stockQty <= p.minimumQty
                                ).length
                              }{" "}
                              üründe stok eşiği
                            </b>
                            <small>Market ürünlerinde adet bazlı kontrol</small>
                          </div>
                          <ArrowUpRight size={17} />
                        </button>
                        <button onClick={() => navigate("/finans")}>
                          <span className="control-icon blue">
                            <Wallet size={19} />
                          </span>
                          <div>
                            <b>
                              {money(
                                sum(
                                  state.payables
                                    .filter(p => p.status !== "PAID")
                                    .map(p => p.amountMinor)
                                )
                              )}{" "}
                              ödeme yükü
                            </b>
                            <small>Kayıtlı açık toptancı ödemeleri</small>
                          </div>
                          <ArrowUpRight size={17} />
                        </button>
                        <button onClick={() => navigate("/entegrasyon")}>
                          <span className="control-icon gray">
                            <Link2 size={19} />
                          </span>
                          <div>
                            <b>Turpak ve OCR bağlantısı bekliyor</b>
                            <small>
                              Manuel kaynak ve slip teyidi kullanılabilir
                            </small>
                          </div>
                          <ArrowUpRight size={17} />
                        </button>
                      </div>
                    </Panel>
                  </div>
                  <Panel
                    title="İstasyon karşılaştırması"
                    subtitle="Sadece yetki kapsamınızdaki kayıtlar; hesap toplamları anlık banka bakiyesi değildir"
                  >
                    <div className="table-wrap">
                      <table>
                        <thead>
                          <tr>
                            <th>İstasyon</th>
                            <th>Firma</th>
                            <th className="numeric">Hesap adedi</th>
                            <th className="numeric">Satış beyanı</th>
                            <th className="numeric">Teyitli kart</th>
                            <th>Durum</th>
                          </tr>
                        </thead>
                        <tbody>
                          {state.stations.map(s => {
                            const aa = accounts.filter(
                              a => a.stationId === s.id
                            );
                            return (
                              <tr key={s.id}>
                                <td>
                                  <b>{s.name}</b>
                                  <small>{s.code}</small>
                                </td>
                                <td>
                                  {
                                    state.companies.find(
                                      c => c.id === s.companyId
                                    )?.name
                                  }
                                </td>
                                <td className="numeric">{aa.length}</td>
                                <td className="numeric">
                                  {money(
                                    sum(
                                      aa.map(a => accountDeclaredTotalMinor(a))
                                    )
                                  )}
                                </td>
                                <td className="numeric">
                                  {money(sum(aa.map(a => a.cardTotalMinor)))}
                                </td>
                                <td>
                                  <Badge
                                    status={
                                      aa.some(a => a.status === "OPEN")
                                        ? "OPEN"
                                        : "ACTIVE"
                                    }
                                  />
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </Panel>
                </>
              )}
              {path === "/vardiyalar" && (
                <>
                  <div className="section-toolbar">
                    <div className="search-box">
                      <Search size={16} />
                      <input
                        aria-label="Hesaplarda ara"
                        placeholder="Personel veya hesap ara…"
                        value={search}
                        onChange={e => setSearch(e.target.value)}
                      />
                    </div>
                    <div className="button-group">
                      {ownerOrManager && (
                        <button
                          className="btn secondary"
                          onClick={() => openModal("shift")}
                        >
                          <Plus size={16} />
                          Vardiya tanımla
                        </button>
                      )}
                      {newAccountButton}
                    </div>
                  </div>
                  <div className="two-columns account-columns">
                    <Panel
                      title="Personel hesapları"
                      subtitle={`${displayedAccounts.length} hesap · ${state.shifts.length} tanımlı vardiya`}
                    >
                      {displayedAccounts.length ? (
                        <div className="account-list">
                          {displayedAccounts.map(a => (
                            <button
                              key={a.id}
                              className={`account-card ${account?.id === a.id ? "selected" : ""}`}
                              onClick={() => setSelectedAccountId(a.id)}
                            >
                              <div className="account-card-top">
                                <span className="avatar small">
                                  {initials(a.userName)}
                                </span>
                                <div>
                                  <b>{a.userName}</b>
                                  <small>
                                    {
                                      state.shifts.find(s => s.id === a.shiftId)
                                        ?.label
                                    }{" "}
                                    ·{" "}
                                    {a.businessUnit === "FUEL"
                                      ? "Akaryakıt"
                                      : "Market"}
                                  </small>
                                </div>
                                <Badge status={a.status} />
                              </div>
                              <div className="account-card-bottom">
                                <span>Ödeme dağılımı</span>
                                <b>{money(accountDeclaredTotalMinor(a))}</b>
                              </div>
                            </button>
                          ))}
                        </div>
                      ) : (
                        <Empty
                          title="Henüz bir hesap yok"
                          text="Tanımlanmış vardiya üzerinden kendi hesabınızı açın. Başka personelin yerine işlem yapılamaz."
                        />
                      )}
                    </Panel>
                    <Panel
                      title={
                        account
                          ? `${account.userName} · hesap özeti`
                          : "Hesap detayı"
                      }
                      subtitle={
                        account
                          ? `Sürüm ${account.revision} · ${state.stations.find(s => s.id === account.stationId)?.name || ""}`
                          : "İncelemek için bir hesap seçin"
                      }
                    >
                      {account ? (
                        <AccountDetails
                          account={account}
                          state={state}
                          busy={writeBlocked}
                          onModal={name => openModal(name, account)}
                          onAction={onAction}
                          canSource={!!ownerOrManager}
                        />
                      ) : (
                        <Empty
                          title="Hesabınız burada görünecek"
                          text="Vardiya hesabını açtıktan sonra ödeme dağılımını, kaynak farkını ve teslim durumunu izleyin."
                        />
                      )}
                    </Panel>
                  </div>
                  <Panel
                    title="Tanımlı vardiyalar"
                    subtitle="Türkiye saati (UTC+03:00)"
                  >
                    <div className="table-wrap">
                      <table>
                        <thead>
                          <tr>
                            <th>Vardiya</th>
                            <th>İstasyon</th>
                            <th>Başlangıç</th>
                            <th>Bitiş</th>
                            <th>Durum</th>
                          </tr>
                        </thead>
                        <tbody>
                          {state.shifts.map(s => (
                            <tr key={s.id}>
                              <td>
                                <b>{s.label}</b>
                              </td>
                              <td>
                                {
                                  state.stations.find(
                                    st => st.id === s.stationId
                                  )?.name
                                }
                              </td>
                              <td>{fmtDate(s.startsAt)}</td>
                              <td>{fmtDate(s.endsAt)}</td>
                              <td>
                                <Badge status={s.status} />
                                {ownerOrManager && s.status === "OPEN" && (
                                  <button
                                    className="btn"
                                    disabled={
                                      writeBlocked ||
                                      !state.accounts.filter(
                                        a => a.shiftId === s.id
                                      ).length ||
                                      state.accounts.some(
                                        a =>
                                          a.shiftId === s.id &&
                                          (![
                                            "ACCEPTED",
                                            "ACCEPTED_WITH_PENDING",
                                          ].includes(a.status) ||
                                            a.signatureCount < 2)
                                      )
                                    }
                                    onClick={() =>
                                      void onAction("/shift/close", {
                                        stationId: s.stationId,
                                        shiftId: s.id,
                                        endsAt: new Date().toISOString(),
                                      })
                                    }
                                  >
                                    İki onaylı vardiyayı kapat
                                  </button>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      {!state.shifts.length && (
                        <Empty
                          title="Vardiya tanımlayın"
                          text="Yönetici başlangıç ve bitiş saatini belirleyerek personelin hesap açmasını sağlar."
                        />
                      )}
                    </div>
                  </Panel>
                </>
              )}
              {path === "/mobil/pompaci" &&
                state.member.role === "FUEL_STAFF" && (
                  <PompaciMobilePage
                    state={state}
                    busy={writeBlocked}
                    offlineContextSavedAt={null}
                    offlineStorageWarning={offlineStorageWarning}
                    onRefresh={refresh}
                    onSyncVersion={() => setSyncVersion(value => value + 1)}
                    onAction={onAction}
                  />
                )}
              {path === "/mobil/pompaci" &&
                state.member.role !== "FUEL_STAFF" && (
                  <Notice warning>
                    Bu ekran yalnız akaryakıt satış personeli içindir.
                  </Notice>
                )}
              {path === "/slipler" && (
                <>
                  <PosSlipPanel
                    state={state}
                    stationId={stationId}
                    busy={busy}
                    onAction={onAction}
                  />
                  <Notice>
                    OCR slipi taslak olarak okur. Personel doğrulaması olmadan
                    tahsilat kaydı oluşturulmaz; tam kart numarası, kart sahibi
                    adı veya CVV saklanmaz.
                  </Notice>
                  <div className="metric-grid three">
                    <Metric
                      label="Teyitli slip toplamı"
                      value={money(
                        sum(
                          state.slips
                            .filter(s => s.status === "VERIFIED")
                            .map(s => s.amountMinor)
                        )
                      )}
                      detail="Brüt kart işlem tutarı · banka neti değil"
                      icon={<CreditCard size={18} />}
                    />
                    <Metric
                      label="Slip adedi"
                      value={state.slips.length}
                      detail="Her işlem tek referansla"
                      icon={<FileCheck2 size={18} />}
                    />
                    <Metric
                      label="IBAN beyanı"
                      value={money(sum(accounts.map(a => a.ibanMinor)))}
                      detail="Banka doğrulaması bekliyor"
                      icon={<ArrowDownLeft size={18} />}
                    />
                  </div>
                  <Panel
                    title="Kart slipleri"
                    subtitle="Kaynak: kullanıcı teyidi · otomatik OCR değil"
                    action={
                      <button
                        className="btn primary"
                        onClick={() => {
                          const own = myAccounts.find(a => a.status === "OPEN");
                          if (own) openModal("slip", own);
                          else
                            toast.info(
                              "Önce açık bir kendi vardiya hesabınız olmalı."
                            );
                        }}
                        disabled={!myAccounts.some(a => a.status === "OPEN")}
                      >
                        <Plus size={16} />
                        Slip alanlarını kaydet
                      </button>
                    }
                  >
                    <div className="table-wrap">
                      <table>
                        <thead>
                          <tr>
                            <th>İşlem referansı</th>
                            <th>Terminal</th>
                            <th>Tarih / saat</th>
                            <th className="numeric">Tutar</th>
                            <th>Yöntem</th>
                            <th>Durum</th>
                          </tr>
                        </thead>
                        <tbody>
                          {state.slips.map(s => (
                            <tr key={s.id}>
                              <td>
                                <b>{s.reference}</b>
                              </td>
                              <td>{s.terminalId}</td>
                              <td>{fmtDate(s.transactionAt)}</td>
                              <td className="numeric">
                                {money(s.amountMinor)}
                              </td>
                              <td>Manuel teyit</td>
                              <td>
                                <Badge status={s.status} />
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      {!state.slips.length && (
                        <Empty
                          title="Slip kaydı bulunmuyor"
                          text="Her başarılı kart işlemini tutar, terminal, tarih ve referansıyla ayrı kaydedin."
                        />
                      )}
                    </div>
                  </Panel>
                  <Panel
                    title="Diğer ödeme kayıtları"
                    subtitle="Yeni satış ve eski cari tahsilatı ayrı türlerde tutulur"
                  >
                    <div className="table-wrap">
                      <table>
                        <thead>
                          <tr>
                            <th>Ödeme türü</th>
                            <th>Referans</th>
                            <th className="numeric">Tutar</th>
                            <th>Durum</th>
                          </tr>
                        </thead>
                        <tbody>
                          {state.payments.map(p => (
                            <tr key={p.id}>
                              <td>{paymentLabels[p.kind]}</td>
                              <td>{p.reference || "—"}</td>
                              <td className="numeric">
                                {money(p.amountMinor)}
                              </td>
                              <td>
                                <Badge status={p.status} />
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </Panel>
                </>
              )}
              {path === "/muhasebe" && (
                <>
                  <Notice>
                    İlk mali imza hesabı tek başına kapatmaz. İki farklı yetkili
                    kullanıcı ve kaynak/sayım kontrolü gerekir. IBAN beyanı,
                    banka bağlantısı olmadan tahsilat kabul edilmez.
                  </Notice>
                  <Panel
                    title="Teslim ve onay bekleyen hesaplar"
                    subtitle="Hesabı açan kullanıcı kendi hesabının nihai mali onayını veremez"
                  >
                    <div className="table-wrap">
                      <table>
                        <thead>
                          <tr>
                            <th>Personel</th>
                            <th className="numeric">Kaynak satış</th>
                            <th className="numeric">Ödeme dağılımı</th>
                            <th className="numeric">Fark</th>
                            <th>Nakit teslim</th>
                            <th>İmza</th>
                            <th>Durum</th>
                            <th />
                          </tr>
                        </thead>
                        <tbody>
                          {accounts
                            .filter(a => a.status !== "OPEN")
                            .map(a => (
                              <tr key={a.id}>
                                <td>
                                  <b>{a.userName}</b>
                                  <small>Sürüm {a.revision}</small>
                                </td>
                                <td className="numeric">
                                  {money(a.sourceSalesMinor)}
                                </td>
                                <td className="numeric">
                                  {money(accountDeclaredTotalMinor(a))}
                                </td>
                                <td
                                  className={`numeric ${a.differenceMinor ? "danger-text" : ""}`}
                                >
                                  {money(a.differenceMinor)}
                                </td>
                                <td>
                                  {a.cashReceiverUserId
                                    ? "Alıcı teyitli"
                                    : "Bekliyor"}
                                </td>
                                <td>{a.signatureCount} / 2</td>
                                <td>
                                  <Badge status={a.status} />
                                </td>
                                <td>
                                  <button
                                    className="btn small secondary"
                                    onClick={() => {
                                      setSelectedAccountId(a.id);
                                      navigate("/vardiyalar");
                                    }}
                                  >
                                    İncele <ArrowUpRight size={13} />
                                  </button>
                                </td>
                              </tr>
                            ))}
                        </tbody>
                      </table>
                      {!accounts.some(a => a.status !== "OPEN") && (
                        <Empty
                          title="Onay kuyruğu temiz"
                          text="Personel hesabını teslim ettiğinde muhasebe işlemleri burada sıralanır."
                        />
                      )}
                    </div>
                  </Panel>
                </>
              )}
              {["/market", "/satinalma", "/cari", "/finans"].includes(path) && (
                <BusinessModules
                  view={
                    path === "/market"
                      ? "market"
                      : path === "/satinalma"
                        ? "purchase"
                        : path === "/cari"
                          ? "receivables"
                          : "finance"
                  }
                  state={state}
                  stationId={stationId}
                  busy={writeBlocked}
                  onAction={onAction}
                />
              )}
              {path === "/sayaclar" && (
                <FuelPanel
                  state={state}
                  stationId={stationId}
                  busy={writeBlocked}
                  onAction={onAction}
                />
              )}
              {path === "/icmal" && (
                <IcmalPanel
                  state={state}
                  stationId={stationId}
                  busy={writeBlocked}
                  onAction={onAction}
                />
              )}
              {path === "/tanklar" && (
                <TankPanel
                  state={state}
                  stationId={stationId}
                  busy={writeBlocked}
                  onAction={onAction}
                />
              )}
              {path === "/tank-dogrulama" && (
                <TankValidationPanel
                  state={state}
                  stationId={stationId}
                  busy={writeBlocked}
                  onAction={onAction}
                />
              )}
              {path === "/gunluk-rapor" && (
                <Suspense
                  fallback={
                    <div role="status">Günlük rapor ekranı yükleniyor…</div>
                  }
                >
                  <DailyReportPanel
                    key={stationId}
                    state={state}
                    stationId={stationId}
                    busy={writeBlocked}
                    onAction={onAction}
                  />
                </Suspense>
              )}
              {path === "/tanker-belge" && (
                <TankerDocumentPanel
                  key={stationId}
                  state={state}
                  stationId={stationId}
                  busy={writeBlocked}
                  onAction={onAction}
                />
              )}
              {path === "/personel" &&
                (ownerOrManager ? (
                  <PersonnelPanel
                    state={state}
                    busy={writeBlocked}
                    inviteCode={inviteCode}
                    inviteEmail={inviteEmail}
                    onInvite={() => openModal("invite")}
                    onAction={onAction}
                  />
                ) : (
                  <Notice warning>
                    Personel listesi ve davetler için firma sahibi veya yönetici
                    yetkisi gerekir.
                  </Notice>
                ))}
              {path === "/kurulum" && (
                <>
                  <Panel
                    title="Firmalar"
                    subtitle="Hukuki firma ile istasyon operasyonu ayrı tanımlanır"
                    action={
                      ownerOrManager && (
                        <button
                          className="btn primary"
                          onClick={() => openModal("company")}
                        >
                          <Plus size={16} />
                          Firma ekle
                        </button>
                      )
                    }
                  >
                    <div className="table-wrap">
                      <table>
                        <thead>
                          <tr>
                            <th>Firma unvanı</th>
                            <th>Vergi numarası</th>
                            <th>İstasyon adedi</th>
                          </tr>
                        </thead>
                        <tbody>
                          {state.companies.map(c => (
                            <tr key={c.id}>
                              <td>
                                <b>{c.name}</b>
                              </td>
                              <td>{c.taxNumber || "Tanımlanmadı"}</td>
                              <td>
                                {
                                  state.stations.filter(
                                    s => s.companyId === c.id
                                  ).length
                                }
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </Panel>
                  <Panel
                    title="İstasyonlar"
                    subtitle="Şube, istasyon kodu ve bağlı firma"
                    action={
                      ownerOrManager && (
                        <button
                          className="btn secondary"
                          onClick={() => openModal("station")}
                        >
                          <Plus size={16} />
                          İstasyon ekle
                        </button>
                      )
                    }
                  >
                    <div className="station-cards">
                      {state.stations.map(s => (
                        <div className="station-card" key={s.id}>
                          <span className="station-icon">
                            <Fuel size={22} />
                          </span>
                          <div>
                            <h3>{s.name}</h3>
                            <p>
                              {
                                state.companies.find(c => c.id === s.companyId)
                                  ?.name
                              }
                            </p>
                            <small>
                              {s.code} ·{" "}
                              {s.address || "Adres henüz tanımlanmadı"}
                            </small>
                          </div>
                          <Badge status="ACTIVE" />
                        </div>
                      ))}
                    </div>
                  </Panel>
                  <Panel
                    title="Personel ve davetler"
                    subtitle="Kullanıcılar ve görünür istasyon yetkileri Personel ekranında listelenir."
                  >
                    <div className="setup-form">
                      <p>{state.members.length} görünür firma üyesi</p>
                      {ownerOrManager && (
                        <button
                          className="btn secondary"
                          onClick={() => navigate("/personel")}
                        >
                          Personel ekranını aç
                        </button>
                      )}
                    </div>
                  </Panel>
                </>
              )}
              {path === "/entegrasyon" && (
                <>
                  <Notice warning>
                    Canlı Turpak, YN ÖKC, banka ve haricî OCR bağlantısı etkin
                    değildir. Bu uygulama bunlara bağlanmış gibi veri üretmez.
                    Gerçek sağlayıcı erişimi, özel saklama/maskeleme altyapısı
                    ve hukuki kabul ayrı tamamlanmalıdır.
                  </Notice>
                  <div className="integration-list">
                    {[
                      [
                        "Turpak / pompa otomasyonu",
                        "Yetkili API veya rapor dışa aktarımı",
                        Fuel,
                        "Vardiya kaynak toplamı, yönetici tarafından rapor referansıyla manuel girilebilir.",
                      ],
                      [
                        "YN ÖKC / banka POS",
                        "Mali fiş ve kart işlem eşleştirmesi",
                        CreditCard,
                        "Manuel kart slipi kayıtları banka takas kaydı veya mali fiş üretmez.",
                      ],
                      [
                        "Güvenli slip OCR",
                        "Yerel maskeleme → gizlilik kapısı → OCR",
                        FileCheck2,
                        "Görüntü yükleme kapalı. Tam kart bilgisi ve ham görsel haricî servise gönderilmez.",
                      ],
                      [
                        "Banka ve likidite",
                        "Hesap bakiyesi, valör ve komisyon",
                        Wallet,
                        "Ödeme beyanı ile kullanılabilir banka bakiyesi ayrıdır; eksik bakiye sıfır sayılmaz.",
                      ],
                      [
                        "Resmî muhasebe / e-belge",
                        "Yetkili entegratör veya muhasebe bağlantısı",
                        Building2,
                        "Operasyonel kayıtlar resmî muhasebe ve e-fatura gönderimi yerine geçmez.",
                      ],
                    ].map(([title, sub, Icon, detail]) => {
                      const I = Icon as typeof Fuel;
                      return (
                        <div className="integration-card" key={String(title)}>
                          <span className="integration-icon">
                            <I size={24} />
                          </span>
                          <div>
                            <h3>{String(title)}</h3>
                            <p>{String(sub)}</p>
                            <small>{String(detail)}</small>
                          </div>
                          <Badge status="DISABLED" />
                        </div>
                      );
                    })}
                  </div>
                </>
              )}
              {path === "/asistan" && (
                <Suspense
                  fallback={
                    <Empty
                      title="Asistan hazırlanıyor"
                      text="Analiz ekranı yükleniyor."
                    />
                  }
                >
                  {["OWNER", "MANAGER", "ACCOUNTANT"].includes(
                    state.member.role
                  ) && (
                    <SmartAssistantPanel state={state} stationId={stationId} />
                  )}
                  <AssistantPanel
                    key={`${state.user.id}:${state.member?.role}:${state.member?.stationIds.join(",")}`}
                    state={state}
                  />
                </Suspense>
              )}
              {path === "/denetim" && (
                <Panel
                  title="Son işlem kayıtları"
                  subtitle="Sunucu tarafındaki gerçek kullanıcı ve olay geçmişi"
                >
                  <div className="table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>Zaman</th>
                          <th>İşlem yapan</th>
                          <th>İşlem</th>
                          <th>Kayıt referansı</th>
                        </tr>
                      </thead>
                      <tbody>
                        {state.audit.map(a => (
                          <tr key={a.id}>
                            <td>{fmtDate(a.createdAt)}</td>
                            <td>{a.actorName}</td>
                            <td>
                              <code>{a.action}</code>
                            </td>
                            <td>
                              <code className="short-ref">{a.entityId}</code>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {!state.audit.length && (
                      <Empty
                        title="Henüz işlem yok"
                        text="Yeni işlemler gerçek kullanıcı kimliğiyle kayıt altına alınır."
                      />
                    )}
                  </div>
                </Panel>
              )}
            </>
          )}
          <footer className="app-footer">
            <span>İstasyonOS · Operasyon uygulaması</span>
            <span>
              <LockKeyhole size={12} />
              Giriş doğrulanır. Sağlayıcı bağlantıları ayrıca onaylanır.
            </span>
          </footer>
        </main>
      </div>
      {modal && state?.member && (
        <Modal
          title={
            (
              {
                company: "Firma tanımı",
                station: "İstasyon tanımı",
                invite: "Personel daveti",
                shift: "Vardiya tanımı",
                account: "Vardiya hesabımı aç",
                payment: "Ödeme kaydı ekle",
                slip: "Kart slipini manuel teyit et",
                source: "Kaynak satış raporu",
                submit: "Muhasebeye hesap teslimi",
                receive: "Fizikî nakit teslimini teyit et",
                approve: "Mali onay imzası",
                return: "Personelden düzeltme iste",
              } as Record<string, string>
            )[modal]
          }
          subtitle={
            account &&
            !["company", "station", "invite", "shift", "account"].includes(
              modal
            )
              ? `${account.userName} · sürüm ${account.revision}`
              : "Alanları kontrol ederek kalıcı kaydı oluşturun."
          }
          close={closeModal}
        >
          <form onSubmit={submitModal} className="modal-form">
            {["company", "station"].includes(modal) && (
              <>
                <Field
                  label={modal === "company" ? "Firma unvanı" : "İstasyon adı"}
                >
                  <input name="name" required minLength={2} maxLength={150} />
                </Field>
                {modal === "company" ? (
                  <Field label="Vergi numarası (isteğe bağlı)">
                    <input
                      name="taxNumber"
                      inputMode="numeric"
                      maxLength={11}
                    />
                  </Field>
                ) : (
                  <>
                    <Field label="Bağlı firma">
                      <select name="companyId" required>
                        {state.companies.map(c => (
                          <option value={c.id} key={c.id}>
                            {c.name}
                          </option>
                        ))}
                      </select>
                    </Field>
                    <Field label="İstasyon kodu">
                      <input name="code" required maxLength={30} />
                    </Field>
                    <Field label="Adres">
                      <textarea name="address" rows={2} maxLength={500} />
                    </Field>
                  </>
                )}
              </>
            )}
            {modal === "invite" && (
              <>
                <Field label="Davet edilecek e-posta / giriş hesabı">
                  <input
                    name="email"
                    type="email"
                    autoComplete="email"
                    required
                    maxLength={254}
                  />
                </Field>
                <Field label="Kullanıcı rolü">
                  <select name="role">
                    {(
                      [
                        "MANAGER",
                        "ACCOUNTANT",
                        "FUEL_STAFF",
                        "MARKET_STAFF",
                        "PURCHASER",
                      ] as AppRole[]
                    )
                      .filter(
                        r =>
                          state.member?.role === "OWNER" ||
                          !["MANAGER", "ACCOUNTANT"].includes(r)
                      )
                      .map(r => (
                        <option value={r} key={r}>
                          {roleLabels[r]}
                        </option>
                      ))}
                  </select>
                </Field>
                <Field label="İstasyon kapsamı">
                  <select
                    name="stationId"
                    required
                    defaultValue={
                      state.stations.some(s => s.id === stationId)
                        ? stationId
                        : ""
                    }
                  >
                    <option value="">İstasyon seçin</option>
                    {state.stations.map(s => (
                      <option value={s.id} key={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </Field>
                <Notice>
                  Davet kodu yalnız yukarıdaki e-posta hesabıyla ve seçilen
                  istasyonda kullanılır. Sistem e-posta göndermez; kodu davet
                  ettiğiniz kişiyle güvenli paylaşın. Kişi kendi adını ve
                  parolasını belirleyerek daveti kabul eder.
                </Notice>
              </>
            )}
            {["shift", "account"].includes(modal) && (
              <Field label="İstasyon">
                <select
                  name="stationId"
                  required
                  defaultValue={stationId || state.stations[0]?.id}
                >
                  {state.stations.map(s => (
                    <option value={s.id} key={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </Field>
            )}
            {modal === "shift" && (
              <>
                <Field label="Vardiya adı">
                  <input
                    name="label"
                    placeholder="Sabah vardiyası"
                    required
                    maxLength={100}
                  />
                </Field>
                <div className="form-row">
                  <Field label="Başlangıç · Türkiye saati">
                    <input
                      name="startsAt"
                      type="datetime-local"
                      defaultValue={dateTimeLocal()}
                      required
                    />
                  </Field>
                  <Field label="Bitiş · Türkiye saati">
                    <input name="endsAt" type="datetime-local" required />
                  </Field>
                </div>
              </>
            )}
            {modal === "account" && (
              <>
                <Field label="Çalışılacak vardiya">
                  <select name="shiftId" required>
                    {state.shifts.map(s => (
                      <option value={s.id} key={s.id}>
                        {s.label} ·{" "}
                        {state.stations.find(st => st.id === s.stationId)?.name}{" "}
                        · {fmtDate(s.startsAt)}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="İş alanı">
                  <select
                    name="businessUnit"
                    defaultValue={
                      state.member.role === "MARKET_STAFF" ? "MARKET" : "FUEL"
                    }
                    disabled={
                      state.member.role === "FUEL_STAFF" ||
                      state.member.role === "MARKET_STAFF"
                    }
                  >
                    <option value="FUEL">Akaryakıt</option>
                    <option value="MARKET">Market</option>
                  </select>
                </Field>
                <Field label="Açılış para üstü / float">
                  <MoneyInput name="amount" defaultValue="0,00" />
                </Field>
                <Notice>
                  Hesap kendi gerçek kullanıcı kimliğinizle açılır. Açılış para
                  üstü satış gelirine eklenmez.
                </Notice>
              </>
            )}
            {modal === "payment" && (
              <>
                <Field label="Kayıt türü">
                  <select name="kind">
                    <option value="CASH">Nakit satış</option>
                    <option value="IBAN">
                      IBAN satış beyanı · banka bekliyor
                    </option>
                    {state.member &&
                      ["OWNER", "ACCOUNTANT"].includes(state.member.role) && (
                        <option value="AR_COLLECTION">
                          Eski cari nakit tahsilatı · ciro dışı
                        </option>
                      )}
                    <option value="DEBT">Borçlu satış</option>
                  </select>
                </Field>
                <Field label="Tutar">
                  <MoneyInput name="amount" />
                </Field>
                <Field label="Kişi / kurum (borç veya tahsilatta zorunlu)">
                  <select name="debtorId">
                    <option value="">Seçiniz</option>
                    {state.debtors.map(d => (
                      <option value={d.id} key={d.id}>
                        {d.name} · {money(d.balanceMinor)}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Referans / açıklama">
                  <input
                    name="reference"
                    maxLength={150}
                    placeholder="İşlem veya ödeme referansı"
                  />
                </Field>
              </>
            )}
            {modal === "slip" && (
              <>
                <Notice>
                  Yalnız başarılı satış slipinin gerekli alanlarını girin.
                  Fotoğraf upload / OCR yapılmaz. Tam PAN/CVV veya kart sahibi
                  adı girmeyin.
                </Notice>
                <Field label="Brüt kart tutarı">
                  <MoneyInput name="amount" />
                </Field>
                <div className="form-row">
                  <Field label="İşlem referansı / RRN">
                    <input name="reference" required maxLength={80} />
                  </Field>
                  <Field label="Terminal ID">
                    <input name="terminalId" required maxLength={80} />
                  </Field>
                </div>
                <Field label="İşlem zamanı · Türkiye saati">
                  <input
                    type="datetime-local"
                    name="transactionAt"
                    required
                    defaultValue={dateTimeLocal()}
                  />
                </Field>
                <Field label="Teyit notu">
                  <textarea
                    name="note"
                    minLength={10}
                    maxLength={500}
                    rows={2}
                    required
                    placeholder="Slip alanlarını belge üzerinden kontrol ettim."
                  />
                </Field>
              </>
            )}
            {modal === "source" && (
              <>
                <Notice>
                  Bu toplam canlı Turpak API'sinden çekilmez. Yalnız bu personel
                  hesabına ait kaynak kapsamını teyit ederek girin; istasyon
                  toplamını personele atfetmeyin.
                </Notice>
                <Field label="Kaynak net satış tutarı">
                  <MoneyInput
                    name="amount"
                    defaultValue={amountInput(account?.sourceSalesMinor)}
                  />
                </Field>
                <Field label="Rapor ve dönem referansı">
                  <input
                    name="reference"
                    required
                    minLength={3}
                    maxLength={150}
                    defaultValue={account?.sourceRef || ""}
                  />
                </Field>
              </>
            )}
            {modal === "submit" && (
              <>
                <Notice>
                  Kaynak toplamı ile nakit + kart + IBAN + yeni borç eşleşmeli.
                  Eski cari tahsilatı yalnız fizikî nakit hesabına eklenir.
                </Notice>
                <Field label="Saydığım toplam fizikî nakit (float dâhil)">
                  <MoneyInput name="amount" />
                </Field>
                <div className="summary-row">
                  <span>Beklenen fizikî sayım</span>
                  <b>
                    {money(
                      (account?.expectedCashMinor || 0) +
                        (account?.openingFloatMinor || 0)
                    )}
                  </b>
                </div>
                <div className="summary-row">
                  <span>Teslim edilecek nakit (float hariç)</span>
                  <b>{money(account?.expectedCashMinor)}</b>
                </div>
              </>
            )}
            {modal === "receive" && (
              <>
                <Field label="Fizikî alıcı olarak saydığım teslim nakdi">
                  <MoneyInput name="amount" />
                </Field>
                <Field label="Alıcı kontrol notu">
                  <textarea
                    name="note"
                    rows={2}
                    required
                    minLength={10}
                    maxLength={500}
                  />
                </Field>
              </>
            )}
            {["approve", "return"].includes(modal) && (
              <>
                <Notice warning={modal === "return"}>
                  {modal === "approve"
                    ? "Kendi hesabınızı onaylayamazsınız. İki farklı kullanıcı imzası tamamlanmadan mali onay kesinleşmez."
                    : "Gerekçeli düzeltme talebi hesabı yeniden açar. Eski imzalar geçmişte korunur, yeni sürüme taşınmaz."}
                </Notice>
                <Field
                  label={
                    modal === "approve"
                      ? "Kontrol ve mali onay notu"
                      : "Düzeltme gerekçesi"
                  }
                >
                  <textarea
                    name="note"
                    required
                    minLength={10}
                    rows={3}
                    maxLength={500}
                  />
                </Field>
              </>
            )}
            {formError && (
              <div className="form-error" role="alert">
                {formError}
              </div>
            )}
            <div className="modal-actions">
              <button
                className="btn secondary"
                type="button"
                onClick={closeModal}
                disabled={busy}
              >
                Vazgeç
              </button>
              <SubmitButton busy={writeBlocked}>
                {modal === "approve"
                  ? "İmzayı kaydet"
                  : modal === "submit"
                    ? "Muhasebeye teslim et"
                    : "Kaydı oluştur"}
              </SubmitButton>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}

function MarketFirstDeclaration({ accountId }: { accountId: string }) {
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");
    void fetch(
      `/api/stationos/account/declaration-snapshot?accountId=${encodeURIComponent(accountId)}`,
      {
        credentials: "same-origin",
        cache: "no-store",
        signal: controller.signal,
      }
    )
      .then(async response => {
        const payload = await response.json();
        if (!response.ok || !payload?.ok)
          throw new Error("SNAPSHOT_READ_FAILED");
        return payload.result;
      })
      .then(value => {
        if (!controller.signal.aborted) setResult(value);
      })
      .catch(() => {
        if (!controller.signal.aborted)
          setError("İlk beyan kaynağı okunamadı; inceleme gerekli.");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [accountId]);

  const snapshot = result?.snapshot;
  const rows = Array.isArray(snapshot?.paymentRows)
    ? snapshot.paymentRows.filter(
        (row: any) =>
          row &&
          typeof row === "object" &&
          Number.isSafeInteger(row.amountMinor) &&
          row.amountMinor >= 0
      )
    : [];
  const sumKind = (kind: string) =>
    rows
      .filter((row: any) => row.category === kind)
      .reduce((total: number, row: any) => total + row.amountMinor, 0);
  const slips = Array.isArray(snapshot?.slipRows)
    ? snapshot.slipRows.filter(
        (row: any) =>
          row &&
          row.recordStatus === "VERIFIED" &&
          Number.isSafeInteger(row.amountMinor) &&
          row.amountMinor >= 0
      )
    : [];
  const slipTotal = slips.reduce(
    (total: number, row: any) => total + row.amountMinor,
    0
  );

  return (
    <div className="summary-list" aria-live="polite">
      <div className="summary-row separated">
        <span>İlk market beyanı</span>
        <b>
          {loading
            ? "Yükleniyor"
            : error
              ? "İnceleme gerekli"
              : result?.state === "FIRST_DECLARATION_UNKNOWN"
                ? "FIRST_DECLARATION_UNKNOWN"
                : snapshot?.businessUnit === "MARKET" &&
                    snapshot?.accountId === accountId
                  ? "Değiştirilemez kaynak"
                  : "İnceleme gerekli"}
        </b>
      </div>
      {error && <p role="alert">{error}</p>}
      {!loading && !error && result?.state === "FIRST_DECLARATION_UNKNOWN" && (
        <p>
          Eski hesap için ilk beyan yok; güncel değerlerden geriye dönük
          oluşturulmadı.
        </p>
      )}
      {!loading &&
        !error &&
        snapshot?.businessUnit === "MARKET" &&
        snapshot?.accountId === accountId && (
          <>
            <div className="summary-row">
              <span>İlk kaynak satış toplamı</span>
              <b>{money(snapshot.declaredTotals?.sourceSalesMinor ?? null)}</b>
            </div>
            <div className="summary-row">
              <span>İlk sayılan nakit</span>
              <b>{money(snapshot.declaredTotals?.countedCashMinor ?? null)}</b>
            </div>
            <div className="summary-row">
              <span>Nakit beyanı</span>
              <b>{money(sumKind("CASH"))}</b>
            </div>
            <div className="summary-row">
              <span>POS slip beyanı · banka teyidi bekliyor</span>
              <b>
                {Array.isArray(snapshot?.slipRows)
                  ? money(slipTotal)
                  : "Kaynak yok"}
              </b>
            </div>
            <div className="summary-row">
              <span>Havale / IBAN · teyit bekliyor</span>
              <b>{money(sumKind("IBAN"))}</b>
            </div>
            <div className="summary-row">
              <span>Cari / borç</span>
              <b>{money(sumKind("DEBT_SALE"))}</b>
            </div>
            <p>
              Bu snapshot ilk personel beyanıdır; banka teyidi veya nihai
              muhasebe onayı değildir.
            </p>
          </>
        )}
    </div>
  );
}

function AccountDetails({
  account: a,
  state,
  busy,
  onModal,
  onAction,
  canSource,
}: {
  account: Account;
  state: AppState;
  busy: boolean;
  onModal: (name: string) => void;
  onAction: (
    route: string,
    payload: Record<string, unknown>
  ) => Promise<boolean>;
  canSource: boolean;
}) {
  const own = a.userId === state.user.id;
  const financial = ["OWNER", "ACCOUNTANT"].includes(state.member!.role);
  const receiver = ["OWNER", "MANAGER", "ACCOUNTANT"].includes(
    state.member!.role
  );
  const editable = own && a.status === "OPEN";
  const total = accountDeclaredTotalMinor(a);
  const marketSourceDifferenceMinor =
    a.businessUnit === "MARKET" && a.sourceSalesMinor !== null
      ? a.sourceSalesMinor - total
      : null;
  const closed = ["ACCEPTED", "ACCEPTED_WITH_PENDING"].includes(a.status);
  const { deviceId, kind: deviceKind } = getDeviceIdentity();
  return (
    <div className="account-detail">
      <div className="account-status-row">
        <Badge status={a.status} />
        <span>
          {own ? "Kendi hesabınız" : "Yetkili inceleme"} ·{" "}
          {a.businessUnit === "FUEL" ? "Akaryakıt" : "Market"}
        </span>
      </div>
      <div className="account-total">
        <small>YENİ SATIŞ ÖDEME DAĞILIMI</small>
        <strong>{money(total)}</strong>
      </div>
      <div className="summary-list">
        <div className="summary-row">
          <span>
            <Banknote size={15} />
            Nakit satış
          </span>
          <b>{money(a.cashSalesMinor)}</b>
        </div>
        <div className="summary-row">
          <span>
            <CreditCard size={15} />
            Kayda alınan POS slipleri · banka teyidi ayrı
          </span>
          <b>{money(a.cardTotalMinor)}</b>
        </div>
        {!!a.fastMinor && (
          <div className="summary-row">
            <span>FAST beyanı · banka teyidi bekliyor</span>
            <b>{money(a.fastMinor)}</b>
          </div>
        )}
        <div className="summary-row">
          <span>
            <ArrowDownLeft size={15} />
            IBAN beyanı
          </span>
          <b>
            {money(a.ibanMinor)}{" "}
            <small className="pending-text">bekliyor</small>
          </b>
        </div>
        <div className="summary-row">
          <span>
            <Users size={15} />
            Yeni borçlu satış
          </span>
          <b>{money(a.debtMinor)}</b>
        </div>
        {!!a.specialCoveredMinor && (
          <div className="summary-row">
            <span>Özel işlem karşılığı · operasyonel</span>
            <b>{money(a.specialCoveredMinor)}</b>
          </div>
        )}
        {!!a.prepaymentCashMinor && (
          <div className="summary-row">
            <span>Gift nakit yüklemesi · satış dışı</span>
            <b>{money(a.prepaymentCashMinor)}</b>
          </div>
        )}
        <div className="summary-row separated">
          <span>Eski cari nakit tahsilatı · ciro dışı</span>
          <b>{money(a.arCollectionMinor)}</b>
        </div>
        <div className="summary-row">
          <span>Açılış para üstü · ciro dışı</span>
          <b>{money(a.openingFloatMinor)}</b>
        </div>
        <div className="summary-row separated">
          <span>Kaynak satış raporu · manuel</span>
          <b>{money(a.sourceSalesMinor)}</b>
        </div>
        {a.businessUnit === "MARKET" && (
          <div
            className={`summary-row ${marketSourceDifferenceMinor ? "danger-text" : ""}`}
          >
            <span>Market kaynak / beyan fark? ? ?n inceleme</span>
            <b>{money(marketSourceDifferenceMinor)}</b>
          </div>
        )}
        <div
          className={`summary-row ${a.differenceMinor ? "danger-text" : ""}`}
        >
          <span>Kaynak / ödeme farkı</span>
          <b>{money(a.differenceMinor)}</b>
        </div>
        <div className="summary-row">
          <span>Teslim edilecek nakit · float hariç</span>
          <b>{money(a.expectedCashMinor)}</b>
        </div>
      </div>
      {a.businessUnit === "MARKET" && a.status !== "OPEN" && (
        <MarketFirstDeclaration accountId={a.id} />
      )}
      {a.sourceRef && (
        <div className="source-ref">
          <FileCheck2 size={14} />
          <span>Rapor: {a.sourceRef}</span>
        </div>
      )}
      <div className="detail-actions">
        {editable && (
          <>
            <button
              disabled={busy}
              className="btn secondary"
              onClick={() => onModal("payment")}
            >
              <Plus size={15} />
              Ödeme kaydı
            </button>
            <button
              disabled={busy}
              className="btn secondary"
              onClick={() => onModal("slip")}
            >
              <CreditCard size={15} />
              Slip teyidi
            </button>
            <button
              disabled={busy}
              className="btn primary wide"
              onClick={() => onModal("submit")}
            >
              <ArrowUpRight size={16} />
              Muhasebeye teslim et
            </button>
          </>
        )}
        {canSource && a.status === "OPEN" && (
          <button
            className="btn subtle wide"
            disabled={busy}
            onClick={() => onModal("source")}
          >
            Kaynak rapor tutarını gir
          </button>
        )}
        {!own &&
          receiver &&
          !closed &&
          ["SUBMITTED", "IN_REVIEW"].includes(a.status) &&
          !a.cashReceiverUserId && (
            <button
              className="btn secondary wide"
              disabled={busy}
              onClick={() => onModal("receive")}
            >
              Fizikî nakit alıcı teyidi
            </button>
          )}
        {!own &&
          financial &&
          !closed &&
          ["SUBMITTED", "IN_REVIEW"].includes(a.status) && (
            <>
              <button
                className="btn primary wide"
                disabled={busy || !a.cashReceiverUserId}
                onClick={() => onModal("approve")}
              >
                <CheckCheck size={16} />
                Mali imza ({a.signatureCount}/2)
              </button>
              <button
                className="btn subtle wide"
                disabled={busy}
                onClick={() => onModal("return")}
              >
                Personelden düzeltme iste
              </button>
            </>
          )}
      </div>
      {own && a.status === "OPEN" && (
        <div className="terminal-actions">
          <span>Bu cihazın vardiya bağlantısı</span>
          <button
            className="inline-link"
            disabled={busy}
            onClick={() =>
              void onAction("/terminal", {
                accountId: a.id,
                stationId: a.stationId,
                deviceId,
                action: "ACQUIRE",
                kind: deviceKind,
              })
            }
          >
            <Monitor size={13} />
            Terminali bağla
          </button>
          <button
            className="inline-link"
            disabled={busy}
            onClick={() =>
              void onAction("/terminal", {
                accountId: a.id,
                stationId: a.stationId,
                deviceId,
                action: "RELEASE",
                kind: deviceKind,
              })
            }
          >
            Bırak
          </button>
          <small>
            En fazla 5 aktif masaüstü; telefon bu sayıya dahil değil.
          </small>
        </div>
      )}
      <details className="inline-note account-history">
        <summary>Kaynak ve düzeltme geçmişi</summary>
        {(state.accountEvents || []).filter(e => e.accountId === a.id)
          .length === 0 ? (
          <p>Henüz kaynak veya düzeltme olayı yok.</p>
        ) : (
          (state.accountEvents || [])
            .filter(e => e.accountId === a.id)
            .map(e => (
              <div key={e.id}>
                <b>
                  {e.eventType === "SOURCE_SET"
                    ? "Kaynak toplamı kaydedildi"
                    : "Düzeltme için geri gönderildi"}
                </b>{" "}
                · {e.actorName} · Sürüm {e.revision}
                <br />
                {e.payload.note
                  ? String(e.payload.note)
                  : `Kaynak: ${String(e.payload.sourceRef || "—")} · Tutar: ${money(typeof e.payload.sourceSalesMinor === "number" ? e.payload.sourceSalesMinor : null)}`}
                <br />
                <small>{formatTurkeyInstant(e.createdAt)}</small>
              </div>
            ))
        )}
      </details>
    </div>
  );
}

function SetupScreen({
  state,
  busy,
  onAction,
}: {
  state: AppState;
  busy: boolean;
  onAction: (
    path: string,
    payload: Record<string, unknown>
  ) => Promise<boolean>;
}) {
  const [error, setError] = useState("");
  async function setup(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");
    const f = formObject(e.currentTarget);
    await onAction("/setup", {
      companyName: f.companyName,
      taxNumber: f.taxNumber,
      stationName: f.stationName,
      stationCode: f.stationCode,
      isDemo: f.isDemo === "on",
    });
  }
  async function join(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = formObject(e.currentTarget);
    await onAction("/join", { code: f.code.trim() });
  }
  return (
    <div className="setup-layout">
      {state.canSetup && (
        <Panel
          title="İlk firma ve istasyonunuzu oluşturun"
          subtitle="Giriş yapan kimliğin sahiplik yetkisi sunucuda doğrulanır"
        >
          <form onSubmit={setup} className="setup-form">
            <Field label="Firma unvanı">
              <input
                name="companyName"
                placeholder="Firma unvanını girin"
                required
                minLength={2}
                maxLength={150}
              />
            </Field>
            <Field label="Vergi numarası (isteğe bağlı)">
              <input name="taxNumber" maxLength={11} inputMode="numeric" />
            </Field>
            <div className="form-row">
              <Field label="İlk istasyon adı">
                <input
                  name="stationName"
                  required
                  placeholder="Merkez istasyon"
                  maxLength={150}
                />
              </Field>
              <Field label="İstasyon kodu">
                <input
                  name="stationCode"
                  required
                  placeholder="IST-001"
                  maxLength={30}
                />
              </Field>
            </div>
            <label className="checkbox-label">
              <input type="checkbox" name="isDemo" />
              Örnek çalışma alanı olarak işaretle
            </label>
            <p className="field-note">
              Örnek alan açıkça etiketlenir. Gerçek işletme için bu kutuyu
              işaretlemeyin; bilinmeyen bakiyeler otomatik doldurulmaz.
            </p>
            {error && <div className="form-error">{error}</div>}
            <SubmitButton busy={busy}>Çalışma alanını oluştur</SubmitButton>
          </form>
        </Panel>
      )}
      <Panel
        title="Personel davetiyle katılın"
        subtitle="Yönetici tarafından verilen tek kullanımlık kod"
      >
        <form onSubmit={join} className="setup-form">
          <Notice>
            Giriş başarılı. Yetkili çalışma alanı için bir üyelik gereklidir;
            hiçbir ziyaretçiye otomatik yönetici rolü verilmez.
          </Notice>
          <Field label="Davet kodu">
            <input
              name="code"
              required
              minLength={10}
              autoComplete="off"
              placeholder="Yöneticinizin paylaştığı kod"
            />
          </Field>
          <SubmitButton busy={busy}>Daveti kullan</SubmitButton>
        </form>
      </Panel>
    </div>
  );
}

function LoginScreen({ onLogin }: { onLogin: () => void }) {
  return (
    <div className="login-page">
      <section className="login-brand">
        <Logo inverse />
        <div className="login-copy">
          <div className="eyebrow">AKARYAKIT + MARKET / TEK PLATFORM</div>
          <h1>
            Her vardiya.
            <br />
            Her istasyon.
            <br />
            <em>Tek bir hesap.</em>
          </h1>
          <p>
            Saha ödemelerini, market stoklarını ve muhasebe kontrolünü
            izlenebilir bir iş akışında birleştirin.
          </p>
          <div className="login-benefits">
            <span>
              <ShieldCheck size={17} />
              Gerçek kullanıcı ve yetki kontrolü
            </span>
            <span>
              <Activity size={17} />
              Kalıcı, izlenebilir operasyon kayıtları
            </span>
            <span>
              <Smartphone size={17} />
              Telefonunuzdan vardiya hesabı
            </span>
          </div>
        </div>
        <div className="login-footer">
          <span>istasyonos / operasyon platformu</span>
          <small>Sahadan merkeze, her hesap izlenebilir.</small>
        </div>
      </section>
      <section className="login-form-area">
        <div className="login-form-content">
          <div className="login-secure-icon">
            <Fuel size={26} />
          </div>
          <div className="eyebrow">ÇALIŞMA ALANINA ERİŞİM</div>
          <h2>
            Operasyonunuza
            <br />
            güvenle devam edin.
          </h2>
          <p>
            Firma yetkilisi veya personel olarak kendi hesabınızla giriş yapın.
            İstasyon ve rol erişiminiz girişten sonra doğrulanır.
          </p>
          {window.__MANUS_CONFIG__?.authProvider === "manus" ? (
            <button className="btn primary login-button" onClick={onLogin}>
              Hesabımla giriş yap <ArrowRight size={18} />
            </button>
          ) : (
            <LocalLoginForm />
          )}
          <div className="login-note">
            <LockKeyhole size={16} />
            <span>
              Rol seçici veya demo kimliği yoktur.
              <br />
              Personel üyeliği yönetici davetiyle verilir.
            </span>
          </div>
          <div className="login-divider" />
          <div className="pilot-info">
            <span className="live-dot" />
            <div>
              <b>Çalışan uygulama · kontrollü pilot</b>
              <small>
                Turpak, banka ve haricî OCR bağlantıları
                <br />
                yetkili erişim sağlanana kadar kapalıdır.
              </small>
            </div>
          </div>
          <a
            className="login-help"
            href="https://help.manus.im"
            target="_blank"
            rel="noreferrer"
          >
            <CircleHelp size={14} />
            Giriş konusunda destek
          </a>
        </div>
      </section>
    </div>
  );
}

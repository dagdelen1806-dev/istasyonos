import type { AppState } from "@shared/station";

export type MobileQueueStatus =
  | "LOCAL_DRAFT"
  | "PENDING_SYNC"
  | "SYNCING"
  | "SYNCED"
  | "CONFLICT"
  | "FAILED";
export type MobileQueueKind = "PAYMENT" | "POS_SLIP_IMAGE" | "ACCOUNT_SUBMIT";

export function requirePositiveMobilePaymentAmount(
  amountMinor: number
): number {
  if (!Number.isSafeInteger(amountMinor) || amountMinor <= 0)
    throw new Error("Ödeme beyanı sıfırdan büyük bir kuruş tutarı olmalıdır.");
  return amountMinor;
}

export type MobileQueueScope = {
  userId: number;
  tenantId: string;
  stationId: string;
  shiftId: string;
  accountId: string;
  fingerprint?: string;
};
export type MobileQueueItem = MobileQueueScope & {
  clientOperationId: string;
  createdAt: string;
  kind: MobileQueueKind;
  status: MobileQueueStatus;
  attemptCount: number;
  errorCode?: string;
  retryable: boolean;
  acknowledgedAt?: string;
  encryptedPayload: { iv: ArrayBuffer; data: ArrayBuffer } | null;
  encryptedSyncPayload: { iv: ArrayBuffer; data: ArrayBuffer } | null;
};

export function mobileScopeConflict(
  item: MobileQueueItem,
  state: AppState,
  account: AppState["accounts"][number] | undefined,
  allowClosedReplay: boolean
): string | null {
  if (
    state.user.id !== item.userId ||
    state.tenant?.id !== item.tenantId ||
    state.member?.role !== "FUEL_STAFF" ||
    !state.member.stationIds.includes(item.stationId)
  )
    return "SCOPE_MISMATCH";
  if (
    !account ||
    account.userId !== item.userId ||
    account.stationId !== item.stationId ||
    account.shiftId !== item.shiftId ||
    account.businessUnit !== "FUEL"
  )
    return "ACCOUNT_SCOPE_MISMATCH";
  if (!allowClosedReplay && account.status !== "OPEN")
    return "ACCOUNT_NOT_OPEN";
  return null;
}

export function mobileRequestFor(
  item: MobileQueueItem,
  original: Record<string, unknown>,
  account: AppState["accounts"][number]
) {
  if (item.kind === "PAYMENT")
    return {
      path: "/payment",
      body: {
        ...original,
        accountId: account.id,
        expectedRevision: account.revision,
      },
    };
  if (item.kind === "POS_SLIP_IMAGE")
    return {
      path: "/pos-slip-draft/import",
      body: {
        ...original,
        stationId: item.stationId,
        accountId: account.id,
        expectedRevision: account.revision,
      },
    };
  return {
    path: "/account/submit",
    body: {
      ...original,
      accountId: account.id,
      expectedRevision: account.revision,
    },
  };
}

export function canTransitionMobileStatus(
  from: MobileQueueStatus,
  to: MobileQueueStatus
): boolean {
  const transitions: Record<MobileQueueStatus, MobileQueueStatus[]> = {
    LOCAL_DRAFT: ["PENDING_SYNC", "FAILED"],
    PENDING_SYNC: ["SYNCING", "CONFLICT", "FAILED"],
    SYNCING: ["SYNCED", "PENDING_SYNC", "CONFLICT", "FAILED"],
    SYNCED: [],
    CONFLICT: [],
    FAILED: ["PENDING_SYNC", "CONFLICT"],
  };
  return from === to || transitions[from].includes(to);
}

export function mobileSyncFailure(status: number, code: string) {
  if (!status || status >= 500)
    return {
      status: "PENDING_SYNC" as const,
      retryable: true,
      errorCode: "NETWORK_UNCERTAIN" as const,
      category: "NETWORK" as const,
    };
  if (status === 401)
    return {
      status: "FAILED" as const,
      retryable: true,
      errorCode: "SESSION_EXPIRED" as const,
      category: "SESSION" as const,
    };
  if (status === 403 || status === 409 || status === 412)
    return {
      status: "CONFLICT" as const,
      retryable: false,
      errorCode: code,
      category: "CONFLICT" as const,
    };
  return {
    status: "FAILED" as const,
    retryable: false,
    errorCode: code,
    category: "REJECTED" as const,
  };
}

export function sortMobileOperations(
  items: MobileQueueItem[]
): MobileQueueItem[] {
  return [...items].sort(
    (a, b) =>
      a.createdAt.localeCompare(b.createdAt) ||
      a.clientOperationId.localeCompare(b.clientOperationId)
  );
}

export function mobileQueueWithinLimit(
  existingBytes: number,
  nextBytes: number
): boolean {
  return (
    Number.isSafeInteger(existingBytes) &&
    Number.isSafeInteger(nextBytes) &&
    existingBytes >= 0 &&
    nextBytes >= 0 &&
    existingBytes + nextBytes <= MAX_QUEUE_BYTES
  );
}

export function sameMobileFingerprint(
  item: MobileQueueItem,
  scope: MobileQueueScope,
  kind: MobileQueueKind
): boolean {
  return (
    Boolean(scope.fingerprint) &&
    item.fingerprint === scope.fingerprint &&
    item.kind === kind &&
    item.userId === scope.userId &&
    item.tenantId === scope.tenantId &&
    item.stationId === scope.stationId &&
    item.shiftId === scope.shiftId &&
    item.accountId === scope.accountId
  );
}

type MobileLockApi = {
  request<T>(
    name: string,
    options: { mode: "exclusive"; ifAvailable: true },
    callback: (lock: unknown | null) => Promise<T>
  ): Promise<T>;
};

export async function withMobileSyncLock<T>(
  run: () => Promise<T>,
  locks: MobileLockApi | null | undefined = typeof navigator === "undefined"
    ? undefined
    : (navigator as Navigator & { locks?: MobileLockApi }).locks
): Promise<{ acquired: boolean; value?: T }> {
  if (!locks) return { acquired: false };
  return locks.request(
    "stationos-mobile-outbox-sync",
    {
      mode: "exclusive",
      ifAvailable: true,
    },
    async lock =>
      lock ? { acquired: true, value: await run() } : { acquired: false }
  );
}

export function offlineContextWithinAge(
  savedAt: string,
  now = Date.now()
): boolean {
  const age = now - Date.parse(savedAt);
  return Number.isFinite(age) && age >= 0 && age <= CONTEXT_MAX_AGE_MS;
}

export function buildOfflineContextState(state: AppState): AppState {
  const member = state.member;
  if (
    !member ||
    member.role !== "FUEL_STAFF" ||
    !state.tenant?.id ||
    !Array.isArray(member.stationIds) ||
    !Number.isSafeInteger(state.user.id) ||
    state.user.id <= 0
  )
    throw new Error("OFFLINE_FUEL_STAFF_SCOPE_REQUIRED");

  const allowedStationIds = new Set(member.stationIds);
  const stations = state.stations
    .filter(station => allowedStationIds.has(station.id))
    .map(station => ({ ...station, address: null }));
  const stationSet = new Set(stations.map(station => station.id));
  const accounts = state.accounts.filter(
    account =>
      account.userId === state.user.id &&
      account.businessUnit === "FUEL" &&
      stationSet.has(account.stationId) &&
      ["OPEN", "SUBMITTED", "IN_REVIEW", "NEEDS_INFO"].includes(account.status)
  );
  const accountShiftIds = new Set(accounts.map(account => account.shiftId));
  const shifts = state.shifts
    .filter(
      shift =>
        stationSet.has(shift.stationId) &&
        (accountShiftIds.has(shift.id) ||
          (shift.status === "OPEN" &&
            shift.assignedUserIds?.includes(state.user.id)))
    )
    .map(shift => ({
      ...shift,
      assignedUserIds: shift.assignedUserIds?.includes(state.user.id)
        ? [state.user.id]
        : [],
    }));

  return {
    ...state,
    csrfToken: undefined,
    tenant: { ...state.tenant, name: "Yerel vardiya" },
    member: { ...member, stationIds: [...stationSet] },
    staffingFeaturesAvailable: false,
    fastPaymentAvailable: false,
    posSlipAvailable: false,
    companies: [],
    stations,
    members: [],
    shifts,
    accounts,
    payments: [],
    slips: [],
    debtors: state.debtors
      .filter(debtor => !!debtor.stationId && stationSet.has(debtor.stationId))
      .map(debtor => ({ ...debtor, balanceMinor: null })),
    products: [],
    suppliers: [],
    payables: [],
    recommendations: [],
    audit: [],
    accountEvents: [],
    integrationStatus: {
      turpak: "OFFLINE",
      ocr: "OFFLINE",
      bank: "OFFLINE",
    },
  };
}

export function newClientOperationId(): string {
  return crypto.randomUUID();
}

const DB_NAME = "stationos-mobile-outbox-v1";
const DB_VERSION = 1;
const OP_STORE = "operations";
const META_STORE = "meta";
const CONTEXT_KEY = "last-authorized-mobile-context";
const CONTEXT_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const MAX_OPERATION_BYTES = 8 * 1024 * 1024;
const MAX_QUEUE_BYTES = 55 * 1024 * 1024;
const encoder = new TextEncoder();
const decoder = new TextDecoder();

function openDb(): Promise<IDBDatabase> {
  if (typeof indexedDB === "undefined")
    return Promise.reject(new Error("Bu tarayıcı IndexedDB desteklemiyor."));
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(OP_STORE)) {
        const store = db.createObjectStore(OP_STORE, {
          keyPath: "clientOperationId",
        });
        store.createIndex("userCreated", ["userId", "createdAt"]);
        store.createIndex("statusCreated", ["status", "createdAt"]);
      }
      if (!db.objectStoreNames.contains(META_STORE))
        db.createObjectStore(META_STORE, { keyPath: "key" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error ?? new Error("Yerel kayıt alanı açılamadı."));
    request.onblocked = () =>
      reject(
        new Error(
          "Yerel kayıt güncellemesi başka bir uygulama sekmesinde bekliyor."
        )
      );
  });
}

function requestValue<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error ?? new Error("Yerel kayıt okunamadı."));
  });
}

async function encryptionKey(db: IDBDatabase): Promise<CryptoKey> {
  const read = db.transaction(META_STORE, "readonly");
  const saved = (await requestValue(
    read.objectStore(META_STORE).get("aes-key")
  )) as { cryptoKey: CryptoKey } | undefined;
  if (saved?.cryptoKey) return saved.cryptoKey;
  const key = await crypto.subtle.generateKey(
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
  const write = db.transaction(META_STORE, "readwrite");
  write.objectStore(META_STORE).put({ key: "aes-key", cryptoKey: key });
  await new Promise<void>((resolve, reject) => {
    write.oncomplete = () => resolve();
    write.onerror = () =>
      reject(write.error ?? new Error("Şifreleme anahtarı saklanamadı."));
    write.onabort = () =>
      reject(write.error ?? new Error("Şifreleme anahtarı saklanamadı."));
  });
  return key;
}

async function encrypt(db: IDBDatabase, value: unknown) {
  const key = await encryptionKey(db);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    encoder.encode(JSON.stringify(value))
  );
  return { iv: iv.buffer, data };
}

async function decrypt<T>(
  db: IDBDatabase,
  value: { iv: ArrayBuffer; data: ArrayBuffer }
): Promise<T> {
  const key = await encryptionKey(db);
  const plain = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: value.iv },
    key,
    value.data
  );
  return JSON.parse(decoder.decode(plain)) as T;
}

export async function saveOfflineContext(state: AppState): Promise<void> {
  if (
    !state.member ||
    state.member.role !== "FUEL_STAFF" ||
    !state.tenant?.id ||
    state.member.stationIds.length === 0
  )
    return;
  // Persist only the employee's previously authorized station/account scope.
  // The in-memory tenant payload may include other employees' shifts/accounts.
  const offlineState = buildOfflineContextState(state);
  const db = await openDb();
  try {
    const encrypted = await encrypt(db, {
      state: offlineState,
      savedAt: new Date().toISOString(),
    });
    const tx = db.transaction(META_STORE, "readwrite");
    tx.objectStore(META_STORE).put({ key: CONTEXT_KEY, ...encrypted });
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () =>
        reject(tx.error ?? new Error("Çevrimdışı kapsam saklanamadı."));
      tx.onabort = () =>
        reject(tx.error ?? new Error("Çevrimdışı kapsam saklanamadı."));
    });
  } finally {
    db.close();
  }
}

export async function loadOfflineContext(): Promise<{
  state: AppState;
  savedAt: string;
} | null> {
  const db = await openDb();
  try {
    const tx = db.transaction(META_STORE, "readonly");
    const value = (await requestValue(
      tx.objectStore(META_STORE).get(CONTEXT_KEY)
    )) as
      | ({ iv: ArrayBuffer; data: ArrayBuffer } & { key: string })
      | undefined;
    if (!value) return null;
    const decoded = await decrypt<{ state: AppState; savedAt: string }>(
      db,
      value
    );
    if (!offlineContextWithinAge(decoded.savedAt)) return null;
    if (
      decoded.state.member?.role !== "FUEL_STAFF" ||
      !decoded.state.tenant?.id
    )
      return null;
    return decoded;
  } finally {
    db.close();
  }
}

export async function clearOfflineContext(): Promise<void> {
  const db = await openDb();
  try {
    const tx = db.transaction(META_STORE, "readwrite");
    tx.objectStore(META_STORE).delete(CONTEXT_KEY);
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () =>
        reject(tx.error ?? new Error("Yerel yetki bağlamı temizlenemedi."));
    });
  } finally {
    db.close();
  }
}

export async function enqueueMobileOperation(
  scope: MobileQueueScope,
  kind: MobileQueueKind,
  payload: Record<string, unknown>
): Promise<MobileQueueItem> {
  const serialized = JSON.stringify(payload);
  const size = encoder.encode(serialized).byteLength;
  if (size > MAX_OPERATION_BYTES)
    throw new Error(
      "Kayıt cihaz çevrimdışı sınırını aşıyor; fotoğrafı küçültüp tekrar deneyin."
    );
  const estimate = await navigator.storage?.estimate?.().catch(() => undefined);
  if (
    estimate?.quota &&
    estimate.usage !== undefined &&
    estimate.usage + size > estimate.quota * 0.85
  )
    throw new Error(
      "Cihaz depolama alanı dolmak üzere. Senkronize kayıtları temizleyin veya alan açın."
    );
  const db = await openDb();
  try {
    const item: MobileQueueItem = {
      ...scope,
      clientOperationId: newClientOperationId(),
      createdAt: new Date().toISOString(),
      kind,
      status: "LOCAL_DRAFT",
      attemptCount: 0,
      retryable: false,
      encryptedPayload: await encrypt(db, payload),
      encryptedSyncPayload: null,
    };
    let duplicate: MobileQueueItem | undefined;
    const tx = db.transaction(OP_STORE, "readwrite");
    const store = tx.objectStore(OP_STORE);
    const allRequest = store.getAll();
    allRequest.onsuccess = () => {
      const all = allRequest.result as MobileQueueItem[];
      duplicate = all.find(entry => sameMobileFingerprint(entry, scope, kind));
      if (duplicate) return;
      const bytes = all.reduce(
        (total, entry) =>
          total +
          (entry.encryptedPayload?.data.byteLength ?? 0) +
          (entry.encryptedSyncPayload?.data.byteLength ?? 0),
        0
      );
      if (!mobileQueueWithinLimit(bytes, size + 32)) {
        tx.abort();
        return;
      }
      store.add(item);
    };
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () =>
        reject(tx.error ?? new Error("Çevrimdışı kayıt saklanamadı."));
      tx.onabort = () =>
        reject(tx.error ?? new Error("Çevrimdışı kayıt saklanamadı."));
    });
    if (duplicate) return duplicate;
    return updateMobileOperation(item.clientOperationId, {
      status: "PENDING_SYNC",
    });
  } finally {
    db.close();
  }
}

export async function listMobileOperations(
  userId: number
): Promise<MobileQueueItem[]> {
  const db = await openDb();
  try {
    const tx = db.transaction(OP_STORE, "readonly");
    const values = (await requestValue(
      tx.objectStore(OP_STORE).getAll()
    )) as MobileQueueItem[];
    return sortMobileOperations(values.filter(item => item.userId === userId));
  } finally {
    db.close();
  }
}

export async function recoverInterruptedOperations(
  userId: number,
  syncLockAcquired: boolean
): Promise<MobileQueueItem[]> {
  if (!syncLockAcquired)
    throw new Error("Sync lock required before queue recovery.");
  const items = await listMobileOperations(userId);
  for (const item of items) {
    if (item.status === "SYNCING" || item.status === "LOCAL_DRAFT")
      await updateMobileOperation(item.clientOperationId, {
        status: "PENDING_SYNC",
        retryable: true,
        errorCode:
          item.status === "SYNCING" ? "RETRY_AFTER_RESTART" : undefined,
      });
  }
  return listMobileOperations(userId);
}

export async function readMobilePayload(
  item: MobileQueueItem
): Promise<Record<string, unknown>> {
  if (!item.encryptedPayload)
    throw new Error("Yerel kayıt içeriği bulunamadı.");
  const db = await openDb();
  try {
    return await decrypt<Record<string, unknown>>(db, item.encryptedPayload);
  } finally {
    db.close();
  }
}

export async function readMobileSyncPayload(
  item: MobileQueueItem
): Promise<Record<string, unknown> | null> {
  if (!item.encryptedSyncPayload) return null;
  const db = await openDb();
  try {
    return await decrypt<Record<string, unknown>>(
      db,
      item.encryptedSyncPayload
    );
  } finally {
    db.close();
  }
}

export async function saveMobileSyncPayload(
  clientOperationId: string,
  payload: Record<string, unknown>
): Promise<MobileQueueItem> {
  const db = await openDb();
  try {
    const encryptedSyncPayload = await encrypt(db, payload);
    return await updateMobileOperation(clientOperationId, {
      encryptedSyncPayload,
      encryptedPayload: null,
    });
  } finally {
    db.close();
  }
}

export async function updateMobileOperation(
  clientOperationId: string,
  patch: Partial<MobileQueueItem>
): Promise<MobileQueueItem> {
  const db = await openDb();
  try {
    const tx = db.transaction(OP_STORE, "readwrite");
    const store = tx.objectStore(OP_STORE);
    const current = (await requestValue(store.get(clientOperationId))) as
      | MobileQueueItem
      | undefined;
    if (!current) throw new Error("Çevrimdışı işlem kuyruğunda bulunamadı.");
    const next = { ...current, ...patch };
    if (!canTransitionMobileStatus(current.status, next.status))
      throw new Error("Geçersiz çevrimdışı işlem durumu geçişi.");
    store.put(next);
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () =>
        reject(tx.error ?? new Error("İşlem durumu saklanamadı."));
      tx.onabort = () =>
        reject(tx.error ?? new Error("İşlem durumu saklanamadı."));
    });
    return next;
  } finally {
    db.close();
  }
}

export async function deleteAcknowledgedOperation(
  item: MobileQueueItem
): Promise<boolean> {
  if (item.status !== "SYNCED" || !item.acknowledgedAt) return false;
  const db = await openDb();
  try {
    const tx = db.transaction(OP_STORE, "readwrite");
    tx.objectStore(OP_STORE).delete(item.clientOperationId);
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () =>
        reject(tx.error ?? new Error("Onaylı kayıt temizlenemedi."));
    });
    return true;
  } finally {
    db.close();
  }
}

export function operationStatusLabel(status: MobileQueueStatus): string {
  return {
    LOCAL_DRAFT: "Yerel taslak",
    PENDING_SYNC: "Senkronizasyon bekliyor",
    SYNCING: "Sunucuya gönderiliyor",
    SYNCED: "Sunucu alımı doğrulandı",
    CONFLICT: "Çakışma · inceleme gerekli",
    FAILED: "Gönderilemedi · kayıt korundu",
  }[status];
}

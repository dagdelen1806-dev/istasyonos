import {
  isRecoverableOperation,
  OPERATION_VERSION,
  operationStatus,
  type OperationResponse,
  type OperationStatus,
  type RecoverableOperation,
} from "@shared/operation-recovery";
import { parseInstant } from "@shared/datetime";

export type RecoveryOwner = { userId: number; tenantId: string };
export type PendingOperation = RecoveryOwner & {
  requestId: string;
  operation: RecoverableOperation;
  version: number;
  createdAt: string;
};
export type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;
export type ExclusiveLock = <T>(
  name: string,
  fn: () => Promise<T>
) => Promise<T>;
export const ownerKey = (owner: RecoveryOwner) =>
  `${owner.userId}:${owner.tenantId}`;
export const pendingKey = (owner: RecoveryOwner) =>
  `stationos-pending-v2:${ownerKey(owner)}`;
const unavailable = () =>
  new Error(
    "Güvenli kalıcı işlem takibi kullanılamıyor. Tarayıcı depolamasını ve güvenli bağlantıyı kontrol edin; mali istek gönderilmedi."
  );

/** Only allowlisted metadata. Never accepts or persists a request payload/result. */
export class PendingOperationStore {
  constructor(
    private readonly storage: StorageLike,
    private readonly exclusive: ExclusiveLock
  ) {}
  private read(owner: RecoveryOwner): PendingOperation | null {
    const raw = this.storage.getItem(pendingKey(owner));
    if (raw === null) return null;
    try {
      const record = JSON.parse(raw);
      if (
        record.userId !== owner.userId ||
        record.tenantId !== owner.tenantId ||
        record.version !== OPERATION_VERSION ||
        !isRecoverableOperation(record.operation) ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
          record.requestId
        ) ||
        Object.keys(record).some(
          key =>
            ![
              "userId",
              "tenantId",
              "requestId",
              "operation",
              "version",
              "createdAt",
            ].includes(key)
        )
      )
        throw unavailable();
      parseInstant(record.createdAt);
      return record;
    } catch {
      throw unavailable();
    }
  }
  async get(owner: RecoveryOwner): Promise<PendingOperation | null> {
    return this.exclusive(pendingKey(owner), async () => this.read(owner));
  }
  async claim(
    owner: RecoveryOwner,
    operation: RecoverableOperation,
    makeId = () => crypto.randomUUID() as string
  ): Promise<{ record: PendingOperation; created: boolean }> {
    return this.exclusive(pendingKey(owner), async () => {
      const previous = this.read(owner);
      if (previous) return { record: previous, created: false };
      const record: PendingOperation = {
        userId: owner.userId,
        tenantId: owner.tenantId,
        requestId: makeId(),
        operation,
        version: OPERATION_VERSION,
        createdAt: new Date().toISOString(),
      };
      this.storage.setItem(pendingKey(owner), JSON.stringify(record));
      if (this.read(owner)?.requestId !== record.requestId) throw unavailable();
      return { record, created: true };
    });
  }
  async acknowledge(owner: RecoveryOwner, requestId: string): Promise<void> {
    await this.exclusive(pendingKey(owner), async () => {
      if (this.read(owner)?.requestId === requestId)
        this.storage.removeItem(pendingKey(owner));
    });
  }
}

export function browserPendingStore(): PendingOperationStore {
  if (typeof navigator === "undefined" || !navigator.locks) throw unavailable();
  try {
    return new PendingOperationStore(
      window.localStorage,
      async (name, fn) =>
        await navigator.locks.request(name, { mode: "exclusive" }, fn)
    );
  } catch {
    throw unavailable();
  }
}
export type RecoveryView = {
  record: PendingOperation;
  status: OperationStatus;
};
export type RecoveryTransport = {
  send(
    operation: RecoverableOperation,
    payload: Record<string, unknown>,
    requestId: string,
    csrf?: string
  ): Promise<OperationResponse>;
  status(record: PendingOperation): Promise<OperationStatus>;
};
export class OperationRecovery {
  constructor(
    readonly store: PendingOperationStore,
    private readonly transport: RecoveryTransport
  ) {}
  async check(record: PendingOperation): Promise<RecoveryView> {
    try {
      return { record, status: await this.transport.status(record) };
    } catch {
      return { record, status: operationStatus("UNCERTAIN") };
    }
  }
  async submit(
    owner: RecoveryOwner,
    operation: RecoverableOperation,
    payload: Record<string, unknown>,
    csrf?: string,
    onPending?: (view: RecoveryView) => void
  ): Promise<RecoveryView & { sent: boolean }> {
    const claim = await this.store.claim(owner, operation);
    onPending?.({
      record: claim.record,
      status: operationStatus("IN_PROGRESS"),
    });
    if (!claim.created)
      return { ...(await this.check(claim.record)), sent: false };
    try {
      const response = await this.transport.send(
        operation,
        payload,
        claim.record.requestId,
        csrf
      );
      if (
        response?.ok !== true ||
        !response.result ||
        typeof response.result !== "object" ||
        Array.isArray(response.result)
      )
        throw new Error("response uncertain");
      return {
        record: claim.record,
        status: { ...operationStatus("COMPLETED"), response },
        sent: true,
      };
    } catch {
      return { ...(await this.check(claim.record)), sent: true };
    }
  }
  async acknowledge(view: RecoveryView): Promise<void> {
    if (!["COMPLETED", "FAILED"].includes(view.status.state))
      throw new Error(
        "Belirsiz işlem kapatılamaz; önce sunucu sonucu doğrulanmalıdır."
      );
    await this.store.acknowledge(view.record, view.record.requestId);
  }
}

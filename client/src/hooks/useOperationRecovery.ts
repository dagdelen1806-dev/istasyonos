import { useCallback, useEffect, useRef, useState } from "react";
import {
  browserPendingStore,
  OperationRecovery,
  ownerKey,
  pendingKey,
  type RecoveryOwner,
  type RecoveryView,
} from "@/lib/operation-recovery";
import { loadOperationStatus, mutate } from "@/lib/station-api";
import type { RecoverableOperation } from "@shared/operation-recovery";

export function useOperationRecovery(owner: RecoveryOwner | null) {
  const key = owner ? ownerKey(owner) : "";
  const activeKey = useRef(key);
  activeKey.current = key;
  const currentOwner = useRef(owner);
  currentOwner.current = owner;
  const controller = useRef<OperationRecovery | null>(null);
  const [readyKey, setReadyKey] = useState<string | null>(null);
  const [view, setView] = useState<
    (RecoveryView & { ownerKey: string }) | null
  >(null);
  const latestView = useRef<(RecoveryView & { ownerKey: string }) | null>(null);
  const publish = (next: (RecoveryView & { ownerKey: string }) | null) => {
    latestView.current = next;
    setView(next);
  };
  const [error, setError] = useState<{ key: string; message: string } | null>(
    null
  );
  const getController = () =>
    (controller.current ??= new OperationRecovery(browserPendingStore(), {
      send: mutate,
      status: loadOperationStatus,
    }));
  const check = useCallback(async () => {
    const selected = currentOwner.current;
    if (!selected) return;
    const capturedKey = ownerKey(selected);
    try {
      const operation = getController();
      const record = await operation.store.get(selected);
      const next = record ? await operation.check(record) : null;
      if (activeKey.current !== capturedKey) return;
      publish(next ? { ...next, ownerKey: capturedKey } : null);
      setError(null);
    } catch (failure) {
      if (activeKey.current === capturedKey)
        setError({
          key: capturedKey,
          message:
            failure instanceof Error
              ? failure.message
              : "İşlem takibi doğrulanamadı.",
        });
    } finally {
      if (activeKey.current === capturedKey) setReadyKey(capturedKey);
    }
  }, []);
  useEffect(() => {
    publish(null);
    setError(null);
    setReadyKey(null);
    if (!owner) return;
    void check();
    const storageChanged = (event: StorageEvent) => {
      if (event.key === pendingKey(owner)) void check();
    };
    const focused = () => void check();
    window.addEventListener("storage", storageChanged);
    window.addEventListener("focus", focused);
    return () => {
      window.removeEventListener("storage", storageChanged);
      window.removeEventListener("focus", focused);
    };
  }, [key, check]);
  const visibleView = view?.ownerKey === key ? view : null;
  useEffect(() => {
    if (!visibleView) return;
    const status = visibleView.status.state;
    const age = Date.now() - Date.parse(visibleView.record.createdAt);
    const recentMissing = status === "NOT_FOUND" && age >= 0 && age < 30000;
    if (status !== "IN_PROGRESS" && !recentMissing) return;
    const timer = window.setTimeout(
      () => void check(),
      visibleView.status.retryAfterMs ?? 2000
    );
    return () => clearTimeout(timer);
  }, [visibleView, check]);
  const submit = async (
    operation: RecoverableOperation,
    payload: Record<string, unknown>,
    csrf?: string
  ) => {
    const selected = currentOwner.current;
    if (!selected) return null;
    const capturedKey = ownerKey(selected);
    const outcome = await getController().submit(
      selected,
      operation,
      payload,
      csrf,
      next => {
        if (activeKey.current === capturedKey)
          publish({ ...next, ownerKey: capturedKey });
      }
    );
    if (activeKey.current !== capturedKey) return null;
    publish({ ...outcome, ownerKey: capturedKey });
    return outcome.sent && outcome.status.state === "COMPLETED"
      ? (outcome.status.response ?? null)
      : null;
  };
  const acknowledge = async () => {
    const current = latestView.current;
    if (!current || current.ownerKey !== activeKey.current) return;
    await getController().acknowledge(current);
    await check();
  };
  return {
    view: visibleView,
    error: error?.key === key ? error.message : "",
    loading: Boolean(owner && readyKey !== key),
    blocked: Boolean(
      owner && (readyKey !== key || visibleView || error?.key === key)
    ),
    submit,
    check,
    acknowledge,
  };
}

import { useEffect, useRef, useState } from "react";
import type { AppState } from "@shared/station";
import type { PosState } from "@shared/pos";
import { money } from "@shared/station";
import {
  ApiError,
  getDeviceIdentity,
  loadPosState,
  mutate,
} from "@/lib/station-api";
import { newRequestId } from "@/lib/id";

type Pending = { path: string; payload: Record<string, unknown>; id: string };
const paths = [
  "register",
  "open",
  "join",
  "checkout",
  "close",
  "cart/add",
  "cart/reduce",
  "cart/hold",
  "cart/resume",
  "cart/cancel",
  "cart/reprice",
].map(p => `/pos/${p}`);

export function usePosWorkspace(state: AppState, stationId: string) {
  const [data, setData] = useState<PosState | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<Pending | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [reachable, setReachable] = useState(false);
  const inFlight = useRef(false),
    sequence = useRef(0);
  const deviceId = getDeviceIdentity().deviceId;
  const storageKey = `stationos-pos-pending:${state.user.id}:${stationId}:${deviceId}`;
  const locked = busy || !!pending || !loaded;

  async function refresh() {
    const current = ++sequence.current;
    try {
      const next = await loadPosState(stationId);
      if (current === sequence.current) {
        setData(next);
        setReachable(true);
      }
    } catch (e) {
      if (current === sequence.current) setReachable(false);
      throw e;
    }
  }
  useEffect(() => {
    if (!stationId) {
      setLoaded(true);
      return;
    }
    let active = true;
    const update = () => {
      void refresh().catch(e => {
        if (active) setError(e.message);
      });
    };
    update();
    const timer = window.setInterval(update, 15000);
    try {
      const raw = sessionStorage.getItem(storageKey);
      if (raw) {
        const saved = JSON.parse(raw) as Pending;
        if (
          !paths.includes(saved.path) ||
          saved.payload.stationId !== stationId ||
          !/^[a-f0-9-]{36}$/i.test(saved.id)
        )
          throw new Error(
            "Bekleyen istek okunamadı. Yeni satış başlatmadan destek alın."
          );
        setPending(saved);
        setNotice(
          "Önceki isteğin sonucu bekleniyor. Aynı isteği kontrol edin."
        );
      }
      setLoaded(true);
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Tarayıcı depolaması kullanılamıyor."
      );
    }
    return () => {
      active = false;
      sequence.current++;
      window.clearInterval(timer);
    };
  }, [storageKey]);

  async function action(
    path: string,
    payload: Record<string, unknown>,
    retry?: Pending
  ): Promise<boolean> {
    if (inFlight.current || (!retry && locked)) return false;
    const operation = retry ?? {
      path,
      payload: { ...payload, stationId },
      id: newRequestId(),
    };
    inFlight.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      sessionStorage.setItem(storageKey, JSON.stringify(operation));
      setPending(operation);
      let response;
      try {
        response = await mutate(
          operation.path,
          operation.payload,
          operation.id,
          state.csrfToken
        );
      } catch (e) {
        const uncertain =
          !(e instanceof ApiError) ||
          !e.status ||
          e.status >= 500 ||
          e.status === 401 ||
          e.status === 403;
        if (!uncertain) {
          sessionStorage.removeItem(storageKey);
          setPending(null);
          void refresh().catch(() => {});
        }
        throw e;
      }
      sessionStorage.removeItem(storageKey);
      setPending(null);
      setReachable(true);
      const r = response.result;
      if (operation.path === "/pos/checkout")
        setNotice(
          `DEMO satış kaydedildi: ${money(r.totalMinor)}. Para üstü: ${money(r.changeMinor)}. Mali belge düzenlenmedi.`
        );
      else if (operation.path === "/pos/close")
        setNotice(`Kasa kapandı. Nakit farkı: ${money(r.differenceMinor)}.`);
      else if (operation.path === "/pos/cart/hold")
        setNotice("Sepet beklemeye alındı. Yeni müşteriye başlayabilirsiniz.");
      else if (operation.path === "/pos/cart/resume")
        setNotice(
          "Sepet bu bilgisayara alındı. Fiyat ve toplamı kontrol edin."
        );
      else if (
        operation.path === "/pos/cart/reduce" ||
        operation.path === "/pos/cart/cancel"
      )
        setNotice("İptal, açıklamasıyla kaydedildi.");
      else if (operation.path === "/pos/cart/reprice")
        setNotice("Güncel fiyatlar alındı. Yeni toplamı kontrol edin.");
      else if (operation.path === "/pos/join")
        setNotice("Ortak kasaya katıldınız. Açılış parası yeniden eklenmedi.");
      else if (operation.path === "/pos/register")
        setNotice("Kasa tanımlandı.");
      else if (operation.path === "/pos/open") setNotice("Kasa açıldı.");
      // Reflect the acknowledged cart immediately; invalidate older poll responses.
      ++sequence.current;
      if (r.cart)
        setData(previous =>
          previous
            ? {
                ...previous,
                activeCart: r.cart.status === "ACTIVE" ? r.cart : null,
              }
            : previous
        );
      if (operation.path === "/pos/checkout")
        setData(previous =>
          previous ? { ...previous, activeCart: null } : previous
        );
      try {
        await refresh();
      } catch {
        setError(
          "İşlem kaydedildi; güncel liste alınamadı. Yenile ile tekrar kontrol edin."
        );
      }
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "İşlem tamamlanamadı.");
      return false;
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }
  return {
    data,
    error,
    notice,
    busy,
    pending,
    locked,
    reachable,
    deviceId,
    setError,
    refresh,
    action,
    retry: () => pending && action(pending.path, pending.payload, pending),
  };
}

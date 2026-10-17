import { useEffect, useRef, useState } from "react";
import type { AppState } from "@shared/station";
import type { MarketAccountingState } from "@shared/market-accounting";
import {
  ApiError,
  getDeviceIdentity,
  loadMarketAccountingState,
  mutate,
} from "@/lib/station-api";
import { newRequestId } from "@/lib/id";
import { today } from "./Common";
type Pending = { path: string; payload: Record<string, unknown>; id: string };
const allowed = [
  "start",
  "party",
  "party-update",
  "product",
  "purchase",
  "settlement",
  "expense",
  "transfer",
  "capital",
  "bank-settlement",
  "stock-adjust",
  "reverse",
  "day-close",
]
  .map(s => "/market-accounting/" + s)
  .concat("/product");
export function useMarketAccounting(state: AppState, stationId: string) {
  const [data, setData] = useState<MarketAccountingState | null>(null),
    [date, setDate] = useState(today),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [pending, setPending] = useState<Pending | null>(null),
    [busy, setBusy] = useState(false),
    [loaded, setLoaded] = useState(false);
  const canRead = ["OWNER", "MANAGER", "ACCOUNTANT"].includes(
      state.member?.role ?? ""
    ),
    device = getDeviceIdentity().deviceId,
    key = `stationos-market-pending:${state.user.id}:${stationId}:${device}`,
    flight = useRef(false),
    sequence = useRef(0);
  async function refresh() {
    const seq = ++sequence.current;
    const next = await loadMarketAccountingState(stationId, date);
    if (seq === sequence.current) setData(next);
  }
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(key);
      if (raw) {
        const op = JSON.parse(raw) as Pending;
        if (
          !allowed.includes(op.path) ||
          op.payload.stationId !== stationId ||
          !/^[a-f0-9-]{36}$/i.test(op.id)
        )
          throw Error(
            "Bekleyen muhasebe isteği okunamadı; yeni kayıt açmadan destek alın."
          );
        setPending(op);
      }
      setLoaded(true);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [key]);
  useEffect(() => {
    if (!stationId || !canRead) return;
    let active = true;
    const update = () =>
      void refresh().catch(e => {
        if (active) setError(e.message);
      });
    update();
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") update();
    }, 25000);
    return () => {
      active = false;
      sequence.current++;
      clearInterval(timer);
    };
  }, [date, stationId, canRead]);
  const locked = busy || !!pending || !loaded;
  async function action(
    path: string,
    payload: Record<string, unknown>,
    retry?: Pending
  ): Promise<boolean> {
    if (flight.current || (!retry && locked)) return false;
    const op = retry ?? {
      path,
      payload: { ...payload, stationId },
      id: newRequestId(),
    };
    flight.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      sessionStorage.setItem(key, JSON.stringify(op));
      setPending(op);
      let response;
      try {
        response = await mutate(op.path, op.payload, op.id, state.csrfToken);
      } catch (e) {
        const unknown =
          !(e instanceof ApiError) ||
          !e.status ||
          e.status >= 500 ||
          e.status === 401 ||
          e.status === 403;
        if (!unknown) {
          sessionStorage.removeItem(key);
          setPending(null);
          void refresh().catch(() => {});
        }
        throw e;
      }
      sessionStorage.removeItem(key);
      setPending(null);
      setNotice(
        op.path.endsWith("day-close")
          ? "Gün sonu kaydedildi. Bugünün mali kayıtları kapatıldı."
          : op.path.endsWith("reverse")
            ? "Asıl kayıt korunarak ters fiş oluşturuldu."
            : "İşlem kaydedildi; bakiyeler ve ilgili hareketler güncellendi."
      );
      ++sequence.current;
      try {
        await refresh();
      } catch {
        setError(
          "İşlem kaydedildi; güncel görünüm alınamadı. Yenile ile kontrol edin."
        );
      }
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    } finally {
      flight.current = false;
      setBusy(false);
    }
  }
  return {
    data,
    date,
    setDate,
    canRead,
    error,
    notice,
    pending,
    busy,
    locked,
    action,
    refresh,
    retry: () => pending && action(pending.path, pending.payload, pending),
  };
}

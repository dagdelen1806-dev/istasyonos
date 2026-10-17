import { useEffect, useRef, useState } from "react";
import type { AppState } from "@shared/station";
import type { TerminalState, InventoryDraft } from "@shared/inventory";
import {
  ApiError,
  getDeviceIdentity,
  loadInventoryTerminal,
  loadInventoryDraft,
  mutate,
} from "@/lib/station-api";
import { newRequestId } from "@/lib/id";
type Pending = { path: string; payload: Record<string, unknown>; id: string };
const paths = [
  "device-register",
  "device-approve",
  "draft-create",
  "draft-scan",
  "draft-rebase",
  "draft-cancel",
  "receipt-post",
  "count-post",
].map(s => "/market-accounting/inventory/" + s);
export function useInventoryTerminal(state: AppState, station: string) {
  const [data, setData] = useState<TerminalState | null>(null),
    [draft, setDraft] = useState<InventoryDraft | null>(null),
    [selected, setSelected] = useState(""),
    [pending, setPending] = useState<Pending | null>(null),
    [busy, setBusy] = useState(false),
    [loaded, setLoaded] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const flight = useRef(false),
    sequence = useRef(0),
    selectedRef = useRef(selected);
  selectedRef.current = selected;
  const device = getDeviceIdentity().deviceId,
    key = `stationos-inventory-pending:${state.user.id}:${station}:${device}`;
  const canRead = [
    "OWNER",
    "MANAGER",
    "ACCOUNTANT",
    "MARKET_STAFF",
    "PURCHASER",
  ].includes(state.member?.role ?? "");
  async function refresh() {
    const seq = ++sequence.current,
      id = selectedRef.current;
    const next = await loadInventoryTerminal(station);
    const detail = id ? await loadInventoryDraft(station, id) : null;
    if (seq === sequence.current) {
      setData(next);
      setDraft(detail);
    }
  }
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(key);
      if (raw) {
        const p = JSON.parse(raw) as Pending;
        if (
          !paths.includes(p.path) ||
          p.payload?.stationId !== station ||
          !/^[a-f0-9-]{36}$/i.test(p.id)
        )
          throw Error(
            "Bekleyen terminal isteği okunamadı; yeni kayıt açmadan destek alın."
          );
        setPending(p);
      }
      setLoaded(true);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [key]);
  useEffect(() => {
    if (!station || !canRead) return;
    let active = true;
    const load = () =>
      void refresh().catch(e => {
        if (active) setError(e.message);
      });
    load();
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") load();
    }, 15000);
    return () => {
      active = false;
      sequence.current++;
      clearInterval(timer);
    };
  }, [station, selected, canRead]);
  const locked = busy || !!pending || !loaded;
  async function action(
    path: string,
    payload: Record<string, unknown>,
    retry?: Pending
  ) {
    if (flight.current || (!retry && locked)) return false;
    const op = retry ?? {
      path: "/market-accounting/inventory/" + path,
      payload: { ...payload, stationId: station },
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
        op.path.endsWith("draft-scan")
          ? "Okutma sunucuya kaydedildi."
          : op.path.endsWith("count-post")
            ? "Sayım farkları stok ve maliyet defterine işlendi."
            : op.path.endsWith("receipt-post")
              ? "Mal kabulü stok, KDV ve cari borcuyla kaydedildi."
              : "İşlem kaydedildi."
      );
      if (op.path.endsWith("draft-create")) {
        setSelected(response.result.id);
        selectedRef.current = response.result.id;
      }
      try {
        await refresh();
      } catch {
        setError("İşlem kaydedildi; güncel görünüm alınamadı. Yenileyin.");
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
    draft,
    selected,
    setSelected: (id: string) => {
      selectedRef.current = id;
      sequence.current++;
      setDraft(null);
      setSelected(id);
    },
    locked,
    busy,
    pending,
    error,
    notice,
    canRead,
    action,
    refresh,
    retry: () => pending && action("", {}, pending),
  };
}

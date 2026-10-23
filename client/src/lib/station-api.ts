import { newRequestId } from "@/lib/id";
import type { AppState } from "@shared/station";
import { COOKIE_NAME } from "@shared/const";

let memoryDeviceId: string | undefined;
export function getDeviceIdentity() {
  if (!memoryDeviceId) {
    try {
      memoryDeviceId = localStorage.getItem("stationos-device-id") || undefined;
    } catch {
      /* memory fallback */
    }
    if (!memoryDeviceId) memoryDeviceId = newRequestId();
    try {
      localStorage.setItem("stationos-device-id", memoryDeviceId);
    } catch {
      /* memory fallback */
    }
  }
  const kind = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent)
    ? "MOBILE"
    : "DESKTOP";
  return { deviceId: memoryDeviceId, kind };
}

export class ApiError extends Error {
  constructor(
    public code: string,
    message: string,
    public status = 0
  ) {
    super(message);
  }
}
function headers(csrf?: string): Record<string, string> {
  const device = getDeviceIdentity();
  const h: Record<string, string> = {
    "Content-Type": "application/json",
    "X-Stationos-Request": "1",
    "X-Stationos-Device-Id": device.deviceId,
    "X-Stationos-Device-Kind": device.kind,
  };
  if (csrf) h["X-CSRF-Token"] = csrf;
  try {
    const raw =
      window.__MANUS_CONFIG__?.authProvider === "manus"
        ? sessionStorage.getItem("manus-cookie")
        : null;
    const prefix = `${COOKIE_NAME}=`;
    const pair = raw?.split(";").find(s => s.trim().startsWith(prefix));
    const token = pair?.trim().slice(prefix.length);
    if (token) h.Authorization = `Bearer ${token}`;
  } catch {
    /* cookie is primary */
  }
  return h;
}
async function request(path: string, body?: object, csrf?: string) {
  let response: Response;
  try {
    response = await fetch(`/api/stationos${path}`, {
      method: body ? "POST" : "GET",
      credentials: "include",
      cache: "no-store",
      headers: headers(csrf),
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError(
      "NETWORK_UNCERTAIN",
      "Sunucu yanıtı alınamadı. İşlem kaydedilmiş olabilir; aynı işlem kimliğiyle tekrar deneyin."
    );
  }
  let data: any;
  try {
    data = await response.json();
  } catch {
    throw new ApiError(
      "RESPONSE_UNCERTAIN",
      "Sunucudan geçerli yanıt alınamadı; aynı işlem kimliği korunuyor."
    );
  }
  if (!response.ok || data.ok === false)
    throw new ApiError(
      data.error?.code || "REQUEST_FAILED",
      data.error?.message || "İşlem tamamlanamadı.",
      response.status
    );
  return data;
}
export async function loadState(stationId?: string): Promise<AppState> {
  const data = await request(
    `/state${stationId ? `?stationId=${encodeURIComponent(stationId)}` : ""}`
  );
  return data.state || data;
}
export async function mutate(
  path: string,
  payload: Record<string, unknown>,
  requestId: string,
  csrf?: string
) {
  return request(path, { ...payload, requestId }, csrf);
}

export async function loadPosState(
  stationId: string
): Promise<import("@shared/pos").PosState> {
  return request(`/pos?stationId=${encodeURIComponent(stationId)}`);
}

export async function loadMarketAccountingState(
  stationId: string,
  date: string
): Promise<import("@shared/market-accounting").MarketAccountingState> {
  return request(
    `/market-accounting?stationId=${encodeURIComponent(stationId)}&date=${encodeURIComponent(date)}`
  );
}
export async function loadMarketStatement(
  stationId: string,
  partyId: string,
  from: string,
  to: string,
  cursor = 0
): Promise<import("@shared/market-accounting").MarketStatementPage> {
  return request(
    `/market-accounting/statement?stationId=${encodeURIComponent(stationId)}&partyId=${encodeURIComponent(partyId)}&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&cursor=${cursor}`
  );
}

export async function loadMarketReturnSources(
  stationId: string,
  kind: "POS_SALE" | "PURCHASE",
  from: string,
  to: string,
  q: string,
  cursor = 0
): Promise<{
  rows: import("@shared/market-accounting").MarketReturnSummary[];
  nextCursor: number | null;
}> {
  return request(
    `/market-accounting/return-sources?${new URLSearchParams({ stationId, kind, from, to, q, cursor: String(cursor) })}`
  );
}
export async function loadMarketReturnSource(
  stationId: string,
  entryId: string
): Promise<import("@shared/market-accounting").MarketReturnSource> {
  return request(
    `/market-accounting/return-source?${new URLSearchParams({ stationId, entryId })}`
  );
}

export async function loadInventory(
  stationId: string
): Promise<import("@shared/inventory").InventoryState> {
  return request(
    `/market-accounting/inventory?${new URLSearchParams({ stationId })}`
  );
}
export async function loadInventoryTerminal(
  stationId: string
): Promise<import("@shared/inventory").TerminalState> {
  return request(
    `/market-accounting/inventory/terminal?${new URLSearchParams({ stationId })}`
  );
}
export async function loadInventoryDraft(
  stationId: string,
  draftId: string
): Promise<import("@shared/inventory").InventoryDraft> {
  return request(
    `/market-accounting/inventory/draft?${new URLSearchParams({ stationId, draftId })}`
  );
}
export async function loadInventoryMovements(
  stationId: string,
  productId: string,
  from: string,
  to: string,
  cursor = ""
): Promise<import("@shared/inventory").InventoryMovements> {
  return request(
    `/market-accounting/inventory/movements?${new URLSearchParams({ stationId, productId, from, to, cursor })}`
  );
}
export async function loadMonthlyReport(
  stationId: string,
  month: string
): Promise<import("@shared/inventory").MonthlyReport> {
  return request(
    `/market-accounting/monthly?${new URLSearchParams({ stationId, month })}`
  );
}
export async function loadLotState(
  stationId: string,
  productId = "",
  offset = 0
): Promise<import("@shared/lots").LotState> {
  return request(
    `/market-accounting/inventory/lots?${new URLSearchParams({ stationId, ...(productId ? { productId } : {}), offset: String(offset) })}`
  );
}
export function previewCatalog(
  stationId: string,
  text: string,
  csrfToken: string | undefined,
  settings?: import("@shared/catalog-import").CatalogSettings
): Promise<import("@shared/catalog-import").CatalogPreview> {
  return request(
    "/market-accounting/inventory/catalog-preview",
    { stationId, text, settings },
    csrfToken
  );
}
export function loadCatalogHistory(
  stationId: string
): Promise<import("@shared/catalog-import").CatalogHistory[]> {
  return request(
    `/market-accounting/inventory/catalog-history?${new URLSearchParams({ stationId })}`
  );
}

export function loadCountReports(
  stationId: string,
  from: string,
  to: string,
  cursor = ""
): Promise<import("@shared/count-report").CountReportPage> {
  return request(
    `/market-accounting/inventory/count-reports?${new URLSearchParams({ stationId, from, to, cursor })}`
  );
}
export function loadCountReport(
  stationId: string,
  entryId: string
): Promise<import("@shared/count-report").CountReportDetail> {
  return request(
    `/market-accounting/inventory/count-reports/${encodeURIComponent(entryId)}?${new URLSearchParams({ stationId })}`
  );
}

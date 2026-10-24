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

export function loadPurchaseOrders(
  stationId: string,
  status = "OPEN",
  cursor = ""
): Promise<import("@shared/purchase-order").OrderPage> {
  return request(
    `/market-accounting/inventory/orders?${new URLSearchParams({ stationId, status, cursor })}`
  );
}
export function loadPurchaseOrder(
  stationId: string,
  orderId: string
): Promise<import("@shared/purchase-order").OrderDetail> {
  return request(
    `/market-accounting/inventory/orders/${encodeURIComponent(orderId)}?${new URLSearchParams({ stationId })}`
  );
}

export function loadShelfLabels(
  stationId: string
): Promise<import("@shared/shelf-labels").ShelfState> {
  return request(
    `/market-accounting/inventory/shelf-labels?${new URLSearchParams({ stationId })}`
  );
}
export function loadShelfBatch(
  stationId: string,
  batchId: string
): Promise<import("@shared/shelf-labels").ShelfBatch> {
  return request(
    `/market-accounting/inventory/shelf-batches/${encodeURIComponent(batchId)}?${new URLSearchParams({ stationId })}`
  );
}
export function lookupShelfPrice(
  stationId: string,
  barcode: string
): Promise<import("@shared/shelf-labels").ShelfItem & { barcode: string }> {
  return request(
    `/market-accounting/inventory/shelf-check?${new URLSearchParams({ stationId, barcode })}`
  );
}

export async function loadSalesReport(
  stationId: string,
  from: string,
  to: string,
  cursor = "",
  asOf = "",
  filters: import("@shared/market-reports").ReportFilters = {
    registerId: "",
    userId: "",
  }
) {
  const params = new URLSearchParams({ stationId, from, to, ...filters });
  if (cursor) params.set("cursor", cursor);
  if (asOf) params.set("asOf", asOf);
  return request(`/market-accounting/reports/sales?${params}`) as Promise<
    import("@shared/market-reports").SalesReport
  >;
}
export async function loadSalesProducts(
  stationId: string,
  from: string,
  to: string,
  asOf: string,
  cursor = "",
  filters: import("@shared/market-reports").ReportFilters = {
    registerId: "",
    userId: "",
  }
) {
  return request(
    `/market-accounting/reports/sales/products?${new URLSearchParams({ stationId, from, to, asOf, cursor, ...filters })}`
  ) as Promise<import("@shared/market-reports").SalesProducts>;
}
export async function loadReportSale(
  stationId: string,
  saleId: string,
  asOf: string
) {
  return request(
    `/market-accounting/reports/sales/${encodeURIComponent(saleId)}?${new URLSearchParams({ stationId, asOf })}`
  ) as Promise<import("@shared/market-reports").ReportSaleDetail>;
}

export function loadReportOptions(
  stationId: string
): Promise<import("@shared/market-reports").ReportOptions> {
  return request(
    `/market-accounting/reports/options?${new URLSearchParams({ stationId })}`
  );
}
export function loadCancellations(
  stationId: string,
  from: string,
  to: string,
  filters: import("@shared/market-reports").ReportFilters,
  asOf = "",
  cursor = ""
): Promise<import("@shared/market-reports").CancellationReport> {
  return request(
    `/market-accounting/reports/cancellations?${new URLSearchParams({ stationId, from, to, ...filters, ...(asOf ? { asOf } : {}), ...(cursor ? { cursor } : {}) })}`
  );
}

export function loadStockHealth(
  stationId: string,
  ageDays: string,
  mode: string,
  search: string,
  cursor = "",
  snapshot = ""
): Promise<import("@shared/stock-health").StockHealthReport> {
  return request(
    `/market-accounting/reports/stock-health?${new URLSearchParams({ stationId, ageDays, mode, search, ...(cursor ? { cursor } : {}), ...(snapshot ? { snapshot } : {}) })}`
  );
}
export function loadMarginAlerts(
  stationId: string,
  from: string,
  to: string,
  thresholdBps: string,
  mode: string,
  cursor = "",
  asOf = ""
): Promise<import("@shared/stock-health").MarginReport> {
  return request(
    `/market-accounting/reports/margin-alerts?${new URLSearchParams({ stationId, from, to, thresholdBps, mode, ...(cursor ? { cursor } : {}), ...(asOf ? { asOf } : {}) })}`
  );
}

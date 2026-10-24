export type OrderStatus =
  | "DRAFT"
  | "APPROVED"
  | "PARTIAL"
  | "RECEIVED"
  | "CLOSED"
  | "CANCELLED";
export const orderStatusLabels: Record<OrderStatus, string> = {
  DRAFT: "Taslak",
  APPROVED: "Onaylı",
  PARTIAL: "Kısmi teslim",
  RECEIVED: "Tamamı teslim",
  CLOSED: "Kalanı kapatıldı",
  CANCELLED: "İptal",
};
export type OrderLine = {
  productId: string;
  name: string;
  barcode: string;
  unit: string;
  orderedQty: number;
  receivedQty: number;
  remainingQty: number;
  unitNetMinor: number;
  vatBps: number;
  lotTracking: boolean;
};
export type OrderSummary = {
  id: string;
  number: string;
  label: string;
  supplierId: string;
  supplierName: string;
  expectedDate: string;
  status: OrderStatus;
  version: number;
  orderedQty: number;
  receivedQty: number;
  remainingQty: number;
  remainingGrossMinor: number;
  overdue: boolean;
  createdAt: string;
  updatedAt: string;
};
export type OrderPage = { rows: OrderSummary[]; nextCursor: string | null };
export type OrderDetail = OrderSummary & {
  createdBy: string;
  approvedBy: string | null;
  lines: OrderLine[];
  receiptCount: number;
  receipts: {
    purchaseId: string;
    entryId: string;
    approvedVersion: number;
    reference: string;
    dueDate: string;
    totalMinor: number;
    receivedBy: string;
    createdAt: string;
    items: {
      productId: string;
      name: string;
      quantity: number;
      unitNetMinor: number;
      vatBps: number;
    }[];
  }[];
  events: {
    id: number;
    kind: string;
    actorName: string;
    createdAt: string;
    reason: string | null;
  }[];
};
export function orderTotals(
  lines: { quantity: number; unitNetMinor: number; vatBps: number }[]
) {
  let net = 0n,
    tax = 0n;
  for (const l of lines) {
    if (
      ![l.quantity, l.unitNetMinor, l.vatBps].every(
        n => Number.isSafeInteger(n) && n >= 0
      ) ||
      l.vatBps > 10000
    )
      throw Error("Sipariş adedi, net maliyeti veya KDV geçersiz.");
    const n = BigInt(l.quantity) * BigInt(l.unitNetMinor);
    net += n;
    tax += (n * BigInt(l.vatBps) + 5000n) / 10000n;
  }
  const gross = net + tax;
  if (gross > BigInt(Number.MAX_SAFE_INTEGER))
    throw Error("Sipariş tutarı güvenli kuruş sınırını aşıyor.");
  return {
    netMinor: Number(net),
    vatMinor: Number(tax),
    grossMinor: Number(gross),
  };
}

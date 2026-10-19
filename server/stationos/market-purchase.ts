import { randomUUID } from "node:crypto";
import { receiveLots } from "./lot-stock";
import type { MarketHandler } from "./market-route-types";
import { execute, first, rows } from "./db";
import type { Row } from "./market-pos";
import {
  requireId,
  requireString,
  requireInteger,
  requireMoney,
  isRecord,
} from "./domain";
import {
  calendarDate,
  integer,
  netTax,
  ratioRound,
  vatRate,
} from "./market-accounting-domain";
import {
  accountBalance,
  inventoryRow,
  ledgerEntry,
} from "./market-accounting-ledger";
import { safeAdd } from "./safety";
import { posLineTotal } from "./pos-domain";
import { fail } from "./types";
import type { PoolConnection } from "mysql2/promise";
import type { Scope } from "./market-pos";
async function party(
  c: PoolConnection,
  scope: Scope,
  station: string,
  value: unknown,
  side?: "CUSTOMER" | "SUPPLIER"
) {
  const p = await first<Row>(
    c,
    "SELECT * FROM st_market_parties WHERE id=? AND tenant_id=? AND station_id=?",
    [requireId(value, "partyId"), scope.tenantId, station]
  );
  if (!p || (side && p.kind !== side && p.kind !== "BOTH"))
    fail("NOT_FOUND", "Bu istasyonda uygun market carisi bulunamadı.", 404);
  return p;
}
async function document(
  c: PoolConnection,
  book: Row,
  partyId: string,
  entryId: string,
  kind: string,
  reference: string,
  due: string,
  total: number
) {
  if (!total) return;
  await execute(
    c,
    "INSERT INTO st_market_documents (id,tenant_id,station_id,party_id,entry_id,kind,reference,due_date,total_minor) VALUES (?,?,?,?,?,?,?,?,?)",
    [
      randomUUID(),
      book.tenant_id,
      book.station_id,
      partyId,
      entryId,
      kind,
      reference,
      due,
      total,
    ]
  );
}
export const recordMarketPurchase: MarketHandler = async (
  c,
  actor,
  body,
  scope,
  station,
  book
) => {
  const p = await party(c, scope, station, body.partyId, "SUPPLIER"),
    ref = requireString(body.reference, "Belge no", { max: 100 }),
    due = calendarDate(body.dueDate, "Vade");
  if (
    !Array.isArray(body.lines) ||
    body.lines.length < 1 ||
    body.lines.length > 100
  )
    fail("INVALID_INPUT", "Alış 1–100 ürün satırı içermelidir.");
  const seen = new Set<string>();
  let net = 0,
    tax = 0;
  const items = body.lines
    .map(x => {
      if (!isRecord(x)) fail("INVALID_INPUT", "Alış satırı geçersiz.");
      const id = requireId(x.productId, "productId"),
        qty = requireInteger(x.quantity, "quantity"),
        cost = requireMoney(x.unitNetMinor, "KDV hariç birim maliyet", {
          allowZero: true,
        }),
        vat = vatRate(x.vatBps);
      if (seen.has(id) || qty > 10000)
        fail(
          "INVALID_INPUT",
          "Ürün satırı tekrarlanamaz; adet en fazla 10.000 olmalıdır."
        );
      seen.add(id);
      const n = posLineTotal(cost, qty),
        t = netTax(n, vat);
      net = safeAdd(net, n);
      tax = safeAdd(tax, t);
      return {
        productId: id,
        quantity: qty,
        unitNetMinor: cost,
        vatBps: vat,
        netMinor: n,
        vatMinor: t,
        lots: x.lots,
      };
    })
    .sort((a, b) => a.productId.localeCompare(b.productId));
  const gross = safeAdd(net, tax);
  requireMoney(gross, "Alış toplamı");
  if (requireMoney(body.expectedTotalMinor, "Belge toplamı") !== gross)
    fail(
      "PURCHASE_TOTAL_CHANGED",
      "Belge toplamı hesaplanan satır toplamıyla uyuşmuyor.",
      409
    );
  const payable = -(await accountBalance(c, station, "PAYABLE", p.id));
  if (
    p.payable_limit_minor !== null &&
    safeAdd(payable, gross) > integer(p.payable_limit_minor)
  )
    fail("CREDIT_LIMIT", "Tedarikçi cari limiti yetersiz.", 409);
  const id = randomUUID();
  for (const l of items) {
    const product = await first<Row>(
      c,
      "SELECT * FROM st_products WHERE id=? AND tenant_id=? AND station_id=? FOR UPDATE",
      [l.productId, scope.tenantId, station]
    );
    if (!product) fail("NOT_FOUND", "Ürün bu istasyonda bulunamadı.", 404);
    await receiveLots(c, product, l.lots, l.quantity, id, actor.id);
    const inv = await inventoryRow(c, book!, product),
      qty = safeAdd(integer(inv.quantity), l.quantity),
      value = safeAdd(integer(inv.value_minor), l.netMinor);
    await execute(
      c,
      "UPDATE st_market_inventory SET quantity=?,value_minor=? WHERE product_id=?",
      [qty, value, l.productId]
    );
    await execute(
      c,
      "UPDATE st_products SET stock_qty=?,purchase_price_minor=?,stock_version=stock_version+1,last_purchase_net_minor=?,purchase_vat_bps=?,market_supplier_id=COALESCE(market_supplier_id,?) WHERE id=?",
      [
        qty,
        ratioRound(value, 1, qty),
        l.unitNetMinor,
        l.vatBps,
        p.id,
        l.productId,
      ]
    );
    await execute(
      c,
      "INSERT INTO st_stock_movements (id,tenant_id,station_id,product_id,kind,quantity,unit_price_minor,reference,created_by_user_id) VALUES (?,?,?,?,'RECEIPT',?,?,?,?)",
      [
        randomUUID(),
        scope.tenantId,
        station,
        l.productId,
        l.quantity,
        l.unitNetMinor,
        `MARKET:${id}`,
        actor.id,
      ]
    );
  }
  const entry = await ledgerEntry(
    c,
    book!,
    actor.id,
    "PURCHASE",
    id,
    "Mal kabul ve tedarikçi borcu",
    [
      { account: "INVENTORY", debit: net },
      { account: "INPUT_VAT", debit: tax },
      { account: "PAYABLE", partyId: p.id, credit: gross },
    ],
    { partyId: p.id, items, dueDate: due },
    ref
  );
  await document(c, book!, p.id, entry, "PURCHASE", ref, due, gross);
  return { id, totalMinor: gross };
};

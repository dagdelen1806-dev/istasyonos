import { randomUUID } from "node:crypto";
import type { PoolConnection } from "mysql2/promise";
import type { Row, Scope, Services } from "./market-pos";
import type { StationActor } from "./types";
import type { MarketAccount } from "../../shared/market-accounting";
import { first, rows, execute } from "./db";
import { fail } from "./types";
import { safeAdd } from "./safety";
import {
  balanced,
  businessToday,
  integer,
  stockCost,
  splitGross,
  plusDays,
  type LedgerLine,
} from "./market-accounting-domain";

export async function lockMarketBook(
  c: PoolConnection,
  tenant: string,
  station: string,
  allowClosed = false
): Promise<Row | null> {
  // All ledger/POS/legacy stock writers acquire station -> book -> register/product locks.
  await first(
    c,
    "SELECT id FROM st_stations WHERE id=? AND tenant_id=? FOR UPDATE",
    [station, tenant]
  );
  const book = await first<Row>(
    c,
    "SELECT * FROM st_market_books WHERE station_id=? AND tenant_id=? FOR UPDATE",
    [station, tenant]
  );
  if (
    book &&
    !allowClosed &&
    book.closed_through &&
    String(book.closed_through) >= businessToday()
  )
    fail(
      "MARKET_DAY_CLOSED",
      "Bugünün market gün sonu kapalı. Yeni mali kayıt sonraki gün açılır.",
      409
    );
  return book;
}
export async function accountBalance(
  c: PoolConnection,
  station: string,
  account: MarketAccount,
  partyId = "",
  registerId = ""
) {
  return integer(
    (
      await first<Row>(
        c,
        "SELECT balance_minor FROM st_market_balances WHERE station_id=? AND account_code=? AND party_key=? AND register_key=?",
        [station, account, partyId, registerId]
      )
    )?.balance_minor
  );
}
export async function ledgerEntry(
  c: PoolConnection,
  book: Row,
  actor: number,
  kind: string,
  sourceId: string,
  description: string,
  lines: LedgerLine[],
  payload: unknown = {},
  reference: string | null = null,
  externalKey: string | null = null
) {
  const clean = balanced(lines),
    id = randomUUID();
  await execute(
    c,
    "INSERT INTO st_market_entries (id,tenant_id,station_id,business_date,kind,source_id,reference,external_key,description,actor_user_id,payload_json) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
    [
      id,
      book.tenant_id,
      book.station_id,
      businessToday(),
      kind,
      sourceId,
      reference,
      externalKey,
      description,
      actor,
      JSON.stringify(payload),
    ]
  );
  for (const l of clean) {
    const debit = l.debit ?? 0,
      credit = l.credit ?? 0,
      party = l.partyId ?? "",
      register = l.registerId ?? "";
    const balance = safeAdd(
      await accountBalance(c, book.station_id, l.account, party, register),
      debit,
      -credit
    );
    await execute(
      c,
      "INSERT INTO st_market_lines (entry_id,account_code,party_id,register_id,debit_minor,credit_minor) VALUES (?,?,?,?,?,?)",
      [id, l.account, l.partyId ?? null, l.registerId ?? null, debit, credit]
    );
    await execute(
      c,
      "INSERT INTO st_market_balances (station_id,account_code,party_key,register_key,balance_minor) VALUES (?,?,?,?,?) ON DUPLICATE KEY UPDATE balance_minor=VALUES(balance_minor)",
      [book.station_id, l.account, party, register, balance]
    );
  }
  await execute(
    c,
    "UPDATE st_market_books SET revision=revision+1 WHERE station_id=?",
    [book.station_id]
  );
  book.revision = integer(book.revision) + 1;
  return id;
}
export async function inventoryRow(c: PoolConnection, book: Row, product: Row) {
  let inv = await first<Row>(
    c,
    "SELECT * FROM st_market_inventory WHERE product_id=? AND station_id=? FOR UPDATE",
    [product.id, book.station_id]
  );
  if (!inv && integer(product.stock_qty) === 0) {
    await execute(
      c,
      "INSERT INTO st_market_inventory(product_id,station_id,quantity,value_minor) VALUES (?,?,0,0)",
      [product.id, book.station_id]
    );
    inv = (await first<Row>(
      c,
      "SELECT * FROM st_market_inventory WHERE product_id=?",
      [product.id]
    ))!;
  }
  if (!inv || integer(inv.quantity) !== integer(product.stock_qty))
    fail(
      "MARKET_STOCK_MISMATCH",
      "Ürün adedi ile maliyet defteri uyuşmuyor. Kayıt yapılmadı; stok mutabakatını kontrol edin.",
      409
    );
  return inv;
}
export async function marketRegisterOpen(
  c: PoolConnection,
  book: Row | null,
  actor: number,
  sessionId: string,
  registerId: string,
  float: number
) {
  if (!book) return;
  if ((await accountBalance(c, book.station_id, "CASH_SAFE")) < float)
    fail(
      "INSUFFICIENT_BALANCE",
      "Açılış para üstü için merkez kasa bakiyesi yetersiz.",
      409
    );
  await ledgerEntry(
    c,
    book,
    actor,
    "REGISTER_OPEN",
    sessionId,
    "Satış kasasına açılış para üstü",
    [
      { account: "CASH_DRAWER", registerId, debit: float },
      { account: "CASH_SAFE", credit: float },
    ],
    { sessionId, registerId, float }
  );
}
export async function marketRegisterClose(
  c: PoolConnection,
  book: Row | null,
  actor: number,
  session: Row,
  expected: number,
  counted: number,
  note: string | null,
  cashTransferred: unknown
) {
  if (!book) return;
  if (cashTransferred !== true)
    fail(
      "CASH_TRANSFER_CONFIRMATION",
      "Sayılan nakdin merkez kasaya devrini teyit edin.",
      409
    );
  const drawer = await accountBalance(
    c,
    book.station_id,
    "CASH_DRAWER",
    "",
    session.register_id
  );
  if (drawer !== expected)
    fail(
      "MARKET_CASH_MISMATCH",
      "Satış kasası ile muhasebe çekmecesi uyuşmuyor.",
      409
    );
  const diff = safeAdd(counted, -expected);
  await ledgerEntry(
    c,
    book,
    actor,
    "REGISTER_CLOSE",
    session.id,
    "Satış kasası kapanışı ve merkez kasaya devir",
    [
      { account: "CASH_SAFE", debit: counted },
      {
        account: "CASH_DRAWER",
        registerId: session.register_id,
        credit: expected,
      },
      { account: "CASH_LOSS", debit: diff < 0 ? -diff : 0 },
      { account: "CASH_GAIN", credit: diff > 0 ? diff : 0 },
    ],
    { sessionId: session.id, expected, counted, difference: diff, note }
  );
}
export async function marketCustomers(
  c: PoolConnection,
  tenant: string,
  station: string
) {
  const p = await rows<Row[]>(
    c,
    "SELECT p.id,p.name,p.receivable_limit_minor,COALESCE(b.balance_minor,0) AS balance FROM st_market_parties p LEFT JOIN st_market_balances b ON b.station_id=p.station_id AND b.account_code='RECEIVABLE' AND b.party_key=p.id AND b.register_key='' WHERE p.tenant_id=? AND p.station_id=? AND p.kind IN ('CUSTOMER','BOTH') ORDER BY p.name LIMIT 5000",
    [tenant, station]
  );
  return p.map(r => ({
    id: r.id,
    name: r.name,
    balanceMinor: integer(r.balance),
    availableCreditMinor: Math.max(
      0,
      safeAdd(integer(r.receivable_limit_minor), -integer(r.balance))
    ),
  }));
}
export async function marketSale(
  c: PoolConnection,
  book: Row | null,
  actor: StationActor,
  saleId: string,
  session: Row,
  payment: {
    cashAmountMinor: number;
    cardAmountMinor: number;
    receivableAmountMinor: number;
  },
  customerPartyId: string | null,
  items: {
    productId: string;
    quantity: number;
    expectedUnitPriceMinor: number;
    lineTotal: number;
  }[]
) {
  if (!book) {
    if (payment.receivableAmountMinor)
      fail(
        "MARKET_ACCOUNTING_REQUIRED",
        "Veresiye için market muhasebesini başlatın.",
        409
      );
    return;
  }
  let party: Row | null = null;
  if (payment.receivableAmountMinor) {
    party = await first<Row>(
      c,
      "SELECT * FROM st_market_parties WHERE id=? AND tenant_id=? AND station_id=? AND kind IN ('CUSTOMER','BOTH')",
      [customerPartyId, book.tenant_id, book.station_id]
    );
    if (!party) fail("NOT_FOUND", "Market müşteri carisi bulunamadı.", 404);
    const balance = await accountBalance(
      c,
      book.station_id,
      "RECEIVABLE",
      party.id
    );
    if (
      safeAdd(balance, payment.receivableAmountMinor) >
      integer(party.receivable_limit_minor)
    )
      fail("CREDIT_LIMIT", "Müşteri veresiye limiti yetersiz.", 409);
  }
  let net = 0,
    vat = 0,
    cost = 0;
  const snapshots = [];
  for (const l of items) {
    const p = (await first<Row>(
      c,
      "SELECT * FROM st_products WHERE id=? AND tenant_id=? AND station_id=? FOR UPDATE",
      [l.productId, book.tenant_id, book.station_id]
    ))!;
    if (p.market_vat_bps === null)
      fail(
        "PRODUCT_VAT_REQUIRED",
        `${p.name}: KDV oranını Market muhasebesi / Stok ekranında tanımlayın.`,
        409
      );
    // POS already decremented physical stock in this same transaction.
    const inv = await inventoryRow(c, book, {
      ...p,
      stock_qty: safeAdd(integer(p.stock_qty), l.quantity),
    } as Row);
    const lineCost = stockCost(
        integer(inv.value_minor),
        integer(inv.quantity),
        l.quantity
      ),
      tax = splitGross(l.lineTotal, integer(p.market_vat_bps));
    cost = safeAdd(cost, lineCost);
    net = safeAdd(net, tax.net);
    vat = safeAdd(vat, tax.vat);
    await execute(
      c,
      "UPDATE st_market_inventory SET quantity=quantity-?,value_minor=value_minor-? WHERE product_id=?",
      [l.quantity, lineCost, p.id]
    );
    await execute(
      c,
      "UPDATE st_pos_sale_lines SET net_total_minor=?,vat_minor=?,cost_total_minor=? WHERE sale_id=? AND product_id=?",
      [tax.net, tax.vat, lineCost, saleId, p.id]
    );
    snapshots.push({
      productId: p.id,
      name: p.name,
      quantity: l.quantity,
      grossMinor: l.lineTotal,
      netMinor: tax.net,
      vatMinor: tax.vat,
      vatBps: integer(p.market_vat_bps),
      costMinor: lineCost,
    });
  }
  const entry = await ledgerEntry(
    c,
    book,
    actor.id,
    "POS_SALE",
    saleId,
    "Market kasa satışı",
    [
      {
        account: "CASH_DRAWER",
        registerId: session.register_id,
        debit: payment.cashAmountMinor,
      },
      { account: "CARD_CLEARING", debit: payment.cardAmountMinor },
      {
        account: "RECEIVABLE",
        partyId: party?.id,
        debit: payment.receivableAmountMinor,
      },
      { account: "SALES", credit: net },
      { account: "OUTPUT_VAT", credit: vat },
      { account: "COGS", debit: cost },
      { account: "INVENTORY", credit: cost },
    ],
    {
      saleId,
      sessionId: session.id,
      registerId: session.register_id,
      items: snapshots,
      payment,
    },
    `POS-DEMO:${saleId}`
  );
  if (party)
    await execute(
      c,
      "INSERT INTO st_market_documents (id,tenant_id,station_id,party_id,entry_id,kind,reference,due_date,total_minor) VALUES (?,?,?,?,?,'CREDIT_SALE',?,?,?)",
      [
        randomUUID(),
        book.tenant_id,
        book.station_id,
        party.id,
        entry,
        `POS:${saleId}`,
        plusDays(businessToday(), integer(party.term_days)),
        payment.receivableAmountMinor,
      ]
    );
}

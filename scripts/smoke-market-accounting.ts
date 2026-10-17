import { strict as assert } from "node:assert";
import { randomUUID, randomBytes } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import mysql from "mysql2/promise";
import { payloadHash } from "../server/stationos/domain";
if (process.env.SMOKE_TEST !== "1")
  throw Error("Explicit opt-in required; synthetic DEMO writes only.");
const base = process.env.SMOKE_BASE_URL ?? "http://127.0.0.1:3303";
if (!["localhost", "127.0.0.1"].includes(new URL(base).hostname))
  throw Error("Local server required");
const db = new URL(process.env.DATABASE_URL ?? "");
if (
  db.pathname !== "/istasyonos_pos_v2_test" ||
  db.searchParams.get("socketPath") !== "/workspace/local-mysql/mysql.sock"
)
  throw Error("Exact isolated test DB required");
type Actor = {
  cookie: string;
  csrf: string;
  device: string;
  email: string;
  password: string;
};
async function http(path: string, a?: Actor, body?: Record<string, unknown>) {
  const r = await fetch(base + path, {
    method: body ? "POST" : "GET",
    headers: {
      "Content-Type": "application/json",
      "X-Stationos-Request": "1",
      Origin: base,
      ...(a
        ? {
            Cookie: a.cookie,
            "X-CSRF-Token": a.csrf,
            "X-Stationos-Device-Id": a.device,
          }
        : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return {
    status: r.status,
    data: await r.json(),
    cookie: r.headers.get("set-cookie")?.split(";")[0] ?? "",
  };
}
async function auth(label: string) {
  const a: Actor = {
    cookie: "",
    csrf: "",
    device: randomUUID(),
    email: `market-${randomUUID()}@example.invalid`,
    password: randomBytes(24).toString("hex"),
  };
  const r = await http("/api/auth/register", undefined, {
    email: a.email,
    password: a.password,
    name: `DEMO ${label}`,
  });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  a.cookie = r.cookie;
  a.csrf = (await http("/api/stationos/state", a)).data.csrfToken;
  return a;
}
const owner = await auth("market sahibi"),
  manager = await auth("market yöneticisi"),
  staff = await auth("market personeli"),
  outsider = await auth("dış kullanıcı");
async function raw(
  path: string,
  a = owner,
  body?: Record<string, unknown>,
  expected = 200
) {
  const r = await http("/api/stationos" + path, a, body);
  assert.equal(r.status, expected, `${path}: ${JSON.stringify(r.data)}`);
  return r.data;
}
const station = (
  await raw("/setup", owner, {
    requestId: randomUUID(),
    companyName: `DEMO market muhasebe ${randomUUID().slice(0, 8)}`,
    stationName: "DEMO Muhasebe Market",
    stationCode: randomUUID().slice(0, 8),
    isDemo: true,
  })
).result.stationId;
const post = (
  path: string,
  body: Record<string, unknown>,
  expected = 200,
  a = owner
) =>
  raw(
    path,
    a,
    { stationId: station, requestId: randomUUID(), ...body },
    expected
  ).then(d => d.result ?? d);
const state = () => raw("/market-accounting?stationId=" + station);
const pos = () => raw("/pos?stationId=" + station);
const invite = (
  await raw("/invite", owner, {
    requestId: randomUUID(),
    role: "MARKET_STAFF",
    stationIds: [station],
  })
).result.code;
await raw("/join", staff, { requestId: randomUUID(), code: invite });
const managerInvite = (
  await raw("/invite", owner, {
    requestId: randomUUID(),
    role: "MANAGER",
    stationIds: [station],
  })
).result.code;
await raw("/join", manager, { requestId: randomUUID(), code: managerInvite });

await raw("/market-accounting?stationId=" + station, outsider, undefined, 403);
await raw("/market-accounting?stationId=" + station, staff, undefined, 403);
const p = (
  await post("/product", {
    name: "DEMO muhasebe ürünü",
    barcode: randomUUID().slice(0, 12),
    minimumQty: 2,
    purchasePriceMinor: 400,
    salePriceMinor: 1200,
    supplierId: null,
  })
).id;
await post("/stock", { productId: p, kind: "RECEIPT", quantity: 10 });
const register = (
  await post("/pos/register", { name: "DEMO ortak kasa", code: "KASA-1" })
).id;
const oldSession = (
  await post("/pos/open", { registerId: register, openingFloatMinor: 0 })
).id;
const opening = {
  openingStockAccepted: true,
  cashMinor: 10000,
  bankMinor: 20000,
  cardMinor: 0,
  expectedInventoryMinor: 4000,
};
await post("/market-accounting/start", opening, 409);
await post("/pos/close", { sessionId: oldSession, countedCashMinor: 0 });
await post(
  "/market-accounting/start",
  { ...opening, expectedInventoryMinor: 3999 },
  409
);
const openingRequest = {
  stationId: station,
  requestId: randomUUID(),
  ...opening,
};
const opened = await raw("/market-accounting/start", owner, openingRequest);
assert.deepEqual(
  await raw("/market-accounting/start", owner, openingRequest),
  opened
);
let s = await state();
assert.equal(s.enabled, true);
assert.equal(s.stockValueMinor, 4000);
assert.equal(s.balances.CASH_SAFE, 10000);
assert.equal(s.balances.BANK, 20000);
assert.equal(s.trialDifferenceMinor, 0);
assert.equal(s.daily.salesGrossMinor, 0);
await raw("/market-accounting?stationId=" + station, manager);
await post(
  "/market-accounting/expense",
  {
    netMinor: 1,
    vatBps: 0,
    wallet: "CASH_SAFE",
    description: "DEMO yönetici ödeme yetkisi",
  },
  403,
  manager
);

await post("/stock", { productId: p, kind: "RECEIPT", quantity: 1 }, 409);
await post(
  "/payable",
  { supplierId: randomUUID(), amountMinor: 1, dueDate: s.today },
  409
);
const supplier = (
  await post("/market-accounting/party", {
    name: "DEMO Toptancı",
    kind: "SUPPLIER",
    receivableLimitMinor: 0,
    payableLimitMinor: 100000,
    termDays: 30,
  })
).id;
const customer = (
  await post("/market-accounting/party", {
    name: "DEMO Veresiye Müşteri",
    kind: "CUSTOMER",
    receivableLimitMinor: 10000,
    termDays: 7,
  })
).id;
const limited = (
  await post("/market-accounting/party", {
    name: "DEMO Limitli Müşteri",
    kind: "CUSTOMER",
    receivableLimitMinor: 500,
    termDays: 0,
  })
).id;
const purchase = {
  partyId: supplier,
  reference: "DEMO-ALIS-001",
  dueDate: s.today,
  lines: [{ productId: p, quantity: 10, unitNetMinor: 600, vatBps: 2000 }],
  expectedTotalMinor: 7200,
};
await post("/market-accounting/purchase", purchase);
await post("/market-accounting/purchase", purchase, 409);
s = await state();
assert.equal(s.stock.find((x: any) => x.id === p).quantity, 20);
assert.equal(s.stockValueMinor, 10000);
assert.equal(s.parties.find((x: any) => x.id === supplier).payableMinor, 7200);
const session = (
  await post("/pos/open", { registerId: register, openingFloatMinor: 1000 })
).id;
const checkout = (qty: number, extra: Record<string, unknown> = {}) => ({
  sessionId: session,
  lines: [{ productId: p, quantity: qty, expectedUnitPriceMinor: 1200 }],
  paymentKind: "CASH",
  tenderedMinor: 5000,
  ...extra,
});
await post("/pos/checkout", checkout(3), 409);
assert.equal((await state()).stock.find((x: any) => x.id === p).quantity, 20);
await post("/market-accounting/product", {
  productId: p,
  vatBps: 2000,
  salePriceMinor: 1200,
});
const saleRequest = {
  stationId: station,
  requestId: randomUUID(),
  ...checkout(3),
};
const sale = await raw("/pos/checkout", owner, saleRequest);
assert.deepEqual(await raw("/pos/checkout", owner, saleRequest), sale);
await post(
  "/pos/checkout",
  checkout(1, { paymentKind: "ON_ACCOUNT", customerPartyId: limited }),
  409
);
await post(
  "/pos/checkout",
  checkout(2, { paymentKind: "ON_ACCOUNT", customerPartyId: customer })
);
await post(
  "/pos/checkout",
  checkout(1, {
    paymentKind: "MIXED",
    cashAmountMinor: 500,
    tenderedMinor: 1000,
    cardConfirmed: true,
  })
);
s = await state();
assert.equal(s.stockValueMinor, 7000);
assert.equal(s.daily.salesGrossMinor, 7200);
assert.equal(s.daily.salesNetMinor, 6000);
assert.equal(s.daily.outputVatMinor, 1200);
assert.equal(s.daily.cogsMinor, 3000);
assert.equal(s.daily.grossProfitMinor, 3000);
assert.equal(
  s.parties.find((x: any) => x.id === customer).receivableMinor,
  2400
);
assert.equal(
  (await pos()).sessions.find((x: any) => x.id === session)
    .receivableSalesMinor,
  2400
);
const pay = await post("/market-accounting/settlement", {
  partyId: supplier,
  direction: "PAYMENT",
  amountMinor: 3000,
  wallet: "BANK",
  description: "DEMO kısmi tedarikçi ödemesi",
});
await post(
  "/market-accounting/settlement",
  {
    partyId: supplier,
    direction: "PAYMENT",
    amountMinor: 4201,
    wallet: "BANK",
    description: "DEMO aşırı ödeme",
  },
  409
);
const collections = await Promise.all(
  [1, 2].map(() =>
    http("/api/stationos/market-accounting/settlement", owner, {
      stationId: station,
      requestId: randomUUID(),
      partyId: customer,
      direction: "COLLECTION",
      amountMinor: 1800,
      wallet: "CASH_SAFE",
      description: "DEMO eşzamanlı tahsilat",
    })
  )
);
assert.deepEqual(collections.map(r => r.status).sort(), [200, 409]);
await post("/market-accounting/expense", {
  netMinor: 1000,
  vatBps: 2000,
  wallet: "CASH_SAFE",
  description: "DEMO market gideri",
  reference: "GIDER-001",
});
await post("/market-accounting/bank-settlement", {
  grossMinor: 700,
  feeMinor: 70,
  reference: "DEMO-BANKA-001",
});
const cap = await post("/market-accounting/capital", {
  wallet: "CASH_SAFE",
  amountMinor: 1000,
  description: "DEMO sermaye girişi",
});
await post("/market-accounting/reverse", {
  entryId: cap.id,
  reason: "DEMO sermaye kayıt düzeltmesi",
});
await post(
  "/market-accounting/reverse",
  { entryId: cap.id, reason: "DEMO mükerrer ters kayıt" },
  409
);
const transfer = await post("/market-accounting/transfer", {
  from: "BANK",
  amountMinor: 2000,
  description: "DEMO kasaya banka transferi",
});
await post("/market-accounting/reverse", {
  entryId: transfer.id,
  reason: "DEMO transfer düzeltmesi",
});
await post("/market-accounting/reverse", {
  entryId: pay.id,
  reason: "DEMO tedarikçi ödeme düzeltmesi",
});
s = await state();
assert.equal(s.parties.find((x: any) => x.id === supplier).payableMinor, 7200);
assert.equal(
  s.documents.find((x: any) => x.kind === "PURCHASE").settledMinor,
  0
);
await post("/market-accounting/settlement", {
  partyId: supplier,
  direction: "PAYMENT",
  amountMinor: 3000,
  wallet: "BANK",
  description: "DEMO düzeltilmiş kısmi ödeme",
});
await post("/market-accounting/stock-adjust", {
  productId: p,
  countedQty: 13,
  expectedQty: 14,
  description: "DEMO bir adet stok sayım eksiği",
});
await post("/market-accounting/party", {
  name: "DEMO Açılışlı Cari",
  kind: "BOTH",
  receivableLimitMinor: 1000,
  openingReceivableMinor: 500,
  openingPayableMinor: 300,
  openingNote: "DEMO onaylı açılış bakiyeleri",
});
s = await state();
assert.equal(s.stockValueMinor, 6500);
assert.equal(s.balances.CASH_SAFE, 9600);
assert.equal(s.balances.BANK, 17630);
assert.equal(s.balances.CARD_CLEARING, 0);
assert.equal(s.daily.operatingResultMinor, 1430);
assert.equal(s.daily.collectionsMinor, 1800);
assert.equal(s.daily.supplierPaymentsMinor, 3000);
assert.equal(s.daily.salesGrossMinor, 7200);
assert.equal(s.trialDifferenceMinor, 0);
await post(
  "/market-accounting/day-close",
  { expectedRevision: s.revision, countedCashMinor: 9600 },
  409
);
await post(
  "/pos/close",
  {
    sessionId: session,
    countedCashMinor: 5000,
    note: "DEMO bir lira kasa eksiği",
  },
  409
);
await post("/pos/close", {
  sessionId: session,
  countedCashMinor: 5000,
  note: "DEMO bir lira kasa eksiği",
  cashTransferred: true,
});
s = await state();
assert.equal(s.balances.CASH_SAFE, 14600);
assert.equal(s.balances.CASH_DRAWER, 0);
assert.equal(s.daily.operatingResultMinor, 1330);
const statement = await raw(
  `/market-accounting/statement?stationId=${station}&partyId=${customer}&from=${s.today}&to=${s.today}`
);
assert.equal(statement.closingReceivableMinor, 600);
assert.equal(statement.rows.at(-1).receivableBalanceMinor, 600);
const tail = await raw(
  `/market-accounting/statement?stationId=${station}&partyId=${customer}&from=${s.today}&to=${s.today}&cursor=${statement.rows[0].number}`
);
assert.equal(tail.openingReceivableMinor, 2400);
assert.equal(tail.rows.at(-1).receivableBalanceMinor, 600);
await raw(
  `/market-accounting/statement?stationId=${station}&partyId=${customer}`,
  outsider,
  undefined,
  403
);
await raw(
  `/market-accounting/statement?stationId=${station}&partyId=${randomUUID()}`,
  owner,
  undefined,
  404
);
const stale = s.revision;
await post("/market-accounting/expense", {
  netMinor: 50,
  vatBps: 0,
  wallet: "CASH_SAFE",
  description: "DEMO kapanış öncesi son gider",
});
await post(
  "/market-accounting/day-close",
  { expectedRevision: stale, countedCashMinor: 14550 },
  409
);
s = await state();
await post(
  "/market-accounting/day-close",
  { expectedRevision: s.revision, countedCashMinor: 14575 },
  409
);
const closeBody = {
  stationId: station,
  requestId: randomUUID(),
  expectedRevision: s.revision,
  countedCashMinor: 14575,
  note: "DEMO yirmi beş kuruş sayım fazlası",
};
const close = await raw("/market-accounting/day-close", owner, closeBody);
assert.deepEqual(
  await raw("/market-accounting/day-close", owner, closeBody),
  close
);
s = await state();
assert.equal(s.closedToday, true);
assert.equal(s.balances.CASH_SAFE, 14575);
assert.equal(s.daily.operatingResultMinor, 1305);
assert.equal(s.closes[0].hash, payloadHash(s.closes[0].snapshot));
assert.equal(s.trialDifferenceMinor, 0);
await post("/pos/open", { registerId: register, openingFloatMinor: 0 }, 409);
await post(
  "/market-accounting/expense",
  {
    netMinor: 1,
    vatBps: 0,
    wallet: "CASH_SAFE",
    description: "DEMO kapalı gün denemesi",
  },
  409
);
assert.deepEqual(await raw("/pos/checkout", owner, saleRequest), sale);
const sql = await mysql.createConnection({ uri: db.toString() });
const [rows]: any = await sql.query(
  "SELECT e.id,SUM(l.debit_minor-l.credit_minor) AS difference FROM st_market_entries e LEFT JOIN st_market_lines l ON l.entry_id=e.id WHERE e.station_id=? GROUP BY e.id",
  [station]
);
assert.ok(rows.every((r: any) => Number(r.difference ?? 0) === 0));
const [mismatch]: any = await sql.query(
  "SELECT p.id FROM st_products p JOIN st_market_inventory i ON i.product_id=p.id WHERE p.station_id=? AND p.stock_qty<>i.quantity",
  [station]
);
assert.equal(mismatch.length, 0);
const [cache]: any = await sql.query(
  "SELECT l.account_code,SUM(l.debit_minor-l.credit_minor) AS n FROM st_market_lines l JOIN st_market_entries e ON e.id=l.entry_id WHERE e.station_id=? GROUP BY l.account_code",
  [station]
);
for (const row of cache)
  assert.equal(Number(row.n), s.balances[row.account_code]);
await sql.end();
const out = process.env.SMOKE_OUTPUT_DIR ?? "/workspace/market-accounting-test";
await mkdir(out, { recursive: true, mode: 0o700 });
await writeFile(
  out + "/fixture.json",
  JSON.stringify(
    {
      owner,
      staff,
      outsider,
      station,
      product: p,
      supplier,
      customer,
      register,
      session,
      closingId: close.result.id,
    },
    null,
    2
  ),
  { mode: 0o600 }
);
const checks = [
  "Rol, tenant, açık kasa ve açılış önizleme sınırları",
  "Açılış gelir sayılmadı; eski stok/borç yolları mali defteri atlayamadı",
  "Alış aynı transaction içinde stok, maliyet, KDV ve cari borcu oluşturdu",
  "Tekrarlanan alış belgesi stok/cariyi ikinci kez artırmadı",
  "KDV tanımsız ve limit aşan satış tamamen geri alındı",
  "Nakit, karma ve veresiye POS satışları tek kayıtla stok/maliyet/vergi/deftere geçti",
  "Ağırlıklı maliyet ve kuruş tutarları doğru",
  "Kısmi ödeme ve eşzamanlı aşırı tahsilat koruması",
  "Kart alacağı banka bakiyesinden ayrı; komisyon kaydı",
  "Gider, sermaye ve transfer satış geliri sayılmadı",
  "Ters kayıtta para ve belge ödeme dağılımı geri alındı; ikinci ters kayıt reddedildi",
  "Sayım eksiği ve kasa devir farkı faaliyet sonucuna yansıdı",
  "Gün sonu açık kasa/eski önizleme/açıklamasız farkı reddetti",
  "Gün sonu hash anlık görüntüsü ve kapalı güne kayıt engeli",
  "Her mali fiş dengeli; bakiye önbelleği, stok adedi ve maliyet defteri eşleşti",
  "Tarih aralıklı cari ekstre, sayfa başı bakiye ve tenant sınırı",
];
await writeFile(
  out + "/result.json",
  JSON.stringify({ ok: true, checks }, null, 2)
);
console.log(JSON.stringify({ ok: true, checks }, null, 2));

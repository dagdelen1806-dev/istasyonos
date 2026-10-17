import { strict as assert } from "node:assert";
import { randomUUID, randomBytes } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import mysql from "mysql2/promise";
import { returnAmounts } from "../shared/market-return-math";
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
    companyName: `DEMO iade testi ${randomUUID().slice(0, 8)}`,
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
const accountant = await auth("iade muhasebecisi");
const accountantInvite = (
  await post("/invite", { role: "ACCOUNTANT", stationIds: [station] })
).code;
await raw("/join", accountant, {
  requestId: randomUUID(),
  code: accountantInvite,
});

const getSource = (id: string, a = owner, status = 200) =>
  raw(
    `/market-accounting/return-source?stationId=${station}&entryId=${id}`,
    a,
    undefined,
    status
  );
async function sourceId(kind: "POS_SALE" | "PURCHASE", query: string) {
  const found = await raw(
    `/market-accounting/return-sources?${new URLSearchParams({ stationId: station, kind, q: query })}`
  );
  assert.equal(found.rows.length, 1);
  return found.rows[0].id as string;
}
const p = (
  await post("/product", {
    name: "DEMO iadeli ürün",
    barcode: randomUUID().slice(0, 12),
    minimumQty: 0,
    purchasePriceMinor: 0,
    salePriceMinor: 1200,
    supplierId: null,
  })
).id;
const tiny = (
  await post("/product", {
    name: "DEMO kuruş ürünü",
    barcode: randomUUID().slice(0, 12),
    minimumQty: 0,
    purchasePriceMinor: 0,
    salePriceMinor: 1,
    supplierId: null,
  })
).id;
await post("/market-accounting/start", {
  openingStockAccepted: true,
  expectedInventoryMinor: 0,
  cashMinor: 100000,
  bankMinor: 100000,
  cardMinor: 0,
});
for (const [productId, vatBps, salePriceMinor] of [
  [p, 2000, 1200],
  [tiny, 10000, 1],
])
  await post("/market-accounting/product", {
    productId,
    vatBps,
    salePriceMinor,
  });
const supplier = (
  await post("/market-accounting/party", {
    name: "DEMO iade tedarikçisi",
    kind: "SUPPLIER",
    receivableLimitMinor: 0,
    payableLimitMinor: null,
    termDays: 0,
  })
).id;
const customer = (
  await post("/market-accounting/party", {
    name: "DEMO iade müşterisi",
    kind: "CUSTOMER",
    receivableLimitMinor: 20000,
    termDays: 0,
  })
).id;
const today = (await state()).today;
async function purchase(
  reference: string,
  quantity: number,
  unitNetMinor: number,
  productId = p,
  vatBps = 2000
) {
  await post("/market-accounting/purchase", {
    partyId: supplier,
    reference,
    dueDate: today,
    lines: [{ productId, quantity, unitNetMinor, vatBps }],
    expectedTotalMinor:
      quantity * unitNetMinor +
      Math.round((quantity * unitNetMinor * vatBps) / 10000),
  });
  return sourceId("PURCHASE", reference);
}
const purchaseA = await purchase("DEMO-RETURN-PURCHASE-A", 10, 500);
const purchaseB = await purchase("DEMO-RETURN-PURCHASE-B", 10, 900);
const purchaseTiny = await purchase(
  "DEMO-RETURN-PURCHASE-TINY",
  3,
  1,
  tiny,
  10000
);
const payA = await post("/market-accounting/settlement", {
  partyId: supplier,
  direction: "PAYMENT",
  wallet: "BANK",
  amountMinor: 6000,
  description: "DEMO ilk alışın ödemesi",
});
const payB = await post("/market-accounting/settlement", {
  partyId: supplier,
  direction: "PAYMENT",
  wallet: "BANK",
  amountMinor: 5000,
  description: "DEMO kısmi alış ödemesi",
});
// Equal due dates are FIFO by creation time. Assert the fixture's actual allocation.
assert.equal((await getSource(purchaseA)).openDocumentMinor, 0);
assert.equal((await getSource(purchaseB)).openDocumentMinor, 5800);
const register = (
  await post("/pos/register", { name: "DEMO iade kasası", code: "IADE" })
).id;
const session = (
  await post("/pos/open", { registerId: register, openingFloatMinor: 1000 })
).id;
async function sell(
  quantity: number,
  extra: Record<string, unknown> = {},
  productId = p,
  price = 1200
) {
  const sale = await post("/pos/checkout", {
    sessionId: session,
    lines: [{ productId, quantity, expectedUnitPriceMinor: price }],
    paymentKind: "CASH",
    tenderedMinor: 10000,
    ...extra,
  });
  return sourceId("POS_SALE", sale.id);
}
const cashSale = await sell(3),
  cardSale = await sell(1, { paymentKind: "CARD_MANUAL", cardConfirmed: true });
const creditSale = await sell(4, {
  paymentKind: "ON_ACCOUNT",
  customerPartyId: customer,
});
const collection = await post("/market-accounting/settlement", {
  partyId: customer,
  direction: "COLLECTION",
  wallet: "CASH_SAFE",
  amountMinor: 3000,
  description: "DEMO iade öncesi kısmi tahsilat",
});
async function returnBody(
  id: string,
  quantity: number,
  extra: Record<string, unknown> = {},
  productId = p
) {
  const s = await getSource(id),
    item = s.items.find((l: any) => l.productId === productId);
  const amount = returnAmounts(
    item,
    {
      quantity: item.returnedQuantity,
      grossMinor: item.returnedGrossMinor,
      netMinor: item.returnedNetMinor,
    },
    quantity
  );
  const cost =
    s.kind === "POS_SALE"
      ? Math.round(
          (item.costMinor * (item.returnedQuantity + quantity)) / item.quantity
        ) - item.returnedCostMinor
      : Math.round((item.stockValueMinor * quantity) / item.stockQuantity);
  return {
    stationId: station,
    requestId: randomUUID(),
    sourceEntryId: id,
    expectedRevision: s.revision,
    reference: "DEMO-I-" + randomUUID().slice(0, 8),
    reason: "DEMO kaynak belgeli iade",
    lines: [{ productId, quantity }],
    expectedTotalMinor: amount.grossMinor,
    expectedCreditedMinor: Math.min(amount.grossMinor, s.openDocumentMinor),
    expectedCostMinor: cost,
    wallet: "CASH_SAFE",
    moneyConfirmed: true,
    ...extra,
  };
}
const sendReturn = (
  body: Record<string, unknown>,
  expected = 200,
  actor = owner
) => raw("/market-accounting/return", actor, body, expected);
await raw(
  `/market-accounting/return-sources?stationId=${station}&kind=POS_SALE`,
  staff,
  undefined,
  403
);
await raw(
  `/market-accounting/return-sources?stationId=${station}&kind=POS_SALE`,
  outsider,
  undefined,
  403
);
await getSource(cashSale, staff, 403);
await getSource(cashSale, outsider, 403);
await getSource(randomUUID(), owner, 404);
const foreignStation = (
  await raw("/setup", outsider, {
    requestId: randomUUID(),
    companyName: "DEMO başka iade firması",
    stationName: "DEMO yabancı market",
    stationCode: randomUUID().slice(0, 8),
    isDemo: true,
  })
).result.stationId;
await raw("/market-accounting/start", outsider, {
  stationId: foreignStation,
  requestId: randomUUID(),
  openingStockAccepted: true,
  expectedInventoryMinor: 0,
  cashMinor: 0,
  bankMinor: 0,
  cardMinor: 0,
});
await raw(
  `/market-accounting/return-source?stationId=${foreignStation}&entryId=${cashSale}`,
  outsider,
  undefined,
  404
);
const denied = await returnBody(creditSale, 1);
await sendReturn(denied, 403, manager);
await sendReturn(denied, 403, staff);
await sendReturn(
  { ...denied, lines: [{ productId: randomUUID(), quantity: 1 }] },
  404
);
await sendReturn(
  {
    ...denied,
    lines: [
      { productId: p, quantity: 1 },
      { productId: p, quantity: 1 },
    ],
  },
  400
);
await sendReturn({ ...denied, expectedTotalMinor: 1 }, 409);
await sendReturn({ ...denied, reason: "x" }, 400);
let before = await state();
await post("/market-accounting/product", {
  productId: p,
  vatBps: 0,
  salePriceMinor: 9999,
});
const first = await sendReturn(denied, 200, accountant);
assert.deepEqual(await sendReturn(denied, 200, accountant), first);
await post("/market-accounting/product", {
  productId: p,
  vatBps: 2000,
  salePriceMinor: 1200,
});
assert.equal(first.result.creditedMinor, 1200);
assert.equal(first.result.refundMinor, 0);
assert.equal(
  (await state()).parties.find((x: any) => x.id === customer).receivableMinor,
  600
);
assert.equal((await getSource(creditSale)).items[0].returnedQuantity, 1);
const partlyPaid = await returnBody(creditSale, 1);
assert.equal(partlyPaid.expectedCreditedMinor, 600);
await sendReturn({ ...partlyPaid, moneyConfirmed: false }, 409);
await sendReturn(partlyPaid);
assert.equal(
  (await state()).parties.find((x: any) => x.id === customer).receivableMinor,
  0
);
await post("/market-accounting/reverse", {
  entryId: collection.id,
  reason: "DEMO iade sonrası tahsilat düzeltmesi",
});
assert.equal(
  (await state()).parties.find((x: any) => x.id === customer).receivableMinor,
  3000
);
await post("/market-accounting/settlement", {
  partyId: customer,
  direction: "COLLECTION",
  wallet: "CASH_SAFE",
  amountMinor: 3000,
  description: "DEMO düzeltilmiş tahsilat",
});
const restCredit = await sendReturn(await returnBody(creditSale, 2));
assert.equal(restCredit.result.refundMinor, 2400);
assert.equal(restCredit.result.creditedMinor, 0);
before = await state();
await sendReturn(
  { ...(await returnBody(cashSale, 1)), sourceEntryId: creditSale },
  409
);
assert.equal((await state()).revision, before.revision);

await sendReturn(await returnBody(cashSale, 1));
const racing = await returnBody(cashSale, 2);
const raceBodies = [
  racing,
  { ...racing, requestId: randomUUID(), reference: "DEMO-I-RACE-SECOND" },
];
const raced = await Promise.all(
  raceBodies.map(body =>
    http("/api/stationos/market-accounting/return", owner, body)
  )
);
assert.deepEqual(raced.map(r => r.status).sort(), [200, 409]);
const winning = raceBodies[raced.findIndex(r => r.status === 200)];
assert.equal((await getSource(cashSale)).items[0].returnedQuantity, 3);
assert.deepEqual(
  (await sendReturn(winning)).result,
  raced.find(r => r.status === 200)!.data.result
);
// Drain only the test bank account, verify refund rollback, then restore the transfer.
const bankBalance = (await state()).balances.BANK;
const drain = await post("/market-accounting/transfer", {
  from: "BANK",
  amountMinor: bankBalance,
  description: "DEMO yetersiz bakiye testi",
});
const insufficient = await returnBody(cardSale, 1, { wallet: "BANK" });
await sendReturn(insufficient, 409);
assert.equal((await getSource(cardSale)).items[0].returnedQuantity, 0);
await post("/market-accounting/reverse", {
  entryId: drain.id,
  reason: "DEMO banka testini geri al",
});
await sendReturn(await returnBody(cardSale, 1, { wallet: "BANK" }));
assert.equal((await state()).balances.CARD_CLEARING, 1200);
const paidPurchaseReturn = await sendReturn(
  await returnBody(purchaseA, 2, {
    wallet: "BANK",
    reference: "DEMO-I-PAID-PURCHASE",
  })
);
assert.equal(paidPurchaseReturn.result.creditedMinor, 0);
assert.equal(paidPurchaseReturn.result.refundMinor, 1200);
const duplicateReference = await returnBody(purchaseA, 1, {
  wallet: "BANK",
  reference: "DEMO-I-PAID-PURCHASE",
});
before = await state();
await sendReturn(duplicateReference, 409);
assert.equal((await state()).revision, before.revision);
assert.equal((await getSource(purchaseA)).items[0].returnedQuantity, 2);
const purchaseReturnB = await sendReturn(
  await returnBody(purchaseB, 10, { wallet: "BANK" })
);
assert.equal(purchaseReturnB.result.creditedMinor, 5800);
assert.equal(purchaseReturnB.result.refundMinor, 5000);
await post("/market-accounting/reverse", {
  entryId: payB.id,
  reason: "DEMO iade sonrası tedarikçi ödeme düzeltmesi",
});
assert.equal(
  (await state()).parties.find((x: any) => x.id === supplier).payableMinor,
  5006
);
await post("/market-accounting/settlement", {
  partyId: supplier,
  direction: "PAYMENT",
  wallet: "BANK",
  amountMinor: 5000,
  description: "DEMO düzeltilmiş tedarikçi ödemesi",
});
const extraSale = await sell(5);
const shortage = await getSource(purchaseA);
const shortageBody = {
  ...(await returnBody(purchaseA, 1)),
  lines: [{ productId: p, quantity: 4 }],
  expectedTotalMinor: 2400,
  expectedCostMinor: 2800,
};
assert.equal(shortage.items[0].stockQuantity, 3);
await sendReturn(shortageBody, 409);
assert.equal((await getSource(purchaseA)).items[0].returnedQuantity, 2);
await sendReturn(await returnBody(extraSale, 5));
const tinySale = await sell(3, {}, tiny, 1);
for (let i = 0; i < 3; i++)
  await sendReturn(await returnBody(tinySale, 1, {}, tiny));
const tinySource = await getSource(tinySale);
assert.equal(tinySource.items[0].returnedGrossMinor, 3);
assert.equal(tinySource.items[0].returnedNetMinor, 2);
assert.equal(tinySource.items[0].returnedCostMinor, 3);
const stale = await returnBody(purchaseA, 1, { wallet: "BANK" });
const temporary = await post("/market-accounting/capital", {
  wallet: "BANK",
  amountMinor: 1,
  description: "DEMO eski önizleme testi",
});
await sendReturn(stale, 409);
await post("/market-accounting/reverse", {
  entryId: temporary.id,
  reason: "DEMO önizleme testini geri al",
});
const returnEntry = (await state()).journal.find(
  (x: any) => x.kind === "SALE_RETURN"
).id;
await post(
  "/market-accounting/reverse",
  { entryId: returnEntry, reason: "DEMO iade ters kayıt engeli" },
  409
);
const actualPos = await pos(),
  opened = actualPos.sessions.find((x: any) => x.id === session);
assert.equal(opened.expectedCashMinor, 10603);
await post("/pos/close", {
  sessionId: session,
  countedCashMinor: 10603,
  cashTransferred: true,
});
let s = await state();
assert.equal(s.stockValueMinor, 5603);
assert.equal(s.daily.salesGrossMinor, 0);
assert.equal(s.daily.salesNetMinor, 0);
assert.equal(s.daily.cogsMinor, 0);
assert.equal(s.daily.salesReturnsGrossMinor, 15603);
assert.equal(s.daily.purchaseReturnsGrossMinor, 12000);
assert.equal(s.daily.operatingResultMinor, 1600);
assert.equal(s.daily.purchasesNetMinor, 4003);
assert.equal(s.balances.CASH_SAFE, 100000);
assert.equal(s.balances.BANK, 94000);
assert.equal(s.balances.CARD_CLEARING, 1200);
assert.equal(s.balances.INPUT_VAT, 803);
assert.equal(s.parties.find((x: any) => x.id === supplier).payableMinor, 6);
assert.equal(s.parties.find((x: any) => x.id === customer).receivableMinor, 0);
assert.equal(s.trialDifferenceMinor, 0);
const statement = await raw(
  `/market-accounting/statement?stationId=${station}&partyId=${customer}&from=${today}&to=${today}`
);
assert.equal(statement.closingReceivableMinor, 0);
assert.ok(statement.rows.some((x: any) => x.kind === "SALE_RETURN"));
const creditReturnRows = statement.rows.filter(
  (x: any) => x.kind === "SALE_RETURN"
);
assert.equal(creditReturnRows.length, 3);
assert.equal(
  creditReturnRows.reduce((n: number, x: any) => n + x.returnGrossMinor, 0),
  4800
);
assert.equal(
  creditReturnRows.reduce((n: number, x: any) => n + x.returnRefundMinor, 0),
  3000
);
const supplierStatement = await raw(
  `/market-accounting/statement?stationId=${station}&partyId=${supplier}&from=${today}&to=${today}`
);
assert.equal(
  supplierStatement.rows.filter((x: any) => x.kind === "PURCHASE_RETURN")
    .length,
  2
);
assert.equal(
  supplierStatement.rows
    .filter((x: any) => x.kind === "PURCHASE_RETURN")
    .reduce((n: number, x: any) => n + x.returnRefundMinor, 0),
  6200
);
for (const party of s.parties) {
  const docs = s.documents.filter((d: any) => d.partyId === party.id);
  assert.equal(
    docs
      .filter((d: any) => d.kind === "CREDIT_SALE")
      .reduce(
        (n: number, d: any) =>
          n + d.totalMinor - d.settledMinor - d.creditedMinor,
        0
      ),
    party.receivableMinor
  );
  assert.equal(
    docs
      .filter((d: any) => d.kind === "PURCHASE")
      .reduce(
        (n: number, d: any) =>
          n + d.totalMinor - d.settledMinor - d.creditedMinor,
        0
      ),
    party.payableMinor
  );
}
const beforeCloseReturn = await returnBody(purchaseA, 1, { wallet: "BANK" });
await post("/market-accounting/day-close", {
  expectedRevision: s.revision,
  countedCashMinor: 100000,
});
s = await state();
assert.equal(s.closedToday, true);
assert.equal(s.closes[0].hash, payloadHash(s.closes[0].snapshot));
await sendReturn(beforeCloseReturn, 409);
assert.deepEqual(
  (await sendReturn(winning)).result,
  raced.find(r => r.status === 200)!.data.result
);
const sql = await mysql.createConnection({ uri: db.toString() });
const [journals]: any = await sql.query(
  "SELECT e.id,COALESCE(SUM(l.debit_minor-l.credit_minor),0) AS diff FROM st_market_entries e LEFT JOIN st_market_lines l ON l.entry_id=e.id WHERE e.station_id=? GROUP BY e.id",
  [station]
);
assert.ok(journals.every((r: any) => Number(r.diff) === 0));
const [stockMismatch]: any = await sql.query(
  "SELECT p.id FROM st_products p JOIN st_market_inventory i ON i.product_id=p.id WHERE p.station_id=? AND p.stock_qty<>i.quantity",
  [station]
);
assert.equal(stockMismatch.length, 0);
const [cache]: any = await sql.query(
  "SELECT l.account_code,SUM(l.debit_minor-l.credit_minor) AS n FROM st_market_lines l JOIN st_market_entries e ON e.id=l.entry_id WHERE e.station_id=? GROUP BY l.account_code",
  [station]
);
for (const row of cache)
  assert.equal(Number(row.n), s.balances[row.account_code]);
await sql.end();
const output =
  process.env.SMOKE_OUTPUT_DIR ?? "/workspace/market-returns-test/dev";
await mkdir(output, { recursive: true, mode: 0o700 });
await writeFile(
  output + "/fixture.json",
  JSON.stringify(
    {
      owner,
      accountant,
      manager,
      staff,
      outsider,
      station,
      p,
      tiny,
      register,
      session,
      purchaseA,
      purchaseB,
      purchaseTiny,
      cashSale,
      cardSale,
      creditSale,
      tinySale,
    },
    null,
    2
  ),
  { mode: 0o600 }
);
const checks = [
  "Rol/tenant/kaynak belge sınırları",
  "Geçersiz satır, tutar, açıklama ve fazla iade reddi",
  "Kısmi veresiye iadesinde açık borç ve ödenmiş kısım ayrımı",
  "Tahsilat/ödeme ters kaydında iade mahsubu korundu",
  "Aynı kimlikle tekrar tek iade; farklı kimlikle son adet yarışı",
  "Onaysız/yetersiz para iadesinde tam rollback",
  "Kart alacağı ile manuel banka iadesi ayrı",
  "Ödenmiş/kısmi ödenmiş alış iadeleri",
  "Ağırlıklı stok maliyeti farkı ve tedarikçi mahsubu",
  "Mükerrer iade belge numarasında stok/fiş tam rollback",
  "Yetersiz fiziksel stok ve eski önizleme reddi",
  "Kuruşluk kısmi iadelerde net/KDV/maliyet tam korundu",
  "İade genel ters fişle bozulamadı",
  "Merkez kasa iadeleri POS çekmece kapanışını bozmadı",
  "Günlük net satış, alış, KDV ve operasyon sonucu doğru",
  "Cari belgeler, ekstre, stok ve defter/cache mutabakatı",
  "Gün sonu iade sonrası hash ve kapalı gün engeli",
];
await writeFile(
  output + "/result.json",
  JSON.stringify({ ok: true, checks }, null, 2)
);
console.log(JSON.stringify({ ok: true, checks }, null, 2));

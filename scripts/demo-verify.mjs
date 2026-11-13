import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { connection } from "./demo-environment.mjs";
export async function verify() {
  const db = await connection(),
    checks = [],
    counts = {};
  try {
    for (const table of [
      "users",
      "st_tenants",
      "st_companies",
      "st_stations",
      "st_shifts",
      "st_accounts",
      "st_account_signatures",
      "st_fuel_types",
      "st_fuel_tanks",
      "st_fuel_pumps",
      "st_fuel_nozzles",
      "st_fuel_readings",
      "st_tank_requests",
      "st_tank_ledger",
      "st_tank_measurements",
      "st_payments",
      "st_slips",
      "st_debtors",
      "st_debtor_ledger",
      "st_products",
      "st_suppliers",
      "st_stock_movements",
      "st_payables",
      "st_shift_special_operations",
      "st_tanker_document_reviews",
      "st_tank_photo_drafts",
      "st_tank_photo_reviews",
      "st_tank_volume_readings",
      "st_daily_report_packages",
      "st_daily_report_reviews",
      "st_daily_numeric_reviews",
      "st_daily_ocr_runs",
      "st_assistant_requests",
    ]) {
      const [[r]] = await db.query("SELECT COUNT(*) AS n FROM `" + table + "`");
      counts[table] = Number(r.n);
    }
    const zero = async (label, sql) => {
      const [r] = await db.query(sql);
      assert.equal(r.length, 0, label);
      checks.push(label);
    };
    await zero(
      "Tenant ve istasyon ilişkileri",
      "SELECT a.id FROM st_accounts a JOIN st_shifts s ON s.id=a.shift_id JOIN st_stations t ON t.id=a.station_id WHERE a.tenant_id<>t.tenant_id OR s.tenant_id<>a.tenant_id OR s.station_id<>a.station_id"
    );
    await zero(
      "Onaylı hesaplarda iki farklı bağımsız kişi",
      "SELECT a.id FROM st_accounts a LEFT JOIN st_account_signatures s ON s.account_id=a.id AND s.cycle_no=a.cycle_no AND s.kind='APPROVAL' AND s.user_id<>a.user_id WHERE a.status IN ('ACCEPTED','ACCEPTED_WITH_PENDING') GROUP BY a.id HAVING COUNT(DISTINCT s.user_id)<>2"
    );
    await zero(
      "Tüm kapalı hesaplarda sıfır kasa farkı",
      "SELECT id FROM st_accounts WHERE status IN ('ACCEPTED','ACCEPTED_WITH_PENDING') AND (difference_minor<>0 OR counted_cash_minor IS NULL OR cash_received_minor IS NULL)"
    );
    await zero(
      "Kasa devirleri: sayılan = float + nakit satış; teslim = nakit satış",
      "SELECT a.id FROM st_accounts a WHERE a.status IN ('ACCEPTED','ACCEPTED_WITH_PENDING') AND (a.counted_cash_minor<>a.opening_float_minor+COALESCE((SELECT SUM(p.amount_minor) FROM st_payments p WHERE p.account_id=a.id AND p.kind='CASH' AND p.status='POSTED'),0) OR a.cash_received_minor<>COALESCE((SELECT SUM(p.amount_minor) FROM st_payments p WHERE p.account_id=a.id AND p.kind='CASH' AND p.status='POSTED'),0))"
    );
    await zero(
      "Satış = nakit + kart + cari + banka beyanı",
      "SELECT a.id FROM st_accounts a WHERE a.source_sales_minor IS NOT NULL AND a.source_sales_minor<>COALESCE((SELECT SUM(p.amount_minor) FROM st_payments p WHERE p.account_id=a.id AND p.kind IN ('CASH','DEBT','IBAN') AND p.status='POSTED'),0)+COALESCE((SELECT SUM(s.amount_minor) FROM st_slips s WHERE s.account_id=a.id AND s.status='VERIFIED'),0)"
    );
    await zero(
      "Cari bakiye = borç eksi tahsilat",
      "SELECT d.id FROM st_debtors d WHERE d.balance_minor<>COALESCE((SELECT SUM(CASE WHEN l.direction='DEBT' THEN l.amount_minor ELSE -l.amount_minor END) FROM st_debtor_ledger l WHERE l.debtor_id=d.id),0)"
    );
    await zero(
      "Tank stoku = değişmez hareket defteri toplamı",
      "SELECT c.tank_id FROM st_tank_cards c WHERE c.stock_ml<>COALESCE((SELECT SUM(l.delta_ml) FROM st_tank_ledger l WHERE l.tank_id=c.tank_id),0) OR c.stock_ml<0 OR c.stock_ml>c.capacity_ml"
    );
    await zero(
      "Onaylı tanker kabulünde tek stok girişi",
      "SELECT q.id FROM st_tank_requests q LEFT JOIN st_tank_ledger l ON l.request_id=q.id WHERE q.status='APPROVED' AND q.kind='DELIVERY' GROUP BY q.id,q.measured_ml HAVING COUNT(l.id)<>1 OR SUM(l.delta_ml)<>q.measured_ml"
    );
    await zero(
      "Bekleyen tanker kabulü stoğa yazılmadı",
      "SELECT q.id FROM st_tank_requests q JOIN st_tank_ledger l ON l.request_id=q.id WHERE q.status='PENDING'"
    );
    await zero(
      "Market stoku = hareket toplamı",
      "SELECT p.id FROM st_products p WHERE p.stock_qty<>COALESCE((SELECT SUM(CASE WHEN m.kind='SALE' THEN -m.quantity ELSE m.quantity END) FROM st_stock_movements m WHERE m.product_id=p.id),0) OR p.stock_qty<0"
    );
    await zero(
      "Market satışlarının manuel hesap eşleştirmesi",
      "SELECT a.id FROM st_accounts a WHERE a.business_unit='MARKET' AND a.source_sales_minor IS NOT NULL AND a.source_sales_minor<>COALESCE((SELECT SUM(m.quantity*m.unit_price_minor) FROM st_stock_movements m WHERE m.kind='SALE' AND m.reference=CONCAT('DEMO-MARKET:',a.id)),0)"
    );
    const [ledger] = await db.query(
        "SELECT * FROM st_tank_ledger ORDER BY tank_id,id"
      ),
      last = new Map();
    for (const r of ledger) {
      assert.equal(Number(r.before_ml), last.get(r.tank_id) ?? 0);
      assert.equal(
        Number(r.after_ml),
        Number(r.before_ml) + Number(r.delta_ml)
      );
      last.set(r.tank_id, Number(r.after_ml));
    }
    checks.push("Tank hareket zincirinde açıklanamayan kopukluk yok");
    const [readings] = await db.query(
        "SELECT r.*,a.status FROM st_fuel_readings r JOIN st_accounts a ON a.id=r.account_id ORDER BY r.nozzle_id,r.reading_at,r.sequence_no"
      ),
      previous = new Map(),
      groups = new Map();
    for (const r of readings) {
      const prior = previous.get(r.nozzle_id);
      if (r.kind === "OPEN" && prior)
        assert.equal(Number(r.meter_ml), Number(prior.meter_ml));
      if (prior) assert.ok(Number(r.meter_ml) >= Number(prior.meter_ml));
      previous.set(r.nozzle_id, r);
      const k = r.account_id + ":" + r.nozzle_id;
      const g = groups.get(k) ?? [];
      g.push(r);
      groups.set(k, g);
    }
    const moneyByAccount = new Map(),
      mlByAccount = new Map();
    for (const g of groups.values()) {
      if (!["ACCEPTED", "ACCEPTED_WITH_PENDING"].includes(g[0].status))
        continue;
      let amount = 0n;
      for (let i = 1; i < g.length; i++)
        amount +=
          (BigInt(g[i].meter_ml) - BigInt(g[i - 1].meter_ml)) *
            BigInt(g[i - 1].price_minor) +
          500n -
          0n; // accumulate each segment below instead
      amount = 0n;
      for (let i = 1; i < g.length; i++)
        amount +=
          ((BigInt(g[i].meter_ml) - BigInt(g[i - 1].meter_ml)) *
            BigInt(g[i - 1].price_minor) +
            500n) /
          1000n;
      const id = g[0].account_id;
      moneyByAccount.set(id, (moneyByAccount.get(id) ?? 0) + Number(amount));
      mlByAccount.set(
        id,
        (mlByAccount.get(id) ?? 0) +
          Number(g.at(-1).meter_ml) -
          Number(g[0].meter_ml)
      );
    }
    const [accounts] = await db.query(
      "SELECT id,source_sales_minor FROM st_accounts WHERE business_unit='FUEL' AND status IN ('ACCEPTED','ACCEPTED_WITH_PENDING')"
    );
    for (const a of accounts) {
      assert.equal(moneyByAccount.get(a.id), Number(a.source_sales_minor));
      const [[r]] = await db.execute(
        "SELECT -SUM(delta_ml) AS ml FROM st_tank_ledger WHERE account_id=? AND kind='SALE'",
        [a.id]
      );
      assert.equal(Number(r.ml), mlByAccount.get(a.id));
    }
    checks.push(
      "Fiyat segmentleri tam kuruş hesabı ve sayaç litresi = tank satış çıkışı"
    );
    assert.equal(counts.st_tenants, 2);
    assert.equal(counts.st_companies, 2);
    assert.equal(counts.st_stations, 3);
    const result = { ok: true, database: "istasyonos_demo", counts, checks };
    await writeFile(
      ".local/demo/verification.json",
      JSON.stringify(result, null, 2)
    );
    console.log(JSON.stringify(result));
    return result;
  } finally {
    await db.end();
  }
}
if (process.argv[1]?.endsWith("demo-verify.mjs"))
  verify().catch(e => {
    console.error(e.message);
    process.exitCode = 1;
  });

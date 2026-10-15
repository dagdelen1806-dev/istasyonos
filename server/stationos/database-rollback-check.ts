import { randomUUID } from "node:crypto";
import { strict as assert } from "node:assert";
import { getStationPool, closeStationPool } from "./db";
import { ACCOUNT_TOTAL_COLUMNS } from "./index";

if (!process.argv.includes("--rollback-only")) throw new Error("Bu test yalnız --rollback-only ile çalışır; commit yapmaz.");
const pool = getStationPool();
const connection = await pool.getConnection();
const id = () => randomUUID();
const tenant = id(), company = id(), station = id(), shift = id(), account = id();
const checks: string[] = [];
let insertedUserId: number | null = null;
try {
  await connection.beginTransaction();
  const [userInsert]: any = await connection.execute("INSERT INTO users (openId, name, role) VALUES (?, 'ROLLBACK-ONLY TEST', 'user')", [`rollback-${id()}`]);
  insertedUserId = Number(userInsert.insertId);
  await connection.execute("INSERT INTO st_tenants(id,name,created_by_user_id) VALUES (?,'ROLLBACK-ONLY',?)", [tenant, insertedUserId]);
  await connection.execute("INSERT INTO st_companies(id,tenant_id,name) VALUES (?,?,'ROLLBACK-ONLY')", [company, tenant]);
  await connection.execute("INSERT INTO st_stations(id,tenant_id,company_id,name,code) VALUES (?,?,?,'ROLLBACK-ONLY',?)", [station,tenant,company,id()]);
  await connection.execute("INSERT INTO st_shifts(id,tenant_id,station_id,label,starts_at) VALUES (?,?,?,'ROLLBACK-ONLY','2026-10-10 05:00:00')",[shift,tenant,station]);
  await connection.execute("INSERT INTO st_accounts(id,tenant_id,station_id,shift_id,user_id,business_unit,opening_float_minor) VALUES (?,?,?,?,?,'FUEL',1000)",[account,tenant,station,shift,insertedUserId]);
  for (const [kind, amount] of [["CASH",10000],["CASH",5000],["IBAN",2500]] as const) {
    await connection.execute("INSERT INTO st_payments(id,tenant_id,station_id,account_id,kind,amount_minor,created_by_user_id) VALUES (?,?,?,?,?,?,?)",[id(),tenant,station,account,kind,amount,insertedUserId]);
  }
  const addSlip = async (reference: string, at: string, amount: number) => connection.execute("INSERT INTO st_slips(id,tenant_id,station_id,account_id,amount_minor,reference,terminal_id,transaction_at,created_by_user_id) VALUES (?,?,?,?,?,?,'ROLLBACK-POS',?,?)",[id(),tenant,station,account,amount,reference,at,insertedUserId]);
  await addSlip("ROLLBACK-RRN-A","2026-10-10 09:00:00",30000);
  await addSlip("ROLLBACK-RRN-B","2026-10-10 09:10:00",40000);
  const [totals]: any = await connection.query(`SELECT ${ACCOUNT_TOTAL_COLUMNS} FROM st_accounts a WHERE a.id=? FOR UPDATE`,[account]);
  assert.equal(Number(totals[0].cash_sales_minor),15000);
  assert.equal(Number(totals[0].card_total_minor),70000);
  assert.equal(Number(totals[0].iban_minor),2500);
  checks.push("Üç ödeme × iki slip, toplamları çoğaltmadı; 15000/70000/2500 kuruş.");
  let duplicate = false;
  try { await addSlip("ROLLBACK-RRN-A","2026-10-10 11:15:00",30000); }
  catch (error: any) { duplicate = error.code === "ER_DUP_ENTRY"; if (!duplicate) throw error; }
  assert.ok(duplicate);
  checks.push("Aynı RRN farklı saatle aynı Türkiye gününde tekrar gelir oluşturamadı.");
  await addSlip("ROLLBACK-RRN-C","2026-10-10 23:30:00",100);
  const [days]: any = await connection.execute("SELECT transaction_day FROM st_slips WHERE reference='ROLLBACK-RRN-C' AND account_id=?",[account]);
  assert.equal(days[0].transaction_day,"2026-10-11");
  checks.push("UTC gece işlemi Türkiye takviminde ertesi güne bağlandı.");
  for (const kind of ["CASH_RECEIVE","APPROVAL"] as const) {
    await connection.execute("INSERT INTO st_account_signatures(id,account_id,cycle_no,revision,kind,user_id,snapshot_json) VALUES (?,?,1,1,?,?, '{}')",[id(),account,kind,insertedUserId]);
  }
  const [signatures]: any = await connection.query(`SELECT ${ACCOUNT_TOTAL_COLUMNS} FROM st_accounts a WHERE a.id=?`,[account]);
  assert.equal(Number(signatures[0].signature_count),1);
  checks.push("Fizikî alıcı imzası mali onay adedine eklenmedi.");
  const note="ROLLBACK-ONLY: kaynak raporu tekrar kontrol edilmeli.";
  await connection.execute("INSERT INTO st_account_events(id,account_id,actor_user_id,cycle_no,revision,event_type,payload_json) VALUES (?,?,?,1,2,'RETURN_FOR_CORRECTION',?)",[id(),account,insertedUserId,JSON.stringify({note})]);
  const [events]: any = await connection.execute("SELECT payload_json FROM st_account_events WHERE account_id=?",[account]);
  assert.equal(JSON.parse(events[0].payload_json).note,note);
  checks.push("Düzeltme gerekçesi olay kaydında saklanabilir.");
} finally {
  await connection.rollback();
  connection.release();
}
const [remaining]: any = await pool.execute("SELECT COUNT(*) AS total FROM st_tenants WHERE id=?",[tenant]);
assert.equal(Number(remaining[0].total),0);
if (insertedUserId !== null) {
  const [users]: any = await pool.execute("SELECT COUNT(*) AS total FROM users WHERE id=?",[insertedUserId]);
  assert.equal(Number(users[0].total),0);
}
checks.push("Transaction rollback sonrası kullanıcı/finans kayıtları kalmadı.");
await closeStationPool();
console.log(JSON.stringify({ok:true,rollbackOnly:true,checks},null,2));

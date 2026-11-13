import { config } from "./demo-environment.mjs";
import mysql from "mysql2/promise";
import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";
// Read-only comparison with the previous delivery snapshot. Never recapture it.
const cfg = await config(),
  db = await mysql.createConnection({
    uri: cfg.sourceUrl,
    dateStrings: true,
    timezone: "Z",
  });
try {
  await db.query("SET time_zone='+00:00'");
  const before = JSON.parse(
      await readFile(".local/demo/source-before.json", "utf8")
    ),
    changed = [],
    unchanged = [];
  for (const [table, baseline] of Object.entries(before)) {
    assert.match(table, /^[a-zA-Z0-9_]+$/);
    const [records] = await db.query("SELECT * FROM `" + table + "`");
    const hash = createHash("sha256")
      .update(JSON.stringify(records.map(r => JSON.stringify(r)).sort()))
      .digest("hex");
    (hash === baseline.hash && records.length === baseline.count
      ? unchanged
      : changed
    ).push(table);
  }
  const result = {
    allUnchanged: changed.length === 0,
    unchangedTables: unchanged.length,
    changedTables: changed,
    financialAndStockUnchanged: [
      "st_accounts",
      "st_payments",
      "st_debtors",
      "st_debtor_ledger",
      "st_tank_ledger",
      "st_tank_cards",
      "st_fuel_readings",
      "st_stock_movements",
    ].every(t => unchanged.includes(t)),
    note: "Önceki teslim anlık görüntüsüne göre salt okunur karşılaştırma; farklılıkların kaynağı bu karşılaştırmayla belirlenemez. Başlangıç dosyası korunmuştur.",
  };
  await writeFile(
    ".local/demo/phase5a-source-comparison.json",
    JSON.stringify(result, null, 2)
  );
  console.log(JSON.stringify(result));
} finally {
  await db.end();
}

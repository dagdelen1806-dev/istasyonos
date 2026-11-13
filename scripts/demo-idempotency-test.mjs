import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { connection } from "./demo-environment.mjs";
const db = await connection();
try {
  async function snapshot() {
    const [tables] = await db.query("SHOW TABLES"),
      result = {};
    for (const row of tables) {
      const table = Object.values(row)[0];
      assert.match(table, /^[a-zA-Z0-9_]+$/);
      const [rows] = await db.query("SELECT * FROM `" + table + "`");
      result[table] = {
        count: rows.length,
        hash: createHash("sha256")
          .update(JSON.stringify(rows.map(r => JSON.stringify(r)).sort()))
          .digest("hex"),
      };
    }
    return result;
  }
  const before = await snapshot();
  for (const [script, flag] of [
    ["demo-seed.mjs", "--seed"],
    ["demo-scenarios.mjs", "--scenarios"],
    ["demo-documents.mjs", "--documents"],
  ]) {
    const reply = spawnSync(
      process.execPath,
      ["scripts/" + script, "--database", "istasyonos_demo", flag],
      { encoding: "utf8", windowsHide: true }
    );
    assert.equal(reply.status, 0, "DEMO replay failed: " + script);
  }
  assert.deepEqual(await snapshot(), before);
  const refused = spawnSync(
    process.execPath,
    ["scripts/demo-seed.mjs", "--database", "istasyonos", "--seed"],
    { encoding: "utf8", windowsHide: true }
  );
  assert.notEqual(refused.status, 0);
  assert.match(refused.stderr, /EXPLICIT_DEMO_TARGET_REQUIRED/);
  assert.deepEqual(await snapshot(), before);
  const result = {
    ok: true,
    tablesCompared: Object.keys(before).length,
    allRowsUnchangedAfterReplay: true,
    wrongDatabaseRejected: true,
  };
  await writeFile(
    ".local/demo/idempotency.json",
    JSON.stringify(result, null, 2)
  );
  console.log(JSON.stringify(result));
} finally {
  await db.end();
}

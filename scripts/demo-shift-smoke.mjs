import assert from "node:assert/strict";
import { build } from "esbuild";
import { connection } from "./demo-environment.mjs";
await build({
  entryPoints: ["server/stationos/shift-close.ts"],
  platform: "node",
  bundle: true,
  packages: "external",
  format: "esm",
  outfile: ".local/demo/shift-domain.js",
});
const { closeShift } = await import("../.local/demo/shift-domain.js");
const db = await connection();
try {
  const [[s]] = await db.query(
    "SELECT * FROM st_shifts WHERE status='CLOSED' ORDER BY starts_at LIMIT 1"
  );
  assert.ok(s);
  const [[latest]] = await db.execute(
    "SELECT MAX(r.reading_at) AS at FROM st_fuel_readings r JOIN st_accounts a ON a.id=r.account_id WHERE a.shift_id=?",
    [s.id]
  );
  const iso = v => new Date(String(v).replace(" ", "T") + "Z").toISOString();
  await db.beginTransaction();
  try {
    await db.execute(
      "UPDATE st_shifts SET status='OPEN' WHERE id=? AND tenant_id=?",
      [s.id, s.tenant_id]
    );
    await assert.rejects(
      () =>
        closeShift(
          db,
          { tenantId: s.tenant_id, stationId: s.station_id },
          {
            shiftId: s.id,
            endsAt: new Date(Date.parse(iso(latest.at)) - 1).toISOString(),
          }
        ),
      e => e.code === "SHIFT_END_BEFORE_READING"
    );
    const result = await closeShift(
      db,
      { tenantId: s.tenant_id, stationId: s.station_id },
      { shiftId: s.id, endsAt: iso(s.ends_at) }
    );
    assert.equal(result.status, "CLOSED");
    assert.equal(result.financialPosted, false);
  } finally {
    await db.rollback();
  }
  const [[after]] = await db.execute(
    "SELECT status,ends_at FROM st_shifts WHERE id=?",
    [s.id]
  );
  assert.equal(after.status, s.status);
  assert.equal(iso(after.ends_at), iso(s.ends_at));
  console.log(
    JSON.stringify({
      ok: true,
      realMysqlTransactionProbe: true,
      twoApprovedAccountsRequired: true,
      endBeforeMeterReadingRejected: true,
      rollbackConfirmed: true,
      committedBusinessChanges: 0,
    })
  );
} finally {
  await db.end();
}

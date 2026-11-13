import { readFile } from "node:fs/promises";
import { connection } from "./demo-environment.mjs";
export async function normalizeDemoDates() {
  const db = await connection();
  try {
    const [[done]] = await db.query(
      "SELECT COUNT(*) AS n FROM st_audit WHERE action='BUSINESS_DEMO_V1_DATES_COMPLETE'"
    );
    if (Number(done.n)) return;
    const access = JSON.parse(
        await readFile(".local/demo/access.json", "utf8")
      ),
      entries = (await readFile(".local/demo/seed-operations.jsonl", "utf8"))
        .trim()
        .split("\n")
        .map(JSON.parse),
      first = Date.parse(access.anchorDay + "T00:00:00+03:00") - 59 * 86400000;
    const tables = {
      "/stock": "st_stock_movements",
      "/slip": "st_slips",
      "/collection": "st_payments",
      "/payment": "st_payments",
      "/payable": "st_payables",
      "/shift": "st_shifts",
    };
    await db.beginTransaction();
    try {
      for (const { key, record } of entries) {
        const table = tables[record.path],
          id = record.result?.id;
        if (!table || !id) continue;
        const match = key.match(/^(DEMO-(?:KM|KC|GS))-(\d+)-/),
          opening = key.match(/^(DEMO-(?:KM|KC|GS))-market-opening-/);
        if (!match && !opening) continue;
        const station = access.stations.find(
          s => s.code === (match ?? opening)[1]
        );
        if (!station) throw Error("DEMO_DATE_SCOPE_REJECTED");
        const actor = access.actors[station.group + "-owner"];
        const [[member]] = await db.execute(
          "SELECT tenant_id FROM st_members WHERE user_id=?",
          [actor.id]
        );
        const at = opening
          ? new Date(first - 3600000)
          : new Date(
              first +
                Number(match[2]) * 86400000 +
                (record.path === "/shift" ? 60000 : 8 * 3600000)
            );
        await db.execute(
          "UPDATE `" +
            table +
            "` SET created_at=? WHERE id=? AND tenant_id=? AND station_id=?",
          [at, id, member.tenant_id, station.id]
        );
        if (table === "st_payments")
          await db.execute(
            "UPDATE st_debtor_ledger SET created_at=? WHERE payment_id=? AND tenant_id=?",
            [at, id, member.tenant_id]
          );
      }
      const owner = access.actors["a-owner"];
      const [[member]] = await db.execute(
        "SELECT tenant_id FROM st_members WHERE user_id=?",
        [owner.id]
      );
      await db.execute(
        "INSERT INTO st_audit(tenant_id,actor_user_id,action) VALUES (?,?,'BUSINESS_DEMO_V1_DATES_COMPLETE')",
        [member.tenant_id, owner.id]
      );
      await db.commit();
    } catch (e) {
      await db.rollback();
      throw e;
    }
    console.log(
      JSON.stringify({
        ok: true,
        syntheticOperationalDatesAligned: true,
        financialAmountsChanged: false,
      })
    );
  } finally {
    await db.end();
  }
}
if (process.argv[1]?.endsWith("demo-seed-dates.mjs"))
  normalizeDemoDates().catch(e => {
    console.error(e.code ?? "DEMO_DATES_FAILED");
    process.exitCode = 1;
  });

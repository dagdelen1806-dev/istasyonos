import "dotenv/config";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import mysql from "mysql2/promise";

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is required");
  const pool = mysql.createPool({
    uri: url,
    multipleStatements: true,
  });
  try {
    await pool.query(`CREATE TABLE IF NOT EXISTS st_schema_migrations (version VARCHAR(64) NOT NULL PRIMARY KEY, applied_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)) ENGINE=InnoDB`);
    const migrationDir = join(import.meta.dirname, "migrations");
    const files = (await readdir(migrationDir)).filter(file => /^\d+_[a-z0-9_-]+\.sql$/i.test(file)).sort();
    for (const file of files) {
      const version = file.replace(/\.sql$/i, "");
      const [applied] = await pool.query("SELECT version FROM st_schema_migrations WHERE version = ? LIMIT 1", [version]);
      if (Array.isArray(applied) && applied.length > 0) continue;
      const sql = await readFile(join(migrationDir, file), "utf8");
      const connection = await pool.getConnection();
      try {
        await connection.beginTransaction();
        await connection.query(sql);
        await connection.query("INSERT INTO st_schema_migrations (version) VALUES (?)", [version]);
        await connection.commit();
        console.log(`Applied ${version}`);
      } catch (error) {
        await connection.rollback();
        throw error;
      } finally {
        connection.release();
      }
    }
  } finally {
    await pool.end();
  }
}

main().catch(error => {
  console.error("StationOS migration failed:", error instanceof Error ? error.message : "unknown error");
  process.exitCode = 1;
});

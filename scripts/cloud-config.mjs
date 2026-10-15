import mysql from "mysql2/promise";
import { randomBytes } from "node:crypto";
import { writeFileSync, existsSync, readFileSync } from "node:fs";
import dotenv from "dotenv";

const socketPath = "/workspace/local-mysql/mysql.sock";
if (existsSync(".env")) {
  // Never run automatic migrations on an unknown or external database.
  const env = dotenv.parse(readFileSync(".env"));
  const url = new URL(env.DATABASE_URL);
  if (url.searchParams.get("socketPath") !== socketPath || url.pathname !== "/istasyonos") throw new Error("Existing .env is not the isolated cloud database; configure/migrate it manually.");
  const c = await mysql.createConnection(env.DATABASE_URL);
  await c.query("SELECT 1"); await c.end();
  console.log("Existing local configuration preserved; database query passed.");
} else {
  if (process.env.DATABASE_URL) throw new Error("Preserve injected database settings; configure this external database manually.");
  const c = await mysql.createConnection({ socketPath, user: "root" });
  const appPassword = randomBytes(32).toString("hex"), adminPassword = randomBytes(32).toString("hex");
  await c.query("CREATE DATABASE IF NOT EXISTS istasyonos CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci");
  await c.query("CREATE USER 'istasyonos'@'localhost' IDENTIFIED BY ?", [appPassword]);
  await c.query("GRANT ALL PRIVILEGES ON istasyonos.* TO 'istasyonos'@'localhost'");
  await c.query("DELETE FROM mysql.global_priv WHERE User=''");
  const [roots] = await c.query("SELECT User,Host FROM mysql.global_priv WHERE User='root'");
  for (const r of roots) await c.query("ALTER USER ?@? IDENTIFIED BY ?", [r.User,r.Host,adminPassword]);
  await c.query("FLUSH PRIVILEGES");
  writeFileSync("/workspace/local-mysql/admin.cnf", `[client]\nuser=root\npassword=${adminPassword}\nsocket=${socketPath}\n`, { mode: 0o600, flag: "wx" });
  writeFileSync(".env", `NODE_ENV=development\nPORT=3000\nAUTH_PROVIDER=local\nAPP_ID=istasyonos\nSESSION_SECRET=${randomBytes(48).toString("hex")}\nCOOKIE_SECURE=false\nDATABASE_URL=mysql://istasyonos:${appPassword}@localhost/istasyonos?socketPath=${encodeURIComponent(socketPath)}\n`, { mode: 0o600, flag: "wx" });
  await c.end();
  console.log("Isolated database and protected local configuration created; credentials were not printed.");
}

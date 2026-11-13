import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createHash, randomBytes } from "node:crypto";
import mysql from "mysql2/promise";
import { parse } from "dotenv";
import { build as bundle } from "esbuild";
const folder = ".local/demo";
export const demoDatabase = "istasyonos_demo";
export async function config() {
  return JSON.parse(await readFile(folder + "/config.json", "utf8"));
}
export function assertDemoUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw Error("DEMO_DATABASE_TARGET_REJECTED");
  }
  if (
    url.protocol !== "mysql:" ||
    !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) ||
    decodeURIComponent(url.pathname.slice(1)) !== demoDatabase ||
    url.search
  )
    throw Error("DEMO_DATABASE_TARGET_REJECTED");
  return url;
}
export async function connection() {
  const c = await config();
  assertDemoUrl(c.databaseUrl);
  const db = await mysql.createConnection({
    uri: c.databaseUrl,
    dateStrings: true,
    timezone: "Z",
  });
  const [[r]] = await db.query("SELECT DATABASE() AS name");
  if (r.name !== demoDatabase) {
    await db.end();
    throw Error("DEMO_DATABASE_TARGET_REJECTED");
  }
  await db.query("SET time_zone='+00:00'");
  return db;
}
export async function setup() {
  await mkdir(folder, { recursive: true });
  const env = parse(await readFile(".env")),
    url = new URL(env.DATABASE_URL);
  if (
    !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) ||
    url.protocol !== "mysql:" ||
    url.search ||
    !/^istasyonos(?:[-_].*)?$/i.test(decodeURIComponent(url.pathname.slice(1)))
  )
    throw Error("LOCAL_SOURCE_REJECTED");
  const sourceUrl = url.toString();
  url.pathname = "/";
  const server = await mysql.createConnection({
    uri: url.toString(),
    dateStrings: true,
  });
  try {
    const [schemas] = await server.execute(
      "SELECT SCHEMA_NAME FROM information_schema.SCHEMATA WHERE SCHEMA_NAME=?",
      [demoDatabase]
    );
    if (schemas.length) {
      const [tables] = await server.execute(
        "SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA=?",
        [demoDatabase]
      );
      if (tables.length) {
        const marker = await readFile(folder + "/config.json", "utf8").catch(
          () => null
        );
        if (!marker) throw Error("EXISTING_DEMO_DATABASE_NOT_OWNED_NO_CHANGES");
      }
    }
    await server.query(
      "CREATE DATABASE IF NOT EXISTS `istasyonos_demo` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci"
    );
  } finally {
    await server.end();
  }
  url.pathname = "/" + demoDatabase;
  let old;
  try {
    old = await config();
  } catch {}
  if (old && old.databaseUrl !== url.toString())
    throw Error("DEMO_CONFIGURATION_CONFLICT");
  if (!old)
    await writeFile(
      folder + "/config.json",
      JSON.stringify(
        {
          databaseUrl: url.toString(),
          sessionSecret: randomBytes(48).toString("base64url"),
          port: 3001,
          seedVersion: "business-v1",
          sourceUrl,
        },
        null,
        2
      ),
      { mode: 0o600, flag: "wx" }
    );
  await bundle({
    entryPoints: ["scripts/migrations.ts"],
    platform: "node",
    packages: "external",
    bundle: true,
    format: "esm",
    outfile: folder + "/migrations.js",
  });
  const cfg = await config();
  assertDemoUrl(cfg.databaseUrl);
  process.env.DATABASE_URL = cfg.databaseUrl;
  const { runMigrationCli } = await import("../.local/demo/migrations.js"),
    manifest = createHash("sha256")
      .update(await readFile("migrations.manifest.json"))
      .digest("hex");
  await runMigrationCli([
    "apply",
    "--database",
    demoDatabase,
    "--manifest-sha256",
    manifest,
    "--apply",
  ]);
  console.log(
    JSON.stringify({
      ok: true,
      database: demoDatabase,
      existingDatabaseReset: false,
    })
  );
}
if (process.argv[1]?.endsWith("demo-environment.mjs")) {
  if (
    process.argv[2] !== "--database" ||
    process.argv[3] !== demoDatabase ||
    process.argv[4] !== "--create"
  )
    throw Error("Use --database istasyonos_demo --create");
  setup().catch(e => {
    console.error(
      e.code ||
        (/^DEMO_|^LOCAL_|^EXISTING_/.test(e.message)
          ? e.message
          : "DEMO_SETUP_FAILED")
    );
    process.exitCode = 1;
  });
}

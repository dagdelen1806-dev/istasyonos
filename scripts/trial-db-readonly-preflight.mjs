import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parse } from "dotenv";
import mysql from "mysql2/promise";

const expected = Object.freeze({
  host: "127.0.0.1",
  port: 3306,
  database: "istasyonos_migration_trial",
  user: "st_trial_ro",
  server: "DESKTOP-LPUUGML",
});

export const readonlyPreflightSql = Object.freeze({
  database: "SELECT DATABASE() AS selected_database",
  server:
    "SELECT @@hostname AS server_hostname, @@port AS server_port, @@server_uuid AS server_uuid",
  account: "SELECT CURRENT_USER() AS effective_account",
  roles: "SELECT CURRENT_ROLE() AS active_roles",
  grants: "SHOW GRANTS",
  tables:
    "SELECT COUNT(*) AS table_count FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE()",
});

const normalizePrincipal = value =>
  String(value)
    .replace(/[\s'`]/g, "")
    .toLowerCase();

export function validateTrialReadonlyGrants(grants, database, currentUser) {
  const expectedPrincipal = normalizePrincipal(currentUser);
  let hasSelect = false;
  for (const raw of grants) {
    const line = String(raw).trim();
    if (/\bWITH\s+GRANT\s+OPTION\b/i.test(line))
      throw new Error("READONLY_GRANTS_REJECTED");
    const match = /^GRANT\s+(.+?)\s+ON\s+(.+?)\s+TO\s+(.+)$/i.exec(line);
    if (!match || normalizePrincipal(match[3]) !== expectedPrincipal)
      throw new Error("READONLY_GRANTS_REJECTED");
    const privileges = match[1]
      .split(",")
      .map(value => value.trim().toUpperCase());
    const scope = match[2]
      .replaceAll("`", "")
      .replace(/\s+/g, "")
      .toLowerCase();
    if (scope === "*.*" && privileges.length === 1 && privileges[0] === "USAGE")
      continue;
    if (
      scope !== `${database.toLowerCase()}.*` ||
      privileges.some(value => !["SELECT", "SHOW VIEW"].includes(value))
    )
      throw new Error("READONLY_GRANTS_REJECTED");
    if (privileges.includes("SELECT")) hasSelect = true;
  }
  if (!grants.length || !hasSelect) throw new Error("READONLY_GRANTS_REJECTED");
}

export function validateTrialReadonlyIdentity(row, configuredUser) {
  if (
    !row ||
    String(row.database_name ?? "") !== expected.database ||
    String(row.server_hostname ?? "") !== expected.server ||
    Number(row.server_port) !== expected.port ||
    !String(row.server_uuid ?? "").trim() ||
    String(row.current_role ?? "").toUpperCase() !== "NONE" ||
    String(row.current_user ?? "").split("@")[0] !== configuredUser
  )
    throw new Error("READONLY_IDENTITY_MISMATCH");
  return {
    database: String(row.database_name),
    server: String(row.server_hostname),
    port: Number(row.server_port),
    currentUser: String(row.current_user),
    serverUuid: String(row.server_uuid),
  };
}

function required(config, key) {
  const value = String(config[key] ?? "").trim();
  if (!value) throw new Error(`READONLY_CONFIG_MISSING:${key}`);
  return value;
}

export async function runReadonlyPreflight(root = process.cwd()) {
  let connection;
  let phase = "configuration";
  const runStage = async (name, action) => {
    phase = name;
    try {
      return await action();
    } catch (error) {
      error.preflightPhase = name;
      throw error;
    }
  };
  try {
    const config = await runStage("configuration", async () =>
      parse(await readFile(resolve(root, ".env"), "utf8"))
    );
    const host = required(config, "ST_TRIAL_DB_HOST");
    const port = Number(required(config, "ST_TRIAL_DB_PORT"));
    const database = required(config, "ST_TRIAL_DB_NAME");
    const user = required(config, "ST_TRIAL_DB_USER");
    const password = required(config, "ST_TRIAL_DB_PASSWORD");
    const charset = required(config, "ST_TRIAL_DB_CHARSET");
    if (
      config.ST_TRIAL_DB_READ_ONLY?.trim().toLowerCase() !== "true" ||
      host !== expected.host ||
      port !== expected.port ||
      database !== expected.database ||
      user !== expected.user ||
      !Number.isInteger(port)
    )
      throw new Error("READONLY_TARGET_CONFIG_REJECTED");

    connection = await runStage("connect", () =>
      mysql.createConnection({
        host,
        port,
        database,
        user,
        password,
        charset,
        connectTimeout: 5000,
        multipleStatements: false,
        timezone: "Z",
        supportBigNumbers: true,
        bigNumberStrings: true,
      })
    );
    const [databaseRows] = await runStage("database", () =>
      connection.query(readonlyPreflightSql.database)
    );
    const [serverRows] = await runStage("server_identity", () =>
      connection.query(readonlyPreflightSql.server)
    );
    const [accountRows] = await runStage("current_user", () =>
      connection.query(readonlyPreflightSql.account)
    );
    const [roleRows] = await runStage("active_roles", () =>
      connection.query(readonlyPreflightSql.roles)
    );
    const selectedDatabase = String(databaseRows[0]?.selected_database ?? "");
    await runStage("database_validation", async () => {
      if (
        selectedDatabase !== expected.database ||
        selectedDatabase !== database
      )
        throw new Error("READONLY_IDENTITY_MISMATCH");
    });
    const serverIdentity = {
      server_hostname: serverRows[0]?.server_hostname,
      server_port: serverRows[0]?.server_port,
      server_uuid: serverRows[0]?.server_uuid,
    };
    await runStage("server_identity_validation", async () => {
      if (
        String(serverIdentity.server_hostname ?? "") !== expected.server ||
        Number(serverIdentity.server_port) !== expected.port ||
        !String(serverIdentity.server_uuid ?? "").trim() ||
        (config.ST_TRIAL_DB_SERVER_UUID &&
          String(serverIdentity.server_uuid) !==
            config.ST_TRIAL_DB_SERVER_UUID.trim())
      )
        throw new Error("READONLY_IDENTITY_MISMATCH");
    });
    const effectiveUser = String(accountRows[0]?.effective_account ?? "");
    await runStage("current_user_validation", async () => {
      if (
        effectiveUser.split("@")[0] !== user ||
        (config.ST_TRIAL_DB_EXPECTED_CURRENT_USER &&
          effectiveUser !== config.ST_TRIAL_DB_EXPECTED_CURRENT_USER.trim())
      )
        throw new Error("READONLY_IDENTITY_MISMATCH");
    });
    const activeRoles = String(roleRows[0]?.active_roles ?? "");
    await runStage("role_validation", async () => {
      if (activeRoles.toUpperCase() !== "NONE")
        throw new Error("READONLY_IDENTITY_MISMATCH");
    });
    const identity = {
      database: selectedDatabase,
      server: String(serverIdentity.server_hostname),
      port: Number(serverIdentity.server_port),
      currentUser: effectiveUser,
      serverUuid: String(serverIdentity.server_uuid),
    };
    const [grantRows] = await runStage("show_grants", () =>
      connection.query(readonlyPreflightSql.grants)
    );
    const grants = grantRows.map(row => String(Object.values(row)[0] ?? ""));
    await runStage("grant_validation", async () =>
      validateTrialReadonlyGrants(grants, database, identity.currentUser)
    );
    const [tableRows] = await runStage("table_count", () =>
      connection.query(readonlyPreflightSql.tables)
    );

    console.log(
      `READ_ONLY_PREFLIGHT_PASS database=${identity.database} server=${identity.server} port=${identity.port}; CURRENT_USER verified; server UUID present; SELECT/SHOW VIEW grants limited to target schema; tables=${Number(tableRows[0]?.table_count ?? 0)}`
    );
    return {
      ok: true,
      ...identity,
      tableCount: Number(tableRows[0]?.table_count ?? 0),
    };
  } catch (error) {
    const rawCode = String(
      error?.code ??
        (/^READONLY_[A-Z0-9_:]+$/.test(String(error?.message ?? ""))
          ? error.message
          : "PREFLIGHT_FAILED")
    );
    const safeCode = /^[A-Z0-9_:-]+$/i.test(rawCode)
      ? rawCode.slice(0, 100)
      : "PREFLIGHT_FAILED";
    console.error(
      `READ_ONLY_PREFLIGHT_NOT_PASS phase=${error?.preflightPhase ?? phase} code=${safeCode}; credentials hidden; no fallback attempted`
    );
    process.exitCode = 1;
    return { ok: false, code: safeCode };
  } finally {
    if (connection) await connection.end().catch(() => undefined);
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
)
  await runReadonlyPreflight();

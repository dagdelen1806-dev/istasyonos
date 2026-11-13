export type RuntimeDbEnvironment = Record<string, string | undefined>;

export type StationosRuntimeTestProfile = {
  databaseUrl: string;
  expectedHost: string;
  expectedPort: number;
  expectedServerUuid: string;
  expectedServerHostname?: string;
  expectedDatabase: string;
  expectedCurrentUser: string;
  expectedCurrentRole: "NONE";
};

export type StationosRuntimeDbIdentity = {
  database: string;
  host: string;
  port: number;
  serverUuid: string;
  serverHostname?: string;
  currentUser: string;
  currentRole: string;
};

export function stationosRuntimeTestProfileKey(
  profile: StationosRuntimeTestProfile
): string {
  const url = new URL(profile.databaseUrl);
  return [
    url.protocol,
    url.hostname.toLowerCase(),
    url.port || "3306",
    decodeURIComponent(url.username),
    profile.expectedServerUuid.toLowerCase(),
    profile.expectedServerHostname ?? "",
    profile.expectedDatabase,
    profile.expectedCurrentUser,
    profile.expectedCurrentRole,
  ].join("|");
}

const forbiddenDatabases = new Set([
  "istasyonos_db",
  "istasyonos_demo",
  "istasyonos_migration_trial",
]);
const requiredRuntimePrivileges = ["DELETE", "INSERT", "SELECT", "UPDATE"];

function fail(): never {
  // Never include URLs, usernames, passwords, or expected identities.
  throw new Error("STATIONOS_TEST_DB_TARGET_REJECTED");
}

function principal(value: string): string {
  return value.replace(/[\s'`]/gu, "").toLowerCase();
}

function identifier(value: string): string {
  return value.replaceAll("`", "").trim().toLowerCase();
}

function required(environment: RuntimeDbEnvironment, key: string): string {
  const value = environment[key]?.trim();
  if (!value) fail();
  return value;
}

function parsePort(value: string): number {
  if (!/^\d{1,5}$/u.test(value)) fail();
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) fail();
  return port;
}

export function readStationosRuntimeTestProfile(
  environment: RuntimeDbEnvironment
): StationosRuntimeTestProfile | null {
  const mode = environment.STATIONOS_APP_TEST_MODE;
  if (mode === undefined) return null;
  if (
    mode !== "1" ||
    environment.NODE_ENV === "production" ||
    environment.BIND_HOST !== "127.0.0.1"
  )
    fail();

  const databaseUrl = required(environment, "STATIONOS_APP_TEST_DATABASE_URL");
  const expectedHost = required(
    environment,
    "STATIONOS_APP_TEST_EXPECTED_HOST"
  ).toLowerCase();
  const expectedPort = parsePort(
    required(environment, "STATIONOS_APP_TEST_EXPECTED_PORT")
  );
  const expectedServerUuid = required(
    environment,
    "STATIONOS_APP_TEST_EXPECTED_SERVER_UUID"
  ).toLowerCase();
  const expectedDatabase = required(
    environment,
    "STATIONOS_APP_TEST_EXPECTED_DATABASE"
  );
  const expectedCurrentUser = required(
    environment,
    "STATIONOS_APP_TEST_EXPECTED_CURRENT_USER"
  );
  const expectedServerHostname =
    environment.STATIONOS_APP_TEST_EXPECTED_SERVER_HOSTNAME?.trim();

  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
      expectedServerUuid
    ) ||
    (expectedServerHostname !== undefined && !expectedServerHostname) ||
    forbiddenDatabases.has(expectedDatabase.toLowerCase()) ||
    /aksan/iu.test(expectedDatabase) ||
    !/^[a-z0-9_]{1,64}$/iu.test(expectedDatabase)
  )
    fail();

  let url: URL;
  try {
    url = new URL(databaseUrl);
  } catch {
    return fail();
  }
  const pathDatabase = decodeURIComponent(url.pathname.slice(1));
  const urlUser = decodeURIComponent(url.username);
  const expectedUsername = expectedCurrentUser.split("@")[0];
  const normalizedUser = principal(expectedUsername);
  const normalizedUrlUser = principal(urlUser);
  const parameters = url.searchParams;
  const multiStatementValue = parameters.get("multipleStatements");
  if (
    !["mysql:", "mysql2:"].includes(url.protocol) ||
    !url.password ||
    url.hostname.toLowerCase() !== expectedHost ||
    Number(url.port || "3306") !== expectedPort ||
    pathDatabase !== expectedDatabase ||
    normalizedUser !== normalizedUrlUser ||
    !/^[^@]+@[^@]+$/u.test(expectedCurrentUser) ||
    !url.hostname ||
    parameters.has("socketPath") ||
    (multiStatementValue !== null &&
      !["false", "0"].includes(multiStatementValue.toLowerCase())) ||
    ["root", "admin", "st_trial_ro", "stationos_trial_migrator"].includes(
      normalizedUser
    ) ||
    /migrat(or|ion)/iu.test(normalizedUser)
  )
    fail();

  return {
    databaseUrl,
    expectedHost,
    expectedPort,
    expectedServerUuid,
    ...(expectedServerHostname ? { expectedServerHostname } : {}),
    expectedDatabase,
    expectedCurrentUser,
    expectedCurrentRole: "NONE",
  };
}

export function validateStationosRuntimeIdentity(
  actual: StationosRuntimeDbIdentity,
  expected: StationosRuntimeTestProfile
): void {
  let url: URL;
  try {
    url = new URL(expected.databaseUrl);
  } catch {
    return fail();
  }
  if (
    url.hostname.toLowerCase() !== expected.expectedHost ||
    Number(url.port || "3306") !== expected.expectedPort ||
    actual.host.toLowerCase() !== expected.expectedHost ||
    actual.port !== expected.expectedPort ||
    actual.serverUuid.toLowerCase() !== expected.expectedServerUuid ||
    (expected.expectedServerHostname !== undefined &&
      actual.serverHostname !== expected.expectedServerHostname) ||
    actual.database !== expected.expectedDatabase ||
    actual.currentUser !== expected.expectedCurrentUser ||
    actual.currentRole.toUpperCase() !== expected.expectedCurrentRole
  )
    fail();
}

/** Runtime may use only CRUD privileges on its isolated schema; never DDL. */
export function validateStationosRuntimeGrants(
  grants: string[],
  database: string,
  currentUser: string
): void {
  if (grants.length < 2) fail();
  const seen = new Set<string>();
  const normalizedUser = principal(currentUser);
  for (const raw of grants) {
    const line = raw.trim();
    if (/\bWITH\s+GRANT\s+OPTION\b/iu.test(line)) fail();
    const match = /^GRANT\s+(.+?)\s+ON\s+(.+?)\s+TO\s+(.+)$/iu.exec(line);
    if (!match || principal(match[3]) !== normalizedUser) fail();
    const scope = match[2]
      .replaceAll("`", "")
      .replace(/\s+/gu, "")
      .toLowerCase();
    const privileges = match[1]
      .split(",")
      .map(value => value.trim().toUpperCase());
    if (scope === "*.*" && privileges.length === 1 && privileges[0] === "USAGE")
      continue;
    if (scope !== `${database.toLowerCase()}.*`) fail();
    for (const privilege of privileges) {
      if (!requiredRuntimePrivileges.includes(privilege)) fail();
      seen.add(privilege);
    }
  }
  if (requiredRuntimePrivileges.some(privilege => !seen.has(privilege))) fail();
}

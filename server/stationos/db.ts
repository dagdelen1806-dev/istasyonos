import {
  type Pool,
  type PoolConnection,
  type ResultSetHeader,
  type RowDataPacket,
} from "mysql2/promise";
import { createUtcPool } from "./utc-pool";
import {
  readStationosRuntimeTestProfile,
  stationosRuntimeTestProfileKey,
  validateStationosRuntimeGrants,
  validateStationosRuntimeIdentity,
  type StationosRuntimeTestProfile,
} from "./runtime-db-profile";

let pool: Pool | null = null;
let poolTestProfileKey: string | null | undefined;
const transactionEvidence = new WeakMap<
  object,
  { rollbackConfirmed: boolean }
>();
export function transactionRollbackConfirmed(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    transactionEvidence.get(error)?.rollbackConfirmed === true
  );
}

export function getStationPool(): Pool {
  const profile = readStationosRuntimeTestProfile(process.env);
  const profileKey = profile ? stationosRuntimeTestProfileKey(profile) : null;
  if (pool) {
    if (poolTestProfileKey !== profileKey)
      throw new Error("STATIONOS_TEST_DB_TARGET_REJECTED");
    return pool;
  }
  const url = profile?.databaseUrl ?? process.env.DATABASE_URL;
  if (!url) throw new Error("STATIONOS_DATABASE_UNAVAILABLE");
  const options = {
    uri: url,
    timezone: "Z",
    dateStrings: true,
    supportBigNumbers: true,
    bigNumberStrings: true,
    connectionLimit: 8,
  };
  pool = profile
    ? createGuardedRuntimeTestPool(profile, options)
    : createUtcPool(options);
  poolTestProfileKey = profileKey;
  return pool;
}

export function createStationosRuntimeTestPool(
  options: Parameters<typeof createUtcPool>[0]
): Pool {
  const profile = readStationosRuntimeTestProfile(process.env);
  if (!profile) throw new Error("STATIONOS_TEST_DB_TARGET_REJECTED");
  return createGuardedRuntimeTestPool(profile, options);
}

function createGuardedRuntimeTestPool(
  profile: StationosRuntimeTestProfile,
  options: Parameters<typeof createUtcPool>[0]
): Pool {
  return createUtcPool(options, connection =>
    validateRuntimeTestConnection(connection, profile)
  );
}

async function validateRuntimeTestConnection(
  connection: {
    promise(): {
      query(sql: string): Promise<[unknown, unknown]>;
    };
  },
  profile: StationosRuntimeTestProfile
): Promise<void> {
  try {
    const [identityRows] = await connection
      .promise()
      .query(
        "SELECT DATABASE() AS database_name, @@port AS server_port, @@server_uuid AS server_uuid, @@hostname AS server_hostname, CURRENT_USER() AS current_user, CURRENT_ROLE() AS current_role"
      );
    const identity = Array.isArray(identityRows)
      ? (identityRows[0] as Record<string, unknown> | undefined)
      : undefined;
    if (!identity) throw new Error("target");
    const actual = {
      database: String(identity.database_name ?? ""),
      host: profile.expectedHost,
      port: Number(identity.server_port),
      serverUuid: String(identity.server_uuid ?? ""),
      serverHostname: String(identity.server_hostname ?? ""),
      currentUser: String(identity.current_user ?? ""),
      currentRole: String(identity.current_role ?? "NONE"),
    };
    validateStationosRuntimeIdentity(actual, profile);
    const [grantRows] = await connection.promise().query("SHOW GRANTS");
    if (!Array.isArray(grantRows)) throw new Error("grants");
    const grants = grantRows.map(row =>
      String(Object.values(row as Record<string, unknown>)[0] ?? "")
    );
    validateStationosRuntimeGrants(
      grants,
      profile.expectedDatabase,
      profile.expectedCurrentUser
    );
  } catch {
    // Identity and grants must never be exposed to app logs or API responses.
    throw new Error("STATIONOS_TEST_DB_TARGET_REJECTED");
  }
}

export async function closeStationPool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
    poolTestProfileKey = undefined;
  }
}

export async function query<
  T extends RowDataPacket[] | ResultSetHeader = RowDataPacket[],
>(sql: string, params: unknown[] = []): Promise<T> {
  const [rows] = await getStationPool().execute(sql, params);
  return rows as T;
}

export async function withTransaction<T>(
  fn: (connection: PoolConnection) => Promise<T>
): Promise<T> {
  const connection = await getStationPool().getConnection();
  let commitAttempted = false;
  try {
    await connection.beginTransaction();
    const result = await fn(connection);
    commitAttempted = true;
    await connection.commit();
    return result;
  } catch (error) {
    let rollbackConfirmed = false;
    try {
      await connection.rollback();
      rollbackConfirmed = !commitAttempted;
    } catch {
      /* No rollback acknowledgement: outcome remains uncertain. */
    }
    if (typeof error === "object" && error !== null)
      transactionEvidence.set(error, { rollbackConfirmed });
    throw error;
  } finally {
    connection.release();
  }
}

export async function execute(
  connection: PoolConnection,
  sql: string,
  params: unknown[] = []
): Promise<ResultSetHeader> {
  const [result] = await connection.execute(sql, params);
  return result as ResultSetHeader;
}

export async function rows<T extends RowDataPacket[]>(
  connection: PoolConnection,
  sql: string,
  params: unknown[] = []
): Promise<T> {
  const [result] = await connection.execute(sql, params);
  return result as T;
}

export async function first<T extends RowDataPacket>(
  connection: PoolConnection,
  sql: string,
  params: unknown[] = []
): Promise<T | null> {
  const result = await rows<T[]>(connection, sql, params);
  return result[0] ?? null;
}

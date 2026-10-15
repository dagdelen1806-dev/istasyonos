import mysql, {
  type Pool,
  type PoolConnection,
  type ResultSetHeader,
  type RowDataPacket,
} from "mysql2/promise";

let pool: Pool | null = null;

export function getStationPool(): Pool {
  if (pool) return pool;
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("STATIONOS_DATABASE_UNAVAILABLE");
  pool = mysql.createPool({
    uri: url,
    timezone: "Z",
    dateStrings: true,
    supportBigNumbers: true,
    bigNumberStrings: true,
    connectionLimit: 8,
  });
  return pool;
}

export async function closeStationPool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
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
  try {
    await connection.beginTransaction();
    const result = await fn(connection);
    await connection.commit();
    return result;
  } catch (error) {
    await connection.rollback();
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

import mysql from "mysql2";
import type { PoolOptions } from "mysql2";
import type { Pool } from "mysql2/promise";

type ConnectionGuardHandle = {
  destroy(): void;
  promise(): {
    query(sql: string): Promise<[unknown, unknown]>;
  };
};

export type PoolConnectionGuard = (
  connection: ConnectionGuardHandle
) => Promise<void>;

/** Do not hand out a pooled connection until its UTC session is ready. */
export function createUtcPool(
  options: PoolOptions,
  guard?: PoolConnectionGuard
): Pool {
  const core = mysql.createPool({ ...options, timezone: "Z" });
  const acquire = core.getConnection.bind(core);
  // Pool query/execute and promise getConnection all use this acquisition path.
  core.getConnection = callback => {
    acquire((error, connection) => {
      if (error) {
        callback(error, connection);
        return;
      }
      connection.query("SET time_zone = '+00:00'", setupError => {
        if (setupError) {
          connection.destroy();
          callback(setupError, connection);
          return;
        }
        if (!guard) {
          callback(null, connection);
          return;
        }
        void guard(connection as unknown as ConnectionGuardHandle).then(
          () => callback(null, connection),
          () => {
            connection.destroy();
            callback(
              new Error("STATIONOS_TEST_DB_TARGET_REJECTED"),
              connection
            );
          }
        );
      });
    });
  };
  return core.promise();
}

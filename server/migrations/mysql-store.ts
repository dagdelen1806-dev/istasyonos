import type {
  Connection,
  ResultSetHeader,
  RowDataPacket,
} from "mysql2/promise";
import { MigrationSafetyError, type Migration } from "./catalog";
import type { MigrationStore, Snapshot, Guard } from "./engine";
import { validateStationosRuntimeGrants } from "../stationos/runtime-db-profile";

export type MigrationConnectionExpectation = {
  host: string;
  port: number;
  database: string;
  urlUsername: string;
  expectedServerHostname?: string;
  expectedCurrentUser?: string;
  expectedServerUuid?: string;
  requireTargetOnlyGrants?: boolean;
};

const isolatedMigrationDdlPrivileges = new Set([
  "CREATE",
  "ALTER",
  "REFERENCES",
]);
const isolatedMigrationHistoryPrivileges = new Map<string, Set<string>>([
  ["__drizzle_migrations", new Set(["CREATE", "SELECT", "INSERT"])],
  ["st_schema_migrations", new Set(["CREATE", "SELECT", "INSERT"])],
  ["st_migration_guard", new Set(["CREATE", "SELECT", "INSERT", "UPDATE"])],
]);
// MySQL requires INSERT for ALTER TABLE. Keep that DML permission table-scoped
// to the exact tables altered by the canonical migration set. CREATE is
// included because some MySQL grant plans include it for future tables.
const isolatedMigrationAlterTablePrivileges = new Map<string, Set<string>>([
  ["st_stations", new Set(["CREATE", "INSERT", "INDEX"])],
  ["st_member_stations", new Set(["CREATE", "INSERT"])],
  ["st_shifts", new Set(["CREATE", "INSERT", "INDEX"])],
  ["st_slips", new Set(["CREATE", "INSERT", "INDEX"])],
  ["st_tank_photo_reviews", new Set(["CREATE", "INSERT"])],
  ["st_daily_report_packages", new Set(["CREATE", "INSERT"])],
  ["st_tank_requests", new Set(["CREATE", "INSERT"])],
  ["st_tanker_document_reads", new Set(["CREATE", "INSERT"])],
  ["st_payments", new Set(["CREATE", "INSERT"])],
]);

function normalizePrincipal(value: string) {
  return value.replace(/[\s'`]/g, "").toLowerCase();
}

export function validateTargetOnlyMigrationGrants(
  grants: string[],
  database: string,
  currentUser: string
) {
  const allowedDdl = new Set<string>(),
    allowedTables = new Map<string, Set<string>>(),
    expectedPrincipal = normalizePrincipal(currentUser),
    schema = database.replaceAll("`", "").toLowerCase();
  for (const raw of grants) {
    const line = raw.trim();
    if (/\bWITH\s+GRANT\s+OPTION\b/i.test(line))
      throw new MigrationSafetyError(
        "TARGET_PRIVILEGE_REJECTED",
        "Migration hesabinda GRANT OPTION olamaz."
      );
    const match = /^GRANT\s+(.+?)\s+ON\s+(.+?)\s+TO\s+(.+)$/i.exec(line);
    if (!match || normalizePrincipal(match[3]) !== expectedPrincipal)
      throw new MigrationSafetyError(
        "TARGET_PRIVILEGE_REJECTED",
        "Migration hesabinin grant kayitlari dogrulanamadi."
      );
    const privileges = match[1]
      .split(",")
      .map(value => value.trim().toUpperCase());
    const scope = match[2]
      .replaceAll("`", "")
      .replace(/\s+/g, "")
      .toLowerCase();
    if (scope === "*.*" && privileges.length === 1 && privileges[0] === "USAGE")
      continue;
    if (scope === `${schema}.*`) {
      for (const privilege of privileges) {
        if (!isolatedMigrationDdlPrivileges.has(privilege))
          throw new MigrationSafetyError(
            "TARGET_PRIVILEGE_REJECTED",
            "Schema-geneli grant yalniz gerekli DDL yetkilerini icerebilir."
          );
        allowedDdl.add(privilege);
      }
      continue;
    }
    const prefix = `${schema}.`;
    if (!scope.startsWith(prefix))
      throw new MigrationSafetyError(
        "TARGET_PRIVILEGE_REJECTED",
        "Migration hesabi yalniz secilen veritabanina yetkili olmali."
      );
    const table = scope.slice(prefix.length),
      allowedForTable =
        isolatedMigrationHistoryPrivileges.get(table) ??
        isolatedMigrationAlterTablePrivileges.get(table);
    if (!allowedForTable)
      throw new MigrationSafetyError(
        "TARGET_PRIVILEGE_REJECTED",
        "Tablo-grant yalniz migration gecmisi ve kanonik ALTER hedeflerine verilebilir."
      );
    const tableAllowed = allowedTables.get(table) ?? new Set<string>();
    for (const privilege of privileges) {
      if (!allowedForTable.has(privilege))
        throw new MigrationSafetyError(
          "TARGET_PRIVILEGE_REJECTED",
          "Migrator gecmis tablosunda gereksiz yetki var."
        );
      tableAllowed.add(privilege);
    }
    allowedTables.set(table, tableAllowed);
  }
  const missingDdl = [...isolatedMigrationDdlPrivileges].filter(
    privilege => !allowedDdl.has(privilege)
  );
  const missingHistory = [...isolatedMigrationHistoryPrivileges].some(
    ([table, privileges]) =>
      [...privileges].some(
        privilege => !allowedTables.get(table)?.has(privilege)
      )
  );
  const missingAlterTable = [...isolatedMigrationAlterTablePrivileges].some(
    ([table, privileges]) =>
      [...privileges].some(
        privilege => !allowedTables.get(table)?.has(privilege)
      )
  );
  if (
    !grants.length ||
    missingDdl.length ||
    missingHistory ||
    missingAlterTable
  )
    throw new MigrationSafetyError(
      "TARGET_PRIVILEGE_REJECTED",
      "Migration hesabi gereken hedef-veritabani yetkilerine sahip degil."
    );
}

export class MysqlMigrationStore implements MigrationStore {
  constructor(private readonly connection: Connection) {}
  private async rows(
    sql: string,
    params: unknown[] = []
  ): Promise<RowDataPacket[]> {
    const [rows] = await this.connection.execute<RowDataPacket[]>(sql, params);
    return rows;
  }
  async initialize(): Promise<void> {
    await this.connection.query("SET time_zone = '+00:00'");
    await this.connection.query("SET autocommit = 1");
  }
  async database(): Promise<string> {
    return String(
      (await this.rows("SELECT DATABASE() AS name"))[0]?.name ?? ""
    );
  }
  async assertConnectionTarget(expectation: MigrationConnectionExpectation) {
    const row = (
      await this.rows(
        "SELECT DATABASE() AS database_name, @@hostname AS server_hostname, @@port AS server_port, CURRENT_USER() AS current_user, CURRENT_ROLE() AS current_role"
      )
    )[0];
    if (
      !row ||
      String(row.database_name ?? "") !== expectation.database ||
      String(row.server_port ?? "") !== String(expectation.port) ||
      String(row.current_user ?? "").split("@")[0] !==
        expectation.urlUsername ||
      (expectation.expectedServerHostname !== undefined &&
        String(row.server_hostname ?? "") !==
          expectation.expectedServerHostname) ||
      (expectation.expectedCurrentUser !== undefined &&
        String(row.current_user ?? "") !== expectation.expectedCurrentUser)
    )
      throw new MigrationSafetyError(
        "TARGET_IDENTITY_MISMATCH",
        "MySQL sunucu, port, veritabani veya etkin hesap beklenen hedefle eslesmiyor."
      );
    if (expectation.expectedServerUuid !== undefined) {
      let actualUuid = "";
      try {
        actualUuid = String(
          (await this.rows("SELECT @@server_uuid AS server_uuid"))[0]
            ?.server_uuid ?? ""
        );
      } catch {
        actualUuid = "";
      }
      if (!actualUuid || actualUuid !== expectation.expectedServerUuid)
        throw new MigrationSafetyError(
          "TARGET_SERVER_UUID_MISMATCH",
          "MySQL server UUID beklenen hedefle eslesmiyor veya okunamadi."
        );
    }
    if (expectation.requireTargetOnlyGrants) {
      if (String(row.current_role ?? "NONE").toUpperCase() !== "NONE")
        throw new MigrationSafetyError(
          "TARGET_PRIVILEGE_REJECTED",
          "Aktif MySQL rolleri hedef yetki izolasyonunu belirsiz kılıyor."
        );
      let rows: RowDataPacket[];
      try {
        [rows] = await this.connection.query<RowDataPacket[]>("SHOW GRANTS");
      } catch {
        throw new MigrationSafetyError(
          "TARGET_PRIVILEGE_REJECTED",
          "MySQL migration hesabi grant bilgileri okunamadi."
        );
      }
      validateTargetOnlyMigrationGrants(
        rows.map(row => String(Object.values(row)[0] ?? "")),
        expectation.database,
        String(row.current_user)
      );
    }
    return {
      database: String(row.database_name),
      serverHostname: String(row.server_hostname),
      serverPort: Number(row.server_port),
      currentUser: String(row.current_user),
    };
  }
  async assertApplicationRuntimeGrants(
    database: string,
    expectedCurrentUser: string
  ): Promise<void> {
    try {
      const identity = (
        await this.rows(
          "SELECT CURRENT_USER() AS current_user, CURRENT_ROLE() AS current_role"
        )
      )[0];
      if (
        !identity ||
        String(identity.current_user ?? "") !== expectedCurrentUser ||
        String(identity.current_role ?? "NONE").toUpperCase() !== "NONE"
      )
        throw new Error("identity");
      const [grantRows] =
        await this.connection.query<RowDataPacket[]>("SHOW GRANTS");
      validateStationosRuntimeGrants(
        grantRows.map(row => String(Object.values(row)[0] ?? "")),
        database,
        expectedCurrentUser
      );
    } catch {
      throw new MigrationSafetyError(
        "TARGET_PRIVILEGE_REJECTED",
        "Test uygulama hesabinin hedef veritabani yetkileri dogrulanamadi."
      );
    }
  }
  async acquireLock(name: string, seconds: number): Promise<boolean> {
    const value = (
      await this.rows("SELECT GET_LOCK(?, ?) AS acquired", [name, seconds])
    )[0]?.acquired;
    if (
      value === null ||
      value === undefined ||
      ![0, 1].includes(Number(value))
    )
      throw new MigrationSafetyError(
        "LOCK_FAILED",
        "MySQL migration kilidi oluşturulamadı."
      );
    return Number(value) === 1;
  }
  async assertLock(name: string): Promise<void> {
    const row = (
      await this.rows(
        "SELECT IS_USED_LOCK(?) AS owner, CONNECTION_ID() AS connection_id",
        [name]
      )
    )[0];
    if (
      !row ||
      row.owner == null ||
      String(row.owner) !== String(row.connection_id)
    )
      throw new MigrationSafetyError(
        "LOCK_LOST",
        "Migration kilidi veya bağlantı sahipliği kayboldu; devam edilmedi."
      );
  }
  async releaseLock(name: string): Promise<void> {
    const value = (
      await this.rows("SELECT RELEASE_LOCK(?) AS released", [name])
    )[0]?.released;
    if (Number(value) !== 1)
      throw new MigrationSafetyError(
        "LOCK_RELEASE_FAILED",
        "Migration kilidi bırakılamadı."
      );
  }
  async snapshot(): Promise<Snapshot> {
    const schema = await this.rows(
      "SELECT TABLE_NAME AS name, ENGINE AS engine FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE()"
    );
    const tables = schema.map(row => String(row.name));
    for (const row of schema) {
      if (
        [
          "__drizzle_migrations",
          "st_schema_migrations",
          "st_migration_guard",
        ].includes(String(row.name)) &&
        String(row.engine).toLowerCase() !== "innodb"
      )
        throw new MigrationSafetyError(
          "UNSUPPORTED_HISTORY_ENGINE",
          "Migration geçmiş tabloları InnoDB olmalı; otomatik dönüştürme yapılmaz."
        );
    }
    const drizzle = tables.includes("__drizzle_migrations")
      ? (
          await this.rows(
            "SELECT id, hash, created_at FROM __drizzle_migrations ORDER BY id"
          )
        ).map(row => ({
          id: Number(row.id),
          hash: String(row.hash),
          createdAt: Number(row.created_at),
        }))
      : [];
    const operations = tables.includes("st_schema_migrations")
      ? (
          await this.rows(
            "SELECT version, applied_at FROM st_schema_migrations ORDER BY applied_at, version"
          )
        ).map(row => ({
          version: String(row.version),
          appliedAt: String(row.applied_at),
        }))
      : [];
    const guards = tables.includes("st_migration_guard")
      ? (
          await this.rows(
            "SELECT kind, version, source_index, checksum, status, review_reference FROM st_migration_guard ORDER BY kind, source_index"
          )
        ).map(
          row =>
            ({
              kind: row.kind,
              version: String(row.version),
              sourceIndex: Number(row.source_index),
              checksum: String(row.checksum),
              status: row.status,
              reviewReference:
                row.review_reference == null
                  ? undefined
                  : String(row.review_reference),
            }) as Guard
        )
      : [];
    return { tables, drizzle, operations, guards };
  }
  async bootstrap(): Promise<void> {
    // Metadata only, and only from explicit apply/baseline. Startup/status never call this.
    await this.connection.query(`CREATE TABLE IF NOT EXISTS st_migration_guard (
      kind VARCHAR(16) NOT NULL, version VARCHAR(128) NOT NULL,
      source_index INT UNSIGNED NOT NULL, checksum CHAR(64) NOT NULL,
      status ENUM('STARTED','APPLIED','BASELINED','FAILED') NOT NULL,
      review_reference VARCHAR(190) NULL,
      started_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      completed_at DATETIME(3) NULL,
      PRIMARY KEY (kind, version), UNIQUE KEY uq_guard_source (kind, source_index)
    ) ENGINE=InnoDB`);
    await this.connection
      .query(`CREATE TABLE IF NOT EXISTS __drizzle_migrations (
      id SERIAL PRIMARY KEY, hash TEXT NOT NULL, created_at BIGINT
    ) ENGINE=InnoDB`);
    await this.connection
      .query(`CREATE TABLE IF NOT EXISTS st_schema_migrations (
      version VARCHAR(64) NOT NULL PRIMARY KEY,
      applied_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
    ) ENGINE=InnoDB`);
  }
  async start(migration: Migration): Promise<void> {
    await this.connection.execute(
      "INSERT INTO st_migration_guard (kind,version,source_index,checksum,status) VALUES (?,?,?,?,'STARTED')",
      [
        migration.kind,
        migration.version,
        migration.sourceIndex,
        migration.checksum,
      ]
    );
  }
  async executeStatement(sql: string): Promise<void> {
    await this.connection.query(sql);
  }
  async finish(migration: Migration, lockName: string): Promise<void> {
    await this.assertLock(lockName);
    await this.connection.beginTransaction();
    try {
      if (migration.kind === "drizzle") {
        await this.connection.execute(
          "INSERT INTO __drizzle_migrations (hash,created_at) VALUES (?,?)",
          [migration.checksum, migration.timestamp]
        );
      } else {
        await this.connection.execute(
          "INSERT INTO st_schema_migrations (version) VALUES (?)",
          [migration.version]
        );
      }
      await this.assertLock(lockName);
      const [result] = await this.connection.execute<ResultSetHeader>(
        "UPDATE st_migration_guard SET status='APPLIED',completed_at=UTC_TIMESTAMP(3) WHERE kind=? AND version=? AND checksum=? AND status='STARTED'",
        [migration.kind, migration.version, migration.checksum]
      );
      if (result.affectedRows !== 1)
        throw new MigrationSafetyError(
          "HISTORY_MISMATCH",
          "Migration tamamlanma kaydı doğrulanamadı."
        );
      await this.connection.commit();
    } catch (error) {
      // History DML only; completed DDL is NOT rolled back.
      await this.connection.rollback().catch(() => undefined);
      throw error;
    }
  }
  async baseline(migration: Migration, reference: string): Promise<void> {
    await this.connection.execute(
      "INSERT INTO st_migration_guard (kind,version,source_index,checksum,status,review_reference,completed_at) VALUES (?,?,?,?,'BASELINED',?,UTC_TIMESTAMP(3))",
      [
        migration.kind,
        migration.version,
        migration.sourceIndex,
        migration.checksum,
        reference,
      ]
    );
  }
}

/** One dedicated connection: no pool, reconnect, secondary migrator or DSN logs. */
export async function withMysqlMigrationStore<T>(
  uri: string,
  fn: (store: MysqlMigrationStore) => Promise<T>
): Promise<T> {
  let connection: Connection | undefined;
  try {
    const mysql = await import("mysql2/promise");
    connection = await mysql.createConnection({
      uri,
      multipleStatements: false,
      timezone: "Z",
      dateStrings: true,
      supportBigNumbers: true,
      bigNumberStrings: true,
    });
    const store = new MysqlMigrationStore(connection);
    await store.initialize();
    return await fn(store);
  } catch (error) {
    if (error instanceof MigrationSafetyError) throw error;
    throw new MigrationSafetyError(
      "MIGRATION_CONNECTION_FAILED",
      "Migration veritabanı bağlantısı/işlemi başarısız. Bağlantı bilgileri gizlendi; otomatik tekrar yok."
    );
  } finally {
    if (connection) {
      try {
        await connection.end();
      } catch {
        connection.destroy();
      }
    }
  }
}

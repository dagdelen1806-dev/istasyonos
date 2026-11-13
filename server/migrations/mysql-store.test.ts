import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Connection } from "mysql2/promise";
import { sha256, loadCatalog, type Migration } from "./catalog";

const fake = vi.hoisted(() => ({
  connect: vi.fn(),
  query: vi.fn(),
  execute: vi.fn(),
  beginTransaction: vi.fn(),
  commit: vi.fn(),
  rollback: vi.fn(),
  end: vi.fn(),
  destroy: vi.fn(),
  tables: [] as string[],
  nativeDrizzle: [] as object[],
  nativeOperations: [] as object[],
  guards: [] as object[],
  owner: 41 as number | null,
  acquired: 1 as number | null,
  released: 1,
  serverUuid: "123e4567-e89b-42d3-a456-426614174000",
  identity: {
    database_name: "istasyonos_migration_trial",
    server_hostname: "DESKTOP-LPUUGML",
    server_port: "3306",
    current_user: "trial_migrator@localhost",
    current_role: "NONE",
  },
  grants: [
    "GRANT USAGE ON *.* TO `trial_migrator`@`localhost`",
    "GRANT ALTER, CREATE, REFERENCES ON `istasyonos_migration_trial`.* TO `trial_migrator`@`localhost`",
    "GRANT CREATE, INSERT, INDEX ON `istasyonos_migration_trial`.`st_stations` TO `trial_migrator`@`localhost`",
    "GRANT CREATE, INSERT ON `istasyonos_migration_trial`.`st_member_stations` TO `trial_migrator`@`localhost`",
    "GRANT CREATE, INSERT, INDEX ON `istasyonos_migration_trial`.`st_shifts` TO `trial_migrator`@`localhost`",
    "GRANT CREATE, INSERT, INDEX ON `istasyonos_migration_trial`.`st_slips` TO `trial_migrator`@`localhost`",
    "GRANT CREATE, INSERT ON `istasyonos_migration_trial`.`st_tank_photo_reviews` TO `trial_migrator`@`localhost`",
    "GRANT CREATE, INSERT ON `istasyonos_migration_trial`.`st_daily_report_packages` TO `trial_migrator`@`localhost`",
    "GRANT CREATE, INSERT ON `istasyonos_migration_trial`.`st_tank_requests` TO `trial_migrator`@`localhost`",
    "GRANT CREATE, INSERT ON `istasyonos_migration_trial`.`st_tanker_document_reads` TO `trial_migrator`@`localhost`",
    "GRANT CREATE, INSERT ON `istasyonos_migration_trial`.`st_payments` TO `trial_migrator`@`localhost`",
    "GRANT CREATE, SELECT, INSERT ON `istasyonos_migration_trial`.`__drizzle_migrations` TO `trial_migrator`@`localhost`",
    "GRANT CREATE, SELECT, INSERT ON `istasyonos_migration_trial`.`st_schema_migrations` TO `trial_migrator`@`localhost`",
    "GRANT CREATE, SELECT, INSERT, UPDATE ON `istasyonos_migration_trial`.`st_migration_guard` TO `trial_migrator`@`localhost`",
  ],
}));
vi.mock("mysql2/promise", () => ({ createConnection: fake.connect }));
vi.mock("dotenv", () => ({
  config: () => {
    throw new Error("ENV_FILE_ACCESS_FORBIDDEN_IN_TEST");
  },
}));
import {
  MysqlMigrationStore,
  validateTargetOnlyMigrationGrants,
  withMysqlMigrationStore,
} from "./mysql-store";
import { assertMigrationReady } from "./readiness";
import {
  resolveMigrationTarget,
  resolveMigrationUri,
  resolveDemoMigrationProfile,
  demoMigrationExpectedPending,
  resolveOesseAppTrialMigrationProfile,
  runMigrationCli,
} from "../../scripts/migrations";

const migration: Migration = {
  kind: "operations",
  version: "0001_test",
  sourceIndex: 0,
  checksum: sha256("test"),
  file: "synthetic.sql",
  statements: ["CREATE TABLE st_test (id INT)"],
};
beforeEach(() => {
  for (const value of [
    fake.connect,
    fake.query,
    fake.execute,
    fake.beginTransaction,
    fake.commit,
    fake.rollback,
    fake.end,
    fake.destroy,
  ])
    value.mockReset();
  fake.tables = [];
  fake.nativeDrizzle = [];
  fake.nativeOperations = [];
  fake.guards = [];
  fake.owner = 41;
  fake.acquired = 1;
  fake.released = 1;
  fake.serverUuid = "123e4567-e89b-42d3-a456-426614174000";
  fake.identity = {
    database_name: "istasyonos_migration_trial",
    server_hostname: "DESKTOP-LPUUGML",
    server_port: "3306",
    current_user: "trial_migrator@localhost",
    current_role: "NONE",
  };
  fake.grants = [
    "GRANT USAGE ON *.* TO `trial_migrator`@`localhost`",
    "GRANT ALTER, CREATE, REFERENCES ON `istasyonos_migration_trial`.* TO `trial_migrator`@`localhost`",
    "GRANT CREATE, INSERT, INDEX ON `istasyonos_migration_trial`.`st_stations` TO `trial_migrator`@`localhost`",
    "GRANT CREATE, INSERT ON `istasyonos_migration_trial`.`st_member_stations` TO `trial_migrator`@`localhost`",
    "GRANT CREATE, INSERT, INDEX ON `istasyonos_migration_trial`.`st_shifts` TO `trial_migrator`@`localhost`",
    "GRANT CREATE, INSERT, INDEX ON `istasyonos_migration_trial`.`st_slips` TO `trial_migrator`@`localhost`",
    "GRANT CREATE, INSERT ON `istasyonos_migration_trial`.`st_tank_photo_reviews` TO `trial_migrator`@`localhost`",
    "GRANT CREATE, INSERT ON `istasyonos_migration_trial`.`st_daily_report_packages` TO `trial_migrator`@`localhost`",
    "GRANT CREATE, INSERT ON `istasyonos_migration_trial`.`st_tank_requests` TO `trial_migrator`@`localhost`",
    "GRANT CREATE, INSERT ON `istasyonos_migration_trial`.`st_tanker_document_reads` TO `trial_migrator`@`localhost`",
    "GRANT CREATE, INSERT ON `istasyonos_migration_trial`.`st_payments` TO `trial_migrator`@`localhost`",
    "GRANT CREATE, SELECT, INSERT ON `istasyonos_migration_trial`.`__drizzle_migrations` TO `trial_migrator`@`localhost`",
    "GRANT CREATE, SELECT, INSERT ON `istasyonos_migration_trial`.`st_schema_migrations` TO `trial_migrator`@`localhost`",
    "GRANT CREATE, SELECT, INSERT, UPDATE ON `istasyonos_migration_trial`.`st_migration_guard` TO `trial_migrator`@`localhost`",
  ];
  fake.connect.mockResolvedValue(fake);
  for (const action of [
    fake.query,
    fake.beginTransaction,
    fake.commit,
    fake.rollback,
    fake.end,
  ])
    action.mockResolvedValue([[], []]);
  fake.execute.mockImplementation(async (sql: string) => {
    if (sql.includes("CURRENT_USER() AS current_user"))
      return [[fake.identity], []];
    if (sql.includes("@@server_uuid AS server_uuid"))
      return [[{ server_uuid: fake.serverUuid }], []];
    if (sql.includes("GET_LOCK")) return [[{ acquired: fake.acquired }], []];
    if (sql.includes("IS_USED_LOCK"))
      return [[{ owner: fake.owner, connection_id: 41 }], []];
    if (sql.includes("RELEASE_LOCK"))
      return [[{ released: fake.released }], []];
    if (sql.includes("DATABASE() AS name"))
      return [[{ name: "isolated_test" }], []];
    if (sql.includes("information_schema"))
      return [fake.tables.map(name => ({ name, engine: "InnoDB" })), []];
    if (sql.includes("FROM __drizzle_migrations"))
      return [fake.nativeDrizzle, []];
    if (sql.includes("FROM st_schema_migrations"))
      return [fake.nativeOperations, []];
    if (sql.includes("FROM st_migration_guard")) return [fake.guards, []];
    return [{ affectedRows: 1 }, []];
  });
  fake.query.mockImplementation(async (sql: string) => {
    if (sql === "SHOW GRANTS")
      return [fake.grants.map(grant => ({ grant })), []];
    return [[], []];
  });
});
const store = () => new MysqlMigrationStore(fake as unknown as Connection);

describe("MySQL baÄŸlantÄ± adaptÃ¶rÃ¼ â€” tÃ¼m SQL Ã§aÄŸrÄ±larÄ± taklit", () => {
  const targetExpectation = {
    host: "127.0.0.1",
    port: 3306,
    database: "istasyonos_migration_trial",
    urlUsername: "trial_migrator",
    expectedServerHostname: "DESKTOP-LPUUGML",
    expectedCurrentUser: "trial_migrator@localhost",
  };
  it("checks server, port, database and account on the same connection", async () => {
    await expect(
      store().assertConnectionTarget({
        ...targetExpectation,
        requireTargetOnlyGrants: true,
      })
    ).resolves.toMatchObject({
      database: "istasyonos_migration_trial",
      serverHostname: "DESKTOP-LPUUGML",
      serverPort: 3306,
    });
    expect(fake.execute.mock.calls[0][0]).toContain("CURRENT_ROLE()");
    expect(fake.query).toHaveBeenCalledWith("SHOW GRANTS");
  });
  it.each([
    ["wrong server", { server_hostname: "OTHER-HOST" }],
    ["wrong port", { server_port: "3307" }],
    ["wrong database", { database_name: "istasyonos_demo" }],
    ["wrong user", { current_user: "root@localhost" }],
  ])("rejects %s before grant inspection", async (_label, overrides) => {
    fake.identity = { ...fake.identity, ...overrides };
    await expect(
      store().assertConnectionTarget({
        ...targetExpectation,
        requireTargetOnlyGrants: true,
      })
    ).rejects.toMatchObject({ code: "TARGET_IDENTITY_MISMATCH" });
    expect(fake.query).not.toHaveBeenCalledWith("SHOW GRANTS");
  });
  it("rejects active roles and broad or incomplete grants", async () => {
    fake.identity = { ...fake.identity, current_role: "admin@%" };
    await expect(
      store().assertConnectionTarget({
        ...targetExpectation,
        requireTargetOnlyGrants: true,
      })
    ).rejects.toMatchObject({ code: "TARGET_PRIVILEGE_REJECTED" });
    expect(() =>
      validateTargetOnlyMigrationGrants(
        [...fake.grants, "GRANT SELECT ON *.* TO `trial_migrator`@`localhost`"],
        "istasyonos_migration_trial",
        "trial_migrator@localhost"
      )
    ).toThrowError(/TARGET_PRIVILEGE_REJECTED/);
    expect(() =>
      validateTargetOnlyMigrationGrants(
        [
          ...fake.grants,
          "GRANT SELECT ON `istasyonos_migration_trial`.* TO `trial_migrator`@`localhost`",
        ],
        "istasyonos_migration_trial",
        "trial_migrator@localhost"
      )
    ).toThrowError(/TARGET_PRIVILEGE_REJECTED/);
    expect(() =>
      validateTargetOnlyMigrationGrants(
        [
          ...fake.grants,
          "GRANT INSERT ON `istasyonos_migration_trial`.* TO `trial_migrator`@`localhost`",
        ],
        "istasyonos_migration_trial",
        "trial_migrator@localhost"
      )
    ).toThrowError(/TARGET_PRIVILEGE_REJECTED/);
    expect(() =>
      validateTargetOnlyMigrationGrants(
        [
          ...fake.grants,
          "GRANT INDEX ON `istasyonos_migration_trial`.* TO `trial_migrator`@`localhost`",
        ],
        "istasyonos_migration_trial",
        "trial_migrator@localhost"
      )
    ).toThrowError(/TARGET_PRIVILEGE_REJECTED/);
    expect(() =>
      validateTargetOnlyMigrationGrants(
        [
          ...fake.grants,
          "GRANT DELETE ON `istasyonos_migration_trial`.`st_payments` TO `trial_migrator`@`localhost`",
        ],
        "istasyonos_migration_trial",
        "trial_migrator@localhost"
      )
    ).toThrowError(/TARGET_PRIVILEGE_REJECTED/);
    expect(() =>
      validateTargetOnlyMigrationGrants(
        fake.grants.filter(grant => !grant.includes("st_payments`")),
        "istasyonos_migration_trial",
        "trial_migrator@localhost"
      )
    ).toThrowError(/TARGET_PRIVILEGE_REJECTED/);
    expect(() =>
      validateTargetOnlyMigrationGrants(
        fake.grants.filter(grant => !grant.includes("st_slips`")),
        "istasyonos_migration_trial",
        "trial_migrator@localhost"
      )
    ).toThrowError(/TARGET_PRIVILEGE_REJECTED/);
    expect(() =>
      validateTargetOnlyMigrationGrants(
        ["GRANT USAGE ON *.* TO `trial_migrator`@`localhost`"],
        "istasyonos_migration_trial",
        "trial_migrator@localhost"
      )
    ).toThrowError(/TARGET_PRIVILEGE_REJECTED/);
  });
  it("does not write migrations when preflight fails", async () => {
    fake.identity = { ...fake.identity, server_hostname: "OTHER-HOST" };
    const migrationRunner = vi.fn();
    await expect(
      withMysqlMigrationStore(
        "mysql://trial_migrator:secret@127.0.0.1:3306/istasyonos_migration_trial",
        async connection => {
          await connection.assertConnectionTarget(targetExpectation);
          await migrationRunner();
        }
      )
    ).rejects.toMatchObject({ code: "TARGET_IDENTITY_MISMATCH" });
    expect(migrationRunner).not.toHaveBeenCalled();
    expect(
      fake.execute.mock.calls.every(
        call => !String(call[0]).startsWith("INSERT")
      )
    ).toBe(true);
    expect(
      fake.query.mock.calls.every(call => /^SET /.test(String(call[0])))
    ).toBe(true);
  });
  it("tek baÄŸlantÄ±da kilit alÄ±r/doÄŸrular/bÄ±rakÄ±r; havuz veya reconnect kullanmaz", async () => {
    await withMysqlMigrationStore(
      "mysql://synthetic.invalid/isolated_test",
      async connection => {
        expect(await connection.acquireLock("test-lock", 7)).toBe(true);
        await connection.assertLock("test-lock");
        await connection.releaseLock("test-lock");
      }
    );
    expect(fake.connect).toHaveBeenCalledOnce();
    expect(fake.connect).toHaveBeenCalledWith(
      expect.objectContaining({ multipleStatements: false, timezone: "Z" })
    );
    expect(fake.execute).toHaveBeenCalledWith(
      "SELECT GET_LOCK(?, ?) AS acquired",
      ["test-lock", 7]
    );
    expect(fake.query).toHaveBeenCalledWith("SET autocommit = 1");
    expect(fake.end).toHaveBeenCalledOnce();
  });
  it("kilit timeout, NULL, sahiplik kaybÄ± ve bÄ±rakma hatasÄ±nÄ± ayÄ±rÄ±r", async () => {
    fake.acquired = 0;
    expect(await store().acquireLock("x", 0)).toBe(false);
    fake.acquired = null;
    await expect(store().acquireLock("x", 0)).rejects.toMatchObject({
      code: "LOCK_FAILED",
    });
    fake.owner = null;
    await expect(store().assertLock("x")).rejects.toMatchObject({
      code: "LOCK_LOST",
    });
    fake.released = 0;
    await expect(store().releaseLock("x")).rejects.toMatchObject({
      code: "LOCK_RELEASE_FAILED",
    });
  });
  it("STARTED DDL'den Ã¶nce yazÄ±lÄ±r; native geÃ§miÅŸ ve APPLIED tek DML transaction'Ä±dÄ±r", async () => {
    const connection = store();
    await connection.start(migration);
    await connection.executeStatement(migration.statements[0]);
    await connection.finish(migration, "test-lock");
    const started = fake.execute.mock.calls.findIndex(call =>
      String(call[0]).includes("'STARTED')")
    );
    expect(started).toBeGreaterThanOrEqual(0);
    expect(fake.execute.mock.invocationCallOrder[started]).toBeLessThan(
      fake.query.mock.invocationCallOrder[0]
    );
    expect(fake.beginTransaction).toHaveBeenCalledOnce();
    expect(fake.commit).toHaveBeenCalledOnce();
    expect(fake.rollback).not.toHaveBeenCalled();
  });
  it("geÃ§miÅŸ yazÄ±mÄ± hatasÄ±nda yalnÄ±z DML'yi geri alÄ±r; otomatik DDL geri alma yok", async () => {
    const original = fake.execute.getMockImplementation()!;
    fake.execute.mockImplementation(async (sql: string, ...args: unknown[]) => {
      if (sql.includes("INSERT INTO st_schema_migrations"))
        throw new Error("synthetic history failure");
      return original(sql, ...args);
    });
    await expect(store().finish(migration, "test-lock")).rejects.toThrow(
      "synthetic"
    );
    expect(fake.rollback).toHaveBeenCalledOnce();
    expect(fake.commit).not.toHaveBeenCalled();
    expect(fake.query).not.toHaveBeenCalled();
  });
  it("baÄŸlantÄ± hatasÄ±nda DSN ve hata ayrÄ±ntÄ±sÄ±nÄ± sÄ±zdÄ±rmaz", async () => {
    fake.connect.mockRejectedValue(
      new Error("mysql://secret-user:secret-pass@secret-host/private")
    );
    await expect(
      withMysqlMigrationStore("synthetic", async () => undefined)
    ).rejects.toMatchObject({ code: "MIGRATION_CONNECTION_FAILED" });
    await expect(
      withMysqlMigrationStore("synthetic", async () => undefined)
    ).rejects.not.toThrow("secret-pass");
  });
  it("end hatasÄ±nda baÄŸlantÄ±yÄ± destroy eder", async () => {
    fake.end.mockRejectedValue(new Error("synthetic close failure"));
    await withMysqlMigrationStore("synthetic", async () => undefined);
    expect(fake.destroy).toHaveBeenCalledOnce();
  });
  it("normal startup boÅŸ geÃ§miÅŸte durur; hiÃ§bir CREATE/INSERT/UPDATE Ã§alÄ±ÅŸtÄ±rmaz", async () => {
    vi.stubEnv("DATABASE_URL", "mysql://synthetic.invalid/isolated_test");
    await expect(assertMigrationReady()).rejects.toMatchObject({
      code: "MIGRATIONS_PENDING",
    });
    expect(
      fake.query.mock.calls.every(call => /^SET /.test(String(call[0])))
    ).toBe(true);
    expect(
      fake.execute.mock.calls.every(call => /^SELECT /.test(String(call[0])))
    ).toBe(true);
  });
  it("normal startup doÄŸrulanmÄ±ÅŸ geÃ§miÅŸi salt okunur kabul eder", async () => {
    vi.stubEnv("DATABASE_URL", "mysql://synthetic.invalid/isolated_test");
    const catalog = await loadCatalog(process.cwd());
    fake.tables = [
      "__drizzle_migrations",
      "st_schema_migrations",
      "st_migration_guard",
      ...catalog.migrations.flatMap(m =>
        m.statements
          .map(
            sql =>
              /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?`?([a-z0-9_]+)`?/i.exec(
                sql
              )?.[1]
          )
          .filter((value): value is string => Boolean(value))
      ),
    ];
    fake.nativeDrizzle = catalog.migrations
      .filter(m => m.kind === "drizzle")
      .map((m, index) => ({
        id: index + 1,
        hash: m.checksum,
        created_at: m.timestamp,
      }));
    fake.nativeOperations = catalog.migrations
      .filter(m => m.kind === "operations")
      .map(m => ({ version: m.version, applied_at: "2026-10-28 12:00:00" }));
    fake.guards = catalog.migrations.map(m => ({
      kind: m.kind,
      version: m.version,
      source_index: m.sourceIndex,
      checksum: m.checksum,
      status: "APPLIED",
      review_reference: null,
    }));
    await assertMigrationReady();
    expect(
      fake.execute.mock.calls.every(call => /^SELECT /.test(String(call[0])))
    ).toBe(true);
    expect(
      fake.query.mock.calls.every(call => /^SET /.test(String(call[0])))
    ).toBe(true);
  });
});

describe("KontrollÃ¼ CLI â€” eksik yetkilendirmede env/DB eriÅŸimi yok", () => {
  it.each(
    [
      [],
      ["blocked"],
      ["apply"],
      ["status"],
      [
        "apply",
        "--database",
        "isolated_test",
        "--manifest-sha256",
        "0".repeat(64),
      ],
      [
        "baseline",
        "--database",
        "isolated_test",
        "--manifest-sha256",
        "0".repeat(64),
      ],
    ].map(args => ({ args }))
  )("eksik aÃ§Ä±k hedef/onayda durur: $args", async ({ args }) => {
    await expect(runMigrationCli(args)).rejects.toThrow();
    expect(fake.connect).not.toHaveBeenCalled();
  });
  it("dosya denetimi DB veya .env yÃ¼klemez", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    try {
      await runMigrationCli(["check-files"]);
      expect(fake.connect).not.toHaveBeenCalled();
      expect(fake.query).not.toHaveBeenCalled();
      expect(fake.execute).not.toHaveBeenCalled();
    } finally {
      log.mockRestore();
    }
  });
  it("trial status boş hedef beklentisi olmadan bağlantı açmaz", async () => {
    await expect(
      runMigrationCli([
        "status",
        "--database",
        "istasyonos_migration_trial",
        "--manifest-sha256",
        "3e6ce8ee6a5a295bdcddc3b5de271f4299f838bc40632bab26cac6a99611ff01",
        "--target-profile",
        "istasyonos-trial",
        "--expected-current-user",
        "stationos_trial_migrator@127.0.0.1",
      ])
    ).rejects.toMatchObject({ code: "TRIAL_EMPTY_STATUS_ACK_REQUIRED" });
    expect(fake.connect).not.toHaveBeenCalled();
    expect(fake.query).not.toHaveBeenCalled();
    expect(fake.execute).not.toHaveBeenCalled();
    await expect(
      runMigrationCli([
        "apply",
        "--database",
        "istasyonos_migration_trial",
        "--manifest-sha256",
        "3e6ce8ee6a5a295bdcddc3b5de271f4299f838bc40632bab26cac6a99611ff01",
        "--target-profile",
        "istasyonos-trial",
        "--expected-current-user",
        "stationos_trial_migrator@127.0.0.1",
        "--apply",
        "--expect-empty-trial",
      ])
    ).rejects.toMatchObject({ code: "TRIAL_EMPTY_STATUS_ACK_REQUIRED" });
    expect(fake.connect).not.toHaveBeenCalled();
  });
});

describe("trial migration target profile", () => {
  it("uses separate trial credentials and never falls back to DATABASE_URL", () => {
    const base = {
      DATABASE_URL: "mysql://production:secret@db.invalid/production",
    } as NodeJS.ProcessEnv;
    expect(() =>
      resolveMigrationUri(
        "istasyonos-trial",
        "istasyonos_migration_trial",
        base
      )
    ).toThrowError(/TRIAL_MIGRATION_CONFIG_REJECTED/);
    const uri = resolveMigrationUri(
      "istasyonos-trial",
      "istasyonos_migration_trial",
      {
        ...base,
        ST_TRIAL_MIGRATION_DB_ENABLED: "true",
        ST_TRIAL_MIGRATION_DB_HOST: "127.0.0.1",
        ST_TRIAL_MIGRATION_DB_PORT: "3306",
        ST_TRIAL_MIGRATION_DB_NAME: "istasyonos_migration_trial",
        ST_TRIAL_MIGRATION_DB_USER: "stationos_trial_migrator",
        ST_TRIAL_MIGRATION_DB_PASSWORD: "synthetic # secret",
        ST_TRIAL_MIGRATION_DB_CHARSET: "utf8mb4",
      }
    );
    const parsed = new URL(uri);
    expect(parsed.hostname).toBe("127.0.0.1");
    expect(parsed.port).toBe("3306");
    expect(parsed.pathname).toBe("/istasyonos_migration_trial");
    expect(parsed.username).toBe("stationos_trial_migrator");
    expect(decodeURIComponent(parsed.password)).toBe("synthetic # secret");
    expect(uri).not.toContain("production");
    const withoutDatabaseUrl = resolveMigrationUri(
      "istasyonos-trial",
      "istasyonos_migration_trial",
      {
        ST_TRIAL_MIGRATION_DB_ENABLED: "true",
        ST_TRIAL_MIGRATION_DB_HOST: "127.0.0.1",
        ST_TRIAL_MIGRATION_DB_PORT: "3306",
        ST_TRIAL_MIGRATION_DB_NAME: "istasyonos_migration_trial",
        ST_TRIAL_MIGRATION_DB_USER: "stationos_trial_migrator",
        ST_TRIAL_MIGRATION_DB_PASSWORD: "isolated secret",
      } as NodeJS.ProcessEnv
    );
    expect(new URL(withoutDatabaseUrl).pathname).toBe(
      "/istasyonos_migration_trial"
    );
  });
  it("rejects a migration URI for any other endpoint", () => {
    expect(() =>
      resolveMigrationUri("istasyonos-trial", "istasyonos_migration_trial", {
        ST_TRIAL_MIGRATION_DB_ENABLED: "true",
        ST_TRIAL_MIGRATION_DB_HOST: "127.0.0.2",
        ST_TRIAL_MIGRATION_DB_PORT: "3306",
        ST_TRIAL_MIGRATION_DB_NAME: "istasyonos_migration_trial",
        ST_TRIAL_MIGRATION_DB_USER: "stationos_trial_migrator",
        ST_TRIAL_MIGRATION_DB_PASSWORD: "secret",
      } as NodeJS.ProcessEnv)
    ).toThrowError(/TRIAL_MIGRATION_CONFIG_REJECTED/);
  });
  it("fails closed on missing account, wrong host/port or manifest", () => {
    const manifest =
      "3e6ce8ee6a5a295bdcddc3b5de271f4299f838bc40632bab26cac6a99611ff01";
    const base = [
      "mysql://stationos_trial_migrator:secret@127.0.0.1:3306/istasyonos_migration_trial",
      "istasyonos_migration_trial",
      "apply",
      "istasyonos-trial",
    ] as const;
    expect(() =>
      resolveMigrationTarget(...base, undefined, undefined, manifest)
    ).toThrowError(/TRIAL_TARGET_NOT_APPROVED/);
    expect(() =>
      resolveMigrationTarget(
        "mysql://stationos_trial_migrator:secret@127.0.0.2:3306/istasyonos_migration_trial",
        base[1],
        base[2],
        base[3],
        "stationos_trial_migrator@127.0.0.1",
        undefined,
        manifest
      )
    ).toThrowError(/TRIAL_TARGET_NOT_APPROVED/);
    expect(() =>
      resolveMigrationTarget(
        "mysql://stationos_trial_migrator:secret@127.0.0.1:3307/istasyonos_migration_trial",
        base[1],
        base[2],
        base[3],
        "stationos_trial_migrator@127.0.0.1",
        undefined,
        manifest
      )
    ).toThrowError(/TRIAL_TARGET_NOT_APPROVED/);
    expect(() =>
      resolveMigrationTarget(
        base[0],
        base[1],
        base[2],
        base[3],
        "stationos_trial_migrator@127.0.0.1",
        undefined,
        "0".repeat(64)
      )
    ).toThrowError(/TRIAL_TARGET_NOT_APPROVED/);
    expect(() =>
      resolveMigrationTarget(
        base[0],
        base[1],
        base[2],
        base[3],
        "stationos_trial_migrator@localhost",
        undefined,
        manifest
      )
    ).toThrowError(/TRIAL_TARGET_NOT_APPROVED/);
    expect(() =>
      resolveMigrationTarget(
        base[0],
        base[1],
        base[2],
        base[3],
        "other_user@127.0.0.1",
        undefined,
        manifest
      )
    ).toThrowError(/TRIAL_TARGET_NOT_APPROVED/);
  });
  it("pins exact trial target and requires the grant boundary in each mode", () => {
    const uri =
      "mysql://stationos_trial_migrator:secret@127.0.0.1:3306/istasyonos_migration_trial";
    const manifest =
      "3e6ce8ee6a5a295bdcddc3b5de271f4299f838bc40632bab26cac6a99611ff01";
    const target = resolveMigrationTarget(
      uri,
      "istasyonos_migration_trial",
      "apply",
      "istasyonos-trial",
      "stationos_trial_migrator@127.0.0.1",
      undefined,
      manifest
    );
    expect(target).toMatchObject({
      host: "127.0.0.1",
      port: 3306,
      database: "istasyonos_migration_trial",
      expectedServerHostname: "DESKTOP-LPUUGML",
      expectedCurrentUser: "stationos_trial_migrator@127.0.0.1",
      requireTargetOnlyGrants: true,
    });
    expect(
      resolveMigrationTarget(
        uri,
        "istasyonos_migration_trial",
        "status",
        "istasyonos-trial",
        "stationos_trial_migrator@127.0.0.1",
        undefined,
        manifest
      ).requireTargetOnlyGrants
    ).toBe(true);
    expect(
      resolveMigrationTarget(
        uri,
        "istasyonos_migration_trial",
        "baseline",
        "istasyonos-trial",
        "stationos_trial_migrator@127.0.0.1",
        undefined,
        manifest
      ).requireTargetOnlyGrants
    ).toBe(true);
  });
});

describe("DEMО migration profile safety", () => {
  const manifest =
    "3e6ce8ee6a5a295bdcddc3b5de271f4299f838bc40632bab26cac6a99611ff01";
  const environment = {
    DATABASE_URL:
      "mysql://main:never-fallback@db.example.invalid/istasyonos_db",
    STATIONOS_DEMO_MIGRATION_ENABLED: "true",
    STATIONOS_DEMO_MIGRATION_HOST: "127.0.0.1",
    STATIONOS_DEMO_MIGRATION_PORT: "3306",
    STATIONOS_DEMO_MIGRATION_USER: "stationos_demo_migrator",
    STATIONOS_DEMO_MIGRATION_PASSWORD: "synthetic demo secret",
    STATIONOS_DEMO_MIGRATION_EXPECTED_CURRENT_USER:
      "stationos_demo_migrator@127.0.0.1",
    STATIONOS_DEMO_MIGRATION_EXPECTED_SERVER_UUID:
      "123e4567-e89b-42d3-a456-426614174000",
  } as NodeJS.ProcessEnv;

  it("pins the DEMO URI, host identity, UUID, grant boundary and pending set", () => {
    const profile = resolveDemoMigrationProfile(
      "istasyonos_demo",
      manifest,
      environment
    );
    const uri = new URL(profile.uri);
    expect(uri.hostname).toBe("127.0.0.1");
    expect(uri.port).toBe("3306");
    expect(uri.pathname).toBe("/istasyonos_demo");
    expect(uri.username).toBe("stationos_demo_migrator");
    expect(decodeURIComponent(uri.password)).toBe("synthetic demo secret");
    expect(profile.expectation).toEqual({
      host: "127.0.0.1",
      port: 3306,
      database: "istasyonos_demo",
      urlUsername: "stationos_demo_migrator",
      expectedServerHostname: "DESKTOP-LPUUGML",
      expectedCurrentUser: "stationos_demo_migrator@127.0.0.1",
      expectedServerUuid: "123e4567-e89b-42d3-a456-426614174000",
      requireTargetOnlyGrants: true,
    });
    expect(demoMigrationExpectedPending).toEqual([
      "operations:0018_fast_payment",
      "operations:0019_pos_slip_ocr_drafts",
      "operations:0020_personnel_shift_assignments",
    ]);
    expect(profile.uri).not.toContain("never-fallback");
  });

  it("checks DEMO UUID and SHOW GRANTS on the same physical connection", async () => {
    const profile = resolveDemoMigrationProfile(
      "istasyonos_demo",
      manifest,
      environment
    );
    fake.identity = {
      database_name: "istasyonos_demo",
      server_hostname: "DESKTOP-LPUUGML",
      server_port: "3306",
      current_user: "stationos_demo_migrator@127.0.0.1",
      current_role: "NONE",
    };
    fake.serverUuid = "123e4567-e89b-42d3-a456-426614174000";
    fake.grants = fake.grants.map(grant =>
      grant
        .replaceAll("istasyonos_migration_trial", "istasyonos_demo")
        .replaceAll("trial_migrator", "stationos_demo_migrator")
        .replaceAll("localhost", "127.0.0.1")
    );
    await withMysqlMigrationStore(profile.uri, async connection => {
      await connection.assertConnectionTarget(profile.expectation);
    });
    expect(fake.connect).toHaveBeenCalledTimes(1);
    expect(fake.execute.mock.calls.map(([sql]) => sql)).toContain(
      "SELECT @@server_uuid AS server_uuid"
    );
    expect(fake.query).toHaveBeenCalledWith("SHOW GRANTS");
    expect(
      fake.execute.mock.calls.some(([sql]) =>
        /INSERT|UPDATE|DELETE|ALTER|CREATE/i.test(sql)
      )
    ).toBe(false);
  });

  it.each([
    ["disabled", { STATIONOS_DEMO_MIGRATION_ENABLED: "false" }],
    ["wrong host", { STATIONOS_DEMO_MIGRATION_HOST: "127.0.0.2" }],
    ["wrong port", { STATIONOS_DEMO_MIGRATION_PORT: "3307" }],
    ["wrong user", { STATIONOS_DEMO_MIGRATION_USER: "root" }],
    [
      "wrong principal",
      { STATIONOS_DEMO_MIGRATION_EXPECTED_CURRENT_USER: "root@localhost" },
    ],
    ["bad UUID", { STATIONOS_DEMO_MIGRATION_EXPECTED_SERVER_UUID: "unknown" }],
  ])("rejects %s without exposing credentials", (_label, override) => {
    expect(() =>
      resolveDemoMigrationProfile("istasyonos_demo", manifest, {
        ...environment,
        ...override,
      } as NodeJS.ProcessEnv)
    ).toThrowError(/DEMO_MIGRATION_CONFIG_REJECTED/);
    try {
      resolveDemoMigrationProfile("istasyonos_demo", manifest, {
        ...environment,
        ...override,
      } as NodeJS.ProcessEnv);
    } catch (error) {
      expect(String(error)).not.toContain("synthetic demo secret");
    }
  });

  it.each([
    ["trial database", "istasyonos_migration_trial"],
    ["main database", "istasyonos_db"],
    ["wrong manifest", "istasyonos_demo", "0".repeat(64)],
  ])("rejects %s", (_label, database, suppliedManifest = manifest) => {
    expect(() =>
      resolveDemoMigrationProfile(database, suppliedManifest, environment)
    ).toThrowError(/DEMO_MIGRATION_CONFIG_REJECTED/);
  });

  it("requires the exact DEMO pending acknowledgment before environment or DB access", async () => {
    const common = [
      "--database",
      "istasyonos_demo",
      "--manifest-sha256",
      manifest,
      "--target-profile",
      "istasyonos-demo",
    ];
    await expect(runMigrationCli(["status", ...common])).rejects.toMatchObject({
      code: "DEMO_MIGRATION_ACK_REQUIRED",
    });
    await expect(
      runMigrationCli([
        "status",
        "--database",
        "istasyonos_demo",
        "--manifest-sha256",
        manifest,
      ])
    ).rejects.toMatchObject({ code: "DEMO_MIGRATION_PROFILE_REQUIRED" });
    await expect(
      runMigrationCli(["apply", ...common, "--expect-demo-pending", "--apply"])
    ).rejects.toMatchObject({ code: "DEMO_MIGRATION_ACK_REQUIRED" });
    await expect(
      runMigrationCli(["baseline", ...common, "--expect-demo-pending"])
    ).rejects.toMatchObject({ code: "DEMO_MIGRATION_ACK_REQUIRED" });
    expect(fake.connect).not.toHaveBeenCalled();
    expect(fake.execute).not.toHaveBeenCalled();
  });

  it("does not borrow DATABASE_URL or another migration profile", () => {
    expect(() =>
      resolveMigrationUri(
        "istasyonos-demo",
        "istasyonos_demo",
        { DATABASE_URL: environment.DATABASE_URL } as NodeJS.ProcessEnv,
        manifest
      )
    ).toThrowError(/DEMO_MIGRATION_CONFIG_REJECTED/);
    expect(() =>
      resolveMigrationUri(undefined, "istasyonos_demo", {
        DATABASE_URL: "mysql://root:secret@127.0.0.1/istasyonos_demo",
      })
    ).not.toThrow();
  });
});

describe("izole ÖSSE uygulama test migrator profili", () => {
  const manifest =
    "3e6ce8ee6a5a295bdcddc3b5de271f4299f838bc40632bab26cac6a99611ff01";
  const baseEnvironment = {
    DATABASE_URL: "mysql://production:must-not-fallback@db.invalid/production",
    ST_TRIAL_MIGRATION_DB_ENABLED: "true",
    ST_TRIAL_MIGRATION_DB_HOST: "127.0.0.1",
    ST_TRIAL_MIGRATION_DB_PORT: "3306",
    ST_TRIAL_MIGRATION_DB_NAME: "istasyonos_migration_trial",
    ST_TRIAL_MIGRATION_DB_USER: "stationos_trial_migrator",
    ST_TRIAL_MIGRATION_DB_PASSWORD: "trial-secret",
    STATIONOS_APP_TEST_MODE: "1",
    STATIONOS_APP_TEST_DATABASE_URL:
      "mysql://stationos_oesse_runtime:runtime-secret@127.0.0.1/istasyonos_oesse_app_trial",
    STATIONOS_OESSE_MIGRATION_ENABLED: "true",
    STATIONOS_OESSE_MIGRATION_HOST: "127.0.0.1",
    STATIONOS_OESSE_MIGRATION_EXPECTED_HOST: "127.0.0.1",
    STATIONOS_OESSE_MIGRATION_PORT: "3306",
    STATIONOS_OESSE_MIGRATION_EXPECTED_PORT: "3306",
    STATIONOS_OESSE_MIGRATION_DATABASE: "istasyonos_oesse_app_trial",
    STATIONOS_OESSE_MIGRATION_USER: "stationos_oesse_migrator",
    STATIONOS_OESSE_MIGRATION_PASSWORD: " migration-secret # not logged ",
    STATIONOS_OESSE_MIGRATION_EXPECTED_CURRENT_USER:
      "stationos_oesse_migrator@10.20.30.40",
    STATIONOS_OESSE_MIGRATION_EXPECTED_SERVER_HOSTNAME: "isolated-oesse-mysql",
    STATIONOS_OESSE_MIGRATION_EXPECTED_SERVER_UUID:
      "123e4567-e89b-42d3-a456-426614174000",
  } as NodeJS.ProcessEnv;

  it("uses only its explicit credentials and pins target, account, server and manifest", () => {
    const profile = resolveOesseAppTrialMigrationProfile(
      "istasyonos_oesse_app_trial",
      manifest,
      baseEnvironment
    );
    const uri = new URL(profile.uri);
    expect(uri.hostname).toBe("127.0.0.1");
    expect(uri.port).toBe("3306");
    expect(uri.pathname).toBe("/istasyonos_oesse_app_trial");
    expect(uri.username).toBe("stationos_oesse_migrator");
    expect(decodeURIComponent(uri.password)).toBe(
      " migration-secret # not logged "
    );
    expect(profile.uri).not.toContain("production");
    expect(profile.uri).not.toContain("stationos_oesse_runtime");
    expect(profile.uri).not.toContain("stationos_trial_migrator");
    expect(profile.expectation).toEqual({
      host: "127.0.0.1",
      port: 3306,
      database: "istasyonos_oesse_app_trial",
      urlUsername: "stationos_oesse_migrator",
      expectedServerHostname: "isolated-oesse-mysql",
      expectedCurrentUser: "stationos_oesse_migrator@10.20.30.40",
      expectedServerUuid: "123e4567-e89b-42d3-a456-426614174000",
      requireTargetOnlyGrants: true,
    });

    const independentEnvironment = { ...baseEnvironment };
    for (const key of [
      "DATABASE_URL",
      "ST_TRIAL_MIGRATION_DB_ENABLED",
      "ST_TRIAL_MIGRATION_DB_HOST",
      "ST_TRIAL_MIGRATION_DB_PORT",
      "ST_TRIAL_MIGRATION_DB_NAME",
      "ST_TRIAL_MIGRATION_DB_USER",
      "ST_TRIAL_MIGRATION_DB_PASSWORD",
      "STATIONOS_APP_TEST_MODE",
      "STATIONOS_APP_TEST_DATABASE_URL",
    ])
      delete independentEnvironment[key];
    expect(
      resolveOesseAppTrialMigrationProfile(
        "istasyonos_oesse_app_trial",
        manifest,
        independentEnvironment
      ).uri
    ).toBe(profile.uri);
  });

  it.each([
    ["disabled profile", { STATIONOS_OESSE_MIGRATION_ENABLED: "false" }],
    ["wrong host", { STATIONOS_OESSE_MIGRATION_HOST: "db.example.test" }],
    ["wrong port", { STATIONOS_OESSE_MIGRATION_PORT: "3307" }],
    ["wrong database", { STATIONOS_OESSE_MIGRATION_DATABASE: "aksan_test" }],
    [
      "forbidden main DB",
      { STATIONOS_OESSE_MIGRATION_DATABASE: "istasyonos_db" },
    ],
    [
      "forbidden demo DB",
      { STATIONOS_OESSE_MIGRATION_DATABASE: "istasyonos_demo" },
    ],
    [
      "forbidden migration trial DB",
      { STATIONOS_OESSE_MIGRATION_DATABASE: "istasyonos_migration_trial" },
    ],
    [
      "runtime account",
      { STATIONOS_OESSE_MIGRATION_USER: "stationos_oesse_runtime" },
    ],
    [
      "trial account",
      { STATIONOS_OESSE_MIGRATION_USER: "stationos_trial_migrator" },
    ],
    [
      "runtime account",
      { STATIONOS_OESSE_MIGRATION_USER: "stationos_oesse_runtime" },
    ],
    [
      "wrong active account",
      { STATIONOS_OESSE_MIGRATION_EXPECTED_CURRENT_USER: "root@localhost" },
    ],
    [
      "wildcard account host",
      {
        STATIONOS_OESSE_MIGRATION_EXPECTED_CURRENT_USER:
          "stationos_oesse_migrator@%",
      },
    ],
    [
      "missing UUID",
      { STATIONOS_OESSE_MIGRATION_EXPECTED_SERVER_UUID: undefined },
    ],
  ] as const)("fails closed for %s", (_label, overrides) => {
    expect(() =>
      resolveOesseAppTrialMigrationProfile(
        "istasyonos_oesse_app_trial",
        manifest,
        { ...baseEnvironment, ...overrides } as NodeJS.ProcessEnv
      )
    ).toThrowError(/OESSE_APP_MIGRATION_CONFIG_REJECTED/);
  });

  it("rejects a different DB argument and manifest without resolving any fallback", () => {
    expect(() =>
      resolveOesseAppTrialMigrationProfile(
        "istasyonos_demo",
        manifest,
        baseEnvironment
      )
    ).toThrowError(/OESSE_APP_MIGRATION_CONFIG_REJECTED/);
    expect(() =>
      resolveOesseAppTrialMigrationProfile(
        "istasyonos_oesse_app_trial",
        "0".repeat(64),
        baseEnvironment
      )
    ).toThrowError(/OESSE_APP_MIGRATION_CONFIG_REJECTED/);
    expect(() =>
      resolveMigrationUri(
        "istasyonos-oesse-app-trial",
        "istasyonos_oesse_app_trial",
        baseEnvironment
      )
    ).toThrowError(/OESSE_APP_MIGRATION_CONFIG_REJECTED/);
  });

  it("keeps the target tied to the canonical 0000–0020 catalog only", async () => {
    const catalog = await loadCatalog(process.cwd(), manifest);
    expect(catalog.manifestHash).toBe(manifest);
    expect(catalog.migrations).toHaveLength(21);
    expect(catalog.migrations[0].version).toBe("0000_initial_users");
    expect(catalog.migrations.at(-1)?.version).toBe(
      "0020_personnel_shift_assignments"
    );
  });

  it("status/apply acknowledge their target-specific safety gates before connecting", async () => {
    const common = [
      "--database",
      "istasyonos_oesse_app_trial",
      "--manifest-sha256",
      manifest,
      "--target-profile",
      "istasyonos-oesse-app-trial",
    ];
    await expect(runMigrationCli(["status", ...common])).rejects.toMatchObject({
      code: "OESSE_APP_MIGRATION_ACK_REQUIRED",
    });
    await expect(
      runMigrationCli(["apply", ...common, "--apply"])
    ).rejects.toMatchObject({ code: "OESSE_APP_MIGRATION_ACK_REQUIRED" });
    await expect(
      runMigrationCli([
        "apply",
        ...common,
        "--apply",
        "--confirm-oesse-app-trial-apply",
        "--expect-empty-app-trial",
      ])
    ).rejects.toMatchObject({ code: "OESSE_APP_MIGRATION_ACK_REQUIRED" });
    await expect(
      runMigrationCli([
        "status",
        ...common,
        "--expect-empty-app-trial",
        "--expected-current-user",
        "root@localhost",
      ])
    ).rejects.toMatchObject({ code: "OESSE_APP_MIGRATION_CONFIG_REJECTED" });
    expect(fake.connect).not.toHaveBeenCalled();
    expect(fake.execute).not.toHaveBeenCalled();
  });

  it("checks server identity and grants on one dedicated connection before any DDL", async () => {
    const profile = resolveOesseAppTrialMigrationProfile(
      "istasyonos_oesse_app_trial",
      manifest,
      baseEnvironment
    );
    fake.identity = {
      database_name: "istasyonos_oesse_app_trial",
      server_hostname: "isolated-oesse-mysql",
      server_port: "3306",
      current_user: "stationos_oesse_migrator@10.20.30.40",
      current_role: "NONE",
    };
    fake.grants = [
      "GRANT USAGE ON *.* TO `stationos_oesse_migrator`@`10.20.30.40`",
      "GRANT ALTER, CREATE, REFERENCES ON `istasyonos_oesse_app_trial`.* TO `stationos_oesse_migrator`@`10.20.30.40`",
      "GRANT CREATE, INSERT, INDEX ON `istasyonos_oesse_app_trial`.`st_stations` TO `stationos_oesse_migrator`@`10.20.30.40`",
      "GRANT CREATE, INSERT ON `istasyonos_oesse_app_trial`.`st_member_stations` TO `stationos_oesse_migrator`@`10.20.30.40`",
      "GRANT CREATE, INSERT, INDEX ON `istasyonos_oesse_app_trial`.`st_shifts` TO `stationos_oesse_migrator`@`10.20.30.40`",
      "GRANT CREATE, SELECT, INSERT ON `istasyonos_oesse_app_trial`.`__drizzle_migrations` TO `stationos_oesse_migrator`@`10.20.30.40`",
      "GRANT CREATE, SELECT, INSERT ON `istasyonos_oesse_app_trial`.`st_schema_migrations` TO `stationos_oesse_migrator`@`10.20.30.40`",
      "GRANT CREATE, SELECT, INSERT, UPDATE ON `istasyonos_oesse_app_trial`.`st_migration_guard` TO `stationos_oesse_migrator`@`10.20.30.40`",
      "GRANT CREATE, INSERT, INDEX ON `istasyonos_oesse_app_trial`.`st_slips` TO `stationos_oesse_migrator`@`10.20.30.40`",
      "GRANT CREATE, INSERT ON `istasyonos_oesse_app_trial`.`st_tank_photo_reviews` TO `stationos_oesse_migrator`@`10.20.30.40`",
      "GRANT CREATE, INSERT ON `istasyonos_oesse_app_trial`.`st_daily_report_packages` TO `stationos_oesse_migrator`@`10.20.30.40`",
      "GRANT CREATE, INSERT ON `istasyonos_oesse_app_trial`.`st_tank_requests` TO `stationos_oesse_migrator`@`10.20.30.40`",
      "GRANT CREATE, INSERT ON `istasyonos_oesse_app_trial`.`st_tanker_document_reads` TO `stationos_oesse_migrator`@`10.20.30.40`",
      "GRANT CREATE, INSERT ON `istasyonos_oesse_app_trial`.`st_payments` TO `stationos_oesse_migrator`@`10.20.30.40`",
    ];

    await withMysqlMigrationStore(profile.uri, async sameConnection => {
      await sameConnection.assertConnectionTarget(profile.expectation);
      return undefined;
    });

    expect(fake.connect).toHaveBeenCalledTimes(1);
    expect(fake.query).toHaveBeenCalledWith("SHOW GRANTS");
    expect(
      fake.execute.mock.calls.some(([sql]) =>
        String(sql).startsWith("CREATE TABLE")
      )
    ).toBe(false);
    expect(fake.end).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["wrong server identity", { server_hostname: "other-server" }],
    ["wrong DB", { database_name: "istasyonos_demo" }],
    ["wrong account", { current_user: "stationos_oesse_runtime@localhost" }],
    ["active role", { current_role: "migration_admin@%" }],
  ])(
    "rejects %s on the checked connection before grant/DDL",
    async (_label, override) => {
      const profile = resolveOesseAppTrialMigrationProfile(
        "istasyonos_oesse_app_trial",
        manifest,
        baseEnvironment
      );
      fake.identity = {
        database_name: "istasyonos_oesse_app_trial",
        server_hostname: "isolated-oesse-mysql",
        server_port: "3306",
        current_user: "stationos_oesse_migrator@10.20.30.40",
        current_role: "NONE",
        ...override,
      };

      await expect(
        withMysqlMigrationStore(profile.uri, sameConnection =>
          sameConnection.assertConnectionTarget(profile.expectation)
        )
      ).rejects.toMatchObject({
        code:
          override.current_role === undefined
            ? "TARGET_IDENTITY_MISMATCH"
            : "TARGET_PRIVILEGE_REJECTED",
      });
      expect(fake.connect).toHaveBeenCalledTimes(1);
      expect(
        fake.execute.mock.calls.some(([sql]) =>
          String(sql).startsWith("CREATE TABLE")
        )
      ).toBe(false);
    }
  );

  it("rejects excess grant before any migration statement", async () => {
    const profile = resolveOesseAppTrialMigrationProfile(
      "istasyonos_oesse_app_trial",
      manifest,
      baseEnvironment
    );
    fake.identity = {
      database_name: "istasyonos_oesse_app_trial",
      server_hostname: "isolated-oesse-mysql",
      server_port: "3306",
      current_user: "stationos_oesse_migrator@10.20.30.40",
      current_role: "NONE",
    };
    fake.grants = [
      "GRANT ALL PRIVILEGES ON *.* TO `stationos_oesse_migrator`@`10.20.30.40`",
    ];
    await expect(
      withMysqlMigrationStore(profile.uri, sameConnection =>
        sameConnection.assertConnectionTarget(profile.expectation)
      )
    ).rejects.toMatchObject({ code: "TARGET_PRIVILEGE_REJECTED" });
    expect(
      fake.execute.mock.calls.some(([sql]) =>
        String(sql).startsWith("CREATE TABLE")
      )
    ).toBe(false);
  });

  it("rejects a changed server UUID before any migration statement", async () => {
    const profile = resolveOesseAppTrialMigrationProfile(
      "istasyonos_oesse_app_trial",
      manifest,
      baseEnvironment
    );
    fake.identity = {
      database_name: "istasyonos_oesse_app_trial",
      server_hostname: "isolated-oesse-mysql",
      server_port: "3306",
      current_user: "stationos_oesse_migrator@10.20.30.40",
      current_role: "NONE",
    };
    fake.serverUuid = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    await expect(
      withMysqlMigrationStore(profile.uri, sameConnection =>
        sameConnection.assertConnectionTarget(profile.expectation)
      )
    ).rejects.toMatchObject({ code: "TARGET_SERVER_UUID_MISMATCH" });
    expect(fake.connect).toHaveBeenCalledTimes(1);
    expect(
      fake.execute.mock.calls.some(([sql]) =>
        String(sql).startsWith("CREATE TABLE")
      )
    ).toBe(false);
  });

  it("a manifest mismatch is rejected before dotenv, connection or writes", async () => {
    await expect(
      runMigrationCli([
        "status",
        "--database",
        "istasyonos_oesse_app_trial",
        "--manifest-sha256",
        "0".repeat(64),
        "--target-profile",
        "istasyonos-oesse-app-trial",
        "--expect-empty-app-trial",
      ])
    ).rejects.toThrow();
    expect(fake.connect).not.toHaveBeenCalled();
    expect(fake.query).not.toHaveBeenCalled();
    expect(fake.execute).not.toHaveBeenCalled();
  });
});

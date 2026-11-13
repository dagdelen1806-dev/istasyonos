import { describe, expect, it, vi } from "vitest";
import { loadCatalog, migrationKey, sha256, type Migration } from "./catalog";
import {
  runMigrations,
  validateHistory,
  type Guard,
  type MigrationStore,
  type Snapshot,
} from "./engine";

const plan: Migration[] = [
  {
    kind: "drizzle",
    version: "0000_users",
    sourceIndex: 0,
    file: "drizzle/0000_users.sql",
    timestamp: 1000,
    checksum: sha256("users"),
    statements: ["CREATE TABLE IF NOT EXISTS users (id INT)"],
  },
  {
    kind: "operations",
    version: "0001_operation",
    sourceIndex: 0,
    file: "server/stationos/migrations/0001_operation.sql",
    checksum: sha256("operation"),
    statements: [
      "CREATE TABLE IF NOT EXISTS st_example (id INT)",
      "ALTER TABLE st_example ADD COLUMN label INT",
    ],
  },
  {
    kind: "operations",
    version: "0002_next",
    sourceIndex: 1,
    file: "server/stationos/migrations/0002_next.sql",
    checksum: sha256("next"),
    statements: ["ALTER TABLE st_example ADD COLUMN next_value INT"],
  },
];
type MemoryDatabase = {
  snapshot: Snapshot;
  lockOwner: number | null;
  ddl: string[];
};
function database(): MemoryDatabase {
  return {
    snapshot: { tables: [], drizzle: [], operations: [], guards: [] },
    lockOwner: null,
    ddl: [],
  };
}
class MemoryStore implements MigrationStore {
  releases = 0;
  bootstraps = 0;
  failStatement = 0;
  statements = 0;
  failConnection = false;
  loseLock = false;
  releaseFailure = false;
  pause?: () => Promise<void>;
  constructor(
    readonly db = database(),
    readonly id = 1
  ) {}
  async database() {
    if (this.failConnection) throw new Error("synthetic DSN must not leak");
    return "isolated_test";
  }
  async acquireLock(_name: string, _timeout: number) {
    if (this.db.lockOwner !== null && this.db.lockOwner !== this.id)
      return false;
    this.db.lockOwner = this.id;
    return true;
  }
  async assertLock(_name: string) {
    if (this.db.lockOwner !== this.id)
      throw new Error("synthetic connection/lock loss");
  }
  async releaseLock(_name: string) {
    this.releases++;
    if (this.releaseFailure) throw new Error("synthetic release failure");
    if (this.db.lockOwner !== this.id) throw new Error("not lock owner");
    this.db.lockOwner = null;
  }
  async snapshot() {
    return structuredClone(this.db.snapshot);
  }
  async bootstrap() {
    this.bootstraps++;
    for (const table of [
      "st_migration_guard",
      "__drizzle_migrations",
      "st_schema_migrations",
    ])
      if (!this.db.snapshot.tables.includes(table))
        this.db.snapshot.tables.push(table);
  }
  async start(migration: Migration) {
    this.db.snapshot.guards.push({ ...migration, status: "STARTED" });
  }
  async executeStatement(sql: string) {
    this.statements++;
    if (this.pause) {
      const pause = this.pause;
      this.pause = undefined;
      await pause();
    }
    if (this.statements === this.failStatement)
      throw new Error("synthetic DDL error");
    this.db.ddl.push(sql);
    const table = /CREATE TABLE IF NOT EXISTS (\w+)/.exec(sql)?.[1];
    if (table && !this.db.snapshot.tables.includes(table))
      this.db.snapshot.tables.push(table);
    if (this.loseLock) {
      this.db.lockOwner = null;
      throw new Error("synthetic disconnect after DDL");
    }
  }
  async finish(migration: Migration, name: string) {
    await this.assertLock(name);
    if (migration.kind === "drizzle")
      this.db.snapshot.drizzle.push({
        id: this.db.snapshot.drizzle.length + 1,
        hash: migration.checksum,
        createdAt: migration.timestamp!,
      });
    else
      this.db.snapshot.operations.push({
        version: migration.version,
        appliedAt: "2026-10-28 12:00:00",
      });
    this.db.snapshot.guards.find(
      g => migrationKey(g) === migrationKey(migration)
    )!.status = "APPLIED";
  }
  async baseline(migration: Migration, reference: string) {
    this.db.snapshot.guards.push({
      ...migration,
      status: "BASELINED",
      reviewReference: reference,
    });
  }
}
const apply = (store: MigrationStore, migrations = plan) =>
  runMigrations(store, migrations, {
    mode: "apply",
    database: "isolated_test",
    lockTimeout: 0,
  });

describe("Güvenli migration motoru — yalnız bellek, gerçek DB yok", () => {
  it.each(["STARTED", "FAILED"] as const)(
    "%s kaydını otomatik başarılı saymaz",
    async status => {
      const store = new MemoryStore();
      await apply(store);
      store.db.snapshot.guards[1].status = status;
      await expect(apply(store)).rejects.toMatchObject({
        code: "INCOMPLETE_MIGRATION",
      });
      expect(store.db.ddl).toHaveLength(4);
    }
  );
  it("ilk migration DDL'sinden sonraki kopmada retry inceleme ister", async () => {
    const store = new MemoryStore();
    store.loseLock = true;
    await expect(apply(store)).rejects.toThrow();
    store.loseLock = false;
    await expect(apply(store)).rejects.toMatchObject({
      code: "INCOMPLETE_MIGRATION",
    });
    expect(store.db.ddl).toHaveLength(1);
  });
  it("guard checksum/sıra/inceleme bilgisindeki belirsizlikleri kabul etmez", async () => {
    const store = new MemoryStore();
    await apply(store);
    const snapshot = await store.snapshot();
    const missing = structuredClone(snapshot);
    missing.guards[1].checksum = "";
    expect(() => validateHistory(plan, missing)).toThrow("CHECKSUM_MISMATCH");
    const order = structuredClone(snapshot);
    order.guards[1].sourceIndex = 999;
    expect(() => validateHistory(plan, order)).toThrow("MIGRATION_ORDER");
    const review = structuredClone(snapshot);
    review.guards[1].status = "BASELINED";
    expect(() => validateHistory(plan, review)).toThrow("MISSING_REVIEW");
    const mismatch = structuredClone(snapshot);
    mismatch.operations.pop();
    expect(() => validateHistory(plan, mismatch)).toThrow("HISTORY_MISMATCH");
  });
  it("Windows schema harf farkını aynı kilit adına indirger", async () => {
    const store = new MemoryStore();
    store.database = async () => "Isolated_Test";
    const acquire = vi.spyOn(store, "acquireLock");
    await runMigrations(store, plan, {
      mode: "status",
      database: "Isolated_Test",
      lockTimeout: 0,
    });
    expect(acquire).toHaveBeenCalledWith(
      `stationos:migrate:${sha256("isolated_test").slice(0, 40)}`,
      0
    );
  });
  it("Drizzle önce, operasyon sonra; ikinci çalıştırmada hiçbir DDL tekrar etmez", async () => {
    const store = new MemoryStore();
    expect(await apply(store)).toMatchObject({ applied: 3, pending: [] });
    expect(store.db.ddl).toEqual(plan.flatMap(m => m.statements));
    expect(store.db.snapshot.drizzle[0].hash).toBe(plan[0].checksum);
    expect(store.db.snapshot.operations.map(row => row.version)).toEqual(
      plan.slice(1).map(m => m.version)
    );
    const snapshot = await store.snapshot();
    await apply(store);
    expect(await store.snapshot()).toEqual(snapshot);
    expect(store.db.ddl).toHaveLength(4);
    expect(store.releases).toBe(2);
  });
  it("uygulanmış dosyanın checksum değişimini reddeder", async () => {
    const store = new MemoryStore();
    await apply(store);
    const changed = structuredClone(plan);
    changed[1].checksum = sha256("edited");
    await expect(apply(store, changed)).rejects.toMatchObject({
      code: "CHECKSUM_MISMATCH",
    });
    expect(store.db.ddl).toHaveLength(4);
  });
  it("eski kayıtta eksik checksum'ı otomatik sahiplenmez; açık baseline geçmişi korur", async () => {
    const store = new MemoryStore();
    await apply(store);
    store.db.snapshot.guards = [];
    const native = structuredClone({
      drizzle: store.db.snapshot.drizzle,
      operations: store.db.snapshot.operations,
    });
    await expect(apply(store)).rejects.toMatchObject({
      code: "MISSING_CHECKSUM",
    });
    await expect(
      runMigrations(store, plan, {
        mode: "baseline",
        database: "isolated_test",
      })
    ).rejects.toMatchObject({ code: "MISSING_REVIEW" });
    expect(
      (
        await runMigrations(store, plan, {
          mode: "baseline",
          database: "isolated_test",
          reviewReference: "REVIEW-TEST-1",
        })
      ).baselined
    ).toBe(3);
    expect({
      drizzle: store.db.snapshot.drizzle,
      operations: store.db.snapshot.operations,
    }).toEqual(native);
    expect(store.db.ddl).toHaveLength(4);
    expect(
      (
        await runMigrations(store, plan, {
          mode: "baseline",
          database: "isolated_test",
          reviewReference: "REVIEW-TEST-2",
        })
      ).baselined
    ).toBe(0);
  });
  it("eski Drizzle hash uyuşmazlığını baseline ile de kabul etmez", async () => {
    const store = new MemoryStore();
    await apply(store);
    store.db.snapshot.guards = [];
    store.db.snapshot.drizzle[0].hash = sha256("unknown");
    await expect(
      runMigrations(store, plan, {
        mode: "baseline",
        database: "isolated_test",
        reviewReference: "TEST",
      })
    ).rejects.toMatchObject({ code: "CHECKSUM_MISMATCH" });
  });
  it("eşzamanlı ikinci çalıştırıcı kilidi alamaz; yalnız ilk işlem yazar", async () => {
    const db = database(),
      first = new MemoryStore(db, 1),
      second = new MemoryStore(db, 2);
    let unblock!: () => void, entered!: () => void;
    const ready = new Promise<void>(resolve => {
      entered = resolve;
    });
    first.pause = () => {
      entered();
      return new Promise<void>(resolve => {
        unblock = resolve;
      });
    };
    const running = apply(first);
    await ready;
    await expect(apply(second)).rejects.toMatchObject({ code: "LOCK_TIMEOUT" });
    expect(second.bootstraps).toBe(0);
    expect(second.releases).toBe(0);
    unblock();
    await running;
    expect(db.ddl).toHaveLength(4);
    expect(db.lockOwner).toBeNull();
  });
  it("kilit zaman aşımında geçmişe ve şemaya dokunmaz", async () => {
    const store = new MemoryStore();
    store.db.lockOwner = 99;
    await expect(apply(store)).rejects.toMatchObject({ code: "LOCK_TIMEOUT" });
    expect(store.db.ddl).toEqual([]);
    expect(store.bootstraps).toBe(0);
  });
  it("ikinci DDL hatasında STARTED kalır; sonraki migration çalışmaz ve retry durur", async () => {
    const store = new MemoryStore();
    store.failStatement = 3;
    await expect(apply(store)).rejects.toMatchObject({
      code: "MIGRATION_CONNECTION_OR_DDL_FAILED",
    });
    expect(store.db.ddl).toHaveLength(2);
    expect(store.db.snapshot.guards[1].status).toBe("STARTED");
    expect(store.db.snapshot.operations).toEqual([]);
    store.failStatement = 0;
    await expect(apply(store)).rejects.toMatchObject({
      code: "INCOMPLETE_MIGRATION",
    });
    expect(store.db.ddl).toHaveLength(2);
  });
  it("bağlantı DDL sonrasında koparsa native geçmiş ilerlemez", async () => {
    const store = new MemoryStore();
    store.loseLock = true;
    await expect(apply(store)).rejects.toMatchObject({
      code: "MIGRATION_CONNECTION_OR_DDL_FAILED",
    });
    expect(store.db.snapshot.guards[0].status).toBe("STARTED");
    expect(store.db.snapshot.drizzle).toEqual([]);
    expect(store.db.ddl).toHaveLength(1);
  });
  it("migration sırası boşluklu veya Drizzle önkoşulu yoksa reddeder", async () => {
    const store = new MemoryStore();
    await apply(store);
    store.db.snapshot.operations.shift();
    await expect(apply(store)).rejects.toMatchObject({
      code: "MIGRATION_ORDER",
    });
    store.db.snapshot.drizzle = [];
    await expect(apply(store)).rejects.toMatchObject({
      code: "MIGRATION_ORDER",
    });
  });
  it("bağlantı hatasını gizli ayrıntı vermeden raporlar", async () => {
    const store = new MemoryStore();
    store.failConnection = true;
    await expect(apply(store)).rejects.toMatchObject({
      code: "MIGRATION_CONNECTION_OR_DDL_FAILED",
    });
    await expect(apply(store)).rejects.not.toThrow("DSN");
    expect(store.releases).toBe(0);
  });
  it("yanlış hedef DB ve geçersiz kilit süresinde yazmaz", async () => {
    const store = new MemoryStore();
    await expect(
      runMigrations(store, plan, { mode: "apply", database: "production" })
    ).rejects.toMatchObject({ code: "DATABASE_MISMATCH" });
    await expect(
      runMigrations(store, plan, {
        mode: "apply",
        database: "isolated_test",
        lockTimeout: -1,
      })
    ).rejects.toMatchObject({ code: "INVALID_OPTIONS" });
    expect(store.db.ddl).toEqual([]);
  });
  it("startup/status asla metadata oluşturmaz; pending veya şüpheli geçmişte durur", async () => {
    const store = new MemoryStore();
    const start = vi.spyOn(store, "start"),
      executeStatement = vi.spyOn(store, "executeStatement"),
      finish = vi.spyOn(store, "finish"),
      baseline = vi.spyOn(store, "baseline");
    expect(
      (
        await runMigrations(store, plan, {
          mode: "status",
          database: "isolated_test",
          requireEmptySchema: true,
          expectedPending: plan.map(migrationKey),
        })
      ).pending
    ).toHaveLength(3);
    await expect(
      runMigrations(store, plan, { mode: "ready", database: "isolated_test" })
    ).rejects.toMatchObject({ code: "MIGRATIONS_PENDING" });
    expect(store.bootstraps).toBe(0);
    expect(store.db.ddl).toEqual([]);
    expect(start).not.toHaveBeenCalled();
    expect(executeStatement).not.toHaveBeenCalled();
    expect(finish).not.toHaveBeenCalled();
    expect(baseline).not.toHaveBeenCalled();
    const nonEmpty = new MemoryStore();
    nonEmpty.db.snapshot.tables.push("unexpected_table");
    await expect(
      runMigrations(nonEmpty, plan, {
        mode: "status",
        database: "isolated_test",
        requireEmptySchema: true,
        expectedPending: plan.map(migrationKey),
      })
    ).rejects.toMatchObject({ code: "TRIAL_SCHEMA_NOT_EMPTY" });
    expect(nonEmpty.db.ddl).toEqual([]);
    expect(nonEmpty.bootstraps).toBe(0);
    const wrongPendingExpectation = new MemoryStore();
    await expect(
      runMigrations(wrongPendingExpectation, plan, {
        mode: "status",
        database: "isolated_test",
        requireEmptySchema: true,
        expectedPending: plan.slice(1).map(migrationKey),
      })
    ).rejects.toMatchObject({ code: "TRIAL_PENDING_SET_MISMATCH" });
    expect(wrongPendingExpectation.db.ddl).toEqual([]);
    expect(wrongPendingExpectation.bootstraps).toBe(0);
    await apply(store);
    const before = await store.snapshot();
    await runMigrations(store, plan, {
      mode: "ready",
      database: "isolated_test",
    });
    expect(await store.snapshot()).toEqual(before);
  });
  it("uygulama öncesi tam pending listesi farklıysa hiçbir DDL başlatmaz", async () => {
    const store = new MemoryStore();
    await expect(
      runMigrations(store, plan, {
        mode: "apply",
        database: "isolated_test",
        expectedPending: ["operations:0001_operation", "operations:0002_wrong"],
      })
    ).rejects.toMatchObject({ code: "TRIAL_PENDING_SET_MISMATCH" });
    expect(store.bootstraps).toBe(0);
    expect(store.db.ddl).toEqual([]);
    expect(store.db.snapshot.guards).toEqual([]);
  });
  it("DEMO history 0017'deyse yalnız 0018–0020 bekleyen kümesini salt-okunur doğrular", async () => {
    const catalog = await loadCatalog(process.cwd()),
      migrations = catalog.migrations,
      appliedMigrations = migrations.slice(0, 18),
      expectedPending = migrations.slice(18).map(migrationKey),
      store = new MemoryStore();
    store.db.snapshot = {
      tables: [
        "users",
        ...new Set(
          appliedMigrations.flatMap(migration =>
            migration.statements.flatMap(statement => {
              const match =
                /CREATE\s+TABLE(?:\s+IF\s+NOT\s+EXISTS)?\s+`?([a-z0-9_]+)/i.exec(
                  statement
                );
              return match?.[1] ? [match[1]] : [];
            })
          )
        ),
      ],
      drizzle: appliedMigrations
        .filter(migration => migration.kind === "drizzle")
        .map(migration => ({
          id: 1,
          hash: migration.checksum,
          createdAt: migration.timestamp!,
        })),
      operations: appliedMigrations
        .filter(migration => migration.kind === "operations")
        .map(migration => ({
          version: migration.version,
          appliedAt: "2026-11-12 00:00:00",
        })),
      guards: appliedMigrations.map(migration => ({
        kind: migration.kind,
        version: migration.version,
        sourceIndex: migration.sourceIndex,
        checksum: migration.checksum,
        status: "APPLIED" as const,
      })),
    };
    await expect(
      runMigrations(store, migrations, {
        mode: "status",
        database: "isolated_test",
        expectedPending,
      })
    ).resolves.toMatchObject({ applied: 18, pending: expectedPending });
    await expect(
      runMigrations(store, migrations, {
        mode: "apply",
        database: "isolated_test",
        expectedPending: expectedPending.slice(1),
      })
    ).rejects.toMatchObject({ code: "TRIAL_PENDING_SET_MISMATCH" });
    expect(store.bootstraps).toBe(0);
    expect(store.db.ddl).toEqual([]);
    expect(store.db.snapshot.operations.map(row => row.version)).toHaveLength(
      17
    );
  });
  it("ilk uygulama provası hedefi boş değilse bootstrap ve DDL başlatmaz", async () => {
    const nonEmpty = new MemoryStore();
    nonEmpty.db.snapshot.tables.push("legacy_or_unexpected_table");
    await expect(
      runMigrations(nonEmpty, plan, {
        mode: "apply",
        database: "isolated_test",
        requireEmptySchema: true,
        requireEmptyBeforeApply: true,
      })
    ).rejects.toMatchObject({ code: "TRIAL_SCHEMA_NOT_EMPTY" });
    expect(nonEmpty.bootstraps).toBe(0);
    expect(nonEmpty.db.ddl).toEqual([]);
    expect(nonEmpty.db.snapshot.guards).toEqual([]);
    expect(nonEmpty.statements).toBe(0);
  });
  it("bilinmeyen/tekrarlı güvenlik kaydını ve eksik fiziksel tabloyu reddeder", async () => {
    const store = new MemoryStore();
    await apply(store);
    store.db.snapshot.guards.push({
      ...store.db.snapshot.guards[0],
      version: "unknown",
    });
    expect(() => validateHistory(plan, store.db.snapshot)).toThrow(
      "UNKNOWN_HISTORY"
    );
    store.db.snapshot.guards.pop();
    store.db.snapshot.tables = store.db.snapshot.tables.filter(
      table => table !== "users"
    );
    expect(() => validateHistory(plan, store.db.snapshot)).toThrow(
      "SCHEMA_HISTORY_MISMATCH"
    );
  });
  it("geçmişsiz mevcut tabloyu boş DB saymaz", async () => {
    const store = new MemoryStore();
    store.db.snapshot.tables = ["users"];
    await expect(apply(store)).rejects.toMatchObject({
      code: "UNTRACKED_SCHEMA",
    });
  });
  it("kilit bırakma başarısızlığını başarı gibi göstermez", async () => {
    const store = new MemoryStore();
    store.releaseFailure = true;
    await expect(apply(store)).rejects.toMatchObject({
      code: "LOCK_RELEASE_FAILED",
    });
    expect(
      store.db.snapshot.guards.every(row => row.status === "APPLIED")
    ).toBe(true);
  });
  it("gelecekteki Drizzle ekini mevcut operasyon geçmişini yeniden numaralamadan uygular", async () => {
    const store = new MemoryStore();
    await apply(store);
    const next: Migration = {
      ...plan[0],
      version: "0001_users_extra",
      sourceIndex: 1,
      timestamp: 2000,
      checksum: sha256("users-extra"),
      statements: ["ALTER TABLE users ADD COLUMN extra INT"],
    };
    await apply(store, [plan[0], next, ...plan.slice(1)]);
    expect(store.db.snapshot.drizzle).toHaveLength(2);
    expect(store.db.snapshot.operations).toHaveLength(2);
  });
});

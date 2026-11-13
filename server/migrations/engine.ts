import {
  MigrationSafetyError,
  migrationKey,
  sha256,
  type Migration,
  type MigrationKind,
} from "./catalog";

export type Guard = {
  kind: MigrationKind;
  version: string;
  sourceIndex: number;
  checksum: string;
  status: "STARTED" | "APPLIED" | "BASELINED" | "FAILED";
  reviewReference?: string;
};
export type Snapshot = {
  tables: string[];
  drizzle: { id: number; hash: string; createdAt: number }[];
  operations: { version: string; appliedAt: string }[];
  guards: Guard[];
};
export interface MigrationStore {
  database(): Promise<string>;
  acquireLock(name: string, seconds: number): Promise<boolean>;
  assertLock(name: string): Promise<void>;
  releaseLock(name: string): Promise<void>;
  snapshot(): Promise<Snapshot>;
  bootstrap(): Promise<void>;
  start(migration: Migration): Promise<void>;
  executeStatement(sql: string): Promise<void>;
  finish(migration: Migration, lockName: string): Promise<void>;
  baseline(migration: Migration, reviewReference: string): Promise<void>;
}
function fail(code: string, message: string): never {
  throw new MigrationSafetyError(code, message);
}

export function validateHistory(
  migrations: Migration[],
  snapshot: Snapshot,
  allowLegacy = false
): Set<string> {
  const known = new Map(migrations.map(m => [migrationKey(m), m]));
  const applied = new Set<string>();
  const drizzle = migrations.filter(m => m.kind === "drizzle");
  const operations = migrations.filter(m => m.kind === "operations");
  for (const [index, row] of snapshot.drizzle.entries()) {
    const expected = drizzle[index];
    if (!expected || expected.timestamp !== row.createdAt)
      fail(
        "MIGRATION_ORDER",
        "Drizzle geçmişi journal sırasının kesintisiz bir başlangıcı değil."
      );
    if (expected.checksum !== row.hash)
      fail(
        "CHECKSUM_MISMATCH",
        `Drizzle geçmiş checksum uyuşmazlığı: ${expected.version}`
      );
    applied.add(migrationKey(expected));
  }
  for (const [index, row] of snapshot.operations.entries()) {
    const expected = operations[index];
    if (!expected || expected.version !== row.version)
      fail(
        "MIGRATION_ORDER",
        "Operasyon geçmişi dosya sırasının kesintisiz bir başlangıcı değil."
      );
    applied.add(migrationKey(expected));
  }
  if (snapshot.operations.length && !snapshot.drizzle.length)
    fail(
      "MIGRATION_ORDER",
      "Operasyon geçmişinden önce Drizzle kullanıcı şeması geçmişi gerekli."
    );
  const guards = new Map<string, Guard>();
  for (const guard of snapshot.guards) {
    const key = migrationKey(guard),
      expected = known.get(key);
    if (!expected || guards.has(key))
      fail(
        "UNKNOWN_HISTORY",
        "Bilinmeyen veya tekrarlanan migration güvenlik kaydı."
      );
    if (guard.status === "STARTED" || guard.status === "FAILED")
      fail(
        "INCOMPLETE_MIGRATION",
        `${key}: yarım/şüpheli işlem var. Yönetici incelemesi olmadan devam edilemez.`
      );
    if (!["APPLIED", "BASELINED"].includes(guard.status))
      fail("UNKNOWN_HISTORY", "Bilinmeyen migration durumu.");
    if (guard.checksum !== expected.checksum)
      fail("CHECKSUM_MISMATCH", `${key}: SHA-256 uyuşmuyor.`);
    if (guard.sourceIndex !== expected.sourceIndex)
      fail("MIGRATION_ORDER", `${key}: kaynak sırası değişmiş.`);
    if (guard.status === "BASELINED" && !guard.reviewReference)
      fail("MISSING_REVIEW", `${key}: başlangıç inceleme referansı yok.`);
    if (!applied.has(key))
      fail(
        "HISTORY_MISMATCH",
        `${key}: güvenlik kaydı ile yerel migration geçmişi eşleşmiyor.`
      );
    guards.set(key, guard);
  }
  if (
    !applied.size &&
    snapshot.tables.some(
      table =>
        table === "users" ||
        (table.startsWith("st_") &&
          !["st_schema_migrations", "st_migration_guard"].includes(table))
    )
  )
    fail(
      "UNTRACKED_SCHEMA",
      "Uygulama tabloları var fakat migration geçmişi yok. Otomatik sahiplenme yapılmaz."
    );
  for (const migration of migrations.filter(m =>
    applied.has(migrationKey(m))
  )) {
    if (!guards.has(migrationKey(migration)) && !allowLegacy)
      fail(
        "MISSING_CHECKSUM",
        `${migrationKey(migration)}: güvenilir başlangıç kaydı yok. Açık baseline incelemesi gerekli.`
      );
    for (const statement of migration.statements) {
      const table =
        /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?`?([a-z0-9_]+)`?/i.exec(
          statement
        )?.[1];
      if (table && !snapshot.tables.includes(table))
        fail(
          "SCHEMA_HISTORY_MISMATCH",
          `${migrationKey(migration)}: geçmişteki tablo eksik (${table}).`
        );
    }
  }
  return applied;
}

export async function runMigrations(
  store: MigrationStore,
  migrations: Migration[],
  options: {
    mode: "status" | "apply" | "baseline" | "ready";
    database: string;
    lockTimeout?: number;
    reviewReference?: string;
    requireEmptySchema?: boolean;
    requireEmptyBeforeApply?: boolean;
    expectedPending?: string[];
  }
): Promise<{ applied: number; pending: string[]; baselined: number }> {
  const seconds = options.lockTimeout ?? (options.mode === "ready" ? 0 : 10);
  if (!Number.isInteger(seconds) || seconds < 0 || seconds > 300)
    fail("INVALID_OPTIONS", "Kilit süresi 0–300 saniye olmalı.");
  let lockName = "",
    locked = false,
    failed = false;
  try {
    const database = await store.database();
    if (!database || database !== options.database)
      fail(
        "DATABASE_MISMATCH",
        "Bağlı veritabanı açıkça seçilen hedefle eşleşmiyor."
      );
    // Windows MySQL may resolve schema names case-insensitively. Conservative
    // case-folding prevents two lock names for the same physical schema.
    lockName = `stationos:migrate:${sha256(database.toLowerCase()).slice(0, 40)}`;
    locked = await store.acquireLock(lockName, seconds);
    if (!locked)
      fail(
        "LOCK_TIMEOUT",
        "Migration kilidi alınamadı; başka işlem çalışıyor olabilir. Şema değiştirilmedi."
      );
    await store.assertLock(lockName);
    const snapshot = await store.snapshot();
    const applied = validateHistory(
      migrations,
      snapshot,
      options.mode === "baseline"
    );
    let baselined = 0;
    if (options.mode === "baseline") {
      if (!options.reviewReference?.trim())
        fail(
          "MISSING_REVIEW",
          "Eski geçmiş için yönetici inceleme referansı zorunlu."
        );
      if (!applied.size)
        fail(
          "NO_LEGACY_HISTORY",
          "Baseline için mevcut ve doğrulanabilir migration geçmişi gerekli."
        );
      await store.assertLock(lockName);
      await store.bootstrap();
      const guards = new Set(snapshot.guards.map(migrationKey));
      for (const migration of migrations.filter(
        m => applied.has(migrationKey(m)) && !guards.has(migrationKey(m))
      )) {
        await store.assertLock(lockName);
        await store.baseline(migration, options.reviewReference);
        baselined++;
      }
    }
    const pending = migrations.filter(m => !applied.has(migrationKey(m)));
    if (
      options.requireEmptySchema &&
      options.mode !== "status" &&
      !(options.requireEmptyBeforeApply && options.mode === "apply")
    )
      fail(
        "INVALID_OPTIONS",
        "Boş şema kontrolü yalnız salt-okunur status veya açık uygulama provası kipinde kullanılabilir."
      );
    if (
      (options.requireEmptySchema || options.requireEmptyBeforeApply) &&
      snapshot.tables.length !== 0
    )
      fail(
        "TRIAL_SCHEMA_NOT_EMPTY",
        "Hedef şema beklenen boş durumda değil; migration başlatılmadı."
      );
    if (options.expectedPending) {
      if (!(options.mode === "status" || options.mode === "apply"))
        fail(
          "INVALID_OPTIONS",
          "Beklenen pending listesi yalnız status veya apply kipinde kullanılabilir."
        );
      const actual = pending.map(migrationKey);
      if (JSON.stringify(actual) !== JSON.stringify(options.expectedPending))
        fail(
          "TRIAL_PENDING_SET_MISMATCH",
          "Trial status beklenen kanonik pending listesini göstermiyor; migration başlatılmadı."
        );
    }
    if (options.mode === "ready" && pending.length)
      fail(
        "MIGRATIONS_PENDING",
        "Uygulama başlamadı: bekleyen migration var; ayrı, yetkili migration komutu gerekli."
      );
    if (options.mode === "apply" && pending.length) {
      await store.assertLock(lockName);
      await store.bootstrap();
      for (const migration of pending) {
        await store.assertLock(lockName);
        // Autocommitted before DDL. Crash/implicit commit cannot erase this marker.
        await store.start(migration);
        for (const statement of migration.statements) {
          await store.assertLock(lockName);
          await store.executeStatement(statement);
          await store.assertLock(lockName);
        }
        await store.finish(migration, lockName);
        applied.add(migrationKey(migration));
      }
    }
    // Re-read history rather than trusting successful method return values.
    if (options.mode === "apply" || options.mode === "baseline")
      validateHistory(migrations, await store.snapshot());
    return {
      applied: applied.size,
      pending: migrations
        .filter(m => !applied.has(migrationKey(m)))
        .map(migrationKey),
      baselined,
    };
  } catch (error) {
    failed = true;
    if (error instanceof MigrationSafetyError) throw error;
    throw new MigrationSafetyError(
      "MIGRATION_CONNECTION_OR_DDL_FAILED",
      "Bağlantı veya SQL işlemi başarısız. Kısmi DDL mümkün; STARTED kayıtlarını inceleyin. Otomatik devam/rollback yok."
    );
  } finally {
    if (locked) {
      try {
        await store.releaseLock(lockName);
      } catch {
        if (!failed)
          fail(
            "LOCK_RELEASE_FAILED",
            "Kilit bırakma doğrulanamadı. Bağlantı kapatılmalı; tekrar çalıştırmadan geçmiş incelenmeli."
          );
      }
    }
  }
}

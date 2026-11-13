import { describe, expect, it } from "vitest";
import {
  inspectCatalog,
  loadCatalog,
  sha256,
  splitSql,
  type CatalogFiles,
} from "./catalog";
import { readMigrationFiles } from "drizzle-orm/migrator";

function fixture() {
  const files = new Map<string, string>([
    [
      "synthetic/drizzle/meta/_journal.json",
      JSON.stringify({
        dialect: "mysql",
        entries: [{ idx: 0, when: 1000, tag: "0000_users" }],
      }),
    ],
    [
      "synthetic/drizzle/0000_users.sql",
      "CREATE TABLE IF NOT EXISTS users (id INT);\n",
    ],
    [
      "synthetic/server/stationos/migrations/0001_example.sql",
      "CREATE TABLE IF NOT EXISTS st_example (id INT);\nALTER TABLE st_example ADD COLUMN next_id INT;\n",
    ],
  ]);
  const directories = new Map([
    ["synthetic/drizzle", ["0000_users.sql", "meta"]],
    ["synthetic/server/stationos/migrations", ["0001_example.sql"]],
  ]);
  const io: CatalogFiles = {
    readFile: async path => {
      const value = files.get(path.replaceAll("\\", "/"));
      if (value === undefined) throw new Error("synthetic file missing");
      return Buffer.from(value);
    },
    readdir: async path => directories.get(path.replaceAll("\\", "/")) ?? [],
  };
  async function manifest() {
    const value =
      JSON.stringify(
        (await inspectCatalog("synthetic", io)).manifest,
        null,
        2
      ) + "\n";
    files.set("synthetic/migrations.manifest.json", value);
    return sha256(value);
  }
  return { files, directories, io, manifest };
}

describe("Migration kaynak manifesti (yalnız bellek dosya sistemi)", () => {
  it("sırayı ve SHA-256 değerlerini manifestle doğrular", async () => {
    const f = fixture(),
      fingerprint = await f.manifest();
    const result = await loadCatalog("synthetic", fingerprint, f.io);
    expect(result.migrations.map(m => m.kind)).toEqual([
      "drizzle",
      "operations",
    ]);
    expect(result.migrations[1].statements).toHaveLength(2);
    expect(result.manifestHash).toBe(fingerprint);
  });
  it("değiştirilmiş SQL dosyasını ve satır sonu değişimini kabul etmez", async () => {
    for (const edit of [
      (sql: string) => sql + "-- edited\n",
      (sql: string) => sql.replaceAll("\n", "\r\n"),
    ]) {
      const f = fixture();
      await f.manifest();
      const file = "synthetic/server/stationos/migrations/0001_example.sql";
      f.files.set(file, edit(f.files.get(file)!));
      await expect(
        loadCatalog("synthetic", undefined, f.io)
      ).rejects.toMatchObject({ code: "CHECKSUM_MISMATCH" });
    }
  });
  it("yeni üretilen manifesti eski onay parmak iziyle otomatik kabul etmez", async () => {
    const f = fixture(),
      trusted = await f.manifest();
    f.files.set(
      "synthetic/drizzle/0000_users.sql",
      "CREATE TABLE IF NOT EXISTS users (id BIGINT);"
    );
    await f.manifest();
    await expect(loadCatalog("synthetic", trusted, f.io)).rejects.toMatchObject(
      { code: "MANIFEST_CHECKSUM_MISMATCH" }
    );
  });
  it("eksik checksum ve bilinmeyen migration kaydında durur", async () => {
    const f = fixture();
    await f.manifest();
    const manifest = JSON.parse(
      f.files.get("synthetic/migrations.manifest.json")!
    );
    delete manifest.entries[0].checksum;
    f.files.set("synthetic/migrations.manifest.json", JSON.stringify(manifest));
    await expect(
      loadCatalog("synthetic", undefined, f.io)
    ).rejects.toMatchObject({ code: "CHECKSUM_MISMATCH" });
  });
  it("eksik/bozuk manifesti açıklayıcı hata ile reddeder", async () => {
    const f = fixture();
    await expect(
      loadCatalog("synthetic", undefined, f.io)
    ).rejects.toMatchObject({ code: "CATALOG_READ_FAILED" });
    f.files.set("synthetic/migrations.manifest.json", "broken");
    await expect(
      loadCatalog("synthetic", undefined, f.io)
    ).rejects.toMatchObject({ code: "CATALOG_READ_FAILED" });
  });
  it("journal sıra uyuşmazlığını ve journal dışı SQL'i reddeder", async () => {
    const f = fixture();
    f.files.set(
      "synthetic/drizzle/meta/_journal.json",
      JSON.stringify({
        dialect: "mysql",
        entries: [{ idx: 1, when: 1000, tag: "0000_users" }],
      })
    );
    await expect(inspectCatalog("synthetic", f.io)).rejects.toMatchObject({
      code: "MIGRATION_ORDER",
    });
    const other = fixture();
    other.directories.get("synthetic/drizzle")!.push("0001_unknown.sql");
    await expect(inspectCatalog("synthetic", other.io)).rejects.toMatchObject({
      code: "JOURNAL_FILES_MISMATCH",
    });
  });
  it("operasyon numarası boşluğu ve kayıp dosyada durur", async () => {
    const f = fixture();
    f.directories.set("synthetic/server/stationos/migrations", [
      "0002_example.sql",
    ]);
    await expect(inspectCatalog("synthetic", f.io)).rejects.toMatchObject({
      code: "MIGRATION_ORDER",
    });
    const missing = fixture();
    missing.files.delete("synthetic/drizzle/0000_users.sql");
    await expect(inspectCatalog("synthetic", missing.io)).rejects.toThrow(
      "missing"
    );
  });
  it("noktalı virgül içeren metin/yorumları bozmadan SQL'i ayırır", () => {
    const sql =
      "-- comment ;\nCREATE TABLE example (note VARCHAR(90) DEFAULT 'a;b''c'); /* ; */ ALTER TABLE example ADD COLUMN `a;b` INT;";
    const parts = splitSql(sql);
    expect(parts).toHaveLength(2);
    expect(parts[0]).toContain("'a;b''c'");
    expect(parts[1]).toContain("`a;b`");
  });
  it.each([
    "DROP TABLE users;",
    "SET autocommit=0;",
    "DELIMITER $$",
    "CREATE TABLE a (note VARCHAR(9) DEFAULT 'broken);",
    "/* broken",
    "/*! ALTER TABLE users ADD x INT */;",
  ])("incelenmemiş/bozuk SQL profilinde durur: %s", sql => {
    expect(() => splitSql(sql)).toThrow();
  });
});

describe("Depodaki gerçek dosyaların salt okunur kontrolü (DB yok)", () => {
  it("manifest ve mevcut Drizzle hash üretimi aynı baytları kullanır", async () => {
    const catalog = await loadCatalog(process.cwd());
    const original = readMigrationFiles({ migrationsFolder: "drizzle" });
    expect(catalog.migrations).toHaveLength(21);
    expect(catalog.migrations.at(-1)?.version).toBe(
      "0020_personnel_shift_assignments"
    );
    expect(
      catalog.migrations.filter(m => m.kind === "drizzle").map(m => m.checksum)
    ).toEqual(original.map(m => m.hash));
  });
});

import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";

export class MigrationSafetyError extends Error {
  constructor(
    public readonly code: string,
    message: string
  ) {
    super(`${code}: ${message}`);
    this.name = "MigrationSafetyError";
  }
}
export type MigrationKind = "drizzle" | "operations";
export type Migration = {
  kind: MigrationKind;
  version: string;
  sourceIndex: number;
  file: string;
  checksum: string;
  timestamp?: number;
  statements: string[];
};
export type Manifest = {
  format: 1;
  drizzleJournalChecksum: string;
  entries: Omit<Migration, "statements">[];
};
export const sha256 = (value: string | Buffer) =>
  createHash("sha256").update(value).digest("hex");
export const migrationKey = (m: Pick<Migration, "kind" | "version">) =>
  `${m.kind}:${m.version}`;
export type CatalogFiles = {
  readFile(path: string): Promise<Buffer>;
  readdir(path: string): Promise<string[]>;
};
const disk: CatalogFiles = {
  readFile: path => readFile(path),
  readdir: path => readdir(path),
};

/** SQL assets use ordinary statements; DELIMITER/routines need a reviewed extension. */
export function splitSql(sql: string): string[] {
  if (/\/\*!/.test(sql))
    throw new MigrationSafetyError(
      "SQL_PROFILE_UNSUPPORTED",
      "Çalıştırılabilir MySQL yorumları açık inceleme gerektirir."
    );
  const result: string[] = [];
  let start = 0,
    quote = "",
    lineComment = false,
    blockComment = false;
  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i],
      next = sql[i + 1];
    if (lineComment) {
      if (ch === "\n") lineComment = false;
      continue;
    }
    if (blockComment) {
      if (ch === "*" && next === "/") {
        blockComment = false;
        i++;
      }
      continue;
    }
    if (quote) {
      if (ch === "\\") {
        i++;
        continue;
      }
      if (ch === quote) {
        if (next === quote) i++;
        else quote = "";
      }
      continue;
    }
    if (
      ch === "#" ||
      (ch === "-" && next === "-" && /\s/.test(sql[i + 2] ?? ""))
    ) {
      lineComment = true;
      continue;
    }
    if (ch === "/" && next === "*") {
      blockComment = true;
      i++;
      continue;
    }
    if (["'", '"', "`"].includes(ch)) {
      quote = ch;
      continue;
    }
    if (ch === ";") {
      result.push(sql.slice(start, i));
      start = i + 1;
    }
  }
  if (quote || blockComment)
    throw new MigrationSafetyError(
      "SQL_PARSE_ERROR",
      "SQL içinde kapanmamış metin veya yorum var."
    );
  result.push(sql.slice(start));
  return result
    .map(statement => statement.trim())
    .filter(statement => {
      const code = statement
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/--[^\n]*|#[^\n]*/g, "")
        .trim();
      if (!code) return false;
      // Keep connection, lock and transaction control out of migration assets.
      if (
        !/^(CREATE\s+(?:TABLE|(?:UNIQUE\s+)?INDEX)|ALTER\s+TABLE)\b/i.test(code)
      )
        throw new MigrationSafetyError(
          "SQL_PROFILE_UNSUPPORTED",
          "Yalnız incelenmiş CREATE TABLE/INDEX ve ALTER TABLE SQL profili desteklenir."
        );
      return true;
    });
}

async function asset(
  root: string,
  file: string,
  files: CatalogFiles
): Promise<{ text: string; checksum: string }> {
  const bytes = await files.readFile(join(root, file));
  const text = bytes.toString("utf8");
  if (!Buffer.from(text, "utf8").equals(bytes))
    throw new MigrationSafetyError(
      "INVALID_ENCODING",
      `${file}: UTF-8 gerekli.`
    );
  return { text, checksum: sha256(bytes) };
}

export async function inspectCatalog(
  root: string,
  sourceFiles = disk
): Promise<{ manifest: Manifest; migrations: Migration[] }> {
  const journalAsset = await asset(
    root,
    "drizzle/meta/_journal.json",
    sourceFiles
  );
  const journal = JSON.parse(journalAsset.text);
  if (
    journal.dialect !== "mysql" ||
    !Array.isArray(journal.entries) ||
    !journal.entries.length
  )
    throw new MigrationSafetyError(
      "JOURNAL_INVALID",
      "Drizzle MySQL journal geçersiz."
    );
  const migrations: Migration[] = [];
  let previousTime = -1;
  for (const [index, entry] of journal.entries.entries()) {
    if (
      entry.idx !== index ||
      !/^\d{4}_[a-z0-9_-]+$/i.test(entry.tag) ||
      Number(entry.tag.slice(0, 4)) !== index ||
      !Number.isSafeInteger(entry.when) ||
      entry.when <= previousTime
    )
      throw new MigrationSafetyError(
        "MIGRATION_ORDER",
        "Drizzle sırası, kimliği veya zamanı geçersiz."
      );
    previousTime = entry.when;
    const file = `drizzle/${entry.tag}.sql`;
    const source = await asset(root, file, sourceFiles);
    migrations.push({
      kind: "drizzle",
      version: entry.tag,
      sourceIndex: index,
      timestamp: entry.when,
      file,
      checksum: source.checksum,
      statements: splitSql(
        source.text.replaceAll("--> statement-breakpoint", "\n")
      ),
    });
  }
  const drizzleFiles = (await sourceFiles.readdir(join(root, "drizzle")))
    .filter(file => file.endsWith(".sql"))
    .sort();
  if (
    JSON.stringify(drizzleFiles) !==
    JSON.stringify(migrations.map(m => `${m.version}.sql`).sort())
  )
    throw new MigrationSafetyError(
      "JOURNAL_FILES_MISMATCH",
      "Drizzle journal ile SQL dosyaları eşleşmiyor."
    );
  const files = (
    await sourceFiles.readdir(join(root, "server/stationos/migrations"))
  )
    .filter(file => file.endsWith(".sql"))
    .sort();
  if (!files.length)
    throw new MigrationSafetyError(
      "CATALOG_EMPTY",
      "Operasyon migration dosyaları yok."
    );
  for (const [index, name] of files.entries()) {
    if (
      !/^\d{4}_[a-z0-9_-]+\.sql$/i.test(name) ||
      Number(name.slice(0, 4)) !== index + 1
    )
      throw new MigrationSafetyError(
        "MIGRATION_ORDER",
        "Operasyon migration sırası eksik veya geçersiz."
      );
    const file = `server/stationos/migrations/${name}`;
    const source = await asset(root, file, sourceFiles);
    migrations.push({
      kind: "operations",
      version: name.slice(0, -4),
      sourceIndex: index,
      file,
      checksum: source.checksum,
      statements: splitSql(source.text),
    });
  }
  if (migrations.some(m => !m.statements.length))
    throw new MigrationSafetyError(
      "CATALOG_EMPTY",
      "Boş SQL migration kabul edilmez."
    );
  return {
    migrations,
    manifest: {
      format: 1,
      drizzleJournalChecksum: journalAsset.checksum,
      entries: migrations.map(
        ({ statements: _statements, ...metadata }) => metadata
      ),
    },
  };
}

export async function loadCatalog(
  root: string,
  expectedManifestHash?: string,
  sourceFiles = disk
) {
  try {
    const bytes = await sourceFiles.readFile(
      join(root, "migrations.manifest.json")
    );
    const manifestHash = sha256(bytes);
    if (
      expectedManifestHash &&
      manifestHash !== expectedManifestHash.toLowerCase()
    )
      throw new MigrationSafetyError(
        "MANIFEST_CHECKSUM_MISMATCH",
        "Manifest onaylanmış SHA-256 değeriyle eşleşmiyor."
      );
    const trusted: Manifest = JSON.parse(bytes.toString("utf8"));
    const catalog = await inspectCatalog(root, sourceFiles);
    if (JSON.stringify(trusted) !== JSON.stringify(catalog.manifest))
      throw new MigrationSafetyError(
        "CHECKSUM_MISMATCH",
        "SQL dosyaları veya Drizzle journal onaylı manifestle eşleşmiyor. Otomatik kabul yok."
      );
    return { ...catalog, manifestHash };
  } catch (error) {
    if (error instanceof MigrationSafetyError) throw error;
    throw new MigrationSafetyError(
      "CATALOG_READ_FAILED",
      "Migration manifesti, journal veya SQL dosyası eksik/geçersiz. Kaynak paketi doğrulanmadan devam edilmez."
    );
  }
}

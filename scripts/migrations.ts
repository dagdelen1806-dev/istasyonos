import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  inspectCatalog,
  loadCatalog,
  migrationKey,
  MigrationSafetyError,
} from "../server/migrations/catalog";
import { runMigrations } from "../server/migrations/engine";
import {
  withMysqlMigrationStore,
  type MigrationConnectionExpectation,
} from "../server/migrations/mysql-store";

const trialManifestSha256 =
  "3e6ce8ee6a5a295bdcddc3b5de271f4299f838bc40632bab26cac6a99611ff01";
const demoMigrationManifestSha256 = trialManifestSha256;
const trialMigrationPrincipal = "stationos_trial_migrator@127.0.0.1";
const demoMigrationDatabase = "istasyonos_demo";
const demoMigrationPrincipal = "stationos_demo_migrator@127.0.0.1";
const demoMigrationUsername = "stationos_demo_migrator";
const demoMigrationServerHostname = "DESKTOP-LPUUGML";
export const demoMigrationExpectedPending: readonly string[] = Object.freeze([
  "operations:0018_fast_payment",
  "operations:0019_pos_slip_ocr_drafts",
  "operations:0020_personnel_shift_assignments",
]);
const oesseAppTrialManifestSha256 = trialManifestSha256;
const oesseAppTrialDatabase = "istasyonos_oesse_app_trial";
const oesseAppTrialMigrationUser = "stationos_oesse_migrator";
const forbiddenMigrationDatabases = new Set([
  "istasyonos_db",
  "istasyonos_demo",
  "istasyonos_migration_trial",
]);

function requiredEnvironmentValue(
  environment: NodeJS.ProcessEnv,
  name: string,
  errorCode = "OESSE_APP_MIGRATION_CONFIG_REJECTED"
): string {
  const value = environment[name]?.trim();
  if (!value)
    throw new MigrationSafetyError(
      errorCode,
      "Ayrı ÖSSE uygulama test migrator profili eksik veya geçersiz."
    );
  return value;
}

function requiredSecret(
  environment: NodeJS.ProcessEnv,
  name: string,
  errorCode = "OESSE_APP_MIGRATION_CONFIG_REJECTED"
): string {
  const value = environment[name];
  if (value === undefined || value.length === 0)
    throw new MigrationSafetyError(
      errorCode,
      "Ayrı ÖSSE uygulama test migrator profili eksik veya geçersiz."
    );
  return value;
}

function parseExpectedUuid(
  value: string,
  errorCode = "OESSE_APP_MIGRATION_CONFIG_REJECTED",
  errorMessage = "Ayrı ÖSSE uygulama test migrator profili eksik veya geçersiz."
): string {
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value
    )
  )
    throw new MigrationSafetyError(errorCode, errorMessage);
  return value.toLowerCase();
}

function buildOesseAppTrialMigrationProfile(
  database: string,
  manifestHash: string,
  environment: NodeJS.ProcessEnv
): { uri: string; expectation: MigrationConnectionExpectation } {
  const host = requiredEnvironmentValue(
      environment,
      "STATIONOS_OESSE_MIGRATION_HOST"
    ).toLowerCase(),
    expectedHost = requiredEnvironmentValue(
      environment,
      "STATIONOS_OESSE_MIGRATION_EXPECTED_HOST"
    ).toLowerCase(),
    portText = requiredEnvironmentValue(
      environment,
      "STATIONOS_OESSE_MIGRATION_PORT"
    ),
    port = Number(portText),
    expectedPortText = requiredEnvironmentValue(
      environment,
      "STATIONOS_OESSE_MIGRATION_EXPECTED_PORT"
    ),
    expectedPort = Number(expectedPortText),
    targetDatabase = requiredEnvironmentValue(
      environment,
      "STATIONOS_OESSE_MIGRATION_DATABASE"
    ),
    username = requiredEnvironmentValue(
      environment,
      "STATIONOS_OESSE_MIGRATION_USER"
    ),
    password = requiredSecret(
      environment,
      "STATIONOS_OESSE_MIGRATION_PASSWORD"
    ),
    expectedCurrentUser = requiredEnvironmentValue(
      environment,
      "STATIONOS_OESSE_MIGRATION_EXPECTED_CURRENT_USER"
    ),
    expectedServerHostname = requiredEnvironmentValue(
      environment,
      "STATIONOS_OESSE_MIGRATION_EXPECTED_SERVER_HOSTNAME"
    ),
    expectedServerUuid = parseExpectedUuid(
      requiredEnvironmentValue(
        environment,
        "STATIONOS_OESSE_MIGRATION_EXPECTED_SERVER_UUID"
      )
    );
  const currentUserHost = expectedCurrentUser.startsWith(
    `${oesseAppTrialMigrationUser}@`
  )
    ? expectedCurrentUser.slice(oesseAppTrialMigrationUser.length + 1)
    : "";

  if (
    environment.STATIONOS_OESSE_MIGRATION_ENABLED?.trim().toLowerCase() !==
      "true" ||
    !host ||
    host !== expectedHost ||
    portText !== String(port) ||
    !Number.isInteger(port) ||
    port < 1 ||
    port > 65535 ||
    expectedPortText !== String(expectedPort) ||
    expectedPort !== port ||
    targetDatabase !== oesseAppTrialDatabase ||
    targetDatabase !== database ||
    forbiddenMigrationDatabases.has(targetDatabase.toLowerCase()) ||
    /aksan/i.test(targetDatabase) ||
    username !== oesseAppTrialMigrationUser ||
    !/^[a-z0-9.-]+$/i.test(currentUserHost) ||
    !expectedServerHostname ||
    manifestHash !== oesseAppTrialManifestSha256
  )
    throw new MigrationSafetyError(
      "OESSE_APP_MIGRATION_CONFIG_REJECTED",
      "Ayrı ÖSSE uygulama test migrator profili eksik veya geçersiz."
    );

  let uri: URL;
  try {
    uri = new URL("mysql://placeholder");
    uri.hostname = host;
    uri.port = String(port);
    uri.username = username;
    uri.password = password;
    uri.pathname = `/${targetDatabase}`;
    uri.searchParams.set("charset", "utf8mb4");
  } catch {
    throw new MigrationSafetyError(
      "OESSE_APP_MIGRATION_CONFIG_REJECTED",
      "Ayrı ÖSSE uygulama test migrator profili eksik veya geçersiz."
    );
  }
  if (
    uri.hostname.toLowerCase() !== host ||
    Number(uri.port || "3306") !== port ||
    decodeURIComponent(uri.pathname.slice(1)) !== targetDatabase ||
    decodeURIComponent(uri.username) !== username
  )
    throw new MigrationSafetyError(
      "OESSE_APP_MIGRATION_CONFIG_REJECTED",
      "Ayrı ÖSSE uygulama test migrator profili eksik veya geçersiz."
    );

  return {
    uri: uri.href,
    expectation: {
      host,
      port,
      database: targetDatabase,
      urlUsername: username,
      expectedServerHostname,
      expectedCurrentUser,
      expectedServerUuid,
      requireTargetOnlyGrants: true,
    },
  };
}

export function resolveOesseAppTrialMigrationProfile(
  database: string,
  manifestHash: string,
  environment: NodeJS.ProcessEnv
): { uri: string; expectation: MigrationConnectionExpectation } {
  if (
    environment.STATIONOS_OESSE_MIGRATION_ENABLED?.trim().toLowerCase() !==
    "true"
  )
    throw new MigrationSafetyError(
      "OESSE_APP_MIGRATION_CONFIG_REJECTED",
      "Ayrı ÖSSE uygulama test migrator profili açıkça etkin değil."
    );
  return buildOesseAppTrialMigrationProfile(
    database,
    manifestHash,
    environment
  );
}

export function resolveDemoMigrationProfile(
  database: string,
  manifestHash: string,
  environment: NodeJS.ProcessEnv
): { uri: string; expectation: MigrationConnectionExpectation } {
  const host = requiredEnvironmentValue(
      environment,
      "STATIONOS_DEMO_MIGRATION_HOST",
      "DEMO_MIGRATION_CONFIG_REJECTED"
    ),
    portText = requiredEnvironmentValue(
      environment,
      "STATIONOS_DEMO_MIGRATION_PORT",
      "DEMO_MIGRATION_CONFIG_REJECTED"
    ),
    username = requiredEnvironmentValue(
      environment,
      "STATIONOS_DEMO_MIGRATION_USER",
      "DEMO_MIGRATION_CONFIG_REJECTED"
    ),
    password = requiredSecret(
      environment,
      "STATIONOS_DEMO_MIGRATION_PASSWORD",
      "DEMO_MIGRATION_CONFIG_REJECTED"
    ),
    expectedCurrentUser = requiredEnvironmentValue(
      environment,
      "STATIONOS_DEMO_MIGRATION_EXPECTED_CURRENT_USER",
      "DEMO_MIGRATION_CONFIG_REJECTED"
    ),
    expectedServerUuid = parseExpectedUuid(
      requiredEnvironmentValue(
        environment,
        "STATIONOS_DEMO_MIGRATION_EXPECTED_SERVER_UUID",
        "DEMO_MIGRATION_CONFIG_REJECTED"
      ),
      "DEMO_MIGRATION_CONFIG_REJECTED",
      "DEMO migrator sunucu kimliği doğrulanamadı."
    ),
    port = Number(portText);

  if (
    environment.STATIONOS_DEMO_MIGRATION_ENABLED?.trim().toLowerCase() !==
      "true" ||
    host !== "127.0.0.1" ||
    portText !== "3306" ||
    port !== 3306 ||
    database !== demoMigrationDatabase ||
    username !== demoMigrationUsername ||
    expectedCurrentUser !== demoMigrationPrincipal ||
    manifestHash !== demoMigrationManifestSha256
  )
    throw new MigrationSafetyError(
      "DEMO_MIGRATION_CONFIG_REJECTED",
      "DEMO migrator hedefi, kimliği veya manifesti beklenen değerlerle eşleşmiyor."
    );

  const uri = new URL("mysql://127.0.0.1");
  uri.username = username;
  uri.password = password;
  uri.port = String(port);
  uri.pathname = `/${demoMigrationDatabase}`;
  uri.searchParams.set("charset", "utf8mb4");
  return {
    uri: uri.href,
    expectation: {
      host,
      port,
      database: demoMigrationDatabase,
      urlUsername: username,
      expectedServerHostname: demoMigrationServerHostname,
      expectedCurrentUser: demoMigrationPrincipal,
      expectedServerUuid,
      requireTargetOnlyGrants: true,
    },
  };
}

export function resolveMigrationTarget(
  uri: string,
  database: string,
  _mode: string,
  profile: string | undefined,
  expectedCurrentUser: string | undefined,
  expectedServerUuid: string | undefined,
  manifestHash: string
): MigrationConnectionExpectation {
  let url: URL;
  try {
    url = new URL(uri);
  } catch {
    throw new MigrationSafetyError(
      "MIGRATION_URI_INVALID",
      "Migration bağlantı hedefi doğrulanamadı."
    );
  }
  if (
    !["mysql:", "mysql2:"].includes(url.protocol) ||
    !url.hostname ||
    !url.username ||
    (url.pathname.replace(/^\//, "") !== database &&
      decodeURIComponent(url.pathname.replace(/^\//, "")) !== database)
  )
    throw new MigrationSafetyError(
      "TARGET_DSN_MISMATCH",
      "Bağlantı hedefi açıkça seçilen migration hedefiyle eşleşmiyor."
    );
  const port = url.port ? Number(url.port) : 3306;
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new MigrationSafetyError(
      "TARGET_DSN_MISMATCH",
      "MySQL portu geçersiz."
    );
  if (!profile) {
    return {
      host: url.hostname,
      port,
      database,
      urlUsername: decodeURIComponent(url.username),
      ...(expectedServerUuid ? { expectedServerUuid } : {}),
    };
  }
  if (profile !== "istasyonos-trial")
    throw new MigrationSafetyError(
      "INVALID_TARGET_PROFILE",
      "Bilinmeyen hedef profili."
    );
  const expected = {
    host: "127.0.0.1",
    port: 3306,
    server: "DESKTOP-LPUUGML",
    database: "istasyonos_migration_trial",
  };
  if (
    url.hostname !== expected.host ||
    port !== expected.port ||
    database !== expected.database ||
    manifestHash !== trialManifestSha256 ||
    expectedCurrentUser !== trialMigrationPrincipal ||
    decodeURIComponent(url.username) !== expectedCurrentUser.split("@")[0]
  )
    throw new MigrationSafetyError(
      "TRIAL_TARGET_NOT_APPROVED",
      "Trial hedefi, manifesti veya doğrulanmış etkin MySQL hesabı eksik/eşleşmiyor."
    );
  return {
    ...expected,
    urlUsername: decodeURIComponent(url.username),
    expectedServerHostname: expected.server,
    expectedCurrentUser,
    ...(expectedServerUuid ? { expectedServerUuid } : {}),
    requireTargetOnlyGrants: true,
  };
}

/** Trial migrations never borrow DATABASE_URL; missing trial config is fatal. */
export function resolveMigrationUri(
  profile: string | undefined,
  database: string,
  environment: NodeJS.ProcessEnv,
  manifestHash?: string
): string {
  if (!profile) {
    const uri = environment.DATABASE_URL;
    if (!uri)
      throw new MigrationSafetyError(
        "DATABASE_REQUIRED",
        "DATABASE_URL gerekli; bağlantı kurulmadı."
      );
    return uri;
  }
  if (profile === "istasyonos-oesse-app-trial") {
    if (!manifestHash)
      throw new MigrationSafetyError(
        "OESSE_APP_MIGRATION_CONFIG_REJECTED",
        "Ayrı ÖSSE uygulama test migrator profili eksik veya geçersiz."
      );
    return resolveOesseAppTrialMigrationProfile(
      database,
      manifestHash,
      environment
    ).uri;
  }
  if (profile === "istasyonos-demo") {
    if (!manifestHash)
      throw new MigrationSafetyError(
        "DEMO_MIGRATION_CONFIG_REJECTED",
        "DEMO migrator profili veya sabit manifest doğrulanamadı."
      );
    return resolveDemoMigrationProfile(database, manifestHash, environment).uri;
  }
  if (profile !== "istasyonos-trial")
    throw new MigrationSafetyError(
      "INVALID_TARGET_PROFILE",
      "Bilinmeyen hedef profili."
    );
  const host = environment.ST_TRIAL_MIGRATION_DB_HOST?.trim(),
    port = Number(environment.ST_TRIAL_MIGRATION_DB_PORT),
    targetDatabase = environment.ST_TRIAL_MIGRATION_DB_NAME?.trim(),
    username = environment.ST_TRIAL_MIGRATION_DB_USER?.trim(),
    password = environment.ST_TRIAL_MIGRATION_DB_PASSWORD,
    charset = environment.ST_TRIAL_MIGRATION_DB_CHARSET?.trim() || "utf8mb4";
  if (
    environment.ST_TRIAL_MIGRATION_DB_ENABLED?.trim().toLowerCase() !==
      "true" ||
    host !== "127.0.0.1" ||
    port !== 3306 ||
    targetDatabase !== database ||
    targetDatabase !== "istasyonos_migration_trial" ||
    username !== trialMigrationPrincipal.split("@")[0] ||
    !password
  )
    throw new MigrationSafetyError(
      "TRIAL_MIGRATION_CONFIG_REJECTED",
      "Ayrı trial migration bağlantısı eksik veya beklenen hedefle eşleşmiyor."
    );
  const url = new URL("mysql://127.0.0.1");
  url.username = username;
  url.password = password;
  url.port = String(port);
  url.pathname = `/${targetDatabase}`;
  url.searchParams.set("charset", charset);
  return url.href;
}

export async function runMigrationCli(
  args: string[],
  root = process.cwd()
): Promise<void> {
  const [mode, ...flags] = args;
  if (mode === "manifest") {
    console.log(JSON.stringify((await inspectCatalog(root)).manifest, null, 2));
    return;
  }
  if (mode === "check-files") {
    const catalog = await loadCatalog(root);
    console.log(
      `Dosya doğrulaması başarılı: ${catalog.migrations.length} migration. Manifest SHA-256: ${catalog.manifestHash}`
    );
    return;
  }
  if (!["status", "apply", "baseline"].includes(mode))
    throw new MigrationSafetyError(
      "EXPLICIT_COMMAND_REQUIRED",
      "Komutlar: check-files, manifest, status, apply, baseline. Boş trial profillerinde status için hedefe özel boş-şema onayı zorunludur; db:push devre dışı, otomatik migration yok."
    );
  const values = new Map<string, string>(),
    switches = new Set<string>();
  for (let index = 0; index < flags.length; index++) {
    const flag = flags[index];
    if (
      [
        "--apply",
        "--confirm-legacy-review",
        "--expect-empty-trial",
        "--expect-empty-app-trial",
        "--expect-complete-app-trial",
        "--confirm-oesse-app-trial-apply",
        "--expect-demo-pending",
        "--confirm-demo-migration-apply",
      ].includes(flag)
    ) {
      if (switches.has(flag))
        throw new MigrationSafetyError(
          "INVALID_OPTIONS",
          "Tekrarlanan seçenek."
        );
      switches.add(flag);
    } else if (
      [
        "--database",
        "--manifest-sha256",
        "--lock-timeout",
        "--review-reference",
        "--target-profile",
        "--expected-current-user",
        "--expected-server-uuid",
      ].includes(flag) &&
      flags[index + 1] &&
      !flags[index + 1].startsWith("--")
    ) {
      if (values.has(flag))
        throw new MigrationSafetyError(
          "INVALID_OPTIONS",
          "Tekrarlanan seçenek."
        );
      values.set(flag, flags[++index]);
    } else
      throw new MigrationSafetyError(
        "INVALID_OPTIONS",
        "Bilinmeyen veya değeri eksik migration seçeneği."
      );
  }
  const database = values.get("--database") ?? "",
    fingerprint = values.get("--manifest-sha256") ?? "",
    targetProfile = values.get("--target-profile"),
    expectsEmptyTrial = switches.has("--expect-empty-trial"),
    expectsEmptyAppTrial = switches.has("--expect-empty-app-trial"),
    expectsCompleteAppTrial = switches.has("--expect-complete-app-trial"),
    confirmsOesseAppApply = switches.has("--confirm-oesse-app-trial-apply"),
    expectsDemoPending = switches.has("--expect-demo-pending"),
    confirmsDemoApply = switches.has("--confirm-demo-migration-apply");
  if (
    !/^[a-zA-Z0-9_-]{1,64}$/.test(database) ||
    !/^[a-fA-F0-9]{64}$/.test(fingerprint)
  )
    throw new MigrationSafetyError(
      "EXPLICIT_TARGET_REQUIRED",
      "--database ve güvenilir sürümden alınmış --manifest-sha256 zorunlu."
    );
  if (database === demoMigrationDatabase && targetProfile !== "istasyonos-demo")
    throw new MigrationSafetyError(
      "DEMO_MIGRATION_PROFILE_REQUIRED",
      "istasyonos_demo yalnız fail-closed DEMO migrator profiliyle hedeflenebilir."
    );
  if (
    (targetProfile === "istasyonos-demo" &&
      (database !== demoMigrationDatabase ||
        fingerprint !== demoMigrationManifestSha256 ||
        !expectsDemoPending ||
        (mode === "apply" &&
          (!switches.has("--apply") || !confirmsDemoApply)) ||
        mode === "baseline")) ||
    (expectsDemoPending && targetProfile !== "istasyonos-demo") ||
    (confirmsDemoApply &&
      (targetProfile !== "istasyonos-demo" || mode !== "apply"))
  )
    throw new MigrationSafetyError(
      "DEMO_MIGRATION_ACK_REQUIRED",
      "DEMO migrator yalnız sabit hedef, manifest, pending listesi ve işlem onayıyla çalışabilir."
    );
  if (
    targetProfile === "istasyonos-demo" &&
    (values.has("--expected-current-user") ||
      values.has("--expected-server-uuid"))
  )
    throw new MigrationSafetyError(
      "DEMO_MIGRATION_CONFIG_REJECTED",
      "DEMO hedef kimlikleri yalnız profile ait sabitlenmiş ayarlardan alınabilir."
    );
  if (
    (targetProfile === "istasyonos-trial" &&
      mode === "status" &&
      !expectsEmptyTrial) ||
    (expectsEmptyTrial &&
      (targetProfile !== "istasyonos-trial" || mode !== "status"))
  )
    throw new MigrationSafetyError(
      "TRIAL_EMPTY_STATUS_ACK_REQUIRED",
      "Trial status için yalnız boş hedef denetiminde --expect-empty-trial kullanılabilir."
    );
  if (
    (targetProfile === "istasyonos-oesse-app-trial" &&
      mode === "status" &&
      !expectsEmptyAppTrial &&
      !expectsCompleteAppTrial) ||
    (expectsEmptyAppTrial &&
      (targetProfile !== "istasyonos-oesse-app-trial" || mode !== "status")) ||
    (expectsCompleteAppTrial &&
      (targetProfile !== "istasyonos-oesse-app-trial" || mode !== "status")) ||
    (expectsEmptyAppTrial && expectsCompleteAppTrial) ||
    (confirmsOesseAppApply &&
      (targetProfile !== "istasyonos-oesse-app-trial" || mode !== "apply")) ||
    (targetProfile === "istasyonos-oesse-app-trial" &&
      mode === "apply" &&
      !confirmsOesseAppApply) ||
    (targetProfile === "istasyonos-oesse-app-trial" && mode === "baseline")
  )
    throw new MigrationSafetyError(
      "OESSE_APP_MIGRATION_ACK_REQUIRED",
      "ÖSSE uygulama test migrator komutu, profile özgü hedef ve işlem onayını karşılamıyor."
    );
  if (
    targetProfile === "istasyonos-oesse-app-trial" &&
    (values.has("--expected-current-user") ||
      values.has("--expected-server-uuid"))
  )
    throw new MigrationSafetyError(
      "OESSE_APP_MIGRATION_CONFIG_REJECTED",
      "ÖSSE uygulama test kimlikleri yalnız profile ait doğrulanmış ayarlardan alınabilir."
    );
  if (mode === "apply" && !switches.has("--apply"))
    throw new MigrationSafetyError(
      "APPLY_ACK_REQUIRED",
      "Şema değişikliği için açık --apply gerekli."
    );
  const reference = values.get("--review-reference");
  if (
    mode === "baseline" &&
    (!switches.has("--confirm-legacy-review") ||
      !reference?.trim() ||
      reference.length > 190)
  )
    throw new MigrationSafetyError(
      "LEGACY_REVIEW_REQUIRED",
      "Baseline için --confirm-legacy-review ve --review-reference gerekli; checksum geçmişi otomatik kabul edilmez."
    );
  const lockTimeout = Number(values.get("--lock-timeout") ?? 10);
  if (!Number.isInteger(lockTimeout) || lockTimeout < 0 || lockTimeout > 300)
    throw new MigrationSafetyError(
      "INVALID_OPTIONS",
      "Kilit zaman aşımı 0–300 saniye olmalı."
    );
  const catalog = await loadCatalog(root, fingerprint);
  // Only explicit DB commands load environment configuration or connect.
  const { config } = await import("dotenv");
  config({ path: resolve(root, ".env"), quiet: true });
  const appTrialProfile =
    targetProfile === "istasyonos-oesse-app-trial"
      ? resolveOesseAppTrialMigrationProfile(
          database,
          catalog.manifestHash,
          process.env
        )
      : undefined;
  const demoProfile =
    targetProfile === "istasyonos-demo"
      ? resolveDemoMigrationProfile(database, catalog.manifestHash, process.env)
      : undefined;
  const uri =
    appTrialProfile?.uri ??
    demoProfile?.uri ??
    resolveMigrationUri(
      targetProfile,
      database,
      process.env,
      catalog.manifestHash
    );
  const expectation =
    appTrialProfile?.expectation ??
    demoProfile?.expectation ??
    resolveMigrationTarget(
      uri,
      database,
      mode,
      targetProfile,
      values.get("--expected-current-user"),
      values.get("--expected-server-uuid"),
      catalog.manifestHash
    );
  const result = await withMysqlMigrationStore(uri, async store => {
    await store.assertConnectionTarget(expectation);
    return runMigrations(store, catalog.migrations, {
      mode: mode as "status" | "apply" | "baseline",
      database,
      lockTimeout,
      reviewReference: reference,
      ...(expectsEmptyTrial || expectsEmptyAppTrial
        ? {
            requireEmptySchema: true,
            expectedPending: catalog.migrations.map(migrationKey),
          }
        : {}),
      ...(expectsDemoPending
        ? { expectedPending: [...demoMigrationExpectedPending] }
        : {}),
      ...(expectsCompleteAppTrial ? { expectedPending: [] } : {}),
      ...(targetProfile === "istasyonos-oesse-app-trial" && mode === "apply"
        ? { requireEmptySchema: true, requireEmptyBeforeApply: true }
        : {}),
    });
  });
  console.log(JSON.stringify({ mode, ...result }));
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  runMigrationCli(process.argv.slice(2)).catch(error => {
    console.error(
      error instanceof MigrationSafetyError
        ? error.message
        : "MIGRATION_FILES_INVALID: Dosya/manifest okunamadı veya geçersiz; bağlantı/SQL ayrıntıları gizlendi."
    );
    process.exitCode = 1;
  });
}

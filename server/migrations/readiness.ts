import { resolve } from "node:path";
import { loadCatalog, MigrationSafetyError } from "./catalog";
import { runMigrations } from "./engine";
import { withMysqlMigrationStore } from "./mysql-store";
import { readStationosRuntimeTestProfile } from "../stationos/runtime-db-profile";

/** Read-only history verification; never bootstraps or applies schema. */
export async function assertMigrationReady(
  root = process.cwd()
): Promise<void> {
  const catalog = await loadCatalog(resolve(root));
  const testProfile = readStationosRuntimeTestProfile(process.env);
  const uri = testProfile?.databaseUrl ?? process.env.DATABASE_URL;
  if (!uri)
    throw new MigrationSafetyError(
      "DATABASE_REQUIRED",
      "Uygulama başlamadı: DATABASE_URL gerekli."
    );
  await withMysqlMigrationStore(uri, async store => {
    if (testProfile) {
      let url: URL;
      try {
        url = new URL(testProfile.databaseUrl);
      } catch {
        throw new MigrationSafetyError(
          "TARGET_IDENTITY_MISMATCH",
          "Test veritabani hedefi dogrulanamadi."
        );
      }
      await store.assertConnectionTarget({
        host: testProfile.expectedHost,
        port: testProfile.expectedPort,
        database: testProfile.expectedDatabase,
        urlUsername: decodeURIComponent(url.username),
        expectedServerHostname: testProfile.expectedServerHostname,
        expectedCurrentUser: testProfile.expectedCurrentUser,
        expectedServerUuid: testProfile.expectedServerUuid,
      });
      await store.assertApplicationRuntimeGrants(
        testProfile.expectedDatabase,
        testProfile.expectedCurrentUser
      );
    }
    const database = await store.database();
    await runMigrations(store, catalog.migrations, {
      mode: "ready",
      database,
      lockTimeout: 0,
    });
  });
}

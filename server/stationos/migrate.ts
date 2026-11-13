import { runMigrationCli } from "../../scripts/migrations";
import { MigrationSafetyError } from "../migrations/catalog";

// Legacy entry point: both histories now share one guarded run. Without explicit
// target, approved manifest fingerprint and --apply, no DB connection is opened.
runMigrationCli(["apply", ...process.argv.slice(2)]).catch(error => {
  console.error(
    error instanceof MigrationSafetyError
      ? error.message
      : "MIGRATION_FAILED: Güvenli migration komutu tamamlanamadı."
  );
  process.exitCode = 1;
});

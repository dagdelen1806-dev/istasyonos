import assert from "node:assert/strict";
import test from "node:test";
import {
  readonlyPreflightSql,
  validateTrialReadonlyGrants,
  validateTrialReadonlyIdentity,
} from "./trial-db-readonly-preflight.mjs";

const currentUser = "st_trial_ro@localhost";
const identity = {
  database_name: "istasyonos_migration_trial",
  server_hostname: "DESKTOP-LPUUGML",
  server_port: "3306",
  current_user: currentUser,
  current_role: "NONE",
  server_uuid: "synthetic-uuid",
};

test("accepts only the expected read-only trial target identity", () => {
  assert.equal(
    validateTrialReadonlyIdentity(identity, "st_trial_ro").database,
    "istasyonos_migration_trial"
  );
  for (const bad of [
    { ...identity, database_name: "istasyonos_demo" },
    { ...identity, server_hostname: "OTHER" },
    { ...identity, server_port: "3307" },
    { ...identity, current_user: "root@localhost" },
    { ...identity, current_role: "admin@%" },
    { ...identity, server_uuid: "" },
  ])
    assert.throws(
      () => validateTrialReadonlyIdentity(bad, "st_trial_ro"),
      /READONLY_IDENTITY_MISMATCH/
    );
});

test("accepts SELECT and SHOW VIEW only on the exact trial schema", () => {
  validateTrialReadonlyGrants(
    [
      "GRANT USAGE ON *.* TO `st_trial_ro`@`localhost`",
      "GRANT SELECT, SHOW VIEW ON `istasyonos_migration_trial`.* TO `st_trial_ro`@`localhost`",
    ],
    "istasyonos_migration_trial",
    currentUser
  );
  for (const grants of [
    ["GRANT SELECT ON *.* TO `st_trial_ro`@`localhost`"],
    ["GRANT SELECT ON `istasyonos_demo`.* TO `st_trial_ro`@`localhost`"],
    [
      "GRANT SELECT, INSERT ON `istasyonos_migration_trial`.* TO `st_trial_ro`@`localhost`",
    ],
    ["GRANT USAGE ON *.* TO `st_trial_ro`@`localhost`"],
    ["GRANT SELECT ON `istasyonos_migration_trial`.* TO `other`@`localhost`"],
    [
      "GRANT SELECT ON `istasyonos_migration_trial`.* TO `st_trial_ro`@`localhost` WITH GRANT OPTION",
    ],
  ])
    assert.throws(
      () =>
        validateTrialReadonlyGrants(
          grants,
          "istasyonos_migration_trial",
          currentUser
        ),
      /READONLY_GRANTS_REJECTED/
    );
});

test("uses separate single statements and avoids reserved current_user alias", () => {
  assert.equal(readonlyPreflightSql.grants, "SHOW GRANTS");
  for (const [stage, sql] of Object.entries(readonlyPreflightSql)) {
    assert.equal(sql.includes(";"), false, `${stage} must be one statement`);
    assert.equal(/\bAS\s+current_user\b/i.test(sql), false);
  }
  assert.match(
    readonlyPreflightSql.account,
    /CURRENT_USER\(\) AS effective_account/
  );
  assert.match(
    readonlyPreflightSql.database,
    /DATABASE\(\) AS selected_database/
  );
});

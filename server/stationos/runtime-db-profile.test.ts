import { describe, expect, it } from "vitest";
import {
  readStationosRuntimeTestProfile,
  validateStationosRuntimeGrants,
  validateStationosRuntimeIdentity,
  type RuntimeDbEnvironment,
} from "./runtime-db-profile";

const base: RuntimeDbEnvironment = {
  STATIONOS_APP_TEST_MODE: "1",
  NODE_ENV: "development",
  BIND_HOST: "127.0.0.1",
  STATIONOS_APP_TEST_DATABASE_URL:
    "mysql://stationos_oesse_runtime:synthetic-secret@127.0.0.1:3306/istasyonos_oesse_app_trial",
  STATIONOS_APP_TEST_EXPECTED_HOST: "127.0.0.1",
  STATIONOS_APP_TEST_EXPECTED_PORT: "3306",
  STATIONOS_APP_TEST_EXPECTED_SERVER_UUID:
    "11111111-1111-4111-8111-111111111111",
  STATIONOS_APP_TEST_EXPECTED_DATABASE: "istasyonos_oesse_app_trial",
  STATIONOS_APP_TEST_EXPECTED_CURRENT_USER: "stationos_oesse_runtime@localhost",
  STATIONOS_APP_TEST_EXPECTED_SERVER_HOSTNAME: "oesse-test-mysql",
};

const profile = () => readStationosRuntimeTestProfile(base)!;
const identity = {
  database: "istasyonos_oesse_app_trial",
  host: "127.0.0.1",
  port: 3306,
  serverUuid: "11111111-1111-4111-8111-111111111111",
  serverHostname: "oesse-test-mysql",
  currentUser: "stationos_oesse_runtime@localhost",
  currentRole: "NONE",
};
const allowedGrants = [
  "GRANT USAGE ON *.* TO 'stationos_oesse_runtime'@'localhost'",
  "GRANT SELECT, INSERT, UPDATE, DELETE ON `istasyonos_oesse_app_trial`.* TO 'stationos_oesse_runtime'@'localhost'",
];

describe("isolated application runtime DB profile", () => {
  it("does not alter normal mode and requires the explicit isolated mode", () => {
    expect(
      readStationosRuntimeTestProfile({ DATABASE_URL: "mysql://normal" })
    ).toBeNull();
    expect(() =>
      readStationosRuntimeTestProfile({
        ...base,
        STATIONOS_APP_TEST_MODE: "true",
      })
    ).toThrow("STATIONOS_TEST_DB_TARGET_REJECTED");
  });

  it("rejects production, non-loopback, missing identity, and missing password", () => {
    for (const changed of [
      { NODE_ENV: "production" },
      { BIND_HOST: "0.0.0.0" },
      { STATIONOS_APP_TEST_EXPECTED_SERVER_UUID: undefined },
      { STATIONOS_APP_TEST_EXPECTED_CURRENT_USER: undefined },
      {
        STATIONOS_APP_TEST_DATABASE_URL:
          "mysql://stationos_oesse_runtime@127.0.0.1:3306/istasyonos_oesse_app_trial",
      },
    ])
      expect(() =>
        readStationosRuntimeTestProfile({ ...base, ...changed })
      ).toThrow("STATIONOS_TEST_DB_TARGET_REJECTED");
  });

  it("rejects forbidden databases, host, port, migration and privileged users", () => {
    const cases: RuntimeDbEnvironment[] = [
      { ...base, STATIONOS_APP_TEST_EXPECTED_DATABASE: "istasyonos_db" },
      { ...base, STATIONOS_APP_TEST_EXPECTED_DATABASE: "istasyonos_demo" },
      {
        ...base,
        STATIONOS_APP_TEST_EXPECTED_DATABASE: "istasyonos_migration_trial",
      },
      { ...base, STATIONOS_APP_TEST_EXPECTED_DATABASE: "aksan_local" },
      {
        ...base,
        STATIONOS_APP_TEST_DATABASE_URL:
          "mysql://stationos_oesse_runtime:secret@other-host:3306/istasyonos_oesse_app_trial",
      },
      {
        ...base,
        STATIONOS_APP_TEST_DATABASE_URL:
          "mysql://stationos_oesse_runtime:secret@127.0.0.1:3307/istasyonos_oesse_app_trial",
      },
      {
        ...base,
        STATIONOS_APP_TEST_DATABASE_URL:
          "mysql://stationos_oesse_runtime:secret@127.0.0.1:3306/istasyonos_oesse_app_trial?multipleStatements=1",
      },
      {
        ...base,
        STATIONOS_APP_TEST_DATABASE_URL:
          "mysql://root:secret@127.0.0.1:3306/istasyonos_oesse_app_trial",
        STATIONOS_APP_TEST_EXPECTED_CURRENT_USER: "root@localhost",
      },
      {
        ...base,
        STATIONOS_APP_TEST_DATABASE_URL:
          "mysql://stationos_trial_migrator:secret@127.0.0.1:3306/istasyonos_oesse_app_trial",
        STATIONOS_APP_TEST_EXPECTED_CURRENT_USER:
          "stationos_trial_migrator@localhost",
      },
    ];
    for (const environment of cases)
      expect(() => readStationosRuntimeTestProfile(environment)).toThrow(
        "STATIONOS_TEST_DB_TARGET_REJECTED"
      );
  });

  it("validates the physical connection identity and rejects replacement targets", () => {
    expect(() =>
      validateStationosRuntimeIdentity(identity, profile())
    ).not.toThrow();
    for (const changed of [
      { database: "istasyonos_demo" },
      { host: "remote-db" },
      { port: 3307 },
      { serverUuid: "22222222-2222-4222-8222-222222222222" },
      { currentUser: "other@localhost" },
      { currentRole: "test_role" },
      { serverHostname: "other-server" },
    ])
      expect(() =>
        validateStationosRuntimeIdentity({ ...identity, ...changed }, profile())
      ).toThrow("STATIONOS_TEST_DB_TARGET_REJECTED");
  });

  it("accepts only target-schema CRUD grants and USAGE", () => {
    expect(() =>
      validateStationosRuntimeGrants(
        allowedGrants,
        "istasyonos_oesse_app_trial",
        "stationos_oesse_runtime@localhost"
      )
    ).not.toThrow();
    const invalidGrantSets = [
      [
        ...allowedGrants,
        "GRANT CREATE ON `istasyonos_oesse_app_trial`.* TO 'stationos_oesse_runtime'@'localhost'",
      ],
      [
        ...allowedGrants,
        "GRANT SELECT ON `istasyonos_demo`.* TO 'stationos_oesse_runtime'@'localhost'",
      ],
      ["GRANT USAGE ON *.* TO 'stationos_oesse_runtime'@'localhost'"],
      [
        "GRANT SELECT, INSERT, UPDATE, DELETE ON `istasyonos_oesse_app_trial`.* TO 'stationos_oesse_runtime'@'localhost' WITH GRANT OPTION",
        ...allowedGrants.slice(0, 1),
      ],
      [
        ...allowedGrants.slice(0, 1),
        "GRANT SELECT, INSERT, UPDATE ON `istasyonos_oesse_app_trial`.* TO 'stationos_oesse_runtime'@'localhost'",
      ],
    ];
    for (const grants of invalidGrantSets)
      expect(() =>
        validateStationosRuntimeGrants(
          grants,
          "istasyonos_oesse_app_trial",
          "stationos_oesse_runtime@localhost"
        )
      ).toThrow("STATIONOS_TEST_DB_TARGET_REJECTED");
  });

  it("does not include secrets or target values in rejection errors", () => {
    const secret = "synthetic-secret";
    try {
      readStationosRuntimeTestProfile({
        ...base,
        STATIONOS_APP_TEST_EXPECTED_DATABASE: "istasyonos_demo",
      });
    } catch (error) {
      expect(String(error)).not.toContain(secret);
      expect(String(error)).not.toContain("istasyonos_demo");
      expect(String(error)).toContain("STATIONOS_TEST_DB_TARGET_REJECTED");
    }
  });
});

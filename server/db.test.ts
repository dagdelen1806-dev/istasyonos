import { beforeEach, describe, expect, it, vi } from "vitest";

const fake = vi.hoisted(() => ({
  drizzle: vi.fn((pool: unknown) => ({ pool })),
  createRuntimePool: vi.fn(() => ({ isolated: true })),
  createUtcPool: vi.fn(() => ({ normal: true })),
}));

vi.mock("drizzle-orm", () => ({ eq: vi.fn() }));
vi.mock("drizzle-orm/mysql2", () => ({ drizzle: fake.drizzle }));
vi.mock("./stationos/db", () => ({
  createStationosRuntimeTestPool: fake.createRuntimePool,
}));
vi.mock("./stationos/utc-pool", () => ({ createUtcPool: fake.createUtcPool }));

const profileEnv = {
  STATIONOS_APP_TEST_MODE: "1",
  NODE_ENV: "development",
  BIND_HOST: "127.0.0.1",
  STATIONOS_APP_TEST_DATABASE_URL:
    "mysql://stationos_oesse_runtime:secret@127.0.0.1:3306/istasyonos_oesse_app_trial",
  STATIONOS_APP_TEST_EXPECTED_HOST: "127.0.0.1",
  STATIONOS_APP_TEST_EXPECTED_PORT: "3306",
  STATIONOS_APP_TEST_EXPECTED_SERVER_UUID:
    "11111111-1111-4111-8111-111111111111",
  STATIONOS_APP_TEST_EXPECTED_DATABASE: "istasyonos_oesse_app_trial",
  STATIONOS_APP_TEST_EXPECTED_CURRENT_USER: "stationos_oesse_runtime@localhost",
};

beforeEach(() => {
  vi.resetModules();
  vi.unstubAllEnvs();
  fake.drizzle.mockClear();
  fake.createRuntimePool.mockClear();
  fake.createUtcPool.mockClear();
});

describe("platform Drizzle pool uses isolated StationOS target in test mode", () => {
  it("routes away from DATABASE_URL and uses the target-guarded pool", async () => {
    for (const [key, value] of Object.entries(profileEnv))
      vi.stubEnv(key, value);
    vi.stubEnv(
      "DATABASE_URL",
      "mysql://main:secret@main.invalid/istasyonos_db"
    );
    const { getDb } = await import("./db");
    const database = await getDb();
    expect(database).toBeDefined();
    expect(fake.createRuntimePool).toHaveBeenCalledWith({
      uri: profileEnv.STATIONOS_APP_TEST_DATABASE_URL,
    });
    expect(fake.createUtcPool).not.toHaveBeenCalled();
  });

  it("rejects incomplete test profile without falling back to the main URL", async () => {
    vi.stubEnv("STATIONOS_APP_TEST_MODE", "1");
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("BIND_HOST", "127.0.0.1");
    vi.stubEnv(
      "DATABASE_URL",
      "mysql://main:secret@main.invalid/istasyonos_db"
    );
    const { getDb } = await import("./db");
    await expect(getDb()).rejects.toThrow("STATIONOS_TEST_DB_TARGET_REJECTED");
    expect(fake.createRuntimePool).not.toHaveBeenCalled();
    expect(fake.createUtcPool).not.toHaveBeenCalled();
  });

  it("preserves the existing pool in normal mode", async () => {
    vi.stubEnv("DATABASE_URL", "mysql://normal:secret@localhost/normal_db");
    const { getDb } = await import("./db");
    await getDb();
    expect(fake.createUtcPool).toHaveBeenCalledWith({
      uri: "mysql://normal:secret@localhost/normal_db",
    });
    expect(fake.createRuntimePool).not.toHaveBeenCalled();
  });

  it("rejects test mode activation after the normal Drizzle pool was cached", async () => {
    vi.stubEnv("DATABASE_URL", "mysql://normal:secret@localhost/normal_db");
    const { getDb } = await import("./db");
    await getDb();
    for (const [key, value] of Object.entries(profileEnv))
      vi.stubEnv(key, value);
    await expect(getDb()).rejects.toThrow("STATIONOS_TEST_DB_TARGET_REJECTED");
    expect(fake.createRuntimePool).not.toHaveBeenCalled();
    expect(fake.createUtcPool).toHaveBeenCalledOnce();
  });
});

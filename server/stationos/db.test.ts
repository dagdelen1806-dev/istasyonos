import { beforeEach, describe, expect, it, vi } from "vitest";

const fake = vi.hoisted(() => ({
  create: vi.fn(),
  pool: { end: vi.fn(async () => undefined) },
}));

vi.mock("./utc-pool", () => ({
  createUtcPool: (...args: unknown[]) => {
    fake.create(...args);
    return fake.pool;
  },
}));

const testEnv = {
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
  fake.create.mockClear();
});

describe("StationOS test-profile pool routing", () => {
  it("uses only the dedicated target and installs a connection guard", async () => {
    vi.stubEnv("STATIONOS_APP_TEST_MODE", testEnv.STATIONOS_APP_TEST_MODE);
    for (const [key, value] of Object.entries(testEnv)) vi.stubEnv(key, value);
    vi.stubEnv(
      "DATABASE_URL",
      "mysql://main:secret@main.invalid/istasyonos_db"
    );

    const { getStationPool } = await import("./db");
    expect(getStationPool()).toBe(fake.pool);
    expect(fake.create).toHaveBeenCalledOnce();
    const [options, guard] = fake.create.mock.calls[0] as [
      Record<string, unknown>,
      (connection: unknown) => Promise<void>,
    ];
    expect(options.uri).toBe(testEnv.STATIONOS_APP_TEST_DATABASE_URL);
    expect(options.uri).not.toBe(
      "mysql://main:secret@main.invalid/istasyonos_db"
    );
    expect(guard).toEqual(expect.any(Function));
  });

  it("fails closed instead of falling back to DATABASE_URL when test config is incomplete", async () => {
    vi.stubEnv("STATIONOS_APP_TEST_MODE", "1");
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("BIND_HOST", "127.0.0.1");
    vi.stubEnv(
      "DATABASE_URL",
      "mysql://main:secret@main.invalid/istasyonos_db"
    );

    const { getStationPool } = await import("./db");
    expect(() => getStationPool()).toThrow("STATIONOS_TEST_DB_TARGET_REJECTED");
    expect(fake.create).not.toHaveBeenCalled();
  });

  it("preserves existing DATABASE_URL behavior when test mode is absent", async () => {
    vi.stubEnv("DATABASE_URL", "mysql://normal:secret@127.0.0.1/normal_db");
    const { getStationPool } = await import("./db");
    expect(getStationPool()).toBe(fake.pool);
    expect(fake.create).toHaveBeenCalledOnce();
    expect(fake.create.mock.calls[0]?.[0]).toMatchObject({
      uri: "mysql://normal:secret@127.0.0.1/normal_db",
    });
    expect(fake.create.mock.calls[0]?.[1]).toBeUndefined();
  });

  it("rejects enabling the test profile after a normal pool has been created", async () => {
    vi.stubEnv("DATABASE_URL", "mysql://normal:secret@localhost/normal_db");
    const { getStationPool } = await import("./db");
    getStationPool();
    for (const [key, value] of Object.entries(testEnv)) vi.stubEnv(key, value);
    expect(() => getStationPool()).toThrow("STATIONOS_TEST_DB_TARGET_REJECTED");
    expect(fake.create).toHaveBeenCalledOnce();
  });
});

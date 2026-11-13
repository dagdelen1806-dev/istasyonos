import { beforeEach, describe, expect, it, vi } from "vitest";

const fake = vi.hoisted(() => ({
  create: vi.fn(),
  connection: { query: vi.fn(), destroy: vi.fn() },
  acquireError: null as Error | null,
}));
vi.mock("mysql2", () => ({
  default: {
    createPool: (options: unknown) => {
      fake.create(options);
      const core = {
        getConnection(
          callback: (error: Error | null, connection: any) => void
        ) {
          callback(fake.acquireError, fake.connection);
        },
        promise() {
          return core;
        },
      };
      return core;
    },
  },
}));
import { createUtcPool } from "./utc-pool";
beforeEach(() => {
  fake.acquireError = null;
  fake.create.mockClear();
  fake.connection.query.mockReset();
  fake.connection.destroy.mockReset();
});

describe("UTC havuz kurulumu (sürücü taklidi, bağlantı yok)", () => {
  it("UTC kurulmadan bağlantıyı teslim etmez; yeniden edinmede tekrar kurar", () => {
    const pool = createUtcPool({ connectionLimit: 8 }) as any;
    expect(fake.create).toHaveBeenCalledWith({
      connectionLimit: 8,
      timezone: "Z",
    });
    const ready = vi.fn();
    pool.getConnection(ready);
    expect(ready).not.toHaveBeenCalled();
    expect(fake.connection.query).toHaveBeenCalledWith(
      "SET time_zone = '+00:00'",
      expect.any(Function)
    );
    fake.connection.query.mock.calls[0][1](null);
    expect(ready).toHaveBeenCalledWith(null, fake.connection);
    pool.getConnection(ready);
    expect(fake.connection.query).toHaveBeenCalledTimes(2);
    expect(fake.connection.destroy).not.toHaveBeenCalled();
  });
  it("UTC kurulumu başarısız bağlantıyı kullanımdan çıkarır", () => {
    const pool = createUtcPool({}) as any;
    const ready = vi.fn();
    pool.getConnection(ready);
    const error = new Error("synthetic timezone failure");
    fake.connection.query.mock.calls[0][1](error);
    expect(fake.connection.destroy).toHaveBeenCalledOnce();
    expect(ready).toHaveBeenCalledWith(error, fake.connection);
  });
  it("edinme hatasında bağlantı üzerinde komut çalıştırmaz", () => {
    fake.acquireError = new Error("synthetic acquire failure");
    const pool = createUtcPool({}) as any;
    const ready = vi.fn();
    pool.getConnection(ready);
    expect(ready).toHaveBeenCalledWith(fake.acquireError, fake.connection);
    expect(fake.connection.query).not.toHaveBeenCalled();
  });

  it("test bağlantı hedefi doğrulanmadan havuz bağlantısını teslim etmez", async () => {
    let acceptGuard!: () => void;
    const guard = vi.fn(
      () =>
        new Promise<void>(resolve => {
          acceptGuard = resolve;
        })
    );
    const pool = createUtcPool({}, guard) as any;
    const ready = vi.fn();
    pool.getConnection(ready);
    fake.connection.query.mock.calls[0][1](null);
    expect(guard).toHaveBeenCalledOnce();
    expect(ready).not.toHaveBeenCalled();
    acceptGuard();
    await vi.waitFor(() =>
      expect(ready).toHaveBeenCalledWith(null, fake.connection)
    );
  });

  it("hedef kontrolü reddedilince doğrulanmamış bağlantıyı yok eder", async () => {
    const pool = createUtcPool({}, async () => {
      throw new Error("secret and database identity");
    }) as any;
    const ready = vi.fn();
    pool.getConnection(ready);
    fake.connection.query.mock.calls[0][1](null);
    await vi.waitFor(() =>
      expect(ready).toHaveBeenCalledWith(
        expect.objectContaining({
          message: "STATIONOS_TEST_DB_TARGET_REJECTED",
        }),
        fake.connection
      )
    );
    expect(fake.connection.destroy).toHaveBeenCalledOnce();
    expect(String(ready.mock.calls[0]?.[0])).not.toContain("secret");
  });
});

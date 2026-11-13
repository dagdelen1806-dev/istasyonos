import { beforeEach, describe, expect, it, vi } from "vitest";
const fake = vi.hoisted(() => ({
  beginTransaction: vi.fn(),
  commit: vi.fn(),
  rollback: vi.fn(),
  release: vi.fn(),
}));
vi.mock("./utc-pool", () => ({
  createUtcPool: () => ({ getConnection: async () => fake }),
}));
import { withTransaction, transactionRollbackConfirmed } from "./db";
beforeEach(() => {
  vi.stubEnv("DATABASE_URL", "mock-only-no-driver");
  fake.beginTransaction.mockReset().mockResolvedValue(undefined);
  fake.commit.mockReset().mockResolvedValue(undefined);
  fake.rollback.mockReset().mockResolvedValue(undefined);
  fake.release.mockClear();
});
describe("Transaction sonuç kanıtı (sürücü/bağlantı yok)", () => {
  it("iş kuralı hatası ve rollback ACK kesin başarısızlıktır", async () => {
    const error = new Error("business failure");
    await expect(
      withTransaction(async () => {
        throw error;
      })
    ).rejects.toBe(error);
    expect(transactionRollbackConfirmed(error)).toBe(true);
    expect(fake.commit).not.toHaveBeenCalled();
    expect(fake.release).toHaveBeenCalledOnce();
  });
  it("commit yanıtı kaybolduğunda rollback ACK bile sonucu kesinleştirmez", async () => {
    const error = new Error("lost commit acknowledgement");
    fake.commit.mockRejectedValue(error);
    await expect(withTransaction(async () => "effect")).rejects.toBe(error);
    expect(transactionRollbackConfirmed(error)).toBe(false);
    expect(fake.release).toHaveBeenCalledOnce();
  });
  it("bağlantı kopması ve rollback hatası ilk hatayı korur ve belirsizdir", async () => {
    const error = new Error("connection lost");
    fake.rollback.mockRejectedValue(new Error("rollback lost"));
    await expect(
      withTransaction(async () => {
        throw error;
      })
    ).rejects.toBe(error);
    expect(transactionRollbackConfirmed(error)).toBe(false);
  });
  it("başarı yalnız commit ACK sonrası döner", async () => {
    expect(await withTransaction(async () => "saved")).toBe("saved");
    expect(fake.commit).toHaveBeenCalledOnce();
    expect(fake.rollback).not.toHaveBeenCalled();
  });
});

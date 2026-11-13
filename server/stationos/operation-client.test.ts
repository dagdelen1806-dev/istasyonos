import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  OperationRecovery,
  PendingOperationStore,
  pendingKey,
  type ExclusiveLock,
  type RecoveryTransport,
} from "../../client/src/lib/operation-recovery";
import { operationStatus } from "../../shared/operation-recovery";

const owner = { userId: 7, tenantId: "11111111-1111-4111-8111-111111111111" };
const id = "22222222-2222-4222-8222-222222222222";
let data: Map<string, string>;
let store: PendingOperationStore;
let transport: RecoveryTransport;
let locks: Map<string, Promise<unknown>>;
const exclusive: ExclusiveLock = (key, fn) => {
  const result = (locks.get(key) ?? Promise.resolve()).then(fn);
  locks.set(
    key,
    result.catch(() => undefined)
  );
  return result;
};
const storage = {
  getItem: (key: string) => data.get(key) ?? null,
  setItem: (key: string, value: string) => {
    data.set(key, value);
  },
  removeItem: (key: string) => {
    data.delete(key);
  },
};
beforeEach(() => {
  data = new Map();
  locks = new Map();
  store = new PendingOperationStore(storage, exclusive);
  transport = {
    send: vi.fn(async () => ({ ok: true as const, result: { id: "saved" } })),
    status: vi.fn(async () => operationStatus("IN_PROGRESS")),
  };
});

describe("Kalıcı istemci kurtarma (bellek deposu ve kilit modeli)", () => {
  it("göndermeden önce yalnız izinli metadata yazar; payload ve token yazmaz", async () => {
    transport.send = vi.fn(async () => {
      const saved = JSON.parse(data.get(pendingKey(owner))!);
      expect(Object.keys(saved).sort()).toEqual([
        "createdAt",
        "operation",
        "requestId",
        "tenantId",
        "userId",
        "version",
      ]);
      expect(saved.requestId).toBeDefined();
      expect(JSON.stringify(saved)).not.toMatch(
        /secret|amountMinor|password|code/
      );
      return { ok: true as const, result: { code: "secret-code" } };
    });
    await new OperationRecovery(store, transport).submit(
      owner,
      "/invite",
      {
        amountMinor: 123,
        password: "secret-password",
      },
      "secret-csrf"
    );
    expect(transport.send).toHaveBeenCalledOnce();
  });
  it("başarılı kaydın yanıtı kaybolursa aynı kimlikle sonucu sorgular", async () => {
    transport.send = vi.fn(async () => {
      throw new Error("lost response");
    });
    transport.status = vi.fn(async () => ({
      ...operationStatus("COMPLETED"),
      response: { ok: true as const, result: { id: "saved" } },
    }));
    const view = await new OperationRecovery(store, transport).submit(
      owner,
      "/payment",
      { amountMinor: 100 }
    );
    expect(view.status.state).toBe("COMPLETED");
    expect(view.status.response?.result.id).toBe("saved");
    expect(transport.status).toHaveBeenCalledWith(view.record);
    expect(transport.send).toHaveBeenCalledOnce();
  });
  it("yenilenmiş sayfa eski kimliği kullanır; yeniden mali istek göndermez", async () => {
    await store.claim(owner, "/payment", () => id);
    const reloaded = new OperationRecovery(
      new PendingOperationStore(storage, exclusive),
      transport
    );
    const outcome = await reloaded.submit(owner, "/payment", {
      amountMinor: 999,
    });
    expect(outcome.record.requestId).toBe(id);
    expect(outcome.sent).toBe(false);
    expect(transport.send).not.toHaveBeenCalled();
  });
  it("iki sekme aynı anda talep ettiğinde yalnız bir istek gönderir", async () => {
    const first = new OperationRecovery(store, transport);
    const second = new OperationRecovery(
      new PendingOperationStore(storage, exclusive),
      transport
    );
    const views = await Promise.all([
      first.submit(owner, "/payment", {}),
      second.submit(owner, "/payment", {}),
    ]);
    expect(views[0].record.requestId).toBe(views[1].record.requestId);
    expect(transport.send).toHaveBeenCalledOnce();
  });
  it.each(["NOT_FOUND", "IN_PROGRESS", "UNCERTAIN"] as const)(
    "%s durumunda kayıt silmez veya yeni requestId üretmez",
    async state => {
      await store.claim(owner, "/payment", () => id);
      transport.status = vi.fn(async () => operationStatus(state));
      const controller = new OperationRecovery(store, transport);
      const view = await controller.submit(owner, "/stock", {});
      await expect(controller.acknowledge(view)).rejects.toThrow("Belirsiz");
      const makeId = vi.fn(() => id);
      await store.claim(owner, "/payment", makeId);
      expect(makeId).not.toHaveBeenCalled();
      expect((await store.get(owner))?.requestId).toBe(id);
      expect(transport.send).not.toHaveBeenCalled();
    }
  );
  it("durum sorgusu da koparsa belirsiz tutar", async () => {
    transport.send = vi.fn(async () => {
      throw new Error("network");
    });
    transport.status = vi.fn(async () => {
      throw new Error("network");
    });
    const view = await new OperationRecovery(store, transport).submit(
      owner,
      "/payment",
      {}
    );
    expect(view.status.state).toBe("UNCERTAIN");
    expect(await store.get(owner)).not.toBeNull();
  });
  it("kullanıcı ve tenant depoları birbirinden ayrıdır", async () => {
    await store.claim(owner, "/payment", () => id);
    expect(await store.get({ ...owner, userId: 8 })).toBeNull();
    expect(await store.get({ ...owner, tenantId: "other" })).toBeNull();
  });
  it("gecikmiş sekmenin onayı daha yeni işlemi silemez", async () => {
    const old = await store.claim(owner, "/payment", () => id);
    await store.acknowledge(owner, id);
    const nextId = "33333333-3333-4333-8333-333333333333";
    await store.claim(owner, "/payment", () => nextId);
    await store.acknowledge(owner, old.record.requestId);
    expect((await store.get(owner))?.requestId).toBe(nextId);
  });
  it("bozuk veya fazladan hassas alan içeren depo varsa mali istek göndermez", async () => {
    const record = (await store.claim(owner, "/payment", () => id)).record;
    data.set(
      pendingKey(owner),
      JSON.stringify({ ...record, password: "secret" })
    );
    await expect(
      new OperationRecovery(store, transport).submit(owner, "/payment", {})
    ).rejects.toThrow();
    expect(transport.send).not.toHaveBeenCalled();
  });
  it("depolama kota hatasında sunucuya göndermez", async () => {
    const broken = new PendingOperationStore(
      {
        ...storage,
        setItem() {
          throw new Error("quota");
        },
      },
      exclusive
    );
    await expect(
      new OperationRecovery(broken, transport).submit(owner, "/payment", {})
    ).rejects.toThrow("quota");
    expect(transport.send).not.toHaveBeenCalled();
  });
  it.each(["COMPLETED", "FAILED"] as const)(
    "%s yalnız açık kullanıcı onayıyla temizlenir",
    async state => {
      const record = (await store.claim(owner, "/payment", () => id)).record;
      const controller = new OperationRecovery(store, transport);
      await controller.acknowledge({ record, status: operationStatus(state) });
      expect(await store.get(owner)).toBeNull();
    }
  );
});

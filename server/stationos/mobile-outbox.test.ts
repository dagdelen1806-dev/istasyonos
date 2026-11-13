import { describe, expect, it } from "vitest";
import type { AppState } from "@shared/station";
import {
  canTransitionMobileStatus,
  mobileQueueWithinLimit,
  mobileSyncFailure,
  newClientOperationId,
  offlineContextWithinAge,
  mobileRequestFor,
  mobileScopeConflict,
  sortMobileOperations,
  sameMobileFingerprint,
  withMobileSyncLock,
  recoverInterruptedOperations,
  buildOfflineContextState,
  requirePositiveMobilePaymentAmount,
  type MobileQueueItem,
} from "../../client/src/lib/mobile-outbox";

const state = {
  user: { id: 17, name: "Demo ÖSSE", email: null },
  tenant: { id: "tenant-a", name: "Demo", isDemo: true },
  member: { role: "FUEL_STAFF", stationIds: ["station-a"] },
} as AppState;
const account = {
  id: "account-a",
  userId: 17,
  stationId: "station-a",
  shiftId: "shift-a",
  businessUnit: "FUEL",
  status: "OPEN",
  revision: 9,
} as AppState["accounts"][number];
function item(patch: Partial<MobileQueueItem> = {}): MobileQueueItem {
  return {
    userId: 17,
    tenantId: "tenant-a",
    stationId: "station-a",
    shiftId: "shift-a",
    accountId: "account-a",
    clientOperationId: "op-a",
    createdAt: "2026-11-08T07:00:00.000Z",
    kind: "PAYMENT",
    status: "PENDING_SYNC",
    attemptCount: 0,
    retryable: false,
    encryptedPayload: null,
    encryptedSyncPayload: null,
    ...patch,
  };
}

describe("ÖSSE çevrimdışı kuyruk güvenlik kuralları", () => {
  it("offline yetki bağlamına yalnız personelin izinli istasyon, vardiya, hesap ve cari verisini alır", () => {
    const accountRow = (
      id: string,
      userId: number,
      stationId: string,
      shiftId: string,
      businessUnit: "FUEL" | "MARKET" = "FUEL",
      status = "OPEN"
    ) =>
      ({
        id,
        userId,
        stationId,
        shiftId,
        businessUnit,
        status,
        userName: `user-${userId}`,
        revision: 1,
        openingFloatMinor: 0,
        sourceSalesMinor: null,
        sourceRef: null,
        cardTotalMinor: 0,
        cashSalesMinor: 0,
        ibanMinor: 0,
        fastMinor: 0,
        debtMinor: 0,
        arCollectionMinor: 0,
        expectedCashMinor: 0,
        countedCashMinor: null,
        differenceMinor: null,
        cashReceiverUserId: null,
        signatureCount: 0,
      }) as AppState["accounts"][number];
    const source = {
      ...state,
      csrfToken: "do-not-cache",
      staffingFeaturesAvailable: true,
      fastPaymentAvailable: true,
      posSlipAvailable: true,
      companies: [{ id: "company-a", name: "Private", taxNumber: null }],
      stations: [
        {
          id: "station-a",
          companyId: "company-a",
          name: "Allowed",
          code: "A",
          address: "private",
        },
        {
          id: "station-b",
          companyId: "company-a",
          name: "Other",
          code: "B",
          address: "private",
        },
      ],
      members: [
        {
          userId: 99,
          name: "Other worker",
          email: null,
          role: "FUEL_STAFF",
          stationIds: ["station-a"],
        },
      ],
      shifts: [
        {
          id: "shift-a",
          stationId: "station-a",
          label: "My account",
          startsAt: "2026-11-11T05:00:00.000Z",
          endsAt: null,
          status: "OPEN",
          assignedUserIds: [17, 99],
        },
        {
          id: "shift-b",
          stationId: "station-b",
          label: "Other station",
          startsAt: "2026-11-11T05:00:00.000Z",
          endsAt: null,
          status: "OPEN",
          assignedUserIds: [17],
        },
        {
          id: "shift-c",
          stationId: "station-a",
          label: "Other worker",
          startsAt: "2026-11-11T05:00:00.000Z",
          endsAt: null,
          status: "OPEN",
          assignedUserIds: [99],
        },
      ],
      accounts: [
        accountRow("my-account", 17, "station-a", "shift-a"),
        accountRow("other-user-account", 99, "station-a", "shift-a"),
        accountRow("other-station-account", 17, "station-b", "shift-b"),
        accountRow("market-account", 17, "station-a", "shift-a", "MARKET"),
        accountRow(
          "closed-account",
          17,
          "station-a",
          "shift-a",
          "FUEL",
          "ACCEPTED"
        ),
      ],
      payments: [
        {
          id: "payment-a",
          accountId: "my-account",
          kind: "CASH",
          amountMinor: 1,
          debtorId: null,
          reference: null,
          status: "POSTED",
        },
      ],
      slips: [],
      debtors: [
        {
          id: "debtor-a",
          stationId: "station-a",
          name: "Allowed customer",
          type: "PERSON",
          balanceMinor: 12_000,
        },
        {
          id: "debtor-b",
          stationId: "station-b",
          name: "Other customer",
          type: "PERSON",
          balanceMinor: 99_000,
        },
      ],
      products: [],
      suppliers: [],
      payables: [],
      recommendations: [],
      audit: [
        {
          id: "audit-a",
          actorName: "Other user",
          action: "private",
          entityId: null,
          createdAt: "2026-11-11T05:00:00.000Z",
        },
      ],
      accountEvents: [
        {
          id: "event-a",
          accountId: "my-account",
          actorName: "private",
          eventType: "private",
          revision: 1,
          createdAt: "2026-11-11T05:00:00.000Z",
          payload: {},
        },
      ],
      integrationStatus: {
        turpak: "CONNECTED",
        ocr: "READY",
        bank: "CONNECTED",
      },
    } as unknown as AppState;

    const offline = buildOfflineContextState(source);
    expect(offline.csrfToken).toBeUndefined();
    expect(offline.staffingFeaturesAvailable).toBe(false);
    expect(offline.fastPaymentAvailable).toBe(false);
    expect(offline.posSlipAvailable).toBe(false);
    expect(offline.stations.map(row => row.id)).toEqual(["station-a"]);
    expect(offline.accounts.map(row => row.id)).toEqual(["my-account"]);
    expect(offline.shifts.map(row => row.id)).toEqual(["shift-a"]);
    expect(offline.shifts[0]?.assignedUserIds).toEqual([17]);
    expect(offline.debtors).toEqual([
      {
        id: "debtor-a",
        stationId: "station-a",
        name: "Allowed customer",
        type: "PERSON",
        balanceMinor: null,
      },
    ]);
    expect(offline.payments).toEqual([]);
    expect(offline.members).toEqual([]);
    expect(offline.audit).toEqual([]);
    expect(offline.accountEvents).toEqual([]);
    expect(offline.integrationStatus).toEqual({
      turpak: "OFFLINE",
      ocr: "OFFLINE",
      bank: "OFFLINE",
    });
  });

  it("geçersiz personel veya istasyon kapsamını offline bağlamına kaydetmez", () => {
    expect(() =>
      buildOfflineContextState({
        ...state,
        member: { role: "ACCOUNTANT", stationIds: ["station-a"] },
      } as AppState)
    ).toThrow("OFFLINE_FUEL_STAFF_SCOPE_REQUIRED");
    expect(() =>
      buildOfflineContextState({
        ...state,
        member: { role: "FUEL_STAFF", stationIds: undefined },
      } as unknown as AppState)
    ).toThrow("OFFLINE_FUEL_STAFF_SCOPE_REQUIRED");
  });

  it("aynı istasyondaki personel/tenant/hesap/vardiya kapsamını kabul eder", () => {
    expect(mobileScopeConflict(item(), state, account, false)).toBeNull();
  });

  it("yanlış personel, tenant, istasyon ve vardiya eşleşmesini gönderimden önce reddeder", () => {
    expect(
      mobileScopeConflict(item({ userId: 18 }), state, account, false)
    ).toBe("SCOPE_MISMATCH");
    expect(
      mobileScopeConflict(item({ tenantId: "tenant-b" }), state, account, false)
    ).toBe("SCOPE_MISMATCH");
    expect(
      mobileScopeConflict(
        item({ stationId: "station-b" }),
        state,
        account,
        false
      )
    ).toBe("SCOPE_MISMATCH");
    expect(
      mobileScopeConflict(item({ shiftId: "shift-b" }), state, account, false)
    ).toBe("ACCOUNT_SCOPE_MISMATCH");
  });

  it("istasyon seçimi değişince bekleyen kaydın vardiya kapsamını taşımaz", () => {
    const queued = item();
    const otherStationState = {
      ...state,
      member: { role: "FUEL_STAFF", stationIds: ["station-b"] },
    } as AppState;
    expect(mobileScopeConflict(queued, otherStationState, account, false)).toBe(
      "SCOPE_MISMATCH"
    );
    expect(queued).toMatchObject({
      stationId: "station-a",
      shiftId: "shift-a",
      accountId: "account-a",
    });
  });

  it("kapanmış hesabı yeni işlem için reddeder ama belirsiz aynı isteğin idempotent tekrarına izin verir", () => {
    const closed = { ...account, status: "SUBMITTED" };
    expect(mobileScopeConflict(item(), state, closed, false)).toBe(
      "ACCOUNT_NOT_OPEN"
    );
    expect(
      mobileScopeConflict(
        item({
          encryptedSyncPayload: {
            iv: new ArrayBuffer(12),
            data: new ArrayBuffer(1),
          },
        }),
        state,
        closed,
        true
      )
    ).toBeNull();
  });

  it("FAST ve IBAN beyanlarını ayrı tür olarak korur; güncel hesap revizyonunu bağlar", () => {
    const fast = mobileRequestFor(
      item(),
      { kind: "FAST", amountMinor: 440089 },
      account
    );
    const iban = mobileRequestFor(
      item(),
      { kind: "IBAN", amountMinor: 440089 },
      account
    );
    expect(fast.path).toBe("/payment");
    expect(fast.body).toMatchObject({
      kind: "FAST",
      expectedRevision: 9,
      accountId: "account-a",
    });
    expect(iban.body.kind).toBe("IBAN");
    expect(fast.body.kind).not.toBe(iban.body.kind);
  });

  it("mobil ödeme beyanında boş, sıfır, negatif ve güvenli tamsayı olmayan tutarı kuyruğa almadan reddeder", () => {
    expect(requirePositiveMobilePaymentAmount(1)).toBe(1);
    for (const amount of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1])
      expect(() => requirePositiveMobilePaymentAmount(amount)).toThrow(
        "sıfırdan büyük"
      );
  });

  it("20 beyan ve 10 slipi zaman sırasıyla senkronizasyona hazırlar", () => {
    const rows = Array.from({ length: 30 }, (_, index) =>
      item({
        clientOperationId: `op-${String(index).padStart(2, "0")}`,
        createdAt: new Date(Date.UTC(2026, 10, 8, 7, 0, index)).toISOString(),
        kind: index < 20 ? "PAYMENT" : "POS_SLIP_IMAGE",
      })
    );
    const ordered = sortMobileOperations([...rows].reverse());
    expect(ordered.slice(0, 20).every(row => row.kind === "PAYMENT")).toBe(
      true
    );
    expect(ordered.slice(20).every(row => row.kind === "POS_SLIP_IMAGE")).toBe(
      true
    );
    expect(ordered.map(row => row.clientOperationId)).toEqual(
      rows.map(row => row.clientOperationId)
    );
  });

  it("sunucu alımı doğrulandıktan sonra kuyruğa geri dönmez; çakışma otomatik açılmaz", () => {
    expect(canTransitionMobileStatus("SYNCED", "PENDING_SYNC")).toBe(false);
    expect(canTransitionMobileStatus("CONFLICT", "PENDING_SYNC")).toBe(false);
    expect(canTransitionMobileStatus("SYNCING", "PENDING_SYNC")).toBe(true);
    expect(canTransitionMobileStatus("FAILED", "PENDING_SYNC")).toBe(true);
  });

  it("depolama sınırını aşan yükleri reddeder; sınır içindeki çevrimdışı toplu kayıtları kabul eder", () => {
    expect(mobileQueueWithinLimit(45 * 1024 * 1024, 5 * 1024 * 1024)).toBe(
      true
    );
    expect(mobileQueueWithinLimit(52 * 1024 * 1024, 5 * 1024 * 1024)).toBe(
      false
    );
    expect(mobileQueueWithinLimit(-1, 10)).toBe(false);
  });

  it("20 işlem kimliği birbirinden farklıdır ve son yetki kapsamı 24 saatle sınırlıdır", () => {
    const ids = new Set(
      Array.from({ length: 20 }, () => newClientOperationId())
    );
    expect(ids.size).toBe(20);
    expect([...ids].every(id => /^[0-9a-f-]{36}$/i.test(id))).toBe(true);
    const now = Date.parse("2026-11-08T12:00:00.000Z");
    expect(offlineContextWithinAge("2026-11-08T11:00:00.000Z", now)).toBe(true);
    expect(offlineContextWithinAge("2026-11-07T11:00:00.000Z", now)).toBe(
      false
    );
    expect(offlineContextWithinAge("invalid", now)).toBe(false);
  });

  it("oturum süresini ve ağ/çatışma hatalarını ayrı kuyruk durumlarına çevirir", () => {
    expect(mobileSyncFailure(401, "UNAUTHORIZED")).toMatchObject({
      status: "FAILED",
      retryable: true,
      errorCode: "SESSION_EXPIRED",
      category: "SESSION",
    });
    expect(mobileSyncFailure(0, "NETWORK_UNCERTAIN")).toMatchObject({
      status: "PENDING_SYNC",
      retryable: true,
      category: "NETWORK",
    });
    expect(mobileSyncFailure(503, "SERVER_ERROR")).toMatchObject({
      status: "PENDING_SYNC",
      retryable: true,
      category: "NETWORK",
    });
    expect(mobileSyncFailure(409, "SOURCE_MISMATCH")).toMatchObject({
      status: "CONFLICT",
      retryable: false,
      category: "CONFLICT",
    });
  });

  it("slip fingerprint duplicate matching is scoped to tenant, station, account and kind", () => {
    const original = item({ kind: "POS_SLIP_IMAGE", fingerprint: "abc" });
    const scope = {
      userId: 17,
      tenantId: "tenant-a",
      stationId: "station-a",
      shiftId: "shift-a",
      accountId: "account-a",
      fingerprint: "abc",
    };
    expect(sameMobileFingerprint(original, scope, "POS_SLIP_IMAGE")).toBe(true);
    expect(
      sameMobileFingerprint(
        original,
        { ...scope, tenantId: "tenant-b" },
        "POS_SLIP_IMAGE"
      )
    ).toBe(false);
    expect(
      sameMobileFingerprint(
        original,
        { ...scope, stationId: "station-b" },
        "POS_SLIP_IMAGE"
      )
    ).toBe(false);
    expect(
      sameMobileFingerprint(
        original,
        { ...scope, shiftId: "shift-b" },
        "POS_SLIP_IMAGE"
      )
    ).toBe(false);
    expect(
      sameMobileFingerprint(
        original,
        { ...scope, accountId: "account-b" },
        "POS_SLIP_IMAGE"
      )
    ).toBe(false);
    expect(sameMobileFingerprint(original, scope, "PAYMENT")).toBe(false);
  });

  it("fails closed without cross-tab lock support", async () => {
    let ran = false;
    const result = await withMobileSyncLock(async () => {
      ran = true;
    }, null);
    expect(result.acquired).toBe(false);
    expect(ran).toBe(false);
  });

  it("does not recover an in-flight record unless caller holds the cross-tab lock", async () => {
    await expect(recoverInterruptedOperations(17, false)).rejects.toThrow(
      /Sync lock required/u
    );
  });

  it("runs under the origin lock and skips work while another tab holds it", async () => {
    let ran = 0;
    const available = {
      request: async (
        _name: string,
        _options: unknown,
        callback: (lock: unknown | null) => Promise<unknown>
      ) => callback({}),
    };
    const held = {
      request: async (
        _name: string,
        _options: unknown,
        callback: (lock: unknown | null) => Promise<unknown>
      ) => callback(null),
    };
    const acquired = await withMobileSyncLock(async () => {
      ran++;
      return "ok";
    }, available);
    const busy = await withMobileSyncLock(async () => {
      ran++;
      return "bad";
    }, held);
    expect(acquired).toEqual({ acquired: true, value: "ok" });
    expect(busy).toEqual({ acquired: false });
    expect(ran).toBe(1);
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Express } from "express";

// Transactional memory double only: no mysql driver, sockets, or real records.
const memory = vi.hoisted(() => ({
  requests: new Map<
    string,
    { payload_hash: string; response_json: string | null }
  >(),
  tracking: new Map<string, Record<string, any>>(),
  invitations: new Map<string, Record<string, any>>(),
  stations: new Map<string, string[]>(),
  members: new Map<number, string>(),
  ownerRole: "OWNER",
  accountStatus: "OPEN",
  allowed: true,
  staffingReady: false,
  failSave: false,
  writes: [] as { kind: string; params: unknown[] }[],
  memberStationStatuses: new Map<string, string>(),
  acceptingEmail: "staff@example.test",
  tail: Promise.resolve() as Promise<unknown>,
}));
const station = "11111111-1111-4111-8111-111111111111";
const requestId = "22222222-2222-4222-8222-222222222222";
const joinId = "33333333-3333-4333-8333-333333333333";

vi.mock("../_core/sdk", () => ({ sdk: {} }));
vi.mock("./db", () => {
  function read(sql: string, params: any[] = []): any[] {
    if (sql.includes("information_schema.COLUMNS"))
      return [
        {
          membership_status: memory.staffingReady ? 1 : 0,
          shift_assignments: memory.staffingReady ? 1 : 0,
          staffing_events: memory.staffingReady ? 1 : 0,
          fast_payment: 0,
        },
      ];
    if (sql.includes("SELECT m.role, ms.status FROM st_members")) {
      const [stationId, tenantId, userId] = params;
      const memberRole = memory.members.get(Number(userId));
      const status = memory.memberStationStatuses.get(
        `${tenantId}:${userId}:${stationId}`
      );
      return memberRole ? [{ role: memberRole, status: status ?? null }] : [];
    }
    if (sql.includes("FROM st_shift_assignments")) return [];
    if (sql.includes("FROM st_shifts"))
      return [
        {
          id: params[0],
          status: "OPEN",
          starts_at: "2026-11-12 08:00:00.000",
          ends_at: null,
        },
      ];
    if (sql.includes("FROM st_request_tracking")) {
      const record = memory.tracking.get(`${params[0]}:${params[1]}`);
      return record
        ? [
            {
              ...record,
              recovery_now: new Date()
                .toISOString()
                .replace("T", " ")
                .slice(0, 23),
            },
          ]
        : [];
    }
    if (sql.includes("FROM st_requests")) {
      const saved = memory.requests.get(`${params[0]}:${params[1]}`);
      return saved ? [saved] : [];
    }
    if (sql.includes("FROM users"))
      return [{ id: params[0], email: memory.acceptingEmail }];
    if (sql.includes("FROM st_accounts a JOIN users"))
      return [
        {
          id: params[0],
          tenant_id: "test-tenant",
          station_id: "11111111-1111-4111-8111-111111111111",
          user_id: 7,
          revision: 1,
          cycle_no: 1,
          status: memory.accountStatus,
          opening_float_minor: 0,
          source_sales_minor: null,
        },
      ];
    if (sql.includes("FROM st_terminal_leases")) return [{ count: 0 }];
    if (sql.includes("FROM st_suppliers")) return [{ id: params[0] }];
    if (sql.includes("FROM st_members")) {
      const role =
        params[0] === 7 ? memory.ownerRole : memory.members.get(params[0]);
      return role
        ? [{ tenant_id: "test-tenant", user_id: params[0], role }]
        : [];
    }
    if (sql.includes("FROM st_stations"))
      return memory.allowed
        ? [
            {
              id: "11111111-1111-4111-8111-111111111111",
              tenant_id: "test-tenant",
              company_id: "test-company",
              name: "Test station",
              code: "TEST",
            },
          ]
        : [];
    if (sql.includes("FROM st_member_stations")) {
      const memberStatus = memory.memberStationStatuses.get(
        `test-tenant:${params[1]}:${station}`
      );
      if (sql.includes("status='ACTIVE'"))
        return memberStatus === "ACTIVE" && memory.allowed
          ? [{ id: station }]
          : [];
      return memory.allowed ? [{ id: station }] : [];
    }
    if (sql.includes("FROM st_accounts")) return [];
    if (sql.includes("FROM st_invitation_stations"))
      return (memory.stations.get(params[0]) ?? []).map(station_id => ({
        station_id,
      }));
    if (sql.includes("FROM st_invitations")) {
      const found = [...memory.invitations.values()].find(
        row =>
          row.code_hash === params[0] &&
          (params.length === 1 ||
            (row.tenant_id === params[1] &&
              row.invited_by_user_id === params[2]))
      );
      return found ? [found] : [];
    }
    throw new Error(`Unexpected memory query: ${sql}`);
  }
  async function execute(_connection: unknown, sql: string, params: any[]) {
    if (sql.includes("INSERT INTO st_request_tracking")) {
      const key = `${params[0]}:${params[1]}`;
      if (!memory.tracking.has(key)) {
        const [
          actor_user_id,
          request_id,
          tenant_id,
          operation,
          schema_version,
          scope_hash,
          payload_hash,
          binding_hash,
        ] = params;
        memory.tracking.set(key, {
          actor_user_id,
          request_id,
          tenant_id,
          operation,
          schema_version,
          scope_hash,
          payload_hash,
          binding_hash,
          state: "PROCESSING",
          created_at: new Date().toISOString().replace("T", " ").slice(0, 23),
        });
      }
    } else if (sql.includes("UPDATE st_request_tracking")) {
      const failed = sql.includes("state='FAILED'");
      const [actorId, requestId, hash] = failed ? params.slice(1) : params;
      const record = memory.tracking.get(`${actorId}:${requestId}`);
      if (
        !record ||
        record.binding_hash !== hash ||
        record.state !== "PROCESSING"
      )
        return { affectedRows: 0 };
      record.state = failed ? "FAILED" : "COMPLETED";
      record.error_code = failed ? params[0] : null;
    } else if (sql.includes("INSERT IGNORE INTO st_requests")) {
      const key = `${params[0]}:${params[1]}`;
      if (!memory.requests.has(key))
        memory.requests.set(key, {
          payload_hash: params[2],
          response_json: null,
        });
    } else if (sql.includes("UPDATE st_requests")) {
      if (memory.failSave) throw new Error("synthetic save failure");
      memory.requests.get(`${params[1]}:${params[2]}`)!.response_json =
        params[0];
    } else if (sql.includes("INSERT INTO st_invitations")) {
      const [id, tenant_id, code_hash, role, expires_at, invited_by_user_id] =
        params;
      memory.invitations.set(id, {
        id,
        tenant_id,
        code_hash,
        role,
        expires_at,
        invited_by_user_id,
        used_at: null,
      });
    } else if (sql.includes("INSERT INTO st_invitation_stations")) {
      memory.stations.set(params[0], [
        ...(memory.stations.get(params[0]) ?? []),
        params[1],
      ]);
    } else if (sql.includes("UPDATE st_invitations")) {
      memory.invitations.get(params[0])!.used_at = "2026-10-28 12:00:00";
    } else if (
      sql.includes("INSERT INTO st_member_stations") &&
      sql.includes("'ACTIVE'")
    ) {
      const [tenantId, userId, stationId] = params;
      memory.memberStationStatuses.set(
        `${tenantId}:${userId}:${stationId}`,
        "ACTIVE"
      );
    } else if (sql.includes("INSERT INTO st_member_stations")) {
      const [tenantId, userId, stationId] = params;
      memory.memberStationStatuses.set(
        `${tenantId}:${userId}:${stationId}`,
        memory.staffingReady ? "REVIEW_REQUIRED" : "ACTIVE"
      );
    } else if (sql.includes("UPDATE st_member_stations SET status='ACTIVE'")) {
      memory.memberStationStatuses.set(
        `${params[0]}:${params[1]}:${params[2]}`,
        "ACTIVE"
      );
    } else if (
      sql.includes("UPDATE st_member_stations SET status='INACTIVE'")
    ) {
      memory.memberStationStatuses.set(
        `${params[0]}:${params[1]}:${params[2]}`,
        "INACTIVE"
      );
    } else if (sql.includes("INSERT INTO st_staffing_events")) {
      memory.writes.push({ kind: "st_staffing_events", params });
    } else if (sql.includes("INSERT INTO st_shift_assignments")) {
      memory.writes.push({ kind: "st_shift_assignments", params });
    } else if (sql.includes("INSERT INTO st_members")) {
      memory.members.set(params[1], params[2]);
    } else if (
      ["st_shifts", "st_slips", "st_payables", "st_terminal_leases"].some(
        table => sql.includes(`INSERT INTO ${table}`)
      )
    ) {
      memory.writes.push({ kind: sql.match(/INSERT INTO (\w+)/)![1], params });
    } else if (
      sql.includes("INSERT INTO st_account_events") ||
      sql.includes("UPDATE st_accounts SET status")
    ) {
      memory.writes.push({ kind: "account-return", params });
    } else if (sql.includes("UPDATE st_accounts SET revision")) {
      // The synthetic account is returned fresh; no real account is changed.
    } else if (
      !sql.includes("INSERT INTO st_audit") &&
      !sql.includes("INSERT INTO st_member_stations")
    ) {
      throw new Error(`Unexpected memory write: ${sql}`);
    }
    return { affectedRows: 1 };
  }
  return {
    transactionRollbackConfirmed: () => true,
    execute,
    first: async (_c: unknown, sql: string, params: any[]) =>
      read(sql, params)[0] ?? null,
    rows: async (_c: unknown, sql: string, params: any[]) => read(sql, params),
    query: () => {
      throw new Error("Unexpected pool query");
    },
    withTransaction: (fn: (c: unknown) => Promise<unknown>) => {
      const operation = memory.tail.then(async () => {
        const snapshot = structuredClone({
          requests: memory.requests,
          tracking: memory.tracking,
          invitations: memory.invitations,
          stations: memory.stations,
          members: memory.members,
          writes: memory.writes,
          memberStationStatuses: memory.memberStationStatuses,
        });
        try {
          return await fn({});
        } catch (error) {
          Object.assign(memory, snapshot);
          throw error;
        }
      });
      memory.tail = operation.catch(() => undefined);
      return operation;
    },
  };
});

import { registerStationRoutes } from "./index";
import { csrfToken, payloadHash } from "./domain";

const routes = new Map<string, (req: any, res: any) => Promise<void>>();
registerStationRoutes({
  use() {},
  get(path: string, handler: any) {
    routes.set(path, handler);
  },
  post(path: string, handler: any) {
    routes.set(path, handler);
  },
} as unknown as Express);

async function call(path: string, body: object, actorId = 7, query?: object) {
  const actor = {
    id: actorId,
    openId: `test-${actorId}`,
    name: "Test",
    email: null,
    role: "user",
  };
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "X-Stationos-Request": "1",
    "X-CSRF-Token": csrfToken(actor),
    "X-Stationos-Device-Id": "55555555-5555-4555-8555-555555555555",
    "X-Stationos-Device-Kind": "DESKTOP",
    "user-agent": "Phase1TestDesktop",
  };
  const req = {
    route: { path: `/api/stationos${path}` },
    body: structuredClone(body),
    query,
    stationActor: actor,
    get: (name: string) => headers[name],
  };
  let status = 200,
    data: any;
  const res = {
    status(value: number) {
      status = value;
      return res;
    },
    json(value: any) {
      data = value;
      return res;
    },
  };
  await routes.get(`/api/stationos${path}`)!(req, res);
  return { status, data };
}
const invite = () =>
  call("/invite", {
    requestId,
    role: "FUEL_STAFF",
    stationIds: [station],
    email: "staff@example.test",
  });

beforeEach(() => {
  // Test-only CSRF/session secret. Production secrets are not read or modified.
  vi.stubEnv("SESSION_SECRET", Buffer.alloc(32, 17).toString("base64"));
  memory.requests.clear();
  memory.tracking.clear();
  memory.invitations.clear();
  memory.stations.clear();
  memory.members.clear();
  memory.ownerRole = "OWNER";
  memory.accountStatus = "OPEN";
  memory.allowed = true;
  memory.staffingReady = false;
  memory.failSave = false;
  memory.writes = [];
  memory.memberStationStatuses.clear();
  memory.acceptingEmail = "staff@example.test";
  memory.tail = Promise.resolve();
  vi.stubEnv("INVITATION_RESPONSE_ACTIVE_KEY", "flow-test");
  vi.stubEnv(
    "INVITATION_RESPONSE_KEYS",
    JSON.stringify({ "flow-test": Buffer.alloc(32, 4).toString("base64") })
  );
});

describe("Hesap düzeltme endpoint durum ve yetki sınırları", () => {
  const body = () => ({
    requestId,
    accountId: "66666666-6666-4666-8666-666666666666",
    expectedRevision: 1,
    note: "Kaynak raporunu tekrar kontrol edin.",
  });
  it.each(["ACCEPTED", "ACCEPTED_WITH_PENDING", "OPEN"])(
    "%s hesabını yeniden açmaz veya geçmişine düzeltme yazmaz",
    async status => {
      memory.accountStatus = status;
      memory.members.set(8, "ACCOUNTANT");
      const result = await call("/account/return", body(), 8);
      expect(result.status).toBe(409);
      expect(result.data.error.code).toBe("ACCOUNT_LOCKED");
      expect(memory.writes).toEqual([]);
      expect(memory.requests.size).toBe(0);
    }
  );
  it.each(["SUBMITTED", "IN_REVIEW"])(
    "%s hesabında mevcut düzeltme akışını korur",
    async status => {
      memory.accountStatus = status;
      memory.members.set(8, "ACCOUNTANT");
      const result = await call("/account/return", body(), 8);
      expect(result.status).toBe(200);
      expect(result.data.result).toMatchObject({ status: "OPEN", revision: 2 });
      expect(memory.writes).toHaveLength(2);
    }
  );
  it("OWNER rolünde olsa da kendi hesabını düzeltmeye gönderemez", async () => {
    memory.accountStatus = "IN_REVIEW";
    const result = await call("/account/return", body());
    expect(result.status).toBe(403);
    expect(result.data.error.code).toBe("SELF_APPROVAL_FORBIDDEN");
    expect(memory.writes).toEqual([]);
  });
});

describe("Y-08 gerçek handler ve izole transaction modeli", () => {
  const payable = (extra = {}) => ({
    requestId,
    stationId: station,
    supplierId: "77777777-7777-4777-8777-777777777777",
    amountMinor: 100,
    dueDate: "2026-10-28",
    ...extra,
  });
  const check = (extra = {}, actor = 7) =>
    call("/requests/status", {}, actor, {
      requestId,
      operation: "/payable",
      tenantId: "test-tenant",
      version: "2",
      ...extra,
    });
  it("yanıt kaybı ardından kayıt durumunu bulur ve tekrarda tek mali etki bırakır", async () => {
    const lost = await call("/payable", payable());
    const recovered = await check();
    expect(recovered.data.state).toBe("COMPLETED");
    expect(recovered.data.response).toEqual(lost.data);
    expect(await call("/payable", payable())).toEqual(lost);
    expect(
      memory.writes.filter(row => row.kind === "st_payables")
    ).toHaveLength(1);
  });
  it("eşzamanlı aynı mali isteklerde tek sonuç ve tek kayıt oluşur", async () => {
    const results = await Promise.all([
      call("/payable", payable()),
      call("/payable", payable()),
    ]);
    expect(results[0].status).toBe(200);
    expect(results[1]).toEqual(results[0]);
    expect(
      memory.writes.filter(row => row.kind === "st_payables")
    ).toHaveLength(1);
  });
  it("aynı requestId farklı payload ve endpoint için reddedilir", async () => {
    await call("/payable", payable());
    expect((await call("/payable", payable({ amountMinor: 200 }))).status).toBe(
      409
    );
    expect(
      (
        await call("/shift", {
          requestId,
          stationId: station,
          label: "Test",
          startsAt: "2026-10-28T12:00:00Z",
        })
      ).status
    ).toBe(409);
    expect(memory.writes).toHaveLength(1);
  });
  it("başka kullanıcı/tenant/işlem sorgusu bulunamayan kayıtla aynı yanıtı verir", async () => {
    await call("/payable", payable());
    memory.members.set(8, "OWNER");
    const missing = await check({ requestId: joinId });
    expect((await check({}, 8)).data).toEqual(missing.data);
    expect((await check({ tenantId: "other" })).data).toEqual(missing.data);
    expect((await check({ operation: "/shift" })).data).toEqual(missing.data);
    expect((await check({ version: "1" })).data).toEqual(missing.data);
    memory.ownerRole = "ACCOUNTANT";
    expect((await check()).data).toEqual(missing.data);
  });
  it("mali yazım ve sonuç kaydı aynı transaction ile geri alınır; FAILED kalıcıdır", async () => {
    memory.failSave = true;
    expect((await call("/payable", payable())).status).toBe(500);
    expect(memory.writes).toHaveLength(0);
    expect(memory.requests.size).toBe(0);
    expect((await check()).data.state).toBe("FAILED");
    memory.failSave = false;
    expect((await call("/payable", payable())).status).toBe(409);
    expect(memory.writes).toHaveLength(0);
  });
  it("niyet kalıp süreç durduğunda eski niyeti tekrar yürütmez", async () => {
    await call("/payable", payable());
    memory.requests.clear();
    memory.writes = [];
    const row = memory.tracking.get(`7:${requestId}`)!;
    row.state = "PROCESSING";
    row.created_at = "2000-01-01 00:00:00.000";
    expect((await check()).data.state).toBe("UNCERTAIN");
    expect((await call("/payable", payable())).status).toBe(409);
    expect(memory.writes).toHaveLength(0);
  });
  it("eski mali kayıtları dönüştürmez ve başarılı kabul etmez", async () => {
    const saved = {
      payload_hash: payloadHash(payable()),
      response_json: JSON.stringify({ ok: true, result: { id: "legacy" } }),
    };
    memory.requests.set(`7:${requestId}`, saved);
    expect((await call("/payable", payable())).data.error.code).toBe(
      "LEGACY_REQUEST_REVIEW_REQUIRED"
    );
    expect(memory.requests.get(`7:${requestId}`)).toEqual(saved);
    expect(memory.tracking.size).toBe(0);
    expect((await check()).data.state).toBe("NOT_FOUND");
    expect(memory.writes).toHaveLength(0);
  });
  it("davet kurtarmada kodu yalnız yetkiliya çözer, saklanan sonuç şifrelidir", async () => {
    const created = await invite();
    const recovered = await check({ operation: "/invite" });
    expect(recovered.data.response).toEqual(created.data);
    expect(JSON.stringify([...memory.requests.values()])).not.toContain(
      created.data.result.code
    );
    memory.allowed = false;
    expect((await check({ operation: "/invite" })).data.state).toBe(
      "NOT_FOUND"
    );
  });
  it("eşdeğer UTC tarihleri tekrar oynatıldığında ikinci vardiya oluşturmaz", async () => {
    const body = {
      requestId,
      stationId: station,
      label: "Test",
      startsAt: "2026-10-28T15:00:00+03:00",
    };
    const first = await call("/shift", body);
    expect(
      await call("/shift", { ...body, startsAt: "2026-10-28T12:00:00Z" })
    ).toEqual(first);
    expect(memory.writes.filter(row => row.kind === "st_shifts")).toHaveLength(
      1
    );
  });
});

describe("API tarih-saat sınırı (gerçek handler, yalnız bellek DB modeli)", () => {
  const shift = (dates: object) =>
    call("/shift", {
      requestId,
      stationId: station,
      label: "Sentetik vardiya",
      ...dates,
    });
  const slip = (transactionAt: unknown) =>
    call("/slip", {
      requestId: joinId,
      accountId: "66666666-6666-4666-8666-666666666666",
      expectedRevision: 1,
      amountMinor: 100,
      reference: "TEST-RRN",
      terminalId: "TEST-TERMINAL",
      transactionAt,
    });
  it.each(["2026-10-28T15:30:00", "2026-02-29T15:30:00Z", "2026-10-28"])(
    "vardiya başlangıcı için 400 ve alan açıklaması: %s",
    async startsAt => {
      const result = await shift({ startsAt });
      expect(result.status).toBe(400);
      expect(result.data.error.code).toBe("INVALID_INPUT");
      expect(result.data.error.message).toContain("startsAt");
      expect(result.data.error.message).toContain("Z veya ±HH:MM");
      expect(memory.writes).toEqual([]);
      expect(memory.requests.size).toBe(0);
    }
  );
  it("vardiya bitişinde de aynı 400 sözleşmesini uygular", async () => {
    const result = await shift({
      startsAt: "2026-10-28T12:30:00Z",
      endsAt: "2026-10-28T19:30:00",
    });
    expect(result.status).toBe(400);
    expect(result.data.error.message).toContain("endsAt");
    expect(memory.writes).toEqual([]);
  });
  it("eski başarılı idempotency kaydı belirsiz tarihi kabul ettirmez; kayıt değişmez", async () => {
    const body = {
      requestId,
      stationId: station,
      label: "Sentetik vardiya",
      startsAt: "2026-10-28T15:30:00",
    };
    const saved = {
      payload_hash: payloadHash(body),
      response_json: JSON.stringify({
        ok: true,
        result: { id: "old-synthetic-shift" },
      }),
    };
    memory.requests.set(`7:${requestId}`, saved);
    expect((await call("/shift", body)).status).toBe(400);
    expect(memory.requests.get(`7:${requestId}`)).toEqual(saved);
    expect(memory.writes).toEqual([]);
  });
  it.each(["2026-10-28T15:30:00", "2026-02-29T12:00:00Z"])(
    "slip anında 400 verir ve lease/istek yazımlarını geri alır: %s",
    async value => {
      const result = await slip(value);
      expect(result.status).toBe(400);
      expect(result.data.error.message).toContain("transactionAt");
      expect(memory.writes).toEqual([]);
      expect(memory.requests.size).toBe(0);
    }
  );
  it.each([
    "2026-10-28T12:30:00Z",
    "2026-10-28T15:30:00+03:00",
    "2026-10-28T07:30:00-05:00",
  ])(
    "vardiya/slip açık farkını aynı UTC DB değerinde saklar: %s",
    async value => {
      expect((await shift({ startsAt: value, endsAt: null })).status).toBe(200);
      expect(
        memory.writes.find(write => write.kind === "st_shifts")!.params[4]
      ).toBe("2026-10-28 12:30:00.000");
      memory.requests.clear();
      expect((await slip(value)).status).toBe(200);
      expect(
        memory.writes.find(write => write.kind === "st_slips")!.params[7]
      ).toBe("2026-10-28 12:30:00.000");
    }
  );
  it("vade tarihini saat dilimi eklemeden saklar", async () => {
    const result = await call("/payable", {
      requestId,
      stationId: station,
      supplierId: "77777777-7777-4777-8777-777777777777",
      amountMinor: 100,
      dueDate: "2026-10-28",
    });
    expect(result.status).toBe(200);
    expect(
      memory.writes.find(write => write.kind === "st_payables")!.params[5]
    ).toBe("2026-10-28");
  });
  it("geçersiz takvim vadesine 400 döndürür", async () => {
    const result = await call("/payable", {
      requestId,
      stationId: station,
      supplierId: "77777777-7777-4777-8777-777777777777",
      amountMinor: 100,
      dueDate: "2026-02-29",
    });
    expect(result.status).toBe(400);
    expect(result.data.error.message).toContain("YYYY-MM-DD");
    expect(memory.writes).toEqual([]);
  });
});

describe("Davet endpoint akışı (yalnız bellek transaction modeli)", () => {
  it("hedef e-posta olmadan davet oluşturmaz", async () => {
    const result = await call("/invite", {
      requestId,
      role: "FUEL_STAFF",
      stationIds: [station],
    });
    expect(result.status).toBe(400);
    expect(memory.invitations.size).toBe(0);
  });
  it.each(["MANAGER", "ACCOUNTANT"])(
    "%s rolü ÖSSE daveti verebilir ama yönetici/muhasebe rolü yükseltemez",
    async elevatedRole => {
      memory.ownerRole = "MANAGER";
      const result = await call("/invite", {
        requestId,
        role: elevatedRole,
        stationIds: [station],
        email: "staff@example.test",
      });
      expect(result.status).toBe(403);
      expect(result.data.error.code).toBe("ROLE_GRANT_FORBIDDEN");
      expect(memory.invitations.size).toBe(0);
    }
  );
  it("ÖSSE veya yönetici kapsamı dışındaki başka istasyona davet veremez", async () => {
    const otherStation = "99999999-9999-4999-8999-999999999999";
    memory.ownerRole = "MANAGER";
    const foreignStation = await call("/invite", {
      requestId,
      role: "FUEL_STAFF",
      stationIds: [otherStation],
      email: "staff@example.test",
    });
    expect(foreignStation.status).toBe(403);
    expect(foreignStation.data.error.code).toBe("STATION_FORBIDDEN");
    expect(memory.invitations.size).toBe(0);

    memory.ownerRole = "FUEL_STAFF";
    const nonManager = await call("/invite", {
      requestId: "44444444-4444-4444-8444-444444444444",
      role: "FUEL_STAFF",
      stationIds: [station],
      email: "staff@example.test",
    });
    expect(nonManager.status).toBe(403);
    expect(memory.invitations.size).toBe(0);
  });
  it("aynı isteği eşzamanlı tekrarladığında tek hashli davet ve şifreli yanıt saklar", async () => {
    const [first, replay] = await Promise.all([invite(), invite()]);
    expect(first.status).toBe(200);
    expect(replay).toEqual(first);
    expect(memory.invitations.size).toBe(1);
    const code = first.data.result.code;
    expect(JSON.stringify([...memory.requests.values()])).not.toContain(code);
    expect(JSON.stringify([...memory.invitations.values()])).not.toContain(
      code
    );
  });
  it("farklı içerikle aynı requestId kullanımını reddeder", async () => {
    await invite();
    const replay = await call("/invite", {
      requestId,
      role: "MARKET_STAFF",
      stationIds: [station],
      email: "staff@example.test",
    });
    expect(replay.status).toBe(409);
    expect(memory.invitations.size).toBe(1);
  });
  it("anahtar yokken daveti transaction ile geri alır", async () => {
    vi.stubEnv("INVITATION_RESPONSE_KEYS", "{}");
    expect((await invite()).status).toBe(503);
    expect(memory.invitations.size).toBe(0);
    expect(memory.requests.size).toBe(0);
  });
  it("yanıt kaydı başarısızsa davet oluşturmaz", async () => {
    memory.failSave = true;
    expect((await invite()).status).toBe(500);
    expect(memory.invitations.size).toBe(0);
  });
  it("tekrarda güncel rol ve istasyon yetkisini kontrol eder", async () => {
    await invite();
    memory.ownerRole = "FUEL_STAFF";
    expect((await invite()).status).toBe(403);
    memory.ownerRole = "OWNER";
    memory.allowed = false;
    expect((await invite()).status).toBe(403);
  });
  it("eski açık yanıtı değiştirmeden okur ve yeni davet üretmez", async () => {
    const original = await invite();
    memory.requests.get(`7:${requestId}`)!.response_json = JSON.stringify(
      original.data
    );
    memory.requests.get(`7:${requestId}`)!.payload_hash = payloadHash({
      requestId,
      role: "FUEL_STAFF",
      stationIds: [station],
      email: "staff@example.test",
    });
    memory.tracking.clear();
    const snapshot = memory.requests.get(`7:${requestId}`)!.response_json;
    expect(await invite()).toEqual(original);
    expect(memory.requests.get(`7:${requestId}`)!.response_json).toBe(snapshot);
    expect(memory.invitations.size).toBe(1);
    expect(memory.tracking.size).toBe(0);
  });
  it("tenant ilişkisi değişmiş davetin tekrar yanıtını açıklamaz", async () => {
    await invite();
    [...memory.invitations.values()][0].tenant_id = "other-test-tenant";
    const replay = await invite();
    expect(replay.status).toBe(403);
    expect(replay.data.result).toBeUndefined();
  });
  it("bozuk şifreli yanıtı yeniden davet oluşturmadan reddeder", async () => {
    await invite();
    const saved = memory.requests.get(`7:${requestId}`)!;
    const envelope = JSON.parse(saved.response_json!);
    envelope.tag = Buffer.alloc(16).toString("base64");
    saved.response_json = JSON.stringify(envelope);
    expect((await invite()).status).toBe(503);
    expect(memory.invitations.size).toBe(1);
  });
  it("kodla katılımı, tek kullanımı ve join idempotency'sini korur", async () => {
    const created = await invite();
    expect([...memory.invitations.values()][0].role).toBe("FUEL_STAFF");
    const body = { requestId: joinId, code: created.data.result.code };
    const joined = await call("/join", body, 8);
    expect(joined.status).toBe(200);
    expect(joined.data.result).toMatchObject({
      tenantId: "test-tenant",
      role: "FUEL_STAFF",
      stationIds: [station],
    });
    expect(await call("/join", body, 8)).toEqual(joined);
    expect(
      (
        await call(
          "/join",
          { ...body, requestId: "44444444-4444-4444-8444-444444444444" },
          9
        )
      ).status
    ).toBe(400);
  });
  it("email-bound daveti farklı giriş hesabıyla kabul ettirmez", async () => {
    const created = await invite();
    memory.acceptingEmail = "other@example.test";
    const rejected = await call(
      "/join",
      { requestId: joinId, code: created.data.result.code },
      8
    );
    expect(rejected.status).toBe(403);
    expect(rejected.data.error.code).toBe("INVITATION_EMAIL_MISMATCH");
    expect(memory.members.has(8)).toBe(false);
    expect([...memory.invitations.values()][0].used_at).toBeNull();
  });
  it.each(["FUEL_STAFF", "MARKET_STAFF"] as const)(
    "%s katılımı inceleme durumunda tutar; yalnız yetkili yönetici istasyon erişimini açıkça etkinleştirir",
    async role => {
      memory.staffingReady = true;
      const created = await call("/invite", {
        requestId,
        role,
        stationIds: [station],
        email: "staff@example.test",
      });
      expect(created.status).toBe(200);

      const joined = await call(
        "/join",
        { requestId: joinId, code: created.data.result.code },
        8
      );
      expect(joined.status).toBe(200);
      const membershipKey = `test-tenant:8:${station}`;
      expect(memory.memberStationStatuses.get(membershipKey)).toBe(
        "REVIEW_REQUIRED"
      );

      const activationId = "44444444-4444-4444-8444-444444444444";
      const activated = await call(
        "/personnel/station-access",
        {
          requestId: activationId,
          stationId: station,
          userId: 8,
          active: true,
        },
        7
      );
      expect(activated.status).toBe(200);
      expect(activated.data.result.status).toBe("ACTIVE");
      expect(memory.memberStationStatuses.get(membershipKey)).toBe("ACTIVE");
      expect(
        memory.writes
          .filter(write => write.kind === "st_staffing_events")
          .map(write => write.params[6])
      ).toContain("STATION_ACCESS_ACTIVATED");

      memory.ownerRole = "FUEL_STAFF";
      const denied = await call(
        "/personnel/station-access",
        {
          requestId: "55555555-5555-4555-8555-555555555555",
          stationId: station,
          userId: 8,
          active: false,
        },
        7
      );
      expect(denied.status).toBe(403);
      expect(memory.memberStationStatuses.get(membershipKey)).toBe("ACTIVE");
    }
  );
  it("süresi dolan davetle katılımı reddeder", async () => {
    const created = await invite();
    [...memory.invitations.values()][0].expires_at = "2000-01-01 00:00:00.000";
    expect(
      (
        await call(
          "/join",
          { requestId: joinId, code: created.data.result.code },
          8
        )
      ).status
    ).toBe(400);
  });
});

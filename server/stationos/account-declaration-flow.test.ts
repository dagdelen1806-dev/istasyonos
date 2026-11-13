import { beforeEach, describe, expect, it, vi } from "vitest";

const memory = vi.hoisted(() => ({
  account: {} as Record<string, any>,
  tracking: new Map<string, Record<string, any>>(),
  requests: new Map<string, Record<string, any>>(),
  events: [] as Record<string, any>[],
  failSnapshot: false,
  failAudit: false,
  memberRole: "FUEL_STAFF",
  memberTenant: "11111111-1111-4111-8111-111111111111",
  memberStations: ["22222222-2222-4222-8222-222222222222"],
  tail: Promise.resolve() as Promise<unknown>,
  rolledBack: new WeakSet<object>(),
}));

const actor = { id: 17, openId: "test-staff", role: "user", name: "DEMO" },
  tenant = "11111111-1111-4111-8111-111111111111",
  station = "22222222-2222-4222-8222-222222222222",
  accountId = "33333333-3333-4333-8333-333333333333",
  shiftId = "44444444-4444-4444-8444-444444444444",
  deviceId = "55555555-5555-4555-8555-555555555555";

vi.mock("../_core/env", () => ({
  ENV: { appId: "test-app", cookieSecret: "test-secret", ownerOpenId: "" },
}));
vi.mock("../_core/sdk", () => ({ sdk: {} }));
vi.mock("./fuel", () => ({
  addFuelEquipment: vi.fn(),
  fuelEquipment: vi.fn(),
  openFuel: vi.fn(),
  updateFuel: vi.fn(),
  fuelSnapshot: vi.fn(async () => null),
  assertFuelReady: vi.fn(async () => null),
  correctFuel: vi.fn(),
}));
vi.mock("./db", () => {
  const getRows = (sql: string, params: any[] = []): any[] => {
    if (sql.includes("information_schema.COLUMNS"))
      return [
        { membership_status: 1, shift_assignments: 1, staffing_events: 1 },
      ];
    if (sql.includes("FROM st_request_tracking")) {
      const row = memory.tracking.get(`${params[0]}:${params[1]}`);
      return row
        ? [
            {
              ...row,
              recovery_now: new Date()
                .toISOString()
                .replace("T", " ")
                .slice(0, 23),
            },
          ]
        : [];
    }
    if (sql.includes("FROM st_requests")) {
      const row = memory.requests.get(`${params[0]}:${params[1]}`);
      return row ? [row] : [];
    }
    if (sql.includes("FROM st_members"))
      return [
        {
          tenant_id: memory.memberTenant,
          user_id: Number(params[0]),
          role: memory.memberRole,
        },
      ];
    if (sql.includes("FROM st_member_stations"))
      return memory.memberStations.map(id => ({ id }));
    if (sql.includes("FROM st_stations"))
      return params[1] && params[1] !== tenant
        ? []
        : [{ id: station, tenant_id: tenant, company_id: "company-demo" }];
    if (sql.includes("FROM st_accounts a JOIN users"))
      return [{ ...memory.account }];
    if (sql.includes("FROM st_accounts WHERE id=?"))
      return [{ ...memory.account }];
    if (sql.includes("FROM st_account_events")) {
      const event = memory.events.find(
        row =>
          row.accountId === params[0] &&
          row.eventType === "FIRST_DECLARATION_SNAPSHOT_V1"
      );
      return event ? [{ payload_json: JSON.stringify(event.payload) }] : [];
    }
    if (sql.includes("FROM st_terminal_leases")) return [{ count: 0 }];
    if (sql.includes("FROM st_shifts"))
      return [
        {
          business_date: "2026-11-09",
          submitted_at: "2026-11-09 12:00:00.000",
        },
      ];
    if (sql.includes("FROM st_payments")) {
      if (memory.account.business_unit === "MARKET")
        return [
          {
            id: "market-cash",
            kind: "CASH",
            amount_minor: 10000,
            debtor_id: null,
            status: "POSTED",
          },
          {
            id: "market-iban",
            kind: "IBAN",
            amount_minor: 5000,
            debtor_id: null,
            status: "POSTED",
          },
          {
            id: "market-debt",
            kind: "DEBT",
            amount_minor: 10000,
            debtor_id: "debtor-demo",
            status: "POSTED",
          },
        ];
      return [
        {
          id: "pay-cash",
          kind: "CASH",
          amount_minor: 10000,
          debtor_id: null,
          status: "POSTED",
        },
        {
          id: "pay-fast",
          kind: "FAST",
          amount_minor: 20000,
          debtor_id: null,
          status: "POSTED",
        },
        {
          id: "pay-iban",
          kind: "IBAN",
          amount_minor: 5000,
          debtor_id: null,
          status: "POSTED",
        },
        {
          id: "pay-debt",
          kind: "DEBT",
          amount_minor: 10000,
          debtor_id: "debtor-demo",
          status: "POSTED",
        },
      ];
    }
    if (sql.includes("FROM st_slips"))
      return [
        {
          id: "slip-demo",
          amount_minor: 8000,
          status: "VERIFIED",
          method: "MANUAL",
          transaction_at: "2026-11-09 11:00:00.000",
        },
      ];
    if (sql.includes("FROM st_shift_special_operations")) {
      if (memory.account.business_unit === "MARKET") return [];
      return [
        {
          id: "special-demo",
          kind: "TTS",
          model: "RECEIVABLE",
          status: "RECORDED",
          amount_minor: 2000,
          volume_ml: 3000,
          settlement: "PENDING",
          settlement_method: "DRAFT",
          payment_id: null,
          slip_id: null,
        },
      ];
    }
    return [];
  };
  const execute = async (
    _connection: unknown,
    sql: string,
    params: any[] = []
  ) => {
    if (sql.includes("INSERT INTO st_request_tracking")) {
      const [
        actorId,
        requestId,
        tenantId,
        operation,
        schema_version,
        scope_hash,
        payload_hash,
        binding_hash,
      ] = params;
      const key = `${actorId}:${requestId}`;
      if (!memory.tracking.has(key))
        memory.tracking.set(key, {
          actor_user_id: actorId,
          request_id: requestId,
          tenant_id: tenantId,
          operation,
          schema_version,
          scope_hash,
          payload_hash,
          binding_hash,
          state: "PROCESSING",
          created_at: new Date().toISOString().replace("T", " ").slice(0, 23),
        });
    } else if (sql.includes("INSERT IGNORE INTO st_requests")) {
      const key = `${params[0]}:${params[1]}`;
      if (!memory.requests.has(key))
        memory.requests.set(key, {
          payload_hash: params[2],
          response_json: null,
        });
    } else if (sql.includes("INSERT INTO st_account_events")) {
      if (memory.failSnapshot)
        throw new Error("synthetic snapshot insert failure");
      memory.events.push({
        id: params[0],
        accountId: params[1],
        cycleNo: params[3],
        eventType: params[5],
        payload: JSON.parse(String(params[6])),
      });
    } else if (sql.includes("INSERT INTO st_audit")) {
      if (memory.failAudit) throw new Error("synthetic audit insert failure");
    } else if (sql.includes("UPDATE st_accounts SET counted_cash_minor")) {
      memory.account.status = "SUBMITTED";
      memory.account.revision += 1;
    } else if (sql.includes("UPDATE st_requests SET response_json")) {
      const row = memory.requests.get(`${params[1]}:${params[2]}`);
      if (row) row.response_json = params[0];
    } else if (
      sql.includes("UPDATE st_request_tracking SET state='COMPLETED'")
    ) {
      const row = memory.tracking.get(`${params[0]}:${params[1]}`);
      if (row) row.state = "COMPLETED";
      return { affectedRows: 1 };
    } else if (sql.includes("UPDATE st_request_tracking SET state='FAILED'")) {
      const row = memory.tracking.get(`${params[1]}:${params[2]}`);
      if (row) row.state = "FAILED";
    }
    return { affectedRows: 1 };
  };
  const withTransaction = async (
    fn: (connection: unknown) => Promise<unknown>
  ) => {
    const operation = memory.tail.then(async () => {
      const before = structuredClone({
        account: memory.account,
        tracking: memory.tracking,
        requests: memory.requests,
        events: memory.events,
      });
      try {
        return await fn({});
      } catch (error) {
        Object.assign(memory, before);
        if (error && typeof error === "object") memory.rolledBack.add(error);
        throw error;
      }
    });
    memory.tail = operation.catch(() => undefined);
    return operation;
  };
  return {
    execute,
    first: async (_c: unknown, sql: string, params: any[] = []) =>
      getRows(sql, params)[0] ?? null,
    rows: async (_c: unknown, sql: string, params: any[] = []) =>
      getRows(sql, params),
    withTransaction,
    transactionRollbackConfirmed: (error: unknown) =>
      !!error && typeof error === "object" && memory.rolledBack.has(error),
  };
});

import { registerStationRoutes } from "./index";
import { csrfToken } from "./domain";

const routes = new Map<string, (req: any, res: any) => Promise<void>>();
registerStationRoutes({
  use() {},
  get(path: string, handler: any) {
    routes.set(path, handler);
  },
  post(path: string, ...handlers: any[]) {
    routes.set(path, handlers.at(-1));
  },
  put() {},
  patch() {},
  delete() {},
} as any);
const submitPath = "/api/stationos/account/submit",
  endpoint = routes.get(submitPath)!,
  snapshotPath = "/api/stationos/account/declaration-snapshot",
  snapshotEndpoint = routes.get(snapshotPath)!;

function body(requestId: string, countedCashMinor = 10000) {
  return { requestId, accountId, expectedRevision: 1, countedCashMinor };
}
function request(payload: Record<string, unknown>) {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "x-stationos-request": "1",
    "x-csrf-token": csrfToken(actor),
    origin: "https://istasyonos-main.test",
    host: "istasyonos-main.test",
    "x-forwarded-proto": "https",
    "x-stationos-device-id": deviceId,
    "x-stationos-device-kind": "MOBILE",
    "user-agent": "Android Chrome Mobile",
  };
  let response: any;
  const req: any = {
    body: payload,
    path: submitPath,
    route: { path: submitPath },
    stationActor: actor,
    secure: true,
    get: (name: string) => headers[name.toLowerCase()],
  };
  const res: any = {
    json: (value: any) => {
      response = value;
    },
    status: (value: number) => {
      res.statusCode = value;
      return res;
    },
  };
  return endpoint(req, res).then(() => ({
    response,
    statusCode: res.statusCode ?? 200,
  }));
}
async function readSnapshot(user = actor) {
  let response: any;
  const req: any = { query: { accountId }, stationActor: user },
    res: any = {
      json: (value: any) => {
        response = value;
      },
      status: (value: number) => {
        res.statusCode = value;
        return res;
      },
    };
  await snapshotEndpoint(req, res);
  return { response, statusCode: res.statusCode ?? 200 };
}

describe("ÖSSE teslim anı snapshot ve tekrar gönderim", () => {
  beforeEach(() => {
    memory.account = {
      id: accountId,
      tenant_id: tenant,
      station_id: station,
      shift_id: shiftId,
      user_id: actor.id,
      business_unit: "FUEL",
      status: "OPEN",
      revision: 1,
      cycle_no: 1,
      opening_float_minor: 0,
      source_sales_minor: 55000,
      source_ref: "DEMO-SOURCE",
      cash_sales_minor: 10000,
      card_total_minor: 8000,
      iban_minor: 5000,
      fast_minor: 20000,
      debt_minor: 10000,
      ar_collection_minor: 0,
      special_covered_minor: 2000,
      special_pending_count: 1,
      prepayment_cash_minor: 0,
      cash_receiver_user_id: null,
    };
    memory.tracking.clear();
    memory.requests.clear();
    memory.events = [];
    memory.failSnapshot = false;
    memory.failAudit = false;
    memory.tail = Promise.resolve();
    memory.rolledBack = new WeakSet();
    memory.memberRole = "FUEL_STAFF";
    memory.memberTenant = tenant;
    memory.memberStations = [station];
  });

  it("snapshot ve teslimi aynı transaction'da yazar; response kaybı tekrarında aynı snapshot kimliğini döndürür", async () => {
    const requestId = "66666666-6666-4666-8666-666666666666",
      first = await request(body(requestId)),
      saved = memory.requests.get(`${actor.id}:${requestId}`),
      tracking = memory.tracking.get(`${actor.id}:${requestId}`),
      replay = await request(body(requestId));
    expect(saved?.response_json).not.toBeNull();
    expect(tracking?.state).toBe("COMPLETED");
    expect(first.response.result).toMatchObject({
      status: "SUBMITTED",
      declarationSnapshotId: memory.events[0].payload.snapshotId,
    });
    expect(replay.response).toEqual(first.response);
    expect(memory.events).toHaveLength(1);
    expect(memory.account.status).toBe("SUBMITTED");
    expect(memory.events[0].payload.scope).toMatchObject({
      tenantId: tenant,
      stationId: station,
      shiftId,
      staffUserId: actor.id,
    });
    const beforeRead = structuredClone({
      account: memory.account,
      events: memory.events,
      requests: memory.requests,
      tracking: memory.tracking,
    });
    const snapshotRead = await readSnapshot();
    expect(snapshotRead.statusCode).toBe(200);
    expect(snapshotRead.response.result.snapshot.snapshotId).toBe(
      first.response.result.declarationSnapshotId
    );
    expect({
      account: memory.account,
      events: memory.events,
      requests: memory.requests,
      tracking: memory.tracking,
    }).toEqual(beforeRead);
  });

  it("aynı kimlikte farklı payload'ı reddeder; paralel aynı teslim ikinci snapshot üretmez", async () => {
    const requestId = "77777777-7777-4777-8777-777777777777";
    await request(body(requestId));
    const mismatch = await request(body(requestId, 9999));
    expect(mismatch.statusCode).toBe(409);
    memory.account.status = "OPEN";
    memory.account.revision = 1;
    memory.events = [];
    const concurrentId = "88888888-8888-4888-8888-888888888888";
    await Promise.all([
      request(body(concurrentId)),
      request(body(concurrentId)),
    ]);
    expect(
      memory.events.filter(event => event.payload.requestId === concurrentId)
    ).toHaveLength(1);
  });

  it("different request ids racing for one account accept only one submission", async () => {
    const [first, second] = await Promise.all([
      request(body("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa")),
      request(body("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb")),
    ]);
    expect([first.statusCode, second.statusCode].sort()).toEqual([200, 409]);
    expect(
      memory.events.filter(
        event => event.eventType === "FIRST_DECLARATION_SNAPSHOT_V1"
      )
    ).toHaveLength(1);
    expect(memory.account.status).toBe("SUBMITTED");
  });

  it("snapshot insert başarısızsa teslim ve kaynak olayı commit edilmez", async () => {
    memory.failSnapshot = true;
    const result = await request(body("99999999-9999-4999-8999-999999999999"));
    expect(result.statusCode).toBe(500);
    expect(memory.account.status).toBe("OPEN");
    expect(memory.events).toHaveLength(0);
  });

  it("MARKET hesabı satış kaynağı ve tahsilat eşleşince ilk beyanı atomik teslim eder", async () => {
    memory.memberRole = "MARKET_STAFF";
    memory.account = {
      ...memory.account,
      business_unit: "MARKET",
      source_sales_minor: 33000,
      source_ref: "DEMO-MARKET-POS",
      cash_sales_minor: 10000,
      card_total_minor: 8000,
      iban_minor: 5000,
      fast_minor: 0,
      debt_minor: 10000,
      special_covered_minor: 0,
      special_pending_count: 0,
    };
    const requestId = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
    const result = await request(body(requestId));
    expect(result.statusCode).toBe(200);
    expect(result.response.result.status).toBe("SUBMITTED");
    expect(memory.account.status).toBe("SUBMITTED");
    expect(memory.events).toHaveLength(1);
    expect(memory.events[0].payload).toMatchObject({
      businessUnit: "MARKET",
      declaredTotals: { sourceSalesMinor: 33000, countedCashMinor: 10000 },
    });
  });

  it("MARKET replay returns the same submission without creating another snapshot", async () => {
    memory.memberRole = "MARKET_STAFF";
    memory.account = {
      ...memory.account,
      business_unit: "MARKET",
      source_sales_minor: 33000,
      source_ref: "DEMO-MARKET-POS",
      cash_sales_minor: 10000,
      card_total_minor: 8000,
      iban_minor: 5000,
      fast_minor: 0,
      debt_minor: 10000,
      special_covered_minor: 0,
      special_pending_count: 0,
    };
    const requestId = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
    const first = await request(body(requestId));
    const replay = await request(body(requestId));

    expect(first.statusCode).toBe(200);
    expect(replay.statusCode).toBe(200);
    expect(replay.response).toEqual(first.response);
    expect(
      memory.events.filter(
        event => event.eventType === "FIRST_DECLARATION_SNAPSHOT_V1"
      )
    ).toHaveLength(1);
  });

  it("MARKET source mismatch keeps the account open and creates no declaration", async () => {
    memory.memberRole = "MARKET_STAFF";
    memory.account = {
      ...memory.account,
      business_unit: "MARKET",
      source_sales_minor: 32999,
      source_ref: "DEMO-MARKET-POS",
      cash_sales_minor: 10000,
      card_total_minor: 8000,
      iban_minor: 5000,
      fast_minor: 0,
      debt_minor: 10000,
      special_covered_minor: 0,
      special_pending_count: 0,
    };
    const result = await request(body("ffffffff-ffff-4fff-8fff-ffffffffffff"));

    expect(result.statusCode).toBe(409);
    expect(memory.account.status).toBe("OPEN");
    expect(memory.events).toHaveLength(0);
  });

  it("audit failure rolls back snapshot, submission and idempotent response", async () => {
    memory.failAudit = true;
    const requestId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
    const result = await request(body(requestId));
    expect(result.statusCode).toBe(500);
    expect(memory.account.status).toBe("OPEN");
    expect(memory.events).toHaveLength(0);
    expect(
      memory.requests.get(`${actor.id}:${requestId}`)?.response_json
    ).toBeUndefined();
  });

  it("eski hesabı FIRST_DECLARATION_UNKNOWN döndürür ve başka personelin snapshot erişimini engeller", async () => {
    const legacy = await readSnapshot();
    expect(legacy.response.result.state).toBe("FIRST_DECLARATION_UNKNOWN");
    const foreign = await readSnapshot({
      ...actor,
      id: 18,
      openId: "other-staff",
    });
    expect(foreign.statusCode).toBe(403);
  });

  it("denies snapshot reads outside station and tenant scope", async () => {
    memory.memberStations = [];
    const noStation = await readSnapshot({
      ...actor,
      id: 19,
      openId: "no-station",
    });
    expect(noStation.statusCode).toBe(403);
    memory.memberStations = [station];
    memory.memberTenant = "99999999-9999-4999-8999-999999999999";
    const otherTenant = await readSnapshot({
      ...actor,
      id: 20,
      openId: "other-tenant",
    });
    expect(otherTenant.statusCode).toBe(404);
  });

  it("allows an authorized accountant member and rejects an unrelated station role", async () => {
    memory.memberRole = "ACCOUNTANT";
    const accountant = await readSnapshot({
      ...actor,
      id: 21,
      openId: "accountant",
    });
    expect(accountant.statusCode).toBe(200);
    memory.memberRole = "MARKET_STAFF";
    const marketStaff = await readSnapshot({
      ...actor,
      id: actor.id,
      openId: "market-staff",
    });
    expect(marketStaff.statusCode).toBe(200);
    memory.account.business_unit = "MARKET";
    memory.events = [
      {
        accountId,
        eventType: "FIRST_DECLARATION_SNAPSHOT_V1",
        payload: {
          kind: "FIRST_DECLARATION_SNAPSHOT",
          accountId,
          businessUnit: "FUEL",
          scope: {
            tenantId: tenant,
            stationId: station,
            shiftId,
            staffUserId: actor.id,
          },
        },
      },
    ];
    memory.memberRole = "ACCOUNTANT";
    const wrongUnit = await readSnapshot({
      ...actor,
      openId: "accountant",
    });
    expect(wrongUnit.statusCode).toBe(500);
  });

  it("application routes insert account events and expose no event update/delete SQL", async () => {
    const { readFile } = await import("node:fs/promises");
    const source = await readFile(
      new URL("./index.ts", import.meta.url),
      "utf8"
    );
    expect(source).toMatch(/INSERT INTO st_account_events/);
    expect(source).not.toMatch(
      /UPDATE\s+st_account_events|DELETE\s+FROM\s+st_account_events/i
    );
  });
});

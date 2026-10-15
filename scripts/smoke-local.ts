import { strict as assert } from "node:assert";
import { randomBytes, randomUUID } from "node:crypto";
import { join } from "node:path";
import { mkdir, writeFile } from "node:fs/promises";

// Explicitly opt in: this creates DEMO records through the real HTTP API.
if (process.env.SMOKE_TEST !== "1") throw new Error("Run only against an isolated development database: SMOKE_TEST=1");
const base = process.env.SMOKE_BASE_URL ?? "http://127.0.0.1:3000";
if (!["127.0.0.1", "localhost"].includes(new URL(base).hostname)) throw new Error("Local test server required");
const run = randomUUID().slice(0, 8);
const checks: string[] = [];
type Actor = { cookie: string; csrf: string; email: string; password: string; device: string };

async function request(path: string, body?: unknown, actor?: Actor, expected = 200, extra: Record<string,string> = {}) {
  const res = await fetch(base + path, {
    method: body ? "POST" : "GET",
    headers: { "Content-Type": "application/json", "X-Stationos-Request": "1", Origin: base, "User-Agent": "StationOS-Test Android Mobile",
      ...(actor ? { Cookie: actor.cookie, "X-CSRF-Token": actor.csrf, "X-Stationos-Device-Id": actor.device, "X-Stationos-Device-Kind": "MOBILE" } : {}), ...extra },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json();
  assert.equal(res.status, expected, `${path}: ${JSON.stringify(data)}`);
  return { data, cookie: res.headers.get("set-cookie")?.split(";")[0] ?? "", headers: res.headers };
}
async function state(actor: Actor) {
  const { data } = await request("/api/stationos/state", undefined, actor);
  actor.csrf = data.csrfToken;
  return data;
}
async function register(label: string) {
  const actor: Actor = { cookie: "", csrf: "", email: `demo-${label}-${run}@example.invalid`, password: randomBytes(24).toString("base64url"), device: randomUUID() };
  const response = await request("/api/auth/register", { email: actor.email, password: actor.password, name: `DEMO ${label}`, role: "admin" }, undefined, 201);
  actor.cookie = response.cookie;
  assert.match(response.headers.get("set-cookie") ?? "", /HttpOnly/i);
  assert.match(response.headers.get("set-cookie") ?? "", /SameSite=Lax/i);
  const initial = await state(actor);
  assert.equal(initial.member, null);
  assert.deepEqual(initial.stations, []);
  return actor;
}
async function mutate(actor: Actor, path: string, body: Record<string, unknown>, expected = 200) {
  return (await request(`/api/stationos${path}`, { requestId: randomUUID(), ...body }, actor, expected)).data;
}

await request("/api/stationos/state", undefined, undefined, 401);
await request("/api/auth/register", { email: "csrf@example.invalid", password: "never-used-password" }, undefined, 403, { Origin: "https://foreign.invalid" });
await request("/api/auth/register", { email: "short@example.invalid", password: "short", name: "Test" }, undefined, 400);
const owner = await register("sahip"), staff = await register("personel"), accountant = await register("muhasebe"), outsider = await register("diger-firma");
checks.push("Parolalı kayıt, yeni hesap izolasyonu, yabancı origin ve kısa parola reddi");
const setup = await mutate(owner, "/setup", { companyName: `DEMO Firma ${run}`, stationName: "DEMO İstasyon", stationCode: `DEMO-${run}`, isDemo: true });
const stationId = setup.result.stationId;
assert.ok(stationId);
await state(owner);
for (const [actor, role] of [[staff, "FUEL_STAFF"], [accountant, "ACCOUNTANT"]] as const) {
  const invite = await mutate(owner, "/invite", { role, stationIds: [stationId] });
  await mutate(actor, "/join", { code: invite.result.code });
  await state(actor);
}
await mutate(outsider, "/setup", { companyName: `DEMO Ayrı Firma ${run}`, stationName: "DEMO Ayrı İstasyon", stationCode: `DIGER-${run}`, isDemo: true });
await state(outsider);
await request(`/api/stationos/state?stationId=${stationId}`, undefined, outsider, 403);
await mutate(staff, "/invite", { role: "OWNER", stationIds: [stationId] }, 403);
await request("/api/stationos/shift", { requestId: randomUUID(), stationId, label: "CSRF test", startsAt: new Date().toISOString() }, owner, 403, { "X-CSRF-Token": "invalid" });
checks.push("Davetle rol atama, istasyon/tenant izolasyonu ve CSRF reddi");
const shift = await mutate(owner, "/shift", { stationId, label: "DEMO Vardiya", startsAt: new Date().toISOString() });
const opened = await mutate(staff, "/account/open", { stationId, shiftId: shift.result.id, businessUnit: "FUEL", openingFloatMinor: 1000 });
const accountId = opened.result.id;
let revision = opened.result.revision;
const payment = { requestId: randomUUID(), accountId, expectedRevision: revision, kind: "CASH", amountMinor: 450000 };
const paid = (await request("/api/stationos/payment", payment, staff)).data;
revision = paid.result.revision;
assert.deepEqual((await request("/api/stationos/payment", payment, staff)).data, paid);
await request("/api/stationos/payment", { ...payment, amountMinor: 450001 }, staff, 409);
await mutate(staff, "/payment", { accountId, expectedRevision: 1, kind: "CASH", amountMinor: 100 }, 409);
revision = (await mutate(staff, "/slip", { accountId, expectedRevision: revision, amountMinor: 700000, terminalId: "DEMO-POS", reference: `DEMO-RRN-${run}`, transactionAt: new Date().toISOString(), note: "DEMO manuel slip" })).result.revision;
revision = (await mutate(staff, "/payment", { accountId, expectedRevision: revision, kind: "IBAN", amountMinor: 80000, reference: "DEMO banka teyidi bekleniyor" })).result.revision;
revision = (await mutate(owner, "/account/source", { accountId, expectedRevision: revision, sourceSalesMinor: 1230000, sourceRef: "DEMO manuel kaynak raporu" })).result.revision;
await mutate(staff, "/account/submit", { accountId, expectedRevision: revision, countedCashMinor: 1 }, 409);
revision = (await mutate(staff, "/account/submit", { accountId, expectedRevision: revision, countedCashMinor: 451000 })).result.revision;
await mutate(staff, "/account/approve", { accountId, expectedRevision: revision }, 403);
revision = (await mutate(owner, "/account/cash-receive", { accountId, expectedRevision: revision, receivedMinor: 450000 })).result.revision;
const first = await mutate(owner, "/account/approve", { accountId, expectedRevision: revision });
assert.equal(first.result.status, "IN_REVIEW");
revision = first.result.revision;
await mutate(owner, "/account/approve", { accountId, expectedRevision: revision }, 409);
const final = await mutate(accountant, "/account/approve", { accountId, expectedRevision: revision });
assert.equal(final.result.status, "ACCEPTED_WITH_PENDING");
const saved = (await state(owner)).accounts.find((a: {id:string}) => a.id === accountId);
assert.equal(saved.cashSalesMinor, 450000);
assert.equal(saved.cardTotalMinor, 700000);
assert.equal(saved.ibanMinor, 80000);
assert.equal(saved.status, "ACCEPTED_WITH_PENDING");
checks.push("Kalıcı nakit/kart/IBAN, idempotency ve revision çakışması kontrolleri");
checks.push("Nakit farkı ve personel onayı reddi; iki farklı mali imza; IBAN bekleyen kapanış");
const explanation = await mutate(owner, "/assistant", { question: "Vardiya ve ödeme durumunu özetle", stationId });
assert.match(explanation.result.text, /Kural tabanlı yerel özet/);
checks.push("Haricî Manus/AI çağrısı olmadan yerel operasyon özeti");
await request("/api/auth/login", { email: owner.email, password: "wrong-password-12345" }, undefined, 401);
const login = await request("/api/auth/login", { email: owner.email, password: owner.password });
owner.cookie = login.cookie;
const logout = await request("/api/trpc/auth.logout", { json: null }, owner);
assert.ok(logout.data.result);
await request("/api/stationos/state", undefined, owner, 401);
const relogin = await request("/api/auth/login", { email: owner.email, password: owner.password });
owner.cookie = relogin.cookie;
assert.equal((await state(owner)).accounts.find((a: { id:string }) => a.id === accountId)?.status, "ACCEPTED_WITH_PENDING");
checks.push("Yanlış parola reddi, çıkışta sunucu oturumu iptali ve yeniden girişte kalıcı kayıt");
const outputDir = process.env.SMOKE_OUTPUT_DIR ?? ".local";
await mkdir(outputDir, { recursive: true, mode: 0o700 });
await writeFile(join(outputDir, "demo-access.json"), JSON.stringify({ run, note: "Only synthetic DEMO accounts on the local development database", owner: {email:owner.email,password:owner.password}, staff: {email:staff.email,password:staff.password}, accountant: {email:accountant.email,password:accountant.password} }, null, 2), { mode: 0o600 });
await writeFile(join(outputDir, "smoke-result.json"), JSON.stringify({ ok: true, run, accountId, checks }, null, 2));
console.log(JSON.stringify({ ok: true, run, checks, credentialsFile: join(outputDir, "demo-access.json") + " (not printed)" }, null, 2));

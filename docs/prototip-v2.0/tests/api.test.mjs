import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { createDemoServer } from '../server.mjs';

let server;
let base;
let workspaceId;
let ayAccountId;
let canAccountId;

async function http(path, { actor, body, method = 'GET' } = {}) {
  const headers = {};
  if (workspaceId) headers['x-demo-workspace'] = workspaceId;
  if (actor) headers['x-demo-actor'] = actor;
  if (body !== undefined) {
    headers['content-type'] = 'application/json';
  }
  const response = await fetch(`${base}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let json;
  try { json = JSON.parse(text); } catch { json = text; }
  return { response, json };
}

async function action(actor, type, { accountId, expectedRevision, idempotencyKey, payload = {} } = {}) {
  const body = { type, idempotencyKey, payload };
  if (accountId !== undefined) body.accountId = accountId;
  if (expectedRevision !== undefined) body.expectedRevision = expectedRevision;
  return http('/api/demo/actions', { method: 'POST', actor, body });
}

function assertError(result, status, code) {
  assert.equal(result.response.status, status);
  assert.deepEqual(Object.keys(result.json), ['error']);
  assert.equal(result.json.error.code, code);
  assert.equal(typeof result.json.error.message, 'string');
}

function accountFrom(result, id) {
  return result.json.state.accounts.find((account) => account.id === id);
}

before(async () => {
  server = createDemoServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve, reject) => server.close((caught) => caught ? reject(caught) : resolve()));
});

test('health, güvenli static allowlist ve no-store API başlıkları', async () => {
  const health = await http('/health');
  assert.equal(health.response.status, 200);
  assert.equal(health.json.ok, true);
  assert.equal(health.json.demo, true);
  assert.equal(health.response.headers.get('cache-control'), 'no-store');
  assert.equal(health.response.headers.get('x-content-type-options'), 'nosniff');

  const traversal = await http('/../plan.md');
  assert.equal(traversal.response.status, 404);
  const unknown = await http('/domain.mjs');
  assert.equal(unknown.response.status, 404);
});

test('DEMO hesap, kanıt, nakit, snapshot ve iki imza sözleşmesi', async () => {
  const boot = await http('/api/demo/bootstrap', { method: 'POST', body: {} });
  assert.equal(boot.response.status, 200);
  assert.ok(typeof boot.json.workspaceId === 'string' && boot.json.workspaceId.length >= 16);
  workspaceId = boot.json.workspaceId;
  assert.deepEqual(boot.json.actors.map(({ id, role }) => ({ id, role })), [
    { id: 'ay', role: 'FUEL_SALES' }, { id: 'can', role: 'FUEL_SALES' },
    { id: 'mehmet', role: 'STATION_MANAGER' }, { id: 'elif', role: 'ACCOUNTANT' },
    { id: 'zeynep', role: 'COMPANY_MANAGER' },
  ]);
  assert.deepEqual(Object.keys(boot.json.state).sort(), ['actors', 'assignments', 'audit', 'accounts', 'terminals'].sort());
  assert.equal(boot.json.state.accounts.length, 0);

  let opened = await action('ay', 'OPEN_ACCOUNT', {
    idempotencyKey: 'open-ay',
    payload: { assignmentId: 'assignment-ay-s02', float: '100.00' },
  });
  assert.equal(opened.response.status, 200);
  ayAccountId = opened.json.result.accountId;
  assert.ok(ayAccountId);
  const openedReplay = await action('ay', 'OPEN_ACCOUNT', {
    idempotencyKey: 'open-ay',
    payload: { assignmentId: 'assignment-ay-s02', float: '100.00' },
  });
  assert.deepEqual(openedReplay.json, opened.json);
  const idempotencyConflict = await action('ay', 'OPEN_ACCOUNT', {
    idempotencyKey: 'open-ay',
    payload: { assignmentId: 'assignment-ay-s02', float: '101.00' },
  });
  assertError(idempotencyConflict, 409, 'IDEMPOTENCY_CONFLICT');

  let state = await http('/api/demo/state', { actor: 'ay' });
  let account = accountFrom(state, ayAccountId);
  assert.equal(account.openingFloatMinor, '10000');
  assert.equal(account.sourceTotalMinor, '1000000');
  assert.equal(account.sourceCardMinor, '600000');
  assert.deepEqual(Object.keys(account).sort(), [
    'approvals', 'cashHandover', 'declarations', 'employeeId', 'employeeName', 'id',
    'lastSubmittedRevision', 'openingFloatMinor', 'revision', 'reviewNote', 'slips',
    'snapshotHash', 'sourceCardMinor', 'sourceTotalMinor', 'status', 'summary',
  ].sort());

  let loaded = await action('ay', 'LOAD_SAMPLE', { accountId: ayAccountId, idempotencyKey: 'sample-ay' });
  assert.equal(loaded.response.status, 200);
  state = await http('/api/demo/state', { actor: 'ay' });
  account = accountFrom(state, ayAccountId);
  assert.equal(account.summary.cashSalesMinor, '300000');
  assert.equal(account.summary.ibanMinor, '70000');
  assert.equal(account.summary.debtMinor, '30000');
  assert.equal(account.summary.oldCollectionMinor, '50000');
  assert.equal(account.summary.expectedCashMinor, '360000');
  assert.equal(account.summary.countedCashMinor, '360000');
  assert.equal(account.summary.cashDifferenceMinor, '0');
  assert.equal(account.summary.pendingSlipCount, 2);

  // Revision conflict, strict money and sourceRef duplicate are rejected without bypass.
  const stale = await action('ay', 'ADD_DECLARATION', {
    accountId: ayAccountId, expectedRevision: 1, idempotencyKey: 'stale',
    payload: { kind: 'CASH', amount: '1.00', sourceRef: 'STALE-REF' },
  });
  assertError(stale, 409, 'STALE_REVISION');
  const badMoney = await action('ay', 'ADD_DECLARATION', {
    accountId: ayAccountId, idempotencyKey: 'bad-money',
    payload: { kind: 'CASH', amount: '1,00', sourceRef: 'BAD-MONEY' },
  });
  assertError(badMoney, 400, 'AMOUNT_FORMAT_INVALID');

  const firstSlip = account.slips[0];
  let reviewed = await action('ay', 'REVIEW_SLIP', {
    accountId: ayAccountId, expectedRevision: account.revision, idempotencyKey: 'verify-3500',
    payload: { slipId: firstSlip.id, action: 'VERIFY' },
  });
  assert.equal(reviewed.response.status, 200);
  state = await http('/api/demo/state', { actor: 'ay' });
  account = accountFrom(state, ayAccountId);
  const secondSlip = account.slips.find((slip) => slip.scenario === 'SALE_2500');
  reviewed = await action('ay', 'REVIEW_SLIP', {
    accountId: ayAccountId, expectedRevision: account.revision, idempotencyKey: 'verify-2500',
    payload: { slipId: secondSlip.id, action: 'VERIFY' },
  });
  assert.equal(reviewed.response.status, 200);
  state = await http('/api/demo/state', { actor: 'ay' });
  account = accountFrom(state, ayAccountId);
  assert.equal(account.summary.verifiedCardMinor, '600000');
  assert.equal(account.summary.paymentDifferenceMinor, '0');

  const duplicate = await action('ay', 'ADD_SLIP', {
    accountId: ayAccountId, idempotencyKey: 'add-duplicate', payload: { scenario: 'DUPLICATE' },
  });
  assert.equal(duplicate.response.status, 200);
  state = await http('/api/demo/state', { actor: 'ay' });
  account = accountFrom(state, ayAccountId);
  assert.equal(account.slips.at(-1).status, 'REJECTED');
  assert.equal(account.summary.verifiedCardMinor, '600000');

  const report = await action('ay', 'ADD_SLIP', {
    accountId: ayAccountId, idempotencyKey: 'add-report', payload: { scenario: 'REPORT' },
  });
  assert.equal(report.response.status, 200);
  state = await http('/api/demo/state', { actor: 'ay' });
  account = accountFrom(state, ayAccountId);
  const reportSlip = account.slips.find((slip) => slip.scenario === 'REPORT');
  assert.equal(reportSlip.amount, '5000.00');
  assert.equal(reportSlip.status, 'REVIEW_REQUIRED');
  assert.equal(account.summary.verifiedCardMinor, '600000');
  const reportVerify = await action('ay', 'REVIEW_SLIP', {
    accountId: ayAccountId, expectedRevision: account.revision, idempotencyKey: 'report-verify',
    payload: { slipId: reportSlip.id, action: 'VERIFY' },
  });
  assertError(reportVerify, 409, 'REVIEW_BLOCKED');
  const reportReject = await action('ay', 'REVIEW_SLIP', {
    accountId: ayAccountId, expectedRevision: account.revision, idempotencyKey: 'report-reject',
    payload: { slipId: reportSlip.id, action: 'REJECT', reason: 'Rapor türü satış slipi değildir' },
  });
  assert.equal(reportReject.response.status, 200);

  // Count is balanced; a separate mismatch request verifies the gate before the corrected count is submitted.
  state = await http('/api/demo/state', { actor: 'ay' });
  account = accountFrom(state, ayAccountId);
  const mismatch = await action('ay', 'COUNT_CASH', {
    accountId: ayAccountId, expectedRevision: account.revision, idempotencyKey: 'count-mismatch',
    payload: { amount: '3599.99' },
  });
  assert.equal(mismatch.response.status, 200);
  state = await http('/api/demo/state', { actor: 'ay' });
  account = accountFrom(state, ayAccountId);
  const mismatchSubmit = await action('ay', 'SUBMIT', {
    accountId: ayAccountId, expectedRevision: account.revision, idempotencyKey: 'submit-mismatch', payload: {},
  });
  assertError(mismatchSubmit, 409, 'CASH_DIFFERENCE');
  const count = await action('ay', 'COUNT_CASH', {
    accountId: ayAccountId, expectedRevision: account.revision, idempotencyKey: 'count-ay',
    payload: { amount: '3600.00' },
  });
  assert.equal(count.response.status, 200);
  state = await http('/api/demo/state', { actor: 'ay' });
  account = accountFrom(state, ayAccountId);
  assert.equal(account.summary.cashDifferenceMinor, '0');
  assert.equal(account.summary.deliverableCashMinor, '350000');

  const ownAccountDeny = await action('can', 'COUNT_CASH', {
    accountId: ayAccountId, idempotencyKey: 'can-ay', payload: { amount: '3600.00' },
  });
  assertError(ownAccountDeny, 403, 'ACCOUNT_SCOPE_DENIED');

  const submitted = await action('ay', 'SUBMIT', {
    accountId: ayAccountId, expectedRevision: account.revision, idempotencyKey: 'submit-ay', payload: {},
  });
  assert.equal(submitted.response.status, 200);
  const snapshotHash = submitted.json.result.snapshotHash;
  assert.equal(typeof snapshotHash, 'string');
  const editAfterSubmit = await action('ay', 'ADD_DECLARATION', {
    accountId: ayAccountId, idempotencyKey: 'edit-closed', payload: { kind: 'CASH', amount: '1.00', sourceRef: 'CLOSED-EDIT' },
  });
  assertError(editAfterSubmit, 409, 'ACCOUNT_LOCKED');
  const wrongCashReceiver = await action('ay', 'RECEIVE_CASH', {
    accountId: ayAccountId, idempotencyKey: 'ay-receive', payload: { amount: '3500.00', reason: 'Yetkisiz personel alımı' },
  });
  assertError(wrongCashReceiver, 403, 'ROLE_DENIED');
  const received = await action('mehmet', 'RECEIVE_CASH', {
    accountId: ayAccountId, idempotencyKey: 'mehmet-receive', payload: { amount: '3500.00' },
  });
  assert.equal(received.response.status, 200);
  assert.equal(received.json.result.status, 'ACCEPTED');

  const firstApproval = await action('elif', 'APPROVE', {
    accountId: ayAccountId, expectedRevision: account.revision, idempotencyKey: 'approve-elif',
    payload: { snapshotHash, reason: 'Muhasebe ilk DEMO imzası; nakit teslim kabul edildi' },
  });
  assert.equal(firstApproval.response.status, 200);
  assert.equal(firstApproval.json.result.status, 'IN_REVIEW');
  const secondApproval = await action('zeynep', 'APPROVE', {
    accountId: ayAccountId, expectedRevision: account.revision, idempotencyKey: 'approve-zeynep',
    payload: { snapshotHash, reason: 'Firma yetkilisi ikinci DEMO imzası verildi' },
  });
  assert.equal(secondApproval.response.status, 200);
  assert.equal(secondApproval.json.result.status, 'ACCEPTED_WITH_PENDING');

  state = await http('/api/demo/state', { actor: 'mehmet' });
  account = accountFrom(state, ayAccountId);
  assert.equal(account.approvals.length, 2);
  assert.equal(account.status, 'ACCEPTED_WITH_PENDING');
  assert.equal(account.cashHandover.status, 'ACCEPTED');
  assert.equal(account.summary.pendingIban, true);
});

test('düşük güven düzeltmesi, NEEDS_INFO revizyonu ve eski imzanın geçersizleşmesi', async () => {
  let opened = await action('can', 'OPEN_ACCOUNT', {
    idempotencyKey: 'open-can', payload: { assignmentId: 'assignment-can-s02', float: '100' },
  });
  assert.equal(opened.response.status, 200);
  canAccountId = opened.json.result.accountId;
  await action('can', 'LOAD_SAMPLE', { accountId: canAccountId, idempotencyKey: 'sample-can' });
  let state = await http('/api/demo/state', { actor: 'can' });
  let account = accountFrom(state, canAccountId);
  const low = await action('can', 'ADD_SLIP', {
    accountId: canAccountId, idempotencyKey: 'low-add', payload: { scenario: 'LOW_CONFIDENCE' },
  });
  assert.equal(low.response.status, 200);
  state = await http('/api/demo/state', { actor: 'can' });
  account = accountFrom(state, canAccountId);
  const lowSlip = account.slips.find((slip) => slip.scenario === 'LOW_CONFIDENCE');
  const corrected = await action('can', 'REVIEW_SLIP', {
    accountId: canAccountId, expectedRevision: account.revision, idempotencyKey: 'low-correct',
    payload: { slipId: lowSlip.id, action: 'VERIFY', amount: '1250.00', reason: 'Belgeden tutar insan tarafından doğrulandı' },
  });
  assert.equal(corrected.response.status, 200);
  state = await http('/api/demo/state', { actor: 'can' });
  account = accountFrom(state, canAccountId);
  assert.equal(account.slips.find((slip) => slip.id === lowSlip.id).status, 'VERIFIED');
  assert.equal(account.summary.verifiedCardMinor, '125000');

  // Reset this separate account and exercise the review -> revise path without deleting old approvals.
  await action('mehmet', 'RESET', { idempotencyKey: 'reset-before-revise' });
  opened = await action('can', 'OPEN_ACCOUNT', {
    idempotencyKey: 'open-can-2', payload: { assignmentId: 'assignment-can-s02', float: '100.00' },
  });
  canAccountId = opened.json.result.accountId;
  await action('can', 'LOAD_SAMPLE', { accountId: canAccountId, idempotencyKey: 'sample-can-2' });
  state = await http('/api/demo/state', { actor: 'can' });
  account = accountFrom(state, canAccountId);
  const submit = await action('can', 'SUBMIT', {
    accountId: canAccountId, expectedRevision: account.revision, idempotencyKey: 'submit-can', payload: {},
  });
  assert.equal(submit.response.status, 200);
  const hash1 = submit.json.result.snapshotHash;
  await action('mehmet', 'RECEIVE_CASH', {
    accountId: canAccountId, idempotencyKey: 'receive-can', payload: { amount: '5000.00' },
  });
  state = await http('/api/demo/state', { actor: 'can' });
  account = accountFrom(state, canAccountId);
  const approve1 = await action('elif', 'APPROVE', {
    accountId: canAccountId, expectedRevision: account.revision, idempotencyKey: 'can-approve-old',
    payload: { snapshotHash: hash1, reason: 'İlk sürüm muhasebe DEMO incelemesi' },
  });
  assert.equal(approve1.json.result.status, 'IN_REVIEW');
  const info = await action('zeynep', 'ASK_INFO', {
    accountId: canAccountId, idempotencyKey: 'can-info', payload: { reason: 'Yeni vardiya notu ve açıklama gerekiyor' },
  });
  assert.equal(info.json.result.status, 'NEEDS_INFO');
  state = await http('/api/demo/state', { actor: 'can' });
  account = accountFrom(state, canAccountId);
  const revised = await action('can', 'REVISE', {
    accountId: canAccountId, expectedRevision: account.revision, idempotencyKey: 'can-revise', payload: {},
  });
  assert.equal(revised.json.result.status, 'OPEN');
  assert.equal(revised.json.result.priorSubmittedRevision, 2);
  state = await http('/api/demo/state', { actor: 'can' });
  account = accountFrom(state, canAccountId);
  const submit2 = await action('can', 'SUBMIT', {
    accountId: canAccountId, expectedRevision: account.revision, idempotencyKey: 'submit-can-2', payload: {},
  });
  assert.equal(submit2.response.status, 200);
  assert.notEqual(submit2.json.result.snapshotHash, hash1);
  await action('mehmet', 'RECEIVE_CASH', {
    accountId: canAccountId, idempotencyKey: 'receive-can-2', payload: { amount: '5000.00' },
  });
  state = await http('/api/demo/state', { actor: 'can' });
  account = accountFrom(state, canAccountId);
  assert.equal(account.approvals.length, 1);
  const approveNew = await action('zeynep', 'APPROVE', {
    accountId: canAccountId, expectedRevision: account.revision, idempotencyKey: 'can-approve-new',
    payload: { snapshotHash: submit2.json.result.snapshotHash, reason: 'Revize sürüm firma DEMO incelemesi' },
  });
  assert.equal(approveNew.json.result.status, 'IN_REVIEW');
});

test('beş terminal lease, altıncı red ve release', async () => {
  for (let index = 1; index <= 5; index += 1) {
    const leased = await action('mehmet', 'LEASE_TERMINAL', {
      idempotencyKey: `lease-${index}`, payload: { terminalId: `pc-${index}` },
    });
    assert.equal(leased.response.status, 200);
  }
  const duplicate = await action('mehmet', 'LEASE_TERMINAL', {
    idempotencyKey: 'lease-duplicate', payload: { terminalId: 'pc-1' },
  });
  assert.equal(duplicate.response.status, 200);
  assert.equal(duplicate.json.result.duplicate, true);
  const sixth = await action('mehmet', 'LEASE_TERMINAL', {
    idempotencyKey: 'lease-sixth', payload: { terminalId: 'pc-6' },
  });
  assertError(sixth, 409, 'TERMINAL_LIMIT');
  const release = await action('mehmet', 'RELEASE_TERMINAL', {
    idempotencyKey: 'release-one', payload: { terminalId: 'pc-1' },
  });
  assert.equal(release.response.status, 200);
  const sixthAfterRelease = await action('mehmet', 'LEASE_TERMINAL', {
    idempotencyKey: 'lease-sixth-after-release', payload: { terminalId: 'pc-6' },
  });
  assert.equal(sixthAfterRelease.response.status, 200);
});

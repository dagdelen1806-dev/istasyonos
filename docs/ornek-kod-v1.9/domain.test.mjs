import test from 'node:test';
import assert from 'node:assert/strict';
import {
  appendEvidenceReview,
  aggregateVerifiedEvidence,
  assertOwnRealUser,
  canonicalDuplicateKey,
  classifyEvidenceDuplicate,
  createAccountingAcceptanceService,
  createEvidence,
  evaluateOcrDocument,
  hasActiveScopedPermission,
  minorToTryDecimal,
  normalizeOcrDocument,
  parseRetryAfterMs,
  parseTryDecimalToMinor,
  retryToDlq,
  retryWithPolicy,
  safeIntegrationLog,
  validateAccountingAcceptance,
  DomainError,
} from './domain.mjs';

const hashFor = (number) => number.toString(16).padStart(2, '0').repeat(32);
const confidence = { amount: 0.99, currency: 0.99, documentType: 0.99, transactionDate: 0.99, terminal: 0.99, rrn: 0.99 };

function evidence({ id = 1, type = 'sale', amount = '100.00', rrn = 'RRN-1', mask = 'MASKED', hash = hashFor(id), linkedOriginalEvidenceId = null, companyId = 'company-1', merchantId = 'merchant-1', terminalId = 'terminal-1', transactionDate = '2026-10-10', currencyCode = 'TRY', customConfidence = confidence } = {}) {
  return createEvidence({
    evidenceId: `ev-${id}`,
    companyId,
    merchantId,
    terminalId,
    transactionDate,
    rrn,
    linkedOriginalEvidenceId,
    authCode: `AUTH-${id}`,
    contentSha256: hash,
    documentType: type,
    amount,
    currencyCode,
    sensitiveMaskState: mask,
    confidence: customConfidence,
  });
}

const review = (item, id = item.evidenceId) => appendEvidenceReview(item, {
  reviewId: `review-${id}`,
  reviewerUserId: 'reviewer-1',
  action: 'VERIFY',
});

const target = (overrides = {}) => ({
  tenantId: 'tenant-1',
  companyId: 'company-1',
  stationId: 'station-1',
  businessUnitId: 'fuel-1',
  accountId: 'account-1',
  approvalRequestId: 'request-1',
  policyVersion: 7,
  requestedByUserId: 'user-requester',
  requestedByRealPersonId: 'person-requester',
  revision: 4,
  snapshotHash: 'a'.repeat(64),
  evidenceSetHash: 'b'.repeat(64),
  openReviewCount: 0,
  differenceMinor: 0n,
  pendingFinancialInfo: false,
  reviewable: true,
  closed: false,
  status: 'IN_REVIEW',
  ...overrides,
});

const policy = (overrides = {}) => ({
  permissionCode: 'finance.reconcile',
  requiredSignatures: 1,
  allowPending: false,
  ...overrides,
});

const accountant = (overrides = {}) => ({
  userId: 'user-accountant',
  realPersonId: 'person-accountant',
  isRealUser: true,
  active: true,
  permissionGrants: [{
    permissionCode: 'finance.reconcile',
    active: true,
    tenantId: 'tenant-1',
    scopeType: 'COMPANY',
    companyId: 'company-1',
  }],
  ...overrides,
});

const expectedSnapshot = { revision: 4, snapshotHash: 'a'.repeat(64), approvalRequestId: 'request-1' };
const checkedApproval = (overrides = {}) => ({
  decisionCode: 'APPROVE',
  approvalRequestId: 'request-1',
  snapshotHash: 'a'.repeat(64),
  revision: 4,
  userId: 'other-user',
  realPersonId: 'other-person',
  active: true,
  isRealUser: true,
  serverChecked: true,
  permissionChecked: true,
  scopeChecked: true,
  permissionCode: 'finance.reconcile',
  ...overrides,
});

function acceptance(overrides = {}) {
  return validateAccountingAcceptance({
    actor: accountant(),
    target: target(),
    expectedSnapshot,
    existingDecisions: [],
    policy: policy(),
    ...overrides,
  });
}

test('TRY kuruş parseri float kullanmadan BigInt üretir', () => {
  assert.equal(parseTryDecimalToMinor('125500.30'), 12550030n);
  assert.equal(parseTryDecimalToMinor('0'), 0n);
  assert.equal(minorToTryDecimal(-125030n), '-1250.30');
});

test('TRY parseri sayı, virgül, üstel ve fazla ondalığı reddeder', () => {
  for (const invalid of [125.5, '1,25', '1e2', '1.234', '-1.00', '01.00', '']) {
    assert.throws(() => parseTryDecimalToMinor(invalid), DomainError);
  }
});

test('Eksik/bilinmeyen currency TRY varsayılmaz; null money ve currency confidence review açar', () => {
  const missing = normalizeOcrDocument({ documentType: 'sale', amount: '10.00', transactionDate: '2026-10-10', merchantId: 'm', terminalId: 't', rrn: 'r', confidence: { ...confidence, currency: undefined } });
  assert.equal(missing.currencyCode, null);
  assert.equal(missing.amountMinor, null);
  const decision = evaluateOcrDocument({ ...missing, sensitiveMaskState: 'MASKED' });
  assert.ok(decision.reasons.includes('UNKNOWN_OR_INVALID_MONEY'));
  assert.ok(decision.reasons.includes('LOW_CONFIDENCE_CURRENCY'));
  const lowCurrency = evaluateOcrDocument({ ...missing, currencyCode: 'TRY', amountMinor: 1000n, sensitiveMaskState: 'MASKED', confidence: { ...confidence, currency: 0.5 } });
  assert.ok(lowCurrency.reasons.includes('LOW_CONFIDENCE_CURRENCY'));
});

test('Güvensiz maske ve bilinmeyen belge doğrulama kapısını kapatır', () => {
  const missing = evaluateOcrDocument(evidence({ id: 2, mask: null }).document);
  assert.ok(missing.reasons.includes('MASK_STATE_REQUIRED'));
  const unsafe = evaluateOcrDocument(evidence({ id: 3, mask: 'UNSAFE' }).document);
  assert.ok(unsafe.reasons.includes('SENSITIVE_IMAGE_BLOCKED'));
  assert.equal(unsafe.eligibleForVerification, false);
  const unknown = evaluateOcrDocument({ ...normalizeOcrDocument({ documentType: 'mystery', confidence }), sensitiveMaskState: 'MASKED' });
  assert.ok(unknown.reasons.includes('DOCUMENT_NOT_SALE_SLIP'));
});

test('Source key alanları boş/invalid tarih ve amount biçimi kabul edilmez; RRN eksik manuel review ister', () => {
  assert.throws(() => createEvidence({ ...evidence({ id: 4 }), companyId: '' }), /companyId/);
  assert.throws(() => createEvidence({ ...evidence({ id: 5 }), transactionDate: '2026-02-30' }), /ISO tarih/);
  assert.throws(() => createEvidence({ ...evidence({ id: 6 }), amount: '1,00' }), /TRY tutarı/);
  const noRrn = evidence({ id: 7, rrn: null });
  assert.equal(noRrn.canonicalKey, null);
  const decision = evaluateOcrDocument(noRrn.document);
  assert.ok(decision.reasons.includes('RRN_MANUAL_MAPPING_REQUIRED'));
  assert.equal(classifyEvidenceDuplicate(noRrn, []).kind, 'MANUAL_MAPPING_REVIEW');
});

test('Canonical duplicate anahtarı şirket-merchant-terminal-tarih-RRN kullanır, authCode kullanmaz', () => {
  const first = canonicalDuplicateKey({ companyId: 'co', merchantId: 'm', terminalId: 't', transactionDate: '2026-10-10', rrn: 'rrn', authCode: 'A' });
  const second = canonicalDuplicateKey({ companyId: 'co', merchantId: 'm', terminalId: 't', transactionDate: '2026-10-10', rrn: 'rrn', authCode: 'B' });
  assert.equal(first, second);
  assert.ok(!first.includes('AUTH'));
  assert.equal(canonicalDuplicateKey({ companyId: 'co', merchantId: 'm', terminalId: 't', transactionDate: '2026-10-10', rrn: null }), null);
});

test('Aynı canonical collision ve tüm keylerde aynı content hash otomatik düşmez', () => {
  const first = evidence({ id: 8, rrn: 'same-rrn' });
  const second = evidence({ id: 9, rrn: 'same-rrn', hash: first.contentSha256 });
  assert.equal(classifyEvidenceDuplicate(second, [first]).kind, 'EXACT_CONTENT_REPEAT');
  const recropped = evidence({ id: 10, rrn: 'other-rrn', hash: first.contentSha256 });
  assert.equal(classifyEvidenceDuplicate(recropped, [first]).kind, 'EXACT_CONTENT_DIFFERENT_CANONICAL_REVIEW');
  const collision = evidence({ id: 11, rrn: 'same-rrn', hash: hashFor(11) });
  assert.equal(classifyEvidenceDuplicate(collision, [first]).kind, 'LEGITIMATE_COLLISION_REVIEW');
});

test('Evidence review immutable sürüm ekler, önceki evidence değişmez', () => {
  const original = evidence({ id: 12 });
  const verified = review(original);
  assert.equal(original.status, 'PENDING_REVIEW');
  assert.equal(original.reviewVersion, 0);
  assert.equal(verified.status, 'VERIFIED');
  assert.equal(verified.reviewVersion, 1);
  assert.equal(verified.reviews.length, 1);
  assert.equal(Object.isFrozen(verified), true);
});

test('Declined ve report verified olsa bile satış toplamına girmez', () => {
  const declined = { ...evidence({ id: 13, type: 'declined' }), status: 'VERIFIED' };
  const report = { ...evidence({ id: 14, type: 'report' }), status: 'VERIFIED' };
  const projection = aggregateVerifiedEvidence([declined, report]);
  assert.equal(projection.totalMinor, 0n);
  assert.deepEqual(projection.includedEvidenceIds, []);
});

test('Aggregate yalnız verified sale ve doğrulanmış aynı scope refundu, original tutarı aşmadan toplar', () => {
  const sale = review(evidence({ id: 15, amount: '100.00', rrn: 'rrn-sale' }));
  const refund = review(evidence({ id: 16, type: 'refund', amount: '20.50', rrn: 'rrn-refund', linkedOriginalEvidenceId: sale.evidenceId }));
  const projection = aggregateVerifiedEvidence([sale, refund]);
  assert.equal(projection.totalMinor, 7950n);
  assert.deepEqual([...projection.includedEvidenceIds].sort(), ['ev-15', 'ev-16']);
  assert.equal(projection.sideEffects.createsSale, false);
  assert.equal(projection.sideEffects.createsCash, false);
  assert.equal(projection.sideEffects.createsAr, false);
});

test('Unmatched, cross-scope ve overspend refund review dışında aggregate edilmez', () => {
  const sale = review(evidence({ id: 17, amount: '100.00', rrn: 'rrn-sale' }));
  const unmatched = review(evidence({ id: 18, type: 'refund', amount: '5.00', rrn: 'rrn-unmatched', linkedOriginalEvidenceId: 'missing' }));
  const overspend = review(evidence({ id: 19, type: 'refund', amount: '101.00', rrn: 'rrn-over', linkedOriginalEvidenceId: sale.evidenceId }));
  const otherScope = review(evidence({ id: 20, type: 'refund', amount: '5.00', rrn: 'rrn-scope', linkedOriginalEvidenceId: sale.evidenceId, terminalId: 'terminal-2' }));
  const projection = aggregateVerifiedEvidence([sale, unmatched, overspend, otherScope]);
  assert.equal(projection.totalMinor, 10000n);
  assert.deepEqual(projection.includedEvidenceIds, ['ev-17']);
  assert.ok(projection.reviewReasons.some((reason) => reason.code === 'REFUND_ORIGINAL_REQUIRED'));
  assert.ok(projection.reviewReasons.some((reason) => reason.code === 'REFUND_AMOUNT_EXCEEDS_ORIGINAL'));
  assert.ok(projection.reviewReasons.some((reason) => reason.code === 'REFUND_SCOPE_MISMATCH'));
});

test('Aggregate aynı physical hashi iki kez toplamaz; farklı canonical hash kullanımı review olur', () => {
  const one = review(evidence({ id: 21, rrn: 'rrn-one', hash: hashFor(31) }));
  const exact = review(evidence({ id: 22, rrn: 'rrn-one', hash: hashFor(31) }));
  const differentCanonical = review(evidence({ id: 23, rrn: 'rrn-two', hash: hashFor(31) }));
  const collision = aggregateVerifiedEvidence([one, exact]);
  assert.equal(collision.totalMinor, 10000n);
  assert.deepEqual(collision.includedEvidenceIds, ['ev-21']);
  assert.deepEqual(collision.excludedEvidenceIds, ['ev-22']);
  const different = aggregateVerifiedEvidence([one, differentCanonical]);
  assert.equal(different.totalMinor, 0n);
  assert.ok(different.reviewReasons.some((reason) => reason.code === 'EXACT_CONTENT_DIFFERENT_CANONICAL'));
});

test('Retry 503 sonrası injectable jitter ile bounded tekrar dener', async () => {
  let attempts = 0;
  const sleeps = [];
  const result = await retryWithPolicy(async () => {
    attempts += 1;
    if (attempts < 3) throw Object.assign(new Error('gizli metin'), { status: 503 });
    return 'ok';
  }, { maxAttempts: 4, baseDelayMs: 100, maxDelayMs: 500, retryAfterCapMs: 500, random: () => 0, sleep: async (ms) => sleeps.push(ms), attemptTimeoutMs: null });
  assert.equal(result.value, 'ok');
  assert.equal(result.attempts, 3);
  assert.deepEqual(sleeps, [50, 100]);
});

test('Retry 400 için tekrar yapmaz ve Retry-After parser cap döndürür', async () => {
  let attempts = 0;
  await assert.rejects(() => retryWithPolicy(async () => {
    attempts += 1;
    throw Object.assign(new Error('raw OCR text'), { status: 400, headers: { 'retry-after': '99' } });
  }, { maxAttempts: 4, retryAfterCapMs: 150, sleep: async () => { throw new Error('sleep çağrılmamalı'); }, attemptTimeoutMs: null }), { status: 400 });
  assert.equal(attempts, 1);
  assert.equal(parseRetryAfterMs('99', { capMs: 150 }), 150);
});

test('Retry-After cap üstündeyse provider süresinden erken retry yerine DLQ/manual sonucu döner', async () => {
  let attempts = 0;
  const sleeps = [];
  const result = await retryToDlq(async () => {
    attempts += 1;
    throw Object.assign(new Error('provider says wait'), { status: 429, retryAfter: '9' });
  }, { maxAttempts: 3, retryAfterCapMs: 5000, sleep: async (ms) => sleeps.push(ms), attemptTimeoutMs: null });
  assert.deepEqual(result, { status: 'DLQ', reason: 'RETRY_AFTER_EXCEEDS_WINDOW', attempts: 1, lastStatus: 429 });
  assert.equal(attempts, 1);
  assert.deepEqual(sleeps, []);
});

test('Typed NETWORK_ERROR yalnız idempotent OCR jobında bounded retry alır', async () => {
  let attempts = 0;
  const result = await retryToDlq(async () => {
    attempts += 1;
    throw Object.assign(new Error('network'), { code: 'NETWORK_ERROR' });
  }, { maxAttempts: 2, idempotentOcrJob: true, attemptTimeoutMs: null, sleep: async () => {} });
  assert.equal(result.reason, 'MAX_ATTEMPTS');
  assert.equal(attempts, 2);
  await assert.rejects(() => retryWithPolicy(() => { throw Object.assign(new Error('network'), { code: 'NETWORK_ERROR' }); }, { attemptTimeoutMs: null, sleep: async () => {} }), { code: 'NETWORK_ERROR' });
});

test('Timeout entegrasyon işlemini retry etmeden DLQ yapar; fiscal side effect yoktur', async () => {
  const result = await retryToDlq(() => new Promise(() => {}), { maxAttempts: 3, attemptTimeoutMs: 2, sleep: async () => {} });
  assert.equal(result.status, 'DLQ');
  assert.equal(result.reason, 'TIMEOUT');
  assert.equal(result.attempts, 1);
});

test('Integration log allow-list ile PAN ve raw text taşımaz', () => {
  const log = safeIntegrationLog({ event: 'ocr.retry', correlationId: 'corr-1', attempt: 2, status: 503, rawText: 'olmamalı', pan: 'olmamalı' });
  assert.deepEqual(log, { event: 'ocr.retry', correlationId: 'corr-1', attempt: 2, status: 503 });
});

test('Permission her zaman tenant eşleşmesi ve geçerli grant tarihi ister', () => {
  const actor = accountant({ permissionGrants: [{ permissionCode: 'shift.declare.self', active: true, tenantId: 'tenant-1', scopeType: 'COMPANY', companyId: 'company-1' }] });
  assert.equal(hasActiveScopedPermission(actor, 'shift.declare.self', target()), true);
  assert.equal(hasActiveScopedPermission(actor, 'shift.declare.self', target({ tenantId: 'tenant-2' })), false);
  assert.equal(hasActiveScopedPermission(accountant({ permissionGrants: [{ ...actor.permissionGrants[0], validFrom: 'not-a-date' }] }), 'shift.declare.self', target()), false);
  assert.equal(hasActiveScopedPermission(actor, 'shift.declare.self', {}), false);
  assert.equal(hasActiveScopedPermission(accountant({ permissionGrants: [{ ...actor.permissionGrants[0], companyId: '' }] }), 'shift.declare.self', target()), false);
});

test('Own-account yolu gerçek aktif kullanıcı ve aktif scoped permission ister', () => {
  const actor = accountant({ userId: 'employee-1', realPersonId: 'person-1', permissionGrants: [{ permissionCode: 'shift.declare.self', active: true, tenantId: 'tenant-1', scopeType: 'COMPANY', companyId: 'company-1' }] });
  assert.equal(assertOwnRealUser({ actor, ownerUserId: 'employee-1', permissionCode: 'shift.declare.self', target: target() }), true);
  assert.throws(() => assertOwnRealUser({ actor, ownerUserId: 'employee-2', permissionCode: 'shift.declare.self', target: target() }), /kendi personel hesabı/);
});

test('Muhasebe kabulünde snapshot hash veya version değiştiyse reject edilir', () => {
  assert.throws(() => acceptance({ target: target({ revision: 5 }) }), /Snapshot hash veya revision/);
});

test('Muhasebe acceptance target state alanları eksikse reject edilir', () => {
  assert.throws(() => acceptance({ target: target({ differenceMinor: undefined }) }), /state alanları|TARGET_STATE_INCOMPLETE/);
  assert.throws(() => acceptance({ target: target({ openReviewCount: undefined }) }), /state alanları|TARGET_STATE_INCOMPLETE/);
  assert.throws(() => acceptance({ target: target({ pendingFinancialInfo: undefined }) }), /state alanları|TARGET_STATE_INCOMPLETE/);
  assert.throws(() => acceptance({ target: target({ status: 'CLOSED', closed: true, reviewable: false }) }), /kapalı/);
});

test('Muhasebe kabulü aktif permission ve scope yoksa reject edilir', () => {
  const actor = accountant({ permissionGrants: [{ permissionCode: 'finance.reconcile', active: true, tenantId: 'tenant-2', scopeType: 'STATION', stationId: 'station-1' }] });
  assert.throws(() => acceptance({ actor }), /permission aktif değil/);
});

test('Eski request/snapshot/revision kararları sayılmaz; aynı request sunucu checked imza sayılır', () => {
  const stale = checkedApproval({ approvalRequestId: 'old-request' });
  const first = acceptance({ policy: policy({ requiredSignatures: 2 }), existingDecisions: [stale] });
  assert.equal(first.approvalStatus, 'PENDING_APPROVAL');
  const second = acceptance({ policy: policy({ requiredSignatures: 2 }), existingDecisions: [checkedApproval()] });
  assert.equal(second.operationalStatus, 'ACCEPTED');
  assert.throws(() => acceptance({ existingDecisions: [checkedApproval({ serverChecked: false })] }), /sunucuda doğrulanmamış/);
});

test('Requester önceki imza olarak gelirse self-approval reddedilir', () => {
  assert.throws(() => acceptance({ existingDecisions: [checkedApproval({ userId: 'user-requester' })] }), /talep sahibi/);
});

test('İki imza kuralı aynı gerçek kişiyi ikinci imza saymaz', () => {
  const samePerson = checkedApproval({ realPersonId: 'person-accountant' });
  assert.throws(() => acceptance({ actor: accountant(), target: target(), existingDecisions: [samePerson], policy: policy({ requiredSignatures: 2 }) }), /aynı gerçek kişinin/);
});

test('İki imzanın ilki PENDING_APPROVAL döner; exception ile transaction rollback tetiklemez', () => {
  const result = acceptance({ policy: policy({ requiredSignatures: 2 }) });
  assert.equal(result.approvalStatus, 'PENDING_APPROVAL');
  assert.equal(result.operationalStatus, 'PENDING_APPROVAL');
  assert.equal(result.pendingApproval, true);
});

test('Pending finansal bilgi yalnız allowPending + iki imza + açık gerekçe ile kabul edilir', () => {
  assert.throws(() => acceptance({ target: target({ pendingFinancialInfo: true }), reason: 'eksik banka ekstresi' }), /FINANCIAL_PENDING_POLICY|Pending finansal/);
  const first = acceptance({ target: target({ pendingFinancialInfo: true }), policy: policy({ requiredSignatures: 2, allowPending: true }), reason: 'eksik banka ekstresi' });
  assert.equal(first.approvalStatus, 'PENDING_APPROVAL');
  const accepted = acceptance({ target: target({ pendingFinancialInfo: true }), existingDecisions: [checkedApproval()], policy: policy({ requiredSignatures: 2, allowPending: true }), reason: 'eksik banka ekstresi' });
  assert.equal(accepted.operationalStatus, 'ACCEPTED_WITH_PENDING');
  assert.equal(accepted.financialStatus, 'PENDING');
});

test('Accounting service policyyi server repositoryden yükler, ilk kararı append eder ve eventi pending/accepted ayırır', async () => {
  const decisions = [];
  const stored = new Map();
  const events = [];
  const calls = { append: 0, pending: 0, accepted: 0, loadPolicy: 0 };
  let currentActor = accountant();
  const repository = {
    async lockAcceptanceRows() { return ['account', 'handover', 'request']; },
    async readFreshSnapshot() { return { target: target(), existingDecisions: [...decisions] }; },
    async loadPolicy(_tx, version) { calls.loadPolicy += 1; assert.equal(version, 7); return policy({ requiredSignatures: 2 }); },
    async getIdempotentResult(_tx, key) { return stored.get(key) ?? null; },
    async appendDecision(_tx, { actor, target: lockedTarget, serverChecked, permissionCode }) {
      calls.append += 1;
      decisions.push({ ...checkedApproval({ userId: actor.userId, realPersonId: actor.realPersonId }), approvalRequestId: lockedTarget.approvalRequestId, snapshotHash: lockedTarget.snapshotHash, revision: lockedTarget.revision, serverChecked, permissionCode });
    },
    async markPendingApproval() { calls.pending += 1; },
    async markOperationalAccepted() { calls.accepted += 1; },
    async storeIdempotentResult(_tx, { idempotencyKey, payloadHash, result }) { stored.set(idempotencyKey, { payloadHash, result }); },
  };
  const service = createAccountingAcceptanceService({
    transaction: { async run(callback) { return callback({}); } },
    identity: { async requireUser() { return currentActor; } },
    repository,
    outbox: { async enqueueUnique(_tx, event) { events.push(event); } },
  });
  const request = { idempotencyKey: 'idem-1', payloadHash: 'c'.repeat(64), expectedSnapshot, policy: policy({ requiredSignatures: 1 }) };
  const first = await service.accept(request);
  assert.equal(first.operationalStatus, 'PENDING_APPROVAL');
  assert.equal(calls.append, 1);
  assert.equal(calls.pending, 1);
  assert.equal(calls.accepted, 0);
  assert.equal(events[0].eventType, 'shift.handover.accounting-pending-approval');
  currentActor = accountant({ userId: 'user-2', realPersonId: 'person-2' });
  const second = await service.accept({ ...request, idempotencyKey: 'idem-2', payloadHash: 'd'.repeat(64) });
  assert.equal(second.operationalStatus, 'ACCEPTED');
  assert.equal(calls.accepted, 1);
  assert.equal(events[1].eventType, 'shift.handover.accounting-accepted');
  assert.equal(calls.loadPolicy, 2);
  const replay = await service.accept(request);
  assert.deepEqual(replay, first);
  assert.equal(calls.append, 2);
  await assert.rejects(() => service.accept({ ...request, payloadHash: 'e'.repeat(64) }), /farklı payload/);
});

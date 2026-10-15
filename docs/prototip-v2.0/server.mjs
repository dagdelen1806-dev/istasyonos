import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, randomBytes } from 'node:crypto';
import {
  DomainError,
  aggregateVerifiedEvidence,
  appendEvidenceReview,
  createEvidence,
  minorToTryDecimal,
  parseTryDecimalToMinor,
} from './domain.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = join(HERE, 'public');
const BODY_LIMIT = 16 * 1024;
const WORKSPACE_TTL_MS = 30 * 60 * 1000;
const MAX_WORKSPACES = 500;
const DEMO_ACTORS = Object.freeze([
  { id: 'ay', name: 'Ayşe (demo)', role: 'FUEL_SALES' },
  { id: 'can', name: 'Can (demo)', role: 'FUEL_SALES' },
  { id: 'mehmet', name: 'Mehmet (demo)', role: 'STATION_MANAGER' },
  { id: 'elif', name: 'Elif (demo)', role: 'ACCOUNTANT' },
  { id: 'zeynep', name: 'Zeynep (demo)', role: 'COMPANY_MANAGER' },
]);
const ACTOR_MAP = new Map(DEMO_ACTORS.map((actor) => [actor.id, actor]));
const STATIC_ASSIGNMENTS = Object.freeze([
  Object.freeze({
    id: 'assignment-ay-s02', employeeId: 'ay', employeeName: 'Ayşe (demo)', stationName: 'S02',
    companyName: 'DEMO COMPANY', domain: 'FUEL', shiftLabel: 'DEMO S02 / AY',
    sourceTotalMinor: '1000000', sourceCardMinor: '600000',
  }),
  Object.freeze({
    id: 'assignment-can-s02', employeeId: 'can', employeeName: 'Can (demo)', stationName: 'S02',
    companyName: 'DEMO COMPANY', domain: 'FUEL', shiftLabel: 'DEMO S02 / CAN',
    sourceTotalMinor: '500000', sourceCardMinor: '0',
  }),
]);
const ASSIGNMENT_MAP = new Map(STATIC_ASSIGNMENTS.map((item) => [item.id, item]));
const DEMO_STATION = 'S02';
const TERMINAL_RE = /^[A-Za-z0-9][A-Za-z0-9:_-]{0,63}$/;
const WORKSPACE_RE = /^[A-Za-z0-9_-]{1,128}$/;

class ApiError extends Error {
  constructor(status, code, message) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

function error(status, code, message) {
  throw new ApiError(status, code, message);
}

function randomId(prefix) {
  return `${prefix}-${randomBytes(9).toString('hex')}`;
}

function sha256(value) {
  return createHash('sha256').update(String(value)).digest('hex');
}

function canonicalize(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalize(value[key])}`).join(',')}}`;
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function parseMoney(value, field = 'amount') {
  try {
    return parseTryDecimalToMinor(value);
  } catch (caught) {
    if (caught instanceof DomainError) error(400, caught.code, `${field}: ${caught.message}`);
    error(400, 'AMOUNT_INVALID', `${field} geçerli bir TRY tutarı olmalıdır`);
  }
}

function minorString(value) {
  if (typeof value !== 'bigint') throw new TypeError('minor value must be bigint');
  return String(value);
}

function decimalString(value) {
  return minorToTryDecimal(value);
}

function requiredText(value, field, { min = 1, max = 256 } = {}) {
  if (typeof value !== 'string') error(400, 'INVALID_INPUT', `${field} metin olmalıdır`);
  const text = value.trim();
  if (text.length < min || text.length > max) error(400, 'INVALID_INPUT', `${field} uzunluğu geçersiz`);
  return text;
}

function reasonText(value) {
  return requiredText(value, 'reason', { min: 10, max: 500 });
}

function actionKey(value) {
  return requiredText(value, 'idempotencyKey', { min: 1, max: 128 });
}

function actorFromRequest(req) {
  const value = Array.isArray(req.headers['x-demo-actor']) ? req.headers['x-demo-actor'][0] : req.headers['x-demo-actor'];
  if (typeof value !== 'string' || !ACTOR_MAP.has(value.trim())) error(401, 'DEMO_ACTOR_REQUIRED', 'X-Demo-Actor ile geçerli DEMO aktörü seçilmelidir');
  return ACTOR_MAP.get(value.trim());
}

function workspaceHeader(req) {
  const value = Array.isArray(req.headers['x-demo-workspace']) ? req.headers['x-demo-workspace'][0] : req.headers['x-demo-workspace'];
  if (value === undefined) return null;
  if (typeof value !== 'string' || !WORKSPACE_RE.test(value)) error(400, 'WORKSPACE_INVALID', 'X-Demo-Workspace değeri geçersiz');
  return value;
}

function assignmentForEmployee(actorId) {
  return STATIC_ASSIGNMENTS.find((assignment) => assignment.employeeId === actorId) ?? null;
}

function isEmployee(actor) {
  return actor.role === 'FUEL_SALES';
}

function isReviewActor(actor) {
  return ['STATION_MANAGER', 'ACCOUNTANT', 'COMPANY_MANAGER'].includes(actor.role);
}

function isAuthorizedForStation(actor, assignment) {
  if (isEmployee(actor)) return assignment?.employeeId === actor.id;
  return isReviewActor(actor) && assignment?.stationName === DEMO_STATION;
}

function workspaceCleanup(workspaces, now = Date.now()) {
  for (const [id, workspace] of workspaces) {
    if (now - workspace.lastSeenAt > WORKSPACE_TTL_MS) workspaces.delete(id);
  }
}

function createWorkspace(id) {
  return {
    id,
    createdAt: Date.now(),
    lastSeenAt: Date.now(),
    accounts: new Map(),
    terminals: new Map(),
    audit: [],
    idempotency: new Map(),
  };
}

function getWorkspace(workspaces, id) {
  workspaceCleanup(workspaces);
  const workspace = id ? workspaces.get(id) : null;
  if (!workspace) error(404, 'WORKSPACE_NOT_FOUND', 'DEMO workspace bulunamadı veya süresi doldu');
  workspace.lastSeenAt = Date.now();
  return workspace;
}

function createOrGetBootstrapWorkspace(workspaces, requestedId) {
  workspaceCleanup(workspaces);
  const id = requestedId ?? randomBytes(24).toString('hex');
  if (!workspaces.has(id)) {
    if (workspaces.size >= MAX_WORKSPACES) error(503, 'WORKSPACE_LIMIT', 'DEMO workspace kapasitesi dolu');
    workspaces.set(id, createWorkspace(id));
  }
  const workspace = workspaces.get(id);
  workspace.lastSeenAt = Date.now();
  return workspace;
}

function accountForAssignment(workspace, assignmentId) {
  for (const account of workspace.accounts.values()) {
    if (account.assignmentId === assignmentId) return account;
  }
  return null;
}

function findAccount(workspace, accountId) {
  if (typeof accountId !== 'string' || accountId.trim() === '') error(400, 'ACCOUNT_REQUIRED', 'accountId zorunludur');
  const account = workspace.accounts.get(accountId);
  if (!account) error(404, 'ACCOUNT_NOT_FOUND', 'Demo hesap bulunamadı');
  return account;
}

function canAccessAccount(actor, account) {
  return isAuthorizedForStation(actor, account.assignment);
}

function requireAccountAccess(actor, workspace, accountId) {
  const account = findAccount(workspace, accountId);
  if (!canAccessAccount(actor, account)) error(403, 'ACCOUNT_SCOPE_DENIED', 'Bu DEMO hesap aktörün kapsamı dışındadır');
  return account;
}

function checkExpectedRevision(account, payload, { required = false } = {}) {
  const has = Object.prototype.hasOwnProperty.call(payload, 'expectedRevision');
  if (required && !has) error(400, 'EXPECTED_REVISION_REQUIRED', 'expectedRevision zorunludur');
  if (!has) return;
  if (!Number.isInteger(payload.expectedRevision) || payload.expectedRevision < 1) {
    error(400, 'EXPECTED_REVISION_INVALID', 'expectedRevision pozitif tamsayı olmalıdır');
  }
  if (payload.expectedRevision !== account.revision) {
    error(409, 'STALE_REVISION', 'Hesap revision değeri güncel değil');
  }
}

function actorHeaderOrDefault(req, fallback = 'ay') {
  const value = Array.isArray(req.headers['x-demo-actor']) ? req.headers['x-demo-actor'][0] : req.headers['x-demo-actor'];
  const id = value === undefined ? fallback : value;
  if (typeof id !== 'string' || !ACTOR_MAP.has(id.trim())) error(401, 'DEMO_ACTOR_REQUIRED', 'X-Demo-Actor ile geçerli DEMO aktörü seçilmelidir');
  return ACTOR_MAP.get(id.trim());
}

function assertMutableAccount(account) {
  if (!['OPEN', 'NEEDS_INFO'].includes(account.status)) error(409, 'ACCOUNT_LOCKED', 'Gönderilmiş veya kabul edilmiş hesap düzenlenemez');
}

function assertOpenAccount(account) {
  if (account.status !== 'OPEN') error(409, 'ACCOUNT_NOT_OPEN', 'Bu işlem için hesap OPEN olmalıdır');
}

function addAudit(workspace, actor, action, accountId, revision, message) {
  workspace.audit.push({
    at: new Date().toISOString(),
    actorId: actor.id,
    action,
    accountId: accountId ?? null,
    revision,
    message: String(message).slice(0, 500),
  });
}

function declarationMinor(account, kind) {
  return account.declarations
    .filter((declaration) => declaration.kind === kind)
    .reduce((sum, declaration) => sum + declaration.amountMinor, 0n);
}

function makeSyntheticEvidence({ id, scenario }) {
  const common = {
    evidenceId: id,
    companyId: 'DEMO-COMPANY',
    merchantId: 'DEMO-MERCHANT',
    terminalId: 'pc-1',
    transactionDate: '2026-10-10',
    sensitiveMaskState: 'MASKED',
    contentSha256: sha256(`demo-evidence:${scenario === 'DUPLICATE' ? 'SALE_3500' : scenario}`),
    rrn: null,
    confidence: {
      amount: 0.99, currency: 0.99, documentType: 0.99,
      transactionDate: 0.99, terminal: 0.99, rrn: 0.99,
    },
    documentType: 'sale',
    currencyCode: 'TRY',
    amount: '3500.00',
  };
  if (scenario === 'SALE_3500') return createEvidence({ ...common, rrn: 'DEMO-RRN-3500', amount: '3500.00' });
  if (scenario === 'SALE_2500') return createEvidence({ ...common, rrn: 'DEMO-RRN-2500', amount: '2500.00' });
  if (scenario === 'DUPLICATE') return createEvidence({ ...common, rrn: 'DEMO-RRN-3500', amount: '3500.00' });
  if (scenario === 'LOW_CONFIDENCE') {
    return createEvidence({
      ...common, rrn: 'DEMO-RRN-LOW', amount: '1250.00',
      confidence: { ...common.confidence, amount: 0.6 },
    });
  }
  if (scenario === 'REPORT') {
    return createEvidence({
      ...common, rrn: 'DEMO-RRN-REPORT', amount: '5000.00', documentType: 'report',
    });
  }
  if (scenario === 'UNSAFE') {
    return createEvidence({
      ...common, rrn: 'DEMO-RRN-UNSAFE', amount: '3500.00', sensitiveMaskState: 'UNSAFE',
    });
  }
  error(400, 'SCENARIO_INVALID', 'Slip scenario değeri geçersiz');
}

function evidenceReasons(evidence, scenario, duplicate = false) {
  if (duplicate) return ['EXACT_CONTENT_REPEAT'];
  if (scenario === 'REPORT') return ['DOCUMENT_NOT_SALE_SLIP'];
  if (scenario === 'UNSAFE') return ['SENSITIVE_IMAGE_BLOCKED'];
  if (scenario === 'LOW_CONFIDENCE') return ['LOW_CONFIDENCE_AMOUNT'];
  return [];
}

function createSlip(scenario) {
  const id = randomId('slip');
  const evidence = makeSyntheticEvidence({ id, scenario });
  const duplicate = scenario === 'DUPLICATE';
  const blocked = duplicate;
  let status = 'PENDING_REVIEW';
  if (blocked) status = 'REJECTED';
  else if (scenario === 'REPORT' || scenario === 'UNSAFE' || scenario === 'LOW_CONFIDENCE') status = 'REVIEW_REQUIRED';
  const amountMinor = evidence.document.amountMinor;
  return {
    id,
    scenario,
    evidence,
    status,
    amountMinor,
    currencyCode: evidence.document.currencyCode,
    documentType: evidence.document.documentType,
    rrn: evidence.rrn,
    confidence: evidence.document.confidence?.amount ?? 0,
    reasons: evidenceReasons(evidence, scenario, duplicate),
    reviewVersion: 0,
    originalAmountMinor: amountMinor,
    originalEvidence: evidence,
  };
}

function slipOutput(slip) {
  return {
    id: slip.id,
    scenario: slip.scenario,
    amount: decimalString(slip.amountMinor),
    currencyCode: slip.currencyCode,
    documentType: slip.documentType,
    rrn: slip.rrn,
    status: slip.status,
    confidence: slip.confidence,
    reasons: [...slip.reasons],
    reviewVersion: slip.reviewVersion,
  };
}

function accountSummary(account) {
  const cashSalesMinor = declarationMinor(account, 'CASH');
  const ibanMinor = declarationMinor(account, 'IBAN');
  const debtMinor = declarationMinor(account, 'DEBT');
  const oldCollectionMinor = declarationMinor(account, 'AR_COLLECTION');
  let verifiedCardMinor = 0n;
  const verifiedEvidence = account.slips.filter((slip) => slip.status === 'VERIFIED').map((slip) => slip.evidence);
  if (verifiedEvidence.length > 0) {
    try {
      verifiedCardMinor = aggregateVerifiedEvidence(verifiedEvidence).totalMinor;
    } catch {
      verifiedCardMinor = 0n;
    }
  }
  const sourceTotalMinor = BigInt(account.assignment.sourceTotalMinor);
  const sourceCardMinor = BigInt(account.assignment.sourceCardMinor);
  const paymentTotalMinor = cashSalesMinor + verifiedCardMinor + ibanMinor + debtMinor;
  const paymentDifferenceMinor = sourceTotalMinor - paymentTotalMinor;
  const expectedCashMinor = account.openingFloatMinor + cashSalesMinor + oldCollectionMinor;
  const countedCashMinor = account.countedCashMinor;
  const cashDifferenceMinor = countedCashMinor === null ? null : countedCashMinor - expectedCashMinor;
  const deliverableCashMinor = countedCashMinor === null ? null : countedCashMinor - account.openingFloatMinor;
  const pendingSlipCount = account.slips.filter((slip) => ['PENDING_REVIEW', 'REVIEW_REQUIRED'].includes(slip.status)).length;
  return {
    cashSalesMinor: minorString(cashSalesMinor),
    ibanMinor: minorString(ibanMinor),
    debtMinor: minorString(debtMinor),
    oldCollectionMinor: minorString(oldCollectionMinor),
    verifiedCardMinor: minorString(verifiedCardMinor),
    sourceTotalMinor: minorString(sourceTotalMinor),
    sourceCardMinor: minorString(sourceCardMinor),
    paymentTotalMinor: minorString(paymentTotalMinor),
    paymentDifferenceMinor: minorString(paymentDifferenceMinor),
    expectedCashMinor: minorString(expectedCashMinor),
    countedCashMinor: countedCashMinor === null ? null : minorString(countedCashMinor),
    cashDifferenceMinor: cashDifferenceMinor === null ? null : minorString(cashDifferenceMinor),
    deliverableCashMinor: deliverableCashMinor === null ? null : minorString(deliverableCashMinor),
    pendingSlipCount,
    pendingIban: ibanMinor > 0n,
  };
}

function accountOutput(account) {
  return {
    id: account.id,
    employeeId: account.employeeId,
    employeeName: account.employeeName,
    status: account.status,
    revision: account.revision,
    snapshotHash: account.snapshotHash,
    sourceTotalMinor: account.assignment.sourceTotalMinor,
    sourceCardMinor: account.assignment.sourceCardMinor,
    openingFloatMinor: minorString(account.openingFloatMinor),
    declarations: account.declarations.map((declaration) => ({
      id: declaration.id,
      kind: declaration.kind,
      amountMinor: minorString(declaration.amountMinor),
      sourceRef: declaration.sourceRef,
    })),
    slips: account.slips.map(slipOutput),
    summary: accountSummary(account),
    cashHandover: account.cashHandover ? { ...account.cashHandover } : null,
    approvals: account.approvals.map((approval) => ({ ...approval })),
    reviewNote: account.reviewNote,
    lastSubmittedRevision: account.lastSubmittedRevision,
  };
}

function assignmentOutput(assignment) {
  return {
    id: assignment.id,
    employeeId: assignment.employeeId,
    employeeName: assignment.employeeName,
    stationName: assignment.stationName,
    companyName: assignment.companyName,
    domain: assignment.domain,
    shiftLabel: assignment.shiftLabel,
    sourceTotalMinor: assignment.sourceTotalMinor,
    sourceCardMinor: assignment.sourceCardMinor,
  };
}

function projection(workspace, actor = null) {
  const visibleAssignments = actor && isEmployee(actor)
    ? STATIC_ASSIGNMENTS.filter((assignment) => assignment.employeeId === actor.id)
    : STATIC_ASSIGNMENTS;
  const visibleAccounts = [...workspace.accounts.values()].filter((account) => !actor || canAccessAccount(actor, account));
  const visibleAccountIds = new Set(visibleAccounts.map((account) => account.id));
  const visibleAudit = workspace.audit.filter((item) => !actor || !isEmployee(actor) || item.accountId === null || visibleAccountIds.has(item.accountId));
  const visibleTerminals = [...workspace.terminals.values()]
    .filter((terminal) => !actor || !isEmployee(actor) || terminal.actorId === actor.id)
    .map((terminal) => ({ id: terminal.id, actorId: terminal.actorId }));
  return {
    actors: DEMO_ACTORS.map((item) => ({ id: item.id, name: item.name, role: item.role })),
    assignments: visibleAssignments.map(assignmentOutput),
    accounts: visibleAccounts.map(accountOutput),
    terminals: visibleTerminals,
    audit: visibleAudit.map((item) => ({ ...item })),
  };
}

function snapshotData(account) {
  return {
    id: account.id,
    assignmentId: account.assignmentId,
    employeeId: account.employeeId,
    revision: account.revision,
    openingFloatMinor: minorString(account.openingFloatMinor),
    declarations: account.declarations.map((declaration) => ({
      id: declaration.id,
      kind: declaration.kind,
      amountMinor: minorString(declaration.amountMinor),
      sourceRef: declaration.sourceRef,
    })),
    slips: account.slips.map(slipOutput),
    summary: accountSummary(account),
  };
}

function computeSnapshotHash(account) {
  return sha256(canonicalize(snapshotData(account)));
}

function createAccount(assignment, floatMinor) {
  return {
    id: randomId('account'),
    assignmentId: assignment.id,
    assignment,
    employeeId: assignment.employeeId,
    employeeName: assignment.employeeName,
    status: 'OPEN',
    revision: 1,
    snapshotHash: null,
    openingFloatMinor: floatMinor,
    declarations: [],
    slips: [],
    countedCashMinor: null,
    cashHandover: null,
    approvals: [],
    reviewNote: '',
    lastSubmittedRevision: null,
    currentSubmittedHash: null,
  };
}

function payloadHash(type, accountId, payload, expectedRevision) {
  return sha256(canonicalize({ type, accountId: accountId ?? null, expectedRevision: expectedRevision ?? null, payload }));
}

function idempotencyScope(actor, type, accountId, key) {
  return canonicalize([actor.id, type, accountId ?? '', key]);
}

function getCached(workspace, actor, type, accountId, key, hash) {
  const cacheKey = idempotencyScope(actor, type, accountId, key);
  const prior = workspace.idempotency.get(cacheKey);
  if (!prior) return null;
  if (prior.payloadHash !== hash) error(409, 'IDEMPOTENCY_CONFLICT', 'Aynı idempotencyKey farklı payload ile kullanıldı');
  return cloneJson(prior.response);
}

function cacheResponse(workspace, actor, type, accountId, key, hash, response) {
  workspace.idempotency.set(idempotencyScope(actor, type, accountId, key), {
    payloadHash: hash,
    response: cloneJson(response),
  });
  return response;
}

function requirePayloadObject(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) error(400, 'JSON_OBJECT_REQUIRED', 'JSON gövdesi nesne olmalıdır');
  if (!body.payload || typeof body.payload !== 'object' || Array.isArray(body.payload)) error(400, 'PAYLOAD_REQUIRED', 'payload nesnesi zorunludur');
  return body.payload;
}

function requireNoPolicy(payload) {
  if (Object.prototype.hasOwnProperty.call(payload, 'policy')) error(400, 'POLICY_BODY_NOT_ACCEPTED', 'Onay policy gövdeden kabul edilmez');
}

function makeResponse(workspace, actor, result) {
  return { state: projection(workspace, actor), result };
}

function actionAccountId(body) {
  return typeof body.accountId === 'string' ? body.accountId : null;
}

function openAccount(workspace, actor, body, payload) {
  if (!isEmployee(actor)) error(403, 'ROLE_DENIED', 'Hesap açılışını yalnız DEMO personel yapabilir');
  const assignmentId = requiredText(payload.assignmentId, 'assignmentId', { min: 1, max: 128 });
  const assignment = ASSIGNMENT_MAP.get(assignmentId);
  if (!assignment || assignment.employeeId !== actor.id) error(403, 'ASSIGNMENT_SCOPE_DENIED', 'Atama aktörün kapsamı dışındadır');
  const existing = accountForAssignment(workspace, assignmentId);
  const scopeId = assignmentId;
  const key = actionKey(body.idempotencyKey);
  const hash = payloadHash(body.type, scopeId, payload, body.expectedRevision);
  const cached = getCached(workspace, actor, body.type, scopeId, key, hash);
  if (cached) return cached;
  if (existing) {
    const response = makeResponse(workspace, actor, { accountId: existing.id, assignmentId, duplicate: true });
    return cacheResponse(workspace, actor, body.type, scopeId, key, hash, response);
  }
  const floatMinor = parseMoney(payload.float, 'payload.float');
  const account = createAccount(assignment, floatMinor);
  workspace.accounts.set(account.id, account);
  addAudit(workspace, actor, 'OPEN_ACCOUNT', account.id, account.revision, 'DEMO hesabı açıldı; kaynak ilişkilendirmesi DEMO statiktir');
  const response = makeResponse(workspace, actor, { accountId: account.id, assignmentId, duplicate: false });
  return cacheResponse(workspace, actor, body.type, scopeId, key, hash, response);
}

function mutateAccount(workspace, actor, body, payload, handler) {
  const accountId = actionAccountId(body);
  const account = requireAccountAccess(actor, workspace, accountId);
  const key = actionKey(body.idempotencyKey);
  const hash = payloadHash(body.type, account.id, payload, body.expectedRevision);
  const cached = getCached(workspace, actor, body.type, account.id, key, hash);
  if (cached) return cached;
  checkExpectedRevision(account, body);
  const responseResult = handler(account);
  const response = makeResponse(workspace, actor, responseResult);
  return cacheResponse(workspace, actor, body.type, account.id, key, hash, response);
}

function addDeclarationAction(workspace, actor, body, payload) {
  return mutateAccount(workspace, actor, body, payload, (account) => {
    assertMutableAccount(account);
    assertOpenAccount(account);
    checkExpectedRevision(account, payload);
    const kind = requiredText(payload.kind, 'payload.kind', { min: 1, max: 32 });
    if (!['CASH', 'IBAN', 'DEBT', 'AR_COLLECTION'].includes(kind)) error(400, 'DECLARATION_KIND_INVALID', 'Beyan türü geçersiz');
    const sourceRef = requiredText(payload.sourceRef, 'payload.sourceRef', { min: 3, max: 60 });
    if (/[[\]{}<>\x00-\x1f]/.test(sourceRef)) error(400, 'SOURCE_REF_INVALID', 'sourceRef yalnız güvenli metin olabilir');
    if (account.declarations.some((item) => item.kind === kind && item.sourceRef === sourceRef)) {
      error(409, 'DUPLICATE_SOURCE_REF', 'Aynı tür ve sourceRef daha önce beyan edildi');
    }
    const amountMinor = parseMoney(payload.amount, 'payload.amount');
    if (amountMinor <= 0n) error(400, 'AMOUNT_MUST_BE_POSITIVE', 'Ödeme beyanı pozitif olmalıdır');
    const declaration = { id: randomId('decl'), kind, amountMinor, sourceRef };
    account.declarations.push(declaration);
    account.revision += 1;
    addAudit(workspace, actor, 'ADD_DECLARATION', account.id, account.revision, `DEMO ${kind} beyanı eklendi`);
    return { accountId: account.id, declarationId: declaration.id, revision: account.revision };
  });
}

function addSlipAction(workspace, actor, body, payload) {
  return mutateAccount(workspace, actor, body, payload, (account) => {
    assertMutableAccount(account);
    assertOpenAccount(account);
    checkExpectedRevision(account, payload);
    const scenario = requiredText(payload.scenario, 'payload.scenario', { min: 1, max: 40 });
    if (!['SALE_3500', 'SALE_2500', 'DUPLICATE', 'LOW_CONFIDENCE', 'REPORT', 'UNSAFE'].includes(scenario)) {
      error(400, 'SCENARIO_INVALID', 'Slip scenario değeri geçersiz');
    }
    const slip = createSlip(scenario);
    if (account.slips.some((item) => item.status !== 'REJECTED' && item.evidence.contentSha256 === slip.evidence.contentSha256)) {
      slip.reasons = ['EXACT_CONTENT_REPEAT'];
      slip.status = 'REJECTED';
    }
    account.slips.push(slip);
    account.revision += 1;
    addAudit(workspace, actor, 'ADD_SLIP', account.id, account.revision, `DEMO ${scenario} sentetik kanıt adayı eklendi`);
    return { accountId: account.id, slipId: slip.id, status: slip.status, revision: account.revision };
  });
}

function findSlip(account, slipId) {
  if (typeof slipId !== 'string' || slipId.trim() === '') error(400, 'SLIP_REQUIRED', 'slipId zorunludur');
  const slip = account.slips.find((item) => item.id === slipId);
  if (!slip) error(404, 'SLIP_NOT_FOUND', 'Slip bulunamadı');
  return slip;
}

function reviewSlipAction(workspace, actor, body, payload) {
  return mutateAccount(workspace, actor, body, payload, (account) => {
    assertMutableAccount(account);
    assertOpenAccount(account);
    checkExpectedRevision(account, payload);
    const slip = findSlip(account, payload.slipId);
    const decision = requiredText(payload.action, 'payload.action', { min: 1, max: 16 });
    if (!['VERIFY', 'REJECT'].includes(decision)) error(400, 'REVIEW_ACTION_INVALID', 'Review action VERIFY veya REJECT olmalıdır');
    if (!['PENDING_REVIEW', 'REVIEW_REQUIRED'].includes(slip.status)) error(409, 'SLIP_NOT_REVIEWABLE', 'Slip zaten sonuçlandırılmıştır');
    if (decision === 'REJECT') {
      const reason = reasonText(payload.reason);
      slip.status = 'REJECTED';
      slip.reasons = [...new Set([...slip.reasons, 'USER_REJECTED'])];
      slip.reviewVersion += 1;
      account.reviewNote = reason;
      account.revision += 1;
      addAudit(workspace, actor, 'REVIEW_SLIP', account.id, account.revision, `Slip reddedildi: ${slip.scenario}`);
      return { accountId: account.id, slipId: slip.id, status: slip.status, revision: account.revision };
    }
    if (['DUPLICATE', 'REPORT', 'UNSAFE'].includes(slip.scenario)) {
      error(409, 'REVIEW_BLOCKED', 'Bu sentetik kanıt VERIFY edilemez; dışarıda tutulmalıdır');
    }
    let reason = null;
    if (slip.scenario === 'LOW_CONFIDENCE') reason = reasonText(payload.reason);
    const correctionProvided = Object.prototype.hasOwnProperty.call(payload, 'amount');
    let correctedAmount = slip.amountMinor;
    if (correctionProvided) correctedAmount = parseMoney(payload.amount, 'payload.amount');
    if (correctedAmount <= 0n) error(400, 'AMOUNT_MUST_BE_POSITIVE', 'Teyit edilen slip tutarı pozitif olmalıdır');
    if (slip.scenario !== 'LOW_CONFIDENCE' && correctedAmount !== slip.amountMinor) {
      error(409, 'CORRECTION_REVIEW_REQUIRED', 'Bu hazır kaynak slipinde farklı tutar sessizce uygulanamaz');
    }
    if (slip.scenario === 'LOW_CONFIDENCE') {
      const original = slip.amountMinor;
      slip.amountMinor = correctedAmount;
      slip.confidence = 0.99;
      slip.evidence = createEvidence({
        evidenceId: slip.id,
        companyId: 'DEMO-COMPANY', merchantId: 'DEMO-MERCHANT', terminalId: 'pc-1',
        transactionDate: '2026-10-10', rrn: slip.rrn, sensitiveMaskState: 'MASKED',
        contentSha256: slip.originalEvidence.contentSha256,
        documentType: 'sale',
        currencyCode: 'TRY',
        amount: decimalString(correctedAmount),
        confidence: { amount: 0.99, currency: 0.99, documentType: 0.99,
          transactionDate: 0.99, terminal: 0.99, rrn: 0.99 },
      });
      slip.evidence = appendEvidenceReview(slip.evidence, {
        reviewId: randomId('review'), reviewerUserId: actor.id, action: 'VERIFY',
      });
      slip.documentType = 'sale';
      slip.currencyCode = 'TRY';
      slip.reasons = [];
      slip.status = 'VERIFIED';
      slip.reviewVersion += 1;
      account.reviewNote = reason ?? '';
      account.revision += 1;
      addAudit(workspace, actor, 'REVIEW_SLIP', account.id, account.revision,
        `Düşük güvenli slip insan teyidiyle düzeltildi; originalMinor=${String(original)} correctedMinor=${String(correctedAmount)}`);
      return { accountId: account.id, slipId: slip.id, status: slip.status, revision: account.revision, corrected: true };
    }
    try {
      slip.evidence = appendEvidenceReview(slip.evidence, {
        reviewId: randomId('review'), reviewerUserId: actor.id, action: 'VERIFY',
      });
    } catch (caught) {
      if (caught instanceof DomainError) error(409, caught.code, caught.message);
      throw caught;
    }
    slip.status = 'VERIFIED';
    slip.reasons = [];
    slip.reviewVersion += 1;
    account.revision += 1;
    addAudit(workspace, actor, 'REVIEW_SLIP', account.id, account.revision, `Slip doğrulandı: ${slip.scenario}`);
    return { accountId: account.id, slipId: slip.id, status: slip.status, revision: account.revision };
  });
}

function countCashAction(workspace, actor, body, payload) {
  return mutateAccount(workspace, actor, body, payload, (account) => {
    assertMutableAccount(account);
    assertOpenAccount(account);
    checkExpectedRevision(account, payload);
    account.countedCashMinor = parseMoney(payload.amount, 'payload.amount');
    account.revision += 1;
    addAudit(workspace, actor, 'COUNT_CASH', account.id, account.revision, 'DEMO kapanış nakit sayımı kaydedildi');
    return { accountId: account.id, countedCashMinor: minorString(account.countedCashMinor), revision: account.revision };
  });
}

function loadSampleAction(workspace, actor, body, payload) {
  return mutateAccount(workspace, actor, body, payload, (account) => {
    assertMutableAccount(account);
    assertOpenAccount(account);
    checkExpectedRevision(account, payload);
    if (account.declarations.length > 0 || account.slips.length > 0 || account.countedCashMinor !== null) {
      error(409, 'SAMPLE_NOT_EMPTY', 'Örnek yalnız boş DEMO hesapta yüklenebilir');
    }
    if (account.employeeId === 'ay') {
      const sampleDeclarations = [
        ['CASH', '3000.00', 'DEMO-SOURCE-CASH-AY'],
        ['IBAN', '700.00', 'DEMO-SOURCE-IBAN-AY'],
        ['DEBT', '300.00', 'DEMO-SOURCE-DEBT-AY'],
        ['AR_COLLECTION', '500.00', 'DEMO-SOURCE-OLD-AY'],
      ];
      for (const [kind, amount, sourceRef] of sampleDeclarations) {
        account.declarations.push({ id: randomId('decl'), kind, amountMinor: parseMoney(amount), sourceRef });
      }
      account.slips.push(createSlip('SALE_3500'), createSlip('SALE_2500'));
      account.countedCashMinor = account.openingFloatMinor + 350000n;
    } else {
      account.declarations.push({ id: randomId('decl'), kind: 'CASH', amountMinor: parseMoney('5000.00'), sourceRef: 'DEMO-SOURCE-CASH-CAN' });
      account.countedCashMinor = account.openingFloatMinor + 500000n;
    }
    account.revision += 1;
    addAudit(workspace, actor, 'LOAD_SAMPLE', account.id, account.revision, 'DEMO sentetik örnek veri yüklendi; gerçek veri değildir');
    return { accountId: account.id, loaded: true, revision: account.revision };
  });
}

function submitAction(workspace, actor, body, payload) {
  return mutateAccount(workspace, actor, body, payload, (account) => {
    if (!isEmployee(actor) || account.employeeId !== actor.id) error(403, 'ACCOUNT_SCOPE_DENIED', 'Teslim yalnız kendi DEMO hesabı için yapılabilir');
    if (account.status !== 'OPEN') error(409, 'SUBMIT_NOT_ALLOWED', 'Yalnız OPEN hesap gönderilebilir');
    checkExpectedRevision(account, body, { required: true });
    const summary = accountSummary(account);
    if (summary.paymentDifferenceMinor !== '0') error(409, 'PAYMENT_DIFFERENCE', 'Ödeme toplamı kaynak toplamına eşit değildir');
    if (summary.verifiedCardMinor !== summary.sourceCardMinor) error(409, 'CARD_SOURCE_DIFFERENCE', 'Teyitli kart slipleri kaynak POS kart tutarıyla eşleşmiyor');
    if (summary.cashDifferenceMinor !== '0') error(409, 'CASH_DIFFERENCE', 'Nakit sayımı beklenen kasa ile eşit değildir');
    if (summary.countedCashMinor === null) error(409, 'CASH_COUNT_REQUIRED', 'Gönderimden önce nakit sayımı gerekir');
    if (summary.pendingSlipCount !== 0) error(409, 'PENDING_SLIP', 'Bekleyen slip review kuyruğu vardır');
    const deliverable = BigInt(summary.deliverableCashMinor);
    if (deliverable < 0n) error(409, 'FLOAT_SHORTAGE', 'Sayım korunacak float tutarının altında');
    if (account.cashHandover?.status === 'DISPUTED') error(409, 'CASH_DISPUTE_OPEN', 'Fizikî alıcı farkı ayrı inceleme gerektirir');
    if (account.cashHandover?.status === 'ACCEPTED' && BigInt(account.cashHandover.receivedMinor) !== deliverable) {
      error(409, 'CASH_TRANSFER_ADJUSTMENT_REQUIRED', 'Önceden alınmış nakit ile yeni teklif farklı; ayrı düzeltme olayı gerekir');
    }
    account.status = 'SUBMITTED';
    account.lastSubmittedRevision = account.revision;
    account.snapshotHash = computeSnapshotHash(account);
    account.currentSubmittedHash = account.snapshotHash;
    if (account.cashHandover?.status !== 'ACCEPTED') {
      account.cashHandover = {
        id: randomId('handover'), status: 'OFFERED', offeredMinor: minorString(deliverable), receivedMinor: null, receiverId: null,
      };
    }
    addAudit(workspace, actor, 'SUBMIT', account.id, account.revision, `Hesap teslim snapshotı gönderildi; hash=${account.snapshotHash}`);
    return { accountId: account.id, status: account.status, snapshotHash: account.snapshotHash, handoverId: account.cashHandover.id };
  });
}

function receiveCashAction(workspace, actor, body, payload) {
  return mutateAccount(workspace, actor, body, payload, (account) => {
    if (actor.role !== 'STATION_MANAGER') error(403, 'ROLE_DENIED', 'Fizikî nakit alımını yalnız DEMO amir yapabilir');
    if (!['SUBMITTED', 'IN_REVIEW'].includes(account.status) || !account.cashHandover || account.cashHandover.status !== 'OFFERED') {
      error(409, 'HANDOVER_NOT_OFFERED', 'OFFERED fizikî nakit teslimi bulunamadı');
    }
    const received = parseMoney(payload.amount, 'payload.amount');
    const reason = received === BigInt(account.cashHandover.offeredMinor) ? null : reasonText(payload.reason);
    account.cashHandover.receivedMinor = minorString(received);
    account.cashHandover.receiverId = actor.id;
    account.cashHandover.status = received === BigInt(account.cashHandover.offeredMinor) ? 'ACCEPTED' : 'DISPUTED';
    addAudit(workspace, actor, 'RECEIVE_CASH', account.id, account.revision,
      reason ? `Fizikî nakit farkla kaydedildi: ${reason}` : 'Fizikî nakit teslimi kabul edildi');
    return { accountId: account.id, status: account.cashHandover.status, receivedMinor: minorString(received) };
  });
}

function approveAction(workspace, actor, body, payload) {
  requireNoPolicy(payload);
  return mutateAccount(workspace, actor, body, payload, (account) => {
    if (!['ACCOUNTANT', 'COMPANY_MANAGER'].includes(actor.role)) error(403, 'ROLE_DENIED', 'Onayı yalnız DEMO muhasebe veya firma yetkilisi verebilir');
    if (!['SUBMITTED', 'IN_REVIEW'].includes(account.status)) error(409, 'APPROVAL_NOT_ALLOWED', 'Hesap onaya açık değil');
    checkExpectedRevision(account, body, { required: true });
    if (typeof payload.snapshotHash !== 'string' || payload.snapshotHash.trim() === '') error(400, 'SNAPSHOT_HASH_REQUIRED', 'snapshotHash zorunludur');
    if (!account.snapshotHash || payload.snapshotHash !== account.snapshotHash || body.expectedRevision !== account.lastSubmittedRevision) {
      error(409, 'STALE_SNAPSHOT', 'Snapshot hash veya revision güncel değil');
    }
    if (!account.cashHandover || account.cashHandover.status !== 'ACCEPTED') error(409, 'CASH_HANDOVER_REQUIRED', 'Önce fizikî nakit teslimi kabul edilmelidir');
    const reason = reasonText(payload.reason);
    if (account.approvals.some((approval) => approval.actorId === actor.id && approval.revision === account.revision && approval.snapshotHash === account.snapshotHash)) {
      error(409, 'DUPLICATE_SIGNATURE', 'Aktör bu snapshotı zaten imzaladı');
    }
    account.approvals.push({ actorId: actor.id, revision: account.revision, snapshotHash: account.snapshotHash, reason });
    const distinct = new Set(account.approvals.filter((item) => item.revision === account.revision && item.snapshotHash === account.snapshotHash).map((item) => item.actorId));
    if (distinct.size < 2) account.status = 'IN_REVIEW';
    else account.status = accountSummary(account).ibanMinor !== '0' ? 'ACCEPTED_WITH_PENDING' : 'ACCEPTED';
    addAudit(workspace, actor, 'APPROVE', account.id, account.revision, `DEMO imza eklendi; status=${account.status}`);
    return { accountId: account.id, status: account.status, approvalCount: distinct.size };
  });
}

function askInfoAction(workspace, actor, body, payload) {
  return mutateAccount(workspace, actor, body, payload, (account) => {
    if (!isReviewActor(actor)) error(403, 'ROLE_DENIED', 'Bilgi isteği review aktörü gerektirir');
    if (!['SUBMITTED', 'IN_REVIEW'].includes(account.status)) error(409, 'INFO_NOT_ALLOWED', 'Bu hesap durumunda bilgi istenemez');
    const reason = reasonText(payload.reason);
    account.reviewNote = reason;
    account.status = 'NEEDS_INFO';
    addAudit(workspace, actor, 'ASK_INFO', account.id, account.revision, `Bilgi istendi: ${reason}`);
    return { accountId: account.id, status: account.status };
  });
}

function reviseAction(workspace, actor, body, payload) {
  return mutateAccount(workspace, actor, body, payload, (account) => {
    if (!isEmployee(actor) || account.employeeId !== actor.id) error(403, 'ACCOUNT_SCOPE_DENIED', 'Revizyon yalnız hesap sahibi DEMO personelce açılabilir');
    if (account.status !== 'NEEDS_INFO') error(409, 'REVISE_NOT_ALLOWED', 'Yalnız NEEDS_INFO hesap revize edilebilir');
    checkExpectedRevision(account, body, { required: true });
    account.revision += 1;
    account.status = 'OPEN';
    account.snapshotHash = null;
    account.currentSubmittedHash = null;
    account.lastSubmittedRevision = account.lastSubmittedRevision;
    addAudit(workspace, actor, 'REVISE', account.id, account.revision, 'Bilgi isteği sonrası yeni hesap revisionı açıldı; eski imzalar korunur');
    return { accountId: account.id, status: account.status, revision: account.revision, priorSubmittedRevision: account.lastSubmittedRevision };
  });
}

function terminalAction(workspace, actor, body, payload, release = false) {
  if (actor.role !== 'STATION_MANAGER') error(403, 'ROLE_DENIED', 'Terminal lease işlemini yalnız DEMO amir yapabilir');
  const terminalId = requiredText(payload.terminalId, 'payload.terminalId', { min: 1, max: 64 });
  if (!TERMINAL_RE.test(terminalId)) error(400, 'TERMINAL_ID_INVALID', 'terminalId sentetik güvenli biçimde olmalıdır');
  const key = actionKey(body.idempotencyKey);
  const hash = payloadHash(body.type, null, payload, body.expectedRevision);
  const cached = getCached(workspace, actor, body.type, null, key, hash);
  if (cached) return cached;
  const current = workspace.terminals.get(terminalId);
  if (release) {
    if (!current) error(404, 'TERMINAL_NOT_FOUND', 'Terminal lease bulunamadı');
    if (current.actorId !== actor.id) error(403, 'TERMINAL_SCOPE_DENIED', 'Terminal lease aktörün kapsamı dışındadır');
    workspace.terminals.delete(terminalId);
    addAudit(workspace, actor, 'RELEASE_TERMINAL', null, 0, `DEMO terminal lease bırakıldı: ${terminalId}`);
    const response = makeResponse(workspace, actor, { terminalId, released: true });
    return cacheResponse(workspace, actor, body.type, null, key, hash, response);
  }
  if (current) {
    if (current.actorId !== actor.id) error(403, 'TERMINAL_SCOPE_DENIED', 'Terminal lease aktörün kapsamı dışındadır');
    const response = makeResponse(workspace, actor, { terminalId, actorId: actor.id, duplicate: true });
    return cacheResponse(workspace, actor, body.type, null, key, hash, response);
  }
  if (workspace.terminals.size >= 5) error(409, 'TERMINAL_LIMIT', 'DEMO workspace en fazla beş masaüstü lease kabul eder');
  workspace.terminals.set(terminalId, { id: terminalId, actorId: actor.id });
  addAudit(workspace, actor, 'LEASE_TERMINAL', null, 0, `DEMO terminal lease alındı: ${terminalId}`);
  const response = makeResponse(workspace, actor, { terminalId, actorId: actor.id, duplicate: false });
  return cacheResponse(workspace, actor, body.type, null, key, hash, response);
}

function resetAction(workspaces, workspace, actor, body, payload) {
  if (actor.role !== 'STATION_MANAGER') error(403, 'ROLE_DENIED', 'RESET yalnız DEMO amir tarafından yapılabilir');
  const key = actionKey(body.idempotencyKey);
  const hash = payloadHash(body.type, null, payload, body.expectedRevision);
  const cached = getCached(workspace, actor, body.type, null, key, hash);
  if (cached) return cached;
  workspace.accounts.clear();
  workspace.terminals.clear();
  workspace.audit.length = 0;
  workspace.idempotency.clear();
  const response = makeResponse(workspace, actor, { reset: true });
  workspace.idempotency.set(idempotencyScope(actor, body.type, null, key), {
    payloadHash: hash,
    response: cloneJson(response),
  });
  return response;
}

function handleAction(workspaces, workspace, actor, body) {
  const type = requiredText(body.type, 'type', { min: 1, max: 40 });
  const payload = requirePayloadObject(body);
  if (['ADD_DECLARATION','ADD_SLIP','REVIEW_SLIP','COUNT_CASH','LOAD_SAMPLE','SUBMIT','REVISE'].includes(type)) {
    const ownAccount = requireAccountAccess(actor, workspace, actionAccountId(body));
    if (!isEmployee(actor) || ownAccount.employeeId !== actor.id) {
      error(403, 'ACCOUNT_OWNER_REQUIRED', 'Yetkili personelin özgün beyanını değiştiremez');
    }
  }
  if (type === 'OPEN_ACCOUNT') return openAccount(workspace, actor, { ...body, type }, payload);
  if (type === 'ADD_DECLARATION') return addDeclarationAction(workspace, actor, { ...body, type }, payload);
  if (type === 'ADD_SLIP') return addSlipAction(workspace, actor, { ...body, type }, payload);
  if (type === 'REVIEW_SLIP') return reviewSlipAction(workspace, actor, { ...body, type }, payload);
  if (type === 'COUNT_CASH') return countCashAction(workspace, actor, { ...body, type }, payload);
  if (type === 'LOAD_SAMPLE') return loadSampleAction(workspace, actor, { ...body, type }, payload);
  if (type === 'SUBMIT') return submitAction(workspace, actor, { ...body, type }, payload);
  if (type === 'RECEIVE_CASH') return receiveCashAction(workspace, actor, { ...body, type }, payload);
  if (type === 'APPROVE') return approveAction(workspace, actor, { ...body, type }, payload);
  if (type === 'ASK_INFO') return askInfoAction(workspace, actor, { ...body, type }, payload);
  if (type === 'REVISE') return reviseAction(workspace, actor, { ...body, type }, payload);
  if (type === 'LEASE_TERMINAL') return terminalAction(workspace, actor, { ...body, type }, payload, false);
  if (type === 'RELEASE_TERMINAL') return terminalAction(workspace, actor, { ...body, type }, payload, true);
  if (type === 'RESET') return resetAction(workspaces, workspace, actor, { ...body, type }, payload);
  error(400, 'ACTION_INVALID', 'Bilinmeyen DEMO action türü');
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let bytes = 0;
    const chunks = [];
    const declared = Number(req.headers['content-length']);
    if (Number.isFinite(declared) && declared > BODY_LIMIT) {
      reject(new ApiError(413, 'BODY_TOO_LARGE', 'JSON gövdesi 16KB sınırını aşamaz'));
      req.resume();
      return;
    }
    const contentType = String(req.headers['content-type'] ?? '').toLowerCase();
    if (contentType.includes('multipart/form-data') || contentType.includes('application/octet-stream')) {
      reject(new ApiError(415, 'BODY_TYPE_NOT_ALLOWED', 'Dosya veya multipart gövde kabul edilmez'));
      req.resume();
      return;
    }
    req.on('data', (chunk) => {
      bytes += chunk.length;
      if (bytes > BODY_LIMIT) {
        reject(new ApiError(413, 'BODY_TOO_LARGE', 'JSON gövdesi 16KB sınırını aşamaz'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (bytes === 0) return resolve({});
      try {
        const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        resolve(parsed);
      } catch {
        reject(new ApiError(400, 'JSON_INVALID', 'Geçerli JSON gövdesi gerekir'));
      }
    });
    req.on('error', (caught) => reject(caught));
  });
}

function sendJson(res, status, body) {
  const text = JSON.stringify(body);
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Length', Buffer.byteLength(text));
  res.end(text);
}

function sendError(res, caught) {
  if (res.headersSent) return;
  const apiError = caught instanceof ApiError
    ? caught
    : new ApiError(500, 'INTERNAL_ERROR', 'Beklenmeyen DEMO sunucu hatası');
  sendJson(res, apiError.status, { error: { code: apiError.code, message: apiError.message } });
}

function staticPath(urlPath) {
  const allowed = new Map([
    ['/', 'index.html'],
    ['/personel/', 'index.html'],
    ['/app.css', 'app.css'],
    ['/app.mjs', 'app.mjs'],
    ['/personel/app.css', 'app.css'],
    ['/personel/app.mjs', 'app.mjs'],
    ['/yonetim.html', 'yonetim.html'],
    ['/manus-routes.json', 'manus-routes.json'],
  ]);
  const file = allowed.get(urlPath);
  if (!file) return null;
  return join(PUBLIC_DIR, file);
}

function sendStatic(res, urlPath) {
  const file = staticPath(urlPath);
  if (!file) return false;
  try {
    const data = readFileSync(file);
    const mime = file.endsWith('.html') ? 'text/html; charset=utf-8'
      : file.endsWith('.css') ? 'text/css; charset=utf-8'
        : file.endsWith('.mjs') ? 'text/javascript; charset=utf-8'
          : 'application/json; charset=utf-8';
    res.statusCode = 200;
    res.setHeader('Content-Type', mime);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Length', data.byteLength);
    res.end(data);
  } catch {
    res.statusCode = 404;
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.end('Not found');
  }
  return true;
}

function handleRequest(workspaces, req, res) {
  try {
    const url = new URL(req.url, 'http://demo.invalid');
    if (req.method === 'GET' && url.pathname === '/health') {
      sendJson(res, 200, { ok: true, demo: true });
      return;
    }
    if (url.pathname.startsWith('/api/')) {
      if (req.method === 'GET' && url.pathname === '/api/demo/state') {
        const workspaceId = workspaceHeader(req);
        const actor = actorFromRequest(req);
        const workspace = getWorkspace(workspaces, workspaceId);
        sendJson(res, 200, { state: projection(workspace, actor) });
        return;
      }
      if (req.method === 'POST' && url.pathname === '/api/demo/bootstrap') {
        readJsonBody(req).then((body) => {
          if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length > 0) {
            error(400, 'BOOTSTRAP_BODY_INVALID', 'bootstrap gövdesi yalnızca {} olabilir');
          }
          const workspace = createOrGetBootstrapWorkspace(workspaces, workspaceHeader(req));
          const actor = actorHeaderOrDefault(req);
          sendJson(res, 200, { workspaceId: workspace.id, actors: DEMO_ACTORS.map((item) => ({ ...item })), state: projection(workspace, actor) });
        }).catch((caught) => sendError(res, caught));
        return;
      }
      if (req.method === 'POST' && url.pathname === '/api/demo/actions') {
        const workspaceId = workspaceHeader(req);
        const actor = actorFromRequest(req);
        const workspace = getWorkspace(workspaces, workspaceId);
        readJsonBody(req).then((body) => {
          if (!body || typeof body !== 'object' || Array.isArray(body)) error(400, 'JSON_OBJECT_REQUIRED', 'JSON gövdesi nesne olmalıdır');
          const response = handleAction(workspaces, workspace, actor, body);
          sendJson(res, 200, response);
        }).catch((caught) => sendError(res, caught));
        return;
      }
      sendJson(res, 404, { error: { code: 'API_NOT_FOUND', message: 'DEMO API yolu bulunamadı' } });
      return;
    }
    if (req.method === 'GET' && sendStatic(res, url.pathname)) return;
    sendJson(res, 404, { error: { code: 'NOT_FOUND', message: 'Kaynak bulunamadı' } });
  } catch (caught) {
    sendError(res, caught);
  }
}

export function createDemoServer() {
  const workspaces = new Map();
  const server = createServer((req, res) => {
    req.setTimeout(10_000);
    handleRequest(workspaces, req, res);
  });
  return server;
}

const invokedDirectly = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (invokedDirectly) {
  const server = createDemoServer();
  const port = Number.parseInt(process.env.PORT ?? '8766', 10);
  server.listen(Number.isInteger(port) && port >= 0 ? port : 8766, '0.0.0.0');
}

// AKARYAKIT V1 v1.9 örnek domain modülü.
// Bilerek pure domain logic içerir: ağ, OCR motoru, DB ve kimlik doğrulama yoktur.

export const DOCUMENT_TYPES = Object.freeze(['sale', 'refund', 'declined', 'report', 'unknown']);
export const SAFE_MASK_STATES = Object.freeze(['MASKED', 'NOT_PRESENT']);
export const RETRYABLE_HTTP_STATUSES = Object.freeze([408, 429]);

const ALLOWED_DOCUMENT_TYPES = new Set(DOCUMENT_TYPES);
const HTTP_RETRYABLE = (status) => status === 408 || status === 429 || (status >= 500 && status <= 599);
const REVIEWABLE_TARGET_STATUSES = new Set(['OPEN', 'IN_REVIEW', 'PENDING_REVIEW', 'PENDING_APPROVAL']);

export class DomainError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'DomainError';
    this.code = code;
    this.details = Object.freeze({ ...details });
  }
}

function freezeDeep(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) freezeDeep(child);
  }
  return value;
}

function requiredText(value, field) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new DomainError('INVALID_INPUT', `${field} zorunludur`, { field });
  }
  return value.trim();
}

function optionalText(value) {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string' || value.trim() === '') return null;
  return value.trim();
}

function isIsoDateOnly(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function requiredIsoDate(value, field) {
  const text = requiredText(value, field);
  if (!isIsoDateOnly(text)) {
    throw new DomainError('INVALID_DATE', `${field} YYYY-AA-GG biçiminde geçerli ISO tarih olmalıdır`, { field });
  }
  return text;
}

function canonicalPart(value) {
  const text = optionalText(value);
  return text === null ? null : text.normalize('NFKC').toUpperCase();
}

function validConfidence(value, field) {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
    throw new DomainError('INVALID_CONFIDENCE', `${field} 0 ile 1 arasında olmalıdır`, { field });
  }
  return value;
}

/**
 * TRY tutarını, floating point veya round kullanmadan kuruş BigInt'e çevirir.
 * Girdi string olmalıdır; virgül, üstel gösterim, üçten fazla ondalık ve işaret kabul edilmez.
 */
export function parseTryDecimalToMinor(value) {
  if (typeof value !== 'string') {
    throw new DomainError('AMOUNT_NOT_STRING', 'TRY tutarı string olmalıdır; float kullanılmaz');
  }
  if (!/^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/.test(value)) {
    throw new DomainError('AMOUNT_FORMAT_INVALID', 'TRY tutarı noktalı ve en çok iki ondalıklı olmalıdır');
  }
  const [whole, fraction = ''] = value.split('.');
  return BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0') || '0');
}

export const parseDecimalToMinor = parseTryDecimalToMinor;

export function minorToTryDecimal(value) {
  if (typeof value !== 'bigint') throw new DomainError('MINOR_NOT_BIGINT', 'minor tutar BigInt olmalıdır');
  const sign = value < 0n ? '-' : '';
  const absolute = value < 0n ? -value : value;
  const whole = absolute / 100n;
  const fraction = String(absolute % 100n).padStart(2, '0');
  return `${sign}${whole}.${fraction}`;
}

export function canonicalDuplicateKey({ companyId, merchantId, terminalId, transactionDate, rrn }) {
  const parts = [companyId, merchantId, terminalId, requiredIsoDate(transactionDate, 'transactionDate'), rrn]
    .map(canonicalPart);
  // RRN yoksa ∅ ile gruplama yapılmaz; manuel eşleme/review gerekir.
  if (parts.some((part) => part === null)) return null;
  return parts.join('|');
}

function normalizeDocumentType(value) {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : 'unknown';
  return ALLOWED_DOCUMENT_TYPES.has(normalized) ? normalized : 'unknown';
}

/** OCR motorundan yalnız allow-list edilmiş, ham metinsiz alanları alır. */
export function normalizeOcrDocument(input = {}) {
  const documentType = normalizeDocumentType(input.documentType);
  const rawCurrency = optionalText(input.currencyCode)?.toUpperCase() ?? null;
  // Eksik/bilinmeyen para birimi TRY varsayılmaz; güvenli değer null'dur.
  const currencyCode = rawCurrency === 'TRY' ? 'TRY' : null;
  let amountMinor = null;
  if (input.amount !== undefined && input.amount !== null && input.amount !== '') {
    // Geçerli biçim olmayan her tutar, currency bilinmese bile sessizce yutulmaz.
    const parsed = parseTryDecimalToMinor(input.amount);
    if (currencyCode === 'TRY') amountMinor = parsed;
  }
  const confidence = {
    amount: validConfidence(input.confidence?.amount, 'amount confidence'),
    currency: validConfidence(input.confidence?.currency, 'currency confidence'),
    documentType: validConfidence(input.confidence?.documentType, 'document type confidence'),
    transactionDate: validConfidence(input.confidence?.transactionDate, 'transaction date confidence'),
    terminal: validConfidence(input.confidence?.terminal, 'terminal confidence'),
    rrn: validConfidence(input.confidence?.rrn, 'RRN confidence'),
  };
  const safeFields = {
    documentType,
    amountMinor,
    currencyCode,
    transactionDate: optionalText(input.transactionDate),
    terminalId: optionalText(input.terminalId),
    rrn: optionalText(input.rrn),
    merchantId: optionalText(input.merchantId),
    confidence,
  };
  // rawText intentionally is not copied. It must not enter logs, domain events or reviews.
  return freezeDeep(safeFields);
}

function isSafeMaskState(state) {
  return SAFE_MASK_STATES.includes(state);
}

export function evaluateOcrDocument(document, { minimumConfidence = 0.95 } = {}) {
  if (!document || typeof document !== 'object') throw new DomainError('INVALID_DOCUMENT', 'OCR belgesi nesne olmalıdır');
  const reasons = [];
  if (!isSafeMaskState(document.sensitiveMaskState)) {
    reasons.push(document.sensitiveMaskState === 'UNSAFE' ? 'SENSITIVE_IMAGE_BLOCKED' : 'MASK_STATE_REQUIRED');
  }
  if (!['sale', 'refund'].includes(document.documentType)) reasons.push('DOCUMENT_NOT_SALE_SLIP');
  if (document.currencyCode !== 'TRY' || typeof document.amountMinor !== 'bigint' || document.amountMinor <= 0n) {
    reasons.push('UNKNOWN_OR_INVALID_MONEY');
  }
  const amountConfidence = document.confidence?.amount;
  if (amountConfidence === null || amountConfidence === undefined || amountConfidence < minimumConfidence) {
    reasons.push('LOW_CONFIDENCE_AMOUNT');
  }
  const currencyConfidence = document.confidence?.currency;
  if (currencyConfidence === null || currencyConfidence === undefined || currencyConfidence < minimumConfidence) {
    reasons.push('LOW_CONFIDENCE_CURRENCY');
  }
  if (!isIsoDateOnly(document.transactionDate)) reasons.push('INVALID_TRANSACTION_DATE');
  if (optionalText(document.merchantId) === null || optionalText(document.terminalId) === null) {
    reasons.push('MISSING_SOURCE_FIELDS');
  }
  if (optionalText(document.rrn) === null) reasons.push('RRN_MANUAL_MAPPING_REQUIRED');
  const keyConfidence = [document.confidence?.documentType, document.confidence?.transactionDate, document.confidence?.terminal, document.confidence?.rrn];
  if (keyConfidence.some((value) => value === null || value === undefined || value < minimumConfidence)) {
    reasons.push('LOW_CONFIDENCE_SOURCE_FIELDS');
  }
  return freezeDeep({
    eligibleForVerification: reasons.length === 0,
    reviewRequired: reasons.length > 0,
    reasons,
    createsSale: false,
    createsCash: false,
    createsAr: false,
  });
}

function contentHash(value) {
  const normalized = requiredText(value, 'contentSha256').toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(normalized)) throw new DomainError('HASH_INVALID', 'contentSha256 64 hex karakter olmalıdır');
  return normalized;
}

function payloadHash(value) {
  const normalized = requiredText(value, 'payloadHash').toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(normalized)) throw new DomainError('HASH_INVALID', 'payloadHash 64 hex karakter olmalıdır');
  return normalized;
}

export function createEvidence(input = {}) {
  const evidenceId = requiredText(input.evidenceId, 'evidenceId');
  const companyId = requiredText(input.companyId, 'companyId');
  const merchantId = requiredText(input.merchantId, 'merchantId');
  const terminalId = requiredText(input.terminalId, 'terminalId');
  const transactionDate = requiredIsoDate(input.transactionDate, 'transactionDate');
  const rrn = optionalText(input.rrn);
  const linkedOriginalEvidenceId = optionalText(input.linkedOriginalEvidenceId);
  const normalizedDocument = normalizeOcrDocument({
    ...input,
    merchantId,
    terminalId,
    transactionDate,
    rrn,
    confidence: input.confidence,
  });
  const document = {
    ...normalizedDocument,
    sensitiveMaskState: input.sensitiveMaskState,
  };
  const canonicalKey = canonicalDuplicateKey({ companyId, merchantId, terminalId, transactionDate, rrn });
  return freezeDeep({
    evidenceId,
    companyId,
    merchantId,
    terminalId,
    transactionDate,
    rrn,
    linkedOriginalEvidenceId,
    // authCode is deliberately not in canonicalKey. It is not a source uniqueness boundary.
    authCode: optionalText(input.authCode),
    contentSha256: contentHash(input.contentSha256),
    document,
    canonicalKey,
    status: 'PENDING_REVIEW',
    reviewVersion: 0,
    reviews: [],
  });
}

export function classifyEvidenceDuplicate(candidate, existingEvidence = []) {
  const hashMatches = existingEvidence.filter((item) => item?.contentSha256 === candidate?.contentSha256);
  if (hashMatches.length > 0) {
    const differentCanonical = hashMatches.some((item) => item.canonicalKey !== candidate.canonicalKey);
    return freezeDeep({
      kind: differentCanonical ? 'EXACT_CONTENT_DIFFERENT_CANONICAL_REVIEW' : 'EXACT_CONTENT_REPEAT',
      reviewRequired: true,
      matches: hashMatches.map((item) => item.evidenceId),
    });
  }
  if (candidate?.canonicalKey === null || candidate?.canonicalKey === undefined) {
    return freezeDeep({ kind: 'MANUAL_MAPPING_REVIEW', reviewRequired: true, matches: [] });
  }
  const matches = existingEvidence.filter((item) => item?.canonicalKey === candidate.canonicalKey);
  if (matches.length > 0) {
    // Aynı canonical kaynak için meşru bir çakışma olabileceğinden otomatik düşüm yapılmaz.
    return freezeDeep({ kind: 'LEGITIMATE_COLLISION_REVIEW', reviewRequired: true, matches: matches.map((item) => item.evidenceId) });
  }
  return freezeDeep({ kind: 'NONE', reviewRequired: false, matches: [] });
}

/** Evidence immutable'dır. Bu fonksiyon update/delete yapmaz; yeni immutable review sürümü döndürür. */
export function appendEvidenceReview(evidence, { reviewId, reviewerUserId, action, reason = null } = {}) {
  if (!evidence || !Array.isArray(evidence.reviews)) throw new DomainError('INVALID_EVIDENCE', 'Geçersiz evidence');
  const id = requiredText(reviewId, 'reviewId');
  const reviewer = requiredText(reviewerUserId, 'reviewerUserId');
  if (!['VERIFY', 'REJECT'].includes(action)) throw new DomainError('REVIEW_ACTION_INVALID', 'Review VERIFY veya REJECT olmalıdır');
  const decision = evaluateOcrDocument(evidence.document);
  if (action === 'VERIFY' && !decision.eligibleForVerification) {
    throw new DomainError('REVIEW_BLOCKED', 'Belge doğrulamaya uygun değil', { reasons: decision.reasons });
  }
  if (action === 'REJECT' && optionalText(reason) === null) throw new DomainError('REVIEW_REASON_REQUIRED', 'Ret gerekçesi zorunludur');
  const review = {
    reviewId: id,
    reviewerUserId: reviewer,
    action,
    reason: optionalText(reason),
    reviewVersion: evidence.reviewVersion + 1,
  };
  return freezeDeep({
    ...evidence,
    status: action === 'VERIFY' ? 'VERIFIED' : 'REJECTED',
    reviewVersion: evidence.reviewVersion + 1,
    reviews: [...evidence.reviews, review],
  });
}

export const reviewEvidence = appendEvidenceReview;

function sameEvidenceScope(left, right) {
  return left?.companyId === right?.companyId &&
    left?.merchantId === right?.merchantId &&
    left?.terminalId === right?.terminalId;
}

export function aggregateVerifiedEvidence(evidenceList = []) {
  const verified = evidenceList.filter((item) => item?.status === 'VERIFIED');
  const excluded = new Set();
  const reviewReasons = [];
  const selected = [];
  const byHash = new Map();
  for (const item of verified) {
    const list = byHash.get(item.contentSha256) ?? [];
    list.push(item);
    byHash.set(item.contentSha256, list);
  }
  for (const [hash, items] of byHash) {
    const canonicalKeys = new Set(items.map((item) => item.canonicalKey));
    if (canonicalKeys.has(null) || canonicalKeys.has(undefined)) {
      for (const item of items) excluded.add(item.evidenceId);
      reviewReasons.push({ code: 'RRN_MANUAL_MAPPING_REQUIRED', contentSha256: hash, evidenceIds: items.map((item) => item.evidenceId) });
      continue;
    }
    if (canonicalKeys.size > 1) {
      for (const item of items) excluded.add(item.evidenceId);
      reviewReasons.push({ code: 'EXACT_CONTENT_DIFFERENT_CANONICAL', contentSha256: hash, evidenceIds: items.map((item) => item.evidenceId) });
      continue;
    }
    selected.push(items[0]);
    for (const duplicate of items.slice(1)) excluded.add(duplicate.evidenceId);
    if (items.length > 1) {
      reviewReasons.push({ code: 'EXACT_CONTENT_DUPLICATE', contentSha256: hash, evidenceIds: items.map((item) => item.evidenceId) });
    }
  }

  const byCanonical = new Map();
  for (const item of selected) {
    const list = byCanonical.get(item.canonicalKey) ?? [];
    list.push(item);
    byCanonical.set(item.canonicalKey, list);
  }
  const unique = [];
  for (const [key, items] of byCanonical) {
    if (items.length !== 1) {
      for (const item of items) excluded.add(item.evidenceId);
      reviewReasons.push({ code: 'DUPLICATE_SUSPECT', canonicalKey: key, evidenceIds: items.map((item) => item.evidenceId) });
      continue;
    }
    const item = items[0];
    if (!['sale', 'refund'].includes(item.document?.documentType) || typeof item.document?.amountMinor !== 'bigint' || item.document.amountMinor <= 0n) {
      excluded.add(item.evidenceId);
      reviewReasons.push({ code: 'INVALID_EVIDENCE', evidenceIds: [item.evidenceId] });
      continue;
    }
    unique.push(item);
  }

  const sales = new Map();
  let totalMinor = 0n;
  for (const item of unique.filter((candidate) => candidate.document.documentType === 'sale')) {
    sales.set(item.evidenceId, item);
    totalMinor += item.document.amountMinor;
  }
  const refundedBySale = new Map();
  const included = [...sales.values()].map((item) => item.evidenceId);
  for (const refund of unique.filter((candidate) => candidate.document.documentType === 'refund')) {
    const originalId = optionalText(refund.linkedOriginalEvidenceId);
    const original = originalId === null ? null : sales.get(originalId);
    if (!original || original.status !== 'VERIFIED' || original.document.documentType !== 'sale') {
      excluded.add(refund.evidenceId);
      reviewReasons.push({ code: 'REFUND_ORIGINAL_REQUIRED', evidenceIds: [refund.evidenceId], linkedOriginalEvidenceId: originalId });
      continue;
    }
    if (!sameEvidenceScope(refund, original)) {
      excluded.add(refund.evidenceId);
      reviewReasons.push({ code: 'REFUND_SCOPE_MISMATCH', evidenceIds: [refund.evidenceId, original.evidenceId] });
      continue;
    }
    const alreadyRefunded = refundedBySale.get(original.evidenceId) ?? 0n;
    const nextRefunded = alreadyRefunded + refund.document.amountMinor;
    if (nextRefunded > original.document.amountMinor) {
      excluded.add(refund.evidenceId);
      reviewReasons.push({ code: 'REFUND_AMOUNT_EXCEEDS_ORIGINAL', evidenceIds: [refund.evidenceId], linkedOriginalEvidenceId: original.evidenceId });
      continue;
    }
    refundedBySale.set(original.evidenceId, nextRefunded);
    included.push(refund.evidenceId);
    totalMinor -= refund.document.amountMinor;
  }

  return freezeDeep({
    totalMinor,
    includedEvidenceIds: included,
    excludedEvidenceIds: [...excluded],
    reviewReasons,
    // Bu projection hiçbir fiscal/operasyonel kayıt üretmez.
    sideEffects: Object.freeze({ createsSale: false, createsCash: false, createsAr: false }),
  });
}

function statusOf(error) {
  if (error && typeof error === 'object') return error.status ?? error.httpStatus ?? null;
  return null;
}

export function isRetryableHttpStatus(status) {
  return Number.isInteger(status) && HTTP_RETRYABLE(status);
}

export function parseRetryAfterMs(value, { nowMs = Date.now(), capMs = 30_000 } = {}) {
  if (value === undefined || value === null || value === '') return null;
  let milliseconds;
  const text = String(value).trim();
  if (/^\d+$/.test(text)) milliseconds = Number(text) * 1000;
  else {
    const parsed = Date.parse(text);
    if (Number.isNaN(parsed)) return null;
    milliseconds = Math.max(0, parsed - nowMs);
  }
  return Math.min(capMs, Math.max(0, milliseconds));
}

export class RetryExhaustedError extends Error {
  constructor({ reason, attempts, lastStatus = null }) {
    super('Entegrasyon işlemi DLQ durumuna alındı');
    this.name = 'RetryExhaustedError';
    this.code = 'DLQ';
    this.reason = reason;
    this.attempts = attempts;
    this.lastStatus = lastStatus;
  }
}

function defaultSleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function callWithTimeout(operation, attempt, timeoutMs) {
  if (timeoutMs === null || timeoutMs === undefined) return operation({ attempt, signal: undefined });
  const controller = new AbortController();
  let timer;
  try {
    return await Promise.race([
      Promise.resolve().then(() => operation({ attempt, signal: controller.signal })),
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          const error = new Error('attempt timeout');
          error.code = 'ATTEMPT_TIMEOUT';
          reject(error);
        }, timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Retry 408/429/5xx içindir. NETWORK_ERROR yalnız açıkça idempotent OCR job'ında retry edilir.
 * Retry-After pencere cap'ini aşarsa daha erken retry yapılmaz; iş DLQ/manual kuyruğa gider.
 */
export async function retryWithPolicy(operation, {
  maxAttempts = 4,
  baseDelayMs = 100,
  maxDelayMs = 5_000,
  retryAfterCapMs = 5_000,
  attemptTimeoutMs = 10_000,
  random = Math.random,
  sleep = defaultSleep,
  now = () => Date.now(),
  idempotentOcrJob = false,
} = {}) {
  if (typeof operation !== 'function') throw new DomainError('RETRY_OPERATION_INVALID', 'Retry operation function olmalıdır');
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1) throw new DomainError('RETRY_CONFIG_INVALID', 'maxAttempts pozitif tamsayı olmalıdır');
  if (typeof random !== 'function' || typeof sleep !== 'function') throw new DomainError('RETRY_CONFIG_INVALID', 'random ve sleep portları function olmalıdır');
  if (!Number.isFinite(retryAfterCapMs) || retryAfterCapMs < 0) throw new DomainError('RETRY_CONFIG_INVALID', 'retryAfterCapMs negatif olamaz');
  let lastStatus = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const value = await callWithTimeout(operation, attempt, attemptTimeoutMs);
      return { value, attempts: attempt };
    } catch (error) {
      if (error?.code === 'ATTEMPT_TIMEOUT') {
        throw new RetryExhaustedError({ reason: 'TIMEOUT', attempts: attempt, lastStatus });
      }
      lastStatus = statusOf(error);
      const networkRetryable = error?.code === 'NETWORK_ERROR' && idempotentOcrJob === true;
      if (!networkRetryable && !isRetryableHttpStatus(lastStatus)) throw error;
      if (attempt >= maxAttempts) throw new RetryExhaustedError({ reason: 'MAX_ATTEMPTS', attempts: attempt, lastStatus });
      const randomValue = Math.min(0.999999, Math.max(0, Number(random())));
      const exponential = Math.min(maxDelayMs, baseDelayMs * (2 ** (attempt - 1)));
      const jittered = Math.floor(exponential * (0.5 + randomValue * 0.5));
      const retryAfterValue = error.retryAfter ?? error.headers?.['retry-after'];
      const providerRetryAfter = parseRetryAfterMs(retryAfterValue, {
        nowMs: now(),
        capMs: Number.MAX_SAFE_INTEGER,
      });
      if (providerRetryAfter !== null && providerRetryAfter > retryAfterCapMs) {
        throw new RetryExhaustedError({ reason: 'RETRY_AFTER_EXCEEDS_WINDOW', attempts: attempt, lastStatus });
      }
      // Provider süresi cap içinde olsa dahi jitter/maxDelay ile provider süresinden erken uyanılmaz.
      const delayMs = Math.max(jittered, providerRetryAfter ?? 0);
      await sleep(delayMs);
    }
  }
  throw new RetryExhaustedError({ reason: 'MAX_ATTEMPTS', attempts: maxAttempts, lastStatus });
}

export async function retryToDlq(operation, options = {}) {
  try {
    return await retryWithPolicy(operation, options);
  } catch (error) {
    if (error instanceof RetryExhaustedError) {
      return Object.freeze({ status: 'DLQ', reason: error.reason, attempts: error.attempts, lastStatus: error.lastStatus });
    }
    throw error;
  }
}

/** Log için allow-list: mesaj, ham OCR ve kart verisi bilinçli olarak taşınmaz. */
export function safeIntegrationLog({ event, correlationId, attempt, status } = {}) {
  return freezeDeep({
    event: requiredText(event, 'event'),
    correlationId: correlationId ? String(correlationId) : null,
    attempt: Number.isInteger(attempt) ? attempt : null,
    status: Number.isInteger(status) ? status : null,
  });
}

function dateValue(value) {
  if (value === undefined || value === null) return null;
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function validGrantDate(value) {
  if (value === undefined || value === null) return true;
  if (typeof value !== 'string' && !(value instanceof Date)) return false;
  return dateValue(value) !== null;
}

function validTargetId(target, field) {
  return typeof target?.[field] === 'string' && target[field].trim() !== '';
}

function scopeMatches(grant, target) {
  if (!grant || !target || !validTargetId(grant, 'tenantId') || !validTargetId(target, 'tenantId')) return false;
  // Scope id'si ne olursa olsun tenant sınırı daima eşleşmelidir.
  if (grant.tenantId !== target.tenantId) return false;
  if (grant.scopeType === 'TENANT') return true;
  if (grant.scopeType === 'COMPANY') return validTargetId(grant, 'companyId') && validTargetId(target, 'companyId') && grant.companyId === target.companyId;
  if (grant.scopeType === 'STATION') return validTargetId(grant, 'stationId') && validTargetId(target, 'stationId') && grant.stationId === target.stationId;
  if (grant.scopeType === 'BUSINESS_UNIT') return validTargetId(grant, 'businessUnitId') && validTargetId(target, 'businessUnitId') && grant.businessUnitId === target.businessUnitId;
  return false;
}

export function hasActiveScopedPermission(actor, permissionCode, target, now = new Date()) {
  const instant = dateValue(now);
  if (!instant || typeof permissionCode !== 'string' || permissionCode.trim() === '') return false;
  if (!actor?.isRealUser || actor.active !== true || !Array.isArray(actor.permissionGrants)) return false;
  return actor.permissionGrants.some((grant) => {
    if (!grant || grant.active !== true || grant.permissionCode !== permissionCode || !scopeMatches(grant, target)) return false;
    if (!validGrantDate(grant.validFrom) || !validGrantDate(grant.validTo)) return false;
    const from = dateValue(grant.validFrom);
    const to = dateValue(grant.validTo);
    if (from && to && to <= from) return false;
    return (!from || instant >= from) && (!to || instant < to);
  });
}

export function assertOwnRealUser({ actor, ownerUserId, permissionCode, target, now = new Date() }) {
  if (!actor?.isRealUser || actor.active !== true) throw new DomainError('USER_NOT_ACTIVE', 'Gerçek ve aktif kullanıcı gerekir');
  if (actor.userId !== ownerUserId) throw new DomainError('NOT_OWN_RESOURCE', 'Yalnız kendi personel hesabı kullanılabilir');
  if (!hasActiveScopedPermission(actor, permissionCode, target, now)) {
    throw new DomainError('PERMISSION_SCOPE_DENIED', 'Aktif permission/scope bulunamadı');
  }
  return true;
}

function countDistinct(values) {
  return new Set(values).size;
}

function isCheckedApproval(decision, permissionCode) {
  return decision?.decisionCode === 'APPROVE' &&
    typeof decision.approvalRequestId === 'string' && decision.approvalRequestId.trim() !== '' &&
    typeof decision.snapshotHash === 'string' && decision.snapshotHash.trim() !== '' &&
    Number.isInteger(decision.revision) &&
    typeof decision.userId === 'string' && decision.userId.trim() !== '' &&
    typeof decision.realPersonId === 'string' && decision.realPersonId.trim() !== '' &&
    decision.active === true &&
    decision.isRealUser === true &&
    decision.serverChecked === true &&
    decision.permissionChecked === true &&
    decision.scopeChecked === true &&
    decision.permissionCode === permissionCode;
}

function completeTargetState(target) {
  return target &&
    typeof target.openReviewCount === 'number' && Number.isInteger(target.openReviewCount) && target.openReviewCount >= 0 &&
    typeof target.differenceMinor === 'bigint' &&
    typeof target.pendingFinancialInfo === 'boolean' &&
    typeof target.reviewable === 'boolean' &&
    typeof target.closed === 'boolean' &&
    typeof target.status === 'string';
}

/** Muhasebe kabul kapısı; posting yapmaz, yalnız atomik transaction içinde çağrılacak kararı üretir. */
export function validateAccountingAcceptance({
  actor,
  target,
  expectedSnapshot,
  existingDecisions = [],
  now = new Date(),
  policy,
  reason = null,
}) {
  if (!policy || typeof policy !== 'object') throw new DomainError('POLICY_REQUIRED', 'Sunucu tarafından yüklenmiş policy gerekir');
  const permissionCode = requiredText(policy.permissionCode, 'policy.permissionCode');
  const requiredSignatures = policy.requiredSignatures;
  if (![1, 2].includes(requiredSignatures)) throw new DomainError('SIGNATURE_POLICY_INVALID', 'İmza sayısı 1 veya 2 olmalıdır');
  if (!completeTargetState(target)) {
    throw new DomainError('TARGET_STATE_INCOMPLETE', 'Muhasebe hedef state alanları eksik veya malformed');
  }
  if (!target.reviewable || target.closed || !REVIEWABLE_TARGET_STATUSES.has(target.status)) {
    throw new DomainError('TARGET_NOT_REVIEWABLE', 'Hedef kapalı veya review edilebilir durumda değil');
  }
  if (optionalText(target.requestedByUserId) === null || optionalText(target.requestedByRealPersonId) === null) {
    throw new DomainError('TARGET_STATE_INCOMPLETE', 'Requester kimliği eksik veya malformed');
  }
  if (target.openReviewCount > 0 || target.differenceMinor !== 0n) {
    throw new DomainError('FINANCIAL_REVIEW_OPEN', 'Açık inceleme veya sıfır olmayan fark varken kabul edilemez');
  }
  if (!Number.isSafeInteger(target.revision) || target.revision < 1 ||
      optionalText(target.snapshotHash) === null || optionalText(target.approvalRequestId) === null) {
    throw new DomainError('TARGET_STATE_INCOMPLETE', 'Snapshot revision/hash/request kimliği zorunludur');
  }
  if (!expectedSnapshot || target.revision !== expectedSnapshot.revision || target.snapshotHash !== expectedSnapshot.snapshotHash) {
    throw new DomainError('STALE_SNAPSHOT', 'Snapshot hash veya revision değişti; karar yeniden açılmalıdır');
  }
  const approvalRequestId = optionalText(target.approvalRequestId ?? expectedSnapshot.approvalRequestId);
  if (approvalRequestId === null) throw new DomainError('REQUEST_CONTEXT_INCOMPLETE', 'approval request kimliği zorunludur');
  if (expectedSnapshot.approvalRequestId !== undefined && expectedSnapshot.approvalRequestId !== approvalRequestId) {
    throw new DomainError('STALE_SNAPSHOT', 'Approval request snapshot ile eşleşmiyor');
  }
  if (!actor?.isRealUser || actor.active !== true || !actor.userId || !actor.realPersonId) {
    throw new DomainError('REAL_USER_REQUIRED', 'Onay için aktif gerçek kullanıcı gerekir');
  }
  if (actor.userId === target.requestedByUserId || actor.realPersonId === target.requestedByRealPersonId) {
    throw new DomainError('SELF_APPROVAL', 'Talep sahibi aynı gerçek kişi tarafından onaylanamaz');
  }
  if (!hasActiveScopedPermission(actor, permissionCode, target, now)) {
    throw new DomainError('PERMISSION_SCOPE_DENIED', 'Muhasebe permission aktif değil veya scope dışı');
  }
  if (!Array.isArray(existingDecisions)) throw new DomainError('DECISIONS_INVALID', 'Karar listesi dizi olmalıdır');

  const approvals = [];
  for (const decision of existingDecisions) {
    const sameRequest = decision?.approvalRequestId === approvalRequestId;
    const sameSnapshot = decision?.snapshotHash === target.snapshotHash && decision?.revision === target.revision;
    if (decision?.decisionCode !== 'APPROVE' || !sameRequest || !sameSnapshot) continue;
    if (decision.userId === target.requestedByUserId || decision.realPersonId === target.requestedByRealPersonId) {
      throw new DomainError('SELF_APPROVAL', 'Önceki imza talep sahibi tarafından verilemez');
    }
    if (!isCheckedApproval(decision, permissionCode)) {
      throw new DomainError('STALE_SIGNATURE', 'Önceki imzanın aktiflik/permission/scope kontrolü sunucuda doğrulanmamış');
    }
    approvals.push(decision);
  }
  const current = {
    approvalRequestId,
    snapshotHash: target.snapshotHash,
    revision: target.revision,
    userId: actor.userId,
    realPersonId: actor.realPersonId,
    active: true,
    isRealUser: true,
    serverChecked: true,
    permissionChecked: true,
    scopeChecked: true,
    permissionCode,
    decisionCode: 'APPROVE',
  };
  const allApprovals = [...approvals, current];
  if (countDistinct(allApprovals.map((item) => item.userId)) !== allApprovals.length) {
    throw new DomainError('DUPLICATE_SIGNATURE', 'Aynı kullanıcı iki imza veremez');
  }
  if (countDistinct(allApprovals.map((item) => item.realPersonId)) !== allApprovals.length) {
    throw new DomainError('SAME_REAL_PERSON', 'Farklı rol aynı gerçek kişinin ikinci imzası sayılamaz');
  }

  const pendingFinancial = target.pendingFinancialInfo;
  if (pendingFinancial && (policy.allowPending !== true || requiredSignatures < 2 || optionalText(reason) === null)) {
    throw new DomainError('FINANCIAL_PENDING_POLICY', 'Pending finansal bilgi için allowPending, iki imza ve açık gerekçe gerekir');
  }
  if (allApprovals.length < requiredSignatures) {
    return freezeDeep({
      decision: 'APPROVE',
      approvalStatus: 'PENDING_APPROVAL',
      operationalStatus: 'PENDING_APPROVAL',
      financialStatus: 'PENDING_APPROVAL',
      pendingApproval: true,
      pendingFinancialInfo: pendingFinancial,
      signatures: allApprovals.map((item) => item.userId),
      evidenceSetHash: target.evidenceSetHash ?? null,
      sideEffects: Object.freeze({ createsSale: false, createsCash: false, createsAr: false }),
    });
  }

  return freezeDeep({
    decision: 'ACCEPT',
    approvalStatus: 'ACCEPTED',
    operationalStatus: pendingFinancial ? 'ACCEPTED_WITH_PENDING' : 'ACCEPTED',
    financialStatus: pendingFinancial ? 'PENDING' : 'COMPLETE',
    pendingApproval: false,
    pendingFinancialInfo: pendingFinancial,
    signatures: allApprovals.map((item) => item.userId),
    evidenceSetHash: target.evidenceSetHash ?? null,
    // Kabul işlemi satış/kasa/AR post etmez.
    sideEffects: Object.freeze({ createsSale: false, createsCash: false, createsAr: false }),
  });
}

/**
 * Gerçek adapter yerine port sözleşmesini görünür kılan server integration skeleton.
 * identity.requireUser() kimliği body'den değil, sunucu oturumundan almalıdır.
 */
export function createAccountingAcceptanceService({ transaction, identity, repository, outbox }) {
  for (const [name, port] of Object.entries({ transaction, identity, repository, outbox })) {
    if (!port || typeof port !== 'object') throw new DomainError('PORT_MISSING', `${name} portu verilmelidir`);
  }
  return Object.freeze({
    async accept(request = {}) {
      const requiredMethods = [
        ['transaction.run', transaction.run],
        ['identity.requireUser', identity.requireUser],
        ['repository.lockAcceptanceRows', repository.lockAcceptanceRows],
        ['repository.readFreshSnapshot', repository.readFreshSnapshot],
        ['repository.loadPolicy', repository.loadPolicy],
        ['repository.getIdempotentResult', repository.getIdempotentResult],
        ['repository.appendDecision', repository.appendDecision],
        ['repository.markPendingApproval', repository.markPendingApproval],
        ['repository.markOperationalAccepted', repository.markOperationalAccepted],
        ['repository.storeIdempotentResult', repository.storeIdempotentResult],
        ['outbox.enqueueUnique', outbox.enqueueUnique],
      ];
      if (requiredMethods.some(([, method]) => typeof method !== 'function')) {
        throw new DomainError('PORT_METHOD_MISSING', 'Accounting service port metodu eksik');
      }
      const idempotencyKey = requiredText(request.idempotencyKey, 'idempotencyKey');
      const requestPayloadHash = payloadHash(request.payloadHash);
      return transaction.run(async (tx) => {
        const actor = await identity.requireUser();
        // Repository bu çağrıda account -> handover -> approval request sabit sırasıyla lock etmelidir.
        const locked = await repository.lockAcceptanceRows(tx, request);
        const fresh = await repository.readFreshSnapshot(tx, request);
        if (!fresh?.target) throw new DomainError('TARGET_NOT_FOUND', 'Kilitli kabul hedefi bulunamadı');
        const policy = await repository.loadPolicy(tx, fresh.target.policyVersion);
        if (!policy || typeof policy !== 'object') throw new DomainError('POLICY_REQUIRED', 'Sunucu policy yükleyemedi');
        if (!hasActiveScopedPermission(actor, policy.permissionCode, fresh.target)) {
          throw new DomainError('PERMISSION_SCOPE_DENIED', 'Tekrar yanıtında da güncel kullanıcı scope kontrolü gerekir');
        }
        // Adapter anahtarı actor+tenant+target+action kapsamında aramalıdır.
        const prior = await repository.getIdempotentResult(tx, idempotencyKey, requestPayloadHash, {
          actorUserId: actor.userId, tenantId: fresh.target.tenantId,
          targetId: fresh.target.accountId, action: 'accounting.accept',
        });
        if (prior) {
          if (prior.payloadHash && prior.payloadHash !== requestPayloadHash) {
            throw new DomainError('IDEMPOTENCY_CONFLICT', 'Aynı idempotency key farklı payload ile kullanıldı');
          }
          return prior.result ?? prior;
        }
        const result = validateAccountingAcceptance({
          actor,
          target: fresh.target,
          expectedSnapshot: request.expectedSnapshot,
          existingDecisions: fresh.existingDecisions,
          reason: request.reason,
          policy,
        });
        await repository.appendDecision(tx, {
          request,
          actor,
          result,
          target: fresh.target,
          serverChecked: true,
          isRealUser: true,
          permissionChecked: true,
          scopeChecked: true,
          permissionCode: policy.permissionCode,
        });
        const accepted = result.approvalStatus === 'ACCEPTED';
        if (accepted) {
          await repository.markOperationalAccepted(tx, { request, actor, result, target: fresh.target });
        } else {
          await repository.markPendingApproval(tx, { request, actor, result, target: fresh.target });
        }
        await outbox.enqueueUnique(tx, {
          idempotencyKey,
          eventType: accepted ? 'shift.handover.accounting-accepted' : 'shift.handover.accounting-pending-approval',
          actorUserId: actor.userId,
          payload: { targetId: fresh.target.accountId, operationalStatus: result.operationalStatus },
        });
        const response = { ...result, lockedRows: locked };
        await repository.storeIdempotentResult(tx, { idempotencyKey, payloadHash: requestPayloadHash, result: response });
        return response;
      });
    },
  });
}

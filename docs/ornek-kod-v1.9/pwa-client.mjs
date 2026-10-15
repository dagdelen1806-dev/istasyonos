// Tarayıcı entegrasyon örneği, canlı backend'e bağlı değildir.
// Caller json/body için string amount_minor kullanır; BigInt JSON'a direkt girmez.
export async function registerPwa(navigatorPort = globalThis.navigator) {
  if (!globalThis.isSecureContext || !navigatorPort?.serviceWorker) {
    return { state: 'UNSUPPORTED_OR_INSECURE' };
  }
  const registration = await navigatorPort.serviceWorker.register('/service-worker.js', { scope: '/' });
  return { state: registration.waiting ? 'UPDATE_WAITING' : 'REGISTERED', registration };
}

export async function submitHandover({
  accountId, revision, snapshotHash, clientEventId, idempotencyKey, csrfToken,
}, fetchPort = globalThis.fetch) {
  if (!accountId || !Number.isSafeInteger(revision) || revision < 1 || !snapshotHash ||
      !clientEventId || !idempotencyKey || !csrfToken) throw new Error('TESLIM_GIRDISI_EKSIK');
  // role, company, station ve requiredSignatures istemciden gönderilmez.
  let response;
  try {
    response = await fetchPort(`/v1/shift-accounts/${encodeURIComponent(accountId)}/handovers`, {
      method: 'POST', credentials: 'include', cache: 'no-store',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': idempotencyKey,
        'If-Match': `"${revision}"`,
        'X-CSRF-Token': csrfToken,
      },
      body: JSON.stringify({ revision, snapshotHash, clientEventId }),
    });
  } catch {
    // Ağ hatası, sunucunun işlemi yapmadığını kanıtlamaz. Aynı event/key tutulur.
    return { state: 'ACK_UNKNOWN', retryWithSameKey: true };
  }
  if (response.status === 401 || response.status === 403) return { state: 'REAUTH_OR_DENIED' };
  if (response.status === 409 || response.status === 412) return { state: 'REFRESH_CONFLICT' };
  if (response.status === 429 || response.status >= 500) return { state: 'SERVER_PENDING', retryWithSameKey: true };
  if (!response.ok) return { state: 'VALIDATION_ERROR', status: response.status };
  const result = await response.json();
  // 2xx upload queued veya receipt result, teslim ACK olarak karıştırılmaz.
  if (result.state !== 'SUBMITTED' || !result.handoverId || !Number.isSafeInteger(result.revision)) {
    return { state: 'ACK_UNVERIFIED' };
  }
  return { state: 'SUBMITTED', handoverId: result.handoverId, revision: result.revision };
}
// create clientEventId/idempotencyKey ONCE per user intent, not each retry.
// PWA offline secure draft storage, token/camera/maskeleme bu dosyada yoktur.
// Otomatik background-sync garantisi yok; kullanıcı görünür pending + tekrar
// deneme ve server status lookup gerçek uygulamada eklenmelidir.

# AKARYAKIT V1 v1.9 — örnek modüller

Bu klasör **canlı uygulama/deploy değildir**. Amaç; PWA sınırını, slip OCR hata toleransını, duplicate/refund kontrolünü ve muhasebe onay kuyruğu entegrasyonunu **Node 22 ES modules, bağımlılıksız pure domain logic + server integration skeleton/ports** olarak göstermektir.

> **Üretim iddiası yoktur.** Gerçek kimlik, yetki, OCR, object storage, POS/Turpak/banka API’si, queue, DB/ORM, migration, secrets veya HTTPS servisi bu klasörde uygulanmaz.

## Dosyalar

- `domain.mjs` — TRY `bigint` minor, OCR sınıflandırma/review, maske ve confidence kapısı, source-field/tarih/tutar doğrulama, content hash/canonical duplicate, bağlı refund aggregate, tenant-scoped permission, iki imzalı muhasebe kabul servisi ve bounded retry/DLQ.
- `domain.test.mjs` — `node:test` ile **29** bağımsız Türkçe etiketli test; canlı URL, OCR, DB veya dış servise çağrı yapmaz.
- `muhasebe-service.sql` — çalıştırılmaması gereken, vendor-bağımsız transaction akış/pseudo-SQL örneği; DDL/migration değildir.
- `README.md` — mimari, port sözleşmesi ve üretim sınırları.

Aynı klasörde `manifest.webmanifest`, `service-worker.js`, `pwa-client.mjs` ve `offline.html` de bulunur; bu dört dosya bu hedefli düzeltmede değiştirilmemiştir. Bunlar gerçek üretim güvenlik/hosting garantisi değil, PWA tarafındaki ayrı örneklerdir.

## Çalıştırma

Node 22 ile, paket/dependency olmadan:

```bash
node --test domain.test.mjs
```

Son doğrulama: **29 test geçti, 0 başarısız**.

## PWA mimarisi — sınır/port örneği

```text
Telefon PWA (kamera + güvenli kadraj + taslak UI)
        │ HTTPS / BFF / cookie + CSRF; uzun ömürlü token localStorage’da değil
        ▼
Server application (server-driven identity, tenant/RBAC/scope, idempotency, revision)
        ├── EvidenceStorePort  → private object store; checksum/retention
        ├── OcrPort            → allow-list sanitize alanlar; raw text yok
        ├── SourceSystemPort   → Turpak/ÖKC/POS/banka adapter’ları
        ├── AuthorizationPort  → aktif permission + tenant/company/station/BU scope
        ├── TransactionPort    → row lock + append-only review + outbox
        └── AccountingQueuePort→ muhasebe pending/review kuyruğu
```

Kamera yalnız izinli güvenli alanda kullanılmalı; yerel kırpma/redaksiyon başarısızsa dış OCR’ye gönderim durmalı ve `SENSITIVE_IMAGE_BLOCKED`/retake akışı açılmalıdır. Offline, yalnız sınırlı taslak ve güvenli/test edilmiş depolama varsa düşünülür; server ACK gelmeden “muhasebeye teslim edildi” gösterilmez. Oturum/yenileme token’ı düz `localStorage`’da tutulmaz.

İstemci kodu gerçek endpoint çağrısı yapmaz; aşağıdaki yalnız BFF isteğinin şeklidir:

```js
// Canlı çağrı değildir; örnek PWA/BFF sınırı.
export async function submitHandoverDraft({ accountId, expectedRevision, idempotencyKey }) {
  return {
    route: `/v1/shift-accounts/${accountId}/handovers`,
    method: 'POST',
    credentials: 'include',
    headers: {
      'Idempotency-Key': idempotencyKey,
      'If-Match': String(expectedRevision),
      'X-CSRF-Token': '<BFF tarafından üretilir>',
    },
    body: { expectedRevision, clientEventId: '<taslak olay kimliği>' },
  };
}
```

Gerçek server adapter’ı URL üretmek yerine server session’dan kullanıcıyı almalı, hesabın katılımcı/shift/scope ilişkisini tekrar doğrulamalı, aynı `client_event_id` + aynı payload için idempotent yanıt vermeli, aynı id + farklı payload için `409` conflict üretmelidir.

## TRY para doğruluğu

`parseTryDecimalToMinor()` yalnız string alır. `float`, `round`, virgül, üstel gösterim, negatif tutar, baştaki sıfır ve ikiden fazla ondalık kabul edilmez:

```js
import { parseTryDecimalToMinor, minorToTryDecimal } from './domain.mjs';

const exact = parseTryDecimalToMinor('1250.00'); // 125000n
minorToTryDecimal(exact);                         // '1250.00'
```

`bigint` minor; JSON, DB driver veya API sınırında açık string serializer gerektirir. Bu örnek yalnız TRY destekler; başka currency dönüşümü yapmaz.

## OCR hata toleransı, source fields ve evidence yaşam döngüsü

OCR sonucu satış değildir. `normalizeOcrDocument()` ham OCR text’i kopyalamaz. Eksik veya bilinmeyen currency **TRY’ye çevrilmez**; `currencyCode: null`, `amountMinor: null` ve review sonucu üretir. Currency confidence da amount/source confidence gibi kabul kapısındadır.

`companyId`, `merchantId`, `terminalId` dolu olmalı; `transactionDate` yalnız geçerli `YYYY-AA-GG` ISO tarihidir; verilen amount strict string biçiminde olmalıdır. RRN eksikse evidence oluşturulabilir fakat `canonicalKey` `null` kalır, `RRN_MANUAL_MAPPING_REQUIRED` review açılır ve eksik RRN kayıtları `∅` ile otomatik gruplanmaz.

```js
import { createEvidence, evaluateOcrDocument, appendEvidenceReview } from './domain.mjs';

const evidence = createEvidence({
  evidenceId: 'ev-demo-1',
  companyId: 'company-1',
  merchantId: 'merchant-1',
  terminalId: 'terminal-1',
  transactionDate: '2026-10-10',
  rrn: 'RRN-123',
  authCode: 'AUTH-123', // canonical tekillikte kullanılmaz
  contentSha256: 'a'.repeat(64),
  documentType: 'sale', // sale | refund | declined | report | bilinmeyen→unknown
  amount: '100.00',
  currencyCode: 'TRY',
  sensitiveMaskState: 'MASKED', // MASKED veya NOT_PRESENT olmadan VERIFY yok
  confidence: {
    amount: 0.99,
    currency: 0.99,
    documentType: 0.99,
    transactionDate: 0.99,
    terminal: 0.99,
    rrn: 0.99,
  },
});

const gate = evaluateOcrDocument(evidence.document);
// low confidence, unknown money, mask eksik/güvensiz, source alanı/tarih
// hatası veya declined/report/unknown => reviewRequired: true
const next = appendEvidenceReview(evidence, {
  reviewId: 'review-1',
  reviewerUserId: 'real-user-2',
  action: 'VERIFY',
});
// evidence değişmez; next yeni reviewVersion ve VERIFIED projection’ıdır.
```

Low-confidence correction, orijinali update etmez. Human correction yeni `evidenceId` ile yeni immutable veri olarak yazılmalı; orijinal içerik/hash ve review geçmişi saklanmalıdır:

```js
const corrected = createEvidence({
  evidenceId: 'ev-demo-1-correction-1', // yeni immutable kayıt
  companyId: evidence.companyId,
  merchantId: evidence.merchantId,
  terminalId: evidence.terminalId,
  transactionDate: evidence.transactionDate,
  rrn: 'RRN-HUMAN-123',                 // insan doğrulaması
  contentSha256: evidence.contentSha256, // aynı fiziksel içerik; iki kez toplanmaz
  documentType: 'sale',
  amount: '100.00',
  currencyCode: 'TRY',
  sensitiveMaskState: 'MASKED',
  confidence: { amount: 1, currency: 1, documentType: 1, transactionDate: 1, terminal: 1, rrn: 1 },
});
const correctedVerified = appendEvidenceReview(corrected, {
  reviewId: 'review-correction-1',
  reviewerUserId: 'real-user-2',
  action: 'VERIFY',
});
// Repository, evidence ve correctedVerified’i append-only tutar; evidence hiç silinmez.
```

Bu snippet domain’in immutability davranışını gösterir; gerçek object-store retention, append-only DB constraint’i ve correction authorization adapter’da uygulanmalıdır.

Kurallar:

1. Belge türü `sale`, `refund`, `declined`, `report` olarak sınıflandırılır; `declined` ve POS gün sonu `report` satış toplamına girmez. Tanınmayan tür `unknown`/review’dur.
2. Unknown money, TRY dışı değer, sıfır/negatif veya low-confidence tutar otomatik kabul edilmez. Currency confidence ile terminal/tarih/RRN/source confidence threshold altındaysa review açılır.
3. `sensitiveMaskState` zorunludur. `MASKED` veya `NOT_PRESENT` olmadan verify yoktur; `UNSAFE` dış OCR’yi bloke eder.
4. Duplicate canonical key şirket + merchant + terminal + işlem tarihi + RRN’dır. **Auth code uniqueness değildir.** Aynı key’de farklı dosyalar otomatik düşülmez. Content hash tüm mevcut canonical key’lerde aranır; aynı hash farklı canonical’a map oluyorsa review’dur.
5. Aggregate global content hash dedup uygular ve aynı fiziksel içeriği iki kez toplamaz. Aynı hash farklı canonical kayıtlar için tüm adaylar review’a çıkarılır.
6. Refund yalnız `linkedOriginalEvidenceId` ile aynı company/merchant/terminal scope’undaki **VERIFIED sale** kaydına bağlanır. Unmatched/cross-scope veya kümülatif refund original sale amount’ını aşarsa dışarıda kalır ve review nedeni üretir.
7. Evidence review append-only projection döndürür; eski evidence/review silinmez veya sessizce update edilmez. `Object.freeze()` yalnız bu in-memory projection’ı korur; veritabanında immutable garanti değildir.
8. Aggregate yalnız uygun verified `sale`/`refund` kayıtlarını toplar ve `sale − valid refund` projection’ı üretir. `createsSale`, `createsCash`, `createsAr` her zaman `false` döner.

## Retry ve log sınırı

`retryWithPolicy()` HTTP `408`, `429`, `5xx` için retry eder. Typed `NETWORK_ERROR` yalnız `idempotentOcrJob: true` verilmiş, fiscal posting yapmayan OCR job’ında bounded retry alır. Attempt timeout **retry edilmez**, `TIMEOUT` DLQ sonucu üretir; domain modülü hiçbir fiscal write yapmaz.

Provider’ın `Retry-After` değeri `retryAfterCapMs` üstündeyse iş provider süresinden erken tekrar denenmez; `RETRY_AFTER_EXCEEDS_WINDOW` ile DLQ/manual veya harici scheduled queue’ya bırakılır. Cap içinde olsa bile sleep provider’ın söylediği süreden kısa olamaz.

```js
import { retryToDlq } from './domain.mjs';

const result = await retryToDlq(
  ({ attempt, signal }) => ocrPort.parseSanitized({ attempt, signal }),
  {
    maxAttempts: 4,
    baseDelayMs: 250,
    maxDelayMs: 5000,
    retryAfterCapMs: 5000,
    attemptTimeoutMs: 10000,
    idempotentOcrJob: true,
  },
);
// { value, attempts } veya
// { status: 'DLQ', reason: 'TIMEOUT'|'MAX_ATTEMPTS'|'RETRY_AFTER_EXCEEDS_WINDOW' }
```

`safeIntegrationLog()` allow-list ile yalnız event/correlation/attempt/status üretir. PAN, CVV, PIN, track, raw OCR text, access token, secret veya hata mesajı loglanmaz. Üretimde ayrıca structured logger redaction ve retention gerekir.

## Muhasebe onay kuyruğu

`validateAccountingAcceptance()` şu kapıları uygular:

- aktif gerçek kullanıcı ve server tarafından doğrulanmış `finance.reconcile` permission;
- grant scope’u ne olursa olsun **aynı tenant**, ayrıca company/station/business-unit target eşleşmesi; malformed target veya invalid grant tarihi güvenli şekilde deny;
- requester veya aynı `realPersonId` ile self-approval yok;
- target `reviewable`, açık ve tamamlanmış state olmalı; `differenceMinor`, `openReviewCount`, `pendingFinancialInfo`, `status` ve `closed` eksikse güvenli reject;
- fresh snapshot hash/revision ve approval `requestId` eşleşmeli;
- yalnız aynı `approvalRequestId + snapshotHash + revision` kararları sayılır. Önceki imzada `active`, `isRealUser`, `serverChecked`, `permissionChecked`, `scopeChecked` server kontrolleri aranır;
- iki imza gerekiyorsa ilk imza exception atmaz, `PENDING_APPROVAL` döner. Service kararı append eder, operational accepted yapmaz ve pending event yayınlar;
- `pendingFinancialInfo` yalnız server policy `allowPending: true`, en az iki farklı gerçek kişi imzası ve açık `reason` ile `ACCEPTED_WITH_PENDING` olabilir; aksi `FINANCIAL_PENDING_POLICY`;
- kabul sale/cash/AR post etmez.

Client’ın gönderdiği `request.policy` güvenilir değildir ve kullanılmaz. `createAccountingAcceptanceService()` kilitli target’ın `policyVersion` değerini kullanarak `repository.loadPolicy(tx, target.policyVersion)` çağırır; required signature ve permission server policy’den gelir.

```js
import { createAccountingAcceptanceService } from './domain.mjs';

const ports = {
  transaction: { run: async (callback) => callback({}) },
  identity: { requireUser: async () => serverSession.user },
  repository: {
    lockAcceptanceRows: async () => [],
    readFreshSnapshot: async () => ({ target: lockedTarget, existingDecisions: [] }),
    loadPolicy: async (_tx, policyVersion) => policyStore.load(policyVersion),
    getIdempotentResult: async (_tx, key, payloadHash) => resultStore.get(key, payloadHash),
    appendDecision: async () => {},
    markPendingApproval: async () => {},
    markOperationalAccepted: async () => {},
    storeIdempotentResult: async () => {},
  },
  outbox: { enqueueUnique: async () => {} },
};

const service = createAccountingAcceptanceService(ports);
const result = await service.accept({
  idempotencyKey: 'idem-1',
  payloadHash: 'b'.repeat(64),
  expectedSnapshot: { revision: 4, snapshotHash: 'a'.repeat(64), approvalRequestId: 'request-1' },
  reason: 'pending banka bilgisi',
  policy: { requiredSignatures: 1 }, // saldırgan/client verisi; service bunu yok sayar
});
```

Idempotency aynı transaction içinde şu sözleşmededir: `getIdempotentResult(tx, key, payloadHash)` mevcut sonucu replay eder; aynı key farklı hash ise `IDEMPOTENCY_CONFLICT`; yeni sonuç `storeIdempotentResult(...)` ile outbox/decision ile aynı atomic transaction’da saklanır. Transaction rollback olursa ilk imza, status projection ve outbox birlikte rollback olur.

`muhasebe-service.sql` bu akışın vendor-bağımsız pseudo-SQL karşılığıdır. `BEGIN/COMMIT`, `FOR UPDATE`, bind adları, JSON, policy store ve unique conflict davranışları gerçek DB/driver’a uyarlanmadan çalıştırılamaz. Dosya hedef v1.9 tablolarını yaratmaz.

## Kaynak ve kapsam sınırı

Tasarım/şema referansları:

- `/home/ubuntu/projects/akaryakit-v1-37b46808/tasarim-v1.9-personel-mobil-vardiya-ocr-muhasebe.md`
- `/home/ubuntu/projects/akaryakit-v1-37b46808/schema-v1.4-shift-ocr-ar-purchase.sql`
- `/home/ubuntu/projects/akaryakit-v1-37b46808/schema-v1.5-company-rbac-approvals.sql`

Bu referanslar illustrative/hedef niteliğindedir. Gerçek firma/istasyon/merchant/terminal, kullanıcı, RRN, tutar, credential veya API key kullanılmamıştır.

### Açık üretim işleri / sınırlamalar

- Gerçek PWA hosting, manifest/service-worker cache stratejisi, offline secure storage ve telefon kamera redaksiyonu bu domain paketinin üretim garantisi değildir; klasördeki PWA dosyaları ayrı örneklerdir.
- Gerçek auth/MFA/cookie-CSRF/BFF, tenant isolation/RLS, RBAC provisioning ve user-to-real-person çözümleme yoktur.
- OCR engine, parser model, image quality check, private object storage, checksum upload, retention ve malware scan yoktur.
- Turpak/ÖKC/POS/banka adapter’ı, HTTP client, queue/worker, DLQ store ve live request yoktur.
- DB/ORM transaction, row lock, isolation, immutable constraint, unique index, migration ve outbox consumer yoktur; SQL yalnız servis tasarım iskeletidir.
- Retry timeout’unda operation’ın `AbortSignal`’a uyması gerçek adapter’ın sorumluluğudur; domain modülü ağ isteği başlatmaz.
- Gerçek muhasebe posting’i, AR/cash/sale/fiscal kayıtları ve likidite sonucu üretilmez.

## PWA örnek dosyaları ve birleşik doğrulama

Parent tarafından eklenen `manifest.webmanifest`, `service-worker.js`, `offline.html`, `pwa-client.mjs` ve `pwa-client.test.mjs` bu pakettedir. Manifestte production ikonları/route hazır değildir; paket gerçek kurulabilir app veya host edilen PWA değildir. Service worker yalnız veri içermeyen `/offline.html` allow-list'ini cache'ler; authenticated navigation/offline veri store sağlamaz. PWA submit örneği server ACK, 409/412, auth denial ve belirsiz ağ sonucu ayrımını gösterir.

10 Ekim 2026 son birleşik doğrulama:

```bash
node --test domain.test.mjs pwa-client.test.mjs
```

**29 domain + 7 PWA = 36 test geçti, 0 başarısız.** Bu sonuç canlı storage/OCR/DB/telefon/provider testi değildir. Sunucu, idempotent tekrar yanıtından önce de aktif permission/scope kontrolü yapar. Repository idempotent kayıt anahtarını gerçek actor+tenant+target+action ile kapsamlandırmalı; payload hash'i istemciden güvenle kabul etmek yerine gerçek request içeriğinden server'da üretmelidir. Replay yalnız hash/scope aynı olduğunda daha önceki sonucu döndürür.

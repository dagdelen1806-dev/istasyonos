# V1.9 — PWA, OCR hata toleransı ve muhasebe onay kuyruğu kod rehberi

**Tarih:** 10 Ekim 2026. **Kapsam:** test edilebilir domain modülleri ve entegrasyon örnekleri. Mevcut HTML prototipi değiştirilmedi; gerçek uygulama kurulumu/deploy, canlı OCR, DB migration veya banka/ÖKC bağlantısı yapılmadı. [Mobil v1.9 tasarımı](tasarim-v1.9-personel-mobil-vardiya-ocr-muhasebe.md) temel alınır.

## 1. Mimari ve sorumluluklar

```text
HTTPS Telefon PWA
  ├─ Manifest / statik shell / izinli kamera ekranı
  ├─ Beyan taslağı + pending görünümü
  └─ Güvenli capture/redaksiyon: başarısızsa upload yok
       ↓ Cookie + CSRF + idempotency + revision
BFF / API
  ├─ Gerçek oturum kimliği / scope / own-account kontrolü
  ├─ Hesap/teslim, private upload ve source mapping
  ├─ OCR job outbox → kalıcı worker → review → tekil aggregate
  └─ Muhasebe queue → lock/snapshot/policy → karar/audit/outbox
       ↓
PostgreSQL ve private object store
  └─ Source adaptörleri: Turpak / ÖKC / POS / banka
```

PWA yalnız istemcidir; rol veya para doğruluğu JS düğmesine güvenilerek korunmaz. Aynı kişi beş masaüstünde kendi token'ıyla erişebilir; başka çalışan kimlik paylaşmaz. Her employee account kendi participant scope'unda. Telefon desktop limitini tüketmez.

Service worker HTTPS/güvenli origin ister; localhost geliştirme istisnasıdır. Yeni worker varsayılan olarak eski açık sayfalar kapanana kadar bekler. Açık vardiya sırasında otomatik `skipWaiting()` sürüm geçişini zorlamak yerine görünür güncelleme akışı önerilir. [1]

Arka plan sync uzun ömürlü görev garantisi değildir; browser worker'ı durdurabilir. Bu yüzden sunucuda kalıcı OCR kuyruğu, istemcide görünür pending ve bağlantı sonrası aynı event ile yeniden gönderim gerekir. [2]

## 2. PWA manifest ve statik cache örneği

Örnek dosyalar [kod paketinde](ornek-kod-v1.9/README.md): `manifest.webmanifest`, `service-worker.js`, `pwa-client.mjs`, `offline.html`. Manifest simge/production route bilgileri henüz tamamlanmış installable uygulama değildir. Gerçek 192/512 ikonlar, maskable ikon, cihaz testleri ve uygulama shell'i deploy öncesi eklenir.

```json
{
  "id": "/personel/",
  "name": "Akaryakıt Personel Vardiya",
  "short_name": "Vardiyam",
  "lang": "tr-TR",
  "start_url": "/personel/",
  "scope": "/personel/",
  "display": "standalone",
  "theme_color": "#0F766E",
  "background_color": "#F8FAFC"
}
```

Gerçek layout'ta manifest linki uygulama tarafından konur. Platform manifest sahipliği ile uygulama manifest'i iki bağımsız kaynak gibi çakıştırılmaz; application-owned dağıtım seçimi gerçek web projesinin ayarında yapılır. Bu çalışmada ayar değiştirilmedi.

**Cache sınırı:** yalnız kesin allow-list'teki veri içermeyen dosya. `index.html` sunucudan kullanıcı bilgisi içeriyorsa shell cache'e alınmaz. `/api`, `/v1`, private object/kanıt, banka veya hesap yanıtlarına SW fallback uygulanmaz.

```js
const CACHE = 'akaryakit-shell-v1.9';
const SHELL = ['/offline.html']; // sadece veri içermeyen yardım sayfası
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(SHELL)));
});
self.addEventListener('fetch', event => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;
  if (!SHELL.includes(url.pathname) || url.search !== '') return;
  event.respondWith(caches.open(CACHE).then(async cache => {
    return (await cache.match(req)) ?? fetch(req);
  }));
});
```

API ayrıca `Cache-Control: private, no-store` döndürür; SW allow-list ve browser/network cache iki farklı kontroldür. `service-worker.js` URL'si public statik dosyadır; yeni worker hash/caching sürümü planlanır. Örnek root scope registration yalnız tek uygulama origin varsayar; birden fazla app varsa route/scope daraltılır.

**Offline:** şifreli ve gerçekten test edilmiş local queue adapter yoksa hassas slipleri kalıcı IndexedDB/localStorage'a yazmayın. Bu paket böyle bir adapter üretmez. Token uzun ömürlü localStorage'da tutulmaz. Native keystore güvencesi PWA depolamasına kendiliğinden gelmez. Login/SameSite/CSRF/CSP politikaları gerçek deployment ve embedded-preview ihtiyacına göre birlikte test edilir; yalnız cookie niteliği RBAC veya CSRF koruması değildir.

## 3. Beyan teslimi: ACK ve belirsiz ağ sonucu

`pwa-client.mjs` örneği fetch portuyla çalışır; backend endpoint'i hazır değildir.

```js
const response = await fetch(`/v1/shift-accounts/${encodeURIComponent(accountId)}/handovers`, {
  method: 'POST', credentials: 'include', cache: 'no-store',
  headers: {
    'Content-Type': 'application/json',
    'Idempotency-Key': key,            // kullanıcı niyeti başına bir kez üret
    'If-Match': `"${revision}"`,
    'X-CSRF-Token': csrfToken          // gerçek BFF session'dan
  },
  body: JSON.stringify({ revision, snapshotHash, clientEventId })
});
```

Body'ye `requiredSignatures`, `role`, `companyId`, veya policy koyarak yetki belirlenmez. Account ID de yalnız locator; ownership/scope sunucuda doğrulanır. `Idempotency-Key` aynı payload hash'ine bağlanır; retry'da yeni key üretmek çift teslim doğurabilir.

Yanıt yorumları:

- `401/403`: yeniden kimlik veya access denial; kör retry yok.
- `409/412`: son sürüm/snapshot'ı tekrar aç; eskisi overwrite edilmez.
- `429/5xx`: görünür pending; sağlayıcının retry penceresine uyulur.
- Ağ exception: **ACK_UNKNOWN**. İşlemin server'da gerçekleşmediği varsayılmaz; aynı key ile status sorgu/retry.
- `2xx`: yalnız geçerli teslim ID + `SUBMITTED` state + revision varsa teslim ACK. Sadece upload queued, `OCR_PENDING` veya 202 iş kabulü muhasebe teslimi değildir.

TRY API tutarı örneğin `amount_minor: "125000"` olur. `BigInt` JSON.stringify'ye direkt verilmez. UI `1.250,00` gösterimini açık locale parser ile `1250.00` canonical decimal'e dönüştürür; belirsiz binlik/ondalık OCR sonucu otomatik tahmin edilmez.

## 4. OCR worker: güvenlik gate, tekrar ve düşük güven

Tam modüller `domain.mjs`, testleri `domain.test.mjs` içinde. Aşağıdaki transaction/adapter şekli **tasarım pseudocode**; portlar paket içinde gerçek servis değildir:

```js
// Önce server-side metadata doğrulanır; client "MASKED" flag'ine güvenilmez.
const evidence = await evidenceRepo.readScopedMetadata(actor, evidenceId);
if (!evidence.redactionVerified) return { status: 'SENSITIVE_IMAGE_BLOCKED' };

// Kalıcı worker: aynı job/source ID OCR çağrısına da taşınır.
const outcome = await retryToDlq(
  ({ signal }) => ocrAdapter.readSafeFields({
    jobId, safeObjectKey: evidence.redactedObjectKey, signal
  }),
  { maxAttempts: 4, attemptTimeoutMs: 10000 }
);
// outcome alanları allow-list parser'a, hassas rawText/log'a değil.
// Sonuç kaydı + review status + audit/outbox aynı DB transaction'da.
```

**Sınır:** `MASKED`/`NOT_PRESENT` domain kontrolü görüntünün gerçekten güvenli olduğunu kanıtlamaz. Bu flag gerçek server image-redaction/quality adapter'ının sonucu olmalı; telefondan gönderilen boolean kabul edilmez.

OCR validation tutar, currency, belge türü, tarih-saat, merchant/terminal/RRN ve confidence alanlarını kontrol eder. Düşük confidence durumunda personel orijinal görseli inceleyerek düzeltir; corrected field ve reviewer yeni immutable review revision'da saklanır. Orijinal OCR silinmez. `documentType=report/declined/unknown` slip satış toplamına girmez. Refund ancak kaynak satış/iade bağıyla uygun toplamda yer alır.

**Retry politikası:** OCR'nin idempotent çağrısı için 408/429/5xx gibi geçici durumlar bounded exponential backoff+jitter; kimlik/validation/unsafe görüntü hatası retry değil. Network timeout kaybolmuş job sanılıp yeni ID verilmez. Deadline/max-attempt veya sağlayıcının Retry-After'ı izinli pencereyi aşarsa kalıcı pending/DLQ ve operatör incelemesi; sağlayıcı daha uzun bekle diyorsa cap uygulayıp erkenden tekrar çağırmayın. ÖKC mali yazımı bu OCR retry helper'ına bağlanmaz; unknown fiscal sonucunda provider status inquiry gerekir.

**Confidence 0,95** örnek başlangıç parametresidir; ölçülmüş PM80/telefon/fiş seti başarımı veya sağlayıcının kalibre edilmiş accuracy sonucu değildir. Üretim eşiği güvenli alan bazlı kalite testlerinden sonra onaylanır.

## 5. Tekil toplam ve iade

`company + merchant + terminal + transactionDate + RRN` kaynak tekillik adayıdır. Auth code tek başına global unique değildir. Eksik RRN/tarih veya farklı fotoğrafın aynı işlemi göstermesi review ister. Görsel checksum farklıysa kaynak transaction eşlemesi önem kazanır; aynı hash farklı anahtarla tekrar geldiyse de duplicate review.

```text
OCR_ADAYI → ALAN/DÖNEM/KİŞİ/TEKİLLİK_GATE → TEYİT
→ latest_review projection → uygun tekil slip toplamı
```

`sum(verified sale) − sum(linked verified refund)` sunucu read model'idir. Bu toplama düşülen refund, source POS net/refund olayında ikinci kere çıkarılmaz. Tekil hash/key kontrolünü yalnız istemciye bırakmayın; canonical source constraint, review ve aynı transaction gerekir. Bir fotoğraf reddedilince hard-delete yerine review revision/projection güncellenir.

Domain fonksiyonlarının frozen nesne üretmesi **veritabanı append-only garantisi değildir**. Üretimde update/delete izinleri, immutable ledger, event unique indexes ve audit yönetimi gerekir. Örnek OCR fonksiyonu finans ledger post etmez.

## 6. Muhasebe queue: ilk imza kalıcı, son imza kabul

Queue sorgusu target-state tasarım:

```sql
SELECT request_id, company_id, station_id, target_id,
       policy_version, row_version, payload_hash, status, requested_at
FROM ops.approval_requests
WHERE tenant_id = :server_tenant_id
  AND status IN ('PENDING', 'NEEDS_INFO')
  AND station_id = ANY(:server_authorized_station_ids)
ORDER BY requested_at, request_id;
```

Actual schema isimleri v1.5/v1.9 migration eşlemesiyle teyit edilir. Role picker veya client ANY listesi gerçek auth değildir. Pagination stable cursor/request ID ile; source freshness ve açık inceleme flag'i detayda gösterilir.

**Kabul transaction sırası:**

1. Session'dan actor ve gerçek kişi; scope ve aktif permission.
2. Account/teslim/approval request lock, ardından kaynak/evidence revision/hash tekrar oku.
3. İstek `PENDING/IN_REVIEW` uygunluğu ve mevcut idempotency sonucu kontrol.
4. **Policy repository'den** request policy_version ile yüklenir; client imza sayısı seçmez.
5. Beklenen hash/version, self-approval ve daha önceki aynı request+hash'e ait imzaları doğrula.
6. Karar append edilir. İlk gerekli imza `PENDING_APPROVAL` olarak **commit** edilir; hata fırlatıp rollback yapılmaz.
7. Yeterli farklı gerçek imza varsa `ACCEPTED`; izinli pending finans durumunda açık gerekçeyle `ACCEPTED_WITH_PENDING`. Bu yol ayrı policy ve ikinci imza gerektirir.
8. Audit/outbox ve idempotent response aynı transaction; sonra commit.

```js
// Pseudocode: repository portları production implementasyonu değildir.
return db.transaction(async tx => {
  const actor = await identity.requireUser();
  const locked = await repo.lockHandoverAndRequest(tx, accountId);
  const policy = await repo.loadPolicy(tx, locked.policyVersion);
  const current = await repo.readFreshSnapshot(tx, accountId);
  const decision = domainGate({ actor, current, policy, expectedSnapshot });
  await repo.appendDecision(tx, decision);
  if (decision.status !== 'PENDING_APPROVAL') {
    await repo.markOperationalAccepted(tx, decision);
  }
  await repo.persistResponseAndOutbox(tx, key, payloadHash, decision);
  return decision;
});
```

Normal financial acceptance'ta açık fark/required source/review sıfır olmalıdır. Pending bankayı accepted yapmak kaynak eşleşmesi değildir. Fizikî cash receive, muhasebe mali review ve station close permission ayrı. [Örnek SQL transaction iskeleti](ornek-kod-v1.9/muhasebe-service.sql) hedef tabloları yaratmaz ve çalıştırılacak migration değildir.

## 7. Paket, çalıştırma ve üretime geçiş eksikleri

[Kod paketi README](ornek-kod-v1.9/README.md) doğru export/fonksiyon adlarını ve son test sonucunu içerir. Node 22 domain testleri bağımlılıksızdır:

```bash
cd ornek-kod-v1.9
node --test domain.test.mjs pwa-client.test.mjs
```

Gerçek PWA installability/HTTPS, CSRF/auth/RLS, kalıcı offline queue, private storage/retention, OCR motor/redaction, backend locks/unique indexes ve outbox consumer bu örneklerde tamamlanmış değildir. Unit test geçmesi bu entegrasyonların canlı çalıştığı anlamına gelmez. Paket yalnız pure-domain davranışı ve port protokolünü doğrular.

[Excel/grafik incelemesi](inceleme-v1.9-excel-likidite-grafikler.md) nakit verileri ve model kapılarını ayrıca açıklar. Yönetim kurulu slaytları, gerçek veri paylaşımı ve pilot kapsam seçimi kararı için hazırlanmıştır; üretim onayı verilmedi.

## References

[1]: https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API/Using_Service_Workers "MDN — Using Service Workers"
[2]: https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Offline_and_background_operation "MDN — Offline and background operation"

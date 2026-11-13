# Faz 1 — Davet gizliliği ve UTC uygulama notları

## Durum ve doğrulama sonuçları

Y-01 ve Y-02 kod geliştirmesi tamamlanmıştır; dağıtılmamıştır. Kullanıcının açık
onayıyla saat dilimsiz API tarih-saatleri HTTP 400 ile reddedilir. Ortak yardımcı
vardiya başlangıcı/bitişi ve slip işlem anında, idempotency yanıtı okunmadan
önce de uygulanır. Eski kayıtlar veya yanıtlar değiştirilmez.

- Uygulama TypeScript kontrolü: başarılı, emit/incremental kapalı.
- Yeni testlerin ayrı TypeScript kontrolü: başarılı.
- Son izole Vitest koşumu: 11 dosya, **89 başarılı / 0 başarısız**.
- Y-01/Y-02 kapsamında toplam 61 yeni test; önceki 28 test de başarılı.
- Tarih/UI ve endpoint akışları: 50 testin her biri UTC, Europe/Istanbul ve
  America/New_York süreçlerinde tekrar başarılı (**150 ek yürütme**).
- Y-02 API standardı onayı sonrasındaki son doğrulamada başarısız kontrol yoktur.
- Üretim frontend ve server bundle derlemesi: başarılı. Büyük chunk ve runtime
  config script etiketi uyarıları vardır; bu paketlerde giderilmemiştir.
- İlk doğrulamada havuz değişimine bağlı Drizzle tip uyumsuzluğu giderildi.
  İlk testte bellek isteğinin yeniden kullanılması ve test APP_ID ayarı nedeniyle
  iki hata görüldü; test ortamı düzeltildikten sonra son koşumda hata kalmadı.
- Gerçek DB, migration, seed, eski kayıt dönüşümü ve dağıtım: yapılmadı.
- Gerçek Linux host ve MySQL/MariaDB entegrasyon kabulü: yapılmadı.

Son doğrulamada çalıştırılan komutlar:

```text
node scripts/verify-phase1.mjs test
node scripts/verify-phase1.mjs build
```

Bu sonuçlar Windows host'ta alındı; farklı TZ süreçleri gerçek Linux işletim
sistemi testi yerine geçmez. Testteki sentetik hata günlükleri kontrollü ret ve
rollback senaryolarına aittir; başarısız test anlamına gelmez.

## Değişen dosya envanteri

Mevcut dosyalardaki değişiklikler:

- `server/stationos/index.ts`: şifreli davet yanıtı, tekrar yetkilendirme, UTC
  state/davet okuma ve Türkiye vade günü hesabı.
- `server/stationos/domain.ts`: ortak UTC biçimleyici, açık fark zorunlu API
  anı doğrulaması ve takvim tarihi için Türkçe HTTP 400 hata sözleşmesi.
- `server/stationos/db.ts`, `server/db.ts`: UTC oturumlu bağlantı havuzları.
- `server/local-auth.ts`: oturum sonunu açık UTC DB biçiminde yazma.
- `client/src/pages/StationApp.tsx`: Türkiye tarih girişleri ve olay gösterimi.
- `client/src/components/stationos/Common.tsx`: açık tarih/saat biçimleme.
- `client/src/components/stationos/BusinessModules.tsx`: vade günü ve CSV tarihi.
- `client/src/components/stationos/AssistantPanel.tsx`: Türkiye saat gösterimi.
- `compose.yaml`, `.env.example`: yalnız yeni davet anahtarlarının yapılandırması.
- `shared/station-contract.md`: onaylanmış tarih/davet uyumluluk sözleşmesi.

Yeni dosyalar:

- `shared/datetime.ts`
- `server/stationos/invitation-response.ts`
- `server/stationos/utc-pool.ts`
- `server/stationos/invitation-response.test.ts`
- `server/stationos/invitation-flow.test.ts`
- `server/stationos/datetime.test.ts`
- `server/stationos/utc-pool.test.ts`
- `server/stationos/phase1-test-setup.ts`
- `vitest.phase1.config.ts`, `tsconfig.phase1.json`
- `scripts/verify-phase1.mjs`
- Bu uygulama/sonuç belgesi.

## Kapsam ve veri güvenliği

Yalnız Y-01/Y-02 kapsamındadır. Mali kapanış, para kuralları, tenant modeli,
rate limit ve sayfalama değiştirilmez. AGENTS.md/CLAUDE.md korunur.
Migration gerekmez ve çalıştırılmamıştır. Eski kayıtlar dönüştürülmez.

## Y-01: Davet yanıtları

Yeni davetler `st_invitations.code_hash` ile doğrulanmaya devam eder. İstemci
`{ok:true,result:{code,expiresAt}}` yanıtını almaya devam eder. Aynı requestId
aynı daveti döndürür; ikinci davet üretmez.

`st_requests.response_json` artık davet yanıtını açık JSON yerine sürümlü
AES-256-GCM zarfı olarak saklar. Şema değişmediği için ayrı migration/tablo yoktur.
Nonce her yazımda rastgeledir; doğrulama bağlamı aktör, requestId ve payload
hash'ini içerir. Tekrar okumada güncel rol, tenant ve istasyon yetkisi kontrol edilir.
Kullanılmış/süresi dolmuş davetin eski başarılı yanıtını tekrar almak kodu
yeniden etkinleştirmez; `/join` tek kullanım/süre kontrolünü sürdürür.

Gerekli sunucu değişkenleri:

- `INVITATION_RESPONSE_ACTIVE_KEY`: etkin anahtar kimliği, örneğin `v1`.
- `INVITATION_RESPONSE_KEYS`: anahtar kimliği → 32 rastgele baytın standart
  Base64 gösterimi eşlemesini içeren JSON. Gerçek anahtarları belgeye yazmayın.

Anahtarlar DB dışında tutulmalı, ayrı güvenli yedeklenmeli ve aynı uygulamanın
bütün instance'larında eşleşmelidir. SESSION_SECRET yeniden kullanılmaz.
Yeni etkin anahtar seçilirken eski anahtarlar, onlarla şifrelenmiş yanıtların
okunması gerektiği sürece korunur. Anahtar kaybolursa davet hash'leri geçerli
kalır, fakat şifreli yanıt geri alınamaz.

Eksik/yanlış anahtar yeni davet transaction'ını geri alır; açık metne fallback
yoktur. Diğer uygulama işlemleri bu değişkenleri gerektirmez. Compose bu
değişkenleri container'a iletir; gerçek `.env` bu geliştirmede değiştirilmez.

### Mevcut açık kayıtlar

Eski başarılı yanıtlar geriye uyumluluk için, güncel yetki kontrolüyle okunur;
yeniden yazılmaz veya otomatik şifrelenmez. Dolayısıyla eski response_json
kayıtları ve eski yedekler ham davet kodu içermeye devam edebilir. Bunların
envanteri/şifrelenmesi ayrı, açıkça onaylanmış bakım işidir. İşlem türü eski
kayıtlarda açıkça tutulmadığından salt JSON benzerliğiyle toplu dönüşüm yapılmaz.

## Y-02: Tarih anlamları

- DB DATETIME anları mevcut UTC saklama sözleşmesine göre okunur; işletim
  sisteminin yerel saat dilimiyle yeniden yorumlanmaz.
- API anları açık saat dilimli ISO 8601 taşır; sunucu çıkışı `Z` kullanır.
- Saat dilimsiz, yalnız tarih içeren veya takvim olarak geçersiz API anları
  HTTP 400 / INVALID_INPUT ile reddedilir; alan adı ve doğru biçim örneği verilir.
  Türkiye saatine veya sunucunun yerel saatine otomatik yorumlama yapılmaz.
- Açık saat farkı UTC'ye çevrilir. Kesirli saniyeler mevcut DATETIME(3)
  hassasiyetinde milisaniyeye indirilir. Artık saniye (`:60`) desteklenmez.
- Vade gibi takvim tarihleri `YYYY-MM-DD` olarak kalır, ana kayıtta bir ana çevrilmez.
- Kullanıcıya saatler Europe/Istanbul ile gösterilir. Yerel tarih/saat formu
  IANA saat dilimi kurallarını kullanır; tarihsel +02/+03 farkı korunur.
- Tarihsel DST boşluğu veya çift saatinde form sessiz seçim yapmaz; açıklayıcı
  hata verir. API açık offset ile kesin an gönderebilir.
- Havuzdan her bağlantı edinmede UTC oturum komutu tamamlanır; bundan önce
  bağlantı uygulamaya teslim edilmez. Kurulum başarısızsa bağlantı yok edilir.
  `timezone: Z` serileştirmesi de korunur.
- Drizzle ve operasyon bağlantıları aynı UTC politikasını kullanır.
- Vadesi gelen borç hesabı, UTC oturumunda da güncel Türkiye takvim gününü kullanır.
- Slip `transaction_day` sütunu ve unique indeksleri değiştirilmez.

Geçmiş tarihleri üç saat kaydıran veya mali kayıtları yeniden yazan dönüşüm yoktur.
Eski kayıtların UTC sözleşmesine aykırı yazıldığı ortaya çıkarsa ayrı veri
incelemesi gerekir; bu geliştirme onların tarih anlamını tahmin ederek değiştirmez.

## Güvenli doğrulama

`node scripts/verify-phase1.mjs test`

Doğrulayıcı alt süreçlere yalnız OS için gerekli değişkenleri geçirir; gerçek
DATABASE_URL, anahtarlar ve NODE_OPTIONS aktarılmaz. Vitest `envDir:false` ile
`.env` yüklemez. Gerçek MySQL havuzu oluşturma engellenir; endpoint testleri
yalnız bellekte SQL/transaction modeli kullanır. Harici fetch çağrıları varsayılan
olarak engellenir; mevcut platform testleri kendi sentetik fetch taklitlerini kurar.
Tarih/UI ve gerçek endpoint handler testleri UTC, Europe/Istanbul ve
America/New_York süreçlerinde tekrarlanır; endpoint DB'si yalnız bellek modelidir.

`node scripts/verify-phase1.mjs build`

Vite `.env` okumadan, yalnız `.local/phase1-build/` altında derler; üretim dist'i
değiştirmez. Sunucu bundle'ı üretilir ama çalıştırılmaz. Hiçbir migration/seed,
smoke-local veya database-rollback-check betiği çağrılmaz.

Bu testler gerçek MySQL/MariaDB üzerinde transaction kilidi, bağlantı kesintisi
veya gerçek Linux host kabulü yerine geçmez. Bunlar ayrı izole ortam kontrolüdür.

## Geçiş, yedek ve geri alma

Dağıtımdan önce kaynak ve yapılandırma sürümünü kaydedin; tutarlı DB yedeği alın
ve ayrı ortamda geri yükleme provası yapın. Anahtarları DB yedeğinden ayrı koruyun.
Bu geliştirme sırasında gerçek DB yedeği alınmamış ve dağıtım yapılmamıştır.

Kaynak değişikliği öncesi kopyalar `.local/phase1-source-backup-*/` altındadır;
gizli `.env` veya gerçek kullanıcı verisi içermez. Bu kopya DB yedeği değildir.

Dağıtım sonrası tercihen ileri düzeltme veya şifreli zarfı anlayan uyumlu sürüm
kullanın. Şifreli yanıt yazıldıktan sonra eski uygulamaya doğrudan dönüş güvenli
değildir: eski kod zarfı API yanıtı sanabilir ve yeniden açık kod yazabilir.
Gerekirse davet oluşturmayı durdurun; anahtarları/kayıtları koruyun. Şema geri
alma veya mali veri silme gerekmez. Yeni işlemlerden sonra eski DB yedeğini
doğrudan yüklemeyin; aradaki işlemler kaybolabilir.

## API tüketicileri ve kırılma riski

Depo genelinde `startsAt`, `endsAt`, `transactionAt` ve ilgili endpoint
çağrıları tarandı. `client/src/pages/StationApp.tsx` yerel Türkiye formunu
`turkeyInputToIso` ile açık Z içeren ana çevirir. `scripts/smoke-local.ts`
`toISOString()` kullanır; bu betik veri yazdığı için çalıştırılmamıştır.
Vade formu `BusinessModules.tsx` içinde YYYY-MM-DD göndermeye devam eder.
Aktif kaynaklarda saat dilimsiz vardiya/slip isteği gönderen başka tüketici
bulunmadı. Depo dışındaki entegrasyonlar, gerçek trafik ve dağıtım yapılandırması
doğrulanmadı; bunlar saat dilimsiz değer gönderiyorsa artık 400 alacaktır.
Var olan başarılı idempotency kaydını aynı belirsiz payload ile tekrar okumak
da 400 döner; eski kayıt silinmez/değişmez. Bu, onaylanmış sıkılaştırmadır.
Geçersiz vade tarihleri (örn. 2026-02-29) DB hatası yerine artık 400 alır.

## Dağıtım öncesi kontrol listesi

1. Ayrı güvenlik anahtarını oluşturun ve güvenli yapılandırmaya koyun:
   `INVITATION_RESPONSE_ACTIVE_KEY=v1`, `INVITATION_RESPONSE_KEYS` ise
   `{"v1":"<32 rastgele baytın Base64 değeri>"}` yapısında olmalıdır.
   Yer tutucu geçerli anahtar değildir; gerçek anahtar Git'e veya rapora girmez.
2. Tüm instance'larda aynı keyring ve aktif kimliği kullanın; anahtarların ayrı
   yedeğini ve rotasyon prosedürünü doğrulayın. Anahtarsız yeni davet 503 alır.
3. Yetkili bakım sürecinde tutarlı DB yedeği alın, ayrı ortamda geri yükleyin.
   Tarih kolonlarının geçmişte UTC yazıldığını salt okunur incelemeyle doğrulayın;
   belirsiz geçmiş veriye otomatik saat kaydırması uygulamayın.
4. Harici API sahiplerine Z/offset zorunluluğunu bildirin. İzole Linux ve
   MySQL/MariaDB ortamında sürücü/oturum/transaction entegrasyon kabulü yapın.
5. Bu paketlerde şema değişikliği yoktur. Mevcut `KUR.ps1`/Compose başlangıcı
   migration çağırabildiğinden bu geliştirmede kullanılmamıştır. Dağıtımda
   migration çalıştırmayan açıkça onaylanmış başlatma yolunu seçin; migrator
   davranışı bu kapsamda değiştirilmemiştir.
6. Dağıtım sonrasında ayrı test tenant'ında davet/tekrar/tek kullanım ve açık
   offsetli vardiya/slip smoke kabulünü ayrıca planlayın; gerçek mali kayda
   test işlemi göndermeyin. Y-03 ve sonraki paketler için yeni onay gerekir.

# Faz 5B.10 — Ayrı ÖSSE uygulama test ortamı runbook'u

## 12 Kasım 2026 güncel migration kararı

Bu bölüm, aşağıdaki eski ayrı-test-DB planındaki 0000–0019 ve katalog-dışı
0020 ifadelerinin yerine geçer. Kullanıcı yeni DB istemediğinden DEMO hedefi
olarak kalır; bu belge hiçbir yazma veya migration komutu çalıştırma izni
vermez.

- Salt-okunur önceki DEMO incelemesi: `istasyonos_demo`, operasyon geçmişi
  `0001`–`0017`, 58 uygulama tablosu. `0018` ve `0019` uygulanmamış;
  `st_payments.kind` FAST içermiyor ve `st_pos_slip_drafts` yok. Canlı durum
  apply öncesi aynı bağlantıda yeniden doğrulanmalıdır.
- Kanonik katalog artık 21 girdi: Drizzle `0000`, operasyon `0001`–`0020`.
  `migrations.manifest.json` SHA-256:
  `3e6ce8ee6a5a295bdcddc3b5de271f4299f838bc40632bab26cac6a99611ff01`.
- `0020_personnel_shift_assignments.sql` kanonik dosyadır. Eski üyelikler
  `REVIEW_REQUIRED`, yeni atama satırı `REMOVED` başlar; mevcut erişim veya
  vardiya ataması kendiliğinden etkinleşmez. Katılım sonrası yalnız yetkili
  OWNER/MANAGER'ın kapsam denetimli istasyon erişimi işlemi üyeliği ACTIVE
  yapar; işlem staffing/audit olayına yazılır.
- Beklenen uygulama tablo etkisi: `0018` mevcut `st_payments.kind` enum'unu
  genişletir; `0019` bir POS slip taslak tablosu ekler; `0020` üç mevcut tabloya
  indeks/status/FK ekler ve `st_shift_assignments`, `st_staffing_events`
  tablolarını oluşturur. 58 tabloluk başlangıçtan sonra 61 uygulama tablosu
  beklenir. `st_migration_guard` yoksa migrator ayrıca metadata tablosu
  oluşturabilir; bu da preflight'ta ayrıca sayılmalıdır.
- Operasyon geçmişi `0017` görünmesi, 0018–0020'yi tek başına uygulama izni
  değildir. Tarihsel migration SQL checksum kanıtı `UNKNOWN` ise eski satırları
  sahte `APPLIED` yapmayın; schema/history/checksum farkını operatör incelemesi
  ve belgeli, açık baseline kararı çözmeden apply etmeyin.
- Gerçek DEMO apply **NO-GO**: 0018/0019/0020 için bu turda MySQL DDL provası
  yapılmadı; backup/restore ve kısmi DDL kurtarma planı operatörce
  doğrulanmadı. Migrator tüm pending migrationları sırayla çalıştırır; 0018 ve
  0019 atlanamaz. DDL kısmi başarısızlığında durun; otomatik retry/rollback
  yok. `information_schema`, migrator guard ve history kayıtlarını inceleyip
  yedek üzerinden kurtarma kararı verin.

**Belge kapsamı:** Aşağıdaki önceki 5B.10 bölümleri ayrı disposable uygulama
DB'si varsayan tarihsel planlardır; artık geçerli hedef/komut değildir. Bu turda
DB açma, runtime profile seçme veya apply komutu yürütme yetkisi vermez. DEMO
üzerinde apply öncesi yalnız operatörün ayrı onayıyla güncel, DEMO'ya özel
runbook hazırlanmalıdır.

Bu belge hazırlık planıdır. Bu fazda DB oluşturma/değiştirme, migration, seed,
`.env`, kullanıcı veya GRANT işlemi yapılmaz.

## Mevcut karar

- Kanonik statik katalog: `drizzle/0000_initial_users.sql` ve operasyonel
  `0001_stationos.sql`–`0019_pos_slip_ocr_drafts.sql`; toplam 20 migration.
- `migrations.manifest.json` SHA-256: `3e6ce8ee6a5a295bdcddc3b5de271f4299f838bc40632bab26cac6a99611ff01`.
  Salt okunur katalog doğrulaması hash ve sıra eşleşmesini PASS verdi.
- Resmî `scripts/migrations.ts check-files` bu Codex oturumunda tsx başlarken
  `uv_os_get_passwd returned ENOMEM` ile **NOT_RUN** kaldı. Normal Windows
  PowerShell sonucu ayrıca alınmalı; bu hata migration/şema hatası değildir.
- Kanonik uygulama migration geçmişinin tarihsel SQL checksum kanıtı
  `UNKNOWN` durumundadır. Manifest doğrulaması uygulanmış DB geçmişini
  kanıtlamaz.
- `0020_personnel_shift_assignments.sql.draft` katalog dışıdır; uygulanmaz.
  `0018/0019` ana/DEMO DB'lerinde uygulanmamıştır. Migration kararı **NO-GO**.

## 0020 taslağının doğrulanmış statik bağımlılıkları

`0001_stationos.sql`, `st_stations`, `st_members`, `st_member_stations` ve
`st_shifts` tablolarını InnoDB olarak oluşturur. Mevcut `st_member_stations`
anahtarı `(tenant_id,user_id,station_id)`, `st_members` anahtarı
`(tenant_id,user_id)`, `st_stations` ve `st_shifts` ise tek sütunlu ID
primary key'leri kullanır.

0020 taslağı bu yapılara ek olarak:

- `st_stations(tenant_id,id)` ve `st_shifts(tenant_id,station_id,id)` bileşik
  unique anahtarlarını;
- `st_member_stations.status` ACTIVE/INACTIVE/REVIEW_REQUIRED alanını ve tenant-istasyon
  bileşik FK'sini;
- `st_shift_assignments` için personel-istasyon üyeliği, aynı tenant/istasyon
  vardiyası ve davet eden/güncelleyen tenant üyeliğine bileşik FK'leri;
- `st_staffing_events` için tenant, istasyon, vardiya, hedef personel ve actor
  kapsamlı FK'leri

bekler. Taslak ayrıca üyelik satırlarının tenant ve istasyon ilişkisini
önceden taramayı şart koşar; çapraz-tenant satır bulunursa otomatik düzeltme
yapılmaz, süreç durur. Bu statik inceleme gerçek MySQL uyumluluk veya veri
preflight kanıtı değildir.

## Ayrı DB ve test veri planı

1. DBA/operatör, `istasyonos_migration_trial`'dan farklı, yalnız bu test için
   ayrılmış boş bir **uygulama test DB** adı/hostu belirler. Önerilen ayırt
   edici ad `istasyonos_oesse_app_trial` olabilir; bu ad henüz oluşturulmuş
   veya erişilebilir kabul edilmez.
2. Aynı bağlantıda gerçek host, port, server identity, `DATABASE()`,
   `CURRENT_USER()` ve grant'ler doğrulanır. `st_trial_ro` yalnız salt-okunur
   kontroldür; resmi migrator hesabı değildir. `DATABASE_URL` fallback
   yapılmaz. Test DB'ye özel yazma kimliği ve target allowlist ayrı bir açık
   onaylı hazırlık gerektirir.
3. Yeni boş DB'de yalnız `0018/0019` çalıştırılmaz. Bir gün ayrıca onaylanırsa
   kanonik `0000`–`0019` sırası tümüyle, ayrı disposable hedefe uygulanır;
   mevcut trial DB yeniden kullanılmaz. 0020 bu sıraya kendiliğinden eklenmez.
4. Test tenant/şirket/istasyon, MANAGER, FUEL_STAFF, ACCOUNTANT, müşteri/cari,
   vardiya ve satış kaynakları tamamen kurgusal olur. Kullanıcılar normal
   uygulama davet ve `/setup` kabul akışıyla oluşturulur; sabit/gerçek parola
   veya gerçek işletme verisi fixture'a yazılmaz.
5. DB içeriği sentetik mali test verisidir. Gerçek banka teyidi, üretim POS,
   gerçek müşteri belgesi, maaş kesintisi veya finans defteri işlemi yoktur.
   İmha/reset bu belgenin kapsamında değildir; test DB'sini koruyun ve silme
   için ayrıca onay alın.

## Operatör test sırası

Bu maddeler ancak ayrı uygulama-test DB'si ve ona özel bağlantı/yetki hazır
olduktan ve DB/migration yazımı için ayrıca açık GO verildikten sonra yürütülür.
Bugün hiçbir adım çalıştırılmamalıdır.

1. **Katalog ve hedef:** Normal Windows PowerShell'de önce
   `node --import tsx .\scripts\migrations.ts check-files` çalıştırın. Beklenen
   hash/sıra değişirse durun. DB kimliğini salt-okunur doğrulayın. Trial hedefi
   ile uygulama test DB'sini karıştırmayın.
2. **Şema:** Yetkili migration operatörü sıfırdan kanonik 0000–0019 şemasını
   yalnız ayrı disposable uygulama DB'sine kurup `status`/tablo ve feature
   gate'lerini kaydeder. Bu yalnız ayrı yazım onayı sonrası yapılabilir. Ana,
   DEMO ve Aksan bağlantıları kullanılmaz.
3. **0020 kapısı:** Gerçek vardiya ataması testinden önce taslak SQL bağımlılık,
   tenant FK, indeks, mevcut veri preflight'ı, manifest numarası/checksum ve
   kısmi DDL kurtarma planı ayrı ayrı incelenip resmi kanonik migration olarak
   ayrıca onaylanmalıdır. Bu koşullar sağlanana kadar atama, vardiya hesabı
   açma ve bunlara bağlı E2E akış **BLOCKED** kalır. Taslak doğrudan apply
   edilmez.
4. **Yönetici ve davet:** Uygulama girişinden sentetik test tenant'ında yönetici
   oluşturun/oturum açın. Sadece kendi yetkili istasyonuna `FUEL_STAFF` davet
   edin. Başka tenant/istasyon ve rol yükseltme denemeleri 403/ret almalı.
   Çalışan daveti `/setup` üzerinden kendi test oturumuyla kabul etsin.
5. **İstasyon ve vardiya:** Yönetici yalnız izinli istasyonda vardiya oluşturup
   çalışanı atar. Başka personel, istasyon, tenant, kapanmış vardiya ve çift
   atama negatif kontrollerini çalıştırın. Bu adım 0020'nin resmi ve test DB'de
   doğrulanmış olmasına bağlıdır.
6. **Mobil beyan:** Çalışan kendi oturumunda yetkili istasyon/vardiyayı görür;
   nakit 12,50 TL (1250 kuruş), havale/IBAN 25,00 TL (2500 kuruş), cari 50,00
   TL (5000 kuruş) test beyanları girer. Cari müşteriyle bağlıdır ve tahsilata
   eklenmez. TTS/özel işlem ayrıca kalır. FAST ve POS OCR kullanmayın; bunlar
   bu senaryonun kapsamı değildir. Yeni disposable DB'nin tam kanonik
   0000–0019 şeması 0018/0019 tablolarını içerirse yalnız bu DB'de ilgili
   şema-yeterlilik gate'i açık görünebilir; bu banka teyidi/OCR onayı değildir
   ve işlemleri bu akışta kullanmayın. Ana/DEMO/Aksan feature gate'leri
   değiştirilmez. Gate kapalı şema senaryosu ayrıca gerekiyorsa bunu farklı,
   izole fixture/DB planı olarak tasarlayın; migration atlayarak veya özellik
   bayrağını taklit ederek test etmeyin.
7. **Offline/senkronizasyon:** Yalnız test hesabında bağlantıyı kesin, aynı
   tutarları kuyruğa yazın, sayfayı yenileyin ve bağlantı gelince aynı
   `clientOperationId` ile gönderin. Sunucu acknowledgement olmadan kayıt
   silinmemeli; yanıt kaybı/retry tek sunucu kaydı oluşturmalı. Farklı kullanıcı
   veya tenant oturumunda eski kapsam kullanılamamalı.
8. **Muhasebe incelemesi:** Hesap tesliminden sonra ilk beyan snapshot'ı
   salt-okunur görüntülenir. Otomasyon personel toplamı ve bağımsız gün sonu
   kaynağı ayrı kaynaklar olarak sunulur. Kaynak eksik/uyuşmazsa kesin fark,
   onay, personel borcu veya mali kayıt oluşmamalı. Düzeltme yalnız gerekçeli
   taslak; ilk beyan değişmezdir. İki bağımsız onay ve kendi işlemini onaylama
   yasağı korunur.
9. **Sonuç:** Her adım PASS/FAIL/NOT_RUN kaydedilir; sentetik E2E sonucu gerçek
   banka/otomasyon/üretim doğrulaması sayılmaz. Test verisini ve DB'yi silmeyin;
   ayrı imha onayı bekleyin.

## Bugünkü GO/NO-GO

**NO-GO — gerçek uygulama testine geçilmez.** Ayrı uygulama test DB'si
oluşturulmadı/doğrulanmadı; migrator yazma hesabı yok/doğrulanmadı; 0020 resmî
migration değildir; `tsx check-files` bu oturumda OS profil hatasıyla
çalışmadı. Statik kanonik manifest doğrulaması PASS'tir fakat gerçek MySQL/API,
Chrome DOM ve cihaz akışı NOT_RUN'dur. Bu engeller çözülmeden tenant/personel,
vardiya veya finansal test kaydı oluşturmayın.

## Faz 5B.11 son hazırlık ve operatör kapıları

### Bağlantı/erişim tasarımı

- Uygulama test DB'si için yeni ve yalnız bu teste ayrılmış DB adı, MySQL
  sunucusu/hostu, portu ve `@@server_uuid` operatör tarafından belirlenip
  doğrulanmalıdır. `istasyonos_migration_trial`, `istasyonos_db`,
  `istasyonos_demo` veya Aksan veritabanı hiçbir aşamada hedef olamaz.
- Tercih edilen sınır ayrı bir atılabilir MySQL instance/VM'dir. Aynı MySQL
  sunucusu kullanılacaksa yalnız uygulama test DB'sini görebilen ayrı DB adı,
  ayrı uygulama hesabı ve ayrı migration hesabı şarttır. `localhost`/socket
  yerine beklenen TCP hostu/portu sabitleyin; DNS/IP ve server UUID'yi kayıt
  altına alın. Beklenmeyen host, port, UUID, `DATABASE()` veya `CURRENT_USER()`
  durumunda uygulama başlatılmamalıdır.
- Runtime hesabı yalnız test DB'sinde uygulama CRUD işlemleri için gereken
  şema/table yetkilerine sahip olmalı; global yetki, başka DB grant'i,
  `GRANT OPTION`, rol yükseltme veya migration DDL yetkisi olmamalıdır.
  Migration hesabı runtime hesabından ayrı ve yalnız geçici uygulama test
  DB'sine kapsamlı olmalıdır. `st_trial_ro` read-only kullanıcıdır; runtime
  veya migration hesabı değildir. Mevcut trial migration hesabının varlığı
  veya yetkisi varsayılmaz.
- `server/stationos/db.ts` ve `server/db.ts` explicit test modunda aynı test
  URL'sine yönelir; `DATABASE_URL` fallback edilmez. `server/_core/index.ts`
  production, non-loopback bind, non-local auth veya çakışan DEMO modunda
  başlangıcı reddeder. Normal modun mevcut `DATABASE_URL` davranışı korunur.
  Uygulama havuzlarının her bağlantı ediniminde aynı fiziksel oturum üzerinde
  DB, port, server UUID/hostname, `CURRENT_USER()`, `CURRENT_ROLE()` ve
  `SHOW GRANTS` kontrolü yapılır. Kontrol geçmeden bağlantı sorguya verilmez;
  kontrol hatasında bağlantı yok edilir ve hassas ayrıntısız hata döner.
- Açık mod için gereken process-only değişkenler: `STATIONOS_APP_TEST_MODE=1`,
  `STATIONOS_APP_TEST_DATABASE_URL`, `STATIONOS_APP_TEST_EXPECTED_HOST`,
  `STATIONOS_APP_TEST_EXPECTED_PORT`,
  `STATIONOS_APP_TEST_EXPECTED_SERVER_UUID`,
  `STATIONOS_APP_TEST_EXPECTED_DATABASE`,
  `STATIONOS_APP_TEST_EXPECTED_CURRENT_USER`; opsiyonel
  `STATIONOS_APP_TEST_EXPECTED_SERVER_HOSTNAME`. Ayrıca
  `BIND_HOST=127.0.0.1` ve `NODE_ENV` production dışında olmalı. Test modu
  eksik/bozuksa uygulama başlatılmaz; `DATABASE_URL` ne olursa olsun fallback
  yapılmaz. URL'de parola gerekir; `socketPath` ve `multipleStatements` aktif
  edilemez. DB adı yasaklı adlar/Aksan eşleşmesi olamaz.
- Runtime `CURRENT_ROLE()` için `NONE` ister; hesap adı migration/root/admin
  hesapları olamaz. `SHOW GRANTS` yalnız `USAGE ON *.*` ve hedef DB üzerinde
  `SELECT, INSERT, UPDATE, DELETE` kabul eder. DDL, başka DB/schema grant'i,
  role, `GRANT OPTION` veya eksik CRUD reddedilir. Bu profil runtime hesabı
  oluşturmaz; migrator ayrı hesap ve ayrı operatör onayı gerektirir.
- Kanonik migrator'ın mevcut `istasyonos-trial` profili yalnız
  `istasyonos_migration_trial` için sabitlenmiştir. Bu profile uygulama DB adı
  verilerek geçilemez. Yeni uygulama test DB'si için ayrı, açık host/UUID/DB/
  user/grant allowlist'i ve migrator testi hazırlanıp incelenmeden migration
  hesabı/komutu kullanılamaz. `DATABASE_URL` üzerinden genel profile geçiş bu
  runbook'ta onaylı değildir.
- Profil ve iki pool yönlendirmesi sentetik testlerle doğrulandı; gerçek MySQL
  sunucusunda henüz denenmedi. Test modu gerçek uygulama E2E için ancak ayrı
  DB/hesap, 0000–0019 schema, onaylanmış 0020 ve gerçek bağlantı preflight'ı
  tamamlandıktan sonra kullanılabilir.
- Yedek: Test DB için ayrı, şifreli ve erişimi kısıtlı snapshot/backup alın;
  geri yükleme kabiliyetini şemasız sentetik hedefte prova edin. Gerçek/DEMO
  verisi veya production sırrı kopyalamayın. DDL kısmi kalırsa otomatik rollback,
  yeniden deneme veya DB silme yapmayın; migration geçmişi ve tablo/indeks
  durumunu DBA ile inceleyin. Test DB reset/imha bu onayın kapsamı dışındadır.
- Bağlantı bilgileri/parola `.env`, rapor veya komut satırı çıktısına
  yazılmamalı; sır yönetimi operatörün onaylı yerel secret store'unda olmalıdır.
  Uygulama başlamadan önce ve aynı bağlantıda host, port, `@@server_uuid`,
  `DATABASE()`, `CURRENT_USER()`, `CURRENT_ROLE()` ve `SHOW GRANTS` doğrulanmalı;
  kontrol başarısızsa başka URL/kullanıcıya geçilmemelidir.

### 0020 taslağı — uyumluluk ve etkiler

- Statik karşılaştırma: 0001, `st_stations`, `st_members`,
  `st_member_stations`, `st_shifts` ve `st_accounts` tablolarını InnoDB olarak
  kuruyor. 0020'nin eklediği `(tenant_id,id)` ve
  `(tenant_id,station_id,id)` anahtarları, tenant-istasyon-vardiya bileşik
  FK'lerinin hedefleri olarak gerekli.
- `st_shift_assignments` FK'leri personelin aynı tenant ve istasyondaki
  `st_member_stations` üyeliğini ve vardiyanın aynı tenant/istasyonda olmasını
  sınırlar. `assigned_by_user_id`/`updated_by_user_id` yalnız aynı tenant
  üyeliğini doğrular; yöneticilik rolünü SQL FK'si doğrulamaz. API tarafı
  OWNER/MANAGER ve istasyon kapsamını, hedefin FUEL_STAFF rolünü, aktif üyeliği,
  açık vardiyayı, çakışmayı ve daha önce hesap açılmamış olmasını ayrıca
  doğrulamalıdır.
- `st_staffing_events` tenant/istasyon/vardiya/personel/actor ilişkilerini
  FK'lerle sınırlar; FK'ler actor/target rolünü ve aktörün istasyon yetkisini
  tek başına doğrulamaz. Her yazma yolunda sunucu yetkilendirmesi ve audit
  gerekir. NULL vardiya FK'si MySQL composite-FK davranışıyla atlanabilir;
  bunu MySQL prova aşamasında ayrıca test etmeden audit kapsamı kanıtı saymayın.
- Güncellenen taslak `st_member_stations.status` için
  `ACTIVE/INACTIVE/REVIEW_REQUIRED`, `NOT NULL DEFAULT 'REVIEW_REQUIRED'`
  önerir. Mevcut ve yeni davetle eklenen üyelikler açık yetki incelemesine kadar
  istasyon kapsamına girmez. Bu fail-closed yaklaşım eski bir aktif erişimi de
  askıya alır; tenant OWNER üyelikleri station scope sorgusunda özel olarak
  bütün tenant istasyonlarını görür ve yöneticileri/personeli tek tek yeniden
  etkinleştirebilir. Tenant'ta owner yoksa veya owner kurtarma/atama süreci
  doğrulanamıyorsa 0020 uygulanmamalıdır. Eski vardiyalar, hesaplar ve beyanlar
  otomatik personele atanmayacaktır. Taslak katalog dışıdır; bu değişiklik
  statik öneridir, MySQL uyumluluğu ve geçiş provası yapılmadı.
- Taslak DDL çoklu ve atomik olmayan MySQL DDL içerir. Her `ALTER`/`CREATE`
  adımı kısmen uygulanabilir; disposable DB provası ve her adım sonrası schema
  inventory/recovery runbook'u olmadan uygulanamaz. Kanonik katalog, manifest
  veya uygulanmış migration checksum geçmişi değiştirilmemiştir.

### Mevcut API sözleşmesi ve E2E sırası

Mevcut Express route'ları ve testleri temel alınır; endpoint/body adları
uygulamada doğrulanmadan tahmin edilmez:

1. Yerel kimlik akışında yönetici hesabı açılır. `POST
/api/stationos/invite`: `requestId`, `role: "FUEL_STAFF"`, yetkili
   `stationIds`; cevapta tek kullanımlık davet kodu ve sona erme zamanı. Mevcut
   `invitation-flow.test.ts` rol yükseltme, istasyon dışına davet, idempotency,
   şifreli yanıt ve süre sonu kontrollerini kapsar.
2. Yeni personel kendi yerel oturumuyla `/setup`/katılım arayüzünü kullanır;
   API katmanı `POST /api/stationos/join` ve `requestId` + davet `code`
   kullanır. Tek kullanımlılık ve tekrar isteği mevcut bellek transaction
   testinde doğrulanmıştır; gerçek auth/DB henüz denenmemiştir.
3. Yönetici `POST /api/stationos/shift` ile vardiya açar; gerçek ÖSSE ataması
   `POST /api/stationos/staff/shift-assignment` (`stationId`, `shiftId`,
   `userId`, `assigned`) ve `/api/stationos/personnel/station-access`
   0020 şemasını gerektirir. Şema yokken API `STAFFING_MIGRATION_REQUIRED`
   döndürmelidir. **Bu adım gerçek E2E'de BLOCKED**; taslak migrationı bu test
   için elle çalıştırılamaz.
4. Atama uygulanıp doğrulanana kadar FUEL_STAFF'in `/api/stationos/account/open`
   çağrısı da `STAFFING_MIGRATION_REQUIRED`/`SHIFT_ASSIGNMENT_REQUIRED` ile
   güvenli biçimde durur. Sonraki ödeme endpoint'i `/api/stationos/payment`
   `accountId`, `expectedRevision`, `kind`, `amountMinor` ve borç için
   `debtorId` bekler; yalnız mevcut izinli türlerle sentetik CASH, IBAN ve
   DEBT senaryoları denenebilir. DEBT, tahsilat toplamı değildir. FAST bu
   senaryoda yoktur; 0018 uygulanmamıştır. POS OCR/0019 bu senaryoda yoktur.
5. Hesap teslimi `/api/stationos/account/submit` kaynağın tutar+referansının
   ödeme/slip toplamıyla aynı olmasını, nakit sayımını ve revision/device
   lease koşullarını ister. Aynı transaction'da ilk beyan olayı ve teslim
   güncellemesi yapılır. `GET
/api/stationos/account/declaration-snapshot?accountId=...` hesap sahibi veya
   izinli muhasebe rolüne snapshot verir; eski hesaba geriye dönük snapshot
   üretilmez. İstek tekrarında aynı idempotency kimliği/payload kullanılmalı;
   farklı payload aynı kimlikle conflict olmalıdır.
6. Offline senaryoda mevcut şifreli outbox, önceden yetkilendirilmiş aynı
   tenant/station/staff/shift/account kapsamı ve `clientOperationId` korunur.
   Aynı işlem yanıt kaybı sonrası tekrar gönderilir; sunucu ACK olmadan outbox
   kaydı silinmez. Oturum/üye kapsamı değişirse kayıt başka hesaba taşınmaz.
7. Muhasebe GET'leri ilk snapshot'ı salt okunur ve otomasyon personel toplamını
   ayrı gösterir. Otomasyon veya bağımsız gün sonu kanıtı yoksa kesin fark,
   onay veya mali işlem üretilmez. Düzeltme yalnız gerekçeli taslaktır; personel
   borcu, maaş kesintisi veya defter kaydı yoktur. İki bağımsız onay kuralları
   değişmez.
8. Her mutasyon öncesi/sonrası tenant, station, shift ve staff hesabı ile DB
   audit/event kayıtları test edilir. Yabancı tenant/istasyon/personel/vardiya
   isteği reddedilmelidir. Bu plan API/DB testi değildir; henüz PASS sayılmaz.

### Ayrı GO kapıları (bugünkü durum)

| Kapı                             | GO için gereken                                                                                                                                                     | Bugün                                                                      |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| A — test ortamı oluşturma        | DBA tarafından yeni izole hedef, host/UUID, ad ve iki ayrı hesap planı; ayrı onay                                                                                   | **NO-GO** — oluşturulmadı; bu oturumda CREATE/GRANT yok                    |
| B — kanonik 0000–0019 uygulama   | A sonrası exact-target preflight, checksum/geçmiş ve kısmi DDL kurtarma onayı; migration için ayrı açık GO                                                          | **NO-GO** — apply edilmedi                                                 |
| C — 0020                         | ACTIVE backfill etkisi kararı, cross-tenant preflight, taslak revizyon/resmî katalog/checksum, disposable MySQL proof ve ayrı migration GO                          | **NO-GO** — taslak katalog dışı                                            |
| D — API E2E                      | A–C tamamlandıktan sonra dedicated runtime credentials, explicit test process profile ve gerçek same-session hedef/grant preflight; sentetik kullanıcı fixture'ları | **NO-GO** — guard kodu/testi hazır; DB, hesap, 0020 ve canlı preflight yok |
| E — mobil/offline/accounting E2E | D sonrası ayrı testte API/tenant/idempotency/outbox/snapshot/review sonuçları ve finansal güvenlik doğrulaması                                                      | **NOT_RUN**                                                                |
| F — gerçek cihaz/görsel          | E sonrası Chrome/Android/iOS operatör testi; test sonucu ve build SHA kaydı                                                                                         | **NOT_RUN**                                                                |

Önce yalnız okuma/preflight ve kod incelemesi yapılabilir. DB oluşturma,
hesap/GRANT, migration, seed, uygulama başlatma, gerçek API mutation veya test
verisini silme için her ayrı yazma aşamasında yeni, açık operatör onayı gerekir.

### Şimdiki çevrimdışı PowerShell doğrulaması

Runtime hedef profili gerçek DB olmadan sınanabilir. Proje kökünde:

```powershell
node .\node_modules\vitest\vitest.mjs run `
  server\stationos\runtime-db-profile.test.ts `
  server\stationos\db.test.ts `
  server\db.test.ts `
  server\stationos\utc-pool.test.ts
node .\node_modules\typescript\bin\tsc --noEmit
```

Bu komutlar sentetik testtir; MySQL'e bağlanmaz. Gerçek profile ilişkin hiçbir
değer verilmediği/operatörce doğrulanmadığı için `scripts/run.mjs development`
ve migrator komutlarını bu hazırlıkta çalıştırmayın. Gerçek DB doğrulaması,
şema yazımı ve uygulama E2E ayrı kapılardır.

## Faz 5B.13 — ÖSSE uygulama test migrator profili

Bu bölüm yalnız operatör onayından sonraki ayrı disposable uygulama test DB'si
içindir. `istasyonos_migration_trial` salt-okunur/migrator provasıdır; uygulama
DB'si olarak kullanılamaz. `DATABASE_URL`, `ST_TRIAL_MIGRATION_DB_*` ve
`STATIONOS_APP_TEST_*` profillerine hiçbir fallback yoktur.

Yeni hedef adı kodda `istasyonos_oesse_app_trial` olarak sabitlenmiştir. Host,
port, server UUID/hostname ve erişim hesabı hedef oluşturulmuş varsayılmaz;
operatör bunları ayrı disposable MySQL instance için bağımsız kanıtla belirler.
Profil yalnız açıkça `--target-profile istasyonos-oesse-app-trial` seçilirse
etkinleşir. Ayrı process secret-store girdileri şunlardır:

- `STATIONOS_OESSE_MIGRATION_ENABLED=true`
- `STATIONOS_OESSE_MIGRATION_HOST` ve
  `STATIONOS_OESSE_MIGRATION_EXPECTED_HOST` (aynı olmalı)
- `STATIONOS_OESSE_MIGRATION_PORT` ve
  `STATIONOS_OESSE_MIGRATION_EXPECTED_PORT` (aynı olmalı)
- `STATIONOS_OESSE_MIGRATION_DATABASE=istasyonos_oesse_app_trial`
- `STATIONOS_OESSE_MIGRATION_USER=stationos_oesse_migrator`
- `STATIONOS_OESSE_MIGRATION_PASSWORD` (yalnız secret store/process memory)
- `STATIONOS_OESSE_MIGRATION_EXPECTED_CURRENT_USER` (tam etkin hesap; ad sabit
  `stationos_oesse_migrator`, host kısmı tam ve wildcard içermemeli)
- `STATIONOS_OESSE_MIGRATION_EXPECTED_SERVER_HOSTNAME`
- `STATIONOS_OESSE_MIGRATION_EXPECTED_SERVER_UUID`

Bu migrator kimliği runtime `stationos_oesse_runtime` hesabından ve
`stationos_trial_migrator` hesabından ayrıdır. Profilden gelen URL'de host,
port, DB ve kullanıcı bağımsız beklenen değerlerle eşleşmeden URL oluşturulmaz.
DB adı ana/DEMO/trial/Aksan adlarından biri olamaz. Migrator ilk ve tek MySQL
bağlantısında `DATABASE()`, `@@hostname`, `@@port`, `CURRENT_USER()`,
`CURRENT_ROLE()`, `@@server_uuid` ve `SHOW GRANTS` doğrular. Rol `NONE` olmalı;
grant validator'ı yalnız kanonik migrationın ihtiyaç duyduğu hedef-şema DDL
ve belirlenmiş migration geçmişi/ALTER tablolarındaki sınırlı yetkileri kabul
eder. Runtime CRUD grant'leri, global/başka şema yetkileri ve `GRANT OPTION`
reddedilir. Kontrol başarısızsa migrator bootstrap, DDL veya migration geçmişi
yazımına başlamaz. Bağlantı yenileme/fallback yoktur.

### Operatör adımları ve ayrı durma kapıları

1. **Salt okunur hedef tespiti — GO/NO-GO ayrı.** DBA, yeni DB oluşturulmadan
   önce beklenen host, port, server UUID/hostname ve yasak olmayan hedef adını
   yetkili salt-okunur bağlantıyla kaydeder. Gerçekten ayrı disposable hedef
   doğrulanamıyorsa durulur. Bu kod çalıştırılmaz ve var olan DB'ler denenmez.
2. **DB ve iki hesap hazırlama — yeni açık GO gerekir.** DBA ayrı DB, runtime
   hesabı ve migrator hesabını ayrı yetki sınırlarıyla hazırlar. Bu hazırlık
   runbook'un veya 5B.13 kod değişikliğinin parçası değildir. Parola komut
   satırına, `.env` değişikliğine, rapora veya loga konmaz. Kısıtlı migrator
   yalnız burada belirtilen hedef ve gereken migrator grant'lerine sahip olur;
   runtime hesabında DDL yetkisi olmaz. Hesaplar/izinler yok veya doğrulanamıyorsa
   durulur.
3. **Dosya ve boş-hedef durumu — yazmasız kontrol.** Kanonik manifest şu SHA-256
   değerinde olmalıdır:
   `3e6ce8ee6a5a295bdcddc3b5de271f4299f838bc40632bab26cac6a99611ff01`.
   Önce `node --import tsx .\scripts\migrations.ts check-files` çalıştırılır;
   sonra sadece hedef doğrulanmışsa aşağıdaki status komutu kullanılır. Bu
   profile özel status, aynı bağlantıda kimlik/grant kontrolünden sonra hedefin
   boş olmasını ve tam kanonik 0000–0019 listesinin 20 pending olmasını doğrular.
   Hatalı host/port/UUID/hesap/grant, bozuk manifest, beklenmeyen tablo veya
   farklı pending listesinde hiçbir migration başlamaz.

   ```powershell
   node --import tsx .\scripts\migrations.ts check-files
   node --import tsx .\scripts\migrations.ts status `
     --database istasyonos_oesse_app_trial `
     --manifest-sha256 3e6ce8ee6a5a295bdcddc3b5de271f4299f838bc40632bab26cac6a99611ff01 `
     --target-profile istasyonos-oesse-app-trial `
     --expect-empty-app-trial
   ```

4. **0000–0019 uygulama provası — status'tan ayrı yeni açık GO gerekir.** Yalnız
   onaylı disposable hedefte, tam 20 pending status sonucu ve ayrı backup/recovery
   incelemesi sonrasında `apply --apply
--confirm-oesse-app-trial-apply` kullanılır. Kod apply anında aynı hedefin
   hâlâ boş olmasını tekrar kontrol eder; manifest, host/port/UUID/user/role/grant
   denetimleri aynı bağlantıdadır. Bu doküman kullanıcı adına bu GO'yu vermez.
   Başarılı apply sonrası salt-okunur tamlık kontrolü için
   `status --expect-complete-app-trial` yalnız sıfır pending bekler. Aşağıdaki
   apply komutu bu görevde çalıştırılmayacaktır; ayrı GO ve onaylı hedef olmadan
   operatör de çalıştırmamalıdır:

   ```powershell
   node --import tsx .\scripts\migrations.ts apply `
     --database istasyonos_oesse_app_trial `
     --manifest-sha256 3e6ce8ee6a5a295bdcddc3b5de271f4299f838bc40632bab26cac6a99611ff01 `
     --target-profile istasyonos-oesse-app-trial `
     --apply `
     --confirm-oesse-app-trial-apply
   ```

5. **0020 — ayrı şema/ürün kararı ve bağımsız GO.** 0020 katalog dışı taslaktır;
   `REVIEW_REQUIRED` üyelik varsayılanı ve eski erişimlerin askıya alınması,
   owner kurtarma ve backfill etkisi önce değerlendirilir. 0020 bu profile
   eklenmez ve 0000–0019 apply komutuyla çalışmaz. Resmî migration tasarımı,
   ayrı disposable prova ve ayrı onay olmadan vardiya ataması etkinleşmez.
6. **Sentetik API/E2E — 0020 sonrası ayrı GO.** Yalnız kurgusal tenant/personel/
   istasyon/vardiya verisi; banka, Gemini, gerçek müşteri veya mali defter
   verisi yok. Runtime profili migrator hesabından ayrı, hedef CRUD sınırında
   olmalıdır. Davet, vardiya, mobil bildirim, snapshot ve muhasebe ön incelemesi
   testleri çalıştırılır. Gerçek cihaz testi ayrı sonuçlanır.

**DDL kurtarma sınırı:** MySQL DDL implicit commit yapabilir. İşlem kesilirse
DDL'nin bir kısmı kalabilir; `STARTED` migration guard, eksik tablo/indeks veya
uyuşmayan geçmiş devam/tekrar çalıştırmayı engeller. Otomatik rollback, retry,
baseline, DB silme/reset veya sonraki migrationa geçiş yoktur. DBA aynı hedefte
salt-okunur schema/history inventory alır, yedekle karşılaştırır ve elle
inceler; düzeltme ayrıca onaylanmadan migrator tekrar çağrılmaz.

**5B.13 kod doğrulaması:** migration profili/target/grant kontrolleri ve
boş-hedef apply guard'ı sentetik adaptör testleriyle doğrulanabilir. Bu testler
hedef DB'nin varlığını veya grant'leri kanıtlamaz. DB oluşturma, kullanıcı/GRANT,
status bağlantısı, migration apply, 0020 ve API/MySQL E2E bu fazda yapılmaz.


### Catalogue correction - 12 November 2026

The current canonical manifest contains 21 migrations. 0020_personnel_shift_assignments is included and its SQL checksum matches the manifest. Do not treat 0020 as a draft outside the catalogue. This only establishes canonical file status; it does not mean 0020 has been applied to DEMO. DEMO still requires its own verified migration history, backup/recovery evidence, target credentials, and separate apply approval.
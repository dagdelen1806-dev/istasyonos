# Faz 1 / Y-08 — Kalıcı işlem kurtarma

**4 Kasım 2026 güncellemesi:** Ayrı sentetik MySQL/Chrome pilotu tamamlandı;
deadlock rezervasyonu ve DB saati düzeltmeleri eklendi. Gerçek MySQL COMMIT
yanıtının kaybı ve COMMIT öncesi bağlantı kesilmesi de doğrulandı. Güncel sonuçlar ve
doğrulama sınırları [pilot raporundadır](faz1-y08-pilot-2026-11-04.md).
Aşağıdaki teslim kapsamı ilk bağlantısız çalışma aşamasını anlatır.

## Teslim kapsamı ve korunan sınırlar

Y-08 kodu ve bağlantısız otomatik testleri hazırlandı. Gerçek DB bağlantısı, migration, baseline, seed veya müşteri/demo verisi işlemi yapılmadı. AGENTS.md, CLAUDE.md, önceki yedi SQL migration ve Drizzle journal korunur. Üretim dağıtımı yapılmadı. Y-03 veya diğer paketlerde çalışma yapılmadı.

AGENTS.md ve CLAUDE.md okundu. Tarihsel belgelerdeki doğrudan migration/DEMO izinleri bu oturumun açık yasaklarını geçersiz kılmaz; güncel Y-07 kontrollü migrator tasarımı esas alınır.

## Değişen ve eklenen dosyalar

| Dosya                                                         | Değişiklik                                                                                     |
| ------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `shared/operation-recovery.ts`                                | İşlem listesi, sürüm, durumlar ve Türkçe mesajlar; yeni                                        |
| `server/stationos/request-recovery.ts`                        | Niyet rezervasyonu, bağlam hash'i, kilitleme, durum ve rollback sonrası hata kaydı; yeni       |
| `server/stationos/index.ts`                                   | Mevcut mutasyon sarmalayıcısına kurtarma; yetkili GET durum endpoint'i                         |
| `server/stationos/db.ts`                                      | Commit/rollback ACK ayrımı; belirsiz sonucu FAILED saymama                                     |
| `server/stationos/migrations/0007_request_recovery.sql`       | Yalnız yeni takip tablosu; hazırlanmış, uygulanmamış                                           |
| `migrations.manifest.json`                                    | Sekizinci SQL dosyasının SHA-256 envantere eklenmesi                                           |
| `client/src/lib/operation-recovery.ts`                        | Sadece metadata deposu, Web Locks, gönderim ve sorgu denetleyicisi; yeni                       |
| `client/src/lib/station-api.ts`                               | Kimlik doğrulamalı durum sorgusu                                                               |
| `client/src/hooks/useOperationRecovery.ts`                    | Yenileme, odak/storage olayları, polling ve kullanıcı ayrımı; yeni                             |
| `client/src/components/stationos/OperationRecoveryNotice.tsx` | Durum, sonuç, işlem kimliği ve inceleme uyarısı; yeni                                          |
| `client/src/pages/StationApp.tsx`                             | Tenant mutasyonlarının kalıcı takip akışına alınması                                           |
| `server/stationos/request-recovery.test.ts`                   | Sunucu durum, bağlama ve izolasyon testleri; yeni                                              |
| `server/stationos/operation-client.test.ts`                   | Kalıcı depo, yenileme, sekme yarışı, ağ kaybı testleri; yeni                                   |
| `server/stationos/transaction-evidence.test.ts`               | Commit ACK kaybı/rollback kanıt testleri; yeni                                                 |
| `server/stationos/invitation-flow.test.ts`                    | Gerçek handler üzerinde bellek transaction modeli; Y-01/Y-02 regresyonları ve Y-08 senaryoları |
| `server/migrations/catalog.test.ts`                           | Yeni katalog sayısı; eski dosya korumaları devam eder                                          |
| `tsconfig.phase1.json`                                        | Yeni testlerin statik kontrol kapsamı                                                          |
| `shared/station-contract.md`                                  | Yeni durum endpoint'i ve uyumluluk sınırları                                                   |
| `docs/faz1-y08-kalici-islem-kurtarma.md`                      | Bu teslim ve kurtarma prosedürü; yeni                                                          |

## Sunucu mimarisi ve atomiklik

Mevcut `st_requests` ve `(actor_user_id, request_id)` anahtarı korunur. Yeni `st_request_tracking` aynı anahtarla tenant, işlem, sürüm, rol/istasyon kapsamı ve hash'leri tutar. Ham mali payload, oturum anahtarı veya davet kodu yeni tabloya yazılmaz. Payload hash'i gizli bilgi şifrelemesi değildir; düşük entropili içerikler tahmin edilebilir. Bu alanlar yalnız sunucuda kalır; durum API'si hash'leri döndürmez.

1. Aktör yalnız doğrulanmış oturumdan alınır; tenant ve yetki kapsamı sunucudan okunur. İşlem türü Express rota yolundan gelir. `requestId` UUID doğrulaması korunur.
2. Hash; sürüm 2, aktör, tenant, rota, sıralanmış istasyon/rol kapsamı ve normalize payload'ı bağlar. Payload'dan requestId çıkarılır; nesne anahtar sırası canonical olur; `startsAt`, `endsAt`, `transactionAt` UTC anına normalize edilir. Diğer farklılıklar farklı payload sayılır; sessiz tutar/tarih dönüşümü yapılmaz.
3. Ayrı kısa transaction'da `INSERT IGNORE` + `SELECT ... FOR UPDATE` ile PROCESSING niyeti kalıcılaşır. Niyetin varlığı mali etki veya başarı kanıtı değildir. Farklı payload/rota/sürüm reddedilir; tenant veya yetki değişmişse işlem yürütülmez.
4. İş transaction'ı aynı takip satırını `FOR UPDATE` kilitler; ardından mevcut `st_requests` kilidi alınır. Mali kayıtlar, audit, mevcut sonuç kaydı ve takip COMPLETED güncellemesi **aynı bağlantıdaki aynı InnoDB transaction'ında** commit edilir. İkinci eşzamanlı istek bekler, sonra aynı sonucu okur; iş fonksiyonunu tekrar çalıştırmaz. FK ve unique anahtarlar veri modeline ek koruma sağlar.
5. İş transaction'ı commit denenmeden hata verir ve rollback ACK alınırsa ayrı transaction'da FAILED yazılır. Bu işlem takip satırını yeniden kilitler; eşzamanlı COMPLETED veya mevcut sonucu ezmez. Hata metni/payload yerine yalnız uygulama hata kodu saklanır.
6. Commit denenmişken ACK kaybı veya rollback bağlantı hatası kesin başarısızlık değildir. Başarı kalıcıysa durum sorgusu COMPLETED sonucunu bulur. Niyet kalmışsa sonuç belirsizdir; zaman aşımından sonra otomatik yeniden yürütülmez. Hata metadata yazımı da başarısızsa belirsizlik korunur.

Atomiklik sınırı DB içindeki işlemlerdir; harici banka/POS servisine exactly-once garantisi verilmez. Bu mutasyonlarda böyle bir entegrasyon eklenmedi. Kilitlerin canlı MySQL davranışı bu teslimde doğrulanmadı; testte seri transaction ve rollback modeli kullanıldı. Uzun işlemler için 30 saniye iptal/kilit TTL'si değildir; ihtiyatlı görünürlük eşiğidir. Tamamlanan işlem daha sonra yine COMPLETED okunur.

## Durum API'si ve veri izolasyonu

`GET /api/stationos/requests/status?requestId=UUID&tenantId=ID&operation=%2Fpayment&version=2`

Mevcut oturum middleware'i kullanılır; aktör parametresi kabul edilmez. Scope kontrolü ve sonuç okuma tek read transaction içindedir. API no-store politikası ve PWA'nın API cache dışlaması korunur.

| API durumu  | Kanıt ve istemci davranışı                                                                                                                                                  |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| NOT_FOUND   | Uygun kapsamda kayıt yok. Başka aktör/tenant/rota/sürüm/rol/istasyon da aynı yanıtı alır. Yeni kimlik üretilmez. İlk 30 saniyede tekrar sorgulanır; sonra inceleme gerekir. |
| IN_PROGRESS | Son 30 saniyede oluşturulmuş PROCESSING niyeti var; canlı worker garantisi değildir. İki saniyede bir yalnız GET yapılır.                                                   |
| COMPLETED   | Takip, bağlı hash ve çözülebilen sonuç eşleşir. Mevcut sonuç gösterilir; ikinci mali işlem yapılmaz.                                                                        |
| FAILED      | Rollback ACK sonrası kalıcı hata kanıtı var ve başarılı sonuç yok. Kullanıcı sonucu gördüğünü onaylayarak bekleyen kaydı kapatabilir. Aynı ID yeniden işlenmez.             |
| UNCERTAIN   | Eski/bozuk/gelecek tarihli niyet, çelişkili kayıt, çözülemeyen sonuç veya sorgu bağlantı hatası. Yeni POST/ID yok; yönetici incelemesi ve elle tekrar sorgu vardır.         |

Başka kullanıcı/tenant'a ait varlık veya sonuç açıklanmaz. Güncel rol/istasyon kapsamı değiştiğinde eski sonuç paylaşılmaz. Eski yetkiye geri dönene veya yönetici inceleyene kadar kullanıcı takibi kilitli kalabilir. Durum sorgusunda istemci payload'ı gerekmez.

## Tarayıcı, kullanıcı deneyimi ve güvenlik sınırları

Her kullanıcı/tenant için `stationos-pending-v2:<userId>:<tenantId>` anahtarı kullanılır. Depoda yalnız `userId`, `tenantId`, `requestId`, rota, sürüm ve UTC `createdAt` bulunur. Payload, tutar, kişi adı, parola, token, CSRF, davet kodu ve sonuç kalıcılaştırılmaz. Davet sonucu yalnız RAM'de ve yetkili ekranda gösterilir.

Web Locks, metadata claim/okuma/silme işlemlerini origin ve kullanıcı/tenant anahtarı üzerinde sıralar. İkinci sekme mevcut kimliği görür ve yalnız sorgular; yeni ID üretmez. Gecikmiş sekmenin silmesi kimlik karşılaştırmalıdır; daha yeni işlemi silemez. Her scope için tek bekleyen işlem vardır. Web Locks tüm ağ isteği boyunca tutulmaz; sekme kapanınca niyet kaybolmaz.

Yenileme, storage olayı ve pencere odağı takibi yeniden yükler. Başka kullanıcıya geçişte eski async yanıtlar ve eski görünür işlem filtrelenir. IN_PROGRESS sorgusu sürer. Belirsizlikte gösterilen mesaj:

> İşlemin sonucu henüz doğrulanamadı. Tekrar kayıt oluşturmadan önce işlem durumunu kontrol ediyoruz.

Kesinleştirilemeyen sonuçta aynı ID gösterilir ve yönetici incelemesi istenir. Belirsiz kayıt kapatma düğmesi yoktur. Doğrudan başarı yanıtı uygulamaya teslim edildikten sonra kayıt temizlenir; kurtarılan terminal sonuç kullanıcı onayına kadar tutulur. Tutar gibi eski form payload'ı depolanmadığından yenilemeden sonra otomatik POST yeniden oynatımı yapılmaz.

localStorage bir güvenlik sınırı veya sunucu yetkilendirme kaynağı değildir. Aynı origin'deki JS/XSS metadata'yı okuyabilir/değiştirebilir; paylaşılan cihazda anahtarlar kullanıcı/tenant ID'lerini gösterebilir. Sunucu tüm yetkileri bağımsız denetler. Tarayıcı verilerinin elle silinmesi, özel mod, profil/cihaz değişimi veya depolama kaybı kimliği kaybettirebilir; bu durumlarda kullanıcı tekrar kayıt açmadan mali kayıtları inceletmelidir. Metadata otomatik süreyle silinmez.

**Web Locks ve kalıcı depo kullanılamıyorsa mali istek gönderilmez.** HTTPS/localhost ve desteklenen tarayıcı gerekir. Laragon'un güvensiz LAN HTTP adresi için sertifika/HTTPS kurulumu veya desteklenen localhost erişimi pilot öncesinde doğrulanmalıdır. Windows ve Linux kod yolları aynıdır; gerçek tarayıcı, Linux, sekme kapanması ve mobil cihaz testi yapılmadı.

## Geriye dönük uyumluluk ve yeni migration

Yeni tenant mutasyonlarının body, URL ve başarılı response sözleşmesi korunur; ilave API sürüm header'ı gerekmez. `requestId` artık rota/tenant/kapsam/sürüm bağını da içerir. Aynı ID farklı işlemde kullanılamaz. Harici istemciler durum sorgusunu kullanabilir, fakat tarayıcıdaki tek-bekleyen kuralı sunucuda global işlem limiti değildir; farklı ID'lerle bağımsız işlemler hâlâ mümkündür.

Eski mali `st_requests` satırlarının yalnız body hash'inden tenant/işlem türü kanıtlanamaz. Bu nedenle dönüştürülmez ve otomatik kabul edilmez: tekrar POST `409 LEGACY_REQUEST_REVIEW_REQUIRED`, takip sorgusu NOT_FOUND döner. Eski boş sonuç REQUEST_REVIEW_REQUIRED üretir. Bu davranış eski replay tüketicileri için bilinçli uyumluluk riskidir; geçişte eski bekleyen isteklerin envanteri ve manuel uzlaştırılması gerekir. Eski davet replay'i yalnız Y-01 creator/tenant/istasyon denetimiyle salt okunur korunur; yeni takip satırı oluşturulmaz. Eski açık davet cevapları bu paketle dönüştürülmez.

Tenant henüz oluşmadığından `/setup`, `/join` kalıcı takip dışındadır; önceki idempotency davranışları korunur. `/assistant` salt okunurdur ve kendi cache/yetki sistemi devam eder. Tenant'a bağlı bütün mevcut mali mutasyonlar ortak kurtarma sarmalayıcısından geçer. Y-01 AES-GCM davet şifrelemesi, anahtar halkası ve izin doğrulaması; Y-02 açık saat farkı ve UTC/Türkiye gösterimleri korunur. Yeni anahtar gerekmez; mevcut `INVITATION_RESPONSE_ACTIVE_KEY` ve `INVITATION_RESPONSE_KEYS` güvenli sunucu yapılandırması ve önceki anahtarların erişilebilirliği gereklidir.

Yeni **0007_request_recovery.sql** yalnız `st_request_tracking` oluşturur. Eski kayıtlara UPDATE/DELETE/backfill yoktur. Manifestte önceki yedi giriş aynı kalır; sekizinci dosyanın checksum'u eklenir. Önce Drizzle, sonra operasyon 0001–0007 sırası Y-07 üzerinden korunur. Mevcut checksum/baseline geçmişi sıfırlanmaz. Y-07 startup readiness, bekleyen 0007 varken yeni uygulamanın açılmasını engeller; şema güncellemesini başlangıçta otomatik yapmaz. Çalışan eski servise bu kaynaklar onaysız kopyalanmamalıdır.

## Güvenli doğrulama

Yalnız aşağıdaki bağlantısız komutlar kullanılır. `verify-phase1` ortamı temizler, .env okumaz, gerçek mysql sürücülerini engeller; sahte transaction/depolar RAM'dedir. İzole DB bile kurulmadı veya kullanılmadı.

```text
node scripts/verify-phase1.mjs test
node scripts/verify-phase1.mjs build
node --import tsx scripts/migrations.ts check-files
```

4 Kasım 2026 bağlantısız doğrulama sonuçları (Node.js 24.14.0, Windows):

- `node scripts/verify-phase1.mjs test`: başarılı. Ana TypeScript kontrolü ve
  `tsconfig.phase1.json` kontrolü geçti; 17 dosyada 188 test başarılı.
- UTC, Europe/Istanbul ve America/New_York tekrarlarının her birinde 59 test
  başarılı. Bunlar ana paketteki testlerin saat dilimi tekrarlarıdır.
- `node scripts/verify-phase1.mjs build`: başarılı. Çıktı
  `.local/phase1-build/` altında. Vite, runtime config script etiketi ve
  500 kB üstündeki ana JS paketi için uyarı verdi.
- Migration envanteri: 8 dosya ve checksum doğrulaması başarılı. Manifest
  SHA-256: `12c87aeeea76b76c0a69b1742b5c4b1e5ac88114f6e3024e2ff5194fe5d6d9a8`.
  Doğrudan `tsx` komutu Windows `uv_os_get_passwd` / `ENOMEM` hatasıyla
  başlayamadı. Aynı CLI yerel esbuild ile `.local/verification/migrations.mjs`
  dosyasına derlendi ve `node .local/verification/migrations.mjs check-files`
  başarıyla çalıştırıldı; bağımlılık veya uygulama kodu değiştirilmedi.

Gerçek DB bağlantısı, migration uygulaması veya veri işlemi yapılmadı. Gerçek
MySQL deadlock/commit-kopması, Docker ve tarayıcı uçtan uca testleri bu
doğrulamanın kanıtı değildir. Ayrı izole DB kurulacaksa ortam, sentetik veri ve
silme planı önce hazırlanmalıdır.

## İnceleme, yedek ve geri alma prosedürü

1. Üretim öncesinde uygulama/image, manifest/SQL envanteri, DB tam yedeği ve geri yükleme provası ayrı onaylı bakımda hazırlanır. Şifreleme anahtarları yedeklerden ayrı güvenli kasada korunur. Bu çalışmada DB yedeği almak için bağlantı kurulmadı; kod değişikliği öncesi kaynak kopyası `.local/y08-source-backup/` altındadır. Korunan dosya hash'leri `.local/y08-protected-hashes.json` ile karşılaştırılır.
2. Belirsiz işlemde yeni ID üretmeyin, cache/metadata/işlem satırı silmeyin. Aktör, tenant, rota, ID, release ve hata kodunu kaydedin; tutar/payload/token loglamayın. İlgili aktif worker ve transaction'ın bitip bitmediğini yetkili bakımda inceleyin.
3. Onaylı salt okunur incelemede `st_request_tracking`, `st_requests`, ilgili mali kayıt ve audit birlikte karşılaştırılır. COMPLETED + bağlı geçerli sonuç varsa aynı sonuç tekrar sorgulanır. Niyet tek başına başarı veya rollback değildir. Tracking yokken eski cache'in tenant'ını body hash'inden varsaymayın.
4. Belirsizlik çözülemiyorsa işlemleri durdurun, kayıtları koruyun ve yönetici incelemesini sürdürün. Elle COMPLETED/FAILED işaretlemek, mali kaydı değiştirmek veya yeni ID ile telafi etmek bu paketin otomatik özelliği değildir; kanıtlı, ayrıca onaylı düzeltme planı gerekir.
5. Henüz dağıtılmadığı için mevcut geliştirmeyi geri almak, yalnız rapordaki Y-08 dosyalarını ön-kopyalarıyla geri yüklemek/yeni dosyaları release kapsamından çıkarmaktır. AGENTS/CLAUDE ve eski SQL'e dokunulmaz; tüm çalışma ağacı resetlenmez. Manifest de ilgili release ile birlikte geri alınır.
6. Gelecekte migration uygulanmışsa takip tablosunu, mali kayıtları veya migration geçmişini silmeyin. Eski uygulama güncel native migration geçmişini tanımayıp durabilir. Yazma trafiğini kapatın; şemayı koruyan ve Y-08 işlem kimliklerini güvenle anlayan onaylı uyumlu hotfix kullanın. Eski body-hash/idempotency istemcisine kör rollback yapmayın. Tarayıcı metadata'sını silip yeniden göndermek güvenli rollback değildir. Trafik sonrası eski DB yedeğini doğrudan yüklemek yeni mali kayıtları kaybettirebilir.

## Üretimden önce gerekenler ve onaylar

- Bu kod tesliminin kullanıcı değerlendirmesi; üretim dağıtımı için ayrı açık onay.
- Ayrı izole MySQL/MariaDB ve gerçek tarayıcı pilotunun ortam/veri/temizlik planı ve onayı. Gerçek satır kilidi, rollback ve commit-ACK kopması; Windows/Laragon HTTPS, Linux/Docker, mobil ve çok sekme doğrulaması.
- Eski mali requestId envanterinin salt okunur incelemesi; belirsiz/legacy isteklerin operatör prosedürü ve harici API tüketicilerinin uyumluluk kabulü.
- Hedef DB motorları, FK tipleri, UTC bağlantıları ve tüm mali tabloların InnoDB olduğu yetkili ortamda doğrulanmalı. Bunlar gerçek DB üzerinde doğrulanmadı.
- DB yedek/geri yükleme kabulü; Y-07 manifest hash'inin bağımsız release onayı. Baseline gerekiyorsa yalnız eski native geçmişin kanıtlı incelemesiyle ve ayrı baseline onayı; yeni 0007'yi uygulanmış sayan baseline yapılmaz.
- 0007 migration için ayrı uygulama onayı; ardından Y-07 readiness ve kontrollü dağıtım. Otomatik migration yoktur. Ayrıntılı bakım komutları `docs/faz1-paket3-migration-guvenligi.md` içindedir ve bu geliştirmede çalıştırılmadı.
- Davet anahtar halkası/rotasyon, HTTPS, tarayıcı desteği ve belirsiz işlem sorumlularının kabulü. Takip tablosu/depo için retention/mahremiyet politikası ayrıca tasarlanmalıdır; otomatik temizlik eklenmedi.

Geliştirme bu paketle sınırlıdır; sonraki paket veya üretim işlemi için yeni onay beklenir.

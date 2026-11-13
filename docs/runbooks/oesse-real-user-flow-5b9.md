# Faz 5B.9 — ÖSSE gerçek kullanıcı akışı hazırlığı

## Güvenli sentetik görsel inceleme

Proje kökünde normal Windows PowerShell kullanın:

```powershell
Set-Location 'C:\laragon\www\istasyonos-main'
node .\scripts\staffing-browser-test.mjs --manual
```

Komut `MANUAL_SERVER_READY` ile hostu, portu ve `http://127.0.0.1:<geçici-port>/` adresini yazdırır. Bu adresi kendi normal Chrome/Edge pencerenizde açın. Sayfadaki yönetici, ÖSSE ve muhasebe panelleri sentetiktir; uygulama API'sine, MySQL'e veya OCR servisine bağlanmaz. Sayfa yalnız bu geçici localhost origininde sentetik IndexedDB kayıtları oluşturabilir. Sunucu stdin/PowerShell Enter olaylarına bağlı değildir ve HTTP isteğinden sonra çalışmayı sürdürür.

İnceleme bittiğinde sayfanın üstündeki yerel depolama temizleme bağlantısına tıklayın; bu işlem sunucuyu kapatmaz. Sekmeyi kapatın ve sunucuyu Ctrl+C ile veya sayfadaki ayrı **Sentetik sunucuyu kapat** düğmesiyle sonlandırın. Sunucu bu iki açık eylemden biri gelene kadar çalışır. Bu akış görsel/manual kontroldür; DOM testi veya gerçek uygulama akışı PASS'i değildir.

Kontrol listesi:

1. Yönetici fixture'ında davet rolünün `FUEL_STAFF`, istasyonun yetkili istasyon olduğunu görün. Gerçek davet gönderilmez.
2. Atama özelliği kapalı fixture'ında istasyon/shift atama kontrolünün devre dışı kaldığını görün. Açık fixture yalnız UI dalı testidir; gerçek şema varlığı anlamına gelmez.
3. ÖSSE fixture'ında sentetik açık vardiyayı ve nakit, havale/IBAN, cari beyan alanlarını inceleyin.
4. Bekleyen çevrimdışı kayıt etiketini görün; sunucu kabulü veya muhasebeye teslim edilmiş gibi gösterilmediğini doğrulayın.
5. Muhasebe fixture'ında ilk beyan snapshot'ını otomasyon toplamından ayrı, düzeltmeyi taslak olarak ve bağımsız gün sonunu beklemede görün.
6. Başka tenant/istasyon/vardiya/personel kapsamı fixture'larında karşılaştırmanın kapandığını görün.

## Gerçek uygulamadaki mevcut akış

Uygulama girişi `https://istasyonos-main.test` adresindeki yerel ortamdır. `LocalLoginForm` mevcut yerel kullanıcı/parola girişini ve yeni hesap formunu kullanır. Parola en az 12 karakterdir. Kayıt olmak tek başına şirket veya istasyon yetkisi vermez. Davetli çalışan `/setup` ekranında tek kullanımlık davet koduyla katılır. Yönetici ekranı `/personel` üzerinden `Personel davet et` akışını açar; davet kodu 7 gün geçerlidir ve yalnız davet edilen kişiyle paylaşılmalıdır.

Gerçek akışta FUEL_STAFF daveti/üyeliği, istasyon erişimi, vardiya ataması, yeni vardiya hesabı, ödeme beyanı ve muhasebe ön incelemesi DB'ye yazabilir veya mevcut kayıtları okuyabilir. Bu nedenle aşağıdaki izole test önkoşulları tamamlanmadan bu adımlar gerçek uygulamada denenmemelidir.

## Şema kapıları ve durum

- **FUEL_STAFF davet/katılım:** mevcut auth, tenant ve invitation şemasıyla kullanılabilir olabilir; yalnız test DB hedefi uygulama tarafından doğrulanınca denenebilir. Gerçek kullanıcı/DB akışı bu çalışmada test edilmedi.
- **İstasyon kapsamını yönetme ve vardiyaya personel atama:** `staffingFeaturesAvailable` için `st_member_stations` durum alanı, vardiya ataması ve staffing event şeması gerekir. Bunlar `0020_personnel_shift_assignments.sql.draft` içindedir; taslak katalog dışındadır. Özellik **BLOCKED**.
- **ÖSSE'nin atanmış vardiyayı görmesi ve yeni vardiya hesabı açması:** sunucu aynı staffing feature gate'i uygular. Atama şeması yokken hesap açma kapalıdır. **BLOCKED**.
- **Nakit/havale/cari beyanı:** yalnız önceden sunucuda açılmış, o personel ve vardiyayla doğrulanmış hesabın var olan kayıt akışında denenebilir. 0020 olmadan yeni atanmış vardiyadan uca kadar akış doğrulanamaz. Otomatik hesap açma veya kapsamı aşma yolu kullanılmamalıdır.
- **Çevrimdışı kuyruk:** sentetik/local origin testi mümkün; gerçek kullanıcı hesabının kayıtlarını eşitlemek için gerçek API, DB, doğru var olan vardiya ve oturum gerekir. Bu testte **NOT_RUN**.
- **FAST:** 0018 uygulanmadığından kapalı.
- **POS slip OCR:** 0019 uygulanmadığından DB özelliği kapalı. Manuel ödeme beyanı ve OCR aynı özellik değildir.
- **Muhasebe incelemesi:** sentetik panel incelemesi mümkün. Gerçek snapshot/otomasyon/gün sonu API ve MySQL doğrulaması **NOT_RUN**; bağımsız gün sonu yoksa kesin mutabakat kapalıdır.

## Gerçek DB/API testine geçmeden önce gerekenler

1. `istasyonos_demo` veya uygulamanın ana bağlantısı kullanılmadan, adı/hostu açıkça onaylanmış ayrı ve atılabilir uygulama test veritabanı olmalı. Mevcut boş `istasyonos_migration_trial`, uygulama şeması değildir.
2. Test DB'si için sıfırdan kanonik migration sırası, 0018/0019 ve personel ataması ihtiyacı ayrıca incelenip yetkili operatörce onaylanmalı. 0020 taslağı kendi başına uygulanamaz; önce kanonik numarası, checksum/manifest, bağımlılık ve migrator güvenliği belirlenmeli. Bu işlemler şimdi yapılmadı.
3. Uygulama yalnız test DB'ye bağlanacak şekilde ayrıca doğrulanmalı. Gerçek `DATABASE_URL` değiştirilmemeli; hedef/etkin kullanıcı aynı bağlantıda teyit edilmeli. Aksan ve diğer projeler erişim dışında kalmalı.
4. Kurgusal MANAGER, FUEL_STAFF ve ACCOUNTANT hesapları; test tenant/istasyon, cari hesap, açık vardiya/atama ve sentetik kaynak raporları hazırlanmalı. Kişisel/gerçek müşteri bilgisi kullanılmamalı.
5. Başlamadan önce atılabilir test DB'si için onaylı geri dönüş planı ve DB snapshot/yeniden oluşturma sahibi belirlenmeli. Uygulama testinde her eklenen davet, ödeme, slip ve snapshot'ın test kapsamından çıkmayacağı; yalnız atılabilir DB'nin resetlenebileceği bilinmeli. Mevcut DB'lerde rollback/silme yapılmamalı.
6. Çıkışta sentetik hesaplarla giriş, mobil hesap, offline kuyruk, tekrar gönderim, muhasebe okuması ve ret/çakışma kontrolleri ayrı ayrı çalıştırılmalı. Server acknowledgement olmadan cihaz kuyruğu temizlenmemeli.

Bu önkoşullar sağlanmadı: gerçek DB/API/cihaz testi **NOT_RUN**, migration **NO-GO**. 0018/0019 uygulanmadı; 0020 yalnız taslak ve katalog dışındadır.

## 0020 taslağına bağlı akış — uygulama kapalı

0020 taslağı şu mevcut yapılara dayanır: `st_stations(tenant_id,id)` ve
`st_shifts(tenant_id,station_id,id)` için bileşik benzersiz anahtarlar;
`st_member_stations` üzerinde ACTIVE/INACTIVE üyelik durumu ve aynı tenant
istasyonuna bileşik FK; atanmış personel/shift için benzersiz üyelik satırı,
tenant-istasyon-shift-user kapsamı ve atayan/güncelleyen üyelik FK'leri olan
`st_shift_assignments`; tenant/istasyon/shift/personel/actor kapsamlı
`st_staffing_events`. Taslak ayrıca mevcut `st_members`, `st_shifts` ve
`st_member_stations` tablolarının beklenen anahtar ve veri tiplerine sahip
olmasını gerektirir. Bu not statik taslak bağımlılık özetidir; gerçek şema
uyumluluğu veya migration güvenliği kanıtı değildir. Taslak migration kataloğuna
eklenmemeli ya da uygulanmamalı; feature gate kapalı kalmalıdır.

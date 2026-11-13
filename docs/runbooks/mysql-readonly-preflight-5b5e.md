# Faz 5B.5M - Salt okunur MySQL hedef on kontrolu

> **Güncel yöntem:** 10 Kasım 2026 itibarıyla `.env` tabanlı `ST_TRIAL_DB_*` bölümü ve `node .\scripts\trial-db-readonly-preflight.mjs` komutu yetkilidir. Önceki option-file/`mysql.exe` örnekleri tarihsel olup çalıştırılmamalıdır. `DATABASE_URL` bu kontrolde kullanılmaz.

## Operator tarafindan bildirilen hedef durumu

- MySQL: `DESKTOP-LPUUGML:3306`, surum 8.0.30.
- Veritabani: `istasyonos_migration_trial` olusturulmus; operator son kontrolde 0 tablo oldugunu dogruladi.
- Bu veritabani yeniden olusturulmayacak, silinmeyecek veya temizlenmeyecek.
- `st_trial_ro` hesabinin olusturulmasi ve yalniz bu DB'de SELECT yetkisi henuz dogrulanmadi.
- Bu nedenle su anki karar **NO-GO**. Asagidaki sorgular ancak DBA `st_trial_ro` hesabini yalniz SELECT ile hazirladiktan, option dosyasini sagladiktan ve operator baglanti hedefini onayladiktan sonra salt okunur olarak calistirilabilir.

Bu dosya DB olusturmaz, tablo olusturmaz, migration/seed/DML calistirmaz. `.env` kullanilmaz; parola komut satirina yazilmaz.

## On kosullar

1. Normal Windows PowerShell'i acin.
2. DBA tarafindan olusturulmus option dosyasinin yolunu `$env:ISTASYONOS_READONLY_CNF` olarak ayarlayin. Dosyada `st_trial_ro` parolasi bulunabilir; icerigini ekrana basmayin, Git'e eklemeyin ve komut gecmisine yazmayin.
3. DBA `st_trial_ro` icin yalniz `istasyonos_migration_trial` semasinda `SELECT` vermeli. Global, baska schema, `CREATE`, `ALTER`, `DROP`, `INSERT`, `UPDATE`, `DELETE`, `GRANT OPTION` yetkisi olmamali.
4. Aşağıdaki komut hedef DB ve sunucu adini sabit kontrol eder. Beklenmedik sonuc, yetki belirsizligi veya host uyusmazliginda durun. Kimlik bilgilerini rapora koymayin.

## Salt okunur hedef dogrulama komutu

```powershell
$ErrorActionPreference = 'Stop'
$TargetDb = 'istasyonos_migration_trial'
$ExpectedHost = 'DESKTOP-LPUUGML'
$ExpectedPort = 3306
$ExpectedUser = 'st_trial_ro'
$DefaultsFile = $env:ISTASYONOS_READONLY_CNF
$MysqlCommand = Get-Command mysql.exe -ErrorAction SilentlyContinue

if ([string]::IsNullOrWhiteSpace($DefaultsFile) -or !(Test-Path -LiteralPath $DefaultsFile -PathType Leaf)) {
  throw 'NO-GO: DBA option dosyasi yok; baglanti denenmedi.'
}
if (!$MysqlCommand) {
  throw 'NO-GO: mysql.exe bulunamadi; kurulum/izin degisikligi yapmayin.'
}
$MysqlExe = $MysqlCommand.Source
$IdentitySql = 'SELECT CONCAT_WS(CHAR(9), DATABASE(), @@hostname, @@port, CURRENT_USER())'
$Identity = & $MysqlExe "--defaults-extra-file=$DefaultsFile" "--host=$ExpectedHost" "--port=$ExpectedPort" "--user=$ExpectedUser" --batch --raw --skip-column-names "--execute=$IdentitySql" $TargetDb
if ($LASTEXITCODE -ne 0) { throw 'NO-GO: hedef kimligi okunamadi; yetki veya baglanti hatasi.' }
$Parts = ([string]$Identity).Trim() -split "`t", 4
if ($Parts.Count -ne 4 -or $Parts[0] -cne $TargetDb -or $Parts[1] -cne $ExpectedHost -or [int]$Parts[2] -ne $ExpectedPort -or $Parts[3].Split('@')[0] -cne $ExpectedUser) {
  throw 'NO-GO: DB, sunucu, port veya MySQL hesabi operator hedefiyle ayni degil.'
}
Write-Output "Hedef kimligi eslesti: DB=$($Parts[0]); server=$($Parts[1]); port=$($Parts[2]); user=$ExpectedUser"

$Grants = @(& $MysqlExe "--defaults-extra-file=$DefaultsFile" "--host=$ExpectedHost" "--port=$ExpectedPort" "--user=$ExpectedUser" --batch --raw --skip-column-names '--execute=SHOW GRANTS' $TargetDb)
if ($LASTEXITCODE -ne 0 -or !$Grants.Count) { throw 'NO-GO: SHOW GRANTS okunamadi.' }
$Grants | ForEach-Object { Write-Output $_ }
$GrantCheck = Read-Host 'Grant satirlarini inceleyin: yalniz st_trial_ro USAGE ve istasyonos_migration_trial.* uzerinde SELECT var; baska/global yetki yok mu? YES yazin'
if ($GrantCheck -cne 'YES') { throw 'NO-GO: kullanici yetkisi izole olarak dogrulanmadi.' }

$CountSql = 'SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE()'
$TableCount = & $MysqlExe "--defaults-extra-file=$DefaultsFile" "--host=$ExpectedHost" "--port=$ExpectedPort" "--user=$ExpectedUser" --batch --raw --skip-column-names "--execute=$CountSql" $TargetDb
if ($LASTEXITCODE -ne 0 -or [int]$TableCount -ne 0) {
  throw 'NO-GO: hedef bos DB olarak beklenenden farkli; tablo degistirmeyin, durun.'
}
Write-Output 'Salt okunur kontrol PASS: operatorun bildirdigi hedef eslesti ve tablo sayisi 0.'
Write-Output 'Migration durumu yine NO-GO: bu DB henuz 0001-0017 kanonik sema/gecmisini icermiyor.'
```

## Sonuc ve sonraki engel

- Bu kontrol `st_trial_ro` varligini ve kapsamli grant'lerini komut calistirilmadan once varsaymaz. Hesap yoksa DBA'nin hazirlamasi gerekir; hesap/option dosyasi yokken baglanti denemeyin.
- Salt okunur kontrol hedefi ve bos DB durumunu teyit eder. Bos veritabaninda 0018/0019/0020 provasi yapilamaz; kanonik 0001-0017 semasinin kontrollu sekilde yalniz bu disposable DB'ye hazirlanmasi ve migrator kullanacak ayri, bu DB ile sinirli bir yazi kullanicisinin acikca saglanmasi gerekir. Bu runbook bu hazirligi yapmaz.
- Migration gecmisindeki eski SQL checksum kaniti `UNKNOWN` kalir. Otomatik baseline, checksum duzeltme veya migration uygulama yoktur.
- `istasyonos_demo`, ana uygulama ve Aksan hedefleri bu prosedurun kapsami disindadir; onlara baglanmayin.

## Resmi migrator hedef kontrolu

Guncel CLI her acik `status/apply/baseline` komutunda manifesti DB baglantisindan once dogrular. Baglanti acildiktan sonra ayni fiziksel connection'da `DATABASE()`, `@@hostname`, `@@port`, `CURRENT_USER()` ve `CURRENT_ROLE()` kontrol edilir; varsa beklenen `@@server_uuid` de kontrol edilir. Bu kontrol basarisizsa `runMigrations` cagrilmaz, dolayisiyla lock, bootstrap veya migration SQL'i calismaz. Connection pool/reconnect kullanilmaz.

Trial profili yalniz su hedefe izin verir: `127.0.0.1:3306`, server `DESKTOP-LPUUGML`, DB `istasyonos_migration_trial`, MySQL etkin principal `stationos_trial_migrator@127.0.0.1` ve manifest SHA-256 `3e6ce8ee6a5a295bdcddc3b5de271f4299f838bc40632bab26cac6a99611ff01`. Hesabın gerçek varlığı/hostu DBA tarafından doğrulanana kadar bu değer varsayılmış kimlik sayılmaz ve bağlantı yapılmaz. `--expected-current-user` birebir bu principal olmalıdır; başka kullanıcı veya host fail-closed reddedilir. `status`, `apply` ve `baseline` modlarında aynı bağlantıda `CURRENT_ROLE()` NONE ve `SHOW GRANTS` hedef-yetki allowlist'i kontrol edilir. `status` mutasyon yapmaz fakat migration hesabının grant sınırını daima doğrular. Global veya diğer schema grant'i, grant option, aktif/atanmış rol ya da belirsiz grant formatı fail-closed reddedilir.

### Güncel salt-okunur ön kontrol — `ST_TRIAL_DB_*`

Yeni `.env` bağlantısı yalnız bu özel kontrol için kullanılır; `DATABASE_URL` okunmaz veya değiştirilmez. Script host/port/DB/kullanıcıyı önceden sabit hedefle karşılaştırır, `ST_TRIAL_DB_READ_ONLY=true` ister ve yalnız `SELECT` kimlik sorguları, `SHOW GRANTS` ve tablo sayısı için bir `SELECT` çalıştırır. Grant'ler yalnız `istasyonos_migration_trial.*` üzerinde `SELECT`/`SHOW VIEW` ve global `USAGE` olmalıdır; aktif rol, farklı host, DB, port, hesap veya daha geniş grant reddedilir. Parola hiçbir çıktıya yazılmaz. Hata halinde başka bağlantıya geçilmez.

Normal Windows PowerShell'de proje kökünde çalıştırın:

```powershell
Set-Location 'C:\laragon\www\istasyonos-main'
node .\scripts\trial-db-readonly-preflight.mjs
```

`READ_ONLY_PREFLIGHT_PASS` yalnız script gerçek MySQL bağlantısını kurup kimlik ve grant kontrollerini başarıyla tamamladıysa yazılır. `READ_ONLY_PREFLIGHT_NOT_PASS` durumunda hata kodunu raporlayın; bağlantı bilgisi veya parolayı paylaşmayın. Script hiçbir migration, seed, `CREATE`, `UPDATE` veya `DELETE` çalıştırmaz.

2026-11-10 önceki gerçek deneme sonucu `ER_ACCESS_DENIED_ERROR` idi; sonraki operatör çalıştırmasında alınan `ER_PARSE_ERROR` için eski script SQL aşaması göstermedi. Eski birleşik sorgudaki `AS current_user` alias'ı MySQL 8.0'da reserved keyword olduğundan syntax hatasının nedeni olarak tespit edildi; alias `effective_account` yapıldı, sorgular ayrı aşamalara bölündü. Güncel gerçek deneme: **PASS**; hedef kimliği, etkin kullanıcı/rol, server UUID, SELECT/SHOW VIEW grant kapsamı ve tablo sayısı kontrol edildi. Tablo sayısı 0. Önceki hata sonuçları güncel başarılı denemeyle geçersiz kaldı; kimlik/parola çıktıya alınmadı.

`ST_TRIAL_DB_READ_ONLY` beyanı tek başına MySQL yetkisi oluşturmaz; izinleri `SHOW GRANTS` ile doğrularız. Bu hesap yalnız `st_trial_ro` kullanıcı adıyla eşleşen SELECT/SHOW VIEW hesabı olmalıdır. Bu ön kontrol migration yazma kullanıcısını doğrulamaz ve migration onayı değildir.

### Legacy option-file yönergeleri (kullanmayın)

Önceki `ISTASYONOS_READONLY_CNF` ile `mysql.exe` örnekleri yeni `.env` tabanlı script ile değiştirilmiştir. Aşağıdaki eski örnekler yalnız geçmiş kayıt içindir; çalıştırmayın.

Bu komutlar `st_trial_ro` hesabini yaratmaz, privilege vermez ve parolayi ekrana basmaz. Hesap veya option dosyasi yoksa **NO-GO**; DBA hazirlayana kadar calistirmayin. Trial veritabani operator tarafindan bos olarak dogrulanmistir; bu komut DB olusturmaz veya degistirmez.

```powershell
$ErrorActionPreference = 'Stop'
$TargetDb = 'istasyonos_migration_trial'
$ExpectedHost = 'DESKTOP-LPUUGML'
$ExpectedPort = 3306
$ExpectedUser = 'st_trial_ro'
$DefaultsFile = $env:ISTASYONOS_READONLY_CNF
$MysqlCommand = Get-Command mysql.exe -ErrorAction SilentlyContinue
if ([string]::IsNullOrWhiteSpace($DefaultsFile) -or !(Test-Path -LiteralPath $DefaultsFile -PathType Leaf)) { throw 'NO-GO: DBA option dosyasi yok.' }
if (!$MysqlCommand) { throw 'NO-GO: mysql.exe bulunamadi.' }
$MysqlExe = $MysqlCommand.Source
$IdentitySql = 'SELECT CONCAT_WS(CHAR(9), DATABASE(), @@hostname, @@port, CURRENT_USER(), @@server_uuid)'
$Identity = & $MysqlExe "--defaults-extra-file=$DefaultsFile" "--host=127.0.0.1" "--port=$ExpectedPort" "--user=$ExpectedUser" --batch --raw --skip-column-names "--execute=$IdentitySql" $TargetDb
if ($LASTEXITCODE -ne 0) { throw 'NO-GO: baglanti/kimlik sorgusu basarisiz.' }
$Parts = ([string]$Identity).Trim() -split "`t", 5
if ($Parts.Count -ne 5 -or $Parts[0] -cne $TargetDb -or $Parts[1] -cne $ExpectedHost -or [int]$Parts[2] -ne $ExpectedPort -or $Parts[3].Split('@')[0] -cne $ExpectedUser -or [string]::IsNullOrWhiteSpace($Parts[4])) { throw 'NO-GO: DB, host, port, etkin hesap veya UUID eslesmedi.' }
Write-Output "Salt okunur kimlik eslesti: DB=$($Parts[0]); server=$($Parts[1]); port=$($Parts[2]); user=$ExpectedUser; UUID alindi."
$Grants = @(& $MysqlExe "--defaults-extra-file=$DefaultsFile" '--host=127.0.0.1' "--port=$ExpectedPort" "--user=$ExpectedUser" --batch --raw --skip-column-names '--execute=SHOW GRANTS' $TargetDb)
if ($LASTEXITCODE -ne 0 -or !$Grants.Count) { throw 'NO-GO: SHOW GRANTS basarisiz.' }
$Grants | ForEach-Object { Write-Output $_ }
$GrantCheck = Read-Host 'Yalniz st_trial_ro USAGE ve target DB SELECT granti var mi? YES'
if ($GrantCheck -cne 'YES') { throw 'NO-GO: okuyucu grant kapsamı dogrulanmadi.' }
$TableCount = & $MysqlExe "--defaults-extra-file=$DefaultsFile" '--host=127.0.0.1' "--port=$ExpectedPort" "--user=$ExpectedUser" --batch --raw --skip-column-names '--execute=SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE()' $TargetDb
if ($LASTEXITCODE -ne 0 -or [int]$TableCount -ne 0) { throw 'NO-GO: beklenen bos trial hedefi degismis; durun.' }
Write-Output 'Salt okunur preflight PASS. Bu, migration izni veya migration onayi degildir.'
```

Yukardaki `st_trial_ro` kontrolu yalniz salt okunur hedef teyididir; migrator icin gereken ayri sinirli yazma hesabini dogrulamaz. `CURRENT_USER()` degerini ve server UUID'yi guvenli sekilde not edin. Daha sonra migration provasi ancak DBA tarafindan yalniz bu trial DB'ye yetkili ayri hesap ve operatorun ayri acik uygulama onayi saglandiktan sonra planlanabilir. Olası komut taslagi (BU TURDA CALISTIRMAYIN; yazma yapar ve ek onay gerektirir):

```powershell
node --import tsx .\scripts\migrations.ts apply `
  --database istasyonos_migration_trial `
  --manifest-sha256 3e6ce8ee6a5a295bdcddc3b5de271f4299f838bc40632bab26cac6a99611ff01 `
  --target-profile istasyonos-trial `
  --expected-current-user '<DBA-dogruladigi-user@host>' `
  --apply
```

Bu taslak calistirilirsa kanonik `0000` + `0001–0019` sirasinin tum bekleyen parcalari uygulanir; bos DB'de yalniz 0018/0019 uygulanmaz. 0020 yalniz taslak olarak kalir. `istasyonos_demo`, ana ve Aksan DB'leri bu hedef profilinde reddedilir. Tarihsel SQL checksum kaniti halen `UNKNOWN`; bu uygulama onayi/DB tarihi riskini ortadan kaldirmaz. Bu turda komut calistirilmadi; migration durumu **NO-GO**.

## Faz 5B.5Q — ayrı trial migrator hesabı hazırlığı (BU TURDA ÇALIŞTIRILMADI)

### Yetki kapsamı

Resmî migrator SQL dosyalarının kendisi DML çalıştırmaz. Bununla birlikte MySQL 8.0, `ALTER TABLE` için `CREATE` ve `INSERT` yetkileri de ister. Bu nedenle yalnız geçmiş tablolarına DML vermek yeterli değildir. Sınırlı model: schema seviyesinde `CREATE, ALTER, REFERENCES`; yalnız `st_slips`, `st_tank_photo_reviews`, `st_daily_report_packages`, `st_tank_requests`, `st_tanker_document_reads` ve `st_payments` tablolarında `CREATE, INSERT`; `st_slips` üzerinde ek olarak `INDEX`; migrator geçmiş tablolarında ise `__drizzle_migrations` ve `st_schema_migrations` için `SELECT, INSERT`, `st_migration_guard` için `SELECT, INSERT, UPDATE`. Bu altı iş tablosundaki `INSERT` yalnız MySQL `ALTER TABLE` yetki kontrolünü karşılar; migration SQL'lerinde satır ekleme/güncelleme yoktur. Hedef tablo grant'lerinde `CREATE`, MySQL'in henüz yaratılmamış tabloya grant hazırlama koşulu içindir. `DROP`, `DELETE`, `UPDATE` iş tablosu yetkisi, `SELECT` iş tablosu yetkisi, `GRANT OPTION`, global/baska şema yetkisi ve MySQL rolü yoktur. Sadece bu hesap için `CURRENT_ROLE()` sonucu `NONE` olmalı. Bu sınır MySQL 8.0 yetki kurallarına göre statik olarak çıkarılmıştır; gerçek grant/DDL uyumluluğu yalnız ayrı trial hesabı ve atılabilir DB üzerinde sonradan doğrulanabilir.

### DBA için hazırlanmış SQL (önceki salt-okunur kontrol PASS olmalı)

Bu SQL **yalnız ayrı uygulama onayı ve DBA tarafından trial hedefinin son kez doğrulanmasından sonra** interaktif MySQL oturumunda uygulanabilir. Burada hiçbir kullanıcı oluşturulmadı veya grant verilmedi. Önce hesabın zaten bulunmadığını kontrol edin; mevcutsa **durun, değiştirmeyin**:

```sql
SELECT user, host
FROM mysql.user
WHERE user = 'stationos_trial_migrator';
```

Sonuç boşsa ve DBA doğru `DESKTOP-LPUUGML:3306` sunucusunda olduğunuzu doğruladıysa hesap ve yalnız trial şema grant'i:

```sql
CREATE USER 'stationos_trial_migrator'@'127.0.0.1'
  IDENTIFIED BY RANDOM PASSWORD;

GRANT CREATE, ALTER, REFERENCES
  ON `istasyonos_migration_trial`.*
  TO 'stationos_trial_migrator'@'127.0.0.1';

-- ALTER TABLE requires INSERT on the altered table. CREATE is included so
-- these table-scoped grants can be prepared before the tables exist.
GRANT CREATE, INSERT, INDEX
  ON `istasyonos_migration_trial`.`st_slips`
  TO 'stationos_trial_migrator'@'127.0.0.1';
GRANT CREATE, INSERT
  ON `istasyonos_migration_trial`.`st_tank_photo_reviews`
  TO 'stationos_trial_migrator'@'127.0.0.1';
GRANT CREATE, INSERT
  ON `istasyonos_migration_trial`.`st_daily_report_packages`
  TO 'stationos_trial_migrator'@'127.0.0.1';
GRANT CREATE, INSERT
  ON `istasyonos_migration_trial`.`st_tank_requests`
  TO 'stationos_trial_migrator'@'127.0.0.1';
GRANT CREATE, INSERT
  ON `istasyonos_migration_trial`.`st_tanker_document_reads`
  TO 'stationos_trial_migrator'@'127.0.0.1';
GRANT CREATE, INSERT
  ON `istasyonos_migration_trial`.`st_payments`
  TO 'stationos_trial_migrator'@'127.0.0.1';

GRANT CREATE, SELECT, INSERT
  ON `istasyonos_migration_trial`.`__drizzle_migrations`
  TO 'stationos_trial_migrator'@'127.0.0.1';

GRANT CREATE, SELECT, INSERT
  ON `istasyonos_migration_trial`.`st_schema_migrations`
  TO 'stationos_trial_migrator'@'127.0.0.1';

GRANT CREATE, SELECT, INSERT, UPDATE
  ON `istasyonos_migration_trial`.`st_migration_guard`
  TO 'stationos_trial_migrator'@'127.0.0.1';

SHOW GRANTS FOR 'stationos_trial_migrator'@'127.0.0.1';
```

MySQL 8.0.30 `IDENTIFIED BY RANDOM PASSWORD` támogatja a szerver által generált jelszót. A parancs eredménye egyszer megjeleníti a titkot: PowerShell transcript/átirányítás nélkül, jóváhagyott jelszókezelőbe mentse; ne tegye parancssorba, kódba, ticketbe vagy riportba. A fiók SQL-host része `127.0.0.1`; ha a MySQL `CURRENT_USER()` ettől eltérő host-fiókot választ, a migrator fail-closed leáll, ne hozzon létre másik hosthoz szélesebb fiók.

MySQL 8.0.30 sunucusu `CREATE USER ... IDENTIFIED BY RANDOM PASSWORD` sözdizimini destekler; üretilen parola sonuç satırında açık görünür ve güvenli bir sır yöneticisine alınmalıdır ([MySQL parola üretimi](https://dev.mysql.com/doc/refman/8.0/en/password-management.html)). MySQL, `CREATE` yetkili hesaplara henüz yaratılmamış tablolara tablo-seviyesi grant hazırlamaya izin verir ([MySQL GRANT](https://dev.mysql.com/doc/refman/8.0/en/grant.html)). MySQL 8.0 belgesine göre `ALTER TABLE` ayrıca `CREATE` ve `INSERT` ister; foreign key oluşturma parent tablo için `REFERENCES`, ALTER ile indeks ekleme ise `INDEX` ister ([MySQL privileges](https://dev.mysql.com/doc/refman/8.0/en/privileges-provided.html), [MySQL foreign keys](https://dev.mysql.com/doc/refman/8.0/en/create-table-foreign-keys.html)). Bu yüzden hazırlanan grant'ler DML'yi yalnız gerekli tablo seviyelerinde tutar.

Yalnız DBA tarafından hesap kurulduktan sonra, secret'i mevcut `DATABASE_URL` yerine geçirmeden ayrı `.env` alanlarında saklayın: `ST_TRIAL_MIGRATION_DB_ENABLED=true`, `ST_TRIAL_MIGRATION_DB_HOST=127.0.0.1`, `ST_TRIAL_MIGRATION_DB_PORT=3306`, `ST_TRIAL_MIGRATION_DB_NAME=istasyonos_migration_trial`, `ST_TRIAL_MIGRATION_DB_USER=stationos_trial_migrator`, `ST_TRIAL_MIGRATION_DB_PASSWORD=<secret>`, `ST_TRIAL_MIGRATION_DB_CHARSET=utf8mb4`. Bu turda `.env` değiştirilmedi; bu alanlar henüz varsayılmıyor.

### Aşamalar ve operatör onayı

1. `node .\scripts\trial-db-readonly-preflight.mjs`: mevcut `st_trial_ro` ile salt-okunur hedef/grant kontrolü. Başarısızsa durun.
2. `node --import tsx .\scripts\migrations.ts check-files`: bağlantısız katalog/manifest doğrulaması. Beklenen SHA-256, `0000_initial_users` + kesintisiz `0001_stationos`–`0019_pos_slip_ocr_drafts` olmalı; `0020` katalogda olmamalı.
3. DBA trial hesabını ayrı onayla oluşturup yukarıdaki en dar grant'leri verir ve sırrı yerel ayrı `ST_TRIAL_MIGRATION_DB_*` ayarlarına kaydeder. `DATABASE_URL` aynı kalır. Migrator `--target-profile istasyonos-trial` ile sadece bu ayarları kullanır; eksik/yanlış ayarda `DATABASE_URL`'ye fallback yoktur.
4. Yetkili hesapla `status`, hedef kimliği/grant kontrolünden sonra advisory lock alıp salt okunur migration geçmişi ve şema snapshot'ı alır; `CREATE`, `INSERT`, `UPDATE` veya migration SQL'i yürütmez. Bu mod da trial hedefinde tam dar-grant allowlist'inin sağlanmasını ister; connection/grant doğrulaması ve status aynı tek fiziksel bağlantı üzerinde yapılır. Beklenen boş DB'de pending listesi tam kanonik 20 kaydı (`0000` ve `0001`–`0019`) göstermelidir. Bu aşama yalnız trial migration ayarları yerel `.env`'ye DBA tarafından eklendikten sonra:

```powershell
node --import tsx .\scripts\migrations.ts status `
  --database istasyonos_migration_trial `
  --manifest-sha256 3e6ce8ee6a5a295bdcddc3b5de271f4299f838bc40632bab26cac6a99611ff01 `
  --target-profile istasyonos-trial `
  --expect-empty-trial `
  --expected-current-user 'stationos_trial_migrator@127.0.0.1'
```

`--expect-empty-trial` olmadan trial `status` başlamaz. Migrator, aynı kilitli bağlantı/snapshot kapsamındaki hedef ve grant kontrollerinden sonra şemanın boş olduğunu, uygulanmış kaydın olmadığını ve pending listesinin tam 20 kanonik kayıttan (`0000`, `0001`–`0019`) oluştuğunu doğrular. Farklı tabloda/geçmişte, eksik veya fazladan pending migrationda işlem fail-closed durur. `status` DDL/DML çalıştırmaz; advisory lock yalnız geçici sunucu kilididir. 5. `apply` tüm kanonik bekleyen migrationları `0000`–`0019` sırasıyla çalıştırır ve DDL yazımıdır. Ayrı açık operatör onayı olmadan **çalıştırmayın**. Hazırlanmış komut bu runbook'un önceki “Olası komut taslağı” bölümündedir.

Yanlış hedef, manifest/checksum farkı, rol veya grant fazlalığı, eksik şema/geçmiş, lock çakışması ya da yarım `STARTED/FAILED` migrationda durun. MySQL DDL ifadeleri implicit commit yapabilir; aynı apply içindeki önceki ifadeler/tablo değişiklikleri kalmış, sonraki migrationlar başlamamış olabilir. Bu nedenle uygulama transaction rollback'i garanti edilemez. Otomatik baseline, rollback, retry, guard/history satırı elle değiştirme veya aynı migration komutunu yeniden çalıştırma yoktur. Hata anındaki veritabanını koruyun; ayrı salt-okunur yetkiliyle önce `information_schema.TABLES`, varsa `st_migration_guard`, `st_schema_migrations` ve `__drizzle_migrations` kayıtlarını okuyun; `STARTED/FAILED` durumunu ve fiziksel şemayı dosya SQL'iyle DBA incelemesine verin. Bunları silmeyin/düzeltmeyin. Recovery kararı ayrıca onaylanıp atılabilir hedef doğrulanana kadar trial da NO-GO kalır. `status` ile `apply` ayrı komutlardır; trial boş hedefte status için `--expect-empty-trial` zorunludur; `check-files` MySQL'e bağlanmaz. Boş DB'ye yalnız 0018/0019 uygulamak geçerli değildir.

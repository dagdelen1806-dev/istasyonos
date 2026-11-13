# Faz 1 / Paket 3 — Y-07 Migration güvenliği

## Kapsam ve mevcut durum

Bu paket yalnız migration güvenliğidir. Üretime dağıtılmamıştır. Gerçek DB'ye
bağlantı, migration, baseline, seed veya müşteri/demo verisi işlemi yapılmamıştır.
İzole DB de kurulmamıştır; testler bellek modelleri ve taklit bağlantılar kullanır.
AGENTS.md, CLAUDE.md, mevcut SQL migration'ları ve Drizzle journal değiştirilmez.
Üretim geçişi ve gerçek DB kabulü ayrı onay gerektirir.

## İki migration yolunun korunması

Drizzle kaynağı `drizzle/meta/_journal.json` ve `drizzle/*.sql`; yerel geçmişi
`__drizzle_migrations` tablosudur. Kurulu Drizzle MySQL dialect'i hash saklar
ancak uygulamada yalnız son `created_at` değerine göre ilerler; önceki dosyaların
hash'lerini tek tek karşılaştırmaz. Operasyon kaynağı
`server/stationos/migrations/*.sql`; geçmişi `st_schema_migrations` tablosudur ve
eski sürümde checksum içermez.

Yeni ortak çalıştırıcı önce **bekleyen Drizzle**, sonra **bekleyen operasyon**
SQL'lerini çalıştırır. Journal zamanları/hash'leri ve operasyon sürüm kayıtları
eski tablolarında korunur. Drizzle SQL dosyası/breakpoint ve yerel hash biçimi
korunur; Drizzle'ın son zamana göre atlayan CLI migrator'ı içeriden çağrılmaz.
Mevcut SQL'ler yeniden üretilmez veya numaralanmaz. Gelecekteki Drizzle eki,
eski operasyon güvenlik kayıtlarının kaynak sırasını değiştirmez.

## Manifest ve güvenilir checksum başlangıcı

`migrations.manifest.json`, SQL dosyalarının **ham UTF-8 baytlarının SHA-256**
değerlerini, kaynak başına sıralarını, Drizzle zamanlarını ve journal hash'ini
taşır. Windows LF/CRLF dönüşümü bile farklı checksum üretir; otomatik
normalleştirme/kabul yoktur. Dağıtım immutable kaynak paketiyle yapılmalıdır.

`pnpm db:check` yalnız dosyaları doğrular, DB veya `.env` okumaz. Çıktıdaki
manifest SHA-256 değeri bir **gözlemdir**, kendi başına geçmişe güven kanıtı
değildir. `pnpm db:manifest` yalnız aday manifest JSON'unu stdout'a üretir;
mevcut manifesti değiştirmez ve DB'ye bağlanmaz. Yeni manifest/sürüm, ayrı kod
incelemesiyle kabul edilir. Şüpheli SQL'i kabul etmek için manifest yenilenmez.

DB komutları bağımsız onaylı release'ten alınmış `--manifest-sha256` ve açık
`--database` ister. Yerel şüpheli paketin gösterdiği hash'i körlemesine aynı
komuta kopyalamayın. Bu geliştirmede üretilen manifest, mevcut dosyaların
envanteridir; gerçek DB'nin geçmişte hangi SQL'le kurulduğunu kanıtlamaz.

Eski operasyon kayıtlarının hash'i olmadığından normal başlangıç/apply
`MISSING_CHECKSUM` ile durur. Güvenilir başlangıç için:

1. Uygulamaya yazmaları durdurun, tutarlı DB ve kaynak yedeği alın; ayrı ortamda
   geri yükleme provası yapın. İncelenecek DB hedefini bağımsız doğrulayın.
2. Orijinal güvenilir release/Git/paket envanteriyle SQL ve journal baytlarını
   karşılaştırın. Mevcut yerel dosyayı tek güven kaynağı saymayın.
3. Yerel geçmişlerin kesintisiz sırasını ve `SHOW CREATE TABLE`/kolon/indeksleri
   inceleyin. Özellikle slip generated gün sütunu ve unique indeksleri kontrol
   edin. Araç tablo varlığını kontrol eder; tam kolon/indeks drift denetimi yapmaz.
4. İnceleme kaydı/ticket oluşturup ayrı yetkiyle `baseline` komutunu kullanın.
   Bu işlem yalnız mevcut uygulanmış sürümler için `BASELINED` güvenlik kaydı
   ekler; iş SQL'i çalıştırmaz ve eski geçmiş satırlarını değiştirmez.
5. Bilinmeyen sürüm, yanlış Drizzle hash'i, sıra boşluğu, eksik tablo veya
   STARTED/FAILED kayıt varsa baseline da durur. Otomatik sahiplenme yoktur.

## Tek bağlantı ve kilit

Ortak motor tek, havuzsuz MySQL bağlantısı kullanır. Aynı schema için
`GET_LOCK(name, timeout)` alınır; isim schema adının küçük harfe çevrilmiş SHA-256
özetinden türetilir. Böylece Windows'ta farklı büyük/küçük harf yazımları ayrı
kilit oluşturmaz. Varsayılan CLI bekleme 10 saniye; izin verilen aralık 0–300'dür.
Normal startup sıfır saniye bekler ve migration sürüyorsa HTTP dinlemeye başlamaz.

`IS_USED_LOCK` ve `CONNECTION_ID()` sahipliği her DDL adımından önce/sonra ve
geçmiş kaydı transaction'ında doğrulanır. Başka bağlantıya geçiş/reconnect yoktur.
Timeout/NULL/bağlantı kopması hata verir. `RELEASE_LOCK` finally içinde denenir;
bağlantı her koşulda kapatılır, kapatma hatasında destroy edilir. Kilit bırakma
belirsizse başarı raporlanmaz. Asıl DDL hatası, ikincil bırakma hatasıyla gizlenmez.

Bu kilit **yalnız işbirliği yapan çalıştırıcıları** koordine eder. Elle SQL veya
doğrudan `drizzle-kit migrate` kilide uymayabilir; işletimde yasaklanmalı ve DDL
yetkileri bakım hesabıyla sınırlandırılmalıdır. Migration öncesi çalışan uygulama
instance'ları durdurulmalıdır; startup kontrolü sürekli trafik kilidi değildir.

## Kalıcı durum ve yarım DDL

Yeni `st_migration_guard`, explicit apply/baseline sırasında oluşturulan ek
metadata tablosudur. Önceki migration tablolarına sütun eklenmez. Normal
startup/status bu tabloyu bile oluşturmaz.

Durum alanları: kaynak, sürüm, kaynak sırası, SHA-256, STARTED/APPLIED/BASELINED/
FAILED, başlangıç/bitiş ve inceleme referansı. Motor her migration'dan önce
autocommit ile STARTED kaydı yazar. Birden çok SQL, ayrı statement'lar halinde
aynı bağlantıda çalışır; `multipleStatements` kapalıdır.

MySQL DDL örtük commit yapabildiği için DDL çevresinde geri alma garantili bir
transaction varmış gibi davranılmaz. SQL tamamlandıktan sonra yalnız native
geçmiş kaydı ve APPLIED güncellemesi tek **InnoDB DML transaction**'ında commit
edilir. Hata/kesintide STARTED kalır; bu, olayın kesin kısmi olduğunu değil,
inceleme gerektiğini gösterir. Sonraki çalıştırma durur, sonraki migration'a
geçmez. Otomatik down migration, veri silme veya STARTED sıfırlama yoktur.

Mevcut SQL profilinde CREATE TABLE/INDEX ve ALTER TABLE desteklenir. DELIMITER,
routine, çalıştırılabilir MySQL yorumu ve transaction/bağlantı komutları yeni,
açık bir inceleme gerektirir. Gelecekteki migration bu profili aşarsa yayın
öncesi araç desteği ve test eklenmelidir; sessizce atlanmaz.

## Yönetici hata kurtarma prosedürü

1. Uygulama ve migrator'ları durdurun. Hata kodunu, release/manifest hash'ini,
   iki native geçmişi, guard kayıtlarını ve güncel şemayı koruyun. Yedek alın.
2. Eski kilidin gerçekten bırakıldığını ve DB bağlantısının sonlandığını inceleyin;
   canlı başka migrator varken zorla kilit açmayın.
3. DB kopyasında ilgili SQL'in **her statement** sonucunu kolon/indeks düzeyinde
   kontrol edin. CREATE IF NOT EXISTS var diye tamamlandı saymayın.
4. DDL eksikse ayrı inceleme/onayla yalnız eksik bölümü tamamlayan onarım planı
   hazırlayın. Orijinal uygulanmış SQL dosyasını değiştirmeyin veya bütün dosyayı
   körlemesine tekrar çalıştırmayın. Veri kaybettiren rollback üretmeyin.
5. DDL'nin tamamı doğruysa native geçmişin ve guard durumunun uzlaştırılmasını
   tek yönetici bakım işi olarak planlayın; gerekirse eksik native satırı ve
   guard APPLIED durumunu aynı transaction'da düzeltin. Kaynak checksum, eski
   STARTED kanıtı ve inceleme referansını koruyun. Bu araç otomatik bir
   `force/mark-applied/reset` seçeneği sunmaz.
6. Yeniden `status` ve ardından startup doğrulaması yapın. Trafiği ancak kabul
   sonrasında açın. Yeni mali işlemler oluştuktan sonra eski yedeği doğrudan
   yüklemek bu işlemleri kaybettirebilir; uzlaştırma gerekir.

## Windows 11 / Laragon ve kontrollü komutlar

Aşağıdakiler **gelecekte yetkilendirilmiş bakımda** çalıştırılacak örneklerdir;
bu geliştirmede DB komutları çalıştırılmamıştır. Proje kökünde Node 22/24 ve
pnpm 10.18 kullanın. `<ONAYLI_SHA256>` yerine bağımsız onaylı release hash'i gerekir.

```powershell
# Salt dosya kontrolü; DB yok:
pnpm db:check

# DB'ye bağlanır, şema/veri yazmaz:
pnpm db:status --database istasyonos --manifest-sha256 <ONAYLI_SHA256>

# Yalnız eski geçmiş için, yönetici incelemesi tamamlandıktan sonra metadata yazar:
pnpm db:baseline --database istasyonos --manifest-sha256 <ONAYLI_SHA256> --confirm-legacy-review --review-reference REVIEW-123

# Bekleyen migration'ları uygular; ayrı değişiklik onayı gerektirir:
pnpm db:migrate --apply --database istasyonos --manifest-sha256 <ONAYLI_SHA256> --lock-timeout 10

# Başlangıç artık yalnız doğrular:
pnpm dev
pnpm start
```

PowerShell'de yer tutucuları yazıldığı gibi çalıştırmayın; gerçek onaylı hash ile
değiştirin. Laragon MySQL ve Docker MariaDB ayrı veri kaynaklarıdır. Bağlantı
URL'sini rapora/loga yazmadan hedefi doğrulayın. Manifest/SQL satır sonlarını
editörle dönüştürmeyin. Geçmiş eksikse tabloyu var diye sahiplenmeyin.

`db:migrate` artık iki yolu birlikte yönetir ve tek başına yazmaz; zorunlu
bayraklar yoksa **bağlantı bile açmaz**. Eski
`pnpm tsx server/stationos/migrate.ts` girişi aynı güvenli çalıştırıcıya yönlenir;
bağımsız operasyon yolu kalmamıştır. `db:push` engellenmiştir. `db:generate`
yalnız aday dosya üretir; eski dosyalar veya manifest otomatik onaylanmaz.

## Docker ve bulut başlangıç değişiklikleri

Normal `docker compose up` maintenance profilindeki migrator'ı başlatmaz.
`scripts/container-start.mjs` yalnız uygulamayı başlatır. Yeni/legacy DB,
baseline veya apply tamamlanmadan app healthcheck'i başarılı olmaz. `KUR.ps1`
bu durumda açıklayıcı hata verir; otomatik şema yükseltme yoktur.

```powershell
# DB altyapısı başlatma ayrı yetkili işlemdir:
docker compose stop app
docker compose up -d db --wait

# Maintenance komutları açıkça seçilir; status DB'ye bağlanır:
docker compose --profile maintenance run --rm migrator status --database istasyonos --manifest-sha256 <ONAYLI_SHA256>
docker compose --profile maintenance run --rm migrator baseline --database istasyonos --manifest-sha256 <ONAYLI_SHA256> --confirm-legacy-review --review-reference REVIEW-123
docker compose --profile maintenance run --rm migrator apply --apply --database istasyonos --manifest-sha256 <ONAYLI_SHA256>

# Bakım ve kabul sonrasında:
docker compose up -d --build --wait app
```

Migrator ve app aynı incelenmiş kaynak/image sürümünden üretilmelidir; deployment
image digest'i sabitlenmelidir. App, manifest/journal/SQL varlıklarını da taşımalı
ve proje kökünden başlamalıdır; yalnız `dist/index.js` kopyası yeterli değildir.

`cloud-install.sh` şema migration'larını artık uygulamaz; açık bakım komutunu
bildirir. `cloud-start.sh` mevcut `.env` ister ve kurulum/DB kullanıcı oluşturma
betiğini çağırmaz. Bulut kurulum betiğinin altyapı provisioning davranışı ayrı
kurulumdur; bu geliştirmede hiçbir kurulum betiği çalıştırılmamıştır.

## Geriye uyumluluk, yedekleme ve geri alma

İş tabloları ve eski migration geçmişleri korunur; eski DB'ler için bir defalık,
incelemeli guard baseline gerekir. Bu, güvenlik için kasıtlı başlangıç değişimidir.
Normal app hesabına geçmiş tabloları okuma ve MySQL named-lock kullanım yetkisi;
ayrı migrator hesabına gerekli DDL/metadata yazma yetkisi sağlanmalıdır.

Dağıtımdan önce tutarlı DB yedeği, kaynak/image ve yapılandırma envanteri alın;
ayrı ortamda geri yüklemeyi doğrulayın. Kaynak geri dönüş kopyaları
`.local/y07-source-backup/` altındadır; bunlar DB yedeği değildir.

Geri dönüşte mümkünse ileri düzeltme tercih edin. Önceki uygulama sürümüne
dönülse bile eski otomatik migration içeren container-start/cloud komutlarını
geri getirmeyin. Guard tablosunu veya native geçmişi silmeyin; eski veritabanı
yedeğini yeni mali kayıtlar üzerine otomatik yüklemeyin. DDL rollback garantisi
yoktur. Üretime geçiş ve herhangi bir kurtarma SQL'i ayrı onay gerektirir.

## Test ve doğrulama sınırları

Son doğrulama:

| Kontrol | Sonuç |
|---|---|
| Uygulama TypeScript, emit/incremental kapalı | Başarılı |
| Yeni testlerin ayrı TypeScript denetimi | Başarılı |
| İzole Vitest | **14 dosya / 140 başarılı / 0 başarısız** |
| Yeni Y-07 testleri | **51 başarılı**; önceki 89 test de başarılı |
| Y-01/Y-02 TZ regresyonları | UTC/İstanbul/New York'ta 50'şer, toplam **150 ek yürütme başarılı** |
| Frontend ve server üretim bundle | Başarılı, yalnız `.local/phase1-build/` altında |
| Yerel manifest kontrolü | 7 mevcut SQL migration için başarılı; DB/env erişimi yok |
| Windows/Docker dosyaları | KUR.ps1 PowerShell parser ve Compose YAML sözdizimi başarılı; betik/Docker çalıştırılmadı |
| Korunan dosyalar | 7 SQL, journal, AGENTS.md ve CLAUDE.md başlangıç SHA-256 değerleriyle aynı |

İlk derleme denemelerindeki TypeScript daraltma ve parametreli test tipleri
düzeltildi. Son koşumda başarısız kontrol kalmadı. Build'in mevcut büyük chunk
ve runtime config script uyarıları sürüyor; Y-07 kapsamında değiştirilmedi.
Gerçek veritabanı, metadata bootstrap/baseline/apply veya migration çalıştırılmadı.

Çalıştırılan güvenli kontroller:

```text
node scripts/verify-phase1.mjs test
node scripts/verify-phase1.mjs build
node --import tsx scripts/migrations.ts check-files
```

`node scripts/verify-phase1.mjs test` tip kontrollerini ve izole testleri çalıştırır.
DB sürücüleri engellenir/taklit edilir; gerçek .env yüklenmez. Yeni testler:

- `server/migrations/catalog.test.ts`: ham checksum, manifest/journal, sıra,
  eksik/ek dosya, LF/CRLF, SQL ayrıştırma ve mevcut Drizzle hash uyumu.
- `server/migrations/engine.test.ts`: tekrar, baseline, sıra, yarış/timeout,
  STARTED, DDL hatası, kopma, salt okunur startup ve kilit bırakma hatası.
- `server/migrations/mysql-store.test.ts`: bağlantı kapsamı, SQL/advisory lock
  adaptörü, geçmiş DML transaction'ı, readiness ve CLI yetkilendirme kapıları.

Gerçek MySQL/MariaDB DDL, named lock, bağlantı kopması ve Docker/Windows/Linux
entegrasyon kabulü bu bellek testleriyle kanıtlanmış sayılmaz. İzole DB kurulması
gerekirse hedef, sentetik veriler ve kaldırma prosedürü önce sunulup ayrıca
onay alınmalıdır. Bu pakette hiçbir test DB'si oluşturulmadı.

## Değişen dosyalar

Yeni: `server/migrations/{catalog,engine,mysql-store,readiness}.ts`, üç test dosyası,
`scripts/migrations.ts`, `migrations.manifest.json` ve bu belge.

Güncellenen: `server/stationos/migrate.ts`, `server/_core/index.ts`, `package.json`,
`scripts/container-start.mjs`, `scripts/cloud-install.sh`, `scripts/cloud-start.sh`,
`compose.yaml`, `KUR.ps1`, `README.md`, `WINDOWS-BASLANGIC.md`, `tsconfig.phase1.json`,
`server/stationos/phase1-test-setup.ts`. Bağımlılık güncellemesi yapılmadı.

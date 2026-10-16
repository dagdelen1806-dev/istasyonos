> **16 Ekim 2026 kasa pilotu:** Güncel market POS rehberi `docs/market-kasa-pilotu-2026-10-16.md`. `/kasa` çok kasa oturumları, atomik DEMO sepet satışları ve kapanış içerir; 0007 migration gereklidir. Gerçek mali belge, yazıcı/çekmece/banka ve merkez sync henüz bağlı değildir. Finans ve tenant sınırlarını koruyun.

> **15 Ekim 2026 bağımsız sürüm güncellemesi:** Güncel kurulum kaynağı kök `README.md` ve `scripts/cloud-*.sh` dosyalarıdır. Varsayılan `AUTH_PROVIDER=local`: e-posta/parola, scrypt, DB’de hash’li ve iptal edilebilir oturumlar; Manus zorunlu değildir. Mevcut mali/tenant kuralları korunur. `0006_local_auth.sql` eklendi. Asistan yerel kural tabanlı özet verir; haricî OCR/banka/Turpak kapalıdır. Aşağıdaki 14 Ekim aktarım notları önceki sürümün tarihsel bağlamıdır; Manus zorunluluğuna ilişkin ifadeler yalnız isteğe bağlı eski adaptöre uygulanır. Kullanıcı bu oturumda kod uyarlamasını ve DEMO veri kullanımını yetkilendirdi.

# CLAUDE.md — İstasyonOS / AKARYAKIT V1

## 1. Projenin amacı ve bu kopyanın durumu

Akaryakıt istasyonlarının aylık/günlük vardiya hesaplarını, market stoklarını ve operasyonel finansını aynı sistemde yönetmek. Personel kendi telefonundan PWA ile vardiya hesabı açar; nakit, kart slipi, IBAN ve kişi/kuruma borç satışlarını girer. Yetkililer kaynak raporu ve fizikî nakit teslimini kontrol eder; muhasebe ayrı kullanıcı imzalarıyla teslimi inceler. Patron yetkili olduğu istasyonların konsolide durumunu görür.

**Bu belge 14 Ekim 2026 tarihli kaynak kodu kopyasını tanıtır.** Çalışan web uygulamasının ilk sürümüdür; tamamlanmış ve üretim onayı verilmiş tam ERP değildir. Kaynaklar çalışma klasöründeki değişiklikleri de kapsar; yalnız eski Git commit'i değildir. Gerçek kullanıcı, veritabanı kayıtları ve anahtarlar arşivde yoktur.

Kullanıcı dili ve uygulama arayüzü **Türkçe**. Kullanıcının talebi aksini söylemedikçe finansal iş kurallarını değiştirme. Planlanan özellikleri çalışan özellikmiş gibi sunma.

## 2. Önce okunacak dosyalar

1. Bu dosya ve `README-PAKET.md`: kapsam, kurulabilirlik ve aktarım sınırları.
2. `server/stationos/index.ts`: güncel REST işlemleri, yetki filtreleri, transaction ve state hesapları. **Mevcut davranışın birincil kaynağıdır.**
3. `shared/station.ts`: güncel istemci tipleri; `shared/station-contract.md`: sözleşme taslağı.
4. `server/stationos/domain.ts`, `safety.ts`: para, idempotency, doğrulama ve hesap yardımcıları.
5. `client/src/pages/StationApp.tsx` ve `components/stationos/`: gerçek modül ekranları.
6. `docs/teknik-planlama-v1.3-mobil-vardiya-ocr-api-migration.md`, `docs/tasarim-v1.9-personel-mobil-vardiya-ocr-muhasebe.md`: ürünün geniş hedefi.
7. `docs/mimari-v2.2-turpak-dosya-ocr-kvkk-guvenlik.md`: dış kaynak aktarımı/OCR güvenlik hedefi.

**Öncelik kuralı:** Çalışan kod ve güncel testler > bu aktarım notu > sözleşme taslağı > tarihli planlar/eski README/TODO kayıtları. Kök `README.md`, backend `README.md` ve `TODO.md` geliştirme sırasında yazıldı; bazı tamamlanma ifadeleri ve yetki listeleri eski olabilir. Çelişkiyi inceleyip açıkça raporla; eski belgeyi uygulamak için güvenlik kontrolünü kaldırma.

## 3. Teknoloji ve dosya haritası

- Node.js 22; `pnpm@10.18.0`; TypeScript 5.9; ESM.
- React 19, Vite 7, Wouter, Tailwind/CSS, Radix UI bileşenleri.
- Express 4. Operasyon modülü `/api/stationos` altında REST'tir; başlangıç şablonunda tRPC de vardır.
- **Güncel uygulama MySQL/mysql2 kullanır.** Eski planlardaki PostgreSQL örneklerini mevcut veritabanında çalıştırma.
- Kullanıcı tablosu Drizzle; operasyon tabloları ayrı, numaralı SQL migration'ları.

```text
client/src/pages/StationApp.tsx          Ana konsol, kurulum, vardiya ve onay ekranları
client/src/components/stationos/         Market, satın alma, cari, finans, asistan ve ortak UI
client/src/lib/station-api.ts            Oturum/CSRF/cihaz/idempotent istemci
client/src/station.css                  Ana responsive tasarım
client/public/                         PWA manifest, ikonlar, offline ekran, rota listesi
server/_core/                          OAuth, oturum, Express, Vite/static ve AI servis yardımcıları
server/stationos/index.ts               REST router, yetki ve transaction iş akışları
server/stationos/db.ts                  UTC/kayıpsız büyük sayı bağlantı ayarları
server/stationos/migrate.ts             Operasyon migration çalıştırıcısı
server/stationos/migrations/            0001–0005 SQL dosyaları
server/stationos/assistant.ts           Rol bazlı anonim AI özetleyici
server/stationos/*.test.ts              Birim ve sözleşme testleri
shared/station.ts                      UI/API tipleri
shared/station-contract.md             REST sözleşme taslağı
shared/const.ts                        Oturum ve OAuth sabitleri
drizzle/                               Kullanıcı tablosu ve başlangıç migration'ı
docs/                                  Geçmiş planlar, örnek SQL, veri şablonları ve prototipler
Dockerfile                             Üretim image build/start tanımı
```

`docs/prototip-v2.0/` eski Node/HTML demodur; veri bellekte tutulur ve rol taklidi vardır. Güncel uygulama değildir. `docs/ui-wireframe-v1.4.html` tasarım geçmişidir. `docs/ornek-kod-v1.9/` bağımsız örneklerdir; otomatik olarak güncel backend'e entegre sayılmaz.

## 4. Kurulum ve komutlar

Proje kökünde:

```bash
corepack enable
corepack prepare pnpm@10.18.0 --activate
pnpm install --frozen-lockfile
cp .env.example .env
# .env içine kendi yetkili bağlantı ve oturum ayarlarını gir.

pnpm db:migrate                         # Drizzle: users başlangıç tablosu
pnpm tsx server/stationos/migrate.ts     # Operasyon: st_* tabloları
pnpm dev                               # Express + Vite; varsayılan 3000

pnpm check                             # TypeScript; emit yok
pnpm test                              # Vitest
pnpm build                             # dist/public + dist/index.js
pnpm start                             # Derlenmiş üretim sunucusu
```

Windows'ta `cp` yerine dosyayı elle kopyalayabilirsin. `dev/start` npm script'lerinde POSIX `NODE_ENV=...` sözdizimi vardır; Windows PowerShell için değişken atamasını uyarlamak veya WSL kullanmak gerekir.

`pnpm db:push` şema üretip migration uygular; mevcut finans veritabanında incelemeden kullanma. Sunucu başlangıcı operasyon migration'larını kendiliğinden çalıştırmaz. MySQL DDL örtük commit yapabilir; migration dosyasındaki transaction, tüm DDL'nin geri alınacağını garanti etmez. Yedek ve ayrı deneme veritabanı kullan; uygulanmış migration'ı değiştirmek yerine yenisini ekle.

### Dış platforma bağımlılık

`.env.example` yalnız boş alanlar içerir. Temel özel değerler `DATABASE_URL`, `MANUS_PROJECT_ID`, `MANUS_JWT_SECRET`, `MANUS_OAUTH_API_URL`; giriş ekranı için public `MANUS_OAUTH_PORTAL_URL`. Asistan `MANUS_API_URL` ve sunucuya özel `MANUS_API_KEY` kullanır. Varsa `OWNER_OPEN_ID` ilk kurulum politikasını etkiler. **Ortam değerlerini kayıttan çıkarma, loglama veya frontend'e serileştirme.**

Bu kaynak kopyası dışarıda dosyaları derlemenin mümkün olması ile gerçek giriş/AI/veritabanının hazır olması arasında ayrım yapar. Mevcut OAuth ve AI Manus servislerine bağlıdır. Başka ortamda yetkili erişim/callback yapılandırması gerekir; erişim yoksa OAuth ve AI adaptörlerini açık bir taşıma işi olarak ele al. Sahte kullanıcı veya herkese açık admin ekleyerek bu bağımlılığı geçiştirme. İlk girişte nonce/cookie akışı HTTPS gerektirir; yalnız `http://localhost` açılması gerçek login'i garanti etmez.

## 5. Mevcut modüller ve açık işler

### Kaynakta uygulanmış

- Gerçek SDK cookie/Bearer kimliği, tenant/istasyon üyeliği ve rol kontrolleri; süreli tek kullanımlık davet.
- Firma/istasyon ve vardiya oluşturma; personelin kendi hesap ve ödeme kayıtları.
- Nakit, manuel teyitli kart slipi, IBAN beyanı, borç satış ve eski cari tahsilat ayrımı.
- Manuel kaynak satış toplamı/ref; fizikî nakit alıcısı; sürüm kontrolü; ayrı mali onaylar ve düzeltme geçmişi.
- Kişi/kurum borçlu kartı, borç ve tahsilat defteri; sonraki tahsilatın cirodan ayrı izlenmesi.
- Market ürün/barkod, adet stoğu, mal kabul/satış/düzeltme hareketi; 5.000 ürün sınırı.
- Toptancı cari limit/vade kayıtları ve deterministik stok/sipariş önerileri.
- Operasyonel konsolide özetler; beş masaüstü cihaz için hesap başına süreli lease.
- Kurulabilir PWA manifest ve hassas veri içermeyen offline açıklama ekranı.
- Rol bazlı **salt okunur** AI açıklaması: kontrollü konu + sunucuda hazırlanmış anonim sayısal özet. Serbest kapsamlı ERP ajanı değildir.

### Hâlâ plan/erişim/üretim geliştirmesi gerektiren

- Turpak/YN ÖKC, pompa/tank otomatik veri akışı; gerçek banka/POS takas, komisyon/valör, e-Fatura/muhasebe bağlantıları.
- Slip fotoğrafı yükleme, gerçek piksel maskeleme, OCR kuyruğu ve özel şifreli görsel deposu. Mevcut slip yöntemi `MANUAL`; fotoğraf OCR varmış gibi davranma.
- Tam satın alma sipariş/taahhüt rezervasyonu, fatura–mal kabul eşleştirmesi, cihaz üreticisine ait PM80/diğer terminal SDK adaptörleri.
- Gerçek banka açılış bakiyesine dayanan likidite; tam muhasebe ve resmî beyanlar.
- Ayrıntılı izin kodu/policy sistemi, istasyonlar arası hukuki firma geçmişi, personel bazında ayrı vardiya atama ve tam negatif/yarış testleri.
- Üretim güvenlik kabulü, KVKK değerlendirmesi, yük/yedek/geri yükleme testleri ve saha pilotu.

## 6. Değişmemesi gereken finans ve yetki kuralları

1. Para güvenli **integer kuruş**: `10000 = 100,00 TL`. API'ye float TL gönderme. `requireMoney`, `safeAdd` ve UI para dönüştürücülerini kullan; taşmayı denetle.
2. MARKET stok integer **adet**; FUEL hedefi **litre/tank**. İki alanın stok ve satışlarını sessizce birleştirme.
3. Vardiya satış beyanı = nakit satış + kart slipi brüt + IBAN beyanı + borç satış. Açılış para üstü ve eski alacak tahsilatı satış değildir.
4. `expectedCashMinor` nakit satış + eski alacak tahsilatıdır; fizikî sayım ve retained/açılış float ayrımını mevcut koddan takip et. Brüt kart slipini banka net tahsilatı sayma.
5. IBAN'ın yazılması veya muhasebe imzası, gerçek banka hareketinin doğrulandığı anlamına gelmez; kapanış `ACCEPTED_WITH_PENDING` olabilir.
6. Aktör ve rol body'den alınmaz. Kimlik sunucuda doğrulanır; nesnenin tenant/istasyon kapsamı her işlemde tekrar kontrol edilir. UI buton gizlemek yetki kontrolü değildir.
7. Kendi hesap dosyasını onaylama yasağı kullanıcı ID'sine dayanır. Fizikî nakit alıcısı ile `APPROVAL` mali imzası ayrı işlerdir; alıcı imzası mali imza sayısını artırmaz.
8. İki farklı mali kullanıcı imzası gerekir. Sürüm/cycle/snapshot bağını koru; yeni içerik eski imzaları devralmaz. İmzaları silerek düzeltme yapma. Mevcut geri gönderme, inceleme durumundan yeni cycle açar; kesin kapanmış hesabı yeniden açma ayrı geliştirmedir.
9. `/payment`, `/slip`, `/account/submit` cihaz kimliği/kind başlıkları kullanır; masaüstü kontenjanı 5, lease süresi 5 dakika. Bu tarayıcı kimliği/lease ilk uygulamadır, donanım kimlik doğrulaması değildir. Kullanıcının UA/localStorage değiştirmesi karşısında güçlü cihaz enrollment ayrıca gerekir.
10. Borç satışı bir kez borçlandırır; sonraki `AR_COLLECTION` ayrı hareketle azaltır. Banka bekleyen tahsilatı kesin kredi post etme. Hesapsız tahsilat `payments.accountId = null` olabilir.
11. İsim/adres/not/fiyat/bakiye gibi state alanları nullable veya yetki nedeniyle redacted olabilir. `null` bilinmiyor/yetki yok demektir; sıfırmış gibi finansal toplam üretme.
12. SQL'de ödeme/slip gibi iki 1:N tabloyu doğrudan join edip SUM toplama; scalar veya önceden aggregate edilmiş sorgu kullan. İşlem satırlarını ve bağlı kayıtları transaction içinde kilitle.
13. Aynı station + terminal + reference + Türkiye işlem günü için kart slipi tekrar gelir yaratmamalı. UTC saklama, Türkiye günü için generated tarih sütunu/indeksini koru.
14. İşlem `requestId` + aktör + payload hash ile idempotent. Ağ cevabı belirsizse yeni kimlikle tekrar yazma; aynı mantıksal işlemin kimliğini koru.

## 7. Satın alma ve asistan sınırı

`index.ts` state önerisi son 28 günlük `SALE` adetlerinden günlük ortalama çıkarır. Pilot hedefi `max(minimumQty, ceil(averageDaily × 12))`; 12 gün = 7 gün inceleme + **varsayılan** 3 gün tedarik + 2 gün güvenlik. Bu, gerçek tedarikçi SLA'sı değildir. Mevcut stoğu düşerek miktar önerir; kritik kapsamı öne alır ve aynı toptancının kalan kredi bütçesini öneri satırları arasında paylaşır. Ürün alış fiyatı ve maliyet esası mutlaka kontrol edilmelidir.

Tam açık PO/taahhüt ve firma çapında ortak cari modeli mevcut uygulamada tamamlanmadı. Dolayısıyla öneri, bütün şirketin doğrulanmış kredi kullanılabilirliği veya gönderilmiş satın alma siparişi değildir. Hazırlanmış öneriyi otomatik tedarikçiye gönderme.

AI işlem yapmaz, SQL çalıştırmaz, onay vermez. `assistant.ts` ham soru ve kişi/ürün/tedarikçi isimlerini dış modele göndermez; kontrollü konu ve sayısal özet kullanır. Soru kaydında hash, cevap kaydında erişim kapsamı tutulur. Rate limit ve idempotency korumalarını sürdür. Anonimleştirme iddiasını KVKK/hukuki kabul yerine koyma; toplulaştırılmış iş verisinin erişim ve aktarım şartlarını ayrıca incele.

## 8. Güvenlik, PWA ve taşıma

- Gerçek `.env`, DSN, API/JWT anahtarı, cookie, ham slip, PAN veya banka hesap verisi Git'e/Claude sohbetine/loga girmez.
- `safety.ts` Luhn benzeri tam kart numarası kontrolü kullanır; **bu piksel maskeleme veya eksiksiz DLP değildir**. Cloud OCR öncesi bağımsız yerel gizlilik kontrolü gerekir.
- PWA yalnız offline açıklama ve ikonları cache eder; API, oturumlu HTML, cari veriler ve slipler cache edilmez. Finansal offline post henüz yoktur.
- Public HTTPS iframe önizlemede cookie `SameSite=None; Secure` gerektirir; iç HTTP bağlantısından public protokol çıkarımı yapma.
- `publicPlatformConfig` yalnız izinli public runtime alanlarını açar; `process.env` bütününü frontend'e verme.
- Veritabanı, dosya deposu, OAuth redirect adresi ve haricî servisler kod arşivinden bağımsız altyapıdır.

## 9. Test ve geliştirmeye devam

**14 Ekim 2026 doğrulaması:** `pnpm check` başarılı; `pnpm test` **6 dosya / 25 test** başarılı; `pnpm build` başarılı. Build, büyük chunk ve runtime `config.js` script etiketi uyarıları verir. Bunlar derlemeyi durdurmadı; performans ve build davranışı ayrıca incelenebilir.

Bu testler tam saha/çok kullanıcılı uçtan uca veya üretim güvenlik kabulü değildir. `server/stationos/database-rollback-check.ts --rollback-only` sentetik kayıt ekleyip geri alır; üretim/shared veritabanında çalıştırma, ayrı test veritabanı seç. Eski PostgreSQL testlerini mevcut MySQL testleriyle karıştırma.

Devam sırası: önce kendi ortamında kurulum/giriş → firma/istasyon/davet → personel hesabı/ödeme → kaynak/teslim/iki kullanıcı onayı → negatif kapsam ve eşzamanlılık kontrolleri. Sonra fatura eşleştirmesi, gerçek dosya/OCR ve sağlayıcı adaptörlerini ayrı teslimatlar olarak tamamla. Önce eksikleri ve bağımlılıkları söyle; gerçek sağlayıcı erişimi yokken sahte canlı entegrasyon ekleme.

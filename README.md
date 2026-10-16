# İstasyonOS — bağımsız çalışma sürümü

**Windows kullanıyorsanız önce [WINDOWS-BASLANGIC.md](WINDOWS-BASLANGIC.md) dosyasını okuyun.** Docker Desktop açıkken `BASLAT.cmd` kurulumu ve başlatmayı yapar.

React/TypeScript arayüzü ve MySQL uyumlu operasyon backend’i. Varsayılan kimlik doğrulama artık Manus gerektirmeyen e-posta/parola girişidir. Kaynak arşivinin aktarım bilgisi `README-PAKET.md` içinde tarihsel kayıt olarak korunur; bu README güncel kurulum davranışını anlatır.

## Bu bulut çalışma alanında

Node 22 veya 24 ve pnpm 10.18.0 kullanın. Bu çalışma alanında Node 24.19.0 ile doğrulandı.

```bash
cd /workspace/istasyonos
bash scripts/cloud-install.sh
bash scripts/cloud-start.sh
```

Kurulum, Debian 13 amd64 ortamında MariaDB paketlerini imza/checksum doğrulamasını koruyarak `/workspace/local-mysql` altına açar; sistem servisi/root yetkisi gerektirmez. Veritabanı yalnız Unix socket üzerinden dinler, TCP portu açmaz. Ayrı `istasyonos` veritabanı/kullanıcısı ve rastgele sırlar oluşturur. Mevcut `.env` dosyasını korur; haricî veritabanına otomatik migration uygulamayı reddeder. Veri ve anahtarları içeren `.env`, `.local/` ve `/workspace/local-mysql` özel geliştirme durumudur; Git’e veya herkese açık arşive eklemeyin.

Başlatma komutu DB’yi gerektiğinde başlatır, gerçek `SELECT 1` kontrolünü yapar, Express + Vite geliştirme sunucusunu çalıştırır. Sağlık kontrolü: `curl --fail http://127.0.0.1:3000/api/health`. Sağlık yanıtı giriş/mali iş akışı doğrulaması yerine geçmez.

Giriş ekranında kendi hesabınızı oluşturabilirsiniz. Yeni hesap mevcut şirketlere erişim sağlamaz: kendi izole firmasını kurar veya yönetici davetiyle katılır. Kurulum ekranındaki örnek veri seçimi yalnız DEMO çalışma alanı oluşturur. Hesap kaydı e-posta sahipliğini doğrulamaz; parola sıfırlama/e-posta doğrulama henüz yoktur.

## Kendi MySQL sunucunuzda

1. `pnpm install --frozen-lockfile` çalıştırın.
2. `.env.example` dosyasından `.env` hazırlayın; `AUTH_PROVIDER=local`, kendi `DATABASE_URL` ve en az 32 rastgele karakterlik `SESSION_SECRET` belirleyin. Anahtarı kalıcı ve gizli tutun.
3. Yeni/ayrı ve yetkili DB’de `pnpm db:migrate`, ardından `pnpm tsx server/stationos/migrate.ts` çalıştırın. Sunucu kendiliğinden migration uygulamaz. Mevcut veri için önce yedek alın.
4. Geliştirmede `pnpm dev`; üretim derlemesinde `pnpm build` ve `pnpm start` kullanın.

Üretimde HTTPS ve `COOKIE_SECURE=true` gerekir. Buluttaki yerel HTTP denemeleri için `.env` içinde açıkça `COOKIE_SECURE=false` seçilmiştir. Cookie HttpOnly/SameSite=Lax; oturumlar 12 saatlik, DB’de yalnız hash olarak saklanan rastgele tokenlardır ve çıkışta iptal edilir. Parolalar salt’lı scrypt hash’idir. Tek sunuculuk giriş deneme sınırı bulunur; çok sunuculu dağıtımda ingress’te paylaşılan sınır ekleyin. Parola kurtarma ve üretim işletim kontrolleri ayrı iştir.

Eski Manus adaptörü yalnız `AUTH_PROVIDER=manus` ile açıkça seçildiğinde kullanılabilir; bağımsız modda OAuth, AI veya debug kayıt toplayıcısı için Manus çağrısı yapılmaz. Asistan bağımsız modda **kural tabanlı yerel özet** verir; yapay zekâ yanıtı diye sunulmaz. Turpak, banka, görsel yükleme ve OCR entegrasyonları kapalıdır.

## Doğrulama

```bash
pnpm check
pnpm test
pnpm build
# Yalnız ayrı yerel geliştirme DB’sinde; DEMO kayıtlar oluşturur:
SMOKE_TEST=1 node --import tsx scripts/smoke-local.ts
# Yalnız test DB’sinde; sentetik kayıtları transaction sonunda geri alır:
node --env-file=.env --import tsx server/stationos/database-rollback-check.ts --rollback-only
```

HTTP smoke testi kayıt/giriş, davet, tenant izolasyonu, CSRF, idempotency, vardiya ödemeleri, fizikî nakit teslimi, iki farklı mali imza, IBAN bekleyen kapanış ve çıkışta oturum iptalini kontrol eder. Sonuç `.local/smoke-result.json`, oluşturulan DEMO hesap erişimleri `.local/demo-access.json` dosyasında tutulur. Bu dosyaları paylaşmayın. Her smoke çalışması yeni ve açıkça DEMO işaretli kayıtlar oluşturur.

Finans işlemleri integer kuruş kullanır. Banka teyidi, gerçek Turpak/OCR verisi veya üretim güvenlik/hukuk kabulü bu testlerden çıkarılamaz. Mevcut frontend derlemesinde büyük chunk ve runtime config script uyarıları bulunur.

## Market satış kasası pilotu — 16 Ekim 2026

Yeni **Satış kasası** menüsü (`/kasa`), barkod/ürün seçimi, sepet, ayrı kasa oturumları ve kasa kapanışı sunar. Aynı kullanıcı farklı tarayıcılarda farklı kasaları açabilir; farklı kasaların çekmeceleri ayrıdır. Aynı kasada çalışmak için ikinci bilgisayar **Mevcut kasaya katıl** düğmesiyle tek oturuma katılır; sepetler ayrı, bakiye ve kapanış ortaktır. Yeni kayıtlar `0007_market_pos.sql`, ortak cihaz katılımı ise `0008_shared_register_devices.sql` migration’ıyla eklenir. Güncelleme ve sınırlar için [market kasa pilotu rehberi](docs/market-kasa-pilotu-2026-10-16.md) dosyasını okuyun.

Satış kaydı ilk aşamada yalnız DEMO firmada açıktır. Banka cihazı, mali belge, yazıcı/çekmece protokolü ve merkez senkronizasyonu henüz bağlı değildir. Satışın stok hareketi aynı DB transaction’ında kaydedilir; bu kayıtlar eski personel vardiya hesabına otomatik ödeme/slip olarak eklenmez.

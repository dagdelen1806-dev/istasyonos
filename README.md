# İstasyonOS — bağımsız çalışma sürümü

**Windows kullanıyorsanız önce [WINDOWS-BASLANGIC.md](WINDOWS-BASLANGIC.md) dosyasını okuyun.** Docker Desktop açıkken `BASLAT.cmd` kurulumu ve başlatmayı yapar.

React/TypeScript arayüzü ve MySQL uyumlu operasyon backend’i. Varsayılan kimlik doğrulama artık Manus gerektirmeyen e-posta/parola girişidir. Güncel kaynak aktarım ve kurulum bilgisi `README-PAKET.md` içindedir.

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

## Laragon / sayfa açılmıyor

`pnpm dev` açık kalırken ikinci terminalde `node scripts/diagnose-local.mjs` çalıştırın. Komut yalnız okuma yapar: yerel sunucu, HTML/JavaScript, girişsiz API koruması, DB bağlantısı ve bekleyen migration'ları kontrol eder. Parola, `.env` veya kayıt içeriği yazdırmaz; tanı çıktısı paylaşılabilir. Tarayıcıdaki oturumlu iş akışını veya Laragon alan adı/proxy ayarını doğrulamaz.

`Server listening on port 3000` sonrasında önce Windows'taki tarayıcıdan `http://localhost:3000` deneyin. Bu açılıyor, `http://istasyonos.test` açılmıyorsa Laragon yönlendirmesini inceleyin. `baseline-browser-mapping` güncellik uyarısı tek başına başlatma hatası değildir. `ER_DUP_ENTRY` bir kayıt/tekillik çakışmasıdır; veritabanını veya kayıtları silmeyin. Yeni terminal kaydı `method=... route=...` ile hatalı isteği belirtir, SQL/kayıt değerlerini içermez. Bu rota ve ekrandaki hata ile teşhis edin; kayıt çakışmasını sayfa bağlantı hatası olarak varsaymayın.

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

## Market ön muhasebesi — 17 Ekim 2026

**24 Ekim stokta bağlı para ve marj uyarıları:** Raporlar merkezine güncel mali stok değeri, 30/60/90 günlük hareketsizlik/gözlem kapsamı, satılabilir–kapalı miktar ve özgün satış satırından zarar/düşük marj analizi eklendi. Yeni migration yok; 0020 dahil kurulum gerekir. [Kullanım ve hesaplama rehberi](docs/market-stok-sagligi-marj-2026-10-24.md).

**24 Ekim rapor filtreleri ve iptal denetimi:** Satış/ürün raporlarına kasa ve satışı yapan kişi filtresi; ayrı açıklamalı sepet iptal raporu eklendi. Filtreli görünümde genel giderler kasiyere dağıtılmaz. `0020_cart_event_sequence` gerekir. [Kullanım rehberi](docs/market-rapor-kontrol-2026-10-24.md).

**24 Ekim Raporlar merkezi:** Yeni `/raporlar` menüsünde tarihli satış özeti, nakit/kart/veresiye payları, kaynak fiş/iade ayrıntısı ve sayfalı ürün kârlılığı eklendi. Aylık kâr–zarar ve sayım raporları aynı merkezden açılır. Yeni migration yok; mevcut 0019 gerekir. [Kullanım ve kapsam](docs/market-raporlar-merkezi-2026-10-24.md).

**24 Ekim raf etiketleri:** Perakende fiyatına göre etiket kuyruğu, kayıtlı A4/PDF baskı paketi, ayrı fizikî yerleştirme teyidi ve onaylı el terminalinden raf/kasa fiyat kontrolü eklendi. Eski paketler güncel fiyatla kontrol edilir; fiyat farkı otomatik indirim veya fiyat değişikliği yapmaz. `0019_shelf_labels` gerekir. [Etiket rehberi](docs/market-raf-etiketleri-2026-10-24.md).

**24 Ekim satın alma siparişleri:** Kritik stoktan tedarikçi taslağı, yönetici onayı, kısmi/tam teslimat, kalan fiyat revizyonu ve açıklamalı kapatma eklendi. Sipariş borç doğurmaz; gerçek kabul ortak stok/KDV/cari akışını kullanır. Açık onaylı miktarlar stok önerisine katılır. `0018_purchase_orders` gerekir. [Sipariş rehberi](docs/market-satin-alma-siparisleri-2026-10-24.md).

**23 Ekim sayım raporları:** Onaylanmış terminal sayımlarına tarih filtresi, dönem toplamı, ürün/parti ayrıntısı ve CSV eklendi. Tutarlar kayıtlı fişten, adetler sayım anındaki veriden alınır. Yeni SQL göçü yok; 0017 dahil şema gerekir. [Sayım raporu rehberi](docs/market-sayim-raporlari-2026-10-23.md).

**El terminalinde parti sayımı:** Takipli ürünlerde gerçek parti seçimi, sayılmayanı koruma, ortak cihazdan okutma, stok değişince yeniden sayım ve yetkili net maliyet onayı eklendi. `0017_terminal_lot_counts` gerekir. [Parti sayımı rehberi](docs/market-terminal-parti-sayimi-2026-10-19.md) kullanım ve muhasebe kurallarını açıklar.

**19 Ekim ürün listesi güncellemesi:** Dosya/yapıştırma önizlemesi, kaynak stok kodu, mevcut kart koruması, grup %1/%10/%20 KDV seçimi ve yalnız DEMO için artı başlangıç stoğu/net maliyet aktarımı eklendi. `0015_catalog_imports` ve `0016_catalog_opening` gerekir. [Ürün aktarım rehberi](docs/market-urun-aktarimi-2026-10-19.md), muhasebe etkisini ve Windows güncellemesini açıklar.

**Lot ve SKT güncellemesi:** Ürün bazında takip açılışı, çok partili kabul, FEFO satış, karantinalı müşteri iadesi, gerçek partiyle tedarikçi iadesi, parti sayımı ve maliyetli fire eklendi. `0014_inventory_lots` gerekir. [Lot/SKT rehberi](docs/market-lot-skt-2026-10-17.md), kullanım ve fizikî stok sınırlarını açıklar.

**Stok ve el terminali güncellemesi:** Ürün/raf kartı, minimum–maksimum ve paket katıyla alım önerisi, çoklu barkod, fiyat listeleri, kayıtlı cihazdan ortak mal kabul/sayım, stok değiştiğinde yeniden sayım koruması, tarihli hareket/CSV ve aylık kâr–zarar eklendi. `0013_inventory_operations` göçü gerekir. TC73/DataWedge, diğer klavye okuyucular, Windows güncellemesi ve kapsam için [stok ve terminal rehberini](docs/market-stok-terminal-2026-10-17.md) okuyun.

**İadeler güncellemesi:** Kaynak belgeli kısmi satış/alış iadesi, özgün fiyat/KDV, stok maliyeti, cari mahsup ve teyitli manuel para iadesi eklendi. `0012_market_returns` göçü gerekir. Kullanım ve sınırlar için [market iadeleri rehberini](docs/market-iadeleri-2026-10-17.md) okuyun.

**Market muhasebesi** (`/market-muhasebe`), POS satışlarını stok maliyeti, müşteri/tedarikçi carisi ve kasa/banka defterine bağlar. Mal kabul, veresiye, kısmi tahsilat/ödeme, KDV ayrımı, ağırlıklı maliyet, gider/komisyon, açıklamalı ters fiş, cari ekstre/CSV ve gün sonu vardır. `0011_market_accounting` göçü gerekir. Açılış koşulları, Windows/Laragon güncellemesi, resmî rakip kaynakları ve mali kapsam için [Market ön muhasebe rehberini](docs/market-on-muhasebe-2026-10-17.md) okuyun. POS’un DEMO sınırı, mevcut vardiya onayları ve banka/mali belge entegrasyonu sınırları sürer.

## Market satış kasası pilotu — 16 Ekim 2026

**17 Ekim V2 güncellemesi:** Kalıcı sepet, bekletme/başka cihazdan çağırma, açıklamalı ürün/adet/sepet iptali, iptal geçmişi, nakit–kart karma ödeme ve yeni dokunmatik kasa ekranı eklendi. `0009_pos_carts` ve `0010_pos_mixed_payment` göçleri gereklidir. Native Windows/Laragon güncellemesi, resmî rakip kaynakları ve sınırlar için [Kasa V2 rehberini](docs/market-kasa-v2-2026-10-17.md) okuyun.

Yeni **Satış kasası** menüsü (`/kasa`), barkod/ürün seçimi, sepet, ayrı kasa oturumları ve kasa kapanışı sunar. Aynı kullanıcı farklı tarayıcılarda farklı kasaları açabilir; farklı kasaların çekmeceleri ayrıdır. Aynı kasada çalışmak için ikinci bilgisayar **Mevcut kasaya katıl** düğmesiyle tek oturuma katılır; sepetler ayrı, bakiye ve kapanış ortaktır. Yeni kayıtlar `0007_market_pos.sql`, ortak cihaz katılımı ise `0008_shared_register_devices.sql` migration’ıyla eklenir. Güncelleme ve sınırlar için [market kasa pilotu rehberi](docs/market-kasa-pilotu-2026-10-16.md) dosyasını okuyun.

Satış kaydı ilk aşamada yalnız DEMO firmada açıktır. Banka cihazı, mali belge, yazıcı/çekmece protokolü ve merkez senkronizasyonu henüz bağlı değildir. Satışın stok hareketi aynı DB transaction’ında kaydedilir; bu kayıtlar eski personel vardiya hesabına otomatik ödeme/slip olarak eklenmez.

# Ürün listesi ve DEMO başlangıç stoğu — 19 Ekim 2026

Market muhasebe → **Ürün aktarımı**, dosyadan veya yapıştırılan sekmeli metinden yeni ürün kartları açar. Muhasebe defteri henüz başlamadıysa aynı ekran açılış formunun altında da bulunur. `0015_catalog_imports` ve `0016_catalog_opening` göçleri gerekir. Mevcut barkodlu ürünlerin stoğu, fiyatı, KDV'si ve geçmişi değiştirilmez.

## Dosya biçimi

UTF-8 veya BOM'lu UTF-16 metin, aynı sırada dokuz sekmeli sütun beklenir:

```text
Stok Kodu	Stok Adı	Barkodu	Grubu	Kalan Miktar	Birimi	Satış Fiyatı 1	Alış Fiyatı 1	İskonto 1 %
```

En fazla 5.000 ADET ürün, 1 milyon karakter/2 MB dosya alınır. Barkod 4–32 rakamlık metindir; baştaki sıfırlar korunur. Kod/barkod listede tekil, miktar tam sayı olmalıdır. Fiyatlar `20,40` veya `20.40` biçiminde, binlik ayraç olmadan verilir. İskonto kaynak kaydında tutulur, fiyatlara tekrar uygulanmaz. Stok kodu ürün kartında saklanır ve ayrıntılı stok aramasına katılır.

## İki aktarım yöntemi

**Yalnız yeni ürün kartları** varsayılandır. Yeni kartın miktarı ve net maliyeti sıfır, KDV'si tanımsızdır. Kaynak satış fiyatı aynen kopyalanır. Kaynak miktar ve alış fiyatı denetim kaydında korunur; cari ve mali bakiyeler değişmez. KDV ve gerçek kabul maliyeti sonradan tanımlanabilir. Bu metadata aktarımı kapalı günde de yapılabilir.

**DEMO başlangıç stoğu** yalnız sunucuda DEMO işaretli firmada kullanılabilir. Yeni kartın miktarı `abs(kaynak miktar)` olur; kaynak eksi miktar olduğu gibi denetim kaydında kalır. Alış Fiyatı 1 açık kullanıcı teyidiyle KDV hariç net birim maliyet alınır. Satış Fiyatı 1 mevcut etiket fiyatı olarak korunur; üzerine ayrıca KDV eklenmez. Her yeni ürün grubuna %1, %10 veya %20 seçilmesi zorunludur; oranı seçilmemiş grup için kayıt reddedilir. Hem artı DEMO miktarı hem net alış maliyeti ayrı ayrı teyit edilir. Kaynaktaki eksi stok fizikî mal mevcudiyeti kanıtı değildir; gerçek şirketlerde bu kısayol kullanılamaz.

Bu pilotta kullanıcının verdiği başlangıç seçimleri **GIDA %1, İÇECEK %10, KİŞİSEL BAKIM %20, ARAÇ BAKIMI %20** olarak ekranda doldurulur ve düzenlenebilir. Diğer gruplar boş bırakılır. Bunlar ürün sınıflandırma mevzuatı veya tüm gıda/içecekler için hukuki oran iddiası değildir. Özellikle sigara, puro ve özel matrah/ÖTV kapsamları genel sayısal KDV seçimiyle modellenmez; uygulama resmî vergi beyannamesi veya mali belge düzenlemez. Ürüne özel oran sonradan **Stok ve fiyat → Fiyat/KDV** üzerinden değiştirilebilir; eski satış/alış vergi anlık görüntüleri korunur.

Listeyi kontrol ettikten sonra kaynak işaretli miktar, yeni miktar ve net stok değeri gösterilir. İlk 100 satır ekranda, tüm satırlar CSV'de bulunur. Grup oranı veya kaynak metin değişince eski önizleme iptal edilir. Önizleme dosyayı kaydetmez ve stok oluşturmaz.

## Muhasebe ve tekrar koruması

Defter başlamadan önce DEMO stok, ürünün mevcut miktarı/net maliyeti olur; defter açılışında sahibi bu stoğu ayrıca kabul eder. Defter başladıktan sonra tek transaction içinde stok miktarı/değeri, giriş hareketi, kaynak liste kaydı ve dengeli `DEMO_CATALOG_OPENING` fişi oluşur: **INVENTORY borç / OPENING alacak**. Satış, stok kazancı, cari tedarikçi borcu, nakit/banka hareketi veya indirilecek KDV oluşmaz. Günlük/aylık faaliyet kârını artırmaz. Göçler mevcut kartları veya kapanış anlık görüntülerini değiştirmez.

Kapalı işlem gününe yeni DEMO stoğu yazılamaz. İstasyon → defter → ürün kilit sırası, yetki, CSRF, tenant ve aynı istek kimliği korunur. Aynı dosyanın hash'i istasyon içinde tekildir: iki aktör aynı anda yüklese de tek aktarım olur. Önceden yalnız kart olarak yüklenmiş listeyi başka yöntem/ayarlarla tekrar kullanmak stoğu artırmaz; kaynak kontrollü sayım veya belgeli mal kabul kullanılmalıdır. Farklı dosya adı aynı içeriği ikinci kez yazdırmaz. Aynı kodun başka barkoda ait olması bütün aktarımı durdurur. Mevcut barkodlar korunarak atlanır; 5.000 kart sınırı aşılmaz.

Kayıt sonrası bağlantı kesilirse sayfayı yenileyip **Aynı muhasebe isteğini kontrol et** kullanılır. Bekleyen istek özgün kimliğiyle saklanır; yeni kimlikle ikinci stok kaydı açılmaz. Son 20 aktarım listesi, ekleyen kullanıcı, kaynak miktar özeti, yöntem ve DEMO stok değeri ekranda bulunur. Kaynak satırlar ve seçilen KDV haritası DB'de denetim kaydında tutulur; bu kayıt DB yöneticisine karşı sertifikalı değişmez arşiv değildir.

Kaynak dosya lot/SKT içermez. Yeni kartlarda takip kapalıdır; gereken ürünlerde gerçek etiket bilgisiyle **Lot ve SKT** ekranından açılır. İçe aktarılan stoklara tarih veya parti uydurulmaz.

## Windows güncellemesi

Mevcut `.env` dosyanızı koruyun ve DB yedeği alın. Eski `pnpm dev` işlemini durdurup güncel `main` kaynaklarını aktarın. Laragon MySQL açıkken proje terminalinde:

```powershell
pnpm install --frozen-lockfile
pnpm tsx server/stationos/migrate.ts
pnpm dev
```

Göçler `0016_catalog_opening` dahil uygulanmalıdır. Yeni/boş kurulumda kullanıcı tabloları için önce `pnpm db:migrate` de gerekir. İndirilen 19 Ekim `paket-2026-10-19` arşivi önceki çalışma kopyasıdır; bu geliştirmeleri almak için güncel `main` kullanılır. Bulutta yapılan kodlama Windows dosyalarını veya veritabanını kendiliğinden değiştirmez.

## Doğrulama ve veri gizliliği

69 birim/sözleşme testi, TypeScript ve üretim derlemesi geçti. `scripts/smoke-catalog.ts` yalnız `SMOKE_TEST=1`, loopback ve tam adı/socket yolu eşleşen ayrı `istasyonos_pos_v2_test` DB'sini kabul eder. Geliştirme/üretim kontrolleri kart aktarımı, rol/tenant/CSRF, kaynak işaretlerinin korunması, eski kartların değişmemesi, önizleme çakışması, paralel aktarım, aynı-ID, net DEMO açılış, KDV eksikliği, değişmiş ayarlar, önceki listeyi farklı yöntemle tekrarlama, dengeli fiş, kapalı gün/gerçek firma reddi ve kapanış korumasını kapsar.

Chromium geliştirme ve üretim kontrolleri gerçek 114 satırlık dosyada yalnız önizlemeyi sınar: −411 kaynak miktar, +411 adet DEMO planı, verilen dört grup seçimi ve diğer gruplar boşken kayıt engeli. Gerçek dosya bu koşuda mali kayda aktarılmadı; eksik oranlar tahmin edilmedi. Sentetik ürünlerde net maliyet/%1/%10/%20, iki teyit, oran değişince önizleme iptali, CSV, kayıt sonrası kayıp yanıt/yenileme/aynı-ID tek açılış ve 390px taşma kontrol edildi. Haricî ağ isteği ve JS sayfa hatası yoktu. Fizikî Windows/MySQL8 ve el terminali saha kabulü yapılmadı.

Gerçek ürün/fiyat listesi, test erişimleri, `.env`, DB dökümü ve ekran görüntüleri Git'e veya herkese açık pakete eklenmez. Yalnız kaynak kod ve sentetik örnekler yayımlanır.

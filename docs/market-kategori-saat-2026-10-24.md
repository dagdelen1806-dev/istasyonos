# Satış anındaki kategori ve saatlik analiz

24 Ekim 2026. **Raporlar → Kategori / saat analizi** eklendi. Önceki satış, kasa/kasiyer, iptal ve stok/marj raporları korunur. Bu teslim `0021_sale_category_snapshot` göçünü gerektirir. Bağımlılık/lockfile veya bulut ayar taslağı değiştirilmedi; güncel kaynak GitHub main dalıdır.

## Kategori geçmişi

Yeni göç satış satırına nullable `category_snapshot` ekler. Yeni satış tamamlanırken sunucuda kilitli okunan ürün kategorisi, aynı satış transaction'ında ürün/fiyat snapshotlarıyla birlikte saklanır. Ürün kartı sonradan başka kategoriye taşınsa da fişin kategorisi değişmez. Doğrudan uyumlu checkout ve kayıtlı sepetten checkout aynı yazarı kullanır. Miktar, fiyat, vergi, maliyet ve dengeli fiş kuralları değiştirilmedi.

Eski satışlara güncel karttan otomatik kategori doldurulmaz:

- `NULL`: **Geçmiş kategori kaydı yok**. Kategori bilinmiyordur; bugünkü kategori tahmin edilmez.
- Boş metin: **Kategorisiz (satış anında)**. Yeni satışta kategori alanının boş olduğu kaydedilmiştir.
- Dolu metin: Özgün kaydedilmiş kategori adı. Büyük/küçük harf farkı korunur; kategori adının sonradan yeniden yazılması eski grubu birleştirmez. Tam metin farklıysa ayrı gruptur; örneğin farklı büyük/küçük harfli adlar ayrı kalabilir.

Kategori adının geçmişte bilinmemesi rapor toplamını sıfırlamaz; tutar ayrı bilinmeyen grupta görünür ve kapsam uyarısı gösterilir. Bu eski veriden tam bir kategori geçmişi çıkarıldığı anlamına gelmez. Kullanıcı manuel sınıflandırma/geriye dönük düzeltme akışı bu teslimde eklenmedi.

Satış iadeleri bugünkü ürün kategorisine değil, özgün kaynak fiş satırının kategorisine bağlanır. Eski kategori kaydı olmayan satışın bugünkü iadesi de bilinmeyen gruptadır. İade kendi kayıtlı iş gününde düşer; eski satış gününü değiştirmez. Kaynak satır eksik veya net/KDV/maliyet bilgisi tutarsızsa 409 döner; güncel kart/fiyattan tamamlanmaz.

## Kullanım ve hesaplar

Tarih aralığı (en fazla 366 gün), kasa ve **Satışı yapan** filtrelerini seçip **Kategori/saat analizini getir / yenile** kullanın. Filtreler bu sekmeye aittir; diğer raporların bekleyen seçimleri otomatik taşınmaz. Ekranda uygulanan tarih/kasa/kullanıcı ve mali kayıt sınırı yazılır. Başka kişinin yaptığı iade, özgün satışın kasa/kullanıcısıyla filtrelenir.

Üst kartlar KDV dahil satış ve iade, iade sonrası net ciro, KDV hariç net satış, kayıtlı satış maliyeti ve brüt kâr gösterir. Genel giderler kategori veya saate tahminen dağıtılmaz; bu net işletme kârı değildir. Satış fişi ve iade belgesi sayıları ayrıdır. Ortalama satış fişi, iadeler düşülmeden satış brüt toplamı / tamamlanmış satış fişi sayısıdır. Boş dönemde ortalama tanımsız gösterilir.

Kategori tablosunda özgün kategori, satış/iade fişi sayısı, KDV dahil satış/iade, KDV hariç net satış, maliyet ve brüt kâr bulunur. Bir fişte iki kategoriden ürün varsa her kategoride bir fiş olarak görünür, genel fiş toplamında yalnız bir kez sayılır. Bu nedenle **kategori fiş sayılarını toplayarak genel fiş sayısı elde edilmez**; para toplamları ise kategori ve saatten genel toplama mutabık olmalıdır.

Kategori tablosu tam kategori adı sırasıyla 50 satırlık istemci sayfalarına ayrılır. **Kategori tablosunda ara** yalnız bu tabloyu/CSV sayfasını daraltır; üst toplamları ve saat grafiğini değiştirmez. Kategori tutar sıralaması veya kategoriye özel fiş/ürün ayrıntısı bu teslimde yoktur; fiş ayrıntıları mevcut Satış özeti ekranından incelenir.

Kategori CSV'si yalnız bu sayfayı, saat CSV'si bütün 24 saat satırını indirir. Dönem, uygulanan kasa/kullanıcı kimlikleri, kayıt sınırı, para biriminin kuruş olduğu başlıklar ve kategori kaynağı/saat dilimi bulunur. Henüz uygulanmamış form değişikliği dosyanın kapsamını değiştirmez. Mevcut formül güvenli CSV metin işlemesi kullanılır; gerçek XLSX/PDF veya otomatik gönderim eklenmedi.

## İstanbul saati ve gece yarısı

Mali dönem filtresi kaydedilmiş `business_date` alanını kullanır. Saat ise kaynak satış/iade işleminin UTC kayıt zamanının **Europe/Istanbul** yerel saatidir. Bunlar farklı kavramlardır; gece yarısında kasa oturumu birden fazla mali güne uzanabilir. Bu rapor kayıtlı iş günü kapsamını sessizce değiştirmez.

SQL önce gerçek UTC tarih/saat dilimlerinde toplar, Node IANA saat dilimiyle İstanbul saatine çevirir ve 24 yerel saat kovasına birleştirir. Sabit +3 her tarih için varsayılmaz; eski IANA ofsetleri de kullanılabilir. Örneğin 2026'da UTC 21:05 İstanbul'da ertesi gün 00:05, UTC 20:59 İstanbul'da 23:59'dur. İade saati yeni iade işleminin saatidir, özgün satışın saatine taşınmaz.

Seçilen bütün iş günlerinin aynı yerel saatleri birlikte toplanır. Tablo her zaman 00:00–01:00'dan 23:00–24:00'a kadar 24 satırdır; işlemsiz saatler sıfırdır. Son satırın 24:00 bitişi ertesi günün 00:00 anıdır. Çok ürünlü fiş saat başına yalnız bir kez sayılır; satır adedi ortalama fiş paydası değildir.

Grafik satışların KDV dahil brüt tutarını gösterir; iadeler ayrı tablo sütunundadır. Böylece negatif iade etkisi yeni satış yoğunluğu diye çizilmez. Saati dokunarak veya klavye Enter/Boşluk ile seçince satış adedi, satış, iade ve brüt kâr özeti görünür. Filtre değişince eski saat seçimi temizlenir. Grafik yaklaşık görsel ölçektir; mali hesaplar integer kuruş/BigInt kurallarıyla yapılır.

## Doğruluk ve yetki

`GET /api/stationos/market-accounting/reports/sales-analysis` yalnız OWNER/MANAGER/ACCOUNTANT, her istekte şirket/istasyon ve filtre kapsamıyla çalışır. Personel menü veya API'yi kullanamaz. Tarih/kasa/kullanıcıya ait bütün sonuçlar aynı transaction içinde ve kesin BIGINT metin `asOf` mali kayıt sınırında okunur. Yeni satış/iadeler için yenileme gerekir; eski sınırdaki geçmiş tutarlar yeni kaydı içermez. Bu kalıcı, sertifikalı bir rapor arşivi değildir. Kasa/kullanıcı görünen adları günceldir.

Kategori ve saat para toplamları, mevcut satış raporu/mali defter net satış ve COGS toplamları, satış/iade brütleri ve fiş sayılarıyla kontrol edilir. Satış satırları, iade satırları ve özgün satış kimliği kendi kayıt düzeylerinde ele alınır; karma ödeme veya çok kategorili fiş JOIN ile ciroyu çoğaltmaz. Uyuşmazlıkta 409 döner; eksik tutar veya geçmiş kategori bugünkü karttan tahmin edilmez.

En fazla 5.000 kategori ve ara toplamda 10.000 gerçek UTC saat kovası desteklenir; aşılırsa aralığı daraltma hatası verir, veri sessizce kesilmez. Tarih aralığı ve mevcut istasyon/tarih/kaynak indeksleri kullanılır. Büyük saha verisinde sorgu planı/yük kabulü ayrıca gerekir; pilot hacmi üretim performans garantisi değildir. Kategori bazında ürün miktarı gibi farklı temel birimlerin toplanacağı yanıltıcı tek adet metriği üretilmedi.

Rapor GET işlemleri stok, fiş, bakiye/revizyon veya kapanışlara yazmaz; kapalı günde okunabilir. Yeni yazma yalnız satış satırına kategori snapshotıdır; satışın stok, vergi, maliyet ve kasa etkileri önceki ortak transaction'ında kalır. Banka, mali cihaz, kanuni rapor/beyanname veya bağlantısız tarayıcı entegrasyonu eklenmedi.

## Windows / Laragon güncellemesi

Proje/DB yedeğini alın, çalışan eski `pnpm dev` işlemini durdurun. Kendi `.env` dosyanızı koruyarak GitHub main kaynaklarını aktarın:

```powershell
pnpm install --frozen-lockfile
pnpm tsx server/stationos/migrate.ts
pnpm dev
```

**0021 göçü zorunludur; sunucu migration'ı kendiliğinden uygulamaz.** Yeni/boş DB için ilk `pnpm db:migrate` ayrıca gerekir. Menüden **Raporlar → Kategori / saat analizi** açılır. GitHub'a kod aktarımı Windows dosyalarını otomatik güncellemez. Önceki POS DEMO ve erişilebilir ortak sunucu/LAN sınırları sürer.

## Doğrulama

24 Ekim: 22 dosyada **134 test**, TypeScript ve üretim derlemesi başarılı. Dokuz yeni test geçmiş/boş/dolu kategori kimliğini, gerçek kategori adının fallback etiketiyle karışmamasını, İstanbul gece yarısını ve tarihî UTC+2 ofsetini, geçersiz zamanı, 24 boş/dolu saat birleştirmesini, ayrı iade saatini, çok satırlı fişin tek sayılmasını ve büyük kuruş/taşma sınırlarını kapsar.

0021 mevcut verili ayrı test ve ana bulut geliştirme DB'sine uygulandı; tekrar çalıştırma no-op. Ana salt okunur tanı HTTP/HTML/JS/401/SELECT 1/kullanıcı şeması ve 21 göçle geçti. Bulut ayar taslağı değiştirilmedi.

Mevcut rapor HTTP paketi dev3303 ve son üretim3304 üzerinde açık DEMO fixture oluşturdu (`SMOKE_LEAVE_OPEN=1` kapanış bölümünü atlar). `scripts/smoke-sales-analysis.ts` yalnız açık `SMOKE_TEST=1`, loopback ve tam `istasyonos_pos_v2_test` socket DB'de her iki modda geçti: satış anı kategorisi/kart değişimi/kaynak kategoriye iade, NULL ile boş kategori ayrımı, gece yarısı ve ayrı iade saati, çok satır/kategori ve aynı-ID tek satış, kasa/kasiyer/kesişim ve başka aktör iadesi, 56 kategori/106 fiş, sabit kayıt sınırı, boş dönem, bozuk mali snapshot reddi ve kapalı gün stok/bakiye/revizyon/kapanış değişmezliği. Son üretimde kayıtlı sepet checkout da kategori snapshotıyla kontrol edildi.

Testte sadece izole sentetik DEMO satış/saat/iş günü/defter başlangıcı ve eski kategori NULL durumu özel olarak hazırlanır; gerçek geçmiş veya gerçek DB üzerinde çalıştırılmaz. Bozuk net snapshot aslına geri döndürülür. Kontrol paketi kasaları/günü kapatır; tüketilmiş fixture tekrar kullanılmaz. Erişim ve sonuçlar Git dışında `/workspace/sales-analysis-test` altında tutulur; kullanıcı listesi/parola/DB pakete eklenmez.

Chromium geliştirme/son üretimde masaüstü sahip, 390 px yönetici ve engelli personel: 56 kategoride 50+6 sayfa/arama/CSV, eski kategori uyarısı, filtreli toplamlar, 24 saat CSV'si, klavye/dokunmayla saat seçimi, filtreyle seçimin temizlenmesi, bekleyen seçimin CSV kapsamını değiştirmemesi, boş dönemde 24 sıfır satır kontrol edildi. Stok/bakiye/revizyon/kapanış değişmedi; JS hatası, haricî HTTP veya mobil yatay taşma yoktu. Fizikî Windows/MySQL 8 ve üretim yük kabulü yapılmadı.

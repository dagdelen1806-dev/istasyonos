# Market stok ve el terminali — 17 Ekim 2026

**Market muhasebesi → Stok ve fiyat**: ürün/raf kartı, çoklu barkod, fiyat listesi ve kritik stok. **El terminali** (`/el-terminali`): tarayıcıdan cihaz kaydı, ortak mal kabul ve stok sayımı. **Aylık kâr–zarar**: iadeler sonrası net satış, maliyet ve giderler. Ticari defter açılışı gerekir; eski satış, iade, cari ve gün sonları korunur.

## Ürün kartları ve alım önerisi

**Kart / Planlama** ile ad, kategori, marka, temel birim, raf, market tedarikçisi, minimum/maksimum stok, tedarik/gözden geçirme/güvenlik günleri, alım paket katı ve alış KDV'si düzenlenir. Temel birim miktarları tam sayıdır; birime “kg” yazmak kesirli tartım desteği sağlamaz.

Son 28 gün satış eksi iadelerinden günlük ortalama çıkarılır; negatif net miktar sıfıra çekilir. Hedef `max(minimum, maksimum, ceil(günlük ortalama × (tedarik + gözden geçirme + güvenlik günleri)))` olur. Mevcut stok düşülür, pozitif ihtiyaç paket katına yukarı yuvarlanır. **Maksimum hedef seviyedir; katı tavan değildir.** Sıfır, satış hızına göre otomatik hedef demektir. Satış yoksa minimum/maksimum kullanılır.

Stok minimuma eşit/altında veya tahmini yetecek gün tedarik + güvenlik süresine eşit/altındaysa kritiktir. “28 günlük kayıtta satışı olmayan”, ürünün 28 gündür rafta olduğu iddiası değildir. Kritik/sıfır/durgun/kategori filtreleri, ürün/raf araması ve tüm eşleşmelerin CSV'si vardır.

Alım tahmini son net alış fiyatından, yoksa ortalama net maliyetten çıkar. Alış KDV'si bilinmiyorsa brüt tutar/kredi uygunluğu hesaplanmaz; satış KDV'si yerine kullanılmaz. Aynı tedarikçinin kalan cari limiti kritik/yetecek gün/ad sırasındaki öneriler arasında paylaşılır. Bu rezervasyon veya gönderilmiş sipariş değildir; fiyat/teslim süresi/limit teyidi gerekir. Eski satın alma yardımcısı eski toptancı kartlarını, yeni ekran ticari defterin **market carilerini** kullanır; otomatik eşleştirme yapılmaz.

## Barkod ve fiyat listeleri

- **Barkodlar:** Ana barkod 1 temel birimdir. Farklı ambalaj/koli barkodu ve iç adedi eklenir; 6'lı barkod bir okutmayla 6 adet eder. İstasyonda barkod başka ürüne verilemez. Ana barkod silinemez veya koliye çevrilemez. Ürün başına toplam 20 barkod vardır.
- **Fiyat listesi:** Perakendeye ek Toptan/Personel/Üye gibi en fazla 20 isimli liste tanımlanır. Aktif ve kasiyere açık ayarları ayrıdır. **Liste fiyatı**, ilgili ürünün KDV dahil temel birim fiyatıdır. Eksik fiyat perakendeye dönmez. Perakende **Fiyat / KDV** düğmesindedir. Kullanıcı ve eski/yeni tutarla son 100 fiyat değişikliği gösterilir; geçmişe dönük tarihçe üretilmez.
- Kasadaki **Satış fiyat listesi** yeni eklenen satırlar içindir. Mevcut satır listesi bekletme/çağırmada korunur. Aynı ürünü başka listeyle eklemek için eski satır açıklamayla kaldırılır. Fiyat değişince güncel fiyat alıp incelemek gerekir. Kapalı veya kasiyere yasak liste sunucuda reddedilir. Satışta liste adı/kimliği kaydedilir; iade özgün fiyatı kullanır.

## Zebra TC73 ve eldeki cihazın tanıtılması

1. Cihaz ile sunucuyu aynı ağa bağlayın. Terminalde `localhost` terminalin kendisidir; sunucu bilgisayarının erişilebilir LAN adresini/alan adını kullanın. `istasyonos.test` yalnız Windows hosts kaydıysa Android'e kendiliğinden çözülmez; yerel DNS veya sunucunun LAN adresi gerekir.
2. Uygulamaya girin, **El terminali** açın; cihaz adı, model ve platformla kayıt yapın. MARKET_STAFF/PURCHASER/ACCOUNTANT kaydı yönetici onayı bekler. OWNER/MANAGER kendi kaydını etkin açabilir.
3. OWNER/MANAGER aynı istasyonda **Kayıtlı cihazları yönet** alanından onaylar/devre dışı bırakır. Okutma ve taslak açma için etkin kayıt gerekir. Mali yetkili gelen taslağı masaüstünde de onaylayabilir; o ekranın fizikî okuyucusu olması gerekmez.
4. TC73 DataWedge'de tarayıcıya bağlı profil, **Barcode Input**, **Keystroke Output** ve son ek **Enter** kullanın. Barkod alanına dokunup okutun. Diğer USB/Bluetooth/Android cihazlar da klavye + Enter çıktısıyla çalışabilir. Koli iç adedi barkod kartından gelir.

Bu kayıt tarayıcı UUID'sine dayanır; seri numarası/sertifika/MDM veya fizikî donanım kimlik doğrulaması değildir. Tarayıcı verisini silince yeni kayıt/onay gerekir. Android uygulaması, kamera okuyucu veya üretici SDK/Intent eklentisi içermez. Fizikî TC73 henüz test edilmedi; DataWedge profilini, klavye düzenini, baştaki sıfırları ve Enter davranışını pilotta doğrulayın.

## Mal kabul

Onaylı cihazda **Mal kabul** ile taslak açın ve okutun. **Üzerine ekle**, alınan adede ekler. **Miktarı değiştir**, satır toplamını değiştirir; koli barkodunda miktar yine koli sayısıdır. Tam temel birim miktarı için ana barkodu kullanın. Sıfır kabul satırını mali onaydan çıkarır. Bir kabul en fazla 100 ürün, satır başına 10.000 temel birim içerir.

OWNER/MANAGER/ACCOUNTANT taslakta tedarikçi, belge no, vade, KDV hariç birim maliyet ve alış KDV'sini kontrol eder. **Mal kabulünü işle**, stok + ağırlıklı net maliyet + indirilecek KDV + tedarikçi borcunu tek transaction'da kaydeder. Taslak/mali önizleme değişirse yenileme ister; mükerrer belge veya limit sorunu bütünü geri alır. Ödeme gerçekleşmiş sayılmaz; mevcut cari ödeme akışı kullanılır. İşlenmiş kabul için kaynak belgeli alış iadesi ve gerekiyorsa yeni alış gerekir.

## Sayım ve satış sırasında koruma

**Stok sayımı** açılınca o andaki ürün/adet/stok sürümleri alınır. Onaylı cihazlar aynı taslakta çalışabilir; başka cihazın değişikliği üzerine eski sürümle yazılmaz. Sonradan eklenen ürün yeni sayım gerektirir. Raf dahil arama, ilk 100 eşleşme ve bütün taslağın CSV'si vardır.

**Sayılmayan ürün sıfır değildir ve onayda değişmez.** Sıfır stok için ana barkod + **Miktarı değiştir → 0** kullanın. Fazlalık girdiğiniz net maliyetle, eksik mevcut ağırlıklı maliyetle hesaplanır. Sıfır maliyetli fazla ayrıca teyit ister. Yetkili fark önizlemesi ve açıklamayı onaylar; stok ve dengeli `STOCK_COUNT` fişi birlikte kaydolur.

Sayım sırasında satış/alış/iade/düzeltme olduysa stok sürümü değişir. Adet satış + iade ile eski seviyeye dönse bile eski sayım onaylanamaz. **Yeniden say** açıklamayla sayılan adedi temizler, güncel stoğu başlangıç alır; ürünü fizikî olarak tekrar sayın. Sayılan ürün tekrar değişirse yeniden sayılır. Otomatik satış mahsubuyla devam eden sayım yoktur; yoğun satışta raf/ürün için uygun zaman seçin.

Taslak iptali açıklamalıdır; okutma/yeniden sayım/onay olayları saklanır. Personel kendi, mali yetkili istasyondaki taslağı iptal edebilir. İşlenmiş/iptal taslak tekrar işlenemez. Ekran son 100 taslağı, son 50 olayı gösterir; sınır veriyi silmez. Bu uygulama erişim kuralıdır; DB yöneticisine karşı kriptografik değişmezlik değildir.

Yanıt belirsizse yeni işlem açmayın: **Aynı işlemin sonucunu kontrol et**, yenilemeden sonra da aynı istek kimliğini kullanır. Taslaklar sunucuda tutulur. İnternet kesildiğinde LAN'daki sunucuya erişim varsa çalışma sürer; sunucu/LAN yokken offline okutma veya mali işlem kuyruğu yoktur.

## Hareket ve aylık kâr–zarar

**Hareketler**, tarih aralığı açılış/kapanış/güncel adedi ve işaretli alış/satış/iade/sayımı 100 satırlık sayfalar/CSV ile gösterir. Tarih sınırı Türkiye günü, satır zamanı UTC'dir. Yeni uygulama SQL bağlantıları UTC'ye ayarlanır. Eski sürüm yerel saatle yazmışsa geçmiş zamanlar otomatik dönüştürülmez; ayrıca incelenmelidir.

**Aylık kâr–zarar**, seçilen/önceki ay karşılaştırması, dokunulabilir gün grafiği, net satış, satılan mal maliyeti, brüt kâr, gider/komisyon/stok-kasa eksiği, fazlalık, faaliyet sonucu, net alış/KDV, tahsilat/ödeme ve dönem sonu kasa/banka/kart alacağı/stok değerini içerir. Ürün brüt kâr listesi ilk 100 üründür; aylık toplam/CSV tüm fişleri, ürün CSV'si görünen ürünleri içerir.

Faaliyet sonucu = iadeler sonrası KDV hariç net satış − satılan mal maliyeti − kaydedilen giderler + stok/kasa fazlalığı ve ilgili maliyet farkları. Alışın tamamı gider değildir; sermaye/tahsilat satış geliri değildir. Defter öncesi geçmiş üretilmez. Resmî bilanço/kurumlar vergisi/amortisman/bordro hesabı değildir; girilmeyen gider sonuçta görünmez. Eski gün sonu anlık görüntüsü korunur; aylık ekran kaydedilmiş fişleri toplar.

## Yetki ve kapsam

Ürün/fiyat/stok raporları ve mali onay: OWNER/MANAGER/ACCOUNTANT. Cihaz onayı: OWNER/MANAGER. Okutma/taslak: bunlara ek MARKET_STAFF/PURCHASER. Personelin terminal yanıtında kayıtlı stok ve maliyet gizlidir; sayılan miktar ve stok değişti uyarısı görünür. Tenant/istasyon/CSRF/istek kimliği denetlenir. Kapalı güne mali onay verilmez; kart/cihaz düzenleme ve taslak toplama sürebilir.

Lot/SKT/FEFO, çok depo/transfer, kesirli terazi barkodu, kampanya/fiyat takvimi, mali belge/banka/yazıcı protokolü ve merkez senkronizasyonu bu teslimde yoktur. Sonraki stok aşaması lot–SKT, depo transferleri ve tartılı ürün olabilir. POS'un mevcut DEMO sınırı korunur.

## Windows / Laragon güncellemesi

Bulut kaynağı Windows klasörünü otomatik güncellemez. `pnpm dev` terminalini **Ctrl+C** ile durdurun, DB yedeği alın, kendi `.env` dosyanızı koruyun. Git checkout'ta yerel değişiklikleri kontrol ederek güncelleyin; ZIP'te güncel kaynakları kendi klasörünüze aktarın. Bulut `.env`/test verisini taşımayın.

```powershell
cd C:\laragon\www\istasyonos-main
pnpm install --frozen-lockfile
pnpm tsx server/stationos/migrate.ts
pnpm dev
```

`0013_inventory_operations` uygulanmalıdır. Ana barkodlar 1 birimle kaydedilir; mevcut stok/bakiye veya tedarikçi eşleşmesi yeniden hesaplanmaz. Gün varsayılanı 3/7/2, eski ürünün bilinmeyen alış KDV'si/son gerçek alış fiyatı boştur. Önceki 0001–0012 göçleri değişmez. MySQL DDL örtük commit yapabilir; yarım göçte tahminî elle SQL çalıştırmayın. MariaDB 11.8.6 doğrulandı; fizikî Windows/TC73 ve ayrı MySQL 8 doğrulaması pilotta yapılmalıdır.

## Geliştirici kontrolü

`pnpm check`, `pnpm test`, `pnpm build` kullanılır. `scripts/smoke-inventory.ts`, açık `SMOKE_TEST=1`, loopback sunucu ve tam DB adı/socket yolu eşleşen ayrı `istasyonos_pos_v2_test` ister; sentetik DEMO kullanıcı/firma oluşturur. Erişim dosyaları `/workspace/inventory-test` altında özeldir, paylaşmayın. Kullanıcının `istasyonos_db` veritabanında çalıştırılmaz.

Stok smoke'u rol/tenant, gizli maliyet, cihaz onayı, ana/koli barkodu, taslak sürümü ve aynı istek, mal kabul rollback, fiyat listeli kalıcı sepet/satış, satış + iade sırasında sayım koruması, yeniden sayım, sayılmayan/sıfır stok, maliyet onayı, ortak kredi bütçesi, aylık/günlük mutabakat, UTC ve dengeli fişleri kontrol eder. Önceki muhasebe/iade/POS/vardiya paketleri de geriye dönük kontrolde kullanılır. Tarayıcı doğrulaması fizikî okuyucu/saha pilotunun yerini almaz.

Doğrulama sonucu: 12 dosyada **57 test**, TypeScript ve üretim derlemesi başarılı. Stok HTTP paketi geliştirme ve son üretim derlemesinde, iki ayrı Chromium terminal/masaüstü akışı her iki modda geçti. 390px yatay taşma/JS sayfa hatası/harici istek görülmedi. Son üretim şemasıyla muhasebe, iade, ortak POS, kalıcı sepet ve eski iki mali imzalı vardiya paketleri geçti. Testlerde çok sayıda sentetik kayıt 429 sınırına ulaştığında yalnız test sunucusu yeniden başlatıldı; giriş koruması kapatılmadı. Ana geliştirme DB'de 0013 ve tekrar çalıştırma, ardından salt okunur tanı (13 göç, DB, HTML, JS, girişsiz 401) başarılı.

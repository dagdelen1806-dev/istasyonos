# Lot, SKT, karantina ve fire — 17 Ekim 2026

**Market muhasebesi → Lot ve SKT** (`0014_inventory_lots`) mevcut ürünlere isteğe bağlı parti takibi ekler. Takip kapalı ürünlerde eski stok/satış akışı sürer; geçmişe otomatik lot veya tarih üretilmez. Maliyet hesabı ürünün ağırlıklı **net** maliyetidir. FEFO (SKT'si önce dolacak kullanılabilir partinin önce çıkması), fizikî çıkış sırasıdır; ayrı bir maliyet yöntemi değildir.

## Başlangıç ve gerçek etiket bilgisi

Ürün seçin, **Lot takibini aç** düğmesiyle mevcut stoğu gerçek partilere dağıtın. En fazla 50 satırın toplamı fizikî stokla eşit olmalıdır. Stok ve maliyet değişmez. SKT bilinmiyorsa boş bırakılır; bilinmeyen veya geçmiş tarihli açılış partisi karantinaya alınır. Elde stok yoksa boş dağılımla takip açılabilir. Etkinleştirme açıklaması, aktör ve ilk eşleştirme saklanır.

Takip açıldıktan sonra kapatma bu sürümde yoktur. Önce tek bir ürün grubunda doğrulanmış açılış/pilot yapın. Lot kodu üreticinin parti etiketinden alınır; barkodun sayıya çevrilmesi veya ürün adına göre SKT tahmini yapılmaz. Ürünlerin tümüne kendiliğinden SKT zorunluluğu getirilmez; koruma yalnız takip açılmış ürünler için geçerlidir.

## Aynı alışta birden fazla parti

Masaüstü **Alış ve mal kabul** ve **El terminali → yetkili kabul onayı** ekranlarında takipli ürün için parti kodu/SKT/adet dağılımı açılır. **+ Kabul partisi ekle** ile aynı ürün tek belge içinde farklı partilere ayrılır. Toplam, kabul edilen temel birim adedine eşit olmalıdır. Yeni alışta SKT zorunlu, bugünden önce olmayan gerçek tarihtir. Aynı ürünün alış maliyeti/KDV'si satırın tüm partilerinde ortaktır; ayrı birim maliyetli aynı SKU satırları bu sürümde desteklenmez.

Ürün başına bir kabulde en fazla 50 parti, belgenin mevcut 100 ürün/ürün başına 10.000 birim sınırı geçerlidir. Mükerrer alış belgesi, yanlış toplam veya limit hatasında bütün lot/stok/KDV/cari değişiklikleri geri alınır. Aynı istek kimliği kayıp yanıttan sonra tekrarlandığında ikinci parti/borç oluşmaz. Terminal okuyucusu ürün barkodunu klavye + Enter olarak gönderir; parti/SKT dağılımı yetkili tarafından gerçek etikete bakılarak girilir. Kamera/GS1 AI(10)/(17) veya üretici SDK ayrıştırması yoktur.

## Satış ve raf uygulaması

Satışa uygun parti: durumu **Satışa açık**, SKT'si bilinen ve Türkiye işlem gününe eşit/sonraki tarihte olan partidir. **SKT günü sonuna kadar** bu uygulama kuralıyla satılabilir; ürünün hukuki/etiket koşullarını otomatik yorumlamaz. Tarih değişince arka plan işi beklenmeden yeni sorgu/checkout güncel günle kontrol eder. Karantina, geçmiş veya bilinmeyen SKT fizikî stoğa dahil kalır, satılabilir stoğa girmez.

Kasada satılabilir adet ve **Önce çıkar: parti / SKT** gösterilir. Sepete ekleme ve kesin satış sunucuda uygun miktarı kontrol eder. Satış, SKT/teslim zamanı/kimlik sırasıyla partileri tüketir; her partinin satış kimliği ve miktar çıkışı kaydolur. Bekletilen sepet lot rezervasyonu değildir. Başka kasa partiyi tüketmiş veya SKT geçmişse onayda yeniden değerlendirilir.

EAN ürün barkodu, raftan gerçekten alınan lotu kendiliğinden tanımaz. Otomatik kayıt FEFO'ya göre ayrılır; raftaki fizikî stok da aynı sırayla düzenlenmeli ve personel önerilen partiyi doğrulamalıdır. Bu kayıt her müşterinin elindeki ürünün gerçek lotunu donanımla doğruladığı iddiası değildir.

## Karantina ve iadeler

**Etiket / karantina** ile parti kapatılır veya fizikî incelemeden sonra açılır. Gerçek kod/SKT ve uygunluk teyidi ile en az 5 karakter açıklama gerekir. Yeni tarih uydurulmaz; geçmiş veya bilinmeyen SKT satışa açılamaz. Önceki/sonraki etiket, durum, açıklama ve aktör olayda saklanır ve ekranda görülür. Stok sürümü değişir; eski sayım/mali önizleme tekrar kullanılamaz.

Takipli ürünün **müşteri iadesi**, özgün satış maliyetiyle stoğa döner fakat SKT'siz yeni karantina partisine girer. Çünkü iadede fizikî olarak hangi lotun döndüğü otomatik bilinememektedir. Gerçek etiket ve uygunluk kontrolünden sonra açılabilir veya fireye ayrılabilir. Önceki/lot takibi öncesindeki satış için geçmiş lot bilgisi üretilmez. Takibi kapalı üründe önceki tekrar satılabilir iade davranışı sürer.

**Tedarikçiye iade** ekranında iade edilen gerçek parti seçilir. Seçilen parti aynı ürüne ait ve miktarı yeterli olmalıdır; karantina/geçmiş SKT partisi de iade edilebilir. Mali tutar kaynak alış belgesinden, stok çıkış maliyeti güncel ağırlıklı değerden hesaplanır; fark önceki iade muhasebesiyle ayrı gider/gelirdir. Seçilen gerçek parti, kredilendirilen kaynak belgeyle izlenir; farklı alıştan aynı ürünün partisinin seçilmesi otomatik olarak yasaklanmaz, tedarikçiyle belge/lot uygunluğu işletme tarafından kontrol edilir. Ekran bir ürün satırında tek parti seçer; API en fazla 50 parti dağılımını kabul eder. Farklı partiler için ayrı kısmi iadeler kullanılabilir.

## Parti sayımı ve fire

**Partiyi say** yalnız ilgili partinin gerçek sayımını işler. Eksik ürünün mevcut ağırlıklı maliyeti stok eksiği; fazlalığın girilen net birim maliyeti stok fazlasıdır. Sıfır maliyetli fazlalık açık teyit ister. Toplam ürün adedi, lot adedi, değer ve dengeli fiş tek transaction'da değişir. Sıfır adetli eski parti de fizikî fazlalık bulunursa sayılabilir; durum/SKT koruması devam eder.

**Fire işle** ile SKT geçmiş/hasarlı/kayıp ayrılan adet ve açıklama girilir. Miktar partinin stoğunu aşamaz. Net maliyet stoktan düşer, `STOCK_LOSS` gider hesabına yazılır; aylık/günlük faaliyet sonucu ve stok değeri güncellenir. Karantinaya alma tek başına gider değildir; fizikî stok hâlâ vardır. Fire işlemi banka veya cari borcu değiştirmez, resmî imha belgesi düzenlemez. Ürün/vergisel fire-imha işlemleri için gerekli resmî süreç ayrıca yürütülmelidir.

Lot takibi açık üründe eski toplam stok düzeltmesi veya terminaldeki toplam sayım, farkı partilere rastgele dağıtamaz. Fark varsa **Lot ve SKT → Partiyi say** kullanılır; terminalde toplam adet toplanabilir, ancak bu fark toplamdan doğrudan onaylanamaz. Farksız toplam sayım stok değiştirmez. Personelin lot bazında sayım taslağı toplaması ayrı geliştirme alanıdır; bu teslimde mali yetkili doğrudan parti sayımı yapar.

Gün sonu lot toplamı = ürün fizikî adedi = maliyet defteri adedi ve defter stok değeri mutabakatını arar. Karantinalı stok maliyetle stokta kalır; gün sonu bunu kendiliğinden fireye çevirmez. Kapalı güne takip açma/durum/sayım/fire yazımı engellenir. Genel ters fişle bu stok kayıtları geri alınamaz; açıklamalı yeni sayım/düzeltme kullanılır.

## Ekran, yetki ve sınırlar

OWNER/MANAGER/ACCOUNTANT lot ekranını okuyup işlem yapabilir. Kasiyer, POS'ta gerekli satılabilir miktar ve sıradaki parti/SKT bilgisini görür. Tenant/istasyon/CSRF/istek kimliği, defter ve stok sürümleri kontrol edilir. Stok ve lot değişiklikleri istasyon → ticari defter → ürün → lot kilit sırasındadır. Banka gibi haricî yan etki transaction tekrarlarına eklenmez.

Uyarılar seçili ürün veya tüm ürünler kapsamındaki bütün partiler üzerinden hesaplanır. **30 gün içinde SKT**, bugün dahil ve 30. gün dahil satışa açık miktardır. Geçmiş SKT ve karantina kartları örtüşebilir; toplanıp yeni bir stok toplamı oluşturulmaz. Tablo 200 satır sayfalanır, durum filtresi bu sayfaya uygulanır; CSV yalnız görünen satırlardır. Son 100 olay ürün/kapsam içinde gösterilir; bütün geçmiş DB'de saklanır. DB yöneticisine karşı kriptografik değişmezlik/sertifikalı geri çağırma sistemi değildir.

Tek depo ve tam sayı temel birim devam eder. Çok depo/transfer, kesirli terazi, raf bazında parti bakiyesi, otomatik tedarikçi iadesi/geri çağırma, SKT kampanyası, fiyat takvimi, native TC73/GS1, fizikî sensör veya bağlantısız kuyruk yoktur. Fizikî okuyucu/Windows/Laragon ve ayrı MySQL 8 saha doğrulaması yapılmadı. POS DEMO kapısı, mali belge/banka/yazıcı/merkez senkronizasyonu sınırları sürer.

## Windows / Laragon güncellemesi

Çalışan `pnpm dev` terminalini Ctrl+C ile durdurun. DB yedeği ve kendi `.env` dosyanızı koruyarak güncel GitHub kaynaklarını aktarın. Sonra:

```powershell
cd C:\laragon\www\istasyonos-main
pnpm install --frozen-lockfile
pnpm tsx server/stationos/migrate.ts
pnpm dev
```

`0014_inventory_lots` uygulanmalıdır. Göç yeni tabloları ve varsayılan kapalı takip bayrağını ekler; mevcut miktar/maliyet/fiyatları veya geçmiş kapanışları değiştirmez. MySQL DDL örtük commit yapabilir; yarım göçü tahminî elle SQL ile tekrarlamayın.

## Doğrulama

13 dosya / **61 birim ve sözleşme testi**, TypeScript ve üretim derlemesi geçti. `scripts/smoke-lots.ts` yalnız açık `SMOKE_TEST=1`, loopback ve tam adı/socket yolu eşleşen ayrı `istasyonos_pos_v2_test` DB'sini kabul eder. Tam senaryo geliştirme ve üretimde rol/tenant, eksik lot/SKT, geçmiş tarih, açılış dağılımı, çok partili alış, mükerrer belge rollback, FEFO, karantina, geçmiş/bilinmeyen SKT engeli, gerçek parti iadesi, sayım/fire, aynı kimlikle tek etki, maliyet/defter/lot mutabakatı ve gün sonunu doğruladı. `SMOKE_LEAVE_OPEN=1` yalnız tarayıcı fixtürü hazırlamak içindir; o koşuda gün sonu kısmı çalışmaz ve çıktı bunu ayırır.

İki Chromium, geliştirme ve son üretim derlemesinde çok partili masaüstü/390px terminal kabulü, kayıt sonrası yanıt kaybı/yenileme/aynı-ID tek kabul, fizikî uygunluk teyidi, parti sayımı/fire, FEFO kasa, karantinalı müşteri iadesi, gerçek partiyle tedarikçi iadesi ve CSV'yi doğruladı. JS sayfa hatası/haricî istek/yatay taşma görülmedi. Bu testler fizikî TC73 kabulünün yerine geçmez. Özel test dosyaları/erişimler `/workspace/lot-test` altındadır; Git'e veya herkese açık pakete eklenmez.

19 Ekim liste aktarımı için [ürün aktarım rehberini](market-urun-aktarimi-2026-10-19.md) okuyun. Güncel kaynakta 0015/0016 göçleri de gerekir; yukarıdaki 61 test lot tesliminin tarihli sonucudur. Yeni toplam 69 testtir.

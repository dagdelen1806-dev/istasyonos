# Market ön muhasebesi — 17 Ekim 2026

Yeni **Market muhasebesi** menüsü (`/market-muhasebe`), stok maliyeti, alış/mal kabul, market müşteri ve tedarikçi carileri, tahsilat/ödeme, satış kasası, banka beyanları ve gün sonunu aynı hareket defterine bağlar. Bu sürüm operasyonel ön muhasebedir; resmî muhasebe/e-Defter veya vergi beyannamesi düzenlemez. POS satışlarının mevcut DEMO kısıtı sürer.

## Rakip incelemesinden uygulamaya

17 Ekim 2026'da okunan resmî kaynaklar:

| Ürün ve kaynak | Üreticinin sayfasındaki ilgili kapsam | Bu teslimdeki karşılığı |
| --- | --- | --- |
| [Mikro Market Programı](https://www.mikro.com.tr/market-programi/) | Sipariş–satın alma–stok–satış bağlantısı, müşteri yönetimi, satış analizi ve raporlama | Mal kabul, maliyet, cari borç ve POS satışı aynı transaction zincirine bağlandı. Sipariş/tedarikçi gönderimi bu teslimde yok. |
| [Logo İşbaşı](https://www.logo.com.tr/urun/logo-isbasi) | Müşteri/tedarikçi, borç–alacak, tahsilat–ödeme, cari ekstre, vade, kasa/banka ve otomatik stok güncelleme | Market carileri, kısmi ödeme dağılımı, ekstre/CSV, kasa/banka ve geciken tutarlar eklendi. e-Dönüşüm ve banka bağlantısı bağlı değil. |
| [Nebim V3 POS ve Arka Ofis](https://www.nebim.com.tr/tr/nebim-v3-pos) | Mağaza stok sayımı, mal kabul, günlük kasa/nakit akışı ve satış/envanter raporu | Sayım farkları maliyetle, kasa açılış/kapanışları merkez kasa devriyle, satışlar günlük sonuçla birlikte kaydediliyor. Mağazalar arası transfer ve merkez eşitleme henüz yok. |

Bunlar üretici tanıtım beyanlarıdır; bağımsız saha testi veya bütün ürün/sürümlerle özellik eşitliği iddiası değildir. Fiyat/lisans karşılaştırması yapılmadı. Öncelik, günlük market hesabının birbiriyle tutarlı ve tekrar isteklerine dayanıklı çalışmasıdır.

## Başlangıç ve mevcut veriler

1. Kendi veritabanınızın yedeğini alın ve göçleri uygulayın.
2. Market muhasebesinde tek bir istasyon seçin.
3. Firma sahibi açılış önizlemesini kontrol eder: mevcut adet × ürün alış fiyatı, başlangıç stok maliyetidir. Bu fiyatların **KDV hariç maliyet** olduğu kullanıcı tarafından açıkça teyit edilir. Sıfır maliyetli stoklar ayrıca gösterilir.
4. Merkez kasa, banka ve bankaya geçmemiş kart alacağının açılış tutarlarını girin. Bunlar açılış karşılığıyla kaydedilir; gelir/kâr olmaz.
5. Önce bütün POS kasaları kapatılmalı; eski MARKET vardiya hesaplarının teslim ve mevcut mali onay süreci tamamlanmalıdır.
6. Yeni market müşteri/tedarikçi kartlarını açın. Devreden müşteri alacağı ve tedarikçi borcu, açıklamasıyla ayrıca tanımlanabilir; bu da gelir/gider sayılmaz.
7. Stok ekranında ürünlerin satış KDV oranlarını doğrulayın. Tanımsız oran, muhasebesi aktif markette POS satışını engeller.

Bu açılış geçmiş satışları yeniden muhasebeleştirmez. Önceki vardiya carileri, eski tedarikçi/payable ve ödeme kayıtları yeni market carilerine otomatik birleştirilmez. Devreden bakiyeler yetkili tarafından seçilip doğrulanmalıdır. Yeni market defterinin başlangıcından sonraki hesabını bu modülden takip edin; eski rapor toplamlarını buna ekleyerek mükerrer hesap üretmeyin.

Aynı ürün kataloğu ve fiziksel stok adedi kullanılır. Defter başladıktan sonra eski bağımsız `/stock`, `/payable` yazımları ve yeni eski-tip MARKET vardiya hesabı açma yolu engellenir; stok ve mali defterin ayrışması önlenir. FUEL vardiya süreci ve iki ayrı mali kullanıcı onayı korunur. Ön muhasebe gün sonu, eski personel hesabının mali onayı yerine geçmez.

## Ekranlar

- **Özet:** Seçili günün KDV hariç/brüt satışı, satılan mal maliyeti, brüt kârı, gider ve sayım farkları sonrası operasyonel sonucu. Kasa/banka/cari ve stok bakiyeleri günceldir; bunlar rapor tarihinin tarihsel bakiyesi olarak sunulmaz.
- **Stok ve fiyat:** Güncel adet, ağırlıklı maliyet, stok değeri, satış fiyatı ve satış KDV oranı. Yeni ürün sıfır stokla açılır; mal kabul stok ekler. Sayım farkı gerekçeyle ayrı hareket olur.
- **Alış ve mal kabul:** Çok satırlı belge, tedarikçi, belge numarası, vade, KDV hariç birim maliyet ve satır KDV’si. Tedarikçi seçildiğinde varsayılan vade önerilir; belgeye göre değiştirilebilir. Aynı tedarikçinin aynı alış belge numarası ikinci kez kaydedilemez.
- **Cariler:** Müşteri, tedarikçi veya her ikisi olan kart; ayrı alacak/borç bakiyeleri, limit ve vade. Kısmi tahsilat/ödeme en eski vadeli, eşit vadede en eski kayıtlı belgelere dağıtılır. Fazla tahsilat/ödeme reddedilir; avans kapama bu sürümde yoktur. Ekstre tarih aralığı ve sıra imleciyle sayfalanır; sayfa başı bakiye taşınır.
- **Kasa ve banka:** Merkez kasa, satış çekmeceleri, banka ve bankaya geçmemiş kart alacağı ayrı hesaplar. Gider, hesaplar arası transfer, kaynak girişi, kartın bankaya geçişi ve komisyon.
- **Gün sonu:** Açık kasalar, merkez kasa sayımı, fark açıklaması ve kaydedilmiş kapanışlar. Fiziksel sayım alanı kullanıcı tarafından doldurulur.
- **Hareket defteri:** Her işlemin dengeli borç/alacak fişi; kullanıcı, açıklama ve referans. Uygun para hareketleri silinerek değiştirilmez, açıklamalı ters fişle düzeltilir.

## Hesap kuralları

| İşlem | Sonuç |
| --- | --- |
| Mal kabul | Stok net maliyeti ve alış KDV’si artar; tedarikçi borcu brüt tutarda oluşur. Alış doğrudan satış gideri sayılmaz. |
| Nakit satış | Satış çekmecesi brüt tutarda artar; net satış/KDV ayrılır; stok maliyeti satılan mal maliyetine geçer. |
| Kart satış | Aynı satış/maliyet kayıtları; tahsilat bankaya değil kart alacağına yazılır. |
| Veresiye satış | Aynı satış/maliyet kayıtları; müşteri alacağı artar. Nakit veya banka bakiyesi artmaz. |
| Müşteri tahsilatı | Kasa/banka artar, müşteri alacağı azalır; ikinci satış geliri oluşmaz. |
| Tedarikçi ödemesi | Kasa/banka azalır, tedarikçi borcu kapanır; ikinci alış/maliyet gideri oluşmaz. |
| Kasa açılışı | Para üstü merkez kasadan çekmeceye aktarılır; gelir oluşmaz. Merkez bakiyesi yetersizse reddedilir. |
| Kasa kapanışı | Sayılan nakit merkez kasaya devredilir; fark ayrı kasa eksiği/fazlası kaydı olur. Kasiyer devri teyit eder. |
| Kartın bankaya geçişi | Brüt kart alacağı kapanır; net tutar bankaya, komisyon ayrı gidere yazılır. Manuel beyan kaydıdır. |
| İşletme içi transfer / sermaye | Satış geliri oluşmaz. Sermaye/kaynak girişi açılış karşılığıyla izlenir. |
| Stok sayımı | Eksik stok mevcut ağırlıklı maliyetten düşer; fazla stok için net birim maliyet girilir. Fark ayrı gider/gelir hesabıdır. |

Örnek: 5 ürün × 5 TL net maliyet + %20 KDV ile 30 TL mal kabulü; 2 ürünün 12 TL brüt fiyattan veresiye satışı → 24 TL müşteri borcu, 20 TL net satış, 4 TL satış KDV’si, 10 TL satılan mal maliyeti, 15 TL kalan stok değeri. Sonraki 10 TL tahsilat müşteri borcunu 14 TL’ye indirir; satış yine 24 TL’dir. Tedarikçiye 20 TL ödeme borcu 10 TL’ye indirir; gideri tekrar artırmaz.

Para tamsayı kuruş, stok tamsayı adettir. Satır çarpımları ve toplamları güvenli tamsayı sınırında denetlenir. Vergi ve ağırlıklı maliyet ara çarpımları BigInt ile yapılır; yarım kuruş yukarı yuvarlanır. Son stok adedi çıkarken elde kalan maliyetin tamamı tüketilir. Örneğin 10 kuruş maliyetli 3 adet, tek tek 3 + 4 + 3 kuruş olarak çıkar; maliyet kaybolmaz.

KDV oranı koda sabitlenmez; işletmenin doğruladığı oran kullanılır. Satış fiyatı KDV dahil, alış/gider birim tutarı KDV hariç girilir. KDV istisna kodu, tevkifat, indirilebilirlik kuralları, global fatura yuvarlama farkları ve resmî dönem beyannamesi uygulanmış değildir. Veresiye bakiye, belirlenen müşteri limitini aşamaz; tedarikçi limiti isteğe bağlıdır.

## Gün sonu ve düzeltme

Gün sonu, Türkiye takvim gününe (`Europe/Istanbul`) göre çalışır. Geri tarihli mali yazım API’si yoktur. Açık satış kasası varsa, önizlemeden sonra yeni mali hareket gelmişse veya stok/maliyet/defter toplamı uyuşmuyorsa kapanış reddedilir. Sayım farkı en az beş karakterlik açıklama gerektirir; fark ayrı fiş olarak kaydedilir. Raporun anlık görüntüsü ve SHA-256 özeti saklanır.

**Bugünün gün sonunu kapatmak bugüne yeni mali kaydı durdurur.** Yeni kayıtlar sonraki Türkiye takvim gününde alınabilir; aynı günü yeniden açma akışı yoktur. Fiyat/KDV ve cari limit gibi mali olmayan metadata düzenlemeleri kapanmış günün eski fişlerini değiştirmez. Geçmiş kayıtlı kapanış görüntüleri sonraki işlemlerden yeniden hesaplanmaz. Bu özet uygulama düzeyinde izlenebilirlik sağlar; veritabanı yöneticisine karşı değiştirilemez resmî arşiv iddiası değildir.

Tahsilat, ödeme, gider, hesap transferi, kaynak girişi ve kart–banka kayıtları ters fişle düzeltilebilir. Eski fiş ve ödeme dağılımları korunur; ters fiş ilgili kaynak kayda bağlanır, belge kapanan tutarı geri alınır. İkinci ters kayıt ve yetersiz bakiyeli ters çıkış engellenir. Bankadan otomatik para iadesi yapılmaz. Alış/satış ve stok kaydını genel ters fişle bozmak engellenir; kaynak belgeli iadeler için 0012 göçü ve İadeler sekmesi kullanılır.

## Yetki ve tekrar güvenliği

- OWNER açılış ve işletmeye kaynak girişi yapar.
- OWNER/MANAGER/ACCOUNTANT market defterini okuyabilir; ürün/fiyat/KDV, standart cari kartları ve mal kabul işlemlerini yönetebilir.
- Tahsilat/ödeme, gider, kasa–banka transferi, cari açılış bakiyesi, kart–banka geçişi, ters kayıt ve gün sonu OWNER/ACCOUNTANT rolündedir.
- MARKET_STAFF ve diğer kasiyer rollerinin erişimi POS sınırındadır; maliyet defterini okuyamaz. POS’ta müşteri veresiye seçimi için yalnız gerekli müşteri/limit bilgisi açılır.
- PURCHASER için bu yeni tam mali ekran yetkisi tanımlanmadı; eski ürün kartı yetkisi sürer, defter aktifken stok alımını yetkili market muhasebesi kullanıcısı kaydeder.

Her nesnede oturum kimliği, şirket/istasyon ve rol tekrar kontrol edilir. CSRF kontrolü ve istek kimliği korunur. Yeni market yollarında işlem yolu da idempotency içeriğine dahil edilir. İstek gönderilmeden önce kullanıcı/istasyon/cihaz kapsamlı sessionStorage’a yazılır. Yanıt belirsizse veya sayfa yenilenirse aynı kimlikle sorgulanır; yeni fiş oluşturulmaz. Tarayıcı depolamasını elle silmek bu kurtarma korumasını aşabilir.

Yazıcılar aynı istasyon → defter → kasa/ürün kilit sırasını izler. Satış, stok maliyeti, cari belgesi, ödeme dağılımı ve dengeli defter fişi aynı veritabanı işlemi içinde commit edilir. Beklenen stok, önizleme sürümü ve tutar değişmişse kaydetme reddedilir. DB snapshot/deadlock tekrarlarında yalnız geri alınmış DB işlemleri aynı istek kimliğiyle denenir; dış banka etkisi bu döngüye eklenmez.

Defter fişleri asıl kaynaktır; hızlı bakiye tablosu aynı transaction’da güncellenir. Cari belgenin kapanan tutarı ve dağılımları birlikte yürür. Dağılımlardan rapor çıkarırken ters fişi olan eski dağılımları aktif ödeme saymayın. Bir satış da eski vardiya `/payment`/`slip` kayıtlarına tekrar post edilmez.

## Güncelleme — Windows / Laragon

Çalışan geliştirme sunucusunu Ctrl+C ile durdurun. Veritabanını yedekleyin ve güncel GitHub kaynağını alırken kendi `.env` dosyanızı koruyun. Proje klasöründe:

```powershell
pnpm install --frozen-lockfile
pnpm db:migrate
pnpm tsx server/stationos/migrate.ts
pnpm dev
```

`0011_market_accounting` uygulanmalıdır. Önceki 0001–0010 göçleri değiştirilmez. İlk kez kaynak alan kullanıcı için tam kurulum kök README'dedir. İki bilgisayar aynı uygulama sunucusu ve veritabanına bağlanmalıdır. İnternet kesilince yerel sunucuya erişim varsa bağımsız uygulama akışı sürer; merkez eşitleme ve sunucudan bağımsız cihaz satışı henüz yoktur.

Bu şema MariaDB 11.8.6’da mevcut satışları içeren test veritabanına uygulanmıştır. SQL, CHECK kaldırma sözdizimini MariaDB/MySQL için seçer; gerçek Windows/Laragon ve ayrı MySQL 8 sunucusunda saha doğrulaması henüz yapılmadı. MySQL DDL örtük commit edebilir; göç öncesi yedek ve deneme kopyası kullanın.

## Doğrulama

- TypeScript, **46 test / 9 dosya**, üretim derlemesi. Mevcut büyük ana chunk ve runtime config script uyarıları sürer.
- Yeni `scripts/smoke-market-accounting.ts`: yalıtılmış DEMO firma; açılış/rol/tenant, aynı alış belgesi, KDV/limit reddinde tam rollback, nakit/karma/veresiye POS, ağırlıklı maliyet, kısmi ödeme, eşzamanlı aşırı tahsilat, kart/komisyon, ters fiş ve belge dağılımı, sayım/kasa farkı, gün sonu ve ekstre.
- Her mali fişin borç/alacak dengesi, fiziksel–maliyet stok adedi ve defterden hesaplanan bakiyelerin hızlı bakiye tablosuyla eşitliği doğrulanır.
- Önceki POS/sepet ve iki ayrı mali imzalı vardiya testleri yeni şemayla tekrar çalıştırılmıştır.
- Chromium arayüz akışı: açılış → cari/ürün/KDV → alış → kısmi ödeme → barkodla veresiye → tahsilat/ekstre/CSV → gider → kasa devri → gün sonu. Kaydedilen giderin yanıtı bilerek kesilmiş, yenileme/aynı istekle tek fiş kalmıştır. Haricî tarayıcı istekleri engellenmiş, JS sayfa hatası ve 390px yatay taşma görülmemiştir.

HTTP paketi yalnız açık opt-in, loopback sunucusu ve tam adı `istasyonos_pos_v2_test` olan yerel socket veritabanını kabul eder. Gerçek/paylaşılan veritabanında çalıştırmayın. Fixture parolaları/cookie'ler ve tarayıcı sonuçları Git dışında tutulur.

```bash
SMOKE_TEST=1 SMOKE_BASE_URL=http://127.0.0.1:3303 SMOKE_OUTPUT_DIR=/workspace/market-accounting-test/dev node --env-file=/workspace/pos-v2-test/.env --import tsx scripts/smoke-market-accounting.ts
```

Fiziksel Windows cihazları, gerçek banka/mali cihaz/e-belge servisleri ve yedek geri yükleme kabulü yapılmış değildir. Kaynak belgeli satış/alış iadeleri 0012 göçüyle eklendi: [iade rehberi](market-iadeleri-2026-10-17.md). Depo/şube transferi, merkez eşitleme ve resmî muhasebe entegrasyonları sonraki teslimatlardır.

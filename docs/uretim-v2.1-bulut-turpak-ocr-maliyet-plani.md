# AKARYAKIT V1 — üretim altyapısı, Turpak ve OCR maliyet planı

**İlk istasyon için önerim: önce kontrollü gölge pilot, ardından yedekli üretim.** Verdiğiniz günlük **500–1.000 kredi kartı slipi**, 30 günlük ayda **15.000–30.000 özgün slip** demektir. Türkçe OCR için Cloud Vision’ı ilk aday olarak değerlendirelim. Turpak başvurusu yazılım tamamlandıktan sonra yapılacak; API erişimi veya fiyatı hazırmış gibi bütçe kurmayalım.

**10 Ekim 2026 tarife araştırması.** Tutarlar USD, vergi hariçtir. Bunlar hizmet alım teklifi veya üretime geçiş onayı değildir. Mevcut v2.0 uygulama bellek içi sentetik demodur; gerçek kullanıcı, kalıcı veritabanı ve görsel işleme henüz üretime alınmadı. Gerçek kasa/banka/POS verileri de alınmadı.

## 1. Aylık bütçe: ucuz gölge pilot ile gerçek üretimi ayıralım

### Gölge pilot: aylık 165,13–218,75 USD

Bu aralık bir istasyondaki iki hacim ucu ile aşağıdaki destekleyici hizmet payını kapsar. Yüzde 15 belirsizlik payıyla **189,89–251,56 USD/ay** bütçe gerekir. Satış, resmî ÖKC işleyişi ve mevcut muhasebe kaynağının yerini almaz; uygulama paralel veri toplama ve mutabakat denemesinde kullanılır.

Kaynaklı sabit kalemler: 2 vCPU/4 GiB uygulama VM’i **24 USD**, 1 vCPU/2 GiB OCR kuyruk işleyici VM’i **12 USD**, 2 GiB/30 GiB tek düğümlü PostgreSQL **30,45 USD**, private görsel deposu **5 USD**, ayrı staging VM’i **12 USD** ve staging PostgreSQL’i **15,15 USD**. Üç VM için günlük yedek, VM ücretlerinin yüzde 30’u olarak **14,40 USD**. Bunların toplamı **113 USD/ay**; OCR ve yardımcı hizmet payı ayrıca eklenir. [1] [2] [3]

Tek düğümlü veritabanı **HA değildir**. Sağlayıcı da bu sınıfı başlangıç geliştirme/test için konumlandırıyor. Düşük fiyatı dayanıklı üretim bütçesi diye sunmuyorum. [4]

### Yedekli üretim pilotu: aylık 449,38–503 USD

Bir istasyon için, veritabanı ve uygulama düğüm arızasına dayanıklılık isteyen referans kurulum:

- İki adet 2 vCPU/4 GiB uygulama VM’i: **48 USD/ay**.
- OCR kuyruk işleyici VM’i: **12 USD/ay**. Worker kesilirse kalıcı iş kuyruğu korunur; tekrar başlatma gerekir, bu worker kendi başına HA değildir.
- PostgreSQL Advanced: her biri 8 GiB/2 vCPU ve varsayılan 50 GiB diskli bir primary + bir standby: **271,50 USD/ay**. Bu toplam kamuya açık hesaplayıcıda bir ek düğüm seçilerek doğrulandı. Varsayılan diski bir daha eklemiyoruz. [2]
- Bölgesel yük dengeleyici: **12 USD/ay**. [5]
- Private görsel deposu: **5 USD/ay**. [3]
- Ayrı staging VM + DB: **27,15 USD/ay**.
- Uygulama, worker ve staging VM’lerinin günlük yedeği: **21,60 USD/ay**. Veritabanı yedeği bununla aynı şey değildir. [1]

Bu kalemler **397,25 USD/ay** eder. Buna **22,13–45,75 USD OCR** ve **30–60 USD yardımcı hizmet planlama payı** eklenince **449,38–503 USD/ay** oluşur. Yüzde 15 belirsizlik payıyla sonuç **516,78–578,45 USD/ay**. Satın alma bütçesinde **550–600 USD/ay bulut + OCR payı** ayırmak makul bir başlangıçtır; Turpak, insan iş gücü ve vergiler bu rakama dâhil değildir.

**30–60 USD yardımcı hizmet payı bir sağlayıcı tarifesi değil, bizim başlangıç bütçe varsayımımızdır.** Log/alarm, işlem e-postası, alan adının aylığa dağılımı ve bağımsız yedek deposu gibi kalemlere ayrılır. Gerçek ürün, saklama ve trafik tercihlerinde ayrı fiyatlandırılır. Mesai dışı insan destek hizmeti bu paya dâhil değildir. Yüzde 15 de fatura kalemi değil bütçe tamponudur.

**Önemli tarife değişikliği:** 15 Ekim 2026’dan itibaren daha önce PostgreSQL/MySQL kümesi oluşturmamış hesaplarda, 30 Kasım 2026’dan itibaren tüm hesapların yeni Standard kümelerinde standby/read-only ve 4 GiB üstü planlar kısıtlanıyor. HA ihtiyacında Advanced gerekiyor. Mevcut kümeler için istisna var; sırf eski tarifeyi yakalamak için satın alma önermiyorum. 15 Ekim’de gelecek Advanced Shared CPU seçenekleri gerçek kurulum tarihinde yeniden fiyatlandırılmalı. [6]

**Beş istasyon ileriki kapasite senaryosu:** aynı günlük hacim her istasyonda oluşursa 75.000–150.000 slip/ay. Worker VM’i 24 USD’ye çıkarılan başlangıç varsayımında bulut + OCR + yardımcı pay **559,48–707,87 USD/ay**, tamponlu bütçe **643,40–814,05 USD/ay**. Bu, kapasite garantisi değildir; beş istasyona açılmadan önce kapanış saati yük testi gerekir. Tek bölgedeki HA, bölge veya sağlayıcı kesintisine karşı felaket kurtarma değildir.

## 2. Gerçek OCR faturası nasıl oluşacak?

Cloud Vision’da `TEXT_DETECTION` ve `DOCUMENT_TEXT_DETECTION` ilk 1.000 aylık birimde ücretsiz, ardından 5 milyon birime kadar **1.000 birim başına 1,50 USD**. Her görüntüde kullanılan her özellik ayrı ücretlenir; çok sayfalı dosyada her sayfa bir görüntü sayılır. Pilot için yalnız bir OCR özelliği kullanacağız. [7]

Hesapta **yüzde 5 ek ücretlenebilir istek** varsaydım. Bu oran henüz ölçülmedi; yeniden çekim/yeniden işleme için kapasite ve bütçe payıdır. Aynı dosyanın tekrar yüklenmesi hash kontrolüyle OCR çağrısından önce elenir. Ağ sonucu belirsizken sağlayıcının tekrar ücretlendirmeyeceğini varsaymıyoruz.

```text
özgün_slip = istasyon_sayısı × günlük_slip × ay_günü
OCR_isteği = yukarı_yuvarla(özgün_slip × 1,05)
OCR_USD = max(0, OCR_isteği − kullanılabilir_ücretsiz_kota) × 0,0015
# Bu hacimler ilk fiyat dilimindedir.
```

**500 slip/gün:** 15.000 özgün slip → 15.750 OCR isteği → **22,13 USD/ay**. Ücretsiz kota başka işlerce tüketilmişse **23,63 USD**.

**1.000 slip/gün:** 30.000 özgün slip → 31.500 OCR isteği → **45,75 USD/ay**. Ücretsiz kota yoksa **47,25 USD**.

Beş istasyonda ücretsiz kota beşle çarpılmaz. Aynı ortak kullanım kapsamında ayda bir kez 1.000 birim varsayımıyla OCR **116,63–234,75 USD** olur. Geçici promosyon kredilerini maliyet düşürücü saymadım.

**Cloud Vision metin tanır; bankacılık doğrulaması yapmaz.** Tutar, TRY, tarih/saat, belge türü, terminal/işyeri ve RRN/işlem referansı için kendi şablon/parser katmanımız gerekir. Türkçe `tr` resmî destek listesinde. `DOCUMENT_TEXT_DETECTION` ve otomatik dil algılama ilk deneme olacak; `tr` ipucunu sadece gerçek örneklerde iyileştirme sağlıyorsa kullanacağız. [8] [9]

**Textract neden ilk tercih değil?** Resmî Oregon fiyat örneğinde metin OCR **0,0015 USD/sayfa**, AnalyzeExpense **0,01 USD/sayfa**. Aynı pilot hacminde AnalyzeExpense yaklaşık **157,50–315 USD/ay** eder. Ancak resmî FAQ, fiş/fatura çıkarımını İngilizceyle sınırlıyor; genel OCR destek listesinde de Türkçe yok. Bu yüzden daha yüksek fiyatın Türkçe POS slipinde daha iyi sonuç getireceğini varsayamam. Buradaki rakam yalnız maliyet karşılaştırmasıdır, üretim önerisi değildir. [10] [11]

İlk fazda her slip, alanları otomatik doldurulsa da kullanıcı teyidinden sonra vardiya toplamına girer. İade, red, Z/özet rapor ve yanlış dönem belgesi satış slipi sayılmaz. OCR sonucu tek başına satış, banka tahsilatı veya cari hareket üretmez. LLM kullanımı bu OCR bütçesine eklenmedi; ilk parser için LLM zorunlu değildir. Patron/satın alma sohbet asistanının token bütçesi ayrıca fiyatlandırılır.

## 3. Asıl gizli maliyet: insan teyidi ve görüntü saklama

OCR ücretinden daha büyük yük, personel ve muhasebenin kontrol süresi olabilir. Örnek olarak her slipte **5 saniye hızlı teyit**, ayrıca sliplerin yüzde 10’unda **20 saniye ek inceleme** varsayarsak bir istasyonda aylık **29,17–58,33 kişi-saat** çıkar. Bunlar ölçülmüş süreler değildir; pilotta ölçülecek varsayımlardır. Fotoğraf çekimi, nakit sayımı ve muhasebenin dönem mutabakatı bu süreye eklenir. Yalnız yüzde 10 istisnanın ek incelemesi **8,33–16,67 saat**; bunu bütün teyit iş gücü diye göstermemeliyiz.

```text
insan_kontrol_maliyeti = ölçülen_kişi_saat × işveren_yüklü_saat_maliyeti
```

Görsel başına **0,5 MiB maskeli görüntü + 0,1 MiB önizleme**, teknik kapasite için **90 gün aktif saklama** varsayımıyla pilotun primary görsel havuzu **26,37–52,73 GiB** olur. Beş istasyonda **131,84–263,67 GiB**; yüksek uçta 250 GiB paket sınırı az miktarda aşılır. Metadata, yeniden çekimler, backup kopyaları ve ayrı arşiv bu hesaba dâhil değildir. **90 gün mevzuat saklama süresi veya silme talimatı değil**, kapasite hesabıdır; saklama politikası muhasebe/hukuk tarafından ayrıca belirlenir.

Spaces paketi **5 USD/ay**, 250 GiB saklama ve 1 TiB outbound içeriyor; ek saklama **0,02 USD/GiB-ay**, ek outbound **0,01 USD/GiB**. İkinci bucket’ın aynı hesapta olması bağımsız yedek sağlamaz. Sağlayıcı/hesap arızasına karşı ayrı yetki alanında ve tercihen ayrı sağlayıcıda şifreli kopya gerekir; bunun bedeli yardımcı hizmet payında ön karşılıktır, henüz kesin teklif değildir. [3]

## 4. Bulut mimarisi: v2.0’ı doğrudan internete taşımayacağız

Mobil uygulama kurulabilir PWA olacak; HTTPS altında kendi alan adımızdan açılacak. Kamera kullanımına yalnız İSG bakımından izinli alanda izin verilecek. Beş sabit bilgisayar için atomik cihaz lease/heartbeat, personelin kendi telefonu için ayrı cihaz kaydı olacak. Ortak vardiya sahibi ile işlemi yapan gerçek kişi ayrı izlenecek.

Üretim API’si stateless çalışacak. Demo rol seçicisi kaldırılacak; gerçek kimlik, yönetim MFA, HttpOnly oturum, CSRF ve her istekte tenant/firma/istasyon/kişi yetkisi uygulanacak. PostgreSQL özel ağda olacak; telefon ve istasyon bilgisayarı doğrudan DB’ye bağlanmayacak. Ödeme/cari/stok kaydı, idempotency ve outbox aynı transaction’da yazılacak. Bu yapı, mevcut doğrulanmış PostgreSQL DDL taslağını gerçek uygulama repository’sine bağlama işidir; hâlihazırda bitmiş değildir.

OCR işleyici API isteğinden ayrı çalışacak. PostgreSQL’de kalıcı job/outbox ile başlayıp ihtiyaç kanıtlanmadıkça ayrı Redis/Kafka/Kubernetes maliyeti eklemeyelim. Worker row lease ve heartbeat ile işleri alır; crash sonrası lease süresi dolunca devam eder. Sağlayıcı çağrısı ile DB commit’i arasında atomiklik yoktur; iş tekilliği vardiya toplamını korur fakat belirsiz çağrı servis faturasını etkileyebilir. Bounded retry, DLQ ve manuel yeniden işleme gerekir.

Telefon görüntüyü önce yerel crop/maskeleme kontrolünden geçirir. Ham PAN/CVV/PIN veya hassas görüntü haricî OCR servisine gönderilmez. Güvenli maskeleme teyit edilemiyorsa yükleme bloklanır ve yeniden çekim/manuel güvenli giriş yolu gösterilir. Private depo, kısa ömürlü upload/download yetkisi ve signed URL kullanılacak; public CDN’ye slip koyulmayacak. Ham OCR metni log/sohbet asistanı geçmişine yazılmayacak.

Gözetim paneli kaynak yaşı, OCR kuyruğu ve en eski iş, DLQ, başarısız giriş, idempotency çakışması, disk/DB kapasitesi ve günlük maliyet ölçümlerini izler. Sağlayıcı bütçe alarmı **sert harcama limiti değildir**; uygulamada tenant başına günlük OCR kotası, istek hız sınırı ve yeni işleri güvenli bekletme mekanizması ayrıca olacak. Bekletilen slip kaybolmaz, teyitli toplamına girmez.

İlk worker kapasitesi sunucu tarafında hafif görüntü işlemleri ve bulut OCR için başlangıç boyutudur. Büyük görüntüler, yerel ağır OCR veya toplu yeniden işleme için bu kapasitenin yeterliliği ölçülmeden iddia edilmez. Pilot yüksek ucunda 1.000 slipin 15 dakikada gönderildiği kapanış yükünü ve yüzde 5 ek isteği staging’de sınayacağız. Kamera dosya limitleri, önizleme boyutu ve aynı anda çalışan iş sayısı gerçek telefon testleriyle kesinleşir.

**Barındırma seçimi:** web/API için yönetilen bir platform teknik olarak değerlendirilebilir. Ancak mevcut PostgreSQL transaction/RLS tasarımı, private görsel deposu, ayrı worker ve olası yerel Turpak ajanı için bileşen bazında uyum teyidi gerekir. Bu belgede taşınabilir üçüncü taraf VM + managed PostgreSQL referansı fiyatlandırıldı; platform zorunluluğu veya hizmet satın alımı yapılmadı. Türkiye’de veri tutma koşulu benimsenirse Türkiye lokasyonlu DB/depo + yerel OCR için ayrı sağlayıcı teklifi alınmalı; burada verilen yurt dışı fiyatları o mimarinin fiyatı değildir.

## 5. Turpak başvurusu yazılım sonrası yapılacaksa iki bağlantı modu

### Mod A — API öncesi kontrollü pilot

Turpak tarafından henüz verilmemiş bir erişim hakkını varsaymayacağız. Mevcut yetkili kullanıcı arayüzünden **izinli** rapor/PDF/XML/dosya çıktısı varsa import edilir. Böyle bir çıktı yoksa fotoğraflanmasına izin verilen vardiya raporu kullanıcı tarafından yüklenir; OCR sonucu aday olur ve yetkili toplam/dönem teyidiyle rapor kanıtına dönüşür.

GİB İOS kılavuzu 3.1.16, harici uygulamalar için belirli kurallarla dosya/XML dışa aktarımını tarif eder. Bu hüküm, bizim için otomatik Turpak erişim yetkisi veya ücretsiz API hakkı değildir. Turpak DB’sini doğrudan okuma, cihaz arayüzünü tersine mühendislikle açma veya yazar kasa komutu gönderme planlamıyoruz. [12]

OCR rapor toplamı, işlem düzeyinde canlı kaynakla aynı kanıt değildir. Rapor personel/pompa/terminal atfı içermiyorsa istasyon toplamını personele keyfî paylaştırmayacağız. Kısmi sayfa, yanlış dönem ve eksik rapor “0 satış” değildir. API yokken anlık yakıt satışı/kesin kişi bazlı kaynak mutabakatı için ürün vaadi verilmeyecek.

Pilotun canlı kapsamı bu durumda **personel hesabı + slip/ödeme kanıtı + muhasebe kontrollü teslim** olur. Resmî pompa/ÖKC sistemi mevcut yetkili yazılım üzerinden sürer. C01 API erişimi ve C03 kaynak atfı kanıtı yoksa checklist’te PASS yapılmaz; otomatik kaynakla kesin kapanış modülü kapalı kalır. Onaylı manuel kaynak aktarımı kullanılıyorsa o modun kendi test kanıtı ve görünür `MANUAL/OCR_SOURCE` etiketi gerekir.

### Mod B — yazılı yetki ve test erişiminden sonra

ERP’ye değişmeyen iç veri sözleşmesi tanımlanır; dış Turpak şemasını sağlayıcı adapter’ı dönüştürür. İstasyon, pompa/tabanca, satış ID’si, personel veya vardiya referansı, tutar/litre/fiyat, belge/void/iade ve dönem alanları sözleşmede doğrulanır. Ham provider envelope ve kaynak etiketi korunur.

API uzaktaysa sağlayıcının yetkili endpoint’i kullanılır. Yereldeyse sağlayıcının izin verdiği ayrı istasyon PC/ajanı sadece dışarı TLS bağlantısı açar; otomasyon kontrol bilgisayarına keyfî agent kurulmaz ve açık inbound port yaratılmaz. Sağlayıcı şartı varsa mTLS/allowlist ve credential rotation eklenir. Her istasyonun connector yetkisi ve cursor’u ayrıdır.

İlk kapsam **salt okuma** olur; mali fiş üretimi, satış başlatma/sonlandırma, pompa kontrolü ve resmî GİB/TSM aktarımı adapter’ımıza verilmez. Turpak Vision’da POS entegrasyon seçeneklerinin bulunması, haricî uygulamaya aynı verilere API erişimi verildiği anlamına gelmez. [13] [14]

Geçişte aynı rapor/işlem API’den gelince ikinci kez satış veya tahsilat oluşturulmaz. İstasyon + kaynak sistem + satış/ref + dönem üzerinden eşleme yapılır; OCR ile manuel onaylı önceki kayıt, belgesini koruyarak kaynakla bağlanır. Kimliği/period’u güvenilir eşlenmeyen kayıt karantinaya gider; toplamı eşitlemek için keyfî silme yapılmaz.

## 6. Turpak maliyeti: sıfır değil, teklif bekleniyor

İncelenen resmî ürün sayfalarında üçüncü taraf dış API lisansı, kurulum ücreti veya işlem başı tarife yayımlanmış olarak bulunmadı; ürün sayfası teklif talebine yönlendiriyor. Dolayısıyla **Turpak için 0 TL, sabit aylık ücret veya cihaz başı ücret uydurmayacağım.** [13] [14]

Başvuruda ayrı kalemler isteyelim:

1. Bir pilot istasyon için dış veri okuma/export erişimi; mevcut bakım sözleşmesi kapsamında mı?
2. Tek seferlik aktivasyon, firmware/sürüm yükseltme ve teknik kurulum bedeli.
3. Yıllık/aylık API, istasyon/cihaz/kullanıcı/işlem lisansı ve rate limit.
4. Sandbox/test erişimi, veri sözlüğü, örnek payload ve entegrasyon desteği.
5. Ağ/VPN/mTLS/sertifika veya yerel gateway gereksinimi ve bedeli.
6. Ek dört istasyonun aktivasyonu ve ortak merkez rapor lisansı.
7. Destek/SLA, bakım ve cihaz değişiminde adaptasyon bedeli; teklif geçerlilik süresi ve vergiler.

```text
aylık_TCO = bulut + OCR + gerçek_yardımcı_hizmetler
          + Turpak_aylık/yıllık_lisansın_aylık_paylaşımı
          + teknik_işletim_iş_gücü + personel/muhasebe_kontrolü
          + diğer_entegrasyonlar + vergi

ilk_kurulum = üretimleştirme_iş_gücü + OCR/parser_geliştirme
            + Turpak_adapter_geliştirme + vendor_aktivasyon
            + saha_gerekli_donanım/ağ + geçiş/eğitim/test
```

Banka/POS ve e-belge entegratör lisansları, AI sohbet kullanım bedeli, SMS, telefon/PM80/mini PC/UPS, veri hattı ve insan destek sözleşmesi bulut + OCR toplamına dâhil değildir. Aynı iş gücü OCR/parser geliştirme paketine alınmışsa ikinci kez kurulum satırında sayılmaz. TL karşılığı gerçek ödeme/sözleşme kuru ile hesaplanır; bu plan sabit kur veya KDV oranı varsaymaz.

## 7. Bir defalık geliştirme eforunu nasıl satın alacağız?

Mevcut demodan gerçek personel pilotuna geçiş için **27–45 kişi-gün** başlangıç planlama aralığı ayırıyorum: kimlik/tenant/migration/cash-AR transaction bağlama **12–20**, güvenli görüntü + OCR parser + hata kuyruğu **6–10**, deployment/izleme/restore **4–7**, PWA/gerçek telefon testleri ve işletim kabulü **5–8 kişi-gün**. Bu bir piyasa fiyatı veya kesin teslim süresi değil; keşif sonrası revize edilecek iş kırılımıdır.

Turpak doküman ve test erişimi sonrasında tek sağlayıcı adapter’ı için ayrıca **6–12 kişi-gün** koşullu pay. Farklı firmware/protokoller, yazar kasa yazma yetkisi, kapsamlı ERP/market satış ve yeni muhasebe/e-belge bağlantıları bu dar pilot eforuna dâhil değildir. Sağlayıcının başvuruyu değerlendirme süresi ayrıca takvim bağımlılığıdır; gün tahmini veremem.

```text
temel_pilot_geliştirme_bedeli = 27–45 × teklif_edilen_kişi_gün_bedeli
Turpak_adapter_bedeli = 6–12 × teklif_edilen_kişi_gün_bedeli
# Vendor erişim/aktivasyon ücreti bunlardan ayrıdır.
```

Aylık devops iş gücü ayrıca süre ve yanıt penceresiyle sözleşmeye bağlanır. VM fiyatının içinde uygulama güncelleme, güvenlik olayı müdahalesi veya muhasebe destek personeli bulunduğunu varsaymayalım.

## 8. Üretime geçiş için karar kapıları

**Kapı 1 — sahiplik ve güvenlik.** Firma/istasyon kimliği, kullanıcı/rol/cihaz politikası, veri saklama ve hizmet sözleşmeleri seçilir. Bulut/OCR aktarım envanteri çıkartılır. AB’ye OCR gönderilmesi de yurt dışı aktarımıdır; EU endpoint tek başına KVKK uygunluğu sağlamaz. Uygun hukuki mekanizma kurumun hukuk sorumlusunca teyit edilir. Standart sözleşme yolunda Kurumun metni ve imza sonrası beş iş günü bildirim şartı ayrıca vardır; standart global cloud DPA’nin bunu kendiliğinden sağladığı varsayılmaz. [15]

**Kapı 2 — staging.** Demo role-picker silinir; gerçek auth, PostgreSQL migration, immutable kayıt politikası, private upload, maskeleme, OCR/DLQ ve iki kişi onayı uçtan uca çalışır. Cross-tenant dosya indirme dahil güvenlik testleri gerekir. Restore prova hedefi başlangıç önerisi olarak **en fazla 15 dakika veri kaybı / 2 saat hizmet dönüşü**; sözleşme ve ölçümle doğrulanmadan vaat edilmez. DB ve görsel dosyalar birlikte geri getirilir.

**Kapı 3 — gerçek slip gölge denemesi.** Kurumca izinli, maskeli **300–500 örnek** farklı POS modelleri, silik/blur, ondalık, iade/red/rapor, yanlış tarih ve tekrar fotoğrafı içerir. Tutar, TRY, RRN/tarih ve belge türü ayrı ölçülür. İlk pilotta tüm adaylar teyitli; yanlış türün toplama girmemesi, duplicate idempotency ve maskeleme hatasının upload’ı bloklaması zorunlu. Güven skoru, parasal doğruluk yüzdesi diye sunulmaz. Otomatik teyitsiz toplama ayrı ürün kararı ve ek test ister.

**Kapı 4 — kapsamlı ama kontrollü 1 istasyon pilotu.** Kaynak erişimi kesinleşmediyse yalnız onaylı belge/OCR kaynak modu. Personel teslimi, fizikî alıcı, muhasebe incelemesi ve bekleyen banka hareketleri ayrı. Günlük kaynak ve toplam karşılaştırmasıyla açık farklar vaka olur. En az **7 ardışık vardiya** gölge önerisi ve **bir haftalık kapanış yükü** testinden sonra süreç sahipleri tam sürüm/kapsamla karar verir; bu süre tek başına PASS değildir.

**Kapı 5 — API ve genişleme.** Yazılım sonrası Turpak dilekçesi → yazılı hak ve fiyat → test erişimi → salt okunur adapter → OCR/API mükerrer kaynak eşleme → kaynak mutabakatı. 46 maddelik [pilot runbook](pilot-v1.9-46-kontrol-uygulama-runbook.md) kanıtları tamamlanır. Bloklayıcı güvenlik, veri kaybı, mali belirsizlik ve restore hatası varken normal canlı geçiş yok. Rollback ERP yeni yazımlarını durdurur; yetkili pompa/ÖKC işlemesini kesmez ve yeni mali hareketler olduktan sonra eski yedeğe kör dönmez.

## 9. Yazılım tamamlanınca kullanılacak Turpak başvuru içeriği

Aşağıdaki metin **teknik talep taslağıdır**; başvuru gönderilmedi ve firma adına bir beyan yapılmadı. Köşeli alanlar gerçek yetkili tarafından tamamlanacak.

> **Konu: Bir pilot akaryakıt istasyonu için salt okunur veri entegrasyonu teknik erişim ve teklif talebi**
>
> [Firma unvanı/VKN], [istasyon adı ve EPDK lisans bilgisi] bünyesinde geliştirilen personel vardiya hesabı ve muhasebe mutabakat yazılımının, mevcut [Turpak ürün/model/sürüm/cihaz seri bilgileri] üzerinden yetkili dış arayüzle veri okumasına ilişkin teknik koşulları ve fiyat teklifini rica ederiz.
>
> İlk aşama bir istasyondur; ileride aynı yetki yapısında beş istasyon planlanmaktadır. Talep, satış/litre/tutar, dönem/vardiya, varsa personel/terminal atfı ve izin verilen fiş/rapor/iade referanslarının salt okunur elde edilmesidir. Pompa kontrolü, mali fiş üretimi ve resmî veri aktarım süreçlerine müdahale talep edilmemektedir.
>
> Mevcut bakım/lisans kapsamı, API veya dosya/XML export seçenekleri, test erişimi, kimlik doğrulama/ağ gereksinimleri, veri sözlüğü, rate limit/geçmiş veri erişimi, kurulum ve dönemsel lisans bedelleri ile ek istasyonların koşullarını ayrı kalemlerle bildirmenizi rica ederiz.
>
> Teknik sorumlu: [ad/iletişim]. Yetkili imza: [gerçek firma yetkilisi]. Ekler: ürün/sürüm envanteri, yetki/istasyon sahipliği belgeleri, iç alan eşleme taslağı.

## 10. Hesap dosyaları ve güncelleme

[Maliyet senaryoları CSV](maliyet-v2.1-aylik-senaryolar.csv), [parametreler](maliyet-v2.1-parametreler.json), [hesap sonuçları](maliyet-v2.1-hesap-sonuclari.json) ve [yerel hesap betiği](maliyet-v2.1-hesapla.py) bu planın ekleridir. Python betiği servis çağrısı yapmaz ve ödeme başlatmaz. Parametrelerde gerçek kur, vergi, kişi-gün/saat bedeli ve Turpak teklif alanları **null** bırakıldı; bilinmeyenler sıfır kabul edilmez. Bu alanlar henüz sayısal toplama alınmadığı için çıktı **tam TCO değil bulut + OCR alt bütçesidir**.

Gerçek kurulum tarihinde tarifeler ve 15 Ekim sonrası DB seçenekleri yeniden doğrulanır. İlk hafta özgün slip/ücretli OCR çağrısı oranı, dosya boyutu, inceleme süresi ve kaynak güncelliği ölçülür; ardından yüzde 5 tekrar ve 30–60 USD yardımcı pay gerçek kullanımla değiştirilir.

## References

[1]: https://www.digitalocean.com/pricing/droplets "DigitalOcean Droplet ve backup tarifeleri"
[2]: https://www.digitalocean.com/pricing/managed-databases "DigitalOcean managed PostgreSQL fiyat hesaplayıcısı; Advanced + bir ek düğüm"
[3]: https://www.digitalocean.com/pricing/spaces-object-storage "DigitalOcean Spaces saklama ve transfer tarifesi"
[4]: https://docs.digitalocean.com/products/databases/postgresql/details/pricing/ "PostgreSQL tek düğüm ve yüksek erişilebilirlik fiyat/sınıf açıklaması"
[5]: https://www.digitalocean.com/pricing/load-balancers "DigitalOcean bölgesel yük dengeleyici fiyatı"
[6]: https://docs.digitalocean.com/release-notes/upcoming/dbaas-plan-changes/ "15 Ekim ve 30 Kasım 2026 PostgreSQL/MySQL plan değişiklikleri"
[7]: https://cloud.google.com/vision/pricing "Cloud Vision OCR birim tarifeleri"
[8]: https://docs.cloud.google.com/vision/docs/languages "Cloud Vision Türkçe OCR dil desteği"
[9]: https://docs.cloud.google.com/vision/docs/ocr "Cloud Vision OCR ve AB bölgesel uçları"
[10]: https://aws.amazon.com/textract/pricing/ "Amazon Textract metin ve AnalyzeExpense fiyat örnekleri"
[11]: https://aws.amazon.com/textract/faqs/ "Textract dil ve İngilizce fiş çıkarımı sınırları"
[12]: https://ynokc.gib.gov.tr/UploadedFiles/Files/IstasyonOtomasyonSistemiTeknikKilavuzu1_0.pdf "GİB İstasyon Otomasyon Sistemi teknik kılavuzu, dışa veri aktarımı"
[13]: https://turpak.com.tr/pompa-otomasyon-cozumleri/ "Turpak pompa otomasyon özellikleri ve teklif kanalı"
[14]: https://turpak.com.tr/urun-kategori/vision-pompa-yazar-kasa/ "Turpak Vision YN pompa yazar kasa ve POS seçenekleri"
[15]: https://www.kvkk.gov.tr/Icerik/7997/The-Procedures-And-Principles-For-The-Transfer-Of-Personal-Data-Abroad "KVKK yurt dışına veri aktarımı ve standart sözleşme koşulları"

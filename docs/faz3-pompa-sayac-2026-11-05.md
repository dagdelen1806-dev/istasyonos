# Faz 3 — Manuel pompa/sayaç mutabakatı

Yerel ekran: `https://istasyonos-main.test/sayaclar`.

## İşleyiş

1. Firma sahibi/yönetici istasyon kapsamında yakıt türü, tank, pompa ve
   tabanca tanımlar. Aynı adlı tank ve pompa yeniden kullanılır; tankın yakıtı
   sessizce değiştirilmez. Bir pompa farklı tanklara bağlı tabancalar taşıyabilir.
2. Önceden oluşturulmuş açık vardiya seçilir. Her tabancanın açılış sayacı ve
   fiyatı, akaryakıt hesabıyla aynı transaction içinde kaydedilir. Bir tabanca
   aynı vardiyada yalnız bir hesaba atanabilir; başka açık sayaç hesabına
   atanamaz. Bu ilk sürümde bir hesabın kapsamı istasyonun tüm tabancalarıdır.
3. Fiyat değişiminde tabanca, değişim anındaki sayaç, yeni fiyat, açıklama ve
   kanıt referansı girilir. Önceki fiyat o sayaç değerine kadar geçerlidir.
   Zamanı geçmiş bir fiyat değişimini kapanış fiyatından tahmin etmez.
4. Kapanışta bütün son sayaçlar, bağımsız toplam satış litre beyanı, açıklama
   ve kanıt referansı girilir. Tabanca bazında açılış, son sayaç, litre farkı ve
   hesaplanan satış; toplamda ayrıca litre ve tutar mutabakatı gösterilir.
5. Nakit, doğrulanmış kart slipleri, cari satış ve bekleyen IBAN beyanı mevcut
   hesap kayıtlarından okunur. Eski cari tahsilatı yeni satışa eklenmez.
   Sayım kaynağı otomatik hesaplanır; manuel kaynak endpoint'iyle ezilemez.
6. Farklar açıklamayla kaydedilebilir; açıklama farkı onaylamaz. Litre ve tutar
   farkı sıfır olmadan mevcut teslim/onay akışı ilerlemez. Fizikî nakit
   teslimi, iki farklı mali onay ve kendi hesabını onaylama yasağı korunur.

## Hesaplama ve düzeltme güvenliği

- Sayaçlar tamsayı mililitre; fiyatlar tamsayı kuruş/litre olarak saklanır.
  Çarpım BigInt ile yapılır; her fiyat dilimi ayrı, yarım kuruş yukarı
  yuvarlanır. Taşma, kesirli tamsayı, negatif sayaç/fiyat reddedilir.
- Sayaç gerilemesi, eksik/mükerrer tabanca, geriye giden veya gelecekteki okuma
  zamanı, ara okumasız kapanış fiyatı değişimi reddedilir. Sayaç devri veya
  cihaz sıfırlaması otomatik kabul edilmez.
- Açılış sayacı sabittir. Açık hesapta hatalı fiyat/ara okuma gerekçe ve kanıt
  ile düzeltilebilir; eski/yeni değerler mevcut hesap olay geçmişine yazılır.
  Kapanışın düzeltilmesi de önceki değeri silmeden olay geçmişinde saklanır.
- Teslim edilmiş hesap önce mevcut bağımsız düzeltmeye dönüş akışından geçer;
  eski döngünün imzaları yeni onay olarak sayılmaz. Kabul edilmiş hesap
  değişmez. Sonraki vardiya açılmışsa önceki sayaç okumaları değişmez.
- Onay imzasının snapshot'ı sayaç/fiyat okumalarını ve mutabakatı da içerir.
- Yeni mutasyonlar mevcut CSRF, rol/kapsam, revision, transaction ve requestId
  sonuç kurtarma mekanizmasını kullanır. Sayaç yazımında cihaz kontrolü korunur.
- Kanıt desteği dosya/fotoğraf **referansı** kaydıdır; dosya yükleme veya
  fotoğrafın gerçekliğini doğrulama hizmeti değildir.

## Şema ve yerel uygulama

Yeni `0008_fuel_meters.sql` yedi ek tablo oluşturur; uygulanan eski migration
dosyaları değiştirilmedi. Manifestin önceki sekiz girdisi aynen korundu.
İncelenen manifest SHA-256:
`a766434cee654871544dff89714b51d8e4da3cf5a3283d4f16f6020dacbd90d2`.

Mevcut migration motoru, açık DB hedefi, manifest hash'i ve `--apply` ile
yalnız kullanıcının onayladığı yerel İstasyonOS test DB'sinde uygulandı.
Dokuz migration uygulanmış, bekleyen yok. Eski hesaplara geriye dönük sayaç
eklenmedi. Test işlemleri mevcut DEMO firma alanındaki örnek istasyonlarda
yapıldı; yeni özellik özgün mali kayıtları değiştirmedi.

Yerel build `.local/fuel-phase3/runtime` altında çalışır. Yalnız uygulamanın
doğrulanmış Node PID'si yenilendi; dinleme `127.0.0.1:3000`. Apache, MySQL,
sertifikalar, Aksan Muhasebe ve diğer projeler değiştirilmedi. Önceki yerel
runtime `.local/password-change-build` altında korunur; geri dönüş için Node
giriş dosyası önceki runtime'a alınabilir. Migration geçmişi/tanısal kayıtlar
silinmez; veri silen otomatik down migration yoktur.

## Doğrulama

- İki TypeScript kontrolü; 19 dosyada 253 test, bunların 43'ü yeni sayaç
  hesaplaması/güvenlik testleri. Tarih/onay regresyonları üç saat diliminde
  65'er test ile tekrarlandı.
- Vite ve sunucu derlemesi başarılı. Mevcut runtime config script ve büyük
  JS paketi uyarıları devam eder.
- Gerçek HTTPS API: iki tabancada 10 L × 45 TL + 5 L × 46 TL + 4,4 L × 50 TL
  = **19,400 L / 900,00 TL**. Ayrı nakit/kart/cari/IBAN beyanları aynı toplamı
  verdi. -0,400 L farkı ve ayrı -0,10 TL fiyat farkı teslimi engelledi.
- İade sonrası eski imzalar sıfırlandı; iki ayrı imza sonunda IBAN'lı DEMO
  hesap `ACCEPTED_WITH_PENDING` kaldı. Kaynak bypass, kapalı hesap düzeltmesi,
  yanlış sayaç devri, mükerrer kayıt ve yetkisiz kapsam reddedildi.
- Test öncesindeki hesap, ödeme, slip, cari/defter, stok, ürün, payable ve
  imza satırlarının hash'leri test sonrasında aynı kaldı.
- Gerçek Chrome/HTTPS formları: donanım, açılış, fiyat ara okuması, kapanış ve
  gerekçeli düzeltme kayıt oluşturdu. 15 L / 680,00 TL örneğinde -0,200 L
  ve ayrıca -0,10 TL farkı ayrı doğrulandı; düzeltmeyle sıfırlandı. 390 px
  mobil genişlik kontrolü geçti, yakalanmamış JavaScript hatası görülmedi.
  Dört tarayıcı ve altı API kontrol grubu başarılıdır. Bunlar DOM/API
  doğrulamalarıdır; fiziksel pompa cihazı veya piksel düzeyinde görsel kabul
  değildir. Tarayıcı testlerinde oturum sonrası ana sayfaya yönlendirme ve
  `-₺0,10` para biçimi nedeniyle iki test seçicisi düzeltildi; bunlar uygulama
  arızası değildi. Bu denemelerin örnekleri de yalnız DEMO alanda kaldı.

Yerel kanıtlar `.local/fuel-phase3/` altındadır: `api-result.json`,
`browser-result.json`, `verification.log`, `build.log`. Özel test erişim
dosyaları paylaşılmaz veya sürüme eklenmez.

## Günlük Excel raporu ile eşleştirme

Kullanıcının verdiği `04.11.2026 (1).xlsx` salt okunur incelendi; kaydedilmedi
ve gerçek tutarlar/kişisel kayıtlar DB'ye aktarılmadı. İki çalışma sayfasında
beş pompanın ilk/son değer, fiyat, tutar bölümleri; nakit, kart, vadeli satış
ve tahsilat bölümleri bulundu. Bunlar ekranın saha kabulü ve günlük rapor
tasarımı için yararlıdır. "İlk stok / son stok" alanlarının kesin anlamı
saha kabulünde doğrulanmalıdır; tank stoku ile kümülatif sayaç karıştırılmaz.

TTS/Gift Kart, Partner Kart, fiyat farkı ve test/tanker satırları bu sürümde
ayrı satış/tahsilat türleri değildir. Bu kalemlerin litre, ciro ve alacağa
etkisi kullanıcıyla netleştirilmeden otomatik olarak nakit/kart sayılmaz.
Excel içe aktarma/dışa aktarma veya günlük konsolide rapor bu fazda yapılmadı.

Gerçek pompa/Turpak bağlantısı, tank stok defteri, kalibrasyon/test yakıtının
satıştan ayrılması, sayaç sıfırlama/devir istisnası ve özel ödeme yöntemleri
sonraki geliştirmedir. Banka teyidi, gerçek mali defter/e-belge ve bekleyen
finansal kayıtların kesinleştirilmesi etkinleştirilmedi.

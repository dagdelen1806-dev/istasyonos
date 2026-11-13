# Faz 4B — Akıllı vardiya icmali

Çalışan ekran: `https://istasyonos-main.test/icmal` → **Vardiya Mali Hesap**.
Mevcut hesap, sayaç, ödeme/slip, cari hareket, kullanıcı ve istasyon tabloları
yeniden kullanıldı. Özel işlem yazımları API seviyesinde yalnız `is_demo=1`
firma alanına açıktır. Gerçek mali defter/banka/sağlayıcı bağlantısı açılmadı.

## Çalışan işlevler

- Türkiye vardiya başlangıç tarihine ve personele göre filtreleme; personel
  rolü yalnız kendi hesaplarını, mali/yönetim rolleri yetkili istasyonlarını görür.
  500 hesap üzerindeki sonuçlarda daraltıcı filtre istenir; sessiz kırpma yoktur.
- Sayaç tutarı/litresi, test, ticari satış, nakit, kart, IBAN beyanı, cari satış,
  eski cari tahsilatı, özel işlem karşılığı ve tank hareketleri ayrı gösterilir.
- TTS, Gift yükleme, Gift kullanım ve Partner ayrı kategorilerdir. Kaynak,
  sağlayıcı, benzersiz referans, plaka/müşteri, maskeli cüzdan, tutar, litre,
  kanıt ve hesaplaşma durumu kaydedilir.
- Kartlar taslak başlar. Taslak toplamlara katılmaz ve teslimi engeller.
  Hesap sahibinden farklı OWNER/ACCOUNTANT, belge ve gerekçeyle işlem modelini
  seçer. Bu, muhasebe görüşünün sistem tarafından belirlenmesi değildir.
- **Mevcut ödeme modeli:** aynı hesaptaki aynı tutarlı satış ödemesi veya
  slipine etiket eklenir; ikinci ödeme/gelir üretilmez. Eski cari tahsilatı
  satış etiketi olamaz. Bir ödeme/slip iki özel işleme bağlanamaz.
- **Geçici sağlayıcı alacağı:** TTS/Partner için operasyonel karşılık izlenir;
  gerçek müşteri cari defterine veya banka bakiyesine otomatik yazılmaz.
- **Yerel Gift ön ödeme modeli:** yükleme satışa eklenmez. Bağımsız manuel
  belge teyidi olmayan yükleme harcanamaz. Kullanım, aynı sağlayıcı ve maskeli
  cüzdanın teyitli bakiyesini istasyon kapsamında tüketir; mevcut sayaçlı
  ticari satış hesabının karşılığıdır, yeni satış yaratmaz. Kullanımlar
  bekleyen durumda da bakiyeyi rezerve eder. Kullanılmış yükleme iptal edilemez.
  Nakit teyitli Gift yüklemesi ciro dışında kalır, fizikî kasa beklentisine eklenir.
- **Test çıkışı:** tabanca ve başlangıç/bitiş sayaç aralığına bağlanır. Çakışan,
  sayaç dışındaki veya litreyle uyuşmayan aralık reddedilir. Ticari litre ve
  tutar fiyat dilimleri üzerinden hesaplanır; fiziksel sayaç çıkışı değişmez.
  Kuruş yuvarlamasında sayaç tutarı = ticari tutar + test karşılığı korunur.
- **Test dönüşü:** aynı test/tanka bağlı ayrı fiziksel giriş; toplam dönüş
  test çıkışını aşamaz. Ticari satış yeniden artırılmaz. Testin iptalinden
  önce bağlı dönüş çözülmelidir.
- **Tanker teslimi:** belge ve kabul litresi ayrı tutulur; satış veya müşteri
  tahsilatı üretmez. Belge/kabul farkı varsa bağımsız mali rolün gerekçeli
  fiziksel kabul incelemesi gerekir; otomatik tolerans varsayılmaz.
- Tank hesabı: `ilk ölçüm + tanker + test dönüşü − tüm sayaç çıkışı`.
  Ölçülmemiş stok/fark bilinmiyor gösterilir. Fiziksel özel hareket varsa
  ölçülmemiş veya çözülmemiş tank farkı teslim/onayı engeller.
- Sayaç litre farkı, satış karşılık farkı, fizikî nakit sayım farkı ve mevcut
  cari borç defteri hareketi–satış beyanı farkı ayrı gösterilir. Cari fark,
  eski borç bakiyesiyle bugünkü satışı karşılaştırmaz; ilgili hesapta doğan
  borç hareketini karşılaştırır. Sağlayıcı alacağı ayrıca gösterilir.

## Onay ve kayıt güvenliği

Mevcut CSRF, tenant/istasyon kapsamı, cihaz kontrolü, revision, requestId sonuç
kurtarma, transaction ve audit kullanılır. Gift bakiye işlemleri istasyon
kilidi altında güncel satırları kilitleyerek okunur; iki hesap aynı bakiyeyi
eşzamanlı harcayamaz. Özel model/teyit kararı hesap sahibince verilemez.

Hesap teslimi ve iki ayrı mali imza korunur. İmza snapshot'ı özel kayıt ve
tank mutabakatını da içerir. Bekleyen özel hesaplaşma varsa sonuç
`ACCEPTED_WITH_PENDING` kalır. Kabul edilmiş hesapta özel işlem, teyit,
storno veya tank ölçümü değiştirilemez. Eski bekleyen işlemler kesinleştirilmedi.

İptal kaydı orijinali silmez, fiziksel yakıt veya gerçek para iadesi yapmaz.
İncelenmiş kart işleminin iptali bağımsız mali rol gerektirir. Ön ödeme
iptalinin bakiye etkisi denetlenir; gerçek nakit/banka iadesi bu sürümde yoktur.

## Excel ve PDF

Dört sayfalı gerçek `.xlsx`: **Vardiya icmali**, **Özel işlemler**,
**Tank hareketleri**, **Sayaç okumaları**. Sayısal hücreler sayısaldır;
referans ve isimler inline metin yazılır, formüle dönüşmez. PDF, aynı filtreli
raporun tarayıcı yazdırma görünümünden **PDF olarak kaydet** ile alınır;
sunucuda PDF servisi veya zamanlanmış rapor gönderimi kurulmadı.

Kaynak `04.11.2026 (1).xlsx` salt okunur incelendi. `C4-B4` ve `E4*D4`
yapısı, `T.T.S.+GIFT KART`, `PARTNER KART`, `FİYAT FARKI`, `TEST(TANKER)`
başlıkları doğrulandı. Gerçek tutarlar/kişisel veriler içeri aktarılmadı.

| Kaynak Excel kavramı            | İstasyonOS karşılığı                                                          |
| ------------------------------- | ----------------------------------------------------------------------------- |
| İlk/son sayaç, litre × fiyat    | Mevcut Faz 3 okumaları; fiyat değişiminde ara okuma                           |
| TTS + Gift Kart birleşik satırı | Yalnız raporda **TTS + Gift kullanım**; yükleme hariç; asıl kayıtlar ayrı     |
| Partner Kart                    | Ayrı kategori; model kararı taslak/bağımsız inceleme                          |
| TEST(TANKER)                    | Test çıkışı, test dönüşü ve tanker girişi üç ayrı fiziksel tür                |
| Fiyat farkı                     | Ara fiyat okumalarıyla hesap; bağımsız bir serbest tutar indirimi varsayılmaz |
| Nakit, kart, vadeli, tahsilat   | Mevcut satış ödemeleri/cari defteri; eski tahsilat ciro dışı                  |

**Karşılaştırmalı DEMO:** 20 L / 1.000 TL sayaç; 2 L / 100 TL test;
18 L / 900 TL ticari satış. Nakit 200 TL, kart 200 TL, mevcut cari satış
200 TL, Gift kullanım 200 TL ve geçici Partner alacağı 100 TL toplamı
900 TL'dir. TTS, mevcut 200 TL cari kaydının etiketidir; ikinci kez eklenmez.
Gift yükleme 300 TL satış dışıdır. Excel birleşik TTS+Gift kullanım satırı
400 TL; Partner 100 TL gösterir. Tank: `100 + 10 + 1 − 20 = 91 L`.
Nakit Gift yüklemesiyle teslim beklentisi 500 TL'dir. İndirilen XLSX'in
**16 sayısal alanı** API ile karşılaştırıldı ve eşleşti.

Excel'in özel satırları topluca düşen formülleri aynen kopyalanmadı: belirsiz
bir ödeme etiketinin ticari satışı azaltması veya Gift yüklemesinin ikinci
ciroya dönüşmesi engellendi. Bu bir hücre hücre şablon kopyası değildir.

## Doğrulama ve şema

- 20 dosyada **281 test**; 28 yeni icmal/iş kuralı/dışa aktarım testi.
  İki TypeScript kontrolü ve üç saat diliminde 65'er tarih/onay regresyonu geçti.
- Vite + sunucu build başarılı; önceki runtime config script ve büyük JS
  paketi uyarıları sürer. Paket kurulmadı.
- Gerçek HTTPS API'de beş kontrol grubu: yetki/izolasyon, fiziksel hareketler,
  Gift/kart gelir-bakiye koruması, onay/kilitler, eski satırların korunması.
- Gerçek Chrome'da beş grup: filtreler/ekranlar, XLSX/PDF, fiziksel hareket
  formları, Gift taslak/model/teyit formları, 390 px mobil genişlik ve JS hatası.
  Masaüstü ekran görüntüsü ayrıca incelendi. PDF gerçekten üretildi.
- API turunda önceden var olan firma/hesap/ödeme/slip/cari/stok/ürün/imza/sayaç
  satırları hash ile aynı kaldı. Tarayıcı örnekleri yalnız yeni DEMO hesaplardır.
- Yeni `0009_shift_icmal.sql`: katılım, özel işlemler ve tank ölçümü için
  üç ek tablo. Eski dokuz migration girdisi/dosyası değişmedi. Mevcut migration
  motoru, açık yerel test DB hedefi, manifest hash ve `--apply` ile uygulandı.
  On migration uygulanmış; bekleyen yok.
- Manifest SHA-256:
  `1867f5acc7fae59d5970e64520e17a530e5eb1e6f8a43b68a299ce4da9c8db9a`.
- Yalnız doğrulanmış İstasyonOS Node süreci yenilendi; `127.0.0.1:3000`.
  Apache/MySQL yeniden başlatılmadı, Aksan vhost hash'i aynı kaldı.

Yerel kanıtlar `.local/phase4b/`: `api-result.json`, `browser-result.json`,
`excel-comparison.json`, `verification.log`, `build.log`, `icmal-desktop.png`.
Örnek çıktılar `downloads/` altındaki XLSX/PDF'dir. Kimlik/oturum içeren
yardımcı dosyalar paylaşılmaz. Önceki Faz 3 runtime korunur; geri dönüş
yalnız Node giriş dosyasının önceki runtime'a alınmasıyla yapılabilir.
Migration veya özel kayıt geçmişi otomatik silinmez.

## Açık sınırlar ve sonraki öncelik

Barsoft, Myasoft, ELPO, Turpak, TTS sağlayıcıları, Gift/Partner servisleri,
banka, mali cihaz veya e-belge sistemlerine gerçek entegrasyon **yapılmadı**.
Bu sistemlerle veri/özellik eşitliği iddia edilmez. Manuel teyit harici sistem
doğrulaması değildir; gerçek mali defter ve müşteri/tedarikçi muhasebeleştirmesi
otomatik yapılmaz.

Komisyon/indirim, vergi-belge zamanı, sağlayıcı vadeleri, sıcaklık/yoğunluk
düzeltmesi ve tanker toleransı sözleşme/mali müşavir kararı ister. Gift
bakiyesi yerel, istasyon kapsamındaki operasyonel modeldir; sağlayıcının
gerçek kart bakiyesi değildir. Tank ölçümü vardiya mutabakatıdır; otomatik
ölçer, kapasite kontrolü veya merkezî sürekli tank stok sistemi değildir.
Test dönüşü bu sürümde aynı hesap içindeki çıkışa bağlanır. Kanıt dosyası
yüklenmez; referansı saklanır.

Sonraki öncelik: işletmenin anonim TTS/Gift/Partner işlem örnekleri ve
sözleşmeleriyle model kararlarını kesinleştirmek; ardından ayrı DEMO alanda
sağlayıcı hesaplaşma/vade ve sürekli tank stok akışını geliştirmek.

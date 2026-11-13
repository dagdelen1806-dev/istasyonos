# Günlük rapor — sayısal taslak ve icmal karşılaştırması

6 Kasım 2026: `/gunluk-rapor` ekranının ikinci aşaması DEMO/test ortamında
tamamlandı. Kaynak fotoğraf ile veri giriş formu masaüstünde yan yana,
mobilde sırayla gösterilir. Otomatik OCR henüz etkin değildir.

## Çalışan işlemler

- Fotoğrafa bağlı yakıt satışı, tabanca sayacı, tank çıkışı ve tahsilat/özel
  işlem satırları elle eklenir, düzenlenir veya taslağın yeni revizyonundan
  çıkarılır. Önceki veritabanı revizyonları silinmez.
- Yakıt/tank/tabanca eşleştirmesi açıkça seçilir. Eşleşmeyen veya okunmayan
  alanlar null/bilinmiyor kalır. Kaynak sayaç gerilemesi, farklı yazılı litre,
  eksik tank girişi/dönüşü, belirsiz satış esası ve yabancı/mükerrer eşleştirme
  kontrolleri vardır.
- Satış esası sayaç (test dahil) veya ticari satış (test hariç) olarak seçilir.
  Fiyat değişimlerini hesaplayan mevcut `fuelSnapshot`, `icmalAdjustments` ve
  `calculateFuel` sonuçları yeniden kullanılır. Yeni fiyat hesabı oluşturulmadı.
- Tankın net çıkışı = açılış + fiziksel giriş + fiziksel test dönüşü − kapanış.
  Bu değer aynı tankın sayaç çıkışıyla karşılaştırılır; güncel onaylı tank
  stoku geçmiş vardiya kapanışıymış gibi kullanılmaz. Ürün−net hacim farkı
  ve dönem referansı kapatma işlemi bu hesapla birleştirilmez.
- Nakit satış tahsilatı, kredi kartı, IBAN, cari satış, TTS, Gift yükleme,
  Gift kullanım ve Partner ayrı karşılaştırılır. Gift yükleme satış sayılmaz.
  TTS+Gift kullanım birleşik satırı yalnız rapor uyumluluğudur; ayrı satırlara
  eklenmez. Modeli belirsiz Diğer sınıfı için tahsilat varsayılmaz.
- Litre ve tutar farkları ayrı alanlardır; yön kaynak − güncel icmaldir.
  Hesaplar integer mililitre/kuruş üzerinden yapılır. Eksik/açık hesap,
  bekleyen özel işlem veya eksik/çift tabanca kapsamı kesin karşılaştırma
  yerine bilinmiyor ve uyarı üretir.

## Kayıt ve güvenlik

Kaynak paket incelemesinden ayrı sayısal revizyon saklanır. PENDING,
VERIFIED_DRAFT ve REJECTED kararları açıklama/kanıtla kaydedilir. Doğrulanmış
sayısal taslak için kaynak paketi REVIEWED_DRAFT olmalı; mevcut vardiya,
Türkiye başlangıç günü ve açık eşleştirme teyidi gereklidir. Doğrulama
sayının kaynaktan kontrol edildiğini belirtir; farkların kapandığı veya mali
işlemlerin onaylandığı anlamına gelmez.

Her revizyon kaynak inceleme revizyonunu, karşılaştırılan hesapların özetini
doğrulayan snapshot hash değerini ve o anda görülen karşılaştırmayı saklar.
Kaynak/icmal/eşleştirme değişirse eski karşılaştırma değişmez; güncelliğini
yitirdiği gösterilir. Eski sürüm, kaynak veya snapshot ile kayıt reddedilir.
Kaynak günü değiştiğinde eski vardiya bağlantısı geçmişte korunur; güncel
görünüm yeni eşleştirme ister.

Eşzamanlı incelemede yerel satırlar korunur, eski revizyonla kayıt kilitlenir.
Kullanıcı açıkça güncel taslağı yükleyebilir. Otomatik yenileme yazılmakta
olan satırları silmez. Karşılaştırma finansal hesap kilidi almadan aynı
transaction'ın tutarlı okuma görünümünden hazırlanır; eski hesap/stok onay
akışının kilit sırası değiştirilmez.

Uçlar yalnız DEMO firma sahibi/yönetici/muhasebeci içindir. Mevcut oturum,
CSRF, tenant/istasyon kapsamı, audit ve requestId recovery kullanılır.
Kaynak fotoğrafın pakete, eşleştirmenin ve vardiyanın istasyona ait olması
zorunludur. Hiçbir sayısal taslak işlemi satış, tahsilat, stok, cari veya mali
defter kaydı oluşturmaz. Mevcut iki bağımsız iş onayı korunur.

## Doğrulama ve örnek veri

- 443 test ve iki TypeScript kontrolü başarılı; tarih regresyonları üç saat
  diliminde geçti. Derleme başarılı. Mevcut klasik script ve paket boyutu
  uyarıları devam ediyor.
- Sentetik dört kaynak görüntüsü ve dokuz sayısal satır yalnız DEMO alanında
  oluşturuldu. Görseller açıkça sentetik olarak işaretlidir. Mevcut DEMO
  vardiyasının salt okunur hesapları karşılaştırma referansı olarak kullanıldı.
- Gerçek HTTPS API: yetki, yabancı paket/sayfa/shift, mükerrer satır,
  revizyon/snapshot, teyit ve requestId tekrar kontrolleri başarılı.
- Gerçek Chrome: ekleme/çıkarma/düzenleme, +1 mL ile +1 kuruşun ayrı
  gösterimi ve düzeltmesi, taslak doğrulama, başka kullanıcı incelemesinde
  yerel verinin korunması ve kayıt kilidi başarılı.
- Gerçek XLSX indirme ve PDF üretimi, masaüstü yan yana kaynak/veri,
  390px mobil genişlik ve JS hata kontrolleri başarılı.
- Kullanıcının gerçek beş fotoğraflık paketi PENDING durumunda korundu;
  gerçek kaynağa sayısal doğrulama veya mali aktarım yapılmadı.
- Dokuz mevcut stok/mali tablonun satır sayısı ve SHA-256 özetleri aynı.
  Aksan Muhasebe vhost özeti aynı; Apache/MySQL yeniden başlatılmadı.
- `0014_daily_numeric_drafts`, önceki 14 migration değişmeden mevcut güvenli
  migration motoruyla yalnız yerel İstasyonOS test veritabanına uygulandı.
  Node yalnız 127.0.0.1:3000 dinliyor. Yeni kurulum için otomatik seed veya
  mevcut veritabanını sıfırlama işlemi eklenmedi.

Test raporları, özel sentetik kaynaklar, ekran görüntüleri ve Excel/PDF
çıktıları `.local/daily-numeric/` altında tutulur. Özel kaynak tutarları veya
kişi bilgileri takip edilen test fixture'larına alınmadı.

Bu aşamada sınırlar: paket başına 100 sayısal satır ve 100 inceleme,
listede 100 vardiya ve vardiyada 100 hesap. Sınır aşımında sessiz kırpma
yerine hata verilir. Excel/PDF o anki yerel karşılaştırma satırlarını dışa
aktarır; kaydedilmiş geçmişin değiştiği anlamına gelmez. Sıradaki geliştirme
fotoğraftan okuma önerileri, güven/eksik alan uyarıları ve kullanıcı teyidiyle
aynı sayısal taslağa aktarımdır; OCR çıktısı doğrudan mali/stok kaydı olmayacak.

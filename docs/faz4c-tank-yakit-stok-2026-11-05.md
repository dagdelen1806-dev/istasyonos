# Faz 4C — Akıllı tank ve yakıt stok yönetimi

Yerel ekran: `https://istasyonos-main.test/tanklar`.
Yazımlar API seviyesinde yalnız DEMO firma alanına açıktır. Gerçek tank
sensörü, Turpak veya başka otomasyon bağlantısı yoktur.

## Çalışan ekranlar ve kayıt akışı

- Mevcut Faz 3 tank/yakıt/pompa ilişkileri kullanılır. Tank kartında numara,
  kapasite, kritik stok, mutlak litre toleransı, bağlı pompalar, onaylı stok,
  nominal kapasiteye göre doluluk ve son fiziksel ölçüm gösterilir.
- Başlangıç stoku bilinmiyor başlar. Kanıtlı başlangıç talebini farklı bir
  OWNER/ACCOUNTANT onayladığında ilk defter satırı oluşur. Eski vardiyalar
  başlangıç stokuna otomatik aktarılmaz.
- Tanker kabulünde mevcut istasyon tedarikçisi, irsaliye referansı, belge
  litresi, ölçülen/kabul litresi ve farkı ayrı kaydedilir. Talep stok artırmaz;
  bağımsız onay artırır. Farkın onayı açıklama ve kanıt gerektirir.
- Stok düzeltmesi yeni hedef miktar, gerekçe ve kanıtla talep edilir. Farklı
  yetkili onayı olmadan stok değişmez. Onaylı eski satır değiştirilmez/silinmez;
  düzeltme ayrı, önceki/sonraki miktarı taşıyan satırdır.
- Manuel ölçüm teorik stokla karşılaştırılır. Tolerans içi/dışı fark,
  ölçüm tarihi ve kanıt saklanır; ölçüm stok düzeltmez. Stok/ayar sürümü
  değişmişse önceki ölçüm güncel fark gibi gösterilmez.
- Kritik seviye ve doluluk ekran uyarıları vardır. Bunlar uygulama içi
  bildirimlerdir; SMS, e-posta veya dışarıya push gönderimi kurulmadı.
- Günlük, aylık, vardiya ve tüm hareket filtreleri; filtreli ticari çıkış,
  test çıkışı, test dönüşü ve tanker girişi toplamları gösterilir. Dönem
  raporu hareketin Türkiye saatindeki **deftere onayla işlendiği tarihe**
  dayanır. Kartlar her zaman güncel stoktur; geçmiş dönem sonu stok kartı değildir.
- XLSX ve PDF, tank kartları, stok defteri, dönem özeti, tanker/onaylar ve
  ölçüm farkları olmak üzere beş bölüm/sayfa içerir. PDF tarayıcının
  **PDF olarak kaydet** işlemiyle alınır.

## Sayaç ve icmal ile tek kaynaklı stok hesabı

Vardiya kaynaklı ticari satış, test çıkışı ve test dönüşü mevcut iki bağımsız
mali onay tamamlanınca aynı transaction içinde stok defterine geçer. Test
litresi ticari satış değildir; fiziksel tank çıkışıdır. Fiyat ve ticari tutar
hesapları Faz 4B mekanizmasından gelir.

İcmaldeki tanker teslimi, aynı tank/tedarikçi/irsaliye ve belge/kabul miktarlı
merkezî kabul kaydına bağlanır. Ekranda referans/sağlayıcı/litreyle seçilir.
Teslim stok defterine zaten kabul kaydından geçtiği için vardiyadan ikinci
kez yazılmaz. Merkezî onay olmadan bu vardiyanın son mali onayı tamamlanamaz.
Onaylı kabulün kaynak icmal kaydı iptal edilerek stok gerçeği gizlenemez.

Her stok kaynağının tank içinde benzersiz anahtarı vardır. Aynı istek veya
vardiya tekrar işlendiğinde yeni hareket oluşturulmaz. Önceki tank vardiyası
deftere geçmeden sonraki vardiya kesinleşmez. Kapasite aşımı ve negatif stok
reddedilir. Son mali onaydaki stok hatası, hesap durumu/imza/stok satırlarının
tamamını birlikte geri alır. İmza snapshot'ında stok öncesi/sonrası da saklanır.

Faz 4B ekranında güncel merkezî stok, ölçüm farkı ve ilgili vardiyanın stok
defterine geçip geçmediği görünür. Vardiya ölçüm mutabakatı korunur. Henüz
onaylanmamış vardiya çıkışları merkezî onaylı stoktan düşülmez; tank ekranında
bu bekleyen vardiyaların sayısı açıkça uyarılır.

## Güvenlik ve şema

Mevcut CSRF, tenant/istasyon kapsamı, requestId sonuç kurtarma, revision,
transaction ve audit mekanizmaları kullanılır. Tank kartı yönetimi
OWNER/MANAGER; bağımsız tanker/stok kararı OWNER/ACCOUNTANT yetkisindedir.
Kendi talebine onay verilemez. Stok/ayar sürümü değişmiş eski talep onaylanmaz;
reddedilip güncel veriyle yeniden hazırlanır. Bu stok onayı mevcut iki mali
imzanın yerine geçmez.

Yeni `0010_tank_stock.sql` beş ek tablo oluşturur: kartlar, talepler,
teslim bağlantıları, değiştirilmeyen stok defteri ve ölçümler. Eski on
migration dosyası/girdisi değiştirilmedi. Mevcut motor; açık yerel test DB
hedefi, manifest SHA-256 ve `--apply` ile çalıştırıldı. On bir migration
uygulanmış, bekleyen yoktur.

Manifest SHA-256:
`faaf9bc218bdbd2540b2742dabbb796c4580d16a9ced9c5f0f9ac00fa6b03c0a`.

API testinde bulunan stok talebi kimliği / idempotency `requestId` alan
çakışması düzeltildi: iş talebi `stockRequestId`, taşıma/tekrar-kayıt kimliği
`requestId` olarak ayrıdır. Regresyon testi iki farklı kimliği birlikte kullanır.
Tekrar-kayıt güvenliği gevşetilmedi.

## Gerçek DEMO doğrulaması

- İki TypeScript kontrolü; 21 dosyada **305 test**, 24 yeni tank testi;
  üç saat diliminde 65'er tarih/onay regresyonu başarılı. Vite/sunucu build
  başarılı. Mevcut büyük paket/runtime config ve logout clearCookie
  deprecation uyarıları engel oluşturmaz; bu fazda ortak auth akışı değiştirilmedi.
- Gerçek API: bağımsız 100 L başlangıç; -2 L fiziksel farkın ölçümle stok
  değiştirmemesi; ayrı onaylı düzeltmeyle 98 L stok doğrulandı.
- Aynı 10 L tanker kabulü hem icmalde hem merkezî defterde bağlıyken tek kez
  arttı. `98 + 10 − 18 ticari − 2 test + 1 dönüş = 89 L` doğrulandı. İlk mali
  imza stoku değiştirmedi; ikinci imza ve aynı requestId tekrarı çift yazmadı.
- 89 L stokla 90 L çıkışın son mali onayı reddedildi: stok 89 L, hesap
  IN_REVIEW ve bir imza kaldı; yeni stok satırı oluşmadı. Bağımsız onaylı
  10 L ikmalden sonra onay tamamlandı ve 9 L kaldı. Kritik uyarısı çalıştı.
- 8,5 L ölçümde -0,5 L tolerans içi fark kaydedildi, stok 9 L kaldı. İcmal
  tarayıcı kontrolünde merkezî 9 L, -0,5 L fark ve “Deftere geçti” görüldü.
- Tarayıcıda gerçek kart/başlangıç/tanker/ölçüm/düzeltme formları çalıştı:
  500 L başlangıç; 30 L belge ve 29,5 L kabul ile 529,5 L; ölçümle -2 L fark;
  bağımsız düzeltmeyle 527,5 L. Belge farkı otomatik düzeltilmedi.
- Beş tank tarayıcı grubu ve ayrı icmal bağlantısı kontrolü başarılı. Gerçek
  XLSX/PDF üretildi; XLSX içindeki 9 L ve 527,5 L stokları API ile eşleşti.
  390 px genişlik ve yakalanmamış JS hata kontrolü geçti. Masaüstü görüntüsü incelendi.
- Test öncesindeki firma, hesap, ödeme, slip, cari/defter, stok/ürün, imza,
  sayaç ve özel işlem satırları hash ile aynı kaldı. Yeni işlemler yalnız
  mevcut DEMO firma içindeki yeni DEMO istasyon/hesaplardadır. Bir ilk test
  denemesinin hazırlık tankları da yalnız DEMO alanda kaldı.
- Apache/MySQL yeniden başlatılmadı; Aksan vhost hash'i aynı. Yalnız
  doğrulanmış İstasyonOS Node süreci yenilendi; `127.0.0.1:3000` çalışır.

Yerel kanıtlar `.local/phase4c/` altındadır: `api-result.json`,
`browser-result.json`, `icmal-browser-result.json`, `export-check.json`,
`verification.log`, `build.log`, `tank-desktop.png`.
Örnek çıktılar `istasyonos-tank-stok.xlsx` ve `istasyonos-tank-stok.pdf`.
Özel oturum bilgileri paylaşılmaz. Önceki Faz 4B runtime korunur; geri dönüş
yalnız Node giriş dosyasının önceki runtime'a alınmasıyla yapılabilir.
Migration veya stok geçmişi otomatik silinmez.

## Kullanıcının fotoğrafları ve kalan sınırlar

Vardiya ve tank ekranı fotoğrafları salt okunur incelendi. Sayaç, tank
açılış/kapanış/dolum, ürün/net hacim, sıcaklık ve seviye alanları günlük
taslak veri için uygundur. Gerçek değerler onaylı DB stoklarına aktarılmadı.
Son tank fotoğrafının özel taslağı `.local/phase4c/tank-photo-draft.json`
altındadır; kaynak zamanı, brüt/net ayrımı ve doğrulama uyarıları taşır.

Nominal kapasiteden hesaplanan doluluk ile fotoğraftaki Hacim % göstergesi
eşleşmediği için kalibrasyon/kullanılabilir kapasite tanımı doğrulanmalıdır.
LPG'nin sıfır kapasite/ölçüm göstergeleri doğrulanmış boş stok sayılmadı.
Kritik seviye ve tolerans fotoğraftan tahmin edilmedi.

Otomatik OCR, fotoğraf yükleme, PDF/Excel kaynak içe aktarma, sensör okuma,
sıcaklık/yoğunluk dönüşümü, brüt-net hacim seçimi, tank geometrisi/kalibrasyon
tablosu ve otomatik fiziksel tank değiştirme bu sürümde yoktur. Litreler
manuel girilir; içeride tamsayı mililitre saklanır. Kanıt, dosya/fotoğraf
referansıdır. Gerçek mali defter, banka ve geçmiş bekleyen mali kayıtlar açılmadı.

Sonraki öncelik: fotoğraf/PDF'den alanları güven puanıyla taslağa çıkarma,
çift belge kontrolü, tank eşleştirme ve kullanıcı doğrulaması. OCR sonucu
ölçüm/işlem taslağı olmalı; stok defterini otomatik kesinleştirmemelidir.

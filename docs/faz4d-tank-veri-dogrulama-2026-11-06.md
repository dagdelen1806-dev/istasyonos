# Faz 4D — Tank verisi doğrulama

Hazırlanan ekran: `https://istasyonos-main.test/tank-dogrulama`.
Firma sahibi/yönetici, yalnız yetkili DEMO istasyonundaki taslakları görür.
Kaynak fotoğraf, kaynak değer, hesaplanan oran, önerilen değer, mevcut kart
eşleştirmesi ve taslak karar durumu ayrı gösterilir.

## Doğrulanan ve bekleyen alanlar

Önceki `.local/phase4c/tank-photo-draft.json` ile kaynak tank fotoğrafı yeniden
karşılaştırıldı. 1–4 numaralı tankların numarası, görünen yakıt etiketi,
nominal kapasitesi, ürün hacmi ve net hacmi görsel transkripsiyonla eşleşti.
Bu, fiziksel ölçümün veya cihaz kalibrasyonunun onaylandığı anlamına gelmez.

- Ürün/nominal kapasite ve net/nominal kapasite oranları ayrı hesaplanır.
  Kaynak hacim yüzdeleri bu oranlarla uyuşmuyor; kaynak yüzde değiştirilmedi.
- Ürün + boş hacim ile nominal kapasite uyuşmazlığı ayrıca gösterilir.
  Kullanılabilir kapasite veya kalibrasyon anlamı varsayılmaz.
- Seviye yüzdesi hacim yüzdesine dönüştürülmez. Brüt/net dönüşümü,
  sıcaklık katsayısı veya eksik ölçüm tahmin edilmez.
- LPG'nin görünen 0 L kapasitesi öneride **null/bilinmiyor** olur. Sıfır
  hacim göstergeleri doğrulanmış boş tank kabul edilmez; doluluk hesaplanmaz.
- Negatif, sonlu olmayan, güvenli mililitre sınırı dışındaki veya mililitreden
  daha hassas kaynak değerler geçersiz/bilinmiyor olarak işaretlenir.
- Mevcut DEMO kartlarında fotoğraf satırları için tekil tam eşleşme bulunmadı.
  Numara, yakıt etiketi ve kapasite eşleşmesi ayrı gösterilir. Yakıt alias'ı
  veya DEMO öneki otomatik eşitlenmez. Tam eşleşme olsa bile yalnız önerilir;
  tank seçimi kullanıcı tarafından açıkça yapılır.

Gerçek fotoğrafın **beş satırı da PENDING/onaysız** kaldı. Kaynak kapasite,
hacim tanımı, yüzdelerin anlamı ve tank eşleştirmeleri işletme doğrulaması
bekliyor. Ayrıntılı kaynak karşılaştırması yalnız özel
`.local/phase4d/validated-source.json` dosyasındadır; gerçek kaynak değerleri
genel uygulama dokümanına veya test fixture'larına kopyalanmadı.

## Taslak karar akışı

Yönetici kapasite, önerilen hacim, ürün/net tanımı ve açık tank eşleştirmesini
girer; gerekçe/kanıt referansı ve kaynak/uyarı teyitlerini kaydeder.
`PENDING`, `APPROVED_DRAFT` ve `REJECTED` kararları sürümlü, eklemeli geçmişte
saklanır. Eski karar veya kaynak satırı değiştirilmez.

Taslak onayı için pozitif kapasite, kapasiteyi aşmayan hacim, istasyon
kapsamındaki tank, hacim tanımı ve açık teyitler zorunludur. Sürüm çakışması,
yetkisiz kullanıcı ve başka istasyon belgesi reddedilir. Bu onay **stok
uygulaması değildir**: tank kartı, stok defteri, fiziksel ölçüm veya mali
hesap güncellenmez. Mevcut stok düzeltme/bağımsız onay mekanizmasının yerine geçmez.

Kaynak fotoğraf yetkili API üzerinden, SHA-256 doğrulanarak ve `no-store`
ile sunulur. Yerel dosya yolu kullanıcı girdisinden alınmaz. Fotoğrafın
özel kopyası `.local/phase4d/sources/` altındadır; genel statik dosya değildir.
Otomatik OCR veya genel fotoğraf yükleme/içe aktarma bu fazda kurulmadı.

## Şema ve güvenlik

İki yeni DEMO taslak/inceleme tablosu `0011_tank_photo_validation.sql` ile
eklendi. Önceki on bir migration girdisi değişmedi. Mevcut CSRF, kapsam,
requestId, revision, transaction, sonuç kurtarma ve audit mekanizmaları kullanılır.

İlk uygulamada MySQL'in ayrılmış `ROW_NUMBER` adı nedeniyle ikinci tablo
oluşamadı; migration motoru STARTED kaydıyla durdu. Bu tamamlanmamış migration'da
kolon adı `row_key` olarak düzeltildi. İlk tablonun kolonları, indeksleri,
foreign key'leri, InnoDB motoru ve mevcut taslak satırları; eksik ikinci tablo
ve uygulanmamış geçmiş named lock altında karşılaştırıldı. Eski SQL/manifest
özel recovery dizininde korundu. STARTED kaydı silinmedi; eski checksum
inceleme referansına kaydedildi ve mevcut store.finish ile tamamlandı.
Uygulanmış geçmiş migrationlar veya stok tabloları değiştirilmedi.

Son başarılı migration doğrulamasında 12 migration uygulanmış, bekleyen
yoktu. Güncel manifest SHA-256:
`2b78e0fa8c9fb2468602c476769cd5da1a2b0307a5ba00964c80e7c1ef7299e1`.
İnceleme kanıtı `.local/phase4d/recovery/result.json` altındadır.

## Testler ve mevcut çalışma durumu

- İki TypeScript kontrolü, 22 dosyada **338 test**; 33 yeni doğrulama testi
  ve üç saat diliminde 65'er tarih/onay regresyonu başarılı. Vite/sunucu build geçti.
- Gerçek HTTPS API'de dört grup: ürün/net hesapları ve LPG; kaynak hash'i ve
  rol/istasyon izolasyonu; sürümlü taslak kararı ve requestId tekrarı; stok/mali
  tablolar ile orijinal kaynağın korunması.
- Gerçek Chrome'da üç grup: yönetici girişi, kaynak fotoğraf ve beş satır;
  ayrı sentetik DEMO belgede onay/ret formu; gerçek kaynak satırlarının
  onaysız kalması, 390 px genişlik ve JS hata kontrolü. Masaüstü ekranı incelendi.
- Sonraki hash kontrolünde **dokuz stok/mali tablo** aynı kaldı. Gerçek
  fotoğrafa ait inceleme sayısı sıfır; orijinal JSON taslağı değişmedi.
- Yalnız doğrulanmış İstasyonOS Node süreci yerel derlemeye geçirildi.
  Apache/MySQL'e başlatma/yeniden başlatma komutu verilmedi.
- İlk teslimdeki son kontrolde MySQL bağlantısı
  `ECONNREFUSED 127.0.0.1:3306` döndü; Apache 443 dinleyicisi de görünmedi.
  Node 127.0.0.1:3000 üzerinde kaldı. Ortak Laragon servisleri kendiliğinden
  başlatılmadı. Sonraki devam kontrolünde Apache/MySQL tekrar erişilebilir
  bulundu: HTTPS sağlık/uygulama 200, oturumsuz API 401; 12 migration uygulanmış
  ve bekleyen yok. Yönetici ekranı gerçek Chrome'da salt okunur akışla yeniden
  doğrulandı; fotoğraf ve beş kaynak satırı açıldı, LPG bilinmiyor kaldı,
  mobil/JS kontrolü geçti. Dokuz korunan tablo yeniden aynı hash'i verdi.
  Gerçek kaynak satırları onaysız kaldı. Aksan yapılandırması değiştirilmedi.

Kanıtlar `.local/phase4d/` altında: `api-result.json`, `browser-result.json`,
`protected-result.json`, `verification.log`, `build.log`, `validation-desktop.png`.
Özel fotoğraf/erişim dosyaları paylaşılmaz. Önceki Faz 4C runtime korunur.

Sonraki adım: işletme yöneticisi hacim esasını,
kapasite/kalibrasyon anlamını ve tank eşleştirmelerini ekrandan doğrulamalıdır.
Bu kararlar henüz stok uygulama yetkisi vermez; gerçek stok aktarımı ayrı
kanıtlı, bağımsız onaylı bir sonraki işlem olmalıdır.

# Günlük fotoğraf — yerel okuma önerileri

6 Kasım 2026: `/gunluk-rapor` ekranına Türkçe yerel OCR önerileri eklendi.
Mevcut Windows OCR desteği kullanılır; paket, Windows dil bileşeni veya
dış servis kurulmadı. Fotoğraf işleme kodu dış servise veri göndermez.

## Çalışan akış

1. Yetkili DEMO kullanıcısı kaynak fotoğrafı seçip **Fotoğraftan oku (yerel)**
   düğmesine basar. Fotoğrafın paket/istasyon kapsamı ve SHA-256 özeti
   doğrulanır. Sonuç kaynak görüntü ve motor sürümüyle önbelleğe alınır.
2. Okunan metin ve sayılar kaynak konumlarıyla gösterilir. Seçilen sayı
   görüntüde işaretlenir. Sistem yakıt/tank/tabanca/müşteri eşleştirmez ve
   sayının hangi tablo sütununa ait olduğunu varsaymaz.
3. Kullanıcı sayı yorumunu ve mevcut satır türündeki hedef alanı seçer.
   `1.234`, `12,345` gibi belirsiz ayırıcılarda olası yorumlar ayrı sunulur;
   seçim otomatik yapılmaz. Harfler rakama dönüştürülmez. Para için iki,
   litre için üç ondalık sınırı korunur; yuvarlanmış değer önerilmez.
4. Kaynak teyidinden sonra öneri yalnız açık form alanına alınır. Satırın
   eklenmesi ve sayısal taslağın kaydedilmesi ayrı işlemlerdir.
5. Kaynak OCR metni, sayı yorumu ve alan bağlantısı sunucudan doğrulanır.
   İstemcinin gönderdiği özgün OCR metni veya öneri tutarı güvenilir sayılmaz;
   veritabanındaki değişmez okuma kullanılır. Kullanıcı değeri düzeltirse
   özgün öneri ve düzeltildi bilgisi ayrı korunur.

OCR güven yüzdesi üretilmez; motorun bu API'si satır, kelime ve konum bilgisi
sağlar. Arayüzde güven puanı olmadığı ve kaynak kontrolünün gerektiği açıkça
yazar. Belirsiz/eksik alanlar mali değer olarak kabul edilmez. Kaynak API
özellikleri: [Microsoft OcrEngine](https://learn.microsoft.com/en-us/uwp/api/windows.media.ocr.ocrengine),
[Microsoft OcrWord](https://learn.microsoft.com/en-us/uwp/api/windows.media.ocr.ocrword).

## Korunan kurallar

- Yalnız DEMO firma sahibi/yönetici/muhasebeci; oturum, CSRF, tenant/istasyon,
  kaynak hash, audit ve requestId recovery kontrolleri kullanılır.
- Yabancı okuma, başka fotoğrafa ait alan, sahte kelime/yorum numarası,
  teyitsiz veya mükerrer OCR alanı reddedilir. Aynı kaynağın eşzamanlı
  okumalarında tek değişmez önbellek kaydı kullanılır.
- Kart numarası olabilecek metin mevcut kart güvenlik kuralıyla öneriden
  ve OCR metin kaydından çıkarılır. Bu nedenle bazı satırlar elle incelenebilir.
- Orijinal görüntüler ve OCR kayıtları dışarı gönderilmez. Geçici görüntü
  yalnız uygulamanın `.local/ocr-work` alanında oluşturulur; iş bitiminde
  temizlenir. Temizleme hedefi uygulamanın sahip olduğu klasörle sınırlıdır.
- Windows PowerShell betiği sabit dosya/argümanlarla çağrılır; istekte dosya
  yolu veya komut kabul edilmez. Yetki yükseltme veya ExecutionPolicy
  değişikliği yapılmaz. Windows/Türkçe OCR yoksa elle giriş açık kalır.
- 5 MB kaynak, 16 milyon piksel, 10000 piksel kenar, 30 saniye, 1000 satır,
  5000 kelime ve sınırlı çıktı boyutu uygulanır. Aynı anda tek yerel OCR işi
  çalışır. Sınırlar aşılınca sonuç sessizce kırpılmaz.
- Okuma ve öneri aktarımı satış, tahsilat, stok veya mali defter işlemi
  değildir. Mevcut vardiya çift onayı ve finansal kilitler değişmedi.

## Gerçek doğrulama

- 474 test ve iki TypeScript kontrolü geçti. Tarih regresyonları üç saat
  diliminde geçti. Frontend/sunucu derlemesi başarılı; mevcut klasik script
  ve paket boyutu uyarıları sürüyor.
- Kullanıcının beş gerçek fotoğrafı Windows motoruyla okundu: sırasıyla
  61/68/38/202/49 metin satırı ve 34/36/10/154/21 sayı önerisi. Toplam
  **255 sayı önerisi**, doğrulanmış 255 mali alan anlamına gelmez.
- Gerçek paket PENDING kaldı; gerçek pakete sayısal taslak/iş onayı
  yazılmadı. Özel kaynak metinleri takip edilen dokümana/test fixture'ına
  alınmadı; yerel veritabanı ve `.local/daily-ocr` altında tutuldu.
- Sentetik görüntü gerçek motorla okundu. Chrome'da belirsiz sayı seçimi,
  ayrı hedef alan teyidi, konum işaretleme, yalnız form doldurma ve ardından
  PENDING sayısal taslak kaydı test edildi.
- OCR önerisi ile bir kuruş elle düzeltilen değer ayrı saklandı. Teyitsiz,
  yabancı ve sahte OCR referansları API tarafından reddedildi.
- Tekrar istek/önbellek, yeni kaynağın yerel okunması, masaüstü/mobil ve
  JavaScript hata denetimleri başarılı. Geçici iş klasörleri temizlendi.
- Dokuz mevcut stok/mali tablonun satır sayısı ve SHA-256 özetleri aynı.
  Aksan Muhasebe vhost özeti aynı; Apache/MySQL yeniden başlatılmadı.
- `0015_daily_ocr_suggestions`, önceki 15 migration değişmeden mevcut güvenli
  migration mekanizmasıyla yalnız yerel test veritabanına uygulandı.
  Uygulama yalnız 127.0.0.1:3000 üzerinde çalışır.

Bu aşama tabloyu tamamen otomatik aktarmıyor. Sayı→alan seçimleri kullanıcı
tarafından yapılıyor; düşük kaliteli, eğik, bölünmüş veya okunmayan değerler
elle doğrulanmalı. Sonraki aşama, rapor düzenine göre satır/sütun önerilerini
aynı kaynak teyidi ve mali kilitlerle sunmaktır.

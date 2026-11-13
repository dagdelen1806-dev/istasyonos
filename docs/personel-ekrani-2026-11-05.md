# 5 Kasım 2026 — Personel ekranı

Mevcut kurulum ekranındaki kullanıcı listesi ve davet akışı, ayrı `/personel`
sayfasında toplandı. Firma sahibi ve yönetici sol menüde **Personel** bağlantısını
görür. Firma/istasyon kurulum ekranında yeni sayfaya geçiş özeti bulunur.

Liste ad/e-posta araması, rol filtresi ve sonuç sayısını içerir. Her üyenin
rolü ve yalnız görünür istasyon kapsamı gösterilir; kişinin diğer istasyon
yetkileri veya çevrimiçi durumu hakkında çıkarım yapılmaz. Üst çubuktaki
istasyon filtresi mevcut state API üzerinden veri kapsamını belirler.

Davet mevcut CSRF, yetki, şifreli yanıt ve kalıcı işlem kurtarma akışıyla
oluşturulur. MANAGER hesabına rol seçiminde yalnız FUEL_STAFF, MARKET_STAFF
ve PURCHASER gösterilir; yönetici/muhasebeci daveti yalnız OWNER için sunulur.
Bu sunucu kuralı zaten vardı; yeni UI aynı sınıra uyar. Kod yedi gün geçerli,
tek kullanımlıktır ve yalnız oluşturma sonucunda gösterilir.

## Değişiklikler

- `client/src/components/stationos/PersonnelPanel.tsx`: liste, arama, filtre,
  görünür kapsam ve davet sonucu.
- `client/src/pages/StationApp.tsx`: yönetim navigasyonu, rol sınırı, kurulum
  özet bağlantısı ve mevcut davet formunda izin verilen roller.
- `client/src/App.tsx`, `client/public/manus-routes.json`: yeni sayfa yolu.

Yeni endpoint, migration veya `.env` değişikliği yoktur. Liste mevcut state
API'nin tenant/istasyon kapsamını kullanır. Hiçbir mevcut kullanıcının rolü,
istasyon erişimi veya parolası değiştirilmedi. Erişim kapatma ve rol atama
işlemleri bu sürümün kapsamına dahil değildir.

## Doğrulama ve çalışan ortam

İki TypeScript kontrolü, 18 dosyada 210 test ve üç saat diliminde 65'er tekrar
testi geçti. Build başarılı; önceki runtime config script ve büyük chunk
uyarıları devam ediyor. Güncel statik varlıklar çalışan yerel build'e alındı;
Apache/MySQL yeniden başlatılmadı. Backend değişmediği için Node yeniden
başlatılmasına gerek kalmadı.

Gerçek HTTPS/Chrome ve mevcut İstasyonOS test DB'sinde rastgele geçici
kullanıcılarla şunlar doğrulandı:

- Yönetici yalnız kendi istasyonundaki üyeleri gördü; farklı istasyon ve
  farklı firma kullanıcısı listeye girmedi. Personel state API'si yalnız
  kendi üye kaydını döndürdü; yabancı istasyon sorgusu 403 aldı.
- Yönetici adına üst rol veya yetki dışı istasyona davet API'de reddedildi.
- Personel navigasyonu, e-posta araması, boş sonuç ve rol filtresi çalıştı.
- İzinli rollerle gerçek davet oluşturuldu ve sonuç kodu ekranda gösterildi.
- Doğrudan `/personel` yenilemesi ve 390 px DOM genişlik kontrolü geçti.
- Personel rolüyle doğrudan URL açıldığında erişim mesajı görüldü; Personel
  menüsü gösterilmedi.

Geçici üyelikler, test daveti, bunlara ait audit/request kayıtları ve geçici
firma/kullanıcılar kimlik kontrolleriyle temizlendi. Mevcut gerçek test
kullanıcıları ve mali kayıtlar korundu. Sonuç
`.local/local-setup/personnel-result.json` altındadır. Kontroller DOM ve API
sonuçlarına dayanır; bu koşuda görsel screenshot kabulü yapılmadı.

Adres: `https://istasyonos-main.test/personel`. Güncel ekranı görmek için
sayfayı yenileyin. Yerel uygulama `127.0.0.1:3000` üzerinde açık kalır.

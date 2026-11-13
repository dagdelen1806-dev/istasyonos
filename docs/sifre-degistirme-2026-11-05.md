# 5 Kasım 2026 — Profilim / Şifre değiştir

Yerel kimlik doğrulamasında kullanıcı, Profilim ekranından mevcut şifresini
doğrulayarak yeni şifre belirleyebilir. Profilim, sol menü ve üst çubuktaki
kilit düğmesinden veya `/profil` adresinden açılır. Firma üyeliği bekleyen
yerel kullanıcı da profil ekranına erişebilir.

## Davranış ve güvenlik

- Yeni şifre 12–128 karakter olmalı, mevcut şifreden farklı olmalı ve formda
  tekrar alanıyla eşleşmeli. Şifre tarayıcı deposuna veya loga yazılmaz.
- `POST /api/auth/change-password` kullanıcıyı doğrulanmış oturumdan seçer;
  body içindeki kullanıcı/rol bilgilerini kullanmaz. JSON, özel istek başlığı
  ve aynı Origin kontrolü uygulanır. Yanıtlarda no-store korunur.
- Kullanıcı başına 15 dakikada beş deneme sınırı vardır. Bu sınır mevcut
  yerel auth gibi tek sunucu sürecinde tutulur.
- Mevcut şifre scrypt ile doğrulanır. Yeni hash ve diğer oturumların iptali
  aynı transaction'dadır. Şu anki oturum açık kalır; başka kullanıcıların
  oturumları değişmez. Kullanıcının kendi rolünü değiştiren bir işlem yoktur.
- Login de credential satırını kilitler; şifre doğrulaması ile yeni oturumun
  oluşturulması aynı transaction'dadır. Böylece şifre değişikliğiyle yarışan
  eski şifreli giriş, işlem sonunda geçerli yeni bir oturum bırakamaz.
- Yanıt kaybında form otomatik tekrar göndermez; belirsizlik mesajı gösterir.
  Şifre değişmiş olabilir. Başarıda parola alanları sıfırlanır.

Yeni tablo/migration veya `.env` değişikliği gerekmedi. E-posta doğrulama,
unutulan şifre kurtarma ve personel rol yönetimi bu değişikliğe dahil değildir.

## Değişen kaynaklar

- `server/local-auth.ts`: yeni endpoint ve transaction içinde login/session
  oluşturma; mevcut auth sözleşmesi korunur.
- `server/password-change.test.ts`: yetki, parola doğrulama, oturum izolasyonu,
  rollback, deneme sınırı, eşzamanlı değişiklik ve login yarışı testleri.
- `client/src/components/stationos/ProfilePanel.tsx`: profil ve şifre formu.
- `client/src/pages/StationApp.tsx`, `client/src/App.tsx`,
  `client/public/manus-routes.json`: navigasyon ve profil yolu.
- `tsconfig.phase1.json`: yeni test dosyası statik kontrol kapsamına alındı.

## Doğrulama

İki TypeScript kontrolü, 18 dosyada **210 test** ve üç saat diliminde 65'er
tekrar testi başarılı. Yeni yerel build `.local/password-change-build/`
altında üretildi. Önceki runtime config script ve büyük JS paketi uyarıları
sürüyor.

Gerçek HTTPS ve MySQL pilotunda yalnız rastgele oluşturulan iki geçici hesap
kullanıldı. Gerçek yönetici hesabının şifresi değiştirilmedi. Chrome'da giriş,
Profilim navigasyonu, hatalı şifre tekrarı, başarılı değişiklik ve alanların
temizlenmesi doğrulandı. Mevcut oturum korundu; aynı kullanıcının diğer
oturumu 401 aldı; farklı kullanıcı oturumu açık kaldı. Eski şifre reddedildi,
yeni şifreyle giriş başarılı oldu. Gerçek eşzamanlı login/değişiklik sonunda
eski şifreli yarış oturumu geçerli kalmadı. 390 px DOM genişlik kontrolü geçti.

Geçici hesapların oturumları, credential kayıtları ve kullanıcı kayıtları
kimlikleri doğrulanarak kaldırıldı. Firma/istasyon veya mali test kaydı
oluşturulmadı. Sonuç `.local/local-setup/profile-result.json` altındadır.
Chrome PNG yakalaması bu kısıtlı ortamda boş görüntü ürettiği için görsel
kabul kanıtı sayılmadı; tarayıcı doğrulaması DOM ve gerçek API sonuçlarına
dayanır.

## Yerel kullanım

Yalnız İstasyonOS Node süreci yeni build ile yenilendi; uygulama
`127.0.0.1:3000` üzerinde ve `https://istasyonos-main.test` adresinden açık.
Apache/MySQL yeniden başlatılmadı; diğer projelere veya DB'lere dokunulmadı.
Süreç kimliği `.local/local-setup/application.pid`, logları
`password-application.out.log` / `password-application.err.log` altındadır.
Bu yerel build'de hot reload yoktur.

Sayfayı yenileyip **Profilim → Şifre değiştir** yolunu kullanın. Mevcut
şifrenizi yalnız uygulamadaki forma girin.

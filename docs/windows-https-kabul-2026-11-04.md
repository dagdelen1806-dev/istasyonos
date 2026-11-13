# 4 Kasım 2026 — Windows/Laragon yerel HTTPS kabulü

Windows üzerinde ayrı sentetik MySQL, mevcut uygulama build'i, Laragon Nginx
ve mobil Chrome emülasyonuyla yerel HTTPS kabulü tamamlandı. Kullanıcının
talebiyle yedek–geri yükleme provası atlandı; yapılmış kabul edilmez.

## Ortam

- Node.js 24.14.0, MySQL 8.0.30, Nginx 1.22.0, Chrome headless.
- Ayrı MySQL örneği: loopback 13387, `.local/y08-pilot/data/`. Betik port ve
  veri dizinini doğruladıktan sonra yeni sentetik DB ve kullanıcı oluşturdu.
- Uygulama: `.local/phase1-build/index.js`; startup readiness başarılı.
  `AUTH_PROVIDER=local`, `COOKIE_SECURE=true`; `.env` yüklenmedi.
- TLS sonlandırma: `https://127.0.0.1:13443` → Nginx → yerel uygulama 13388.
  Proxy Host ve forwarded başlıklarını kendisi ayarlar; istemcinin sahte
  forwarded değerlerini arka uca taşımaz. Nginx access log kapalıdır.
- Pilot sertifikası SAN olarak localhost ve 127.0.0.1 içerir. Node yalnız bu
  sertifikayı CA olarak kabul etti ve TLS doğrulamasını kapatmadı. Chrome'da
  yalnız bu sertifikanın SPKI anahtarı istisnaya alındı. İşletim sistemi güven
  deposu değiştirilmedi. Anlaşılan protokol TLS 1.3 oldu.
- Tarayıcı: 390 × 844 mobil viewport ve Android user-agent emülasyonu.
  Kısıtlı ortam için `--no-sandbox` / `--in-process-gpu` gerekti.

## Başarılı kontroller

| Kontrol                    | Kanıt                                                                                                                                                                                                   |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Gerçek HTTPS reverse proxy | Sertifika doğrulayan Node istemcisi health ve gerçek auth/API isteklerini tamamladı. Chrome TLS 1.3 bağlantısında uygulamayı açtı.                                                                      |
| Oturum çerezi              | Secure, HttpOnly, SameSite=Lax ve Path=/ doğrulandı. Çerez tarayıcıda saklandı; `document.cookie` ile okunamadı.                                                                                        |
| Origin / CSRF              | Yabancı Origin ile sahte X-Forwarded-Host/Proto gönderimi reddedildi. Geçersiz CSRF içeren mutasyon da 403 döndü.                                                                                       |
| Mobil giriş ve gezinme     | Gerçek giriş formu gönderildi; özel sentetik firma alanı açıldı. Mobil menüden vardiyalar sayfasına gidildi. Belge ve viewport genişliği 390 px; yatay taşma yok.                                       |
| Güvenli tarayıcı API'leri  | `isSecureContext`, Web Locks ve Service Worker kullanılabilir.                                                                                                                                          |
| Oturum yenileme            | Aynı tarayıcı tekrar giriş yaptığında yeni token aldı; önceki token sunucuda 401 ile reddedildi.                                                                                                        |
| Çıkış                      | Gerçek “Oturumu kapat” düğmesi giriş ekranına döndürdü; eski çerezle API 401 döndürdü.                                                                                                                  |
| Oturum süresi              | Yalnız sentetik oturumun expires_at değeri test SQL'iyle geçmişe alındı. Yenilemede giriş ekranı gösterildi, özel firma görünümü kalktı, eski token 401 aldı.                                           |
| PWA önbelleği              | CacheStorage yalnız offline.html ve üç istasyon ikonunu içerdi. API, oturumlu HTML veya finans verisi kaydı yok. Karma HTTP içerik isteği yok.                                                          |
| Gerçek bağlantı kesilmesi  | Pilot Nginx durdurulup yeni gezinme başlatıldı. Service Worker herkese açık çevrimdışı bilgi ekranını gösterdi; özel firma adı ve form yoktu. API fetch başarısız oldu, önbellekten özel yanıt gelmedi. |
| Yeniden bağlanma           | Nginx yeniden başlatıldı. HTTPS health geçti; tarayıcı yenilendiğinde mevcut oturumla özel uygulama görünümü geri geldi.                                                                                |

İlk çevrimdışı denemede yalnız sayfanın CDP ağ emülasyonu kullanıldı; bu
deneme Service Worker bağlantı kesintisini kanıtlamadı. Başarılı kabul,
gerçek Nginx sürecinin durdurulup yeniden başlatıldığı son koşuya dayanır.

## Tekrar ve kapanış

Makineye özel pilot kaynakları, Nginx yapılandırması, kısa ömürlü test
sertifikası/anahtarı ve sonuç dosyası `.local/y08-pilot/` altındadır;
`.gitignore` kapsamındadır. Gizli anahtarlar belgeye veya kaynak sürümüne
eklenmedi. Önceden hazırlanmış izole MySQL veri dizini, migration modülü ve
güncel uygulama build'iyle tekrar komutu:

```text
node .local/y08-pilot/https-acceptance.mjs
```

Sekiz kabul grubu başarılı. Sonuç kanıtı
`.local/y08-pilot/https-acceptance-result.json` altındadır. Uygulama kodu
değişmedi; önceki **198 test**, TypeScript ve build sonuçları geçerlidir.
Aynı test/build komutları bu yalnız ortam kabulü için tekrar çalıştırılmadı.

Uygulama, Chrome ve iki Nginx pilot süreci kapatıldı. İzole MySQL normal
SHUTDOWN ile durduruldu; logda `Shutdown complete` doğrulandı. Sentetik veri
ve pilot dosyaları inceleme için korundu. Mevcut işletme DB'sine, `.env`'ye,
Laragon'un genel yapılandırmasına veya sertifika deposuna yazılmadı.

## Kabulün sınırı

Bu, mevcut Windows/Laragon makinesinin **yerel HTTPS kabulüdür**. Gerçek alan
adı ve güvenilir CA zinciri, fiziksel Android/iPhone, Safari, Linux/Docker,
MariaDB ve üretim yükü sınanmadı. Mobil emülasyon fiziksel cihaz testi yerine
geçmez; özel test sertifikası da kamuya açık HTTPS kabulünü doğrulamaz. PNG/görsel
kabul bu pilotun kapsamına dahil değildir. Yedek–geri yükleme provası
kullanıcının talebiyle atlanmıştır. Üretim migration'ı veya dağıtımı yoktur.

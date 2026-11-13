# 5 Kasım 2026 — Yerel İstasyonOS kurulumu

Adres: `https://istasyonos-main.test`.
Mevcut Apache HTTPS proxy'sinin arkasında uygulama yalnız
`127.0.0.1:3000` üzerinde çalıştırıldı. Üretime dağıtım yapılmadı.

Kullanıcının test veritabanı onayı üzerine mevcut `.env` bağlantısı kullanıldı.
Yerel hedefin İstasyonOS adlandırmasına uyması ve bağlantıdaki DB seçimi
kontrol edildi; diğer DB'lerde sorgu veya yazma yapılmadı.

İlk migration kontrolü MISSING_CHECKSUM döndürdü. Eski şema salt okunur
incelendi: 28 uygulama tablosunda kolon, tip, nullability, tanımlı varsayılan,
anahtar ve FK'ler; slip'in Türkiye günü kolonu ve benzersiz indeksi doğrulandı.
Drizzle checksum/zamanı ve yerel migration sırası kaynakla eşleşti.
`LOCAL-TEST-20261105-SCHEMA-REVIEW` referansıyla güvenli CLI'nin açık baseline
işlemi mevcut yedi migration'ı kayda aldı. Yalnız bekleyen
`0007_request_recovery` aynı güvenli CLI ile uygulandı. Son durum: sekiz
migration uygulanmış, bekleyen yok. Geçmiş sıfırlanmadı veya kontrol atlanmadı.

`.env` içinde COOKIE_SECURE=true, BIND_HOST=127.0.0.1, PORT=3000 ve
AUTH_PROVIDER=local ayarlandı. Eksik davet anahtar halkası rastgele anahtarla
tamamlandı. DB bağlantısı ve mevcut SESSION_SECRET korundu. Önceki `.env`
kopyası yalnız `.local/local-setup/` altında tutulur; paylaşılmamalıdır.

Mevcut bir kullanıcı, bir firma alanı ve dört istasyon bulundu. Test kayıtları
silinmedi; gereksiz yeni DEMO hesabı veya seed eklenmedi.

## Çalışan süreç ve doğrulama

Codex oturumunda tsx'in Windows profil sorgusu çalışmadığı için güncel kaynak
`node scripts/verify-phase1.mjs build` ile .env okumadan derlendi. Çalışan giriş
`.local/phase1-build/index.js`; ortam NODE_ENV=production olsa da bu yalnız
yerel test build'idir, üretim dağıtımı değildir. Bu çalışma biçiminde hot reload
yoktur. Süreç kimliği `.local/local-setup/application.pid`, loglar aynı
klasörde `application.out.log` ve `application.err.log` altındadır.

- Loopback health: 200.
- HTTPS health: 200 ve no-store.
- HTTPS uygulama HTML'i: 200.
- Oturumsuz operasyon API'si: 401.
- TLS denetimi Laragon'un mevcut açık sertifikasına güvenen Node istemcisiyle
  yapıldı; sertifika doğrulaması kapatılmadı.
- Aksan Muhasebe vhost hash'i önceki değerle aynı. Apache/MySQL servisleri
  yeniden başlatılmadı, sertifikalar değiştirilmedi.

Codex içindeki Windows curl/Schannel denemesi SEC_E_NO_CREDENTIALS verdi;
Node üzerinden sertifika doğrulayan HTTPS kontrolleri başarılıdır. Bu curl
hatası nedeniyle işletim sistemi veya sertifika deposunda değişiklik yapılmadı.

Uygulama kapalıysa normal PowerShell'de proje kökünden geliştirme için:

```powershell
$env:BIND_HOST = "127.0.0.1"
$env:PORT = "3000"
$env:COOKIE_SECURE = "true"
pnpm dev
```

Mevcut süreç çalışırken ikinci sunucu başlatmayın. Bu komut başlangıçta mevcut
şemayı kontrol eder, otomatik migration uygulamaz. Şu anki yerel sunucu
tarayıcıdan kullanım için açık bırakıldı.

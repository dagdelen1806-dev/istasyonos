# İstasyonOS v2.0 — çalışan personel / muhasebe demosu

**10 Ekim 2026.** Önceki statik ekranlardan sonra, ödeme/slip/hesap teslimi akışını bir demo sunucusuna bağlayan geliştirme artışı. Gerçek pilot verisi alınmadı; bu sürüm sentetik demo. Gerçek banka, Turpak/ÖKC, OCR veya e-belge bağlantısı yok. Gerçek kişisel/banka/kart bilgisi ya da slip fotoğrafı girmeyin.

## Çalıştırma

Node 22, haricî paket gerekmez:

```bash
node server.mjs
# PORT=8766 varsayılan, 0.0.0.0
node --test tests/*.test.mjs
```

`/personel/` ve `/` çalışan hesap demosu. `/yonetim.html` önceki firma/istasyon/sipariş/raporlama HTML kopyası; onun içindeki statik veri ve rol seçicisi yeni backend'e bağlı değildir. Eski proje dosyası korunur. Bu sürüm gerçek PWA manifest/service-worker dağıtımını gerçekleştirmez; mobil tarayıcı uyumlu web demosudur. Ana ekrana kurulum/APK veya üretim yayını diye tanıtılmaz.

## 5 adımda deneme

1. **Ayşe** demo kişisini seçin, atanmış hesabını `100.00` TL float ile açın. Boş hesapta “Örnek verileri doldur” butonu.
2. **Slipler:** 3.500 ve 2.500 TL sentetik adayın alanlarını inceleyip en az 10 karakter açıklamayla teyit edin. Kart toplamı 6.000 TL olur. Gerçek fotoğraf/OCR çağrısı yok.
3. **Hesap teslimi:** sayım 3.600 TL, kaynak satış 10.000 TL, ödeme dağılımı 3.000 nakit + 6.000 kart + 700 IBAN + 300 borç. Eski cari nakit tahsilatı 500 TL ciroya eklenmez. Float 100 TL olduğu için teklif edilen son nakit 3.500 TL. Demo ara teslim/kasa çıkışı içermez.
4. **Mehmet:** muhasebe kuyruğundaki fizikî alıcı sayımını 3.500 TL olarak kabul eder; mali imza atmaz.
5. **Elif:** mali ilk imza; ardından **Zeynep:** ikinci ayrı imza. `ACCEPTED_WITH_PENDING` olur; 700 TL IBAN banka pending olarak korunur. Yeni satış/AR/banka nakdi veya istasyon kapanışı oluşmaz.

**Hata denemeleri:** mükerrer slip toplamı büyütmez; düşük güvenli tutar insan düzeltmesine gider; toplam raporu/güvensiz görüntü satış slipi sayılmaz; sayım farkı teslimi bloklar; eski sürümle imza reddedilir. Bilgi talebi sonrası personel yeni sürüm açar; eski imza geçmişte kalır ve yeni snapshot'ta sayılmaz.

**Çok terminal:** Mehmet demo kimliğinde mantıksal `pc-1`…`pc-5` bağlanır; `pc-6` reddedilir. Aynı ID iki kez sayılmaz, bırakma kontenjan açar. Bu cihaz kimlik/token/heartbeat üretimi değil, server limit kuralı demosudur. Telefon masaüstü kontenjanına dâhil değildir.

## Demo veri ve güvenlik sınırı

Demo kişisi seçici gerçek auth değildir: herkese açık rol taklidi. Sunucu kodu own-account/role/revision kurallarını DEMO aktörleri üzerinde uygular, ancak üretim kimlik güvenliği iddiası yok. Her browser workspace rastgele bearer kimlikle ayrı; sentetik veri bellek içindedir. SessionStorage sadece demo workspace/actor kimliğini tutar; gerçek ödeme verisi veya auth token yok. Sunucu yeniden başlatılırsa kayıtlar kaybolur; browser refresh aynı workspace'i sürdürür. TTL/temizlik politikası demo store içindedir, kalıcı storage yok.

API yanıtları `no-store`. Static serve allow-list; gerçek file upload/OCR yok. İdempotency server payload hash'iyle, revizyon ve snapshot kontrolleriyle uygulanır. Audit append olayları demo belleğindedir; production immutable DB garantisi değildir.

## Sonraki gerçek uygulama işleri

Gerçek kullanıcı/davet/MFA/CSRF ve tenant RLS; kalıcı PostgreSQL migration/transaction/unique; private object store ve yerel/server redaksiyon; cihaz attribution; sağlayıcı OCR adapter; Turpak/ÖKC/POS/banka yetkili bağlantıları; outbox worker/DLQ ve restore. Gerçek pilot checklist'in PASS statüsü bu demo ile otomatik tamamlanmaz.

Önceki [v1.9 mobil tasarım](../tasarim-v1.9-personel-mobil-vardiya-ocr-muhasebe.md) ve [örnek kod rehberi](../teknik-v1.9-pwa-ocr-onay-kod-rehberi.md) kapsam sınırları korunur. Önizleme geçici sandbox servisi; üretim yayını değildir.

## Bu sürümün doğrulaması

7 API test grubu ve 13 uçtan uca Chromium kontrolü geçti. 320 px/390 px mobil görünüm de denetlendi. [Detaylı sonuçlar ve test edilmeyen sınırlar](test-sonuclari.md). Fizikî teslim kabul edildikten sonra revize dosyada tutar değişmemişse aynı teslim kanıtı korunur; farklı tutar ayrı nakit düzeltme olayı gerektirir.

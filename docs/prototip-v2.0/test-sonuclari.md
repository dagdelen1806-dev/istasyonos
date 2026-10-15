# İstasyonOS v2.0 — geliştirme ve doğrulama sonucu

**10 Ekim 2026.** Son kod üzerinden doğrulandı. Yalnız sentetik veri ve geçici demo sunucusu kullanıldı; gerçek ödeme/fiş/e-belge veya dış servis işlemi yok.

## Sonuç

| Denetim | Sonuç | Kapsam |
|---|---|---|
| Node API testleri | 7 test grubu geçti, 0 başarısız | `node --test tests/*.test.mjs`; dinamik yerel portlu ayrı test sunucuları |
| Uçtan uca Chromium | 13 kontrol geçti | `python3 tests/browser-flow.py`; personel hesabı → iki slip → teslim → fizikî alıcı → iki imza |
| Ek mobil kontrol | Başarılı | 320 px hesap/slip modalında yatay taşma yok; normal hazır slip tutarı salt okunur |
| Normal mobil kontrol | Başarılı | 390 px açılış sayfası; yatay taşma yok |
| Dış önizleme | Başarılı | HTTPS `/health` ve ana sayfa doğrulandı; Manus tarayıcısında yüklendi |
| JavaScript sözdizimi | Başarılı | `server.mjs`, `public/app.mjs`; ana akışta tarayıcı JavaScript hatası yok |

## Test edilen kurallar

Minor alanları API'de kuruş tamsayı string'i, tutar girişleri ondalık string'dir. 100 TL float `10000`; 3.000 TL nakit beyanı `300000`. Ondalık virgül, sıfır ödeme beyanı ve normal hazır kaynak slipinde sessiz tutar değiştirme reddedildi.

Personel yalnız kendi hesabında yazabilir; amir/muhasebe personelin orijinal beyanını edit edemez. Aynı key+payload tekrar yanıtı mükerrer kayıt üretmez; farklı payload 409. Eski revizyon yazımı ve paralel aynı sürümle iki nakit sayım yazımından ikincisi reddedildi.

İki teyitli slip 6.000 TL; tekrar fotoğraf/aynı hazır belge toplamı büyütmez. Rapor/güvensiz belge teyit kapısı dışında; düşük güvenli tutar insan kontrolüyle düzeltilir. Toplam ödeme kaynakla eşit olsa dahi POS kart kaynak tutarı farklıysa teslim bloklanır.

Sayım `float 100 + nakit satış 3.000 + eski tahsilat 500 = 3.600 TL`. Eski tahsilat yeni satıştan ayrıdır. Float sonrası teklif 3.500 TL; fizikî nakit alıcısı Mehmet, mali ilk imza Elif, ikinci imza Zeynep. İlk imza pending kalır; iki imza sonrası 700 TL IBAN `pending` kalmaya devam eder. Muhasebe kabulü satış/AR/banka/fiscal post ya da istasyon kapanışı üretmez.

Bilgi talebi → yeni revision → tekrar teslim sırasında eski imza geçmişte korunur ve yeni snapshot'ta sayılmaz. Önceden kabul edilmiş, tutarı değişmeyen fizikî nakit yeni teslimde korunur; ikinci kez para teslimi istenmez. Fizikî tutar değişmişse ayrı düzeltme olayı gerektiği için yeni teslim bloklanır.

Beş mantıksal masaüstü lease kabul edildi; aynı ID ikinci kez kontenjan tüketmedi, altıncı reddedildi, release sonrası kontenjan açıldı. Gerçek telefon kaydı veya beş fizikî cihazda saha testi yapılmadı.

## İncelemede düzeltilen somut sorunlar

İlk bootstrap'ta boş workspace header gönderimi; minor/ondalık serileştirme uyuşmazlığı; yöneticinin own-account dışı edit yapabilmesi; normal slipte uygulanmayan tutar edit'i; POS kart farkının toplam eşitliğiyle gizlenmesi; revize teslimde ikinci fizikî nakit teklifi; rol değişiminde eski ekranın hata durumunda kalması; belirsiz ağ yanıtı sonrasında yeni olay oluşturma riski; dar ekranda para kartı taşması düzeltildi.

## Test edilmeyenler ve kalan işler

Bu sonuç gerçek kullanıcı auth/MFA/CSRF/tenant RLS, PostgreSQL kalıcılık/restore, private görsel upload/redaksiyon, OCR motor doğruluğu, bankanın POS valör/komisyonu, Turpak/ÖKC adapter veya gerçek telefonda PWA kurulum/offline güvenliği kanıtı değildir. Ağ belirsizliği için UI'de aynı key ile manuel tekrar ve yeni mutasyon kilidi var; gerçek mobil ağ/worker dayanıklılık testi yapılmadı. Borçlu kişi/kredi limiti/cari ledger post'u demo beyan formuna henüz bağlanmadı. Ara teslim, iadeler, banka eşleme ve nakit düzeltme hareketlerinin çalışan UI'si sonraki fazdır.

V1.9 pilotun 46 maddelik checklist'inin PASS durumunu bu demo otomatik değiştirmez. Gerçek kasa/banka/POS verileri hâlâ kullanıcıdan bekleniyor; gerçek likidite sonucu üretilmedi. Yeni personel demosu ile eski firma/finans HTML sayfası gezinmeyle entegredir, aynı finans veritabanını paylaşmaz.

## Tekrar deneme

```bash
node server.mjs
# İkinci terminal:
node --test tests/*.test.mjs
python3 tests/browser-flow.py
```

Tarayıcı testi için Python Playwright + Chromium gerekir. API testleri Node 22 dışında paket gerektirmez. Çalıştırma ve deneme adımları [README](README.md) içinde.

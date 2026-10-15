# İstasyonOS v2.0 — personel hesap teslimi çalışan demo

10 Ekim 2026; önceki v1.7 HTML ve v1.9 domain kuralları korunur. Bu artış sentetik operasyon demosudur, üretim ERP veya canlı API değildir.

## Uygulama

Node 22 bağımlılıksız HTTP sunucusu, bellek içi workspace başına izolasyon; server'da revizyon/hash/idempotency ve rol kapıları. Kimlik seçici DEMO aktörüdür, gerçek kimlik doğrulama değildir. Her tarayıcı çalışma alanı ayrı ve süreli; kişisel/veri/fotoğraf kabulü yok. Gerçek auth, kalıcı DB ve OCR adapter daha sonraki yetkili fazdır.

Personel atanmış vardiyasını açar, nakit/IBAN/borç/eski cari tahsilatı girer, hazır sentetik slipleri ekleyip alanları doğrular. Slip fotoğrafı yükleme butonu gerçek görsel almaz; örnek OCR sonuçları açık etiketlidir. Nakit sayımı ve eski tahsilat yeni satıştan ayrı. Personel teslim snapshot'ı sonrası form kilitli; muhasebe bilgi isterse yeni revision, eski imzalar eski snapshot'ta kalır. Fizikî alıcı nakit teklifi/sayımını ayrı kabul eder. Muhasebe/firma finans yetkilisi iki farklı gerçek DEMO kişiyle imzalar; ilk imza pending, pending IBAN kesin tahsilat değildir. Beş mantıksal masaüstü lease demoda sayılır; gerçek cihaz kaydı değildir.

`public/yonetim.html` önceki firma/istasyon/finans modüllerini korur; bu sayfadaki eski veriler yeni hesap demosuna bağlı değildir. Ortak üst link ile iki bölüm arasında geçiş sağlanır. Başlangıç `/`, personel/hesap ekranı `/personel/`, yönetim `/yonetim.html`; service worker kurulu değil.

## Yapı

- `server.mjs`: HTTP/static API, güvenli boyut sınırları, demo workspace ve aksiyonlar.
- `domain.mjs`: v1.9'dan alınan para/OCR/onay saf domain modülü.
- `public/index.html`, `app.css`, `app.mjs`: masaüstü ve mobil personel/muhasebe arayüzü.
- `public/yonetim.html`: önceki tasarım kopyası, değişiklikler ayrı korunur.
- `tests/`: bağımsız API ve tarayıcı örnek testleri.

## Tasarım

Kurumsal operasyon konsolu: koyu arduvaz başlık, teal doğrulanmış adım, amber pending, kırmızı gerçek demo bloklayıcı; durum metni renge eşlik eder. Ekranın solunda rol/işlem izi, sağında özet ve form; mobilde tek sütun ve sabit alt gezinme. Gereksiz fotoğraf/illüstrasyon yok. Sistem fontu; rakamlar tabular, tutar string/kuruş modelinde. Yalnız odak ve kısa durum geçişi, dikkat dağıtan animasyon yok. İstasyonOS: saha hesabını izlenebilir kanıtla mali incelemeye bağlayan araç; net, denetlenebilir, sakin. Mevcut geometrik istasyon işareti/teal renk korunur. CTA örnekleri: “Hesabımı aç”, “Güncel sürümü incele”.

# Raporlar: kasa/kasiyer filtreleri ve sepet iptal denetimi

24 Ekim 2026. [İlk raporlar teslimi](market-raporlar-merkezi-2026-10-24.md) üzerine eklenmiştir. Güncel kaynak GitHub main dalıdır. Bu geliştirmede bulut ortamı ayar taslağı değiştirilmez; kaynak kod ve rehber GitHub'a kaydedilir.

## Kasa ve satış kullanıcısı filtresi

**Raporlar → Satış özeti / Ürün kârlılığı** ekranında **Kasa** ve **Satışı yapan** seçilebilir. İkisi birlikte seçilirse kesişimleri alınır. Dropdown değişikliği, **Raporu getir / yenile** veya tarih kısayoluna basılana kadar bekler. Ekranda uygulanan kapsam ayrıca yazılır. CSV bekleyen seçimi değil, raporun uygulanan kasa/kullanıcı kimliklerini taşır.

Satış kullanıcısı gerçek satış kaydındaki kullanıcıdır; kasa adları ve kullanıcı görünen adları güncel kayıttır. Kasa oturumu sahibi ile satış cihazını karıştırmayın. Mevcut aynı kullanıcının başka cihazdan kendi kasasına katılma kuralı korunur; farklı kullanıcı kendi oturumunu kullanır.

Satış iadeleri **özgün satışın kasası/kullanıcısına** bağlanır. İadeyi muhasebeci yapmış olsa da satışın performansı bu şekilde düzeltilir. İade yine kendi kayıtlı iş gününde düşer. Kasa/kullanıcı filtresi dönem toplamı, önceki eşit dönem, ödeme payları, fişler ve ürün raporuna birlikte uygulanır. Satış fişi satırlarıyla ödeme veya çoklu iadeler JOIN ile çoğaltılmaz. Yeni kayıtlar için yenileme gerekir; eski `asOf` sınırı korunur.

Filtre varken kapsam yalnız satış ve satış iadesidir. Genel işletme gideri, banka komisyonu ve stok/kasa farkı belirli kasiyere tahminen dağıtılmaz. Bu yüzden gider/kazanç/faaliyet sonucu kartları gizlenir; brüt kâr ve önceki döneme brüt kâr farkı görünür. Filtre yokken istasyonun mevcut faaliyet sonucu hesabı aynen sürer. API'deki `salesOnly=true`, filtreli mali alanların yalnız satış/iade kapsamını temsil ettiğini belirtir; istasyonun bütün giderlerinin sıfır olduğu anlamına gelmez.

Filtre seçenekleri yalnız yetkili istasyonun kasaları ve o istasyonda kayıtlı satış/sepet olayı bulunan kişilerdir. Başka istasyonun kasa kimliği, geçersiz kullanıcı veya istasyonda rapor kaydı olmayan kullanıcı kabul edilmez. Tarihsel kategori, ürün seçimi, saat filtresi ve çok istasyon konsolidasyonu bu teslimde eklenmedi.

## Sepet iptal denetimi

**Raporlar → Sepet iptal denetimi** yeni sekmesidir. Başlangıç/bitiş, kasa ve **İptali yapan** filtresi vardır. Buradaki kişi olay aktörüdür; satış filtresindeki özgün satış kullanıcısı kavramından farklıdır. En fazla 366 günlük aralık ve filtrelenmiş kapsamda 5.000 iptal/azaltma olayı desteklenir. Limit aşılırsa rapor kesilerek gösterilmez; aralığı daraltmanızı isteyen hata döner.

Yalnız kalıcı sepet geçmişindeki **REDUCE** (adet/satır azaltma) ve **CANCEL** (bütün sepet iptali) olayları gösterilir. Ekleme, fiyat yenileme, bekletme/çağırma ve satış tamamlama olayları bu toplama dahil değildir. Satış sonrası iade ayrı rapordadır. Açıklama, kişi, kasa, cihaz, olay zamanı, sepet kimliği ve sürümü saklanan kayıttan gösterilir. Eski açıklama yoksa eksik olduğu açıkça yazılır.

Olay ayrıntısı özgün önce/sonra snapshotlarını karşılaştırır: ürünün olay anındaki adı/barkodu, önce/sonra miktar, çıkarılan miktar, kayıtlı birim fiyat ve çıkarılan tutar. Sonradan değişmiş ürün fiyatı kullanılmaz. Azaltma ardından bütün sepet iptali olursa her olay yalnız kendi çıkardığı miktarı sayar; ilk sepetin tamamı tekrar eklenmez. Boş sepet iptali sıfır tutarlı ayrı olay olarak görülebilir. Temel birim/tartım bilgisi olay snapshotında ayrıca bulunmadığından miktarlar kayıtlı sepet miktarıdır; kesirli terazi desteği iddiası yoktur.

Çıkarılan kayıtlı tutar **gerçekleşmiş satış, kesin ciro kaybı, muhasebe gideri veya stok hareketi değildir**. Sepet henüz satılmamıştır. Sıfır fiyatlı satır iptali miktar içerip sıfır tutarlı olabilir. Bozuk JSON, tekrarlı ürün, eklenmiş ürün, artan miktar veya sessiz fiyat/ad değişimi gibi tutarsız snapshot 409 ile reddedilir; güncel karttan tahminle tamamlanmaz. Bu rapor dolandırıcılık tespiti veya hukuki hüküm üretmez.

Özet kartları bütün filtreli dönemde olay/azaltma/bütün sepet iptali sayısını ve çıkarılan kayıtlı tutarı gösterir. Tablo ve CSV 50 olaylık sayfalardır. Ayrıntı yalnız seçilen sayfanın kaydıdır; filtre/sayfa değişince temizlenir. İstanbul saatinde olay anı gösterilir; CSV zaman başlığı açıkça UTC'dir. Kişi/kasa adları güncel, ürün ayrıntısı olay snapshotıdır.

## 0020 göçü ve kayıt sınırı

`0020_cart_event_sequence` mevcut `st_pos_cart_events` tablosuna otomatik artan, tekil `seq` ekler. Önceki olay kimlikleri, kaynak sepetleri ve snapshotları korunur; mevcut yazıcılar açık sütun listesiyle çalışmaya devam eder. Eski olaylara eklenen sıra tarihî kronoloji iddiası taşımaz. Görünüm tarih ve UUID ile sıralanır; `seq` yeni olayların eski rapora karışmasını engelleyen kayıt sınırıdır.

İlk istekte istasyonun görülebilen en son olay sırası `asOf` olarak alınır. Sonraki sayfalar bu sınırda kalır. Aynı milisaniyede oluşturulan farklı UUID'ler güvenli tarih/kimlik imleciyle sayfalanır; daha sonra kaydedilmiş olayın saati aynı bile olsa daha büyük seq onu eski rapordan dışlar. Sıra BIGINT metnidir; Number'a çevrilmez. Bu, DB yöneticisinin geçmiş kaydı değiştirmesine karşı sertifikalı değişmez arşiv değildir.

Yetkiler OWNER/MANAGER/ACCOUNTANT; bütün seçenek/toplam/liste/ayrıntı ve CSV kaynağı tenant/istasyon kapsamında kalır. Personel erişemez. Yeni rapor GET işlemleri stok, değer, mali defter/bakiye/revizyon veya kapanış yazmaz. Kapalı günlerde okunabilir. İptal işleminin kendisi mevcut sepet kurallarını ve aynı istek kimliğiyle tek etkiyi kullanır; mali yazma yolu eklenmedi.

API ekleri: `GET /api/stationos/market-accounting/reports/options`, `GET .../reports/cancellations`. Satış/ürün isteklerine isteğe bağlı `registerId`, `userId` eklendi. İptalde `userId` olay aktörüdür; satış/üründe özgün satış kullanıcısıdır. İptal CSV'si bu sayfadır; bütün dönemin otomatik XLSX/PDF veya e-posta gönderimi yoktur. Büyük saha verisinde sorgu planı/yük testi ayrıca yapılmalıdır; pilot sınırları üretim performans garantisi değildir.

## Windows / Laragon güncellemesi

Proje/DB yedeğini alın, eski `pnpm dev` işlemini durdurun. `.env` dosyanızı koruyarak GitHub main kaynaklarını güncelleyin:

```powershell
pnpm install --frozen-lockfile
pnpm tsx server/stationos/migrate.ts
pnpm dev
```

Bu teslim **0020 göçünü gerektirir**. Yeni/boş DB için ilk `pnpm db:migrate` ayrıca gerekir. Menüden **Raporlar** veya mevcut sunucunuzda `/raporlar` açılır. Kodların GitHub'a aktarılması Windows dosyalarını otomatik değiştirmez. POS DEMO, ortak sunucu/LAN ve mali cihaz/banka entegrasyonu sınırları sürer.

## Doğrulama

24 Ekim: 20 dosyada **112 test**, TypeScript ve üretim build başarılı. On yeni test iptal farkı/özgün fiyat, tekrarlı azaltma ve final iptalde çift saymama, boş/sıfır fiyatlı iptal, sahte/artmış/yeniden fiyatlanmış/bozuk/taşan snapshot, tarih/UUID imleci ve filtre girdi sınırlarını kapsar.

0020 mevcut verili ayrı test ve ana bulut geliştirme DB'sine uygulandı; tekrar çalıştırma no-op. Ana salt okunur tanı HTTP/HTML/JS/401/SELECT 1/kullanıcı şeması ve 20 göçle geçti. Bu runtime hazırlığı bulut ayar taslağını veya ortam yayınını değiştirmez.

Mevcut satış/ürün raporu HTTP paketi geliştirme ve son üretimde açık DEMO fixture üretmek için geçti (`SMOKE_LEAVE_OPEN=1` kapanış adımını atlar). `scripts/smoke-report-controls.ts` aynı yeni fixture üzerinde iki modda geçti: kasa/kişi/kesişim/filtreli ürünler; muhasebecinin iadesinin özgün satış sahibine etkisi; giderlerin kasiyere dağıtılmaması; 52 iptal, zorlanmış aynı milisaniyede 50+2 sayfa, yeni 53. olayın eski seq sınırına girmemesi, açıklama/snapshot, aynı-ID tek olay, bozuk snapshot reddi, rol/tenant/yabancı kasa/kullanıcı/imleç ve kapalı gün değişmezliği. Kontrol scripti yalnız açık `SMOKE_TEST=1`, loopback ve tam `istasyonos_pos_v2_test` socket DB'de çalışır; açık ilk rapor fixture'ı `SMOKE_REPORT_FIXTURE` ile verilir. Tarih/bozuk JSON fixture denemeleri gerçek DB'de çalıştırılmaz. Bozuk JSON aslına geri döndürülür; tarih zorlaması sadece sentetik DEMO olaylarında kalır. Bu kontrol paketi kasa ve günü kapatır.

Chromium geliştirme ve son üretimde masaüstü sahip, 390 px yönetici ve engellenen personel: kasa/kişi/kesişim filtreleri, filtreli ürün/iadeli marj, gider/faaliyet kartlarının gizlenmesi, bekleyen seçimde CSV'nin uygulanmış kapsamı koruması, 53 iptal 50+3 sayfa, önce/sonra açıklama/cihaz ayrıntısı ve CSV, filtre değişince eski ayrıntının temizlenmesi doğrulandı. JS hatası, haricî HTTP ve mobil taşma yoktu; mali bakiyeler/kapanışlar değişmedi. Fizikî Windows/MySQL 8/yük testi bu teslimde yapılmadı. Özel erişim/fixture/CSV/görseller Git dışında `/workspace/report-controls-test` altında tutulur; kullanıcı fiyat listesi eklenmedi.

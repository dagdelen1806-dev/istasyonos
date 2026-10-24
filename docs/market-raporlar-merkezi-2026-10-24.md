# Market Raporlar merkezi — ilk teslim, 24 Ekim 2026

İhtiyaç planı: [Raporlar planı](market-raporlar-plani-2026-10-24.md). Bu teslim **Raporlar** menüsüne (`/raporlar`) tarihli satış özeti, ödeme dağılımı, fiş ayrıntısı ve sayfalı ürün kârlılığı ekler. Mevcut aylık kâr–zarar ve terminal sayım raporları aynı bileşenlerle bu merkezden açılır; eski muhasebe ekranındaki erişimleri sürer. Yeni SQL migration veya bağımlılık yoktur; mevcut 0019 dahil kurulu şema kullanılır.

## Kullanım ve kapsam

Firma sahibi, yönetici ve muhasebeci yetkili istasyonu seçerek Raporlar'a girer. Personel menüyü veya doğrudan rapor API'sini kullanamaz. Her toplam, liste, ürün ve fiş ayrıntısı isteği sunucuda şirket/istasyon ve rol kontrolünden geçer.

**Satış özeti**: Başlangıç/bitiş tarihini seçip **Raporu getir / yenile** kullanın. Bugün, Dün, Bu ay kısayolları vardır. En fazla 366 günlük aralık kabul edilir. Tarih alanında değişiklik rapor getirilene kadar mevcut raporu değiştirmez; raporun uygulanan tarihleri üstte görünür.

Üst kartlar bütün dönem için KDV dahil satış, satış iadesi, iade sonrası net ciro, KDV hariç net satış, satılan mal maliyeti, brüt kâr, gider/kayıplar, kazançlar ve faaliyet sonucunu gösterir. Satış fişi adedi, ortalama satış fişi, brüt marj ve önceki eşit uzunluktaki dönem bilgisi eklenmiştir. Ortalama fiş, iadeler düşülmeden satış toplamı / tamamlanmış satış fişi adedidir; iade fişi satış sayısına katılmaz. Boş dönemde ortalama, sıfır/negatif net satışta brüt marj hesaplanamaz olarak gösterilir.

Faaliyet sonucu mevcut mali hesaplardan gelir; bütün kurumlar vergisi, amortisman, finansman ve ortak giderleri kapsayan net kâr değildir. Önceki dönem aynı gün sayısını kullanır; ilk günün hemen öncesinde biter. Defterin başlangıcı ve seçilen dönemde kaç gün sonu kaydı bulunduğu gösterilir. Açık günler değişebilir. Defter açılmadan önceki bağımsız POS satışları bu raporda yer almaz.

**Ödeme dağılımı** yalnız bu dönemin satış fişlerindeki nakit, kart ve veresiye paylarını toplar. Karma fiş bir kez satış sayılır; payları kendi sütununa gider. Para üstü satış değildir. Sonraki müşteri tahsilatı satışa eklenmez; banka/merkez kasa transferi gelir sayılmaz. Kart payı manuel beyan edilmiş kart alacağıdır, banka bakiyesi değildir.

**İadeler** kaydedildikleri mali iş gününde düşülür; eski kaynak satışın gününü değiştirmez. Dönem iade toplamı ve para iadesinin merkez kasa/banka dağılımı ile cari mahsup ayrı gösterilir. İade tutarını eski satışın ödeme yöntemine tahminen paylaştırmayız.

## Fiş ve ürün ayrıntıları

Fiş listesi 50 satırlık sayfalar kullanır. Sıra, iş günü, İstanbul saatinde kayıt anı, güncel kasa adı, gerçek satışı yapan kişinin güncel adı, brüt tutar ve ödeme payları görünür. **Fişi incele** özgün satış satırlarını açar: satış anındaki ürün adı/barkod/adet/fiyat, net/KDV/brüt ve maliyet. Güncel ürün kartı/fiyatından geçmiş fiş yeniden hesaplanmaz. Kasa oturumu ve kaynak cihaz kimliği de görünür. Kullanıcının başka cihazdan kendi kasasına katılma kuralı değişmedi; farklı kullanıcı kendi kasa oturumunu kullanır.

Fişin iade geçmişi, rapor kayıt sınırına kadar kaynak fişe bağlı bütün iadeleri gösterir; seçilen tarih aralığıyla sınırlı değildir. Tarihler açıkça yazılır. Fiş ve satır tutarları/ödeme payları ile kaynak mali defter uyuşmazsa 409 döner; güncel maliyetten tahmin yapılmaz. Bu ayrıntı resmî mali fiş veya banka teyidi değildir.

**Ürün kârlılığı** 50 satırlık ürün kimliği sırasıyla sayfalanır; en kârlı ilk 50 sıralaması değildir. Bütün ürünlere sonraki sayfayla ulaşılır. Satış ve iade adetleri ayrı, net satış/maliyet/kâr ise dönem etkileriyle gösterilir. Ürün adı/barkodu açıkça güncel karttır; satırların mali tutarları satış/iade anında kaydedilmiştir. Dönem üst toplamı bütün ürünleri, tablo yalnız bu sayfayı kapsar. İşletme giderleri ürünlere tahminen dağıtılmaz. Eksik maliyet/net satış snapshotı olan ürün sayfası hesaplanmaz. Kategori/tarihsel kategori filtresi henüz yoktur.

## Kayıt sınırı, geçmiş ve CSV

Her ilk raporda istasyonun o anda görülebilen en son mali kayıt sırası `asOf` olarak alınır. Bütün dönem toplamı, önceki dönem, fiş sayfalaması, ürün satırları ve ayrıntı iade geçmişi bu sırayı aşmaz. Arada yeni satış/iade/gider gelirse mevcut sayfalar eski kayıt sınırında kalır; **Raporu getir / yenile** yeni sınırı alır. Sıra BIGINT metnidir; JS Number'a çevrilip hassasiyet kaybedilmez. Bu, DB yöneticisinin tarihsel veriyi değiştirmesine karşı sertifikalı arşiv veya kalıcı rapor snapshotı değildir. Ad/kart etiketleri ve gün sonu durum sayısı güncel kayıttır.

Fiş ve ürün CSV düğmeleri **yalnız bu sayfayı** indirir. Dosyada dönem/kayıt sınırı ve birimi başlıkta belirtilmiş integer kuruş alanları bulunur; metin hücreleri formül çalıştırmaya karşı mevcut CSV korumasını kullanır. Bütün dönem toplamı 50 satırlık CSV toplamıymış gibi sunulmaz. Gerçek XLSX ve rapor PDF şablonu bu teslimde eklenmedi. Raf etiketi PDF özelliği ayrı kalır.

Yeni GET uçları salt okunurdur:

- `/api/stationos/market-accounting/reports/sales?stationId=...&from=...&to=...` — dönem/önceki dönem, ödemeler ve fiş sayfası. Sonraki sayfa `asOf` ve `cursor` ister.
- `/api/stationos/market-accounting/reports/sales/products?stationId=...&from=...&to=...&asOf=...` — ürün sayfası; sonraki `cursor` ürün kimliğidir.
- `/api/stationos/market-accounting/reports/sales/:saleId?stationId=...&asOf=...` — kapsamlı kaynak fiş ayrıntısı.

Toplamlar, satış/ödeme, iade ve mali defter kendi kayıt düzeylerinde ayrı sorgulanır. Çok satırlı satış, karma ödeme ve çoklu iade JOIN ile çoğaltılmaz. Mali gün kayıtlı `business_date`, gösterilen zaman Europe/Istanbul'dur. Yeni sorgular mevcut istasyon/tarih/sıra ve kaynak/fiş bağlantısı indekslerini kullanır; büyük saha verisinde sorgu planı/yanıt süresi ayrıca ölçülmelidir. Mevcut test hacmi üretim performans garantisi değildir.

## Sonraki teslimler

Planın kategori/saat/kasa/kasiyer filtreleri, iptal denetim raporu, stok değerleme/devir/hareketsiz raporları, cari yaşlandırma ve nakit akışı/KDV/gün sonu birleşik raporları henüz bu merkeze eklenmedi. Mevcut operasyon ekranları çalışmaya devam eder. Tarihsel stok ve cari yaşlandırma için gereken hareket/snapshot kapsamı doğrulanmadan geçmiş değer üretilmeyecek. Çok istasyon konsolidasyonu ve otomatik rapor gönderimi yoktur.

## Windows güncellemesi

Proje ve DB yedeğini alın, eski `pnpm dev` işlemini durdurun. Kendi `.env` dosyanızı koruyarak GitHub main kaynaklarını güncelleyin:

```powershell
pnpm install --frozen-lockfile
pnpm tsx server/stationos/migrate.ts
pnpm dev
```

Bu teslim yeni göç eklemez; migration komutu önceki 0019 dahil eksikleri tamamlar. Yeni/boş DB ayrıca `pnpm db:migrate` ister. Menüden **Raporlar** veya `http://localhost:3000/raporlar` açılır. Laragon alan adı proxy ayarınıza bağlıdır. Bulut kodlaması Windows dosyalarını otomatik güncellemez. POS DEMO ve erişilebilir ortak sunucu/LAN sınırı sürer.

## Doğrulama

24 Ekim 2026: 19 dosyada **102 test**, TypeScript ve üretim derlemesi başarılı. Sekiz yeni alan testi karma ödeme/iade ve mali hesap, boş/yalnız iade dönemi, kayıt uyuşmazlığı, güvenli kuruş sınırı/ortalama yuvarlama, eşit önceki dönem/artık gün, geçersiz aralık, BIGINT sıra ve mali fiş ayrıntısı tutarlılığını kapsar.

`scripts/smoke-market-reports.ts` geliştirme 3303 ve son derlenmiş üretim 3304 üzerinde geçti. Koruma: açık `SMOKE_TEST=1`, yalnız loopback ve tam `istasyonos_pos_v2_test` socket DB. Sentetik DEMO 52 fiş/52 ürün, çok satırlı satış, farklı kullanıcının kendi kasasında karma ödeme, veresiye ve sonraki tahsilat, kısmi iade, gider ve dönem mali mutabakatı doğrulandı. 50+2 fiş/ürün sayfası, yeni satış sonrası eski kayıt sınırında sabit toplam/yenilemede 53 fiş, farklı güne kaydırılan kaynak satıştan bağımsız iade günü, güncel kart/fiyat değişiminde snapshot, tutarsız maliyet reddi, rol/tenant/401/tarih/imleç ve kapalı gün GET sonrası değişmeyen stok/bakiye/revizyon/kapanış geçti. Fixture-only tarih/bozuk maliyet değişimleri izole DEMO DB'de uygulanıp geri alındı; gerçek DB'de çalıştırılmamalı. `SMOKE_LEAVE_OPEN=1` kapanış bölümünü atlar ve kapanış kanıtı sayılmaz.

Geliştirme ve üretimde Chromium masaüstü yetkili, 390 px yönetici ve erişimi olmayan personel oturumları geçti: menü/filtre/fiş/iade, 50+3 güncel fiş ve 50+2 ürün sayfalama, CSV kapsamı, boş/geçersiz dönem, filtre değişince geç yanıtın ayrıntıyı geri açmaması, mevcut aylık/sayım bileşenleri. JS hatası, haricî HTTP veya mobil yatay taşma yoktu; mali kayıtlar değişmedi. Mevcut stok/barkod/terminal/fiyat/sayım/aylık mutabakat HTTP paketi de son üretimde geçti.

Önceki smoke hazırlığında mevcut kasa sahipliği/temel birim/devir teyidi kurallarına uymayan test girdileri düzeltildi; uygulama korumaları gevşetilmedi. Test sonuçları, DEMO erişimleri ve ekran görüntüleri Git dışında `/workspace/market-report-test` altında tutulur. Fizikî Windows/MySQL 8/cihaz saha kabulü veya üretim yük testi yapılmadı.

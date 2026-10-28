# SKT, karantina ve fire kontrol paneli — 28 Ekim 2026

**Raporlar → SKT / fire kontrolü** iki ayrı görünüm sunar: **Güncel SKT ve karantina**, **Kayıtlı fire ve sayım farkları**. Mevcut Lot/SKT ve el terminali işlem ekranları korunur. Bu teslim salt okunur rapor ekler; yeni SQL migration/bağımlılık yoktur, önceki **0021 dahil şema** gerekir. Kaynak GitHub main dalıdır; bulut ayar taslağı değiştirilmez.

## Güncel SKT ve karantina

Yalnız parti takibi açık ürünlerin **pozitif miktarlı güncel partileri** gösterilir. Sıfır miktarlı eski partiler uyarı listesine katılmaz; geçmiş fişleri yine tarih raporunda bulunabilir. Her takipli ürünün fizikî kart miktarı, mali stok miktarı ve pozitif parti toplamı mutabık olmalıdır. Uyuşmazlıkta rapor 409 verir, eksik partiyi tahminen oluşturmaz.

Kartlar bütün yetkili istasyondaki stoklu partiler için toplam parti ve ayrı ürün sayısını, 7/15/30 gün içinde SKT'si dolacak satışa açık partileri, geçmiş SKT, karantina, bilinmeyen SKT ve satışa kapalı parti sayısını gösterir. Bunlar **parti sayılarıdır**; farklı temel birimlerdeki miktarlar tek adet toplamına dönüştürülmez. Risk maliyeti tahminen partilere dağıtılmaz; mevcut maliyet yöntemi ürün düzeyindedir.

- Yaklaşan SKT: AVAILABLE, SKT bugünden önce değil ve seçilen gün sonuna kadar (dahil). **Bugün** dolan parti geçmiş sayılmaz.
- Geçmiş SKT: SKT bugünden küçük, durumundan bağımsız.
- Karantina: QUARANTINE, SKT'den bağımsız.
- Bilinmeyen SKT: tarih yok. Satışa açık durum yazıyor olsa bile satılabilir kabul edilmez.
- Satışa kapalı: karantina veya bilinmeyen/geçmiş tarih nedeniyle satılabilir olmayan parti.

Kümeler çakışabilir; örneğin geçmiş SKT'li karantina iki kartta da bulunur. 7/15/30 kümeleri iç içedir. Kart sayılarını birbirine ekleyip toplam stoklu parti sayısı üretmeyin.

Durum, 7/15/30 gün ufku, takipli ürün ve ürün adı/barkod/parti kodu araması **Parti kontrolünü getir / yenile** ile uygulanır. Ufuk yalnız yaklaşan SKT görünümünü daraltır. Üst kartlar bütün istasyonu, eşleşen sayı seçilen filtreyi, tablo/CSV bu 50 satırlık sayfayı kapsar. Partiler SKT ve kimlik sırasındadır; bilinmeyen tarih en sondadır. En fazla 5.000 takipli ürün ve 10.000 pozitif parti desteklenir; sınır aşılırsa veri kesilmez, hata döner.

Tabloda güncel ürün/barkod/parti etiketi, SKT/kalan gün, miktar/temel birim, durum ve satılabilirlik gösterilir. Varsa **son STATUS olayının** açıklaması, kaydeden kişi ve İstanbul saatinde zamanı görünür. Bu, sonraki fizikî koşulları kanıtlamaz. İlk kabul/iade sırasında karantinaya girip sonradan ayrı durum değişikliği yapılmamış olabilir; açıklama yoksa yok olduğu belirtilir, neden uydurulmaz. Kaynak işlemi mevcut Lot/SKT ekranında inceleyin.

Bu güncel durum raporudur. Geçmiş tarihin SKT/karantina görüntüsü veya fizikî stok kabulü değildir. Sayfa devamı görüntü kimliği taşır; ilgili ürün/parti/durum/miktar veya defter revizyonu/gün değişirse eski sayfaya devam etmek yerine **ilk sayfadan yenileme** istenir. Hash kalıcı veya sertifikalı bir arşiv değildir.

## Kayıtlı fire ve sayım farkları

Tarih aralığı (en fazla 366 gün), tür ve ürün filtresi vardır. Dört mali kaynak kapsanır:

| Kayıt | Gösterim | Mali anlam |
|---|---|---|
| LOT_WRITE_OFF | Parti firesi | Kayıtlı STOCK_LOSS maliyeti |
| LOT_COUNT | Parti sayımı | Fazla/eksik stokun kayıtlı değeri |
| STOCK_ADJUST | Masaüstü stok sayımı | Takipsiz ürün sayım farkı |
| STOCK_COUNT | Terminal sayımı | Onaylanmış terminal ürün/parti sayımı |

Açık/cancel taslaklar, mal kabul ve satış/iade normal stok hareketleri bu kayıp raporuna eklenmez. Güncel SKT uyarısı da gerçekleşmiş fire değildir. **Fiş sayısı** ile **ürün satırı** ayrıdır; çok ürünlü terminal sayımı bir fiş, birden çok ürün satırıdır. Farksız veya sıfır maliyetli kayıtlar varsa görünür; sıfır tutar kayıt yok demek değildir.

Tutarlar gerçek mali fişin STOCK_GAIN/STOCK_LOSS satırlarıyla mutabakatı yapılan tarihsel payload'dan okunur. Önce/sonra miktarı, fark, açıklama, mali iş günü ve fişi kaydeden/onaylayan kullanıcı gösterilir. Bu kişi, terminalde fizikî sayımı yapan kişiyle aynı olmak zorunda değildir; kolektörün ayrıntılı izi mevcut Sayım raporları ekranında sürer. Güncel alış fiyatı veya stoktan geçmiş maliyet yeniden hesaplanmaz.

Ürün filtresi mali tutarı **ürün satırına** göre daraltır. Bir terminal fişinde A ürünü −500, B ürünü +50 ise yalnız A seçildiğinde fişin B fazlası toplamınıza katılmaz. Fişin tamamı doğrulanır, sonra ürün filtresi uygulanır. Net miktarı sıfır olan çok partili sayımda bile ayrı gain/loss korunur; birbirinden mahsup edilip gizlenmez.

Parti ayrıntısında kimlik, etiket, önce/sonra ve fark miktarı görünür. Çok partili sayımın maliyeti ürün düzeyinde olduğundan **parti miktarlarına tahminen bölünmez**. Bu nedenle mali geçmişte ayrı bir lot filtresi yoktur; lot seçimi güncel görünümde, kaynak lotlar ise fiş ayrıntısındadır. Ürün maliyeti CSV'de bir kez yazılır, parti kimlikleri ayrı metin sütununda listelenir.

### Tarihsel ve güncel etiketler

Yeni terminal sayımlarının mevcut snapshot etiketleri kullanılır. Eski terminal kayıtlarında ve doğrudan parti/masaüstü sayımı/fire payload'ında ad/barkod/birim veya parti kodu/SKT/durum saklanmamış olabilir. Bu durumda **Güncel kart etiketi / Güncel etiket** veya bulunamıyorsa kimlik gösterilir. Geçmiş ad, SKT ve durum tahmin edilmez. Eski kaydın miktarı/maliyeti hâlâ tarihsel kayıttandır; güncel etikette görünen SKT/durum işlem gününe aitmiş gibi okunmamalıdır.

Bozuk veya mali tutarla uyuşmayan payload 409 verir; başka fişten veya güncel maliyetten tamamlanmaz. Eski terminal payload sürümü desteklenir. Ürün/parti adını sonradan değiştirmek geçmiş miktar ve maliyetleri değiştirmez; etiketi güncel olan satırda bu açıkça işaretlenir.

### Kapsam, sayfalama ve CSV

Üst kartlar bütün filtreli dönemin fiş/ürün satırını, fire maliyetini, sayım eksiği ve fazlasını ayrı gösterir. Tablo/CSV yalnız 50 ürün satırlık bu sayfadır. Fiş sıra numarası kesin BIGINT metnidir; sıralama fiş sırası azalan ve aynı fişte ürün kimliği artandır. Sayfa imleci ikisini taşır; bir fişin ürünleri sayfa sınırına geldiğinde kaybolmaz veya yinelenmez.

İlk raporun mali kayıt sınırı `asOf` korunur; sonraki fire/sayım eski sayfaların toplamına girmez. Yenileme yeni kayıtları alır. Maksimum sınır, ürün filtresi uygulanmadan önce tarih/tür kapsamında 1.000 fiş ve toplam 20.000 ürün satırıdır; aşılırsa tarih aralığını daraltın. Etiketlerin güncel olabildiği bir okuma, DB yöneticisine karşı değişmez arşiv sayılmaz.

Ürün seçenekleri bu oturumda raporda görülen yetkili ürünlerden oluşur; tür/tarih daralınca önceki seçenekler korunur, böylece tekrar genişletmeden seçim yapılabilir. Seçilen üründe yeni aralıkta kayıt yoksa sıfır sonuç açıkça gösterilir. Filtre değişince eski ayrıntı temizlenir. CSV'nin dönem/tür/ürün/kayıt sınırı uygulanan rapora aittir; bekleyen form seçimi dosyayı değiştirmez. Formül güvenli metin işleme sürer. Gerçek XLSX/PDF veya otomatik gönderim eklenmedi.

## Yetki ve işlem sınırı

Her toplam/liste/ayrıntı isteğinde OWNER/MANAGER/ACCOUNTANT, şirket ve istasyon kapsamı uygulanır; personel/başka firma erişemez. GET uçları `/api/stationos/market-accounting/reports/lot-control` ve `.../inventory-losses` altındadır. Stok, değer, mali fiş, bakiye/revizyon veya geçmiş kapanışlara yazmazlar; kapalı günlerde okunurlar.

Bu panel **otomatik fire, indirim, karantina kaldırma veya SKT değiştirme yapmaz**. Yetkili fiilî işlem için mevcut Market muhasebesi → Lot ve SKT veya El terminali akışı kullanılır. İlgili fizikî kontrol, açıklama, sürüm/önizleme ve kapalı gün kuralları korunur. Mevzuat/fizikî cihaz sertifikasyonu veya üretim yük garantisi değildir.

## Windows / Laragon güncellemesi

Proje ve DB yedeğini alın, eski `pnpm dev` işlemini durdurun. `.env` dosyanızı koruyarak GitHub main kaynaklarını güncelleyin:

```powershell
pnpm install --frozen-lockfile
pnpm tsx server/stationos/migrate.ts
pnpm dev
```

Yeni göç eklenmedi; önceki **0021 dahil** kurulum gerekir. Yeni/boş DB ayrıca ilk `pnpm db:migrate` ister. Menüden **Raporlar → SKT / fire kontrolü** açılır. GitHub kaydı Windows dosyalarını kendiliğinden güncellemez. POS DEMO, erişilebilir ortak sunucu/LAN ve gerçek banka/mali cihaz sınırları sürer.

## Doğrulama

28 Ekim: 23 dosyada **144 test**, TypeScript ve üretim build başarılı. On yeni test bugün/geçmiş/bilinmeyen SKT ve karantina çakışması, tarih/durum doğrulama, özgün miktar/maliyet ve eksik etiket, yanlış fire/gain, sıfır maliyet, bozuk para, çok ürünlü terminal mali mutabakatı, net sıfır miktarda ayrı parti gain/loss ve farksız terminal sayımı/yanlış kaynak türünü kapsar.

Mevcut satış raporu HTTP paketi dev3303 ve üretim3304 üzerinde açık sentetik DEMO fixture oluşturdu (`SMOKE_LEAVE_OPEN=1` kapanış bölümünü atlar). `scripts/smoke-lot-control.ts` yalnız açık `SMOKE_TEST=1`, loopback ve tam `istasyonos_pos_v2_test` socket DB'de her iki modda geçti: 51 stoklu parti, 7/15/30 ve bugün/geçmiş/bilinmeyen SKT ve karantina, son kontrol açıklaması, 50+1 sayfa ve güncel görüntü koruması, gerçek 52 fire/parti/masaüstü/çok ürünlü terminal sayımı, 57 ürün satırında 50+7 mali sayfalama ve ürün filtresi, eski/güncel etiket ayrımı, same-ID tek etki, asOf, bozuk geçmiş/miktar ve eski sayım uyumu. Yeni alım başına 50 parti sınırı korundu; testte 51 parti iki gerçek mal kabulüne bölündü.

Karantina/geçmiş/bilinmeyen SKT yalnız mevcut açık fizikî teyitli durum akışıyla test edildi. Bozuk payload, eski terminal sürümü ve miktar fixture denemeleri yalnız izole DEMO DB'de uygulanıp aslına döndürüldü. Script kasaları/günü kapatır; yeni/tüketilmemiş fixture `SMOKE_REPORT_FIXTURE` ile verilir. Gerçek/ortak DB'de çalıştırılmaz.

Chromium geliştirme ve son üretimde masaüstü sahip, 390 px yönetici ve engelli personel: güncel 50+1 parti/durum/bugün/7 gün/açıklama/CSV, kart değişince eski görüntüyü reddetme, 50+7 mali satır, tür/ürün/CSV, tarihsel/güncel etiket ve parti ayrıntısı, filtreyle seçimi temizleme doğrulandı. Stok/bakiye/revizyon/kapanış değişmedi; JS hatası, haricî HTTP veya mobil yatay taşma yoktu. Ana salt okunur tanı HTTP/HTML/JS/401/DB/kullanıcı şeması ve 21 göçle geçti. Fizikî Windows/MySQL 8/yük kabulü yapılmadı. Erişim/CSV/görseller Git dışında `/workspace/lot-control-test` altındadır; kullanıcı fiyat listesi/sırlar eklenmedi.

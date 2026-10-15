# İstasyon OS — v1.1 Kapsam Eki Taslağı
## Market, Kasiyer, Barkodlu Mal Kabul, Satış, Mutabakat ve Patron Ekranı

> **Güncellik notu — 8 Ekim 2026:** Bu belge önceki planlama taslağıdır. Aşağıdaki bazı varsayımlar (özellikle kasiyer oturumu, CRM ve patron paneli kapsamı) sonraki saha yanıtlarıyla değişmiştir. Güncel iş kararları için [v1.3 ana teknik planı](teknik-planlama-v1.3-mobil-vardiya-ocr-api-migration.md), mobil ekran taslakları, SQL DDL ve sipariş algoritması için [v1.4 tasarım ekini](tasarim-v1.4-mobil-ui-ddl-satin-alma.md) esas alın.

**Durum:** Planlama taslağı; nihai veri şeması veya kod değildir.  
**Tarih:** 6 Ekim 2026  
**Dayanak:** `akaryakıt.txt` içindeki v1.0 blueprint ve kullanıcının kapsam açıklaması.  
**Sürüm yaklaşımı:** v1.0 iş kuralları korunur. Bu istek, blueprint'te ayrıca izlenmesi gereken v1.1 kapsam genişlemesidir.

## 1. Kullanıcı tarafından açıklığa kavuşturulan iş kuralları

- **“Kasa” koli/kutu anlamında değil, satış yapan personel/kasiyer anlamındadır.** Bir istasyondaki market aynı anda **en çok 5 kasiyer** ile çalışabilmelidir.
- **Market ürünleri adet bazında satılır.** Koli/kasa satış birimi veya paket dönüşümü bu kapsamın parçası değildir.
- Ürünler mal kabul sırasında **el terminaliyle barkod okutularak adet bazında** teslim alınır.
- Mal kabul kayıtları **alış faturasıyla eşleştirilmelidir**.
- Satış kayıtları **yazar kasa/POS** ile ilişkilendirilmeli; kart tahsilatları **banka POS** hareketleriyle eşleştirilebilmelidir.
- Yazılımın kapsamı zaman içinde **CRM, finans, banka ve nakit yönetimini** içermelidir.
- İşletme sahibi/patron, yetkisi dahilindeki **birden fazla istasyonun verilerini tek patron ekranında** izleyebilmelidir.
- Önceki taslaktaki adet-koli satış dönüşümü bu kapsamdan çıkarılmıştır.

> “5 kasa” iş kuralı, istasyonda aynı anda çalışabilecek en çok beş kasiyer oturumu olarak ele alındı. Uygulamada kasiyer çalışan kaydıdır; fiziksel yazar kasa/POS cihazı ve banka POS terminali ayrı varlıklardır. Böylece aynı çalışan, vardiya ve farklı cihazlar birbirine karıştırılmaz.

## 2. Ürün kapsamı ve varsayımlar

Önceki ifadede geçen “5 bin stok adet ürün” hedefi **istasyon başına yaklaşık 5.000 farklı ürün/SKU** olarak varsayılmıştır; bu fiziksel stok adedine üst sınır değildir. Ürün miktarları ürün bazında tutulur. 5.000 SKU ilişkisel veri tabanı için olağan büyüklüktür; teknik şemada sert limit olarak uygulanmamalıdır.

Market modülünün uçtan uca akışı:

1. Ürün ve barkodların istasyon kataloğunda tanımlanması.
2. Ürünlerin tedarik edilmesi ve satın alma kaydının açılması.
3. El terminalinden barkod okutularak ürünlerin adet adet mal kabulü.
4. Mal kabulün sipariş ve alış faturası satırlarıyla eşleştirilmesi.
5. Satışların en fazla beş aktif kasiyer tarafından yürütülmesi.
6. Satışın yazar kasa/POS işlemiyle kaydedilmesi ve kesinleşen her ürün adedinin stoktan anında düşmesi.
7. Nakit ve kart tahsilatlarının kasiyer vardiyası, yazar kasa, banka POS ve banka hareketleriyle mutabakatı.
8. İade, iptal, fire, sayım farkı ve düzeltmelerin silinmeyen hareket geçmişiyle izlenmesi.
9. CRM ve finans/banka/nakit raporları ile çok istasyonlu patron görünümünün fazlar halinde eklenmesi.

### Adet birimi

İlk market kapsamındaki satılabilir ürünlerin stok ve satış birimi `ADET` olacaktır. Satın alma mal kabulü de okutulan her bir ürün adedi üzerinden yapılacaktır. Tedarikçi faturası koli/paket toplamı içeriyorsa, miktar karşılaştırmasının doğru olabilmesi için satırın adet karşılığına çevrimi gerekir; bu özel durumun desteklenip desteklenmeyeceği kodlama öncesi doğrulanmalıdır. Ağırlıkla satılan ürünler ve koli bazlı satış ilk sürüme dahil değildir.

## 3. Önerilen domain modeli

Mevcut blueprint'teki **global ürün kataloğu + istasyon bazlı ürün/stok** ilkesi korunur.

### Ürün ve istasyon kataloğu

- **`products`:** Global ürün kimliği, ürün adı, marka, kategori, temel birim (`ADET`), aktif/pasif durumu.
- **`product_barcodes`:** Ürünle ilişkili bir veya daha fazla barkod. Barkodun ürün/ambalaj tanımları açık olmalı; okutma ürün miktarını kendiliğinden yanlış artırmamalı.
- **`station_products`:** Ürünün istasyonda satışa açık olup olmadığı, istasyon içi ürün kodu, fiyat ve stok takibi ayarları.
- **`product_supplier_mappings`:** Ürünün tedarikçideki kodu/adı ve varsa tedarikçi barkodu; fatura satırı eşleştirmeyi kolaylaştırır.
- Barkod ve istasyon ürün kodlarında uygun benzersizlik ve arama indeksleri olmalıdır.

### Kasiyer, kasa oturumu ve terminaller

- **Kasiyer:** `employees` içindeki satış personeli; gerekirse sisteme girişi için ayrı `user` hesabı bağlanır.
- **Kasiyer oturumu:** Çalışanın istasyonda satışa başladığı ve bıraktığı süre; istasyon, çalışan, vardiya, açılış/kapanış zamanı ve oturum durumu ile ilişkilidir.
- **Üst sınır:** Bir istasyonda aynı anda en fazla 5 aktif kasiyer oturumu. Bu kural istasyon ayarı veya lisans parametresi olarak yönetilebilir; denetimsiz altıncı oturum açılmamalıdır.
- **Yazar kasa/POS cihazı:** Resmî fiş/satış kaydının kaynağı olan fiziksel cihaz veya entegrasyon.
- **Banka POS terminali:** Kart tahsilatı ve provizyon/terminal hareketlerinin kaynağı.

Kasiyer personelini bu terminallerle aynı tablo/kavram olarak modellemeyin. Terminal sayısı, hangi kasiyerin hangi cihaza bağlı olacağı, aynı terminalin birden fazla kasiyerce kullanılıp kullanılamayacağı ve eşzamanlı satış cihazlarının eşleşmesi saha cihazları öğrenildikten sonra kararlaştırılmalıdır.

## 4. El terminaliyle mal kabul ve fatura eşleştirme

Önerilen süreç:

1. Tedarikçi siparişi veya beklenen teslimat kaydı açılır.
2. Tedarikçinin alış faturası sisteme alınır (ilk aşamada PDF/görüntü veya manuel giriş olabilir).
3. Operatör teslim edilen ürünleri el terminaliyle barkod okutarak kabul eder; her başarılı okutma ürün adet sayısını artırır.
4. Sistem okutulan barkodu ürün kataloğuna ve beklenen sipariş/fatura satırına bağlar.
5. Okunan adet, sipariş edilen miktar ve fatura miktarı karşılaştırılır.
6. Eksik, fazla, yanlış ürün, barkodsuz ürün veya fiyat farkı istisna listesine düşer; yetkili incelemesi olmadan fark sessizce kapanmaz.
7. Onaylanan mal kabul stok hareketi oluşturur ve istasyon stok bakiyesini artırır.
8. Fatura/mal kabul/sipariş üçlü eşleştirmesi tamamlanır veya farkı onaylı gerekçeyle kapatılır.

Önerilen kayıtlar: `suppliers`, `purchase_orders`, `purchase_order_lines`, `supplier_invoices`, `supplier_invoice_lines`, `goods_receipts`, `goods_receipt_lines`, `invoice_receipt_matches`.

**Üçlü eşleştirme:** Sipariş edilen miktar ve maliyet ↔ okutularak teslim alınan miktar ↔ faturalanan miktar ve fiyat. Fatura tek bir mal kabule bire bir bağlı olmak zorunda değildir; kısmi teslim ve faturalar desteklenecekse eşleştirme satır düzeyinde çoktan-çoğa veya parça parça kayıtlanmalıdır.

Mal kabul, ürünün fiilen teslim edildiği anda onaylandığında stok artar; taslak sipariş veya yalnızca sisteme yüklenmiş fatura stoku artırmaz. Mal kabul iptali/düzeltmesi orijinal kaydı silmek yerine ters/düzeltme hareketi oluşturur. El terminali çevrimdışı kullanımı gerekiyorsa okutmalar yerel sırada saklanmalı ve sunucuya tekrar gönderimde mükerrer sayım engellenmelidir; bu gereksinim henüz açık karardır.

## 5. Adet bazlı satış ve anlık stok yönetimi

Satış, barkodla ürün seçimi ve adet miktarı üzerinden gerçekleşir. Satış yazar kasa/POS'ta kesinleştiğinde:

- Satış kaydı ve satış satırları saklanır.
- Stok hareket defterinde ürün başına satılan adet kadar eksi hareket oluşturulur.
- Güncel istasyon stok bakiyesi işlem bütünlüğü içinde güncellenir.
- Satışın kaynağı, kasiyeri, açık oturumu, istasyonu, yazar kasa/POS cihazı ve harici işlem referansı saklanır.
- Harici POS/yazar kasa kaydı aynı entegrasyon kimliğiyle yeniden gelirse ikinci stok düşümü yapılmaz (**idempotency**).

Varsayılan öneri: stok yetersizliğinde satış engellensin; istisna yetkili kullanıcı tarafından gerekçe ile açılabilsin. İade/iptal/fiş düzeltmesi orijinal satışı silmemeli; ilgili fişe bağlı ters satış ve stok iade hareketi oluşturmalıdır.

Aynı son ürüne eşzamanlı satışlarda, stok kontrolü ve düşümü atomik olmalıdır. Uygulama içinden elle satış ile entegre yazar kasa satışının aynı işlemi iki kez kaydetmesi engellenmelidir. Yazar kasa entegrasyonu mümkün değilse satış girişi, mutabakat ve stok düşümünün hangi sistemde gerçek kaynak olacağı açıkça belirlenmelidir.

## 6. Yazar kasa, banka POS ve tahsilat mutabakatı

Üç farklı kayıt türü birbirinden ayrı modellenmelidir:

1. **Satış/fiş:** Ne satıldı, kaç adet satıldı, satış toplamı nedir? Kaynak yazar kasa/POS olabilir.
2. **Tahsilat:** Satış hangi yöntemle ödendi (nakit, banka kartı/kredi kartı vb.)? Bir satış birden çok ödeme yöntemiyle ödenebiliyorsa ödeme satırları ayrılmalıdır.
3. **Banka POS/banka hareketi:** Kart işleminin provizyonu, terminal referansı, valör/takas, komisyon, net ödeme, iade veya itiraz bilgileri.

Önerilen mutabakat zinciri:

- Kasiyer satış toplamı ve fiş/rapor toplamı ↔ yazar kasa günlük Z raporu veya entegrasyon verisi.
- Kartla satış tutarı ↔ banka POS terminalinin provizyon/işlem listesi.
- Brüt kart işlemleri − komisyon/masraf − iadeler ↔ bankaya yatırılan net takas tutarı ve banka ekstresi.
- Nakit satış toplamı ↔ kasiyer/kasa oturumu kapanışında sayılan nakit, açılış avansı, nakit giriş/çıkışı ve kasadan teslim/depozito.

Mutabakat sonucu eşleşti/eşleşmedi/kısmi eşleşti gibi durumlarla tutulmalı. Farklar zaman, tutar, terminal, referans ve ödeme türüyle aranabilmeli; manuel eşleştirme yetkiye ve audit'e tabi olmalıdır. POS entegrasyonu tekrar veri gönderdiğinde mükerrer satış veya kart tahsilatı yaratmamalıdır.

Yazar kasa ve banka POS'un aynı fiziksel cihaza mı, farklı cihazlara mı bağlı olduğu istasyona ve sağlayıcıya göre değişebilir. Sistem sağlayıcı/terminal bazında konfigüre edilmeli; **kasiyer = cihaz = banka POS terminali** gibi hatalı bir bire bir varsayım yapılmamalıdır.

## 7. Nakit, banka, kart ve finans yönetimi

Talep doğrultusunda finansal kapsam aşağıdaki parçalara ayrılır:

### Nakit yönetimi

- Kasiyer/kasa oturumu açılış nakdi (float), nakit satış, nakit iade, yetkili nakit giriş/çıkışı ve kapanış sayımı.
- Beklenen nakit ile sayılan nakit farkı; fark sebebi ve yönetici onayı.
- Kasadan ana kasaya/bankaya para teslimi ve teslim alan/verene dair kayıt.
- Kapanmış vardiya/kasa işleminin geçmişini değiştirmeden düzeltme kaydı.

### Banka ve kart yönetimi

- Şirket/istasyon banka hesapları, hareket aktarımı ve banka ekstresi mutabakatı.
- Banka POS terminalleri, kart işlemleri, takas/valör tarihi, komisyon ve net tutar.
- Kart iadeleri, reddedilen işlemler, ters ibraz/itiraz ve banka kesintileri için durum takibi.
- Çoklu banka/POS sağlayıcısı olacaksa sağlayıcı ve terminal bazında entegrasyon katmanı.

### Finans çekirdeği

Gelir-gider, satın alma faturası borçları, banka/kasa bakiyeleri, transferler ve nakit akışı gibi finans kayıtları ayrı bir finans domaininde tutulmalıdır. Market satış fişi, kart tahsilatı, POS takası ve banka hareketi aynı kayıt değildir; birbirine referanslarla bağlanmalıdır. Muhasebe defteri, vergi beyanı veya resmî muhasebe entegrasyonu gereksinimi ayrıca tanımlanmalıdır.

## 8. CRM kapsamı

“CRM mantığı”nı ilk etapta müşteri ilişkilerinin temel kaydı olarak ele almak önerilir:

- İzin/amaç kaydıyla müşteri kartı ve iletişim tercihleri.
- Müşteriyle ilişkili satış geçmişi (mevzuat ve veri minimizasyonu gözetilerek).
- İsteğe bağlı sadakat/üyelik, kampanya ve müşteri grubu.
- İleride kurumsal müşteriler için cari hesap/borçlandırma gerekiyorsa tüketici CRM'den ayrı alacak/finans kuralları.

Her market müşterisinin kişisel bilgisi alınması zorunlu olmamalıdır. Müşteri kimliği olmadan yapılan perakende satış da sorunsuz çalışmalı; kişisel veri yalnızca açık iş amacı ve uygun erişim/izin kurallarıyla tutulmalıdır. Sadakat puanı, kampanya, SMS/e-posta izni ve kurumsal cari satışların ilk sürüme dahil olup olmadığı ayrıca kararlaştırılmalıdır.

## 9. Çok istasyonlu patron ekranı

İşletme sahibi/patron rolü, erişim yetkisi olan tenant ve istasyonlar arasında toplu görünüm alabilmelidir. Dashboard en az şu boyutları destekleyecek şekilde tasarlanmalıdır:

- İstasyon seçimi, tüm istasyonlar toplamı, tarih aralığı ve karşılaştırmalı dönem.
- Günlük/aylık satış ve ödeme yöntemi özeti.
- Market ürünleri: adet ve ciro bazında en çok satanlar, satış/stok eğilimi.
- Stok miktarı, kritik stok, sayım farkı, bekleyen mal kabul ve fatura eşleştirme farkları.
- Yazar kasa Z raporu, banka POS ve banka takas mutabakatı bekleyenler/farklar.
- Nakit kapanışları ve kasiyer/shift farkları (role göre ayrıntı veya özet).
- İstasyonların operasyonel uyarıları ve veri güncelliği/entegrasyon durumu.

Özet ekranda tenant kapsamındaki veriler toplanabilir; detaya inince istasyon kapsamı ve izin kontrolü yeniden uygulanmalıdır. Patron hesabı ile platform `SUPER_ADMIN` yetkileri ayrı kalmalıdır. Raporlar hangi zaman dilimine, satış tarihine, takas tarihine veya fatura tarihine göre toplandığını açıkça belirtmelidir.

## 10. Audit, güvenlik ve veri bütünlüğü

- Satış, mal kabul, fatura eşleştirmesi, stok düzeltmesi, iade/iptal, fiyat değişikliği, kasa kapanışı, kart/banka mutabakatı ve kullanıcı yetkisi değişiklikleri audit'e yazılmalıdır.
- Kritik kayıtlarda önceki/yeni değer, yapan kişi, zaman, gerekçe, istasyon, ilgili fiş/terminal/fatura ve onaylayan saklanmalıdır.
- Finansal ve stok hareketi kayıtları fiziksel olarak silinmemeli; iptal/ters kayıt/düzeltme kullanılmalıdır.
- Tenant ve istasyon izolasyonu her sorgu ve raporda zorunlu olmalıdır.
- POS, banka ve el terminali aktarımı tekrarlandığında idempotency anahtarı veya harici kaynak kimliğiyle mükerrer hareket engellenmelidir.
- Yönetici onayı, iade ve düzeltme izinleri rol/scope bazında denetlenmelidir.

## 11. V1.1 için önerilen fazlar

Kapsamın tamamı istenen ürün vizyonuna alınır; ancak teslimat riskini kontrol etmek için parçalara ayrılması gerekir.

### Faz A — Çalışan, vardiya ve kasiyer temeli

- Çalışan kaydı ve istasyon görevlendirmesi.
- Aylık vardiya planı, yayımlama, fiili çalışma ve onay.
- Kasiyer yetkisi; istasyonda en fazla 5 aktif kasiyer oturumu.
- Kasiyer/shift/istasyon bağlantısı.

### Faz B — Market ürün ve stok çekirdeği

- İstasyon kataloğu (hedef 5.000 SKU), barkod ve adet birimi.
- El terminaliyle barkodlu mal kabul.
- Değiştirilemez stok hareket defteri ve güncel stok özeti.
- Sayım, kritik stok, fire ve düzeltme akışı.

### Faz C — Satın alma ve fatura eşleştirme

- Tedarikçi, sipariş, teslim alma ve alış faturası satırları.
- Sipariş–mal kabul–fatura üçlü eşleştirmesi.
- Miktar/fiyat farkı, kısmi teslim/fatura ve onay kuyruğu.

### Faz D — Canlı satış ve tahsilat

- Beş kasiyere kadar eşzamanlı çalışma.
- Yazar kasa/POS kaynaklı satış aktarımı veya seçilmiş MVP yöntemi.
- Satış kesinleşince adet bazlı anlık stok düşümü.
- İade/iptal, ödeme türleri ve kasiyer kapanışı.

### Faz E — Banka, kart ve nakit mutabakatı

- Banka POS işlem/takas verisi.
- Kart komisyonu ve net banka ödemesi eşleştirme.
- Nakit açılış/kapanış, sayım ve fark yönetimi.
- Banka hareketi içe aktarma ve mutabakat.

### Faz F — CRM ve çok istasyonlu patron ekranı

- Müşteri kartı/izin ve gerekiyorsa sadakat kapsamı.
- İstasyonlar arası rol kontrollü toplam raporlar ve detay ekranı.
- Satış, stok, fatura, nakit/banka/kart ve vardiya göstergeleri.

## 12. 5.000 ürün ve performans gereksinimleri

5.000 farklı ürün için ayrı bir dağıtık arama altyapısı gerekmez; ancak kasiyer ve mal kabul ekranı hızlı ve operasyonel olmalıdır:

- Barkod araması indeksli olmalı ve okutmayla ürün doğrudan bulunmalı.
- Ürün listesi filtrelenmeli/sayfalanmalı; 5.000 ürün tek seferde satış ekranına yüklenmemeli.
- El terminali okutma akışı düşük gecikmeyle ürün, birim, adet ve kabul durumunu göstermeli.
- Offline terminal okutması gerekiyorsa senkronizasyon/mükerrerlik kontrolü planlanmalı.
- Satışların eşzamanlı stok düşümünde yarış koşulları önlenmeli.
- Raporlar tarih aralığı ve istasyon filtresiyle çalışmalı.

## 13. Teknik tasarımdan önce kesinleştirilmesi gereken saha kararları

Bu kararlar kapsamın mimarisini ve entegrasyon eforunu etkiler; blueprint aşamasında tespit edilip ERD/migration'dan önce yanıtlanmalıdır:

1. Kullanılan yazar kasa/YN ÖKC marka-model ve entegrasyon sağlayıcısı/API erişimi nedir?
2. Banka POS sağlayıcısı/sağlayıcıları hangileri; işlem ve takas dosyası/API nasıl alınır?
3. Bir satış personeli bir fiziksel yazar kasa terminaline mi bağlı, yoksa beş kişi daha az sayıda cihazı paylaşabilir mi?
4. El terminali marka/modeli, barkod standardı ve internet kesintisinde okutma zorunluluğu nedir?
5. Tedarikçi faturaları XML/e-Fatura, PDF, e-Arşiv veya başka formatlarda mı geliyor? Fatura satırlarında barkod var mı?
6. Mal kabul ile fatura miktarı/adedi farklıysa kim, hangi sınırda ve nasıl onaylayacak?
7. Mevcut ürünlerde farklı barkodlar, aynı barkodla birden çok ambalaj veya barkodsuz ürün var mı?
8. “5 kasa” kesin olarak aynı anda açık en çok beş kasiyer oturumu mudur? İstasyon bazında değişebilir mi?
9. Patron paneli sadece tenant içindeki istasyonları mı gösterecek, yoksa şirket/tenantlar arası konsolide görünüm de isteniyor mu? Başlangıç önerisi: tenant içi; tenant izolasyonu korunur.
10. CRM'de ilk hedef müşteri kartı mı, sadakat/puan mı, yoksa kurumsal müşteri cari hesabı mı?
11. Nakit/banka/finans kapsamı günlük işletme yönetimi mi, yoksa tam muhasebe ve resmî beyan süreçleri de mi? Başlangıç önerisi: operasyonel nakit/banka/kart mutabakatı; muhasebe entegrasyonu ayrı faz.
12. İade, fiyat değişikliği, iskonto ve stok yetersizliği istisnalarında hangi yönetici onayları gerekir?

## Sonuç

Güncellenen v1.1 kapsamı artık yalnızca “market envanteri” değildir: **beş kasiyere kadar market işletimi, adet bazlı barkodlu mal kabul, alış faturasıyla üçlü eşleştirme, yazar kasa/POS satışları, banka POS ve kart mutabakatı, nakit/banka yönetimi, CRM ve çok istasyonlu patron ekranı** olarak planlanmıştır. Başlangıç mimarisinin kritik ayrımları şunlardır:

1. Kasiyer çalışanı, yazar kasa/POS cihazı ve banka POS terminali farklı varlıklardır.
2. Ürün stok ve satış miktarı adet bazlıdır; koli satış kuralı yoktur.
3. Sipariş, fiziksel mal kabul, fatura, satış, tahsilat ve banka takası ayrı ama ilişkilendirilebilir kayıtlardır.
4. Kesinleşmiş satış ve mal kabul stok hareketini anında ve idempotent biçimde üretir.
5. Her işlem istasyon/tenant kapsamını ve audit geçmişini korur.

Bu taslak bir sonraki adımda **Employee + Shift + Kasiyer** ve **Market/Product/Inventory/Purchase/Sales** için ayrıntılı iş akışları ve ERD hazırlamaya temel oluşturabilir; entegrasyon şema detayları sahadaki cihaz/sağlayıcı bilgisiyle kesinleştirilmelidir.

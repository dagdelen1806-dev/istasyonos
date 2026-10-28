# Market Raporlar merkezi — ihtiyaç analizi ve geliştirme planı

**28 Ekim cari vade teslimi:** Güncel açık alacak/borç yaşlandırması ve bugün+90 günlük ödeme/tahsilat vade takvimi [eklendi](market-cari-vade-2026-10-28.md). Geçmiş tarihli yaşlandırma, banka/kart mutabakatı, tedarikçi performansı ve birleşik gün sonu kontrolü sonraki paketlerdir. Aşağıdaki tarihli notlar teslim sırasının geçmişidir.

**28 Ekim SKT/fire teslimi:** Güncel SKT/karantina ve kayıtlı fire/parti/masaüstü/terminal sayım paneli [eklendi](market-skt-fire-kontrol-2026-10-28.md). Cari vade/ödeme takvimi ve sonraki finans/tedarikçi analizleri plan olarak sürer.

**Kategori/saat teslimi:** Satış anı kategorisi, eski kategori eksikliği ayrımı ve İstanbul saatlik analiz [eklendi](market-kategori-saat-2026-10-24.md); 0021 gerekir. Sonraki SKT/fire, cari/vade, tedarikçi ve gün sonu birleşik raporları plan olarak sürer.

**Stok/marj teslimi:** Güncel mali stok değeri, 30/60/90 hareketsizlik/gözlem ve özgün satış marjı uyarıları [eklendi](market-stok-sagligi-marj-2026-10-24.md). Tarihsel stok/devir, kategori/saat, cari ve sonraki analizler plan olarak kalır.

**Teslim güncellemesi:** Kasa/kasiyer filtreleri ve sepet iptal denetimi eklendi; [çalışan kapsam ve 0020 güncellemesi](market-rapor-kontrol-2026-10-24.md). Kategori/saat ve sonraki stok/cari raporları plan olarak kalır.

24 Ekim 2026. Bu belge plan ve kabul ölçütüdür. İlk satış/ödeme/fiş/ürün paketi sonradan teslim edildi: [çalışan kapsam](market-raporlar-merkezi-2026-10-24.md). Diğer öneriler tamamlanmış özellik değildir. İnceleme tabanı GitHub main `8fbb293`: MarketAccounting, MonthlyMarketReport, CountReports, MarketStatement, inventory-reports ve market-report-domain. Öncelik markettir; akaryakıt vardiya kaynaklarını market satışına eklemeyiz.

## Mevcut durum

Çalışan ekranlar aylık kâr–zarar ve ürün katkısı, tarihli stok hareketleri, onaylı terminal sayım raporları, cari ekstre/CSV, günlük hareket defteri, kasa/banka ve gün sonu bilgisi sunuyor. Lot/SKT, satın alma siparişleri ve raf fiyat farkları kendi operasyon ekranlarında izleniyor. Bağımsız, birleşik bir Raporlar merkezi ve bütün aşağıdaki rapor aileleri mevcut değil.

Aylık ürün tablosu en fazla 100 ürün döndürüyor; ad güncel ürün kartından geliyor. Bu listeyi tam ürün evreni veya tarihsel ad/kategori kanıtı saymayacağız. Terminal sayım raporları doğrudan parti sayımı/fire işlemlerini kapsamıyor. Mevcut cari ekstre ile geçmiş tarihteki açık belge yaşlandırması aynı şey değil. Eski tasarım/prototip belgeleri çalışan kaynak sayılmayacak.

## İşletmenin cevap aradığı sorular

- Bugün ne kadar sattım; ne kadarı iade oldu, hangi ödeme yöntemiyle satıldı?
- Satılan ürünlerin kayıtlı maliyeti ne; brüt kâr ve giderler sonrası faaliyet sonucu ne?
- Hangi ürün/kategori kazandırıyor; hangisi düşük marjlı, zararına veya yavaş satılıyor?
- Kasada beklenen ve fizikî sayılan para neden farklı; hangi kaynak kayıtlara dayanıyor?
- Kime ne kadar borç/alacak var; hangi belgeler gecikmiş, hangileri yakında vadesine geliyor?
- Stokta ne kadar para var; neyi sipariş etmeli, hangi partiyi önce satmalı?
- İptal/iade, fiyat farkı ve sayım kayıpları nerede yoğunlaşıyor?

## Rapor kataloğu ve öncelik

| Öncelik | Rapor | İçerik ve karar | Kaynak / hazırlık |
|---|---|---|---|
| P1 | Yönetici özeti | KDV dahil satış/iade/net ciro, KDV hariç net satış, maliyet, brüt kâr, faaliyet sonucu, satış fişi sayısı; aynı uzunlukta önceki dönem | Mevcut mali defter ve POS; ortak rapor sözlüğü/merkez geliştirilecek |
| P1 | Ayrıntılı satış | Gün/saat, kasa, işlemi yapan kişi, ürün, ödeme yöntemi; satış → fiş → satır ayrıntısı | POS satış/satır/ödeme snapshotları, iade ve mali kayıt bağlantısı |
| P1 | Ürün ve kategori performansı | Satış/iade adedi, net satış, satış maliyeti, brüt kâr, marj; düşük marj/zararına satış | Ürün bazında temel var; tam sayfalama ve kategori tarihçesi eksikleri giderilecek |
| P1 | Kasa ve kasiyer | Oturum, satışın gerçek kullanıcısı/cihazı, nakit/kart/veresiye, devir, açıklamalı kasa farkı | Ortak kasada oturum sahibi ile satışı yapan kişiyi ayır; fiş/satır kimliği bazında tekilleştir |
| P1 | İptal ve iade | Satış öncesi sepet/satır/adet iptali ile satış sonrası kaynak belgeli iadeleri ayrı izle; açıklama/kişi/zaman | Sepet olayları ile satış/alış iadeleri ayrı kaynak; iptal tutarı gerçekleşmiş gelir sayılmaz |
| P2 | Stok değerleme | Eldeki adet, kayıtlı net maliyet değeri, satılabilir/karantina; güncel an itibarıyla | Ürün, mali stok ve lotlar; parti satırlarında SKU maliyetini tekrar toplama |
| P2 | Kritik stok ve alım ihtiyacı | Minimum/hedef, hız, karşılanma günü, açık onaylı sipariş ve önerilen adet | Mevcut öneri hesabını kullan; gelen sipariş fizikî stok değildir |
| P2 | Hareketsiz stok ve devir | Son satış, 30/60/90 gün hareket görmeyen ürün, stokta bağlı tutar; dönem devir hızı | Hareketsiz listesi yapılabilir; gerçek ortalama stok için dönemsel snapshot/hareket kapsamı gerekir |
| P2 | Lot/SKT ve fire | Yaklaşan/geçmiş SKT, karantina, parti fireleri; sayım fazlası/eksiği ayrı | Terminal sayımı + doğrudan parti sayımı/fire kaynakları ayrı etiketlenerek birleştirilecek |
| P2 | Satın alma ve tedarikçi | Gerçek net alış fiyatı/KDV, geçmiş fiyat değişimi, teslim edilen/kalan/geciken sipariş | Sipariş tahmini ile gerçek kabul belgesi ayrılacak; aynı SKU/temel birim/net fiyat karşılaştırılacak |
| P3 | Cari bakiye ve yaşlandırma | Müşteri alacağı, tedarikçi borcu; vadesi gelmemiş, bugün, 1–7/8–30/31–60/61+ gecikmiş | Belge kalan tutarı ve tahsisli ödeme/iade; açılış bakiyesinin vadesi bilinmiyorsa ayrı göster |
| P3 | Nakit akışı ve kart alacağı | Gerçekleşmiş tahsilat/ödeme, kasa/banka transferi, bekleyen kart ve komisyon | Satıştan ayrı para hareketleri; banka aktarımı manuel teyit, otomatik banka bağlantısı yok |
| P3 | Gider ve faaliyet sonucu | Gider türü/tarih/kayıt, banka komisyonu, stok/kasa farkı; gün/ay karşılaştırması | Mevcut günlük mali hesap yeniden kullanılacak; olmayan gider kategorisi/tarihçesi için veri alanı gerekir |
| P3 | Gün sonu ve mutabakat | Kapanmış/açık günler, kasa farkı, kayıtlı kapanış özeti, ilgili fişler | Kayıtlı kapanış snapshotı esas; sonradan güncel stokla yeniden hesaplama yok |
| P3 | KDV özeti | Kayıtlı alış/satış/iade belgelerinin net/vergi/brüt tutarı, oran bazında ayrıntı | Belge anındaki KDV snapshotı; beyanname, indirilebilir KDV hesabı veya resmî vergi onayı değildir |
| P3 | Raf/kasa fiyat uyumu | Fizikî fiyat farkları, son yerleştirme, değişmiş etiket kuyruğu, kişi/cihaz | Mevcut 0019 kayıtları; fiyat farkı kaydı otomatik indirim/yerleştirme sayılmaz |
| P4 | Gelişmiş analiz | ABC, stok devir trendi, sepet birliktelikleri, alış senaryosu ve nakit tahmini | Önce veri kapsamı ve örneklem doğrulanır; tahmin/varsayımlar gerçekleşmiş kayıttan ayrılır |

P1/P2/P3 geliştirme sırasıdır; her aşama küçük, bağımsız teslimlere bölünecek. Bu plan tam muhasebe/ERP veya rakiplerle bire bir eşitlik iddiası değildir.

## Ekran yapısı

Tek **Raporlar** menüsü; içeride **Genel bakış**, **Satış ve kârlılık**, **Stok ve satın alma**, **Cari ve nakit**, **Kontrol ve gün sonu** grupları önerilir. Mevcut raporlar aynı hesaplama ve bileşenlere bağlanır; ikinci, farklı sonuç veren rapor motoru yazılmaz. Operasyon menülerinden ilgili rapora kısayol korunabilir.

Her raporda kapsam/hesaplama açıklaması → özet kartları → grafik gerekiyorsa grafik → filtrelenebilir tablo → kaynak fişe/satıra ayrıntı sırası kullanılır. Büyük toplamın hangi satırlardan geldiği görülebilir olmalı. Renk/uyarı tek başına açıklama yerine geçmez. Mobilde ana metrik ve ayrıntı okunur kalır.

Ortak filtreler: yetkili istasyon, başlangıç/bitiş iş günü, bugün/dün/bu hafta/bu ay/özel aralık; rapora uygunsa kasa, satışı yapan kullanıcı, ürün, kategori, tedarikçi/cari ve ödeme yöntemi. Sadece uygulanabilen filtreler gösterilir. Kasiyer filtresi satışa uygulanıp genel banka/gider toplamını filtreliyormuş gibi görünmez. Ödeme yönteminde karma fişin tamamını her yönteme tekrar yazmayız; fiş kapsamı ve ödeme payı ayrımı görünür olur.

İlk sürüm tek yetkili istasyon bazlıdır. Çok istasyon toplamı, sunucuda izinli kapsam ve aynı tanım/para birimi doğrulanarak ayrı aşamada yapılır; istasyonlar arası transferler konsolidasyonda iki kez para girişi sayılmaz.

## Hesaplama sözlüğü

- **KDV dahil net ciro:** Dönemde kaydedilmiş satışların KDV dahil tutarı eksi dönemde kaydedilmiş satış iadeleri. Satış ve iade ayrıca gösterilir. Nakit tahsilatı anlamına gelmez.
- **Net satış:** İade/uygulanmış indirim sonrası KDV hariç satış tutarı. İndirim henüz kaydedilmemişse varsayımsal indirim üretilmez.
- **Satılan mal maliyeti:** Satış anında kaydedilmiş maliyet eksi ilgili dönemdeki iadelerin kayıtlı maliyet etkisi. Bugünkü alış fiyatıyla geçmiş satış maliyeti hesaplanmaz.
- **Brüt kâr:** Net satış − satılan mal maliyeti. **Brüt marj:** Brüt kâr / net satış × 100. Net satış sıfır/negatifse oranı anlamlı olmayan olarak işaretle; sıfıra bölme veya yanıltıcı yüzde üretme. Maliyet üzerinden kâr oranı ayrı isimle gösterilir.
- **Faaliyet sonucu:** Mevcut mali hesaplarla brüt kâr − kayıtlı gider/komisyon/kayıplar + kayıtlı kazançlar. Kurumlar vergisi/amortisman/finansman/ortak giderlerin tamamını kapsayan net kâr değildir.
- **Ortalama satış fişi:** İadeler ayrı gösterilerek satış fişlerinin KDV dahil toplamı / tamamlanmış satış fişi sayısı. İade/iptal fişini satış adedi sayma. Ortalama net sepet istenirse ayrı metrik ve açık payda kullan.
- **Cari kalan:** Belge toplamı − tahsisli ödeme/tahsilat − iade mahsubu. Müşteri ve tedarikçi dengeleri ayrı kalır; aynı tarafın alacak/borcunu kendiliğinden mahsup etme.
- **Gecikme:** Vade < seçilen referans iş günü. Vadesi bugün olanı gecikmiş sayma. Vadesiz açılışlar ayrı bantta.
- **Kart alacağı:** Henüz bankaya teyitli aktarılmamış kart tutarı; kullanılabilir banka parası değildir. Veresiye satış ve sonraki tahsilat iki ayrı satış değildir. Mal alımı anında bütün tutar gider değildir.
- **Stok devir hızı:** Dönem satılan mal maliyeti / aynı dönemin ortalama maliyet stok değeri. Yalnız bugünkü stok varsa bunu gerçek dönem devir hızı diye sunma. Stokta kalma günü aynı veri koşulunu taşır.

Finansal tutarlar kaynakta integer kuruş, ara hesapta güvenli/BigInt yuvarlama ile korunur. Ekran, grafik, tablo ve dışa aktarım aynı veri kümesi ve tanıma dayanır. Mevcut kısmi belge KDV yuvarlama kuralları raporda yeniden değiştirilmez.

## Tarih, geçmiş ve veri eksikleri

Dönem raporu hareket akışını; stok/bakiye raporu belirli andaki durumu gösterir. Güncel miktarı eski tarih seçildi diye tarihsel stok olarak göstermeyiz. İlk stok değerleme güncel anla sınırlı olabilir; eski tarihe izin ancak açılış + bütün hareket/değer etkileri veya güvenilir snapshotlarla mutabakat sağlanınca açılır.

Cari geçmiş yaşlandırmasında bugünkü ödenmiş kalan tutarı eski güne taşımayız. O gün itibarıyla ödeme/ters kayıt/iade tahsislerini yeniden kurmak veya sürümlü snapshot gerekir. İlk teslim güncel tarihli yaşlandırma olabilir; geçmiş seçeneği yeterli kaynak olmadan açılmaz.

Saatlik satışta UTC kayıt anı Europe/Istanbul'a çevrilir; mali gün özetinde kayıtlı business_date kullanılır. Gece yarısını geçen kasa oturumu ile mali gün farklı kavramlardır. İade kaydedildiği güne yazılır; özgün satış gününü sessizce değiştirmez. Ürün/kategori adının tarihsel snapshotı yoksa açıkça güncel kart sınıflandırması etiketi kullanılır. Tarihî kategori analizi için yeni snapshot alanları eski veriyi tahminle doldurmamalı.

Rapor defterin başlangıç gününü, kapsadığı dönemi, üretim anını, kapanmış/güncel durumunu ve veri kapsamı kısıtlarını gösterir. Açık gün verisi değişebilir. Önceki dönem karşılaştırması aynı gün sayısını kullanır; ayın tamamıyla henüz bitmemiş ayı karşılaştırırken aralık farkı görünür olmalı. Yüzde değişimde önceki tutar sıfırsa mutlak fark gösterilir.

## Yetki ve dışa aktarım

Başlangıçta mevcut rol izinleri korunur. OWNER/MANAGER/ACCOUNTANT yalnız erişebildiği istasyonların izinli raporlarını görür; maliyet/kâr, kişisel cari verileri ve ham finans ayrıntısı için mevcut endpoint yetkilerinden daha geniş izin açılmaz. Kasiyer için gerekiyorsa yalnız kendi işlem/oturum özeti ayrı, sınırlı servisle tasarlanır. MARKET_STAFF için genel kâr/maliyet/cari raporu açılmaz. Toplam, grafik, ayrıntı ve export aynı sunucu yetkisini uygular.

CSV mevcut güvenli metin işleme ile ilk aşamada; yazdır/PDF rapor kapsamı açıkça tanımlanarak eklenir. Gerçek XLSX sonraki teslimdir; CSV'yi XLSX diye adlandırmayız. Dışa aktarımın **bu sayfa** mı **tüm filtrelenmiş sonuç** mu olduğu açıkça yazılır. Toplam tüm döneme aitken 100 satırlık ürün CSV'si tam rapor diye sunulmaz. Büyük export sunucu sayfalaması/akış veya arka plan işine ihtiyaç duyabilir; dosya erişimi ayrıca yetkili olmalı. Otomatik e-posta/mesaj gönderimi bu plana dahil değil.

## Uygulama sırası ve kabul ölçütü

1. **Temel ve ilk teslim:** Ortak Raporlar merkezi + metrik sözlüğü + tek istasyon tarihli satış özeti/fiş ayrıntısı + mevcut aylık/sayım raporlarına bağlantı. Yeni mali yazma yolu açmadan mevcut kaynağı kullan. Satış ödeme dağılımı ile gelir ayrımını bu aşamada doğrula.
2. **Satışın derinliği:** Ürün/kategori, kasa/kasiyer, iptal ve iadeler; kapsamlı sayfalama/CSV ve geçmiş etiket kuralları. Sonraki kampanya çalışmasının indirim snapshotları bu sözlüğe bağlanır.
3. **Stok ve satın alma:** Güncel değerleme/kritik/SKT/hareketsiz listesi, alış/teslim performansı; gerçek dönem devir analizi için gereken snapshot tasarımını ayrıca kararlaştır.
4. **Finans ve kontroller:** Güncel cari yaşlandırma, gerçekleşen nakit akışı/kart alacağı, gider/KDV/gün sonu ve raf farkı. Geçmiş yaşlandırma ve stok raporunu veri yeterliliğine göre aç.
5. **İleri analiz:** ABC ve karşılaştırmalar, yeterli geçmiş varsa devir/sepet analizi; varsayımlı tahminler ayrı ekran.

Her teslimde sentetik DEMO ile nakit/kart/karma/veresiye satış; kısmi ve başka gün iade; aynı kullanıcının iki cihazı ve farklı kullanıcıların kendi kasa oturumları; aynı-ID kayıp yanıt; transfer/ödemenin satışa katılmaması; kapalı gün geçmişinin korunması doğrulanır. İptal edilen sepet gerçek satışa eklenmez. Filtreli alt toplamlar doğru kapsamda ana toplamla mutabık olmalı; ürün raporunda ürün dışı gider için açıklamalı mutabakat farkı bulunabilir.

Satır çoğaltan JOIN'lerde satış, ödeme, iade ve olay sayıları önceden kendi tanelerinde toplanmalı; karma ödeme/çok parti/çok olay fişi çoğaltmamalı. Her rapor için kaynak ve toplama düzeyi tasarım sırasında kaydedilir. Eksik snapshot, sıfır maliyet ve bozuk kaynak sessizce tahmin edilmez.

Salt okunur rapor sorguları stok/defter/bakiye/revizyon/kapanış verisini değiştirmemeli. Yetkisiz kullanıcı/istasyon, dönem sınırı/gece yarısı, boş veri/sıfır payda, sayfalama, eşzamanlı yeni satış, geciken filtre yanıtı, CSV kapsamı ve 390 px görünüm test edilir. Büyük veri için istasyon+tarih/kaynak indeksleri ve sorgu planı ölçülür; her grafikte bütün geçmişi sınırsız tarama yapılmaz.

Bu plan belgesi uygulama kodunu veya DB şemasını değiştirmez. Yeni rapor tabloları/indeksleri ancak seçilen ilk teslimin sorgu tasarımı tamamlandıktan sonra netleşir; numara henüz ayrılmadı.

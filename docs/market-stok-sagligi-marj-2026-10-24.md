# Stokta bağlı para ve satış marjı uyarıları

24 Ekim 2026. **Raporlar** merkezine iki yeni sekme eklendi: **Stokta bağlı para** ve **Satış marjı uyarıları**. Bu teslim [rapor planının](market-raporlar-plani-2026-10-24.md) stokta bağlı tutar/hareketsizlik ve düşük marj incelemesini gerçekleştirir. Yeni migration veya bağımlılık yoktur; önceki 0020 dahil şema kullanılır. Kaynaklar GitHub main dalına kaydedilir; bulut ayar taslağı değiştirilmez.

## Stokta bağlı para

Ticari defter açılmış olmalıdır. Rapor **güncel kayıtlı net stok maliyet değerini** kullanır; bugünkü miktar × son alış fiyatı veya satış fiyatı değildir. Ürün miktarı, mali stok miktarı ve takipli üründe parti toplamı uyuşmalıdır. Katalog toplamı defterin INVENTORY bakiyesiyle de karşılaştırılır. Eksik/tutarsız kayıt varsa 409 döner; bugünkü alış fiyatından tahminle doldurulmaz. Sıfır stoklu yeni kartın henüz mali stok satırı olmaması, değeri sıfır olmak koşuluyla desteklenir.

Üst kartlar bütün katalogdaki stoklu ürün sayısını, toplam maliyet değerini ve 30/60/90+ gün hareketsiz stoklu ürünlerin değerini gösterir. Bu üç küme iç içedir; tutarları toplanmaz. Değer bütün eldeki stoğu, karantina/geçmiş SKT dahil, kapsar; muhasebe değer düşüklüğü veya satılabilir piyasa değeri hesaplanmaz. Partiler SKU değerine ikinci kez eklenmez. Satılabilir ve satışa kapalı miktarlar ayrı sütunlardır. Takipli üründe yalnız AVAILABLE ve SKT'si bugünden önce olmayan miktar satılabilir kabul edilir. Fizikî stok doğrulandığı anlamına gelmez.

Miktarlar ürünün temel birimiyle gösterilir; farklı birimlerin miktarları tek adet toplamına dönüştürülmez. Tablo ürünün güncel adı/barkodu/kategorisini, miktarını, maliyet değerini, son kayıtlı satışını, gözlem başlangıcını ve satışsız takvim gününü gösterir. Temel birimin kg olması kesirli terazi desteği sağlamaz.

### Hareketsizlik hesabı

Son satış günü yalnız ticari deftere bağlı POS satışlarından alınır. İade, mal kabul, sayım, fiyat/raf değişikliği son satış sayılmaz. İade edilen eski ürün bu nedenle yeni satılmış gibi görünmez.

Gözlem başlangıcı, ticari defter başlangıcı ve ürünün İstanbul tarihindeki oluşturulma gününden geç olanıdır. Satışsız gün gözlem kapsamından daha eskiye taşınmaz. Ürünün kapsamda hiç satışı yoksa bu başlangıçtan itibaren hesaplanır; işletme tarihinde hiç satılmadığı iddia edilmez.

- Stoğu sıfır olan ürün **Stok yok** durumundadır.
- Seçilen 30/60/90 günlük aralıkta kayıtlı satışı varsa, yeni kart olsa bile **Yakın dönemde satış var** görünür.
- Yakın satış görülmüyorsa ve gözlem seçilen eşiği kapsamıyorsa **Yeterli gözlem süresi yok** görünür.
- Yeterli gözlem ve eşik kadar satışsız gün varsa **Hareketsiz** görünür. Eşit sınır dahildir: 30 gün önceki son satış, 30 günlük eşikte hareketsizdir.

Bunlar takvim günü hesabıdır; başlangıç günüyle bugünün tarih farkı kullanılır. Eksik aktarılmış eski satışlar kendiliğinden tamamlanmaz. Yeni kurulmuş pilotta uzun geçmiş yoksa hareketsizlik sonucu sınırlı kalır. Tarihsel stok değeri, gerçek dönem ortalama stoğu veya stok devir hızı bu veriden üretilmez.

### Filtre, sayfalama ve güncellik

30/60/90 gün, bütün ürünler/hareketsiz/yeterli geçmişi olmayan/stoğu olmayan görünümü ve ad-barkod-güncel kategori metin araması vardır. Seçim **Stok raporunu getir / yenile** ile uygulanır. Eşleşen ürün sayısı/değeri filtreli kapsamı, üst kartlar bütün kataloğu gösterir. Tablo ve CSV yalnız mevcut 50 satırlık sayfadır. En fazla 5.000 ürün desteklenir; daha büyük katalog sessizce kesilmez, rapor limit hatası verir.

Stok sayfalaması güncel katalog/defter görüntüsünün hash'ini taşır. İlgili kart/miktar/değer/gözlem verisi, defter revizyonu veya gün değişirse eski sayfa devamı reddedilir; ilk sayfadan yenilenir. Böylece farklı anların güncel stok değerleri tek listeymiş gibi karıştırılmaz. Bu bir kalıcı stok arşivi veya DB yöneticisine karşı sertifikalı değişmez kayıt değildir.

## Satış marjı uyarıları

Tarih aralığı en fazla 366 gün, brüt marj eşiği %0–100 (iki ondalık), görünüm düşük marj/zarar uyarıları, yalnız zarar veya bütün hareketli ürünler olabilir. Varsayılan %10 işletme tercihidir; kanunla belirlenen veya her kategoriye uygun olduğu varsayılan kâr oranı değildir. Filtre değişikliği yenilemeyle uygulanır. Bu sekme tek istasyon ve tarih kapsamındadır; satış özeti sekmesindeki kasa/kasiyer seçimi buraya otomatik uygulanmaz.

**Brüt marj = (KDV hariç satış − satış anındaki maliyet) / KDV hariç satış.** Sonradan değişen maliyet, perakende fiyatı veya KDV geçmiş satışa uygulanmaz. Genel giderler ürünlere tahminen dağıtılmaz; gösterilen katkı net işletme kârı değildir. Marj kararları tam integer/BigInt tutarlarıyla verilir; ekrandaki yüzde gösterim hassasiyeti sınırı kararı değiştirmez. Sıfır satış tutarında veya gösterim sınırını aşan aşırı oranda yüzde gösterilmez; kayıtlı tutarlar ve uyarı korunur.

Raporda hem dönem ürün toplamı hem de özgün satış satırları incelenir. Aynı ürünün sonraki kârlı satışı, önceki zararına satışı gizlemez. Örneğin bir satışta −8 TL, diğerinde +10 TL katkı varsa ürün toplamı +2 TL olsa da **Zararına satış var** görünür. Eşiğin altındaki ancak zarar etmeyen özgün satırlar düşük marj sayacına girer. Üründe zarar uyarısı düşük marj durumuna göre önceliklidir; satır sayaçları ayrı kalır. Bunlar adet veya fiş sayısı değildir.

**Örnek zararlı satışı incele** bir kaynak fişi açar; bütün zarar olaylarının tam listesi değildir. Fişte başka ürünler de bulunabilir. Ürün adı/barkodu ve fiyat/KDV/maliyet fiş snapshotından gelir; resmî mali belge değildir. Ürün tablosunun adı/barkodu/birimi ise güncel karttır ve bu şekilde etiketlenmiştir.

Satış ve iade miktarı/tutarı ayrı gösterilir. Dönem net satış/maliyet/brüt kârı iade etkisini içerir; iadeler kendi kayıtlı iş gününe aittir. Yalnız eski satışın iadesi olan dönemde eksi katkı oluşması, yeni zararına satış diye işaretlenmez (**Yalnız iade etkisi**). Özgün satış dönemindeyse, daha sonra tamamen iade edilmiş olması kaynak satış uyarısını silmez; iade sonrası katkı ayrıca görünür.

Ürün net satış ve maliyet toplamları aynı aralık/kayıt sınırındaki mali defter SALES/SALES_RETURNS/COGS toplamıyla mutabık olmalıdır. Eksik veya değiştirilmiş kaynak maliyet 409 üretir; güncel maliyetten tamamlanmaz. İndirim/kampanya veya fiyat değişikliği bu rapor tarafından otomatik uygulanmaz.

Üst kartlar bütün dönem ürünlerini, eşleşen sayı seçilen uyarı görünümünü, tablo/CSV mevcut 50 satırlık sayfayı kapsar. Ürün kimliği sırasıyla sayfalanır; en zararlı ilk 50 sıralaması değildir. Bütün dönem toplamının yalnız CSV sayfası toplamı olmadığı açıkça belirtilir. Kayıt sınırı mevcut raporlardaki kesin BIGINT metni `asOf` ile korunur; yeni satış/iadeler için yenileme gerekir. En fazla 5.000 dönem ürünü; limit aşılırsa daha kısa aralık gerekir. Sabit mali kayıt sınırı ürün etiketlerinin tarihsel arşivi değildir.

## Yetki, mali etki ve teknik sınırlar

OWNER/MANAGER/ACCOUNTANT yalnız yetkili olduğu istasyonda okuyabilir; personel ve başka firma toplam/liste/ayrıntı alamaz. Sayfa ve CSV aynı yetkili API yanıtını kullanır; formül çalıştırmaya karşı mevcut CSV metin koruması sürer. Gerçek XLSX, rapor PDF'si veya otomatik gönderim eklenmedi.

Yeni GET uçları `/api/stationos/market-accounting/reports/stock-health` ve `.../margin-alerts` altındadır. Stok/maliyet/fiyat, mali fiş/bakiye/revizyon ve geçmiş kapanışlara yazmazlar; kapalı günde okunabilirler. Kalıcı rapor tablosu veya yeni mali işlem yolu yoktur. Büyük saha verisinde sorgu planı/yük kabulü ayrıca ölçülmelidir; 5.000 ürün sınırı üretim performans garantisi değildir.

## Windows güncellemesi

Proje/DB yedeğini alın, eski `pnpm dev` işlemini durdurun. `.env` dosyanızı koruyarak GitHub main kaynaklarını güncelleyin:

```powershell
pnpm install --frozen-lockfile
pnpm tsx server/stationos/migrate.ts
pnpm dev
```

Bu teslim yeni SQL göçü eklemez; önceki 0020 dahil kurulum gerekir. Yeni/boş DB için ilk `pnpm db:migrate` ayrıca gerekir. **Raporlar → Stokta bağlı para / Satış marjı uyarıları** üzerinden açılır. Bulutta kodlanması veya GitHub'a kaydedilmesi Windows dosyalarını otomatik değiştirmez. POS DEMO, erişilebilir ortak sunucu/LAN ve banka/mali cihaz sınırları korunur.

## Doğrulama

24 Ekim: 21 dosyada **125 test**, TypeScript ve son üretim build başarılı. On üç yeni test takvim günü/eşik, defter/ürün gözlem kapsamı, yeni kartta yakın satış, hiç gözlenmeyen satış ve sıfır stok, miktar/lot/değer uyumu, tam marj eşiği, toplam kâr içinde zarar/düşük marj satırını koruma, yalnız iade dönemi, tam iadede kaynak uyarısı, sıfır tutar ve aşırı oran/güvenli para sınırlarını kapsar.

Mevcut rapor HTTP paketi geliştirme ve üretimde açık sentetik DEMO fixture üretti (`SMOKE_LEAVE_OPEN=1`, kapanış bölümü bu koşuda atlanır). `scripts/smoke-stock-health.ts` yalnız açık `SMOKE_TEST=1`, loopback ve tam `istasyonos_pos_v2_test` socket DB korumasıyla aynı yeni fixture üzerinde iki modda geçti. Ortak gerçek mal kabul/satış/iade ve geçerli SKT'li partinin açık teyitle karantinaya alınması kullanıldı. Yeni alışta bilinmeyen SKT koruması gevşetilmedi; ilk test girdisi bu kurala uygun düzeltildi.

Stok değeri/defter, parti miktarı ve karantina, 53 hareketsiz stoklu ürün, 10 günlük yeni satışsız kart, iadenin eski satış tarihini koruması, 50+ ürün sayfalaması/arama, değişen stokta eski görüntü reddi; toplamı kârlı üründe zararlı satır, düşük marj eşiği, yalnız eski iade dönemi, 54 dönem ürünü/mali defter mutabakatı, marj `asOf`, değişen güncel fiyattan bağımsız kaynak fiş, eksik ve sayısal olarak yanlış maliyet, bozuk stok/lot/cache reddi, rol/tenant/girdi ve kapalı gün değişmezliği kontrol edildi. Script kasaları/günü kapatır.

Yaşlı geçmiş testinde sadece izole DEMO kart/defter/satış tarihleri açıkça sentetik olarak geçmişe çekilir; gerçek geçmiş kaydı olduğu iddia edilmez. Bozuk miktar/lot/bakiye/maliyet testleri aslına döndürülür. Gerçek/ortak DB'de çalıştırılmaz. Yeni fixture `SMOKE_REPORT_FIXTURE` ile verilir; tüketilmiş kapalı fixture tekrar kullanılmaz.

Chromium son geliştirme/üretimde masaüstü sahip, 390 px yönetici ve engellenmiş personel ile stok/arama/30-60-90/karantina/gözlem, CSV kapsamı, kart değişince eski sayfayı reddetme ve yenileme, marj eşiği/kaynak fiş, yalnız iade ve 50+4 ürün sayfalaması doğrulandı. Stok/bakiye/revizyon/kapanış değişmedi; JS hatası, haricî HTTP ve yatay taşma yoktu. Özel test erişimleri/CSV/görseller Git dışında `/workspace/stock-health-test` altındadır. Fizikî Windows/MySQL 8/yük kabulü yapılmadı. Kullanıcı fiyat listesi veya sırlar pakete eklenmedi.

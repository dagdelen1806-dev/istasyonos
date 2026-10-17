# Market satış ve alış iadeleri — 17 Ekim 2026

**Market muhasebesi → İadeler**, muhasebe açılışından sonra kaydedilmiş POS satışını veya mal kabulünü kaynak alır. Belge numarası, satış kimliği veya cari adıyla arama ve tarih aralığı vardır; kaynak belgeler 50'şer sayfalanır. Tam veya kısmi adet seçilebilir. İlk belgenin fiyat/KDV/maliyet bilgileri korunur; güncel fiyat veya KDV oranıyla geçmiş satış yeniden hesaplanmaz.

Bu özellik operasyonel stok/cari/para kaydıdır. İade faturası, e-belge veya bankadan otomatik kart iadesi düzenlemez. POS satışı mevcut DEMO sınırını korur.

## Kullanım

1. Market muhasebesinde istasyon seçin, **İadeler** sekmesini açın.
2. Müşteriden satış iadesi veya tedarikçiye alış iadesi türünü seçip kaynak belgeyi bulun.
3. Ürünlerin iade adetlerini girin. Belge adedi, önceki iadeler, kalan adet ve alış iadesinde mevcut stok gösterilir.
4. Net tutar, KDV, toplam, kaynak belgeden düşecek açık borç, para hareketi ve stok maliyetini kontrol edin.
5. İstasyon içinde benzersiz iade belge numarası ve en az beş karakterlik açıklama girin.
6. Para hareketi varsa merkez kasa veya banka hesabını seçip paranın gerçekten geri ödendiğini/alındığını teyit edin. Buton bankada işlem başlatmaz.
7. Son 50 iade geçmişte ve CSV'de görülebilir. Mali fişler ilgili günün hareket defterinde, cari mahsuplar ekstrede görünür.

İade kaydı firma sahibi veya muhasebeci tarafından yapılır. Yönetici kaynakları ve geçmişi okuyabilir. Kasiyere maliyet ekranı veya bağımsız para iadesi yetkisi açılmaz.

## Satış iadesi

- Satılan mal maliyeti, ilk satıştaki tutardan geri alınır; stoğa aynı özgün maliyet eklenir. Yalnız tekrar satılabilir ürünün stoğa alınması desteklenir. Hasarlı ürünün stoktan çıkarılması ayrı, açıklamalı sayım hareketidir.
- Net satış iadesi ayrı `SALES_RETURNS` hesabında izlenir; satış KDV'si ve satılan mal maliyeti azalır. Günlük satış ve kâr iadeler sonrası net tutarlardır. İade toplamı ve belge sayısı ayrıca gösterilir.
- Veresiyede önce **o kaynak belgenin** açık tutarı azalır. Başka satışın borcu sessizce kapatılmaz.
- Tahsil edilmiş kısım varsa kalan tutar müşteriye seçilen merkez kasa/bankadan geri ödeme olarak kaydedilir. Yetersiz bakiye veya para teyidi yoksa işlem bütünüyle reddedilir.
- Kartlı satışın manuel banka/merkez kasa iadesi, kart alacağından ayrıdır. İlk satışın kart alacağı kendiliğinden kapanmaz; gerçek banka/kart takasına göre manuel mutabakat gerekir.
- Satış çekmecesi doğrudan kullanılmaz. Merkez kasa iadesi POS'un ilk satışını veya çekmece kapanış beklentisini değiştirmez. Fiziksel para da seçilen hesaptan verilmelidir.

Örnek: 48 TL veresiye satışın 30 TL'si tahsil edilmişken 24 TL'lik ürün iadesi → kaynak belgenin kalan 18 TL borcu kapanır, 6 TL müşteriye geri ödenir. İlk tahsilat silinmez ve iade ikinci tahsilat olarak yazılmaz.

## Tedarikçiye alış iadesi

- Adet, ilk alıştan kalan adedi ve eldeki fiziksel stoğu aşamaz.
- Tedarikçi belge tutarı ve KDV ilk alıştan alınır. Fiziksel stok maliyeti, iade günündeki mevcut ağırlıklı maliyetten çıkar.
- İki net maliyetin farkı `PURCHASE_RETURN_VARIANCE` hesabında gider (+) veya gelir (−) olarak izlenir. Stok değeri negatif yapılmaz.
- Önce kaynak alışın ödenmemiş borcu azalır. Ödenmiş kısma isabet eden tutar tedarikçiden seçilen banka/merkez kasaya geri alınmış para olarak kaydedilir.

Örnek: 5 TL net maliyetli alış birimi, sonradan 7 TL'ye yükselmiş ağırlıklı stok maliyetinden iade edilirse 7 TL stok çıkar; ilk belgeye göre 5 TL net + KDV karşılığı kapatılır. 2 TL fark ayrı giderdir, tedarikçiye fazladan borç olmaz.

**Sınır:** Para henüz geri verilmediyse/alınmadıysa bu sürümde bekleyen iade alacağı/borcu, avans veya değişim kuponu açılmaz. Teyit kutusu gerçekleşmiş para hareketini ifade eder. Hasarlı ürün, fiyat farkı/iskonto belgesi, kaynaksız/açılış öncesi iade ve iadeyi geri alma akışı ayrıca geliştirme gerektirir.

## Kayıt bütünlüğü ve gün sonu

İade, stok adedi/değeri, cari mahsup ve dengeli fiş tek transaction'da kaydedilir. Önizleme sürümü veya tutar değişirse belge yeniden yüklenir. Yanıt belirsizse ilk istek kimliğiyle aynı sonuç alınır. Son adede iki ayrı iade geldiğinde biri kaydolur, diğeri güncel önizleme ister.

Belgede `settled_minor` gerçek tahsilat/ödemeyi, `credited_minor` iade mahsubunu tutar. Açık tutar `total_minor - settled_minor - credited_minor` olur. Sonraki ödemeler kalan tutara dağıtılır. Önceki tahsilat/ödeme ters fişle düzeltilirse yalnız kendi ödeme dağılımı geri alınır; iade mahsubu korunur.

Tam ödenmiş kaynak belgenin iadesinde cari bakiye değişmese bile iade ekstrede görünür. İade toplamı ve gerçek para hareketi açıklamada ve CSV'de ayrıca yer alır; sıfır cari değişimi para hareketi yokmuş gibi sunulmaz.

Kısmi iade özgün brüt tutarı, net tutarı, KDV'yi ve maliyeti kuruş kaybetmeden tüketir. Bir kuruşluk fiyat ve %100 KDV dahil küçük tutarlarda negatif KDV satırı oluşturulmaz.

İade bugünün Türkiye takvim tarihine yazılır; geçmiş satış/alış ve kapanış görüntüleri değiştirilmez. Bugün kapanmışsa yeni iade reddedilir, kaynaklar ve geçmiş okunabilir. İadeyi genel ters fişle silme/bozma engellenir.

Stok önerileri son 28 gündeki satış adedinden aynı dönemdeki satış iade adetlerini düşer; negatif sonuç sıfır kabul edilir. Tam satın alma siparişi veya tedarikçi SLA hesabı değildir.

## Windows / Laragon güncellemesi

Buluttaki değişiklik Windows klasörünüzü otomatik güncellemez. `pnpm dev` terminalini Ctrl+C ile durdurun, veritabanını yedekleyin ve `.env` dosyanızı koruyarak güncel GitHub kaynağını alın. Proje klasöründe:

```powershell
pnpm install --frozen-lockfile
pnpm tsx server/stationos/migrate.ts
pnpm dev
```

**`0012_market_returns` uygulanmalıdır.** Bu adımlar mevcut çalışan kurulum içindir; ilk kurulumda kullanıcı tablosu için kök README'deki `pnpm db:migrate` adımı da gerekir. Göç mevcut belge ve ödemeleri silmez; eski belgelerin iade mahsubu sıfır başlar. Önceki 0001–0011 dosyaları değiştirilmez. MySQL DDL örtük commit yapabilir; önce yedek/deneme kopyası kullanın. MariaDB 11.8.6 üzerinde mevcut kayıtlarla doğrulandı; gerçek Windows/Laragon ve ayrı MySQL 8 saha doğrulaması yapılmadı.

## Doğrulama

- TypeScript, 52 birim/sözleşme testi ve üretim derlemesi geçti. Büyük ana chunk ve runtime config script uyarıları sürer.
- `scripts/smoke-market-returns.ts`: rol/şirket/istasyon, muhasebeci yetkisi, güncel fiyat/KDV değişse de özgün belge tutarı, kısmi ödenmiş veresiye/alış, ödeme ters kaydı/yeniden ödeme, aynı istek tekrarı, son adet yarışı, yetersiz stok/para, mükerrer belge no, eski önizleme ve kapalı gün. Her fiş, stok, cari belge ve bakiye önbelleği mutabakatı ayrıca kontrol edilir.
- Mevcut market muhasebesi, ortak POS, kalıcı sepet ve iki mali imzalı vardiya paketleri yeni şemayla çalıştırılır.
- Chromium: satış/alış iade formu, para teyidi, kaydedilmiş iade yanıtını kesme/yenileme/tek kayıt, CSV, POS devri ve gün sonu. Kapalı günde belge okuma açık, yeni iade kapalıdır. 390px yatay taşma, JavaScript hatası ve dış HTTP isteği kontrol edildi. Özel fixture ve ekran görüntüleri Git dışında `/workspace/market-returns-test` altındadır.

Yazma testleri açık `SMOKE_TEST=1`, loopback ve tam adı `istasyonos_pos_v2_test` olan yerel socket DB gerektirir. Gerçek/paylaşılan üretim DB'sinde kullanmayın.

```bash
SMOKE_TEST=1 SMOKE_BASE_URL=http://127.0.0.1:3303 SMOKE_OUTPUT_DIR=/workspace/market-returns-test/dev node --env-file=/workspace/pos-v2-test/.env --import tsx scripts/smoke-market-returns.ts
```

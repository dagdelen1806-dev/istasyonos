# Satın alma siparişleri — 24 Ekim 2026

**Market muhasebe → Satın alma siparişleri**, kritik stok önerisini tedarikçi siparişine ve onaylı siparişi kısmi mal kabulüne bağlar. `0018_purchase_orders` göçü gerekir. Mevcut serbest mal kabul, cari, satış, sayım ve lot/SKT akışları korunur.

## Taslak ve stok önerisi

**Yeni sipariş taslağı** açıp market tedarikçisini seçin. **Tedarikçinin kritik stoklarını ekle**, o tedarikçiye atanmış kritik ürünlerin pozitif önerilerini taslağa alır. Başka ürünler elle eklenebilir; bir ürünün farklı tedarikçiden alınması yasaklanmaz. Tedarikçi değişince taslak satırları temizlenir. En fazla 100 ürün, satır başına 1–1 milyar temel birim sipariş edilebilir. Öneriler koli/paket katına yuvarlanır; formdaki adet koli sayısı değil ürünün temel birimidir.

Net alış fiyatı ve alış KDV oranı açıkça belirlenir. Bilinmeyen KDV tahmin edilmez; önceki net alış/ortalama maliyet yalnız başlangıç önerisidir. Toplamı sıfır plan kabul edilmez. Sipariş adı, beklenen teslim tarihi ve ürün/barkod/birim etiketleri saklanır. Taslak düzenlenebilir ve bu aşamada stok ya da cari borç doğmaz.

Stok önerisi artık **satılabilir mevcut stok + onaylı açık siparişin teslim edilmemiş adedi** üzerinden ihtiyacı hesaplar. Taslaklar, iptal edilen ve kalanı kapatılan siparişler buna girmez. Fizikî kritik stok uyarısı ve stok karşılama günü mevcut satılabilir adetten hesaplanmaya devam eder: yolda mal var diye raftaki eksik gizlenmez. Açık onaylı miktar stok ekranında ve CSV'de ayrıca gösterilir. Elle yeni sipariş açarken aynı ihtiyacın başka açık siparişte bulunabileceğini kontrol edin; bilinçli ek sipariş yasaklanmaz.

## Yönetici onayı ve revizyon

OWNER/MANAGER/ACCOUNTANT taslak oluşturup okuyabilir. **Siparişi onayla**, **Kalan fiyatı / tarihi revize et** ve **Kalan siparişi kapat / Siparişi iptal et** yalnız OWNER/MANAGER yetkisindedir. Kasiyer ve PURCHASER rolü bu maliyet ekranına erişmez; personelin mevcut el terminali toplama akışı ayrıdır.

Taslak onayında toplam ve sipariş sürümü doğrulanır, açıklama kaydedilir. İki farklı kişinin zorunlu onayı bu sipariş modülünde yoktur; OWNER kendi taslağını onaylayabilir. Eski vardiya hesaplarının iki farklı mali imza kuralı değişmez.

Onaydan sonra sipariş miktarları taslak gibi düzenlenemez. Fatura fiyatı/KDV farklıysa yönetici **yalnız teslim edilmemiş satırların** yeni net fiyatını, KDV'sini ve beklenen tarihini açıklamayla onaylar. Geçmiş teslimat tutarları ve mali fişler değişmez. Önceki/yeni plan olay kaydında saklanır; teslimat geçmişi hangi sipariş sürümüyle ne fiyat alındığını gösterir. Miktar/satır/tedarikçi değişikliği gerekiyorsa kalan sipariş kapatılıp doğru yeni taslak onaylanır.

Sipariş onayı kredi ayırmaz, stok rezervasyonu veya tedarikçi borcu oluşturmaz. Aynı tedarikçinin başka siparişleri borç sayılmaz. Gerçek mal kabulde güncel cari limit tekrar kontrol edilir. Sistem siparişi tedarikçiye e-posta/WhatsApp/API ile göndermez; CSV'yi işletme kendi yöntemiyle iletebilir.

## Kısmi veya tam teslimat

Onaylı siparişte **Teslimat kaydet** seçin. Belge numarası, ödeme vadesi, gerçekten gelen temel adetler ve fizikî teslimat teyidi gerekir. Vade varsayılanı bugünden tedarikçinin cari kartındaki gün sayısıdır. **Kalan adetleri doldur** isteğe bağlı kolaylıktır; fiilî teslimatı kontrol etmeden onay yerine geçmez.

Tek kabulde ürün başına en fazla 10.000 temel birim ve 100 ürün alınır; büyük siparişler birden çok teslimata ayrılır. Miktar kalan siparişi aşamaz. Fiyat/KDV onaylı kalan planla aynı olmalıdır; muhasebeci farklı fatura fiyatını yönetici revizyonu olmadan geçiremez. Takipli ürünlerde gerçek parti kodu/SKT/adet dağılımı zorunludur; aynı ürün birden fazla partiyle alınabilir. Kaynak dosya/ürün adına göre lot veya SKT üretilmez.

Sipariş kabulü ortak `recordMarketPurchase` kullanır. Tek transaction içinde fizikî/parti stokları, ağırlıklı net maliyet, alış KDV, tedarikçi borcu ve belge, dengeli PURCHASE fişi, siparişin teslim alınmış adedi, teslimat bağlantısı ve olay kaydı yazılır. Fatura tekrarı, cari limit, yanlış toplam, eski sipariş/defter sürümü veya lot hatasında bütün kayıt geri alınır. Aynı istek kimliği kayıp yanıttan sonra tekrarlandığında ikinci kabul veya borç oluşmaz. İki kullanıcı son adedi aynı anda almaya çalışırsa yalnız biri kaydedilir.

Her kabul belgesi kendi satırları üzerinden kuruşa yuvarlanır. Çok küçük tutarlı ayrı kısmi belgelerin toplamı, ilk tam siparişin tahmini KDV dahil toplamından farklı olabilir; fark tahminî plana zorla eşitlenmez. Teslimat geçmişindeki gerçek belge toplamları esas alınır. Tamamı sıfır tutarlı mal kabul mevcut ortak alış akışında desteklenmez; sıfır fiyatlı satırlar pozitif toplamlı belge içinde bulunabilir.

Bu sürümde bir kabul belgesi tek siparişe bağlıdır. Bir faturada birden fazla siparişi birleştirme veya daha önce serbest kaydedilmiş kabulü sonradan siparişe bağlama yoktur. Siparişe ait teslimatı bu ekrandan işleyin. Serbest mal kabul ve el terminalindeki bağımsız kabul taslakları sipariş adedini otomatik azaltmaz; aynı belgeyi tekrar sipariş kabulü olarak yazmak mükerrer belge korumasına takılır.

## Durumlar ve kalan miktar

- **Taslak:** Düzenlenebilir, gelen stok hesabına katılmaz.
- **Onaylı:** Açık kalan adedi önerilerde yoldaki mal sayılır.
- **Kısmi teslim:** Gerçek teslimatlar muhasebeleşmiştir; açık kalan adet öneride sayılır.
- **Tamamı teslim:** Sipariş miktarı tamamlanmıştır, açık miktar yoktur.
- **Kalanı kapatıldı:** Kısmi teslimler korunur; artık gelmeyecek bakiye öneriden çıkarılır.
- **İptal:** Teslimatsız taslak/onaylı plan kapanır; mali hareket oluşturulmaz.

Kapalı/iptal kayıtta **Teslim edilmemiş plan** tarihî yerine getirilmemiş miktarı gösterebilir; bu açık sipariş veya yeni borç değildir. Kapatma teslim edilmiş miktarı, belgeyi, borcu veya stoğu geri almaz. Alış iadeleri mevcut kaynak belgeye bağlı iade akışıyla yapılır; geçmiş teslimat adedini silmez ve siparişi kendiliğinden yeniden açmaz. Yeniden ihtiyaç varsa yeni sipariş hazırlanır.

Beklenen tarihi geçmiş açık onaylı/kısmi siparişler işaretlenir. Liste durum filtresiyle ve 50 kayıtlık sıralı imleçle sayfalanır. Sipariş CSV'si seçilen planı içerir; fiyat sütunu kalan için onaylı güncel fiyatı gösterir. Önceki teslimatların gerçek fiyatları geçmişte ayrı görünür. Ekran son 100 teslimat ve son 100 olayı gösterir; tam kayıt DB'de tutulur. Kayıtlar uygulama üzerinden silinmez; DB yöneticisine karşı sertifikalı değişmez arşiv değildir.

## Gün sonu, yetki ve bağlantı

Kapalı günde taslak, onay, fiyat/tarih revizyonu ve kalan kapatma yapılabilir; bunlar mali defteri veya kapanış anlık görüntüsünü değiştirmez. Gerçek mal kabul kapalı güne yazılamaz. Bütün yazılar mevcut istasyon → mali defter → sipariş → ürün/lot kilit sırası ve rol/tenant/CSRF/istek kimliği kontrolleriyle yürütülür. Sipariş sürümü her değişiklikte artar; eski sürümle başka cihazın planı ezilemez. Stok sürümü sadece gerçek kabulde ortak stok yazarıyla artar.

Belirsiz yanıt sonrasında **Aynı muhasebe isteğini kontrol et** kullanılır. Yeni kimlikle yeniden sipariş/kabul açılmaz. Bağlantı yokken yeni mali işlem kuyruğu, tedarikçi merkezi senkronizasyonu, fizikî tarayıcı SDK'sı veya gerçek banka/mali belge entegrasyonu bu özellikte eklenmedi.

## Windows güncellemesi

Eski `pnpm dev` işlemini durdurun, DB ve proje yedeğini alın. Kendi `.env` dosyanızı koruyarak güncel GitHub `main` kaynaklarını aktarın. Laragon MySQL açıkken:

```powershell
pnpm install --frozen-lockfile
pnpm tsx server/stationos/migrate.ts
pnpm dev
```

`0018_purchase_orders` yeni tabloları ekler; eski stok, belge veya kapanışları dönüştürmez. Göçler MySQL DDL nedeniyle örtük commit yapabilir; yedek önemlidir. Bulut kodlaması Windows dosya ve DB'sini kendiliğinden güncellemez.

## Doğrulama

17 dosyada **87 birim/sözleşme testi**, TypeScript ve üretim build başarılı. Sipariş toplamı BigInt ile hesaplanır; normal alışla aynı belge/satır yuvarlaması, kuruşlu kısmi belgeler, sıfır kalan, sıfır maliyetli karma satırlar, geçersiz miktar/KDV ve güvenli tutar sınırı kapsandı.

`scripts/smoke-purchase-orders.ts` yalnız `SMOKE_TEST=1`, loopback ve tam adı/socket yolu eşleşen ayrı `istasyonos_pos_v2_test` DB'sinde yeni sentetik DEMO kayıtları oluşturur. Geliştirme ve üretimde rol/tenant/CSRF, muhasebeci ve yönetici ayrımı, taslak/onay/revizyon/kapatmanın mali etkisizliği, gelen siparişin öneriye katılması, fizikî kritik uyarının korunması, eski sürüm/fazla adet/yanlış fiyat-teyit/önizleme reddi, lot/SKT ve çok partili kabul, mükerrer fatura/limit rollback, kısmi teslim, eski fiyatı koruyan revizyon, kalan kapatma, aynı-ID, son adet yarışı, kuruşlu kısmi belgeler, stok/defter mutabakatı ve kapalı gün koruması geçti. `SMOKE_LEAVE_OPEN=1` tarayıcı fixtürü hazırlar; bu koşu kapanış bölümünü çalıştırmaz ve sonuç bunu ayırır.

İki Chromium bağlamı geliştirme ve üretimde kritik stoktan taslak, yönetici onayı, muhasebeci mobil kısmi/tam kabulü, kalan fiyat revizyonu, eski teslim bedelinin korunması, CSV ve taslak/onay/kabulde kayıt sonrası yanıt kaybı/yenileme/aynı-ID tek etkiyi doğruladı. 390px yatay taşma, JS sayfa hatası ve haricî ağ isteği görülmedi. Mevcut stok/terminal/barkod/fiyat/sayım/aylık mutabakat HTTP paketi de son üretim/0018 ile geçti. Bu kontroller fizikî Windows/MySQL8/TC73 ve yasal mali belge saha kabulü değildir.

0018 mevcut verili ayrı test ve ana yerel bulut DB üzerinde uygulandı, tekrar göç no-op olarak doğrulandı. Özel test erişimleri ve ekran görüntüleri Git dışında `/workspace/purchase-order-test` altında tutulur; kullanıcı fiyat listesi, `.env`, DB ve parolalar kaynaklara eklenmez.

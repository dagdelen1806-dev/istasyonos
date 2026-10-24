# Raf etiketleri ve raf/kasa fiyat kontrolü — 24 Ekim 2026

**Market muhasebesi → Raf etiketleri** güncel perakende fiyatına göre etiket kuyruğu, kayıtlı baskı paketleri, A4/PDF ve ayrı fizikî yerleştirme teyidi sunar. **El terminali → Raf / kasa fiyat kontrolü** personelin rafta gördüğü fiyatı okutulan ürünün güncel perakende fiyatıyla karşılaştırır. `0019_shelf_labels` göçü ve açık ticari defter gerekir. Bu iç operasyon özelliği resmî mali belge veya tamamlanmış mevzuat uyumu değildir.

## Etiket hazırlama ve yerleştirme

1. Ürün kartında ana barkodu, adı, temel birimi, rafı, pozitif KDV dahil satış fiyatını ve açık satış KDV oranını tamamlayın. Sistem bilinmeyen KDV'yi tahmin etmez. Etiketler varsayılan perakende fiyatını kullanır; özel müşteri/fiyat listelerini kullanmaz.
2. Raf etiketlerinde **Etiket kaydı yok**, **Bilgi değişti** veya **Güncel** durumunu inceleyin. Bu durum son kaydedilen yerleştirme ile kart bilgisini karşılaştırır; raftaki kâğıdın gerçekten mevcut veya doğru olduğunu kanıtlamaz. Kuyruk en fazla 5.000 ürün okur; sayaçlar bu kümenin tamamını, arama ilk 100 eşleşen satırı gösterir. Daha büyük katalog için henüz sayfalama yoktur.
3. En fazla 100 ayrı ürün seçin; ürün başına 1–20 kopya, paket toplamında en fazla 500 etiket hazırlayın. Paket adı verin. Kaydedilen paket ürün adı, ana barkod, temel birim, raf, fiyat/KDV ve fiyat kaydı sürümünün anlık görüntüsüdür. Paket sonradan güncel karttan yeniden yazılmaz.
4. **A4 etiketleri yazdır / PDF** ile tarayıcı yazdırmasını açın. Şablon A4, 6 mm kenar, üç sütunda 66 × 40 mm etikettir. Ölçeği %100, tarayıcı üst/alt bilgilerini kapalı seçip önizlemeyi kontrol edin. PDF kaydı aynı şablonu kullanır. Yazdırma yalnız okuma yapar; pencereyi kapatmak veya PDF almak fizikî yerleştirme sayılmaz.
5. Etiketleri fizikî olarak doğru raflara taktıktan sonra ilgili ürünleri seçin, yerleştirme teyidini işaretleyin ve en az beş karakter açıklama girin. Sistem kişi, zaman, paket, ürün ve açıklamayı kaydeder. Kopya sayısı kadar ayrı raf konumunu takip etmez; yerleştirme kaydı ürün düzeyindedir.

Etiket üretimi desteklenen ana barkodu Code 128 olarak yerel SVG ile çizer; dış barkod servisine veri göndermez. Yalnız rakamlı 4–32 karakter veya yazdırılabilir ASCII 1–16 karakter desteklenir. Baştaki sıfırlar korunur. Bu, EAN/GS1 kontrol basamağı doğrulaması veya terazi etiketi ayrıştırması değildir. İki satırlık ürün adı alanı uzun adı kesebilir; fizikî baskı öncesi önizleyin.

Baskıda ürün adı, KDV dahil perakende fiyatı, KDV oranı, temel birim, ana barkod, raf ve **Fiyat kaydı** zamanı bulunur. Bu zaman fiyat geçmişinin kayıt zamanıdır; ayrıca doğrulanmış yasal yürürlük tarihi değildir. Menşe, kilogram/litre karşılaştırma birim fiyatı ve ürün grubuna özgü zorunlu açıklamalar üretilmez. Şablonu bütün ürünlerde mevzuata uygun nihai tüketici etiketi olarak kabul etmeyin. Hazır kesimli kâğıt ve fizikî yazıcı/okuyucu uyumu pilotta ayrıca denenmelidir; cihaz sürücüsü veya ESC/POS entegrasyonu eklenmedi.

## Değişen fiyatlar ve eski paketler

Ad, ana barkod, birim, raf, perakende fiyatı, satış KDV'si veya perakende fiyat kaydı sürümü değişirse eski etiket işaretlenir. Fiyat önce artıp sonra aynı tutara dönse de aradaki fiyat kaydı değişikliği eski paketi geçersiz kılar. Stok, net alış maliyeti, satın alma KDV'si ve özel fiyat listesi değişimi perakende etiketini tek başına eskitmez.

Paket hazırlanırken, yazdırma düğmesine basılırken ve yerleştirme kaydedilirken güncel bilgi yeniden kontrol edilir. Eski paketi yeniden kullanmak yerine güncel ürünlerden yeni paket hazırlayın. Yerleştirmede tek bir eski ürün bile bütün isteği geri alır. Yazdırma kontrolünden sonra açık kalan tarayıcı baskı penceresinde başka kişinin fiyatı değiştirmesini kilitlemez; fizikî yerleştirme anındaki ayrı kontrol bu yüzden gereklidir.

Son 20 paket ve son 50 fiyat kontrolü ekranda görünür; DB'deki geçmiş bunlarla sınırlı değildir. Liste CSV'si mevcut görüntülenen kapsamı, paket CSV'si seçili paketin kayıtlı içeriğini verir. Yerleştirme olayları uygulama üzerinden geçmişe eklenir; DB yöneticisine karşı sertifikalı değişmez arşiv değildir.

## El terminalinden raf/kasa kontrolü

Tarayıcı açabilen el terminalini mevcut **El terminali** menüsünden kaydedip yetkiliye onaylatın. Zebra/DataWedge veya barkodu klavye gibi gönderen okuyucu bu tarayıcı akışını kullanabilir; özel SDK gerekmez. Fizikî TC73 bu teslimde denenmedi.

Ana barkodu veya `pack_qty=1` adet barkodunu okutun. Birden fazla ürün içeren koli barkodu, birim raf fiyatıyla karışmaması için reddedilir. Sistem güncel KDV dahil perakende fiyatını ve varsa son yerleştirme fiyatını gösterir. Raftan fizikî okuduğunuz fiyatı girin, fizikî kontrol teyidini işaretleyin; farklıysa en az beş karakter açıklama yazın. Kaydetme onaylı ve devre dışı olmayan cihaz ister. Fiyat okuma sırasında değişmişse tekrar okutmanız gerekir.

Eşleşen kontrol de fiyat farkı da ayrı kayıttır; etiketi otomatik yerleştirildi saymaz. Fark kaydı satış fiyatını, mevcut sepeti veya indirimi kendiliğinden değiştirmez. Yetkili güncel kartı inceleyip etiket sürecini ayrıca yürütür; tüketici uyuşmazlığına ilişkin yasal fiyat uygulaması bu kayıtla otomatik kararlaştırılmaz.

OWNER/MANAGER/ACCOUNTANT paket, kuyruk ve geçmiş yönetir. MARKET_STAFF/PURCHASER yalnız tek barkod kontrolü yapabilir; maliyet ve stok adetleri bu yanıtta verilmez. Etiket yönetim ekranına erişemezler. Her okumada ve yazmada rol, şirket ve istasyon kapsamı denetlenir.

## Kayıt güvenliği ve mali etki

Yeni tablolar paketleri, paket satırlarını, son yerleştirmeleri, fizikî fiyat kontrollerini ve yerleştirme olaylarını tutar. Mevcut stok ve mali belge değiştirilmez. İşlemler mevcut istasyon → defter → ürün kilit sırasıyla, sunucuda güncel kart/fiyat geçmişi kilitli okumasıyla, CSRF ve aynı istek kimliği korumasıyla çalışır. Eski görüntü, eksik teyit veya geçersiz satır bütün yazıyı geri alır. Kayıp yanıt sonrasında ekrandaki aynı isteği kontrol etme yolunu kullanın; yeni kimlikle ikinci kayıt açmayın.

Hazırlama, yazdırma, yerleştirme ve fiyat kontrolü stok adedi/değeri, fiyat, cari, kasa/banka, KDV, defter revizyonu veya geçmiş kapanış anlık görüntüsünü değiştirmez. Kapalı günde de kullanılabilir. Mevcut POS DEMO sınırı ve aynı sunucu/LAN'a erişim gereksinimi sürer; bağlantısız tarayıcı mali kuyruğu veya merkez senkronizasyonu eklenmedi.

## Windows / Laragon güncellemesi

Proje ve DB yedeğini alın, eski `pnpm dev` işlemini durdurun. Kendi `.env` dosyanızı koruyarak GitHub `main` kaynaklarını güncelleyin. Proje klasöründe:

```powershell
pnpm install --frozen-lockfile
pnpm tsx server/stationos/migrate.ts
pnpm dev
```

Yeni göç `0019_shelf_labels` dahil uygulanır. Yeni/boş DB için ayrıca ilk `pnpm db:migrate` gerekir. `http://localhost:3000` ile açın; `istasyonos.test` mevcut Laragon proxy ayarınıza bağlıdır. Bulut kodlaması Windows dosyalarını kendiliğinden güncellemez. Bağımlılık veya lockfile değişmedi.

## Doğrulama

24 Ekim: 18 dosyada **94 test**, TypeScript ve üretim derlemesi başarılı. Yedi yeni alan testi Code 128 B/C/geçiş/kontrol değeri/sınırlar, kuruş hassasiyeti, etiket değişim kuralları, bilinmeyen KDV ve pozitif fiyat gereğini kapsar. 107 barkod deseni ayrıca ReportLab referans tablosuyla karşılaştırıldı; gerçek cihazda barkod okutulduğu anlamına gelmez.

`SMOKE_TEST=1` ve yalnız loopback + tam `istasyonos_pos_v2_test` socket DB korumasıyla `scripts/smoke-shelf-labels.ts` geliştirme/üretimde geçti: rol/tenant/CSRF, paket sınırları, eksik KDV, aynı-ID, eski sürüm, birim/koli, cihaz onayı/iptali, personel gizliliği, fizikî teyit/açıklama, tümü-ya-da-hiçbiri yerleştirme, değişmez paket, stok/maliyet/özel liste değişiminde etiket korunması, geri dönen fiyatın eski paketi eskitmesi ve kapalı gün mali değişmezliği. `SMOKE_LEAVE_OPEN=1` yalnız tarayıcı fikstürünün kapanış adımını atlar; bu koşu kapanış kanıtı değildir. Mevcut stok/terminal/fiyat/sayım/aylık mutabakat HTTP paketi son üretim/0019 üzerinde de geçti.

İki Chromium oturumu ile masaüstü yetkili ve 390 px personel akışı geçti. Kayıt sonrası yanıt kaybı/yenileme/aynı-ID ile paket, yerleştirme ve kontrol tek kez kaydedildi. A4 PDF bağımsız okunarak bir sayfada iki etiket, fiyat ve baştaki sıfırlı barkod doğrulandı. Son üretimde ve geliştirmede yazdırma anındaki yeniden kontrol eski paketi durdurdu. CSV, fizikî teyit, fiyat farkının yetkilide görünmesi ve değişmeyen mali bakiyeler kontrol edildi; JS hatası, haricî HTTP ve mobil yatay taşma yoktu.

0019 mevcut verili ayrı test ve ana bulut geliştirme DB'sine uygulandı; tekrar çalıştırma etkisizdi. Salt okunur ana tanı HTTP/HTML/JS/401/SELECT 1/kullanıcı şeması ve 19 göçle geçti. Gerçek Windows/MySQL 8/yazıcı/okuyucu saha kabulü yapılmadı. Sentetik DEMO erişimleri, test sonuçları ve kullanıcı fiyat listesi Git'e/pakete eklenmedi.

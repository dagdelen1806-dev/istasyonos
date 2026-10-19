# El terminalinde parti sayımı — 19 Ekim 2026

**El terminali → Stok sayımı**, lot takibi açık ürünlerin mevcut partilerini ayrı ayrı sayabilir. `0017_terminal_lot_counts` göçü gerekir. Toplam ürün sayımı takip kapalı ürünlerde önceki gibi çalışır. Tarayıcı cihazının yönetici tarafından onaylanmış olması ve aynı sunucuya bağlanması gerekir; fizikî TC73 SDK'sı veya bağlantısız okutma kuyruğu eklenmedi.

## Personelin sayımı

1. Onaylı cihazdan **Stok sayımı** taslağı açın veya ortak kayıtlı taslağı seçin.
2. Ürün barkodunu okutun. Takipli üründe **Sayılacak parti** alanından fizikî etiketteki kod/SKT'yi seçin. Barkod tek başına hangi partinin elde olduğunu doğrulamaz.
3. **Üzerine ekle** ile miktar biriktirin veya **Miktarı değiştir** ile o partinin gerçek toplamını girin. **0** ancak Miktarı değiştir ile girilebilir. Koli barkodunda tanımlı iç adet uygulanır; doğrudan temel birim için ana ürün barkodu kullanılır.
4. Ürün kartındaki **Partiler** ayrıntısından sayılmış/sayılmamış partileri ve etiketleri kontrol edin. **Partiyi say** düğmesi ilgili satırı forma taşır. Ürün/raf/barkod araması parti kodunu da arar.

Sayılmayan parti sıfır kabul edilmez. Sayımın bir kısmı toplanmış olsa da kalan partiler olduğu gibi korunur. Kayıtlı stok ve maliyetler personel API'sinde `null` döner; personel yalnız kendi topladığı parti adetlerini görür. Ürün başlığındaki toplam, personelde sayılan partilerin toplamıdır; gizli stok dahil tahminî toplam gösterilmez. Yetkili başlıkta işlem sonrası toplamı ve mevcut stoğu görebilir. CSV, parti kodu/SKT/durum ve sayılan adetleri içerir; personelin kayıtlı stok alanları CSV'de de boştur.

Mevcut sıfır adetli parti yeniden sayılabilir. Sayım olmayan bir parti için tarih/kod uydurmaz; yeni etiketli mal ilgili kabul veya Lot ve SKT açılışıyla kaydedilmelidir. Karantina, geçmiş veya bilinmeyen SKT sayılabilir fakat sayımla satışa açılamaz; durum ve tarih korunur.

## Başka cihaz veya satış stoku değiştirirse

Ortak taslağın her okutması sürüm kontrollüdür. İki cihaz aynı sürümle yazarsa biri kaydedilir, diğeri güncel taslağı yenilemelidir. Parti yanlış ürüne aitse veya taslak başlangıcında yoksa istek reddedilir. Yeni gelen partiler veya satış/iade/sayım/durum değişiklikleri ürünün `stock_version` değerini değiştirir; toplam stok aynı kalsa bile eski sayım kullanılamaz.

**Yeniden say**, açıklamayla o ürünün bütün parti sayımlarını temizler ve güncel partilerden yeni başlangıç alır. Ardından fizikî ürün tekrar sayılır. Bir partiyi yeniden tabanlayıp diğer eski sayımları yeni stokla karıştırmaz. Başka ürünlerin topladığı sayımlar korunur.

Göç öncesinden kalan toplam sayım taslaklarına parti dağılımı tahmin edilmez. Takipli ürünün toplam adedini tek başına değiştirerek lot stoğu atlanamaz. Mevcut taslakta **Yeniden say** kullanmak gerçek güncel partileri ekler; yeni sayım taslağı açmak da mümkündür.

## Yetkilinin mali onayı

OWNER/MANAGER/ACCOUNTANT aynı taslağı açıp her sayılan partinin önceki/yeni adedini ve net maliyet önizlemesini görür. Eksikler ürünün güncel ağırlıklı net maliyetiyle, fazlalar yetkilinin girdiği KDV hariç net birim maliyetle hesaplanır. Aynı ürünün sayımdaki bütün parti fazlaları aynı kabul edilen birim maliyeti kullanır; sıfır maliyet açık teyit gerektirir.

Bir partide eksik, diğerinde fazla varsa **iki fark da ayrı hesaplanır**. Örneğin net ürün adedi değişmese bile fazla için seçilen maliyet farklıysa stok değeri ve faaliyet sonucu değişebilir. Kayıp maliyeti ürün bazındaki toplam eksik üzerinden bir kez kuruşa yuvarlanır; her partiyi ayrı yuvarlayarak tutar farkı oluşturulmaz. Tam stok eksilmesinde kalan net değer tamamen çıkarılır.

Onayda parti miktarları, ürün miktarı/ağırlıklı maliyeti, mali stok, işaretli miktarlı stok hareketleri, parti olayları ve dengeli `STOCK_COUNT` fişi tek transaction içinde yazılır. `INVENTORY` ve `STOCK_GAIN`/`STOCK_LOSS` hesapları kullanılır. Cari borç, banka hareketi veya resmî vergi belgesi oluşturulmaz. Parti olayında sayımı yapan kişi/cihaz ve mali onay aktörü izlenir. Ürün toplamı sıfır net farkla aynı kalsa da parti değişikliği stok sürümünü artırır.

Yanlış önizleme, eski defter/taslak/stok sürümü veya gün sonu kapanışı tüm yazıyı geri alır. Kapalı günde okutma ve taslak saklama sürebilir; mali onay yapılamaz. Sayım ve mali onay sonrasında yanıt kaybolursa **Aynı işlemin sonucunu kontrol et** ile özgün istek kimliği korunur; ikinci mali fiş veya çift okutma oluşmaz. Bu, bağlantı yokken yeni satış/sayım yazma desteği değildir.

## Windows güncellemesi

Veritabanı yedeğini alın, çalışan `pnpm dev` işlemini durdurun. Kendi `.env` dosyanızı koruyarak güncel GitHub `main` kaynaklarını aktarın. Laragon MySQL açıkken proje terminalinde:

```powershell
pnpm install --frozen-lockfile
pnpm tsx server/stationos/migrate.ts
pnpm dev
```

`0017_terminal_lot_counts` uygulanır. Göç eski stok/maliyet/parti miktarlarını ve kapanışları değiştirmez; mevcut toplam taslaklar eski davranışları korunarak kalır. Bulut geliştirmesi Windows dosyalarınızı otomatik güncellemez.

## Doğrulama

15 dosyada **75 test**, TypeScript kontrolü ve üretim derlemesi geçti. `scripts/smoke-terminal-lots.ts` yalnız açık `SMOKE_TEST=1`, loopback ve tam adı/socket yolu eşleşen ayrı `istasyonos_pos_v2_test` DB'sinde sentetik DEMO kayıtları oluşturur. Geliştirme ve üretim kontrolleri rol/tenant/cihaz, stok/maliyet gizleme, yanlış parti, paralel sürüm, sıfır net miktarda iki ayrı mali fark, sayılmayan parti, yanlış önizlemede rollback, eski toplam taslak uyumluluğu, yeniden sayım, SET 0, sıfır maliyet teyidi, aynı-ID, olay/hareket izi ve dengeli defter/gün sonunu kapsar. `SMOKE_LEAVE_OPEN=1` yalnız tarayıcı fixtürü içindir; bu koşu gün sonu bölümünü çalıştırmaz ve sonuç bunu ayırır.

İki ayrı Chromium bağlamı geliştirme ve üretimde 390px personel terminali/masaüstü yetkili, parti CSV'si, gizlilik, sayılmayan parti/karantina koruması ve hem okutma hem mali onayda yanıt kaybı/yenileme/aynı-ID tek kayıt kontrolünü geçti. JS sayfa hatası, haricî ağ isteği ve yatay taşma görülmedi. Mevcut stok/terminal ve lot/SKT/FEFO/iade/fire HTTP paketleri de son üretim/0017 ile geçti. Fizikî Windows/MySQL8/TC73 ve enerji/ağ kesintisi saha kabulü ayrıca gerekir.

Özel test erişimleri ve ekran görüntüleri Git dışında `/workspace/terminal-lot-test` altında tutulur; kullanıcı fiyat listesi, `.env`, DB ve parolalar kaynak paketine eklenmez.

# Market kasa V2 — 17 Ekim 2026

Bu sürüm, mevcut kasa pilotunu sunucuda kalıcı sepetler ve izlenebilir iptaller üzerine yeniden düzenler. Gerçek satış için mali belge ve banka/donanım bağlantısı kabulü tamamlanmış değildir; sunucudaki DEMO sınırı korunur.

## Kasa akışı

- Barkod + Enter, ad/barkod arama, toplu adet ekleme, dokunmatik ürün kartları ve tarayıcıda saklanan favoriler.
- F2 barkod alanı, F4 bekleyen sepetler, F8 beklemeye alma, F9 nakit alanı. Kısayollar ödeme göndermez; açık iletişim kutusunun arkasındaki işlemleri tetiklemez.
- Sepet, ilk ürün eklemesinden itibaren sunucuda saklanır. Sayfayı yenilemek sepeti silmez. Aynı kullanıcı ve aynı tarayıcı kimliği için istasyonda tek aktif sepet bulunur; ayrı bilgisayarların sepetleri ayrıdır.
- **Beklemeye al** sepeti isteğe bağlı etiketle saklar. **Bekleyen sepetler → Sepeti çağır** işlemi, aynı istasyonda satış yetkisi ve açık kendi kasa oturumu olan kullanıcıya sepeti devreder. Mevcut aktif sepet önce bekletilmeli veya iptal edilmelidir. Bir bekleyen sepeti eşzamanlı çağıran iki cihazdan yalnız biri kazanır.
- **−** bir adet iptaliyle açılır; çöp kutusu tüm satır adedini önerir. Adet değiştirilebilir. En az beş karakterlik açıklama zorunludur. **Sepeti iptal et** de açıklama gerektirir. Önce/sonra satırları, ürün adı/barkodu/fiyatı, kasiyer, cihaz, saat, sürüm ve istek kimliği kaydedilir.
- **İptal geçmişi** son 50 adet/sepet iptalini gösterir. MARKET_STAFF yalnız kendi iptallerini; OWNER/MANAGER/ACCOUNTANT yetkili istasyondaki kayıtları görür. Kayıtları değiştiren/silen uygulama uç noktası yoktur. Bu özellik veritabanı yöneticisine karşı değiştirilemez arşiv taahhüdü değildir.
- Nakit, kart beyanı ve nakit + kart karma ödeme. Hızlı nakit tuşları ve para üstü gösterimi bulunur. Karma ödemede çekmeceye yalnız nakit payı eklenir; kart payı ayrıca izlenir. Kart için kasiyer teyidi zorunludur; uygulama bankadan onay almaz.
- Fiyatlar satış anında sunucuda doğrulanır. Beklemiş sepette fiyat değiştiyse **Güncel fiyatlar** ile açıkça yenilenir ve yeni toplam incelenir. Sepeti bekletmek/çağırmak stoğu rezerve etmez; stok ödeme transaction'ında kontrol edilip düşer.

Aynı kullanıcı farklı bilgisayarlardan **Mevcut kasaya katıl** ile aynı kasayı kullanmaya devam eder. Açılış parası bir kez, bakiye ve kapanış ortak, sepetler ayrıdır. Kasa kapanışı başka cihazda aktif kalan sepeti silmez: sepeti bekletip yeni açık kasa oturumunda çağırabilirsiniz. Yeni oturum eski cihaz üyeliklerini devralmaz.

## Veri ve tekrar güvenliği

Yeni `0009_pos_carts.sql`, `st_pos_carts` ve `st_pos_cart_events` tablolarını ekler. `0010_pos_mixed_payment.sql`, eski satışların nakit/kart paylarını mevcut ödeme türünden doldurur ve toplam payların satış toplamına eşitliğini denetler. Önceki uygulanmış göç dosyaları değiştirilmez.

Yeni POS işlemleri: `/pos/cart/add`, `/reduce`, `/hold`, `/resume`, `/cancel`, `/reprice` (ilk tam yol hariç hepsi `/pos/cart` önekiyle). Her biri şirket/istasyon/rol ve CSRF denetimine tabidir. Aktif sepet değişiklikleri kullanıcı, cihaz ve gözlenen sepet sürümüyle doğrulanır. Bekleyen sepet sahipliği transaction kilidiyle devredilir. Sepet ve stok/tahsilat güncellemesi birlikte commit edilir.

V2 checkout, `cartId`, `cartVersion` ve `sessionId` gönderir; satırlar sunucudaki sepetten alınır. Aynı istekte ayrıca `lines` gönderilmesi reddedilir. Eski istemcilerin doğrudan `lines` checkout yolu uyumluluk için korunur, ancak aynı kullanıcı/cihazda aktif V2 sepet varken kullanılamaz. Eski yoldaki taslak sepet hareketlerinin iptal geçmişi yoktur; tüm yeni kasa ekranı V2 yollarını kullanır.

Belirsiz yanıt alan istek, gönderilmeden önce kaydedilen aynı `requestId` ile yeniden sorgulanır. İstek sessionStorage'da kullanıcı/istasyon/cihaz kapsamıyla tutulur. Yeniden yükleme veya kayıt sonrası yanıt kaybında yeni kimlikle ikinci satış gönderilmez. Bu koruma tarayıcının özel verilerinin kullanıcı tarafından silinmesini engellemez. Tarayıcı cihaz kimliği güçlü fiziksel cihaz kimlik doğrulaması değildir.

## Rakiplerden çıkan gereksinimler

17 Ekim 2026'da aşağıdaki resmî ürün sayfaları okunmuştur. Tablo üreticinin duyurduğu kapsamı özetler; donanım üzerinde bağımsız kabul testi, fiyat teklifi veya bütün sürümlere yönelik garanti değildir.

| Kaynak | Sayfada duyurulan ilgili özellikler | İstasyonOS'a etkisi |
| --- | --- | --- |
| [Nebim V3 POS](https://www.nebim.com.tr/tr/nebim-v3-pos) | Dokunmatik/kısayollar, askıya alma, çoklu ödeme, iade/değişim, yerel DB ile offline mimari, mali ve EFT-POS entegrasyonları | Kalıcı sepet ve karma ödeme eklendi. Yerel sunucu esas alınmalı; iade ve sağlayıcı adaptörleri ayrıca geliştirilmelidir. |
| [Mikro Hızlı Satış](https://www.mikro.com.tr/mikro-hizli-satis/) | Parçalı ödeme, dokunmatik tema, çevrimiçi/çevrimdışı çalışma, terazi, yeni nesil yazarkasa ve kasada e-Arşiv | Karma ödeme ve hızlı ekran eklendi. Terazi, mali cihaz ve merkez aktarımı henüz bağlı değildir. |
| [AKINSOFT WOLVOX Hızlı Satış](https://www.akinsoft.com.tr/programlar/detay/wolvox-hizli-satis-programi--wwh9) | Barkod/perakende satışı, fiyatmatik, yazarkasa ve terazi entegrasyonu, barkod üretimi | HID barkod girişi desteklenir. Fiyatmatik/terazi/yazıcı adaptörleri model bazında kabul edilmelidir. |

Bu karşılaştırma, tüm rakip özelliklerinin tamamlandığı anlamına gelmez. Sonraki teslimatlar: satışa bağlı kısmi/tam iade ve geri ödeme; yetkili indirim/kampanya; tartılı ürün ve fiyat etiketleri; mali belge ve banka adaptörleri; merkez aktarımı ve mutabakat; yedek/geri yükleme ve gerçek Windows donanım pilotu. Tamamlanmış satışı değiştirerek veya silerek iptal etme yolu eklenmemiştir.

## Yerel sunucu ve internet kesintisi

```text
Kasa A tarayıcı ─┐
                ├─ Market içi sunucu + MySQL/MariaDB ── internet ── Merkez (henüz bağlı değil)
Kasa B tarayıcı ─┘
```

Yerel sunucuya yerel ağdan ulaşıldığında bağımsız giriş, ürünler, sepetler ve DEMO satış için haricî servis gerekmez. Bu sürümde merkez gönderen/alıcı worker ve stok çakışma mutabakatı yoktur; `st_pos_events.delivery_status=NOT_CONFIGURED` sürer. Tarayıcı service worker'ı hassas API verisini veya satışları cache etmez. Yerel ağ/sunucu kesildiğinde bağımsız cihazdan satış tamamlama uygulanmamıştır. Sonuç bekleyen işlem, sunucuya tekrar ulaşılınca aynı kimlikle kontrol edilir.

İki bilgisayara iki ayrı veritabanı kurmak ortak kasa oluşturmaz; ikisi de marketteki aynı sunucu adresine bağlanmalıdır. Sunucu bilgisayarının elektriği ve yerel ağ ayrıca çalışıyor olmalıdır. Tarayıcının internete çıkışını engellemek, fiziksel modem/ağ/güç kesintisi kabul testi yerine geçmez.

GİB'in [Yeni Nesil ÖKC](https://ynokc.gib.gov.tr/) sayfasında mevzuat, onaylı firmalar ve teknik protokoller bulunur; bu giriş sayfasına erişim doğrulanmıştır. İşletmenin mükellefiyet/mali belge akışı ve cihaz modeli bu projede henüz doğrulanmamıştır. Banka POS sonucu, basit termal çıktı ve mali belge durumu ayrı izlenmelidir. Güncel yükümlülükler uygulanacak işletme ve yetkili sağlayıcıyla doğrulanmadan DEMO satış kapısı kaldırılmamalıdır.

## Windows / Laragon güncellemesi

1. Mevcut veritabanının yedeğini alın; çalışan geliştirme terminalinde Ctrl+C kullanın.
2. Güncel GitHub kaynağını alın. Kendi `.env` dosyanızı koruyun. Eski veritabanını yeniden oluşturmayın.
3. VS Code terminalinde proje klasöründe çalıştırın:

```powershell
pnpm install --frozen-lockfile
pnpm db:migrate
pnpm tsx server/stationos/migrate.ts
pnpm dev
```

`0009_pos_carts` ve `0010_pos_mixed_payment` uygulanmalıdır. Ardından Satış kasası menüsünü açın. Native Laragon kurulumu için Docker gerekmez. Aynı portta ikinci `pnpm dev` başlatmayın. Bulut ortamındaki dosya güncellemesi Windows bilgisayarınıza kendiliğinden taşınmaz.

## Geliştirme doğrulaması

`pnpm check`, 37 birim/sözleşme testi ve üretim derlemesi. Derlemede mevcut büyük ana chunk ve runtime config script uyarıları sürer.

Ayrı yerel test veritabanında önce `scripts/smoke-pos.ts`, sonra `scripts/smoke-pos-carts.ts` çalışır. İkincisi yalnız `/istasyonos_pos_v2_test` ve yerel Unix socket için açılır; fiyat değişimini test fixture ürününde doğrudan değiştirir. Gerçek/paylaşılan veritabanında çalıştırmayın.

```bash
SMOKE_TEST=1 SMOKE_BASE_URL=http://127.0.0.1:3301 SMOKE_OUTPUT_DIR=/workspace/pos-v2-test/legacy node --import tsx scripts/smoke-pos.ts
SMOKE_TEST=1 SMOKE_BASE_URL=http://127.0.0.1:3301 SMOKE_POS_FIXTURE=/workspace/pos-v2-test/legacy/fixture.json SMOKE_OUTPUT_DIR=/workspace/pos-v2-test/carts node --env-file=/workspace/pos-v2-test/.env --import tsx scripts/smoke-pos-carts.ts
```

HTTP denemeleri: sepet kalıcılığı, stok değişmemesi, açıklamasız iptal reddi, iptal anlık görüntüsü, yanlış cihaz/eski sürüm, aynı bekletme isteğinin tekrarı, iki cihazın çağırma yarışı, fiyat değişimi, karma ödeme/para üstü, tek satış, ortak kapanış ve kapanmış oturumdan sepet kurtarma. Test fixture erişimleri Git dışında tutulur.

Bu çalışma sırasında iki HTTP paketi geliştirme ve üretim sunucularında geçti. Eski vardiya/muhasebe smoke testi de üretimde geçti. İki ayrı Chromium oturumunda gerçek arayüzden barkod/toplu adet, zorunlu iptal nedeni, yenilemede sepet kalıcılığı, A'dan B'ye sepet devri ve karma ödeme doğrulandı. Sunucu satış kaydını oluşturduktan sonra yanıt bilerek kesildi; sayfa yenilenip aynı istek kontrol edildiğinde tek satış kaldı. Tarayıcıların tüm haricî HTTP istekleri engelliydi ve haricî istek oluşmadı; `crypto.randomUUID` kapatılarak HTTP alan adı için UUID alternatifi de denendi. 390px görünümde yatay taşma ve JavaScript sayfa hatası görülmedi. Bunlar gerçek Windows donanımı, fiziksel internet/ağ kesintisi veya mevzuat kabul testi değildir.

Eski satış göçü ayrıca geçici tabloda denendi: eski nakit ve kart kayıtları doğru paylara taşındı; pay toplamı satış toplamından farklı yeni kayıt veritabanında reddedildi.

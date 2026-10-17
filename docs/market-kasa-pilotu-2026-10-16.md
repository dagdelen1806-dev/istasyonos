> 17 Ekim 2026: Bu belge ilk pilotun tarihsel kapsamını anlatır. Kalıcı/bekleyen sepet, açıklamalı iptal ve karma ödeme artık [Kasa V2](market-kasa-v2-2026-10-17.md) ile uygulanmıştır; güncel sınırlar ve kurulum için yeni rehberi okuyun.

# Market satış kasası — ilk pilot

**Ortak kasa güncellemesi:** `0008_shared_register_devices.sql` migration’ı ile aynı kullanıcı iki bilgisayarda aynı açık kasa oturumuna katılabilir. Ayrıntılar aşağıdadır.

Hedef aynı donanımda İstasyonOS çalıştırmaktır; görseldeki başka satış yazılımıyla veri alışverişi kapsamda değildir. Dokunmatik Windows kasa ekranı, klavye gibi veri gönderen barkod okuyucu ve market içindeki yerel sunucu temel alınır. IROMX WR982DM’nin gerçek ayarları/protokolü henüz cihaz üzerinde doğrulanmadı; bu sürüm HID klavye girişi + Enter davranışını bekler. Yazıcı ve para çekmecesi için modele özgü SDK/ESC-POS bağlantısı henüz yoktur.

## Çalışan kapsam

- `/kasa` ve **Satış kasası** menüsü: firma sahibi/yönetici kasa tanımlar, sahibi/yönetici/market personeli kasa açıp kullanır. Muhasebeci okuyabilir. Akaryakıt personeli ve satın alma rolü kasa uçlarına erişemez.
- Aynı kullanıcı farklı tarayıcılarda birden fazla kasada açık kalabilir. Farklı kasa kodlarının açılış para üstü, nakit satışı, kart beyanı, sayımı ve farkı ayrıdır. İki bilgisayarda aynı kasa kodu seçilirse ikinci bilgisayar **Mevcut kasaya katıl** ile aynı oturuma katılır. Sepetler bilgisayarlarda ayrıdır; bakiye ve kapanış ortaktır. Katılım açılış parasını tekrar eklemez. Bir fiziksel kasa kodunda aynı anda yalnız bir açık oturum bulunur. Browser cihaz kimliği yerel eşleştirmedir; donanım sertifikası veya güçlü cihaz enrollment değildir.
- Dokunmatik ürün düğmeleri, tam barkod eşleme, ürün arama, adetli sepet ve para üstü hesabı.
- Fiyat sunucudan alınır; istemcinin gördüğü fiyat değişmişse sessizce satış yapılmaz. Ürün adı/barkodu/fiyatı/adedi satış anlık kopyasına yazılır. KDV oranı/hesabı ve mali belge bu pilotta tanımlı değildir.
- Satış + satırlar + stok düşümü + stok hareket defteri + yerel olay kaydı tek transaction içindedir. Kasa oturumu ve ürünler kilitlenir. Son ürünü iki kasa aynı anda satamaz.
- Ağ yanıtı kaybolduğunda istek kimliği ve minimal sepet tarayıcı sessionStorage’ında korunur. Aynı kullanıcı/istasyon/tarayıcı yeniden açıldığında önceki istek aynı kimlikle kontrol edilir. Tekrar isteği ikinci satış oluşturmaz. Bu depoda kart bilgisi, kişisel müşteri kaydı veya auth token tutulmaz. Tarayıcı verilerini silmek bu kurtarma kaydını da silebilir; belirsiz işlemde yeni satış açmayın.
- Mali cihaz/gizlilik bağımlılıkları doğrulanmadığından checkout sunucuda **DEMO firmalarla sınırlandırılmıştır**. Bunu `.env` değişkeniyle üretime açan bir geçiş eklenmedi.

## Mali ve finansal sınırlar

Kart yöntemi `CARD_MANUAL`, sonucu `CASHIER_DECLARED` olarak tutulur; banka onayı değildir. Kart satışında kasiyer teyidi gerekir. Ham kart numarası veya kart fotoğrafı alınmaz. Nakit kaydı ve para üstü ayrıdır; kart tutarı çekmeceye eklenmez. Bütün demo satışlarında `fiscal_status=NOT_ISSUED_DEMO` bulunur. Bu uygulama banka POS slipini mali fiş saymaz ve fiş üretildiğini iddia etmez.

Market POS oturumları eski personel vardiya dosyalarından ayrıdır. POS satışları stok önerileri için mevcut `SALE` hareket defterine bağlıdır; eski `/stock` kaydını ayrıca tekrar girerek aynı satışı iki kez düşürmeyin. Yeni POS kayıtları eski `/payment` veya `/slip` tablosuna otomatik eklenmez. Patron konsolundaki eski vardiya satış toplamı bu POS pilotunun mali kapanış raporu değildir. İki farklı mali kişi onayı kuralı değişmedi; tek kullanıcının farklı kasaları iki kişi sayılmaz.

İade/iptal, karma ödeme, indirim/kampanya, tartılı ürün, mali cihaz ve otomatik vardiya mutabakatı sonraki geliştirmelerdir. Kayıtlı satışlar bu sürümde silinerek/düzenlenerek iptal edilmez.

## İnternet ve yerel çalışma

Yerel API/DB’ye erişim sürdüğü sürece dış internet olmadan demo kasa akışı çalışır. UI/API, yerel kullanıcı doğrulaması ve katalog yerel sunucudadır; haricî AI/banka çağrısı yapılmaz. Service worker satışları offline browser veritabanına kaydetmez; yerel ağ veya sunucu kesilirse satış sonucu belirsiz kabul edilir ve aynı istek kimliği korunur. Bu sürüm terminalin yerel sunucudan da bağımsız çalışmasını garanti etmez.

`st_pos_events` satışla aynı transaction’da oluşan yerel olay defteridir. `delivery_status=NOT_CONFIGURED`; merkeze gönderen worker/ack/çatışma çözümü henüz yoktur. Bu tablo merkez senkronizasyonunun tamamlandığı anlamına gelmez.

MariaDB snapshot/transaction çakışmaları için yalnız DB işlemleri olan POS mutation’ları, transaction geri alındıktan sonra aynı istek kimliğiyle en fazla üç kez denenir. Ödeme cihazı gibi dış yan etkili işlemler bu döngüye eklenmemelidir.

## Mevcut Windows / Laragon kurulumunu güncelleme

1. Mevcut proje klasörünü, `.env` dosyanızı ve veritabanınızı yedekleyin. Yedeği GitHub’a yüklemeyin.
2. Güncel kaynakları ayrı bir klasöre çıkarın. Eski `.env` dosyanızı bu klasöre yerelde kopyalayın; paylaşmayın. Eski klasörü silmeyin.
3. Eski `pnpm dev` sunucusunu Ctrl+C ile durdurun. Laragon MySQL/MariaDB çalışmaya devam etsin.
4. Yeni proje klasöründe:

```powershell
pnpm install --frozen-lockfile
pnpm db:migrate
pnpm tsx server/stationos/migrate.ts
pnpm dev
```

Migration additive’dir; mevcut kullanıcı ve finans tablolarını silmez. Yeni kasa tabloları eklenir. MySQL DDL tam transaction rollback garantisi vermez; migration öncesi yedek alın. MySQL 8/MariaDB modern sürüm hedeflenir; bu turda MariaDB 11.8.6 üzerinde test edildi, gerçek Windows/Laragon sürümü ayrıca doğrulanmalıdır.

Yeni test kullanıcısıyla firma kurarken **DEMO** seçin. Mevcut gerçek firmayı SQL ile DEMO’ya çevirmeyin. Test kullanıcısıyla bir DEMO istasyon kurup Market ve stok ekranından ürün/mal kabul ekleyin. Satış kasası ekranında istasyonu seçin, kasa tanımlayın, açılış para üstüyle açın ve barkod okutun. İkinci cihazda aynı kullanıcıyla giriş yapın: ortak bakiye istiyorsanız **aynı kasayı** seçip **Mevcut kasaya katıl** düğmesine basın; ayrı çekmece istiyorsanız **farklı kasa** açın. Aynı tarayıcının sekmeleri aynı yerel cihaz kimliğini paylaşır; kasa seçimleri kendiliğinden fiziksel cihaz kaydı değildir.

`istasyonos.test` için mevcut Laragon reverse proxy ayarı korunabilir. `randomUUID` bulunmayan yerel HTTP alan adlarında UUID üretimi kriptografik `getRandomValues` ile yapılır. Birden fazla sunucuyu aynı 3000 portunda açmayın.

## Bu sürümde doğrulananlar

- TypeScript ve üretim derlemesi; sekiz test dosyasında toplam 34 birim/sözleşme testi.
- Ayrı test veritabanında `scripts/smoke-pos.ts`: iki kasa/tek kullanıcı, rol ve tenant sınırı, yanlış cihaz, fiyat ve nakit reddi, tekrar istek, aynı istek yarışı, son stok yarışı, kart/nakit ayrımı, kapanış/açılış ve DEMO kapısı.
- Mevcut vardiya/nakit teslim/iki kişi mali onay smoke akışı da geçti.
- Chromium tarayıcıda barkod klavye girişi, 1366 ve 1024 piksel ekran, dış ağ istekleri engellenmişken yerel akış, `randomUUID` yokken çalışma ve kaydedilmiş satışın yanıtı kaybolduktan sonra sayfa yenileme/aynı isteği kontrol etme. İkinci satış veya ikinci stok düşümü oluşmadı.
- Fiziksel okuyucu, yazıcı, çekmece, banka POS’u veya gerçek Windows kasada donanım kabul testi henüz yapılmadı.

Otomatik test yalnız ayrı test DB’sinde çalıştırılır; DEMO dahil kalıcı fixture oluşturur:

```powershell
$env:SMOKE_TEST="1"
$env:SMOKE_BASE_URL="http://127.0.0.1:3000"
node --import tsx scripts/smoke-pos.ts
```

Fixture erişimleri varsayılan olarak ignored `.local/pos-smoke/` altında saklanır; paylaşmayın. Bu komut fiziksel cihaz veya mevzuat kabul testi yerine geçmez.

## İki bilgisayarda tek kasa

İlk bilgisayarda kasa açılır; ikinci bilgisayarda aynı kullanıcı ve istasyonla aynı kasa seçilip **Mevcut kasaya katıl** denir. Katılım yalnız bu kullanıcının açık oturumuna ve seçilen oturum sürümüne yapılır; kapanmış veya başka kullanıcının kasasına katılım reddedilir. Katılım isteğini tekrar göndermek ikinci oturum ya da ikinci açılış parası oluşturmaz.

Her bilgisayarın sepeti ve sonuç bekleyen istek kimliği ayrıdır. Satışlar aynı açık kasa oturumu altında tek bakiyeye eklenir. Satışın kaynak bilgisayar kimliği DB’de ayrıca tutulur ve son satışlarda gösterilir. Eski satışların cihaz kimliği migration sırasında eski tek cihazlı kasa oturumundan alınır.

Bakiye diğer bilgisayarda en geç 15 saniyede veya **Yenile** ile görünür. Kasa herhangi bir katılımcı bilgisayardan kapatılabilir; bu bütün katılımcılarda aynı oturumu kapatır. Sunucu kapalı oturuma yeni satış kabul etmez; ekran bunu sonraki yenilemede gösterir. Paylaşılan kasa kapanışında diğer bilgisayarların sepetlerini kontrol etmek için onay sorulur. Diğer bilgisayarda kalan sepet kendiliğinden satılmış veya iptal edilmiş sayılmaz.

Kasa tekrar açıldığında eski cihaz katılımları yeni oturuma otomatik taşınmaz. İkinci bilgisayar yeni oturuma tekrar katılır. `closed_by_device_id` kapanış yapılan bilgisayarı tutar. Tarayıcı kimlikleri fiziksel cihaz sertifikası değildir; gerçek cihaz enrollment ayrı iştir. Aynı kullanıcıyla birden fazla bilgisayar iki farklı mali onay kişisi sayılmaz.

Ortak kasa API ve iki ayrı Chromium oturumuyla doğrulandı: aynı kullanıcı/aynı kasa, katılım ekranı, paralel satışlar, tek açılış parası, satış başına cihaz izi, ortak kapanış ve yeniden açılışta eski katılımın taşınmaması. Fiziksel Windows kasalarındaki test hâlâ yapılmalıdır. DEMO sınırı ve mali cihaz/senkronizasyon eksikleri değişmedi.

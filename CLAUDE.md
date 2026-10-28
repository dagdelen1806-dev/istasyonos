> **28 Ekim SKT/fire raporu:** `docs/market-skt-fire-kontrol-2026-10-28.md`; yeni migration yok, 0021 gerekir. READ OWNER/MANAGER/ACCOUNTANT tenant/station. lot-control yalnız stoklu takipli partiler, 7/15/30 AVAILABLE geçerli tarih, bugün dahil; karantina/geçmiş/bilinmeyen çakışır, toplamları ekleme. Miktar p/i/lot mutabakatı, 5000 ürün/10000 parti, 50 sayfa ve canlı hash değişiminde 409. Son STATUS açıklaması yoksa neden tahmin etme. inventory-losses LOT_WRITE_OFF/LOT_COUNT/STOCK_ADJUST/STOCK_COUNT, mali STOCK_GAIN/LOSS doğrulaması; terminal countReportItems yeniden kullanılır. Ürün filtresi SKU mali tutarıdır, bütün fişi kopyalama; çok partide maliyet dağıtma. Tarihsel etiket yoksa güncel/kimlik açıkça işaretli, geçmiş SKT varsayma. 1000 fiş/20000 SKU satırı cap, kesin BIGINT asOf+seq/product cursor; fire ve sayım ayrı toplam. GET mali/stok/revision/close yazmaz; fizikî işlem ayrı eski akıştadır. Otomatik fire/indirim/karantina kaldırma yok. GitHub source güncellenir, bulut ayar taslağına dokunulmaz.

> **24 Ekim kategori/saat analizi:** `docs/market-kategori-saat-2026-10-24.md`, 0021 gerekir. POS ortak checkout kilitli p.category alanını category_snapshot olarak aynı transactionda yazar; NULL eski/bilinmeyen, boş string kayıtlı kategorisiz. Asla bugünkü kartla backfill etmeyin. İade özgün sale_line snapshotına bağlıdır. Binary kategori grupları ve kaynak tipi korunur; fallback label ile gerçek kategori adı birleştirilmez. GET sales-analysis OWNER/MANAGER/ACCOUNTANT tenant/station/filter/asOf; genel gider dağıtılmaz. Çok kategoride fiş sayıları toplanamaz; saat toplamında distinct eventId, para tutarları kategori/saat/salesReportMetrics ile mutabık. Mali aralık business_date, saat kaynak created_at UTC→IANA Europe/Istanbul; iadeyi satış saatine taşıma. SQL gerçek UTC gün-saat grupla, Node IANA ile 24 yerel saat; tarihî ofseti sabit+3 varsayma. 5000 kategori/10000 UTC saat sınırında fail; 50 kategori CSV sayfası/24 saat CSV, kapsam ve timestamp yazılı. Salt GET stok/bakiye/revision/close yazmaz; bozuk snapshot 409. Kategori geçmişi ve snapshot metadatası mali işlem kurallarını değiştirmez. GitHub kaynağı güncellenir, bulut ayar taslağına dokunulmaz.

> **24 Ekim stok sağlığı/marj raporları:** `docs/market-stok-sagligi-marj-2026-10-24.md`; yeni migration yok, 0020 gerekir. Salt GET stock-health/margin-alerts yalnız OWNER/MANAGER/ACCOUNTANT, tenant/station. Stock value i.value_minor bir kez/SKU, p/i/lot miktar ve INVENTORY cache mutabakatı; eksik stok pozitifse 409, son alıştan tahmin yok. Gözlem max(book start, ürün İstanbul oluşturma günü), son satış book bağlı POS; iade/alış/sayım/fiyat son satış değildir. Yeni kartta yakın satış aktif; aksi durumda yeterli geçmiş yoksa hareketsiz deme. Güncel stok raporu geçmiş değer/devir değildir. 30/60/90 iç içe. 5000 tam katalog limitinde fail, 50 sayfa/CSV; canlı hash/book revision değişirse sayfa devamı 409, yenile. Marj özgün net/cost/return snapshot ve tam integer threshold; ürün toplamı kârlı olsa da loss/low satırı gizlenmez; return-only yeni zarar sayılmaz. Marj ürün toplamı SALES/RETURNS/COGS ile mutabık; yanlış/eksik maliyet 409. AsOf BIGINT string, 5000 dönem ürünü; bir örnek zarar fişi, bütün olay listesi değil. Genel giderleri ürünlere dağıtma; net kâr/yasal oran/offline/fizikî kabul iddiası yok. GitHub source güncellenir, bulut ayar taslağına dokunulmaz.

> **24 Ekim kasa/kasiyer ve iptal denetimi:** `docs/market-rapor-kontrol-2026-10-24.md`, 0020 gereklidir. reportFilters bütün totals/previous/list/products kapsamına uygulanır; iade kişisi özgün satış kullanıcısı, cancellation userId olay aktörüdür. salesOnly=true iken genel gider/faaliyet sonucu gösterilmez, brüt kâr kullanılır. Boş filtre eski istasyon hesabını korur; scope/rol/CSRF/same-ID sınırlarını gevşetmeyin. 0020 cart_event seq geçmiş ID/JSON korur; timestamp/UUID sıralama + asOf seq sabit sayfalama, BIGINT string. REDUCE/CANCEL snapshot farkı çıkarılan tutardır; gerçekleşmiş satış/kayıp/stock yazımı değildir. 50 olay sayfa/CSV, bütün filtreli dönem toplamı; en fazla 5000, fazlasında aralığı daraltma hatası. Genel GET mali/stok/revision/close yazmaz. Sahte/bozuk/yeniden fiyatlanmış snapshot 409, güncel karttan doldurma yok. Bu teslim GitHub kaynak güncellemesidir; bulut ayar taslağına dokunulmaz.

> **24 Ekim Raporlar merkezi:** `docs/market-raporlar-merkezi-2026-10-24.md`; yeni migration yok, 0019 gerekir. GET sales/products/:saleId yalnız OWNER/MANAGER/ACCOUNTANT ve tenant/station. Kayıtlı mali deftere bağlanan POS ve iadeler; dönem business_date, gösterim İstanbul. Ödeme payları satış düzeyinde toplanır; satır/ödeme/iade JOIN çoğaltması yapmayın. Veresiye tahsilatı ikinci satış değildir. asOf kesin BIGINT string ve sabit kayıt sınırı; yenilemede yeni sınır, ürün/ayrıntı aynı sınır. 50 satırlık sayfalar/CSV, dönem toplamı tüm aralık; kategori/tarihsel stok/yaşlandırma henüz yok. Geçmiş maliyet/fiyat/ad fiş snapshotından; ürün raporu adı güncel kart diye etiketli. Geçersiz mali detay 409, bugünkü maliyetten tamamlama yok. Salt GET bakiye/stock/revision/close değiştirmez; kapalı günde okunur. Faaliyet sonucu bütün vergileri kapsayan net kâr değildir. Personel rapor erişimi yok; mevcut mali rol sınırlarını koruyun.

> **24 Ekim raf etiketleri:** `docs/market-raf-etiketleri-2026-10-24.md`, 0019 migration. OWNER/MANAGER/ACCOUNTANT etiket kuyruğu/paket/yerleştirme; MARKET_STAFF/PURCHASER yalnız adet barkodu kontrolü, stok/maliyet redakte. Onaylı aktif cihaz yazma için zorunlu. Snapshot yalnız perakende ana fiyat/KDV/ad/barkod/birim/raf ve retail history sürümünü kapsar; özel liste/alış/stock değişimi etiketi eskitmez. Fiyat eski tutarına dönse de history değişmişse eski paketi reddet. Yazdırma öncesi güncel GET, fizikî yerleştirmede transaction kilitli yeniden kontrol zorunlu; print/PDF veya eşleşen kontrol asla otomatik yerleştirme değildir. Yerleştirme açık teyit/açıklama, mismatch fizikî okuma ve açıklama ister. Station→book→product kilidi ve current FOR UPDATE history okumalarını, same-ID/CSRF/tenant korumasını koru. Metadata kapalı günde açık; fiyat/stok/defter/revizyon/close snapshot değişmez. Barkod Code128 yerel SVG; cihaz/menşe/kg-lt/yasal etiket sertifikasyonu iddiası yok.

> **24 Ekim satın alma siparişleri:** `docs/market-satin-alma-siparisleri-2026-10-24.md`, 0018 migration. OWNER/MANAGER/ACCOUNTANT taslak/okuma/kabul; yalnız OWNER/MANAGER onay/reprice/close. Sipariş, onay, reprice ve close stok/borç/KDV/defter revizyonu doğurmaz; kredi rezervasyonu yoktur. Sadece APPROVED/PARTIAL kalan miktar stok önerisinde yoldaki maldır; fizikî kritik uyarı gizlenmez. Onaylı miktar sabit; kalan fiyat/KDV/tarih yönetici revizyonuyla değişir, eski kabul fiyatı korunur. Order-receive doğrudan ortak recordMarketPurchase kullanır; siparişin teslim sayacı/bağlantısı aynı transaction olur. Kalan miktar, sipariş ve defter sürümü, fiyat/KDV, gerçek teslim teyidi, belge/limit/lot kontrolü zorunlu. Hata tüm yazıyı geri almalı. Aynı-ID ve lock sırasını koruyun, haricî yan etki eklemeyin. Kısmi fatura vergi yuvarlamasını ilk plana zorlamayın. İptal/kalan kapatma geçmiş teslimatı geri almaz; alış iadesi siparişi otomatik açmaz. Serbest/terminal kabulünü otomatik PO teslimi saymayın. Tedarikçiye mesaj/API gönderimi yoktur.

> **23 Ekim sayım raporları:** `docs/market-sayim-raporlari-2026-10-23.md`. Yeni migration yok; 0017 gerekir. GET count-reports ve /:entryId yalnız OWNER/MANAGER/ACCOUNTANT, her okumada tenant/station. Yalnız STOCK_COUNT terminal onayları; masaüstü LOT_COUNT/fire ve açık taslaklar dahil değildir. Tarih TR business_date, en fazla 366 gün, 50 satır sıralı seq imleci; dönem toplamı bütün aralık. Mali tutar fiş satırlarından, miktarlar payload snapshotından; bugünkü stok/maliyetle geçmişi hesaplamayın. Yeni countReportVersion=1 ürün adı/barkod/birim ve sayan kişi/cihaz ekler; eski etiketsiz kaynak açıkça güncel kart etiketiyle işaretlenir, eksik bilgi tahmin edilmez. Ayrıntı toplamı fişle uyuşmazsa 409; başka kayıttan tamamlamayın. CSV ürün maliyetini yalnız bir kez yazar, parti satırları yalnız adet. GET bakiye/revizyon/kapanış/stoğa yazmaz; geç gelen UI yanıtları yeni aralığı değiştiremez.

> **19 Ekim terminal parti sayımı:** `docs/market-terminal-parti-sayimi-2026-10-19.md`, 0017 migration. Yeni COUNT taslakları takipli ürünlerin mevcut gerçek lotlarını snapshot alır. Okutma açık lotId ister; sayılmayan lot korunur, personel DTO/CSV başlangıç/güncel stok ve maliyeti görmez. Personel SKU toplamında yalnız gerçekten saydığı adetleri görmeli; tahminî toplam gizli stok içerir. Stok değişiminde REBASE ürünün bütün lotlarını temizler/yeni snapshot alır. Eski taslağın toplamını lotlara tahminle dağıtmayın. Aynı SKU net delta 0 olsa da lot gain/loss ayrı hesaplanır; kayıp ürün bazında tek yuvarlama, fazlalık açık net maliyet ve sıfır teyidi. Parti değişirse net adet/değer aynı bile olsa stock_version artar. Lot/ürün/mali stok/hareket/olay/STOCK_COUNT tek transaction; status/SKT değişmez. Genel mali ters fişle stok sayımını bozmayın. Aynı-ID ve defter/sayım/ürün sürümleri korunur.

> **19 Ekim liste aktarımı:** `docs/market-urun-aktarimi-2026-10-19.md`, 0015/0016 migration. Varsayılan CATALOG_ONLY stok/maliyet sıfır, KDV tanımsız; DEMO_OPENING_ABS yalnız DEMO, abs miktar, net maliyet ve ayrı iki teyit. Her yeni grup %1/%10/%20 açıkça seçilir; pilotun dört kullanıcı oranı yasal sınıflandırma değildir. Kaynak negatif miktar ve fiyat denetim kaydında korunur. Mevcut barkodları ezmeyin. Kaynak hash istasyonda tekil, farklı yöntemle yeniden aktarım stok oluşturmaz. Aktif defterde INVENTORY/OPENING dengeli; satış/STOCK_GAIN/AP/INPUT_VAT yazmayın. Kapalı günde mali aktarım engelli, yalnız kart aktarımı açık. Kayıp yanıtta aynı istek ID; tüm yazılar DB transaction içinde. Gerçek kullanıcı fiyat listesini Git veya pakete koymayın.

> **17 Ekim lot/SKT:** `docs/market-lot-skt-2026-10-17.md`, 0014 migration. Takip ürün bazında açıkça açılır; mevcut stok gerçek lotlara tam dağıtılır, bilinmeyen/geçmiş SKT karantina olur. Takipli her stok yazarı lotu aynı transaction içinde değiştirmelidir. POS FEFO ve güncel Türkiye günüyle kullanılabilir partiyi tüketir; EAN fizikî lotu doğrulamaz. Müşteri iadesi özgün maliyetle SKT bilinmeyen karantinaya girer. Tedarikçi iadesi gerçek lot dağılımı gerektirir. Toplam sayım farkı takipli üründe engellenir; yetkili parti sayımı/fire kullanır. Fire STOCK_LOSS, fazlalık STOCK_GAIN; ağırlıklı ürün maliyeti sürer. Genel ters fişle lot stoklarını bozmayın. Gün sonu lot/ürün/maliyet adet mutabakatını denetler. Tarih veya lot uydurmayın; stok_version ve mali önizleme/same-ID kurallarını koruyun.

> **17 Ekim stok/el terminali:** `docs/market-stok-terminal-2026-10-17.md`; 0013 migration. Ana/koli barkod registry, named fiyat listeleri ve satış snapshot, kritik stok, tarayıcı cihaz onayı, sürümlü COUNT/RECEIPT taslakları, aylık/ürün kâr raporu. Bütün stok değişikliklerinde `stock_version` artırılır; sayım eski sürümle stoğu ezemez. Satış + iade adedi aynı yapsa da yeniden sayım gerekir. Sayılmayan satırı sıfır saymayın; kayıt maliyeti ve dengeli defter aynı transaction olmalı. Mal kabul ortak `recordMarketPurchase` kullanır; ayrı finans yolu açmayın. Cihaz UUID kaydı fizikî kimlik doğrulaması değildir, SDK/offline kuyruk yoktur. Yeni SQL bağlantıları UTC; eski tarihleri otomatik kaydırmayın.

> **17 Ekim iadeler:** `docs/market-iadeleri-2026-10-17.md`; 0012 migration. Kaynak belgeli kısmi satış/alış iadesi OWNER/ACCOUNTANT yetkisindedir. Belge açık tutarı = total - settled - credited. Satış maliyeti özgün kayıttan, alış iadesi stok maliyeti güncel ağırlıklı değerden; fark ayrı hesapta. Para gerçekleşme teyidi ve önizleme sürümü zorunlu, geçmiş kapanışlar korunur. İadeyi genel ters fişle bozmayın.

> **17 Ekim market ön muhasebesi:** `docs/market-on-muhasebe-2026-10-17.md`. 0011 migration: market ticari defter/partiler/belgeler, net stok maliyeti, manuel ödeme/ekstre, POS veresiye/KDV/COGS, kasa devirleri ve gün sonu. Aktif defterde eski stok/payable ve yeni eski-tip MARKET vardiya yazımları engellenir; FUEL/iki mali imza akışı korunur. Nakit/banka ödemeleri OWNER/ACCOUNTANT; açılış ve kaynak girişi OWNER. Eski carileri/bakiyeleri otomatik taşımayın; teyitli açılış gerekir. Yeni mali etkileri aynı transaction ve kilit sırasıyla, dengeli fişle kaydedin; CSV’yi resmî mali belge saymayın.

> **17 Ekim 2026 Kasa V2:** Güncel rehber `docs/market-kasa-v2-2026-10-17.md`. 0009/0010 göçleri kalıcı sürümlü sepet, bekletme/tek cihazda çağırma, açıklamalı iptal olayları ve karma ödeme ekler. Sepet değişiklikleri sunucuda; bekletme stok düşürmez. Eski checkout uyumluluğu aktif V2 sepeti atlayamaz. DEMO/mali sınırları koruyun.

> **Ortak kasa:** 0008 migration ile aynı kullanıcının farklı bilgisayarları tek açık kasaya `/pos/join` ile katılır. Sepet ve istek kimlikleri ayrı, kasa toplamı/kapanışı ortaktır. Her satışın kaynak cihazı ve kapanış cihazı saklanır. Cihaz listesi yeni kasa oturumuna taşınmaz.

> **16 Ekim 2026 kasa pilotu:** Güncel market POS rehberi `docs/market-kasa-pilotu-2026-10-16.md`. `/kasa` çok kasa oturumları, atomik DEMO sepet satışları ve kapanış içerir; 0007 migration gereklidir. Gerçek mali belge, yazıcı/çekmece/banka ve merkez sync henüz bağlı değildir. Finans ve tenant sınırlarını koruyun.

> **15 Ekim 2026 bağımsız sürüm güncellemesi:** Güncel kurulum kaynağı kök `README.md` ve `scripts/cloud-*.sh` dosyalarıdır. Varsayılan `AUTH_PROVIDER=local`: e-posta/parola, scrypt, DB’de hash’li ve iptal edilebilir oturumlar; Manus zorunlu değildir. Mevcut mali/tenant kuralları korunur. `0006_local_auth.sql` eklendi. Asistan yerel kural tabanlı özet verir; haricî OCR/banka/Turpak kapalıdır. Aşağıdaki 14 Ekim aktarım notları önceki sürümün tarihsel bağlamıdır; Manus zorunluluğuna ilişkin ifadeler yalnız isteğe bağlı eski adaptöre uygulanır. Kullanıcı bu oturumda kod uyarlamasını ve DEMO veri kullanımını yetkilendirdi.

# CLAUDE.md — İstasyonOS / AKARYAKIT V1

## 1. Projenin amacı ve bu kopyanın durumu

Akaryakıt istasyonlarının aylık/günlük vardiya hesaplarını, market stoklarını ve operasyonel finansını aynı sistemde yönetmek. Personel kendi telefonundan PWA ile vardiya hesabı açar; nakit, kart slipi, IBAN ve kişi/kuruma borç satışlarını girer. Yetkililer kaynak raporu ve fizikî nakit teslimini kontrol eder; muhasebe ayrı kullanıcı imzalarıyla teslimi inceler. Patron yetkili olduğu istasyonların konsolide durumunu görür.

**Bu belge 14 Ekim 2026 tarihli kaynak kodu kopyasını tanıtır.** Çalışan web uygulamasının ilk sürümüdür; tamamlanmış ve üretim onayı verilmiş tam ERP değildir. Kaynaklar çalışma klasöründeki değişiklikleri de kapsar; yalnız eski Git commit'i değildir. Gerçek kullanıcı, veritabanı kayıtları ve anahtarlar arşivde yoktur.

Kullanıcı dili ve uygulama arayüzü **Türkçe**. Kullanıcının talebi aksini söylemedikçe finansal iş kurallarını değiştirme. Planlanan özellikleri çalışan özellikmiş gibi sunma.

## 2. Önce okunacak dosyalar

1. Bu dosya ve `README-PAKET.md`: kapsam, kurulabilirlik ve aktarım sınırları.
2. `server/stationos/index.ts`: güncel REST işlemleri, yetki filtreleri, transaction ve state hesapları. **Mevcut davranışın birincil kaynağıdır.**
3. `shared/station.ts`: güncel istemci tipleri; `shared/station-contract.md`: sözleşme taslağı.
4. `server/stationos/domain.ts`, `safety.ts`: para, idempotency, doğrulama ve hesap yardımcıları.
5. `client/src/pages/StationApp.tsx` ve `components/stationos/`: gerçek modül ekranları.
6. `docs/teknik-planlama-v1.3-mobil-vardiya-ocr-api-migration.md`, `docs/tasarim-v1.9-personel-mobil-vardiya-ocr-muhasebe.md`: ürünün geniş hedefi.
7. `docs/mimari-v2.2-turpak-dosya-ocr-kvkk-guvenlik.md`: dış kaynak aktarımı/OCR güvenlik hedefi.

**Öncelik kuralı:** Çalışan kod ve güncel testler > bu aktarım notu > sözleşme taslağı > tarihli planlar/eski README/TODO kayıtları. Kök `README.md`, backend `README.md` ve `TODO.md` geliştirme sırasında yazıldı; bazı tamamlanma ifadeleri ve yetki listeleri eski olabilir. Çelişkiyi inceleyip açıkça raporla; eski belgeyi uygulamak için güvenlik kontrolünü kaldırma.

## 3. Teknoloji ve dosya haritası

- Node.js 22; `pnpm@10.18.0`; TypeScript 5.9; ESM.
- React 19, Vite 7, Wouter, Tailwind/CSS, Radix UI bileşenleri.
- Express 4. Operasyon modülü `/api/stationos` altında REST'tir; başlangıç şablonunda tRPC de vardır.
- **Güncel uygulama MySQL/mysql2 kullanır.** Eski planlardaki PostgreSQL örneklerini mevcut veritabanında çalıştırma.
- Kullanıcı tablosu Drizzle; operasyon tabloları ayrı, numaralı SQL migration'ları.

```text
client/src/pages/StationApp.tsx          Ana konsol, kurulum, vardiya ve onay ekranları
client/src/components/stationos/         Market, satın alma, cari, finans, asistan ve ortak UI
client/src/lib/station-api.ts            Oturum/CSRF/cihaz/idempotent istemci
client/src/station.css                  Ana responsive tasarım
client/public/                         PWA manifest, ikonlar, offline ekran, rota listesi
server/_core/                          OAuth, oturum, Express, Vite/static ve AI servis yardımcıları
server/stationos/index.ts               REST router, yetki ve transaction iş akışları
server/stationos/db.ts                  UTC/kayıpsız büyük sayı bağlantı ayarları
server/stationos/migrate.ts             Operasyon migration çalıştırıcısı
server/stationos/migrations/            0001–0005 SQL dosyaları
server/stationos/assistant.ts           Rol bazlı anonim AI özetleyici
server/stationos/*.test.ts              Birim ve sözleşme testleri
shared/station.ts                      UI/API tipleri
shared/station-contract.md             REST sözleşme taslağı
shared/const.ts                        Oturum ve OAuth sabitleri
drizzle/                               Kullanıcı tablosu ve başlangıç migration'ı
docs/                                  Geçmiş planlar, örnek SQL, veri şablonları ve prototipler
Dockerfile                             Üretim image build/start tanımı
```

`docs/prototip-v2.0/` eski Node/HTML demodur; veri bellekte tutulur ve rol taklidi vardır. Güncel uygulama değildir. `docs/ui-wireframe-v1.4.html` tasarım geçmişidir. `docs/ornek-kod-v1.9/` bağımsız örneklerdir; otomatik olarak güncel backend'e entegre sayılmaz.

## 4. Kurulum ve komutlar

Proje kökünde:

```bash
corepack enable
corepack prepare pnpm@10.18.0 --activate
pnpm install --frozen-lockfile
cp .env.example .env
# .env içine kendi yetkili bağlantı ve oturum ayarlarını gir.

pnpm db:migrate                         # Drizzle: users başlangıç tablosu
pnpm tsx server/stationos/migrate.ts     # Operasyon: st_* tabloları
pnpm dev                               # Express + Vite; varsayılan 3000

pnpm check                             # TypeScript; emit yok
pnpm test                              # Vitest
pnpm build                             # dist/public + dist/index.js
pnpm start                             # Derlenmiş üretim sunucusu
```

Windows'ta `cp` yerine dosyayı elle kopyalayabilirsin. `dev/start` npm script'lerinde POSIX `NODE_ENV=...` sözdizimi vardır; Windows PowerShell için değişken atamasını uyarlamak veya WSL kullanmak gerekir.

`pnpm db:push` şema üretip migration uygular; mevcut finans veritabanında incelemeden kullanma. Sunucu başlangıcı operasyon migration'larını kendiliğinden çalıştırmaz. MySQL DDL örtük commit yapabilir; migration dosyasındaki transaction, tüm DDL'nin geri alınacağını garanti etmez. Yedek ve ayrı deneme veritabanı kullan; uygulanmış migration'ı değiştirmek yerine yenisini ekle.

### Dış platforma bağımlılık

`.env.example` yalnız boş alanlar içerir. Temel özel değerler `DATABASE_URL`, `MANUS_PROJECT_ID`, `MANUS_JWT_SECRET`, `MANUS_OAUTH_API_URL`; giriş ekranı için public `MANUS_OAUTH_PORTAL_URL`. Asistan `MANUS_API_URL` ve sunucuya özel `MANUS_API_KEY` kullanır. Varsa `OWNER_OPEN_ID` ilk kurulum politikasını etkiler. **Ortam değerlerini kayıttan çıkarma, loglama veya frontend'e serileştirme.**

Bu kaynak kopyası dışarıda dosyaları derlemenin mümkün olması ile gerçek giriş/AI/veritabanının hazır olması arasında ayrım yapar. Mevcut OAuth ve AI Manus servislerine bağlıdır. Başka ortamda yetkili erişim/callback yapılandırması gerekir; erişim yoksa OAuth ve AI adaptörlerini açık bir taşıma işi olarak ele al. Sahte kullanıcı veya herkese açık admin ekleyerek bu bağımlılığı geçiştirme. İlk girişte nonce/cookie akışı HTTPS gerektirir; yalnız `http://localhost` açılması gerçek login'i garanti etmez.

## 5. Mevcut modüller ve açık işler

### Kaynakta uygulanmış

- Gerçek SDK cookie/Bearer kimliği, tenant/istasyon üyeliği ve rol kontrolleri; süreli tek kullanımlık davet.
- Firma/istasyon ve vardiya oluşturma; personelin kendi hesap ve ödeme kayıtları.
- Nakit, manuel teyitli kart slipi, IBAN beyanı, borç satış ve eski cari tahsilat ayrımı.
- Manuel kaynak satış toplamı/ref; fizikî nakit alıcısı; sürüm kontrolü; ayrı mali onaylar ve düzeltme geçmişi.
- Kişi/kurum borçlu kartı, borç ve tahsilat defteri; sonraki tahsilatın cirodan ayrı izlenmesi.
- Market ürün/barkod, adet stoğu, mal kabul/satış/düzeltme hareketi; 5.000 ürün sınırı.
- Toptancı cari limit/vade kayıtları ve deterministik stok/sipariş önerileri.
- Operasyonel konsolide özetler; beş masaüstü cihaz için hesap başına süreli lease.
- Kurulabilir PWA manifest ve hassas veri içermeyen offline açıklama ekranı.
- Rol bazlı **salt okunur** AI açıklaması: kontrollü konu + sunucuda hazırlanmış anonim sayısal özet. Serbest kapsamlı ERP ajanı değildir.

### Hâlâ plan/erişim/üretim geliştirmesi gerektiren

- Turpak/YN ÖKC, pompa/tank otomatik veri akışı; gerçek banka/POS takas, komisyon/valör, e-Fatura/muhasebe bağlantıları.
- Slip fotoğrafı yükleme, gerçek piksel maskeleme, OCR kuyruğu ve özel şifreli görsel deposu. Mevcut slip yöntemi `MANUAL`; fotoğraf OCR varmış gibi davranma.
- Tam satın alma sipariş/taahhüt rezervasyonu, fatura–mal kabul eşleştirmesi, cihaz üreticisine ait PM80/diğer terminal SDK adaptörleri.
- Gerçek banka açılış bakiyesine dayanan likidite; tam muhasebe ve resmî beyanlar.
- Ayrıntılı izin kodu/policy sistemi, istasyonlar arası hukuki firma geçmişi, personel bazında ayrı vardiya atama ve tam negatif/yarış testleri.
- Üretim güvenlik kabulü, KVKK değerlendirmesi, yük/yedek/geri yükleme testleri ve saha pilotu.

## 6. Değişmemesi gereken finans ve yetki kuralları

1. Para güvenli **integer kuruş**: `10000 = 100,00 TL`. API'ye float TL gönderme. `requireMoney`, `safeAdd` ve UI para dönüştürücülerini kullan; taşmayı denetle.
2. MARKET stok integer **adet**; FUEL hedefi **litre/tank**. İki alanın stok ve satışlarını sessizce birleştirme.
3. Vardiya satış beyanı = nakit satış + kart slipi brüt + IBAN beyanı + borç satış. Açılış para üstü ve eski alacak tahsilatı satış değildir.
4. `expectedCashMinor` nakit satış + eski alacak tahsilatıdır; fizikî sayım ve retained/açılış float ayrımını mevcut koddan takip et. Brüt kart slipini banka net tahsilatı sayma.
5. IBAN'ın yazılması veya muhasebe imzası, gerçek banka hareketinin doğrulandığı anlamına gelmez; kapanış `ACCEPTED_WITH_PENDING` olabilir.
6. Aktör ve rol body'den alınmaz. Kimlik sunucuda doğrulanır; nesnenin tenant/istasyon kapsamı her işlemde tekrar kontrol edilir. UI buton gizlemek yetki kontrolü değildir.
7. Kendi hesap dosyasını onaylama yasağı kullanıcı ID'sine dayanır. Fizikî nakit alıcısı ile `APPROVAL` mali imzası ayrı işlerdir; alıcı imzası mali imza sayısını artırmaz.
8. İki farklı mali kullanıcı imzası gerekir. Sürüm/cycle/snapshot bağını koru; yeni içerik eski imzaları devralmaz. İmzaları silerek düzeltme yapma. Mevcut geri gönderme, inceleme durumundan yeni cycle açar; kesin kapanmış hesabı yeniden açma ayrı geliştirmedir.
9. `/payment`, `/slip`, `/account/submit` cihaz kimliği/kind başlıkları kullanır; masaüstü kontenjanı 5, lease süresi 5 dakika. Bu tarayıcı kimliği/lease ilk uygulamadır, donanım kimlik doğrulaması değildir. Kullanıcının UA/localStorage değiştirmesi karşısında güçlü cihaz enrollment ayrıca gerekir.
10. Borç satışı bir kez borçlandırır; sonraki `AR_COLLECTION` ayrı hareketle azaltır. Banka bekleyen tahsilatı kesin kredi post etme. Hesapsız tahsilat `payments.accountId = null` olabilir.
11. İsim/adres/not/fiyat/bakiye gibi state alanları nullable veya yetki nedeniyle redacted olabilir. `null` bilinmiyor/yetki yok demektir; sıfırmış gibi finansal toplam üretme.
12. SQL'de ödeme/slip gibi iki 1:N tabloyu doğrudan join edip SUM toplama; scalar veya önceden aggregate edilmiş sorgu kullan. İşlem satırlarını ve bağlı kayıtları transaction içinde kilitle.
13. Aynı station + terminal + reference + Türkiye işlem günü için kart slipi tekrar gelir yaratmamalı. UTC saklama, Türkiye günü için generated tarih sütunu/indeksini koru.
14. İşlem `requestId` + aktör + payload hash ile idempotent. Ağ cevabı belirsizse yeni kimlikle tekrar yazma; aynı mantıksal işlemin kimliğini koru.

## 7. Satın alma ve asistan sınırı

`index.ts` state önerisi son 28 günlük `SALE` adetlerinden günlük ortalama çıkarır. Pilot hedefi `max(minimumQty, ceil(averageDaily × 12))`; 12 gün = 7 gün inceleme + **varsayılan** 3 gün tedarik + 2 gün güvenlik. Bu, gerçek tedarikçi SLA'sı değildir. Mevcut stoğu düşerek miktar önerir; kritik kapsamı öne alır ve aynı toptancının kalan kredi bütçesini öneri satırları arasında paylaşır. Ürün alış fiyatı ve maliyet esası mutlaka kontrol edilmelidir.

Tam açık PO/taahhüt ve firma çapında ortak cari modeli mevcut uygulamada tamamlanmadı. Dolayısıyla öneri, bütün şirketin doğrulanmış kredi kullanılabilirliği veya gönderilmiş satın alma siparişi değildir. Hazırlanmış öneriyi otomatik tedarikçiye gönderme.

AI işlem yapmaz, SQL çalıştırmaz, onay vermez. `assistant.ts` ham soru ve kişi/ürün/tedarikçi isimlerini dış modele göndermez; kontrollü konu ve sayısal özet kullanır. Soru kaydında hash, cevap kaydında erişim kapsamı tutulur. Rate limit ve idempotency korumalarını sürdür. Anonimleştirme iddiasını KVKK/hukuki kabul yerine koyma; toplulaştırılmış iş verisinin erişim ve aktarım şartlarını ayrıca incele.

## 8. Güvenlik, PWA ve taşıma

- Gerçek `.env`, DSN, API/JWT anahtarı, cookie, ham slip, PAN veya banka hesap verisi Git'e/Claude sohbetine/loga girmez.
- `safety.ts` Luhn benzeri tam kart numarası kontrolü kullanır; **bu piksel maskeleme veya eksiksiz DLP değildir**. Cloud OCR öncesi bağımsız yerel gizlilik kontrolü gerekir.
- PWA yalnız offline açıklama ve ikonları cache eder; API, oturumlu HTML, cari veriler ve slipler cache edilmez. Finansal offline post henüz yoktur.
- Public HTTPS iframe önizlemede cookie `SameSite=None; Secure` gerektirir; iç HTTP bağlantısından public protokol çıkarımı yapma.
- `publicPlatformConfig` yalnız izinli public runtime alanlarını açar; `process.env` bütününü frontend'e verme.
- Veritabanı, dosya deposu, OAuth redirect adresi ve haricî servisler kod arşivinden bağımsız altyapıdır.

## 9. Test ve geliştirmeye devam

**14 Ekim 2026 doğrulaması:** `pnpm check` başarılı; `pnpm test` **6 dosya / 25 test** başarılı; `pnpm build` başarılı. Build, büyük chunk ve runtime `config.js` script etiketi uyarıları verir. Bunlar derlemeyi durdurmadı; performans ve build davranışı ayrıca incelenebilir.

Bu testler tam saha/çok kullanıcılı uçtan uca veya üretim güvenlik kabulü değildir. `server/stationos/database-rollback-check.ts --rollback-only` sentetik kayıt ekleyip geri alır; üretim/shared veritabanında çalıştırma, ayrı test veritabanı seç. Eski PostgreSQL testlerini mevcut MySQL testleriyle karıştırma.

Devam sırası: önce kendi ortamında kurulum/giriş → firma/istasyon/davet → personel hesabı/ödeme → kaynak/teslim/iki kullanıcı onayı → negatif kapsam ve eşzamanlılık kontrolleri. Sonra fatura eşleştirmesi, gerçek dosya/OCR ve sağlayıcı adaptörlerini ayrı teslimatlar olarak tamamla. Önce eksikleri ve bağımlılıkları söyle; gerçek sağlayıcı erişimi yokken sahte canlı entegrasyon ekleme.

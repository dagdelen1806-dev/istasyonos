# AKARYAKIT V1 — v1.6 Yetkili Operasyonu ve Entegre Prototip

**Tarih:** 10 Ekim 2026. **Durum:** tasarım ve etkileşimli demo; canlı satış, gerçek giriş yetkisi, banka, OCR veya Turpak bağlantısı yoktur.

Temel: [v1.5 plan](tasarim-v1.5-mutabakat-satin-alma-firma-yetki.md), [v1.5 DDL](schema-v1.5-company-rbac-approvals.sql). Bu ek önceki kararları değiştirmeden yönetici/muhasebe ayrımını, onay kuyruğunu ve sipariş riskini somutlaştırır.

## 1. Yönetici ve muhasebeci yetki matrisi

İş unvanı değil, **izin kodu + etkin rol ataması + nesne kapsamı** erişimi belirler. Yönetici üç ayrı şablondur: tenant kurulum yöneticisi, firma yöneticisi ve istasyon yöneticisi. Muhasebeci firma/istasyon kapsamına atanabilir. Firma sahibinin rapor yetkisi işlem onayıyla aynı değildir.

| Eylem | Tenant kurulum yöneticisi | Firma yöneticisi | İstasyon yöneticisi | Muhasebeci | İzin / koşul |
|---|---|---|---|---|---|
| Firma master oluşturma | Evet | Atanmış firmada düzenleme; yeni firma ayrı yetki | Hayır | Oku | `company.manage`; kritik VKN değişimi ayrıca onaylı |
| İstasyon–firma atama | Kurulum yetkisi | Kendi firma sınırında talep/etki önizlemesi | Oku | Oku | `station_company.manage`; başka firmaya taşıma yeni açık kapsam gerektirir |
| Kullanıcı daveti / çalışan atama | Evet | Kendi firmasında delegasyonla | Kendi istasyonunda vardiya/görev atama | Hayır | `user.manage` ile `employee.assign` ayrı izinler |
| Rol atama | Evet, audit | Yalnız devredilebilir izin altkümesi | Varsayılan hayır | Hayır | `role.assign`; kendine yetki yükseltme yok |
| Vardiya planı / personel katılımı | Kurulumda ayrı yetki | Kapsamlı yönetim | Kendi istasyonunda yönetim | Oku | `shift.plan.manage` / `shift.declare.self` |
| Personelin slip/be yanlarını inceleme | Varsayılan finans erişimi yok | Özet; ayrı yetkiyle detay | İlgili vardiyanın kanıtı | Banka/POS eşleme için gerekli kanıt | `shift.reconcile.read`; gereksiz kişisel veri yok |
| Nakit sayım farkı | Hayır | Yüksek riskte ikinci imza | İncele, geri gönder, politikaya göre ilk imza | Oku; tek başına saha sayımı onaylamaz | `shift.cash.approve` |
| IBAN/banka hareketi eşleme | Hayır | Özet/ikinci imza | Bekleyen/uyumsuz durumu gör | Eşleştir/reddet | `finance.bank.match`; dış kaynaktaki gerçek hareket şart |
| Kart slip–POS–banka takası | Hayır | Özet/ikinci imza | Slip ve terminali inceler | Banka/takas eşler | `finance.pos.match`; komisyon ayrı satır, satış tutarından gizlice düşülmez |
| Borçlu satış/cari tahsilat | Hayır | Özet/risk onayı | İzinli borçlu seçimi ve saha kontrolü | Defter/tahsis/ters kayıt talebi | `finance.ar.operate`; bekleyen IBAN kredi post etmez |
| Normal vardiya kapanışı | Hayır | Scope ve izin varsa | Kaynaklar tamam ve eşitse | Banka bileşeni onaylar; saha kapanışı için ayrı yetki | `shift.close.approve` |
| Eksik kaynakla operasyonel kapanış | Hayır | Önerilen ikinci imza | Gerekçeli ilk imza | Finans etkisi varsa ikinci imza | `shift.exception.approve`; **mali eşleşme yapılmış sayılmaz** |
| Kapanmış vardiyayı yeniden açma | Hayır | İkinci imza alternatifi | Talep/ilk imza | İkinci imza | `shift.reopen`; iki farklı kişi; eski snapshot korunur |
| Cari limit değişikliği | Hayır | Risk onayı | Sadece talep | Kaynak sözleşmeyi doğrular | `supplier.limit.approve`; sipariş onayı limiti kendiliğinden değiştirmez |
| Satın alma taslağı | Hayır | Oku/onay | Delegasyonla incele | Cari/vergi/bütçe kontrolü | `market.purchase.recommend` ayrı |
| Limit aşan sipariş | Hayır | Gerekçeli ticari risk imzası | Öneriyi incele | Cari verinin güncelliğini ve riskini doğrular | `market.purchase.exception.approve`; tedarikçiye gönderim ayrı |
| Turpak/ÖKC/e-belge profili | Teknik bağlantı yetkisi | Firma kimliği değişiminde onay | Sağlık durumu oku | Belge/banka profilini oku | `integration.manage`; anahtarların değeri gösterilmez |

Bu izin kodları v1.6 hedef katalogdur; v1.5 seed dosyasında hepsi yoktur. Uygulama sırasında yeni kodlar additive seed ile eklenir. `finance.reconcile` gibi eski geniş izinler sessizce bütün yeni eylemleri kapsamaz.

### 1.1 Yetki denetimi sırası

1. Token kimliği, hesap/cihaz aktifliği ve süre kontrol edilir.
2. Rol ataması, başlangıç–bitiş ve firmanın/istasyonun etkin kapsamı çözülür.
3. Nesnenin tenant, hukuki firma snapshot'ı, istasyon, FUEL/MARKET alanı ve gerekli izin kodu karşılaştırılır.
4. Talep sahibi/beyan sahibi kendi kaydını onaylayamaz. Kullanıcı kimliği esas alınır, rol değiştirmek yasağı kaldırmaz.
5. Rol devrinde sadece devredilebilir izin ve kapsam altkümesi verilebilir; kendine veya daha geniş firma/tenant kapsamına yetki yükseltilemez.
6. Başarısız istek `403`, eski içerik/sürüm `409`, eksik kanıt `422` döner. Liste ve detay aynı erişim kuralını uygular; yalnız düğmeyi gizlemek yeterli değildir.

## 2. Onay kuyruğu kuralları

### 2.1 Satır ve filtreler

Kuyruk sütunları: vaka no, tür, firma/istasyon/iş alanı, vardiya/dönem, talep sahibi, fark/risk tutarı ve para birimi, kaynak güncelliği, yaş, gereken imza, mevcut imza, benim eylemim ve durum.

Filtreler: firma, istasyon, FUEL/MARKET, nakit/banka/POS/cari/satın alma/yeniden açma, kritik–yüksek–normal, benim işlem yapabileceklerim, bilgi bekleyenler, imza bekleyenler, sonuçlananlar. Yetkisiz satırlar sunucudan dönmez; yalnız arayüz filtresi değildir.

**Sıralama önerisi:** kritik fiscal/veri bütünlüğü olayı → bugün vadesi gelen ve stoksuzluk yaratacak tedarik/risk → kapanışı durduran eksik kanıt → yaş ve kayıt zamanı. Süreler (ör. 30 dakikada uyarı, 2 saatte eskalasyon) yalnız yapılandırılabilir işletme önerisidir; henüz SLA kararı değildir. Bildirim/escalation otomasyonu bu prototipte kurulmadı.

### 2.2 Eylem matrisi

| Vaka | İlk işlem | İkinci imza önerisi | Mutabakat sonucu |
|---|---|---|---|
| Nakit sayım farkı | İstasyon yöneticisi kanıtı inceler/gerekçeyle imzalar | Eşik üstünde firma yöneticisi veya muhasebeci | Operasyonel istisna; kaynak değer değişmez |
| IBAN eşleşmiyor | Muhasebeci banka hareketini inceler; bilgi ister/eşler | Politikanın yüksek risk koşulunda firma yetkilisi | Banka hareketi yoksa kesin tahsilat yok |
| Turpak/ÖKC raporu eksik | İstasyon yöneticisi yeniden aktarım/kanıt ister | Eksik kaynakla kapanışta yönetici + muhasebe/firma yetkilisi | Sadece açık istisnalı operasyonel kapanış; fiscal kayıt geçerli diye işaretlenmez |
| Kapanmış vardiyayı yeniden açma | İstasyon yöneticisi talebi inceler | Muhasebeci veya firma yöneticisi | Yeni sürüm; eski onay/history değişmez |
| Limit aşan haftalık sipariş | Muhasebeci veri/tutar esasını doğrular | Firma yöneticisi ticari istisnayı değerlendirir | Taslak; onay tek başına sipariş göndermez veya limit artırmaz |
| Kendi talebi | Diğer yetkiliye atanır | Gereken başka kişi | Talep sahibinin tüm onay eylemleri engelli |

### 2.3 Durum ve karar kaydı

`PENDING → NEEDS_INFO` veya `PENDING → APPROVED/REJECTED/CANCELLED`. İki imzalı talepte ilk imza sonrası status `PENDING`, `approval_count=1` olur. İmzalar aynı payload hash ve konu sürümünü paylaşır. İkinci kullanıcı en güncel **request row_version** ile aynı içerik hash'ini inceler; birinci imzanın eklenmesi içerik hash'ini değiştirmez.

Onay gönderiminde zorunlu: gerekçe kodu, en az anlamlı açıklama, request ID, row_version, subject_version, payload_hash, kullanıcı/etkin rol/kapsam, policy_version ve idempotency_key. Aynı key/same payload önceki sonucu döndürür; key/different payload 409 olur. Bu prototipte açıklama için en az 10 karakter kullanılır; üretim eşiği işletme tarafından seçilir.

- İmza, banka tahsilatı, muhasebe post veya gerçek kapanış eylemi **ayrı sonuçlardır**; onay kaydı bunları otomatik olmuş diye göstermez.
- Kaynak/beyan değişirse eski imzalar yeni içeriğe devredilmez. Yeni request açılır; eski talep iptal edilmiş/revizyon geçmişiyle tutulur.
- Bilgi isteme, ilgisiz finance/fiscal veriyi değiştirmez. Yanıt sonrasında yeni snapshot'la yeni request açılır.
- `FOR UPDATE` ve optimistic version kontrolü, transaction/outbox, audit ve kapsam yeniden doğrulamasıyla tek karar işlenir. İki farklı karar aynı eski sürümle yarışırsa birinin güncel ekranı yeniden açması gerekir.
- Kuyruk UI onayı göstermeden API sonucu bekler. Ağ hatasında "başarılı" demek yerine belirsiz sonuç gösterir; idempotency key üzerinden mevcut sonucu sorgular.

## 3. Stok tükenme ve tedarikçi limit senaryoları

[SQL örnekleri](queries-v1.6-stockout-supplier-risk.sql) v1.4/v1.5 örnek şemasını temel alır. `:parametre` ifadeleri prepared binding içindir; doğrudan psql script'i değildir.

### 3.1 Stok tükenme riski

Planlama stok pozisyonunu bilmek tek başına yeterli değildir: sipariş iki gün sonra gelecekse bugün ve yarın raf boş kalabilir. Örnek sorgu her gün için açılış kullanılabilir stoğu, o gün beklenen doğrulanmış mal gelişi ve tahmin talebini ayrı gösterir.

- `usable_now = on_hand_good − reserved`, `coverage_days = usable_now / forecast_daily`.
- Sipariş miktarı hedef ufkun (lead + review) talebine göre hesaplanır; **stok tükenme alarmı teslimattan önceki günlük akışa** göre ayrıca hesaplanır.
- Bilinmeyen teslim tarihi, tedarikçiden doğrulanmamış PO ve dönemin dışındaki mal gelişi kullanılabilir sayılmaz. Bunlar ayrı gecikme/teyit riski olarak gösterilir.
- Günlük model başlangıç sürümüdür; sevkiyat gün başında sayılır. Gün içi gerçek saat/hızlı tüketim gerektiğinde saatlik model eklenir. Negatif projeksiyon matematiksel açık talebi gösterir, fiilî stok veya negatif stok hareketi üretmez.

**Senaryo A — kritik ürün:** günlük tahmin 10 adet, stok 18, rezerve 3 → kullanılabilir 15. Doğrulanmış 30 adet sipariş 3. gün geliyor. Stok 1,5 günlük talebi karşılar; 2. gün beklenen açık 5 adettir. Sistem stok pozisyonu 45 diye "risk yok" demek yerine erken teslimat veya alternatif toptancı önerir.

**Senaryo B — geç teslimat:** aynı siparişin tarihi bilinmiyorsa veya supplier teyidi yoksa 30 adet hesap dışında kalır; "teslimat teyidi eksik" uyarısı çıkar. Yeni sipariş önerisi mevcut taslağın tekrarı olmamalı; mevcut sipariş hızlandırma/iptal kararı ayrıca incelenir.

### 3.2 Cari limit ve tutar esası

`exposure = open_AP + unbilled_commitments`; `remaining_after = limit − exposure − proposed_financial_cost`. Aynı firmanın cari hesap kodu ve para birimi esas alınır, tüm bağlı istasyonlar birlikte değerlendirilir. Banka ve muhasebe eşitlemesi eksikse limit hesaplanmış görünse bile güvenilir limit onayı verilmez.

| Senaryo | AP | Taahhüt | Öneri | Limit | Sonuç |
|---|---:|---:|---:|---:|---|
| C — limit uygun | 62.000 TL | 20.000 TL | 12.000 TL | 100.000 TL | 6.000 TL boşluk; gecikmiş AP varsa ayrıca OVERDUE |
| D — limit aşımı | 62.000 TL | 20.000 TL | 25.000 TL | 100.000 TL | −7.000 TL; kritik ürün gizlenmez, alternatif + iki imzalı risk yolu |
| E — bilinmeyen limit | Aynı | Aynı | Aynı | Tanımsız | UNKNOWN_LIMIT; sonsuz limit varsayılmaz |
| F — tutar esası belirsiz | Brüt | Net | Net | Brüt | AMOUNT_BASIS_UNKNOWN; otomatik onay yok |
| G — eksik eşleme/veri | Eksik | Eksik | NULL maliyet | Tanımlı | INCOMPLETE_EXPOSURE; sıfır borç/tutar varsayımı yok |

Birden fazla risk birlikte taşınır (array/list): `STOCKOUT_BEFORE_DELIVERY + LIMIT_RISK + OVERDUE` gibi. Tek bir `risk_status` alanı bütün riskleri kaybettirmemelidir. Mevcut recommendation_lines.explanation JSON'una risk listesi yazılabilir; üretimde normalize risk tablosu değerlendirilebilir.

**Önemli:** Tek bir merkezi tedarikçi faturası beş istasyona kopyalanıp beş kez AP toplanmaz. Aynı kaynak belgenin tek AP kaydı veya toplamı birebir olan dağıtımları gerekir. Hesapta sahiplik değişimi varsa eski faturalar/PO'lar kayıt anındaki hukuki firma snapshot'ında kalır; etkin link sorgusu ile yeni firmaya taşınmaz.

## 4. Entegre prototip

[Mevcut wireframe HTML](ui-wireframe-v1.4.html) yerinde genişletilir. Dosya adı önceki bağlantıları korumak için değişmez; içerik v1.6 olarak işaretlenir.

### 4.1 Ekranlar

1. Vardiyaya katılım (önceki ekran).
2. Personel kapanış beyanı (önceki ekran).
3. Slip listesi (önceki ekran).
4. OCR alan kontrolü (önceki ekran).
5. Yetkili mutabakat özeti (önceki ekran; gerekçeli aksiyon kuyruğa gider).
6. Firma kurulum: listeden seçim/yeni firma, tekil kod/kimlik kontrolü.
7. İstasyon–firma atama: kapsam, başlangıç/bitiş ve çakışma önizlemesi.
8. Kullanıcı/görev/rol: yönetici/muhasebe/satış/satın alma şablonları ve kapsam.
9. Yetki matrisi: yönetici ve muhasebeci aksiyon ayrımı.
10. Onay kuyruğu: durum/tür/benim işlemim filtresi, imza sayacı ve vaka seçimi.
11. Vaka detayı: kaynak, risk, imza geçmişi, gerekçe, imzala/bilgi iste/reddet; eski sürüm denemesi.
12. Haftalık sipariş riski: stok tükenme, limit uygun/aşım, belirsiz mali tutar senaryoları.

### 4.2 Prototip davranışı ve sınırı

- Rol seçimi **demo kimlik değiştiricisidir**, güvenli login değildir. MK istasyon yöneticisi, EZ muhasebeci, ZY firma yöneticisi, AY satış personeli. Kendi talebi MK için onaylanamaz; başka kullanıcıya geçince erişim kuralları değişir.
- Firma/atama kayıtları, kararlar ve audit yalnız sayfadaki JavaScript belleğinde tutulur; yenileme veya "Demoyu sıfırla" bütün demo işlemlerini başlangıca döndürür.
- Firma ekleme ve tarih çakışması kontrolü çalışır; bu hukuki kimlik doğrulaması değildir. VKN/TCKN basamak/checksum doğrulaması üretimde ayrıca uygulanır.
- İlk imza sonrası 1/2, farklı yetkili sonrası 2/2 gösterilir. Aynı kişi tekrar imzalayamaz. Yetkisiz, kendi talebi ve eski sürüm denemeleri açıklamalı engellenir.
- Kamera, gerçek OCR, gerçek sipariş, banka eşleme, fiscal fiş/kapanış, PostgreSQL ve Turpak API yoktur. OCR önceki sentetik akıştır.
- Galeri görünümünde bütün tasarım ekranları görülebilir; bu, veri yetkisi testi değildir. Yetkili kuyruğu ve aksiyonlarında demo scope/rol kontrolü uygulanır. Gerçek uygulama backend ve RLS ile korunmalıdır.

## 5. Uygulama öncesi kesinleştirilecekler

- Yönetici rolü hangi firmaları/istasyonları kapsıyor; muhasebeci tüm firma mı, atanmış istasyon mu?
- Tutar/fark türüne göre ikinci imza eşikleri ve minimum kanıt politikası.
- Tedarikçi limit hesabının brüt/net esası, firmalar arasında ortak limit olup olmadığı ve AP kaynağının güncellik kriteri.
- Teslimat teyidi alanı ve siparişin gün içindeki gelişi; stokout alarm ufku.
- Şirket kurulumunda VKN/e-belge gerçek eşleme ve yetki devri sınırı.

İlk pilot önerisi: **bir firma + bir istasyon + ayrı yönetici ve muhasebeci kimliği**, firma kurulum → görev/rol atama → personel vardiya beyanı → kuyruk → iki imza → rapor akışı. Beş istasyon konsolidasyonu aynı sınırlar doğrulandıktan sonra açılır.

## 6. Doğrulama ve demo kullanım sırası

10 Ekim 2026 doğrulaması:
- **27 tarayıcı akış kontrolü başarılı:** firma ekleme/yinelenen kimlik reddi, yetkisiz kurulum, dönem çakışması, yanlış rol/alan reddi, kuyruk kapsamı, kendi talebi, kısa gerekçe, eski sürüm, iki ayrı imza, bilgi isteği, eski mobil/OCR ekran geçişleri ve 390 px mobilde yatay taşma kontrolü.
- **6 hedefli ek kontrol başarılı:** muhasebe imzasından önce firma yöneticisi imzası engeli, doğru imza sırası, seçili 12.000 TL siparişin 6.000 TL boşlukla doğru vaka oluşturması, farklı firma MARKET override sonrası F01 kapsamından yeni talep engeli ve eski vakaların hukuki firma snapshot'ını koruması.
- **8 PostgreSQL 16.15 risk sorgusu kontrolü başarılı:** 1,5 günlük stok kapsamı, üçüncü gün gelişin ikinci gün stoksuzluğu gizlememesi, teyitsiz siparişin hariç tutulması, stok bütünlüğü uyarısı, limit+gecikmiş cari, net/brüt esas belirsizliği, eksik AP snapshot ve NULL öneri maliyetinin karar engeli.
- Önceki v1.5 30 temel şema/sorgu kontrolü de bu SQL testinin sentetik veri hazırlığı sırasında tekrar geçti; yeni sonuçlarla karıştırılmaz.
- Geçici önizleme yerel ve dış HTTP adresinde 200 yanıtıyla kontrol edildi. Bu kalıcı yayın/üretim ortamı değildir.

**Önerilen demo:** ZY kimliğiyle firma/istasyon/rol kurulumunu dene → MK ile onay kuyruğunda V101'i aç → gerekçe girip ilk imzayı at → EZ'ye geçip ikinci imzayı ver. V104'te MK kendi talebini onaylayamaz. V103'te önce EZ cari riskini inceler/imzalar, sonra ZY ticari imzayı verir. Sipariş riski ekranında limit uygun/aşım/tutar belirsizliği seçeneklerini değiştir.

**Demo veri ayrımı:** Kurulum formundaki yeni görev/rol kaydı, sabit demo giriş kimliklerini yeniden yetkilendirmez. Yeni sipariş talepleri etkin MARKET firma eşlemesini kullanır; önceden yüklenmiş vakalar kayıt anındaki F01 ve iş alanı snapshot'ında kalır. Farklı firmaya atama geçmiş vakayı yeni firmaya taşımamalıdır. Sayfa yenileme/sıfırlama bütün demo değişikliklerini kaldırır.

Ekran görüntüleri: [Onay kuyruğu](prototip-v1.6-onay-kuyrugu.png), [Mobil firma kurulumu](prototip-v1.6-firma-mobil.png). Canlı kamera/OCR, banka, Turpak, gerçek oturumlar, üretim izinleri ve paralel transaction testleri kapsam dışındadır.

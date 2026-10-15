# AKARYAKIT V1 — v1.8 Pilot Canlıya Geçiş Checklist ve Risk Azaltım Planı

**Tarih:** 10 Ekim 2026. **Durum:** planlama; gerçek istasyonda yapılmış kontrol veya verilmiş canlıya geçiş onayı değildir.

> Mevcut HTML etkileşimli demo ve örnek PostgreSQL şeması, üretim sistemi değildir. Canlı Turpak/ÖKC, banka, e-belge, güvenli login, saha OCR ve üretim işletim kontrolleri doğrulanmadan “hazır” işareti verilmez.

Her pilot istasyon bu listenin ayrı kopyasını kullanır. Bir istasyonun onayı diğerlerini kapsamaz. Başlangıç önerisi tek firma/tek istasyon; ikinci istasyon ve beşli konsolidasyon ayrı kapıyla açılır.

## 1. Pilot kontrol kartı

| Alan | Doldurulacak değer |
|---|---|
| Hukuki firma / tenant / istasyon / FUEL-MARKET kapsamı | Teyit bekliyor |
| Pilot süreç sahibi | İsim + rol |
| Saha yöneticisi / muhasebe süreç sahibi | İki ayrı kişi |
| Teknik sürüm / commit / DB migration versiyonu | Teyit bekliyor |
| Turpak / pompa ÖKC / market ÖKC marka-model-sağlayıcı | Teyit bekliyor |
| Banka / merchant / POS terminal / settlement hesabı | Teyit bekliyor |
| El terminali / telefon / OS-firmware / tarama modu | Teyit bekliyor |
| Rapor snapshot/cursor ve başlangıç tarihi | Teyit bekliyor |
| Devreye alma penceresi / sorumlu / geri dönüş süresi | Yönetim kararı bekliyor |
| Yetkili Go/No-Go kararı ve kanıt paketi | Verilmedi |

**Kontrol kayıt şablonu:** ID, istasyon, durum (`NOT_STARTED/IN_PROGRESS/PASS/FAIL/WAIVED`), sorumlu kişi, kanıt linki/ID, doğrulama zamanı, test sürümü, gözlenen sonuç, kalan risk ve onaylayan. İşaretli checkbox yalnız gözden geçirilmiş metin değil **kanıtla geçti** demektir.

`WAIVED` yalnız düşük riskli, modül kapalı/izole durumlarda süreli kullanılabilir. Veri kaybı, kimlik/tenant ihlali, mükerrer mali kayıt ve ÖKC resmî işlevini bozma gibi bloklayıcılara waiver yok.

## 2. Aşamalı devreye alma kapıları

| Kapı | Kapsam | Çıkış ölçütü | Geçilmezse |
|---|---|---|---|
| G0 — kapsam/erişim | Firma/istasyon, süreç sahipleri, yetkili veri arayüzü | Kimlik ve kaynak sözleşmeleri belgeli; modül kapsamı belli | Demo/planlama sürer |
| G1 — teknik doğrulama | Üretim benzeri ayrı test DB, kimlik, şema, adapter | Kritik güvenlik/veri bütünlüğü testleri PASS, restore testi PASS | Canlı yazım açılmaz |
| G2 — gölge okuma | Gerçek veriyi izinli biçimde oku, eski sistem çalışır | Seçili ardışık vardiyalarda kaynak toplamı/tekillik açıklanmış | Karar verdiren ekran kapalı/taslak |
| G3 — sınırlı operasyon | Personel kanıtı/inceleme, market mal kabul; onaylı dar kapsam | Personel ve yetkili akışı, vardiya ve stok/cari izleri kontrol edilmiş | İlgili modül geri kapatılır |
| G4 — pilot üretim | Onaylı işletim kapsamı, takip ve destek | Açık bloklayıcı yok, planlı süre/yoğunlukta kabul ölçütleri PASS | Geri dönüş planı |
| G5 — ikinci/diğer istasyon | Kapsam çoğalır | Her istasyonda aynı kanıt seti + cross-scope testleri | Tek istasyonda kal |

**Önerilen kanıt penceresi:** en az üç ardışık tam vardiya; yoğun vardiya, bankaya ertesi iş günü takas ve internet kesintisi senaryosu dahil. Bu süre veya üç vardiya sayısı henüz onaylanmış politika değildir; işlem hacmi ve sağlayıcıya göre daha uzun olabilir.

Gölge okumada mevcut onaylı saha/ÖKC süreçleri asıl kaynak olmaya devam eder. Yeni ERP mali cihazın resmî görevlerini üstlenmez. Yetkili arayüz sağlanamazsa fotoğraf/OCR kaynak etiketli operasyon kanıtı olarak denenebilir; fiscal otomasyon ve resmî eşleşme kapsamı **kapalı** kalır.

## 3. Bloklayıcı kontrol listesi

### A. Firma, kullanıcı ve yetki

- [ ] **A01 — Kimlik/scope (firma yöneticisi + muhasebe):** VKN/TCKN/ünvan, istasyon, FUEL/MARKET tüzel kişi ve fatura bağlantıları gerçek belgelerle eşleşmiş; geçmiş sahiplik snapshot'ları korunmuş.
- [ ] **A02 — Kimlik doğrulama (teknik):** güvenli login, token süresi/yenileme, cihaz iptali ve oturum sonlandırma çalışıyor. Demo rol seçicisi üretime taşınmamış.
- [ ] **A03 — Ayrı kişiler (saha + muhasebe):** kişi bazlı hesaplar, MFA gereken yönetim rollerinde devrede; ortak parola/kişisel hesap paylaşımı yok.
- [ ] **A04 — Scope testleri (teknik):** tenant/firma/istasyon/iş alanı dışı liste, detay, rapor aggregate, CSV, dosya URL ve AI tool erişimleri reddediliyor.
- [ ] **A05 — Rol devri/ayrılma (firma yöneticisi):** kendine yetki yükseltme engelli; işten ayrılanın bütün cihaz token'ları iptal oluyor; iş unvanı tek başına erişim oluşturmuyor.
- [ ] **A06 — İki imza (saha + muhasebe):** kendi talebi, aynı kişi ikinci imza, eski hash/sürüm, çözümlenmiş request ve scope dışı imza reddedilmiş. İmza sırası politika ile uyumlu.

### B. Sunucu, veritabanı ve işletim

- [ ] **B01 — Ortam izolasyonu (teknik):** dev/test/prod DB ve secrets ayrılmış; test runner üretimde çalışmıyor; sürüm/konfigürasyon takipli.
- [ ] **B02 — Migration prova (DB sorumlusu):** şema hedef sürümde kuruldu; backfill, index, FK, veri doğrulama, rollback/forward-fix prova edildi. 16.15 örnek testi seçilen üretim sürümünün testi değildir.
- [ ] **B03 — Yedek/restore (DB sorumlusu):** şifreli yedek geri yüklenerek satır/tutar bütünlüğü doğrulandı; kabul edilen RPO/RTO ve son başarılı restore kanıtı mevcut. Sayısal hedefler işletme tarafından seçilmeli.
- [ ] **B04 — Dayanıklılık (teknik):** sunucu/DB restart, ağ kopması, disk dolması, object-storage hatası, rate-limit ve timeout senaryoları kontrollü denenmiş; sessiz veri kaybı yok.
- [ ] **B05 — Gözlenebilirlik (teknik):** correlation ID, last success, cursor age, retry/DLQ boyu, aynı olayın tekrarları, error/scope reddi ve kaynak güncelliği ölçülüyor. Alarm kanalları/sahipleri denenmiş.
- [ ] **B06 — Beş sabit terminal (teknik + saha):** aynı vardiyada beş bilgisayar eşzamanlı işliyor; altıncı sınır kuralı, cihaz kopması/devir, stale token ve çift gönderim testleri PASS. Telefonlar ayrı katılımcı/device modelinde.
- [ ] **B07 — Bütünlük/race (teknik):** stok, tahsilat tahsisi, AP+unbilled, PO limit ve onay transaction'larında production writer'ları aynı locking/idempotency protokolünü kullanıyor; farklı istasyon writers'ı dahil.

### C. Turpak, ÖKC ve belge adapter'ları

- [ ] **C01 — Yetkili arayüz (sağlayıcı + teknik):** gerçek protokol/API veya izinli export, erişim hakkı, endpoint, marka-model/firmware ve veri alanları yazılı teyit edilmiş. Önerilen dahili JSON'u sağlayıcı API'si sanmıyoruz.
- [ ] **C02 — Sadece izinli görev (sağlayıcı):** pompa/ÖKC fiscal/güvenlik işleyişine müdahale yok; adapter okuma/yazma sınırları ve yetkileri açık.
- [ ] **C03 — Kaynak kimliği (teknik):** terminal/istasyon/pompa/tabanca, satış/fiş/batch/Z raporu, tarih/UTC-ofset, litre/fiyat/tutar, ödeme/iade/ref alanları doğru eşleşmiş.
- [ ] **C04 — Güvenlik (teknik):** secrets vault, TLS/sertifika, gerekli mTLS/allowlist/VPN sağlayıcı koşuluna göre, minimum scope, maskeli log; credential rotation ve yetkisiz access testi PASS.
- [ ] **C05 — Hata yönetimi (teknik):** timeout belirsiz işlem, 401/403/429, bozuk payload, tekrar webhook/import, sıra dışı eski olay, kısmi rapor ve düzeltme olayları kanıtla denenmiş; kör fiscal retry yok.
- [ ] **C06 — Kaynak mutabakatı (saha + muhasebe):** Turpak satış/ÖKC/POS/personel ve iade kapsamı aynı vardiya/time-window içinde karşılaştırılmış; her fark açıklanmış, toplamlar zorla eşitlenmemiş.
- [ ] **C07 — e-belge (muhasebe + sağlayıcı):** bağlanacaksa firma/vergi/numara/UUID, durum sorgusu, iade/iptal ve duplicate testleri PASS. Hazır değilse modül kapalı ve pilot resmî kapsamı dışında.

### D. Banka, POS ve likidite

- [ ] **D01 — Hesap haritası (muhasebe):** merchant/terminal/banka hesabı/para birimi ve firma–istasyon sahipliği doğru; ortak hesap ve kullanılabilir float/bloke ayrımı belgeli.
- [ ] **D02 — Tarife/valör (muhasebe):** tarihli ücret oranı, sabit/min/max ücret, kesinti zamanı, taksit/işlem kategorisi, cutoff ve iş günü/tatil koşulu sağlayıcı belgesinden doğrulanmış. %2 ve Pazar T+1 hard-code yok.
- [ ] **D03 — Gerçek takas örneği (muhasebe):** brüt−komisyon−mahsup−bloke=net banka girişi gerçek batch'lerde bağlanmış; komisyon batch/işlem yuvarlaması ve olası ayrı vergi/fee kesintisi teyitli.
- [ ] **D04 — Tekillik (teknik + muhasebe):** bankaya geçen kart artık bekleyen listede yok; IBAN tekrar eşleşmez; iade/chargeback ikinci kez düşülmez; hesap içi transfer konsolideyi büyütmez.
- [ ] **D05 — AP/AR planı (muhasebe):** vade, planlı değer tarihi, tahsilat beklenti tarihi, kaynağı ve kalem kapsamı ayrı; bilinmeyen tarih/eksik source uyarısı var.
- [ ] **D06 — Stres (muhasebe + firma yetkilisi):** kart gecikmesi, AR %50, bloke, ayrı komisyon ve birleşik senaryolar gerçek pilot girişleriyle çalıştırılmış; ilk açık günü/minimum/hesap bazlı risk kabul edilmiş.
- [ ] **D07 — Nakit tamponu (firma yetkilisi):** banka/istasyon/firma düzeyi minimum nakit ve hangi riskte ikinci imza gerekeceği belgeli; likidite açığı otomatik ödeme/kredi üretmiyor.
- [ ] **D08 — Veri kalite kapısı (teknik):** eski snapshot, para birimi/tutar esası uyuşmazlığı ve eksik takas/komisyon profile'da kesin limit/tahsilat sonucu yok.

### E. Market stok, mal kabul ve satın alma

- [ ] **E01 — Ürün master (market sorumlusu):** SKU/barkod tekil, barkodsuz eşleme kullanıcı onaylı; adet bazlı dönüşüm, vergi/kategori/fiyat ve duplicate kontrolleri çalışır. Kullanıcı ölçeği 5.000 SKU'yla denenmiş.
- [ ] **E02 — Başlangıç stoğu (market + muhasebe):** fizikî sayım ve maliyet snapshot'ı imzalı; bozuk/karantina/rezerve ayrımı; fuel litre defteri MARKET adet defterinden ayrı.
- [ ] **E03 — El terminali (saha + teknik):** seçilen gerçek cihaz/firmware/tarama arayüzünde seri okutma, kullanıcı miktar onayı, aynı olay retry, bağlantı kopması ve offline scope denenmiş.
- [ ] **E04 — Fatura eşleme (satın alma + muhasebe):** birden çok irsaliye/receipt, kısmi miktar/fiyat farkı, barkodsuz satır mapping, iade ve kullanıcı onayı; stok/borç çift post yaratmıyor.
- [ ] **E05 — Tükenme (satın alma):** teslim teyidi/lead-time/risk ufku, günlük veya saatlik talep; yoldaki ürün erken kullanılabilir sayılmaz; gecikmiş teslim uyarısı çalışır.
- [ ] **E06 — Cari limit (muhasebe + firma):** tüm bağlı istasyon AP/PO exposure'ı aynı firma/currency/tutar esasıyla hesaplanmış; NULL maliyet/eksik link otomatik sıfır olmaz.
- [ ] **E07 — Sipariş önerisi (satın alma):** paket/MOQ, fiyat eskiliği, bütçe/cari risk listesi, stokout verisinin yanlış talep düşürmemesi kontrol edilmiş; AI yalnız taslak, onay ve gönderim ayrı.

### F. Personel telefon, OCR ve vardiya

- [ ] **F01 — Telefon/cihaz politikası (saha + teknik):** kişisel cihaz kayıt/iptal/devir, OS izinleri, güvenli depolama, network/offline davranışı ve desteklenen modeller belirli.
- [ ] **F02 — OCR saha kalitesi (saha):** bulanık, eksik tutar, binlik/ondalık farkı, silik/iki slip/yanlış saat/başka terminal/düşük güven testleri; yanlış kesin tutar üretmiyor.
- [ ] **F03 — Kart gizliliği (teknik):** PAN maskeleme yüklemeden/hizmete göndermeden önce uygulanır; CVV/PIN/track saklanmaz; log/AI prompt/object erişiminde hassas ödeme verisi yok.
- [ ] **F04 — Kanıt/kayıt ayrımı (saha + muhasebe):** fotoğraf ve personel onayı tek başına banka tahsilatı/satış yaratmıyor; aynı slip ref/hash iki kez toplamda yok.
- [ ] **F05 — Kapanış (saha):** float/nakit sayım/teslim, slip/POS, IBAN pending, borç satış ve eski cari tahsilatı ayrı; toplamların dönem kapsamı doğru.
- [ ] **F06 — İstisna (yetkililer):** bütün sıfır olmayan farklarda vaka, politika için imza/gerekçe/kanıt; kaynak eksikken operasyonel kapanış fiscal eşleşme olarak işaretlenmiyor.
- [ ] **F07 — Eğitim (saha):** her pilot rolü atanmış vardiya, slip tekrar denemesi, bilgi isteği/geri gönderim ve kapanış sonrası düzeltme akışını uygulamalı tamamlamış.

### G. Patron raporu ve AI

- [ ] **G01 — KPI sözlüğü (firma + muhasebe):** gelir KDV esası, maliyet yöntemi, kâr/katkı tanımı, anlık stok, dönem seçimi ve kaynak zamanı aynı etiketle görünüyor; EBITDA/net kâr yanlış sunulmuyor.
- [ ] **G02 — Konsolidasyon (muhasebe):** hukuki firmalar/para birimleri ayrı; interstation transfer ve merkez faturası tekrarlanmıyor; station minimumu firma toplamının içinde kaybolmuyor.
- [ ] **G03 — Rapor kalite (teknik):** boş/veri eksik dönemde “sıfır satış” iddiası yok; export/drilldown/KPI aynı snapshot/filtre/cursor'a dayanıyor.
- [ ] **G04 — AI scope ve onay (teknik + satın alma):** rol dışında soru/tool erişimi reddedilir; hesaplar deterministic sorgudan, veri zamanı/kaynak gösterilir; belge içi prompt injection yetkiyi genişletmez; otomatik ödeme/fiscal işlem/PO gönderimi yok.

## 4. Risk azaltım matrisi

Düzeyler nicel olasılık tahmini değildir; pilot önceliklendirmesidir. Gerçek risk sahibi kişi adıyla atanmalı.

| Risk | Düzey / tetik | Önleyici kontrol | Azaltıcı aksiyon / sahibi | Yeniden açma kanıtı |
|---|---|---|---|---|
| Yanlış firma/tenant erişimi | Kritik; tek scope ihlali | Backend nesne scope + role + dosya/AI kontrolü | İlgili kullanıcı/adapter erişimini kapat, olay kaydını koru; teknik + firma | Cross-scope test PASS, kök neden/gözden geçirme |
| Mükerrer satış/tahsilat | Kritik; tekrar source ID | UNIQUE + idempotency + transaction | Yeni ingestion/postu durdur, kaynakla karşılaştır, onaylı ters/düzeltme; teknik + muhasebe | Replay doğru tek sonuç |
| Gerçek ÖKC sonucu belirsiz | Kritik; timeout sonrası unknown | Sağlayıcı status/reconciliation, kör retry yok | Mali adapter aksiyonunu durdur; yetkili sağlayıcıyla doğrula; teknik | Yetkili gerçek durum ve duplicate kontrolü |
| Stok hareketi kaybı/eksi fark | Yüksek; source-count/tutar farkı | Ledger + snapshot tie-out + offline queue | Satışı kayıt dışı bırakma; modül kontrollü kanıt/manual fallback, sayım/taahhüt incele; market | Ledger/sayım farkı açıklanmış |
| Cari limit yarışması | Yüksek; aynı hesap iki PO | Shared account lock + recheck + bütün writers | İlgili PO otomatik onayını kapat, açık taahhüdü yeniden hesapla; teknik + satın alma | Concurrent test PASS |
| Valör/komisyon yanlış | Yüksek; net fee mismatch | Gerçek profile/value-date/batch eşleme | Likiditeyi taslak yap, ödeme kararını bloke et; muhasebe | Gerçek batch net/cash timing tie-out |
| Firma pozitif/station açık | Yüksek; hesap minimumu altı | Hesap bazlı projeksiyon ve erişilebilir bakiye | İzinli transfer/ödeme takvimini yetkiliye öner; otomatik para hareketi yok; firma | Transfer planı + kaynak bakiye kanıtı |
| OCR yanlış tutar / duplicate slip | Yüksek; low confidence/ref duplicate | İnsan kontrolü, tekil ref/hash, maskeleme | Kesin toplamı durdur, yeniden fotoğraf/kanıt iste; saha | Gerçek slip–POS alan kontrolü |
| PAN/hassas veri sızıntısı | Kritik; tek ham veri erişimi | Kaynakta maskeleme, private object, erişim/log limit | Upload/işlemeyi durdur, yetkili olay prosedürü; teknik | Güvenlik düzeltmesi ve denetim |
| Eski/eksik kaynak | Yüksek; cursor/interval boş | Watermark/completeness fail-closed | Kesin KPI/limit kapalı, source-label/manual evidence; teknik | Kaynak interval/count tam |
| Yedek var ama restore başarısız | Kritik; restore FAIL | Planlı test + sürüm/veri checksum | Canlıya geçme; yedek ve recovery düzelt; DB | Başarılı restore/tutar kontrolü |
| Ağ/elektrik/telefon kaybı | Yüksek; sync kesintisi | UPS/network planı, cihaz revoke, queue | ÖKC mevcut süreçleri sürer; onaylı offline/manuel kanıt, sonra dedup replay; saha + teknik | Kayıpsız recovery + cihaz iptali |
| AI yanlış/eksik öneri | Orta-yüksek; kaynak eksik veya hallucination | Deterministic hesap, kaynak güncelliği, insan onayı | Öneri özelliğini kapat, stok/cari manuel inceleme; satın alma | Tool scope ve fixture/saha değerlendirme PASS |
| Kullanım hatası | Orta; eğitim/tamamlanmamış vardiya | Rol bazlı uygulamalı eğitim | Pilot kapsamını daralt, görev başı destek; saha | Kişi başı senaryo başarı kaydı |

## 5. Geri dönüş ve güvenli durdurma planı

**Tetikler:** kritik güvenlik/scope ihlali, kayıp/mükerrer mali kayıt, ÖKC belirsiz sonuç, veri tutarlılığı bozulması, geçerli restore yolu olmaması veya onaylı nakit tamponu altına inip açıklanmayan kaynak eksikliği.

1. Olay sorumlusu ve firma/saha/muhasebe sahipleri bilgilendirilir; olay ID ve zaman kaydedilir. Sayısal müdahale süresi işletme tarafından kararlaştırılır.
2. Etkilenen **yeni ERP yazımını** feature flag/adapter stop ile durdur; tüm istasyonu körlemesine kapatma. Mevcut yetkili pompa/ÖKC operasyonunu bozma.
3. In-flight request'ler `UNKNOWN/PENDING_REVIEW` olarak izlenir; yeniden göndererek mali işlemi çiftleme. Gerçek durumu sağlayıcıdan sorgula.
4. DB/object-store/audit ve cursors'ın korunmuş snapshot'ını al; olay kanıtlarını silme.
5. Eski onaylı işletme süreciyle devam et; fark kaydını manuel/kanıtlı tut. Eski ve yeni sistemin aynı işlemi iki kez post etmesini önleyecek sahiplik belirle.
6. Yeni işlemler olmuşsa eski backup'ı kör restore etme. Forward-fix veya onaylı ters kayıt/taşıma planı; kaynak belge ve posted ledger korunur.
7. Düzeltme/replay önce ayrı test ortamında, duplicate source ID kontrolü ve expected totals ile denenir.
8. Teknik + saha + muhasebe kanıt paketini onayladıktan sonra modül kademeli açılır. Kritik olayda canlıya dönüş ayrıca Go/No-Go kararı ister.

Gerçek kapanmış fiscal belge ERP veritabanı rollback'i ile iptal edilmiş sayılmaz. Resmî belge düzeltme yöntemi yetkili sağlayıcı ve muhasebe süreciyle ayrı yürür.

## 6. Go / No-Go kararı

**GO:** ilgili kapsamın bloklayıcıları PASS, kanıt güncel ve sürüm eşleşiyor; gerçek kaynak eşlemeleri tam; açık kritik/yüksek veri bütünlüğü olayı yok; yedek/restore ve fallback denenmiş; üç süreç sahibi hazır. Üç rolün test kanıtı onayı otomatik resmî/mali onay yerine geçmez.

**NO-GO:** demo-only login veya fake banka/API, teyitsiz firma/ÖKC erişimi, hard-coded bank fee/valör, duplicate/loss, cross-tenant erişim, eksik restore, uygulanmamış iki kişi onayı veya yanlış toplamla kesin rapor.

**KOŞULLU:** yalnız izole düşük riskli kapsam. Örn. salt-okunur kaynak etiketli dashboard pilotu yapılabilir; hazır olmayan mali/fiscal yazım kapalı kalır. Her istisna sahibini, bitiş tarihini ve kapalı özelliği yazılı belirtmeli.

### Karar tutanağı

| İmza/karar | Kayıt |
|---|---|
| Firma yetkilisi — kapsam/ticari risk | İsim, tarih, karar, gerekçe |
| Saha yöneticisi — personel/stok/vardiya | İsim, tarih, kanıt paketi |
| Muhasebe — banka/cari/fiscal sınırı | İsim, tarih, kanıt paketi |
| Teknik/DB sorumlusu — güvenlik/recovery | İsim, tarih, sürüm ve test özeti |
| Kalan risk/kapalı modül | Sahip, çözüm tarihi, yeniden karar koşulu |

Bu belge onayların verilmiş olduğunu söylemez; gerçek onay ve erişim için ilgili kişilerle ayrıca koordinasyon gerekir.

## 7. İlk pilot izleme ve ikinci istasyona geçiş

Her vardiya kontrolü: kaynak count/tutar, açıklanmamış fark, duplicate reddi, bankaya geçmemiş kart/IBAN, kasa float/sayım, AR tahsis, stock ledger/count, açık PO/AP, onay kuyruğu yaşı ve cihaz/senkron sağlığı.

Her gün kontrolü: AP value-date, bank net fee, kaynak freshness, hesap minimumu/tampon, beklenen/gerçekleşen nakit farkı, yedek başarısı ve olay kayıtları. Bu görev otomasyon/alert kurmadı; burada süreç gereksinimleri listelenir.

Başarı ölçümü: manual correction oranı, personel kapanış süresi, açıklanmamış fark sayısı/tutarı, duplicate kabul sayısı (**0 hedef**), source-gap/sync backlog, stokout ürün-gün, beklenen–gerçekleşen tahsilat/fee farkı, 5 terminal concurrency, eğitim tamamlanma.

İkinci istasyon için ek şartlar: ilk pilotta onaylı pencere tamam; çözülmemiş kritik olay yok; aynı test paketi ikinci istasyon gerçek cihaz/profillerinde tekrar PASS; cross-station/tenant ve ortak tedarikçi/rapor toplamları bağlanmış.

## 8. Mevcut kanıt ile eksik kanıt ayrımı

| Mevcut | Henüz eksik |
|---|---|
| v1.7 sentetik PostgreSQL 19 olay testi, 16.15 motor | Gerçek üretim DB/driver/sürüm/işlem hacmi testleri |
| Tarayıcıda 23 rapor/finans + 27 eski akış kontrolü | Gerçek auth/device scope, backend RLS, beş gerçek cihaz |
| Demo 15 likidite duyarlılığı | Banka sözleşmesi/komisyon/net/value-date örnekleri |
| HTML role switch ve demo karar geçmişi | Güvenli hesap, MFA, private object, üretim audit/backups |
| Cihaz bağımsız API öneri sözleşmesi | Turpak/ÖKC/el terminali gerçek adapter ve sağlayıcı teyidi |

**Önerilen ilk hareket:** pilot firma/istasyon ve dört süreç sahibini belirlemek; banka/POS tarife-valör belgeleri, gerçek takas örnekleri, izinli Turpak/ÖKC veri arayüzü ve açılış stok/cari/banka snapshot'ını kanıt paketine toplamak.

İlgili inceleme: [Likidite ve komisyon ayrıntısı](likidite-v1.8-detayli-inceleme.md). Liste uygulanabilir operasyon/teknik planıdır; hukuki uygunluk, sağlayıcı yetkisi veya resmî muhasebe onayının yerine geçmez.

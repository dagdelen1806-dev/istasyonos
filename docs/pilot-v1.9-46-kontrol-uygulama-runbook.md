# AKARYAKIT V1 — v1.9 Pilot 46 Kontrol Uygulama Runbook'u

**Tarih:** 10 Ekim 2026. **Durum:** uygulanacak test/işletim planı, tamamlanmış canlı kontrol değildir. [V1.8 checklist](pilot-v1.8-canliya-gecis-kontrol-risk-plani.md) ID'leri aynı kalır; hiçbir madde kaldırılmaz. [Mobil vardiya/OCR/muhasebe tasarımı](tasarim-v1.9-personel-mobil-vardiya-ocr-muhasebe.md) yeni personel hesabı ve fizikî/dijital teslim kurallarını içerir.

## 1. Çalıştırma yöntemi

1. Pilot firma/istasyon, FUEL/MARKET modül kapsamı, test penceresi ve dört süreç sahibi kişi adlarıyla kaydedilir.
2. **G0** kimlik/sağlayıcı belge → **G1** ayrı test ortamı → **G2** gölge gerçek veri → **G3** sınırlı kullanım → **G4** pilot üretim kapıları sırayla açılır. Üretim öncesi testler staging'de yapılır; sonra izinli gerçek örneklerde salt-okunur doğrulama yapılır.
3. Her kontrol bir `run_id + control_id + station + build/migration_version` kayıt kimliği alır. Durum başlangıçta `NOT_STARTED`; PASS ancak kanıtla verilir.
4. Hata üretme testlerinde gerçek pompa/ÖKC'yi ağdan kesme, banka talimatı gönderme, real official belge yaratma veya personel bilgisini yayınlama yok. Yetkili sağlayıcı test ortamı ve kurumca onaylı test planı kullanılır.
5. “Test geçti” başka sürüm/istasyon için tekrar kullanılmaz. Bir modül kapalıysa `NOT_IN_PILOT` kapsam gerekçesiyle listelenir; PASS olarak işaretlenmez.

**Kanıt paketi:** tarih/saat, uygulama sürümü, source/fixture ID, maskeli ekran/log, expected/observed, ilgili request/cursor/hash, test eden ve gözden geçiren kişi. Ham sır/PAN/kişisel veri log'a eklenmez. Her test fail'inde vaka ID'si ve yeniden test koşulu yazılır.

**Bağımlılık:** A+B temel kontrolleri C/D/E/F/G'den önce; C kaynakları F/G mutabakatından önce; D01–D05 gerçek finans D06 stresinden önce; E01–E04 E05–E07 önerilerden önce; F01/F03 F02 OCR alan testinden önce; A06 tüm kabul/istisna akışından önce.

## 2. A — Firma ve yetki: 6 kontrol

| ID / sahip | Uygulanacak adımlar | Test ve PASS kanıtı | FAIL aksiyonu |
|---|---|---|---|
| **A01** Firma yöneticisi + muhasebe | Firma/istasyon/VKN/alan kaynak belgelerini topla; etkin dönem eşleme yap; tarihsel firma snapshot'larını belirle. | FUEL/MARKET bir örnek fiş/fatura/cari sahibi ile eşleşir; firma değişimi eski belgeyi taşımaz. Belge-ID eşleme tablosu ve imzalı teyit. | Yeni firma scope'unda kayıt açma; mapping ve geçmiş kaynaklar düzeltilir. |
| **A02** Teknik | Login/session süresi, refresh, revoke, cihaz kaydı ve PWA auth/CSRF seçimini uygula; staging yapılandırmasını kaydet. | Yanlış login, expiry, revoked token, refresh replay ve logout testleri yetkisiz sonuç verir; doğru kullanıcı own-scope açar. | Mobil/üretim erişimi kapalı; demo role-picker production'dan çıkarılır. |
| **A03** Firma + teknik | Her gerçek kişi için ayrı hesap; amir/muhasebe/firma ayrımı; yönetim MFA politikasını etkinleştir; ortak şifreyi kaldır. | Aynı kişinin farklı rolleri ikinci kişi sayılmaz; farklı iki kişi gerekli onayı verir. Maskeli kimlik/rol test listesi. | Onay işlemleri kapalı; rol/kimlik matrisi düzeltilir. |
| **A04** Teknik güvenlik | API list/detail/export/aggregate, evidence download ve AI tool'lara scope policy uygula. | Başka tenant/istasyon/çalışan ID'si request/body/URL ile denendiğinde reddedilir; dosya URL'si hak genişletmez. Test matrisi. | Etkilenen modül anında izole; güvenlik olayı ve fix sonrası bütün yüzeyler tekrar test. |
| **A05** Firma yöneticisi | Kullanıcı devir/pasifleşme, rol tarihleri ve device revoke akışını uygula; self privilege escalation kapısını kapat. | Pasif employee'ın mevcut token/upload link ve eski rolü işlemi sürdüremez; sahipsiz hesap raporu boş. | Hesap ve cihazlar kontrollü iptal; rol atamalarını düzeltmeden tekrar açma. |
| **A06** Amir + muhasebe | Onay policy_version, payload hash, kullanıcı ve sıra kurallarını uygulama transaction'ına al. | Kendi talebi, aynı gerçek kişi iki rol, stale revision, paralel imza ve kapanmış request reddi; yeterli farklı imzada bir karar. | Kabul/istisna özelliğini kapat; eski geçersiz imzayı yeni revision'a taşımama. |

## 3. B — Sunucu ve veri: 7 kontrol

| ID / sahip | Uygulanacak adımlar | Test ve PASS kanıtı | FAIL aksiyonu |
|---|---|---|---|
| **B01** Teknik | Dev/staging/prod DB, bucket, credentials, endpoint ve feature flags'ı ayır; secrets env/vault; sürüm/commit envanteri. | Test hesabı prod yazamaz; staging/prod target doğrulaması; test runner doğru olmayan ortama DDL uygulamaz. | Deployment durur; hedef/secret ayrımı düzeltilir. |
| **B02** DB sorumlusu | Şema keşfi ve ID-map; additive migration, backfill/checksum, orphan raporu, FK/index validation ve forward-fix prova. | Üretim benzeri kopyada migration sonrası satır/tutar ve FK bağları korunur; geri dönüşte veri kaybı yok. Migration planı/çıktısı. | Cutover yok; veri eşleme/recovery düzelt. Eski tablo hemen silinmez. |
| **B03** DB + storage | Kurumca seçilmiş RPO/RTO'ya göre yedek + evidence metadata/object restorasyonunu ayrı ortama yap. | Restore edilen kayıt ve dosya hash'leri/satır/tutarlar kaynakla bağlanır; measured süre ve kayıp aralığı onaylı hedefte. | G4 açılmaz; yedek varlığı tek başına PASS değil. |
| **B04** Teknik | Staging'de servis restart, DB erişim hatası, disk/storage/queue timeout, network ve rate-limit fault injection. | Kabul edilmiş event kaybolmaz, unknown durumu görünür; retry duplicate üretmez; audit/queue recovery kanıtlı. | Yeni ingest/post modülü durur; backlog/unknown reconciliation. |
| **B05** Teknik operasyon | Correlation/cursor/source age, DLQ/retry, hata ve kaynak-gap panelleri; süreç sahibi alarm kanalı. | Kontrollü hata doğru alarm+olay ID'si üretir; normalleşme log'u; secrets/PAN maskeli. | G2/G4 görünürlüğü olmadan devam etmez; manuel kontrollü dar kapsam. |
| **B06** Teknik + saha | Beş masaüstü, kendi telefonları ve aynı vardiya kimliğiyle gerçek cihaz setini kur; device trace tut. | Aynı anda 6 desktop registration yarışında 5 aktif; mobil limit dışı; bağlı identity kaybolmaz; cihaz iptal/devir test. | Birlikte satış limiti açılmaz; atomik device kayıt servisi düzeltilir. |
| **B07** Teknik + DB | Stok/cari allocation/PO shared-account lock, AP+unbilled tek transaction, idempotency ve outbox bütün writers'a uygulanır. | Paralel farklı istasyon PO'ları güncel exposure'ı görür; bir tahsilat iki borcu aşarak kapatamaz; replay bir post. Concurrency trace. | Etkilenen write/auto-approval kapalı; ledger ve kaynakla forward reconciliation. |

## 4. C — Turpak / ÖKC / e-belge: 7 kontrol

| ID / sahip | Uygulanacak adımlar | Test ve PASS kanıtı | FAIL aksiyonu |
|---|---|---|---|
| **C01** Sağlayıcı + teknik | Yetkili dış API/export sözleşmesi, endpoint/protokol, firmware/device ve test erişimini yazılı al; iç API'den ayır. | Gerçek source payload parse, station/device ID ve erişim scope doğru; sağlayıcı teyit dosyası. | API entegrasyonu hazır sayılmaz; OCR/manual evidence sınırıyla salt kanıt pilotu. |
| **C02** Sağlayıcı + saha | Adapter'ın izinli görevleri ve fiscal resmî işleyişin bağımsızlığını netleştir; okuma scope'undan başla. | Testlerde mali cihaz/TSM/ÖKC resmî süreci kesilmez; provider görev-sorumluluk teyidi. | Etkilenen adapter kapalı; mevcut yetkili saha operasyonu sürer. |
| **C03** Teknik + saha | Station/pump/nozzle/terminal/person source, business-date, time zone, currency/litre/fiyat, fiş/Z/batch field map. | Aynı örnek işlemin tüm referansları kaynakla eşit; toplam yalnız doğru dönem; attribution olmayan satış kişiye zorla bölünmez. | Kaynak/person eşleme kuyruğu; kesin personel farkı/rapor kapalı. |
| **C04** Teknik güvenlik | Vault referansı, TLS/sertifika, provider şartlı mTLS/allowlist, least privilege ve rotation. | Yanlış/eski credential ve yetkisiz ağ reddi; yeni credential geçişi kontrollü; log secret içermez. | Auth başarısızlığına kör retry yok; provider koordinasyonuyla düzelt. |
| **C05** Teknik | Sağlayıcı staging'inde 401/403/429, malformed, duplicate/out-of-order, timeout/unknown, partial response fixture'ları. | Retry yalnız izinli/bounded; unknown fiscal request yeniden post olmaz; status sorgu/ref ve DLQ kanıtı. | Yazım durur; vendor doğrulaması beklenir; yeni duplicate belge yok. |
| **C06** Saha + muhasebe | Ardışık vardiya aynı time-window'da Turpak/ÖKC/POS/personel kaynak setini çıkar; void/refund/boundary dahil. | Count + toplam + ref bazlı bağ; bütün sıfır olmayan farklar vaka/açıklama; kaynak eksiği sıfır değil. | Normal kapanış yok; kontrollü pending-source exception ayrı imza. |
| **C07** Muhasebe + sağlayıcı | E-belge kapsamındaysa provider test şirketiyle kimlik/UUID/status/duplicate ve iade/iptal yöntemini dene. | Kaynak UUID ve firma bir kez, durum doğru; resmî test şartları teyitli. | E-belge modülü pilot kapsamı dışında kapalı; resmî süreç mevcut kaynaktan. |

## 5. D — Banka ve gerçek likidite: 8 kontrol

| ID / sahip | Uygulanacak adımlar | Test ve PASS kanıtı | FAIL aksiyonu |
|---|---|---|---|
| **D01** Muhasebe | Kasa/count/float, banka available/blocked, station/firma ve merchant account haritası; gerçek snapshot saati. | Kaynak sayım/ekstre ile opening bağlanır; available'dan blocked iki kez çıkarılmaz; transit cash çift sayılmaz. | Gerçek opening sonucu yayınlanmaz; veri toplama formuna dön. |
| **D02** Muhasebe | Gerçek tarihli yüzde/fixed/min/max ücret, kesinti zamanı, cutoff/T+N/calendar/hold profili gir. | Sözleşme + net settlement örneğiyle doğru yürürlükte profil seçimi; tatil/Pazar valör testi; unknown risk flag. | %2/T+1 fallback'le kesin tahmin yok; profile teyidi. |
| **D03** Muhasebe + teknik | Gerçek batch brüt/satış/iade/ücret/reserve/net ve value-date tie-out; transaction/batch rounding. | Net banka satırı ve fark breakdown; fee nete gömülü ise ayrıca cash outflow değil. | Fee/value-date anlaşmazlığı vaka; bu batch tahmini taslak. |
| **D04** Teknik + muhasebe | Kart pending→matched, IBAN partial/replay, refund/chargeback ve internal transfer event IDs. | Aynı settlement iki kez bankayı büyütmez; true net ve gross ayrılır; internal transfer konsolide net 0. | Ödeme eşleme write kapalı; kaynakla düzeltme/ters event. |
| **D05** Muhasebe | AP invoice/open items, planlı ödeme tarihleri, AR beklenen tahsil günü/kanıtı, maaş/kira/vergi/kredi ve gider listesi. | Eşleşmiş/unpaid kalem bir kez; unknown tarih dışlanıp gizlenmez; completeness sahibi onaylar. | Eksik giderle pozitif sonuç gerçek yeterlilik sayılmaz. |
| **D06** Muhasebe + firma | Gerçek girişlerle 7/14/30 gün ve yakın dönem saatlik; kart delay/AR yarı/hold/refund/combined stres. | İlk açık günü/minimum/hesap/istasyon, whole-window tie-out; stres kaynak ve varsayımı görünür. | Planlı ödeme/sipariş kararını insan review'e al; gerçek kaynak düzelt. |
| **D07** Firma yetkilisi | Firma/banka/istasyon tamponları, shortage alarm ve izinli transfer/payment approval sınırını yazılı belirle. | Onaylı minimum politikası her hesapta görünür; firmada fazla, istasyonda açık senaryosu alarm üretir. | Tampon boşken güvenli nakit tavsiyesi sunma; parametre onayı beklenir. |
| **D08** Teknik + muhasebe | Snapshot age, bank export completeness, currency/amount basis ve missing fee/valör gates. | Unknown alan 0 veya default %2 olmaz; candidate/estimated/actual etiketleri, blocking codes doğru. | Kesin nakit/limit sonuçları kapalı; completeness kanıtıyla yeniden çalıştır. |

## 6. E — Market, mal kabul ve satın alma: 7 kontrol

| ID / sahip | Uygulanacak adımlar | Test ve PASS kanıtı | FAIL aksiyonu |
|---|---|---|---|
| **E01** Market + teknik | 5.000 SKU gerçek/test catalogue, tekil barkod index, diğer barkod alias, adet master, tax/category/fiyat map. | Duplicate barcode/ambalaj çakışması reddi; barkodsuz mapping insan onaylı; yoğun arama/okutma süreleri onaylı hedefte. | Master kontrolü bitmeden satış/mal kabul import açılmaz. |
| **E02** Market + muhasebe | Fizikî sayım, başlangıç maliyet yöntemi ve good/damaged/quarantine/reserved ayır; FUEL litre farklı ledger. | Açılış count/cost onayları, SKU reconciliation; yakıt litre kaydı market adet toplamına girmez. | Açılış stock rakamı kesin kabul edilmez; yeniden sayım/maliyet kontrolü. |
| **E03** Saha + teknik | Seçilen PM80 veya başka gerçek profil scan wedge/SDK/HID, adet ekranı, offline policy ve sync. | Seri scan/qty, duplicate sync, invalid barcode, revocation ve network return; event bir acceptance. | Device profilinde mal kabul yok; onaylı manuel kayıt yöntemi. |
| **E04** Satın alma + muhasebe | Receipt–invoice line mapping, kısmi teslim/fatura, fiyat/adet farkı, barkodsuz eşleme, PO invoiced/accepted ayrımı. | Stok yalnız fizikî kabulde, AP belgeyle bir kez; iki receipt/tek invoice ve tek receipt/iki invoice tie-out. | Fark review, invoice/AP ve stock otomatik post kapalı. |
| **E05** Satın alma | Gerçek demand quality, source-gap/stockout, expected_delivery ve confirmed PO; ufuk günlük/saatlik. | Geciken yoldaki ürün stoğu erken kapatmaz; stok yok günü talep 0 sayılmaz; kaynaklı risk sonuçları. | Tavsiye manual review; shipment teyidi ve demand düzelt. |
| **E06** Muhasebe + firma | Aynı legal company/currency/contract base bütün station linked AP/unbilled/proposal exposure; limit geçerlilik. | İstasyon atlayıp limit fazla çıkmaz; net/brüt/NULL/unmapped gates; aynı hesap yarış testi. | Auto approval kapalı; bütün exposure/kaynak eşlemesi. |
| **E07** Satın alma | Offer age, gerçek lead/MOQ/pack/capacity/expiry/bütçe, alternatives ve PO submit approval. | Kritik ürün limit nedeniyle gizlenmez; öneri deterministic, source/snapshot kaydedilir; AI auto PO/ödeme göndermez. | Sipariş öneri modülü kapalı, yetkili manuel satın alma. |

## 7. F — Personel mobil/OCR/hesap teslimi: 7 kontrol

| ID / sahip | Uygulanacak adımlar | Test ve PASS kanıtı | FAIL aksiyonu |
|---|---|---|---|
| **F01** Saha + teknik | Pilot telefon/OS/kurulum PWA ya da native kararını kaydet; security/device/offline politikası; İSG izinli giriş/çekim alanı. | Her desteklenen telefon kurulum/login/atama/camera/permission/revoke tamam; offline ACK görünümü doğru; cihaz/İSG listesi. | Desteklenmeyen telefon/alan kullanımı yok; onaylı tarayıcı veya kurum cihaz fallback. |
| **F02** Saha + muhasebe | İzinli gerçek maskeli slip seti: silik/blur/decimal/refund/decline/report/mixed currency/period/owner; candidate→review→verified. | Teyitsiz/yanlış tür toplam dışı; doğru tekil teyit sonrası aggregate; duplicate+rerun ikinci toplama yok. Alan/expected/observed raporu. | Adaylar kesinleşmez; manuel insan doğrulamalı capture/review fallback. |
| **F03** Teknik güvenlik | On-device güvenli crop/redaction, private upload/download, no raw PAN/CVV/PIN logs/model text; retention. | Fail redaction dış upload'ı bloke eder; ham hassas görüntü persist/harici model payload'ında yok; ACL test PASS. | Görsel pipeline kapalı; güvenlik olayı ve safe recapture. |
| **F04** Teknik + muhasebe | Evidence ID/source ref + ownership; candidate/verified/POS/bank gross/net ayrı read models. | OCR completion hiçbir sale/AR/cash ledger trigger'ı çalıştırmaz; matched/void/refund seti tek; birebir/ref farkı görünür. | Auto aggregate durur; evidence-source reconciliation. |
| **F05** Saha + muhasebe | Own employee shift account, opening float, CASH/DEBT/IBAN/slip/old AR, ara cash handover ve final count akışını çalıştır. | 10.000 TL örnek satış + 500 eski tahsilat + float 100 − ara teslim 1.000 = expected 2.600; count 2.590 fark −10; final offered 2.490; accepted cash ayrı. | Hesap teslim kabulü yok; sayım/kaynak/para sahibi düzeltmesi. |
| **F06** Amir + muhasebe | Submitted revision kilidi; saha review/muhasebe review ayrı; cash receive; missing-source ve pending bank exception. | Self/stale/race red; bilgi iste yeni revision; mali kabul bankayı posted yapmaz; station close ayrı permission; geç gelen source yeni vaka. | Normal kapanış yok; kontrollü exception policy, eski imzayı taşıma yok. |
| **F07** Saha eğitim sorumlusu | Her rol için kurulum, vardiya hesabı, tender, slip/retake, pending/offline, submit, bilgi talebi ve teslim simülasyonu. | Katılımcı başına uygulamalı senaryo ve destek iletişimi; muhasebe slip source/net fee ve physical/digital teslim farkını açıklar. | Eğitimsiz kullanıcı write pilotu açılmaz; gölge/koçlu kullanım. |

## 8. G — Rapor ve AI: 4 kontrol

| ID / sahip | Uygulanacak adımlar | Test ve PASS kanıtı | FAIL aksiyonu |
|---|---|---|---|
| **G01** Firma + muhasebe | KPI sözlüğü: satış/net/KDV/SMM/gider/katkı, snapshot/dönem, source label ve confidence. | Aynı source dönem hesabı UI/export/detail'e eşit; contribution net kâr/EBITDA diye sunulmaz. | Patron KPI kesin yayını yok; label/source düzelt. |
| **G02** Muhasebe + teknik | Firmalar/currency ayrı; internal transfer + merkez belge duplication; banka/istasyon risk drilldown. | Station sum doğru; aynı central invoice bir kez; konsolide pozitif–station negatif uyarısı görünür. | Konsolide rapor taslak/kapalı; ownership eliminasyonlarını düzelt. |
| **G03** Teknik | Report query snapshot isolation/cursor, filtre/drilldown/export ve completeness. | Missing day/timestamp verisi “0 satış” olmaz; değişen kaynakta eski CSV güncel gibi gösterilmez; test tie-out. | Kesin report/export kapalı; kaynak gap düzeltilir. |
| **G04** Teknik + satın alma | Scoped deterministic tools, prompt-injection test, candidate-source/time, human approval. | Rol dışı soru/doc talimatı yetki büyütmez; LLM tutar uyduramaz, ödeme/fiscal/PO gönderim çağrısı yok. | AI kapalı, deterministic manual rapor akışı sürer. |

## 9. Detaylı gün başlangıcı–teslim–muhasebe vardiya prosedürü

### Vardiya öncesi

- Saha yöneticisi aktif atama/device/izinli telefon alanını kontrol eder.
- Personel kendi atanmış hesabını açar; opening cash/float teklifini sayar, fark varsa amire bildirir.
- Online source cursor ve terminal–kişi eşleme teyit edilir. Personel source attribution yoksa kesin kişi hesap farkına dayanılmaz.

### Vardiya sırasında

- CASH, IBAN pending, DEBT satış reference, old AR collection birbirinden ayrı girilir.
- Slip izinli alanda çekilir, yerelde maskelenir, server OCR alanları otomatik doldurur; teyitli tekil slipler otomatik toplama girer.
- Ara cash delivery `OFFERED → ACCEPTED/DISPUTED`; alıcının kabul tutarı görsel/ID ile izlenir.
- Kamera/sync problemi başka ödeme kaydının kaybolmasına yol açmaz; pending kaydı ve destek yolu görünür.

### Personel hesap teslimi

- Nakit sayımı, korunacak float, ara teslim, teyitli slip, pending OCR/IBAN ve borç dağılımı gözden geçirilir.
- Tekil submission ID/hash ile gönderilir; server ACK gelince `SUBMITTED`; telefon offline ise “teslim edildi” değil “gönderim bekliyor”.
- Son fizikî nakit teklifini alıcı sayarak kabul eder. Kapanış snapshot'ı final handover nedeniyle ikinci kez eksiye çekilmez.

### Amir saha kontrolü

- Nakit/ara teslim/person ownership ve personel dönemini kontrol eder.
- Turpak/ÖKC kaynağını aynı dönem/ref setinde ayrı görür; source missing veya farklarda review.
- Personel own account teslimini station shift closure ile karıştırmaz.

### Muhasebe mali kontrolü

- Slip toplamı POS brüt/işlem kimlikleriyle bağlanır; net banka komisyonu slip farkı sanılmaz.
- Borç satış AR debit ve eski collection AR credit/allocation tekil kontrol edilir.
- IBAN bank match ve kart settlement pending/actual ayrılır; cash receiver accepted kanıtı incelenir.
- Son revision/hash'i uygun scope'ta kabul eder veya gerekçeli bilgi isteği verir. Muhasebe remote review ise fizikî cash receiver adı ayrı.
- Kabul edilen hesapta pending financial source'lar takip kuyruğunda kalır; eski beyan sessiz update edilmez.

## 10. Tamamlama ve Go/No-Go

46 kontrol için kanıt kayıtları birleştirilir. Canlıya geçiş teknik/işletim kararı kendiliğinden verilmez; süreç sahipleri exact sürüm, istasyon ve modül kapsamıyla karar verir. Açık bloklayıcı güvenlik/veri kaybı/duplicate/fiscal unknown/restore failure varsa NO-GO.

Kapsam dışı modülü kapalı tutarak salt-okunur pilot yapılabilir; bu modüle `PASS` denmez. Geri dönüş: etkili ERP yeni yazımlarını durdur, mevcut yetkili pompa/ÖKC sürecini sürdür, unknown in-flight'i sorgula, kanıtı sakla, kaynak reconciliation/forward-fix sonrası yeniden karar. Yeni mali hareketler olmuşken eski backup'a kör dönülmez.

**Gerçek likidite durumu:** kaynak bakiyeler/POS şartları henüz kullanıcıdan gelmedi; [veri toplama şablonu](pilot-v1.9-gercek-veri-toplama.xlsx) doldurulmadan gerçek risk hesabı yok. Planı ayrıntılandırmak veri doğrulaması veya geçiş onayı yerine geçmez.

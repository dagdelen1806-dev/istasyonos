# AKARYAKIT V1 — Turpak dosya/OCR aktarımı ve KVKK güvenlik mimarisi

**Turpak’ın API yanıtını beklerken izinli rapor çıktılarıyla ilerleyebiliriz.** Öncelik yapılandırılmış dosya, ardından metin içeren PDF, son olarak tarama/fotoğraf OCR olmalı. Her belge, kaynağı ve kapsadığı dönemle birlikte yetkili kontrolüne girmeli; OCR ile okunan rapor, kendiliğinden canlı Turpak işlemi veya banka tahsilatı sayılmamalı.

**10 Ekim 2026 — v2.2 tasarım eki.** İlk pilot bir istasyon, günlük 500–1.000 POS slipi. Turpak’a başvuru yazılım tamamlandıktan sonra yapılacak. Bu belge mimari öneridir; başvuru, yetkili API erişimi, KVKK hukuki uygunluk onayı veya çalışan maskeleme servisi değildir. [Önceki bütçe planıyla](uretim-v2.1-bulut-turpak-ocr-maliyet-plani.md) birlikte okunmalı; bu ek telefon tarafındaki maskelemenin tek başına yeterli olmadığını kesinleştirir.

## 1. Turpak’a başvuru ve resmî yanıtın sistemde izlenmesi

Turpak’ın resmî iletişim sayfasında **turpakinfo@turpak.com.tr** ve **+90 850 600 08 77** istasyon destek/çözüm kanalı bulunuyor. İlk temas, talebin doğru teknik/ticari birime yönlendirilmesini ve resmî yazının hangi kanaldan kabul edildiğini öğrenmek içindir. Bu sayfada üçüncü taraf API başvurusu için kesin yanıt süresi veya otomatik onay taahhüdü yok. KEP adresi doğrulanmadan tahmin edilerek gönderim yapılmaz. [1]

### Başvuru dosyası

Yazılım tamamlandığında firma yetkilisinin onaylayacağı paket, firma ve istasyon sahipliği/temsil bilgilerini, ilgili lisans ve bakım sözleşmesini, ürün/model/sürüm envanterini ve talep edilen salt okunur veri alanlarını içermeli. YN pompa ÖKC ile market ÖKC ayrı ürünlerse ayrı cihaz listeleri hazırlanmalı. Test için gerçek kart/kişisel veri içermeyen örnekler tercih edilmeli; teknik yazıya üretim parolası veya tam slip görüntüsü eklenmemeli.

Talep iki seçenekle sunulmalı: **yetkili API/web servis** veya **yetkili dosya/rapor dışa aktarımı**. Satış kimliği, tarih/dönem, tutar/litre/fiyat, varsa personel-pompa atfı, iade/iptal ve rapor kapanış bilgileri istenmeli. Teknik şema, lisans bedeli, geçmiş veri sınırı, erişim yetkisi, rate limit ve test ortamı ayrıca sorulmalı. Pompa kontrolü, mali fiş üretimi ve GİB/TSM mesajlarına müdahale bu talebin dışında kalır.

### Talep durumları

```text
DRAFT → INTERNAL_AUTHORIZED → SENT → RECEIPT_CONFIRMED
      → TECHNICAL_REVIEW → CLARIFICATION_REQUIRED → TECHNICAL_REVIEW
      → APPROVED_API | APPROVED_EXPORT | DECLINED
      → CONTRACT_AND_SECURITY_REVIEW → SANDBOX_ACCEPTED → PRODUCTION_ENABLED
```

`SENT` ancak gerçek gönderim kanıtıyla, `RECEIPT_CONFIRMED` kayıt numarası/alındı cevabıyla oluşur. Telefon görüşmesi notu resmî API yetkisi yerine geçmez. Onay yanıtı yalnız belirtilen istasyon, cihaz, arayüz, veri alanı ve süre için geçerli kabul edilir. “Teklif verildi” veya “doküman paylaşıldı” üretim erişimiyle aynı durum değildir.

Sistemde `integration_access_requests` kaydı tutulmalı. Temel alanlar `tenant_id`, `company_id`, `station_id`, `provider`, `requested_scope`, `software_version`, `request_version`, `status`, `submitted_at`, `submission_channel`, `provider_ticket_ref`, `granted_scope`, `valid_until` ve kurum içi sorumludur. Gelen/giden yazılar `integration_correspondence` altında şifreli eklerle ilişkilendirilir; parola veya API anahtarı bu yazışma tablosuna konmaz.

Kurum içi takip önerisi olarak alındı teyidi için 3, durum sorgusu için 7 iş günü gibi **değiştirilebilir takip hedefleri** tanımlanabilir. Bunlar Turpak SLA’sı veya yasal yanıt süreleri değildir. Cevapsızlık onay sayılmaz. Bu çalışmada geleceğe dönük otomatik takip kurulmadı ve başvuru gönderilmedi.

### Yanıt geldikten sonraki karar

API onaylanırsa önce sandbox, sonra bir istasyonda salt okunur bağlantı açılır. Yalnız export onaylanırsa belirtilen dosya biçimi ve aktarım yöntemi kullanılır. Teknik yanıt belirsizse eksik noktalar yazılı sorulur. Reddedilirse erişim sınırı aşılmaz; mevcut yetkili rapor kullanımı ve izinli kullanıcı yüklemesiyle sınırlı iş akışı sürer. Hiçbir durumda kontrol bilgisayarının veritabanı şifresini elde etmeyi veya cihaz protokolünü izinsiz açmayı alternatif yöntem saymıyoruz.

GİB İOS teknik kılavuzunun 3.1.16 maddesi haricî muhasebe vb. uygulamalar için özel dosya/XML dışa aktarımını tarif eder. Bu, bizim yazılımımıza ücretsiz Turpak lisansı veya otomatik erişim hakkı vermez. 3.1.8’deki veritabanı erişim güvenliği de ayrıca korunur. [2]

## 2. Hangi dosyada OCR kullanacağız?

### XML, CSV, JSON veya XLSX çıktısı

Kaynak bunlardan birini **yetkili olarak** verebiliyorsa OCR kullanmadan şema doğrulaması ve alan eşlemesi yapılır. XML’de dış varlık/DTD çözümlemesi kapalı, CSV’de ondalık-ayraç ve kodlama açık, XLSX’te formül çalıştırma kapalı olmalı. Dosyanın kendi VKN/istasyon kodu, kaynak profiline ait kodla karşılaştırılır; uyuşmazlık karantinaya gider. Böyle bir export’ın sizin Turpak sürümünüzde bulunduğu henüz doğrulanmadı.

### Metin içeren PDF veya “PDF’ye yazdır” çıktısı

PDF’den metin ve konum bilgisi doğrudan ayrıştırılır. OCR yalnız metin bulunmayan sayfa/bölgeler için kullanılır. PDF metnindeki toplam ile render edilen sayfadaki toplam uyumsuzsa belge incelemeye alınır; gizli metin tabakası, eski OCR tabakası veya sonradan değiştirilmiş görünüm olabilir. Metin ayrıştırabilmek kaynağın gerçek veya değiştirilmemiş olduğunu kanıtlamaz.

Haricî OCR’ye PDF’nin tamamı gönderilmez. Yerel güvenli işleyici gerekli sayfayı raster görüntüye dönüştürür, kişisel alanları geri döndürülemez şekilde kapatır ve yalnız bu türevi gönderir. Görünürde siyah kutu bulunan PDF’nin altta okunabilir kart/metin katmanı, ekleri veya metadata’sı kalabilir; görsel redaksiyon ile içerik redaksiyonu aynı şey değildir.

### Yazıcıdan alınan raporun taranması

Yazılı rapor üzerindeki rapor türü, istasyon, dönem, sayfa numarası ve toplam satırı birlikte alınır. Taramada bütün sayfalar beklenir. “3 sayfalık raporun yalnız son sayfası” toplamı gösterse bile kapsam doğrulanmadan tam kaynak kabul edilmez. Rapor kimliği yoksa kullanıcıdan dönem beyanı ve yetkili teyidi istenir; sistem bunu sonradan oluşturulmuş kaynak kimliği diye Turpak ID’si olarak sunmaz.

### Ekran görüntüsü veya telefon fotoğrafı

Ekran görüntüsü, raporun bütün sınırlarını gösteriyorsa ekranın fotoğrafına göre genellikle daha iyi başlangıçtır. Fotoğrafta perspektif, ekran yansıması, kesik satır ve moiré kontrol edilir. Rapor dönemi, istasyon kimliği ve toplam birlikte görünmeli; arka plandaki diğer müşteri/çalışan bilgileri crop edilmelidir. Fotoğraf EXIF saati, raporun satış dönemi diye kullanılmaz.

Fotoğraf yalnız veriyi taşıyan **kanıt** olur. Manuel değiştirme veya başka istasyon raporu ihtimali nedeniyle yetkili kontrolü gerekir. Bütün rapor okunmadan “toplam otomatik bulundu” diye kapanış yapılamaz. POS slipi ile Turpak vardiya raporu ayrı belge tipleridir; birinin toplamı diğerinin toplamına eklenmez.

## 3. Dosya aktarım kanalları ve güven sınırı

İlk pilot için en basit kanal, yönetici veya muhasebecinin yetkili uygulama içinden **HTTPS yüklemesi** yapmasıdır. Personel yalnız kendisine atanmış hesaba POS slipi ekler; istasyonun Turpak kaynak raporunu ve entegrasyon izinlerini değiştiremez.

Sağlayıcı SFTP export’ını desteklerse istasyon başına ayrı anahtar, pinlenmiş SSH host key, sınırlı klasör ve liste/okuma yetkisi kullanılır. Düz FTP kullanılmaz. SFTP dosyayı aktarımda korur fakat açık dosyanın sunucuda saklanmasını ve yanlış istasyon eşlemesini kendi başına önlemez. Üretici tarafından bir imza sağlanıyorsa doğrulanır; sonradan bizim oluşturduğumuz hash üretici imzası diye gösterilmez.

Yetkili yerel export klasörü varsa yalnız onaylı ayrı ajan izler. Dosya önce geçici isimle yazılıp atomik rename ile “hazır” yapılmalı; sağlayıcı bunu desteklemiyorsa sabit boyut/zaman kontrolü sadece yardımcıdır, beklenen sayfa/satır/toplam denetimi ayrıca gerekir. Ajan tamamlanan batch’i dışarı HTTPS üzerinden gönderir. Otomasyon DB’si taranmaz, kontrol PC’sine onaysız yazılım kurulmaz.

E-posta eki zorunluysa gönderici/DKIM/antivirüs kontrolü yeterli yetki kanıtı değildir. Gelen ek otomatik posting yapmaz; yetkili profil eşlemesi ve karantina gerekir. Ham kişisel raporlar kişisel e-posta veya WhatsApp ile standart aktarım kanalı yapılmamalı. USB zorunluysa firma cihazında izole yükleme istasyonu ve kötü amaçlı içerik taraması gerekir; doğrudan otomasyon bilgisayarına yeni USB takılması önerilmez.

Dosyalar uzantı ve istemcinin MIME başlığıyla kabul edilmez. İçerik imzası, parser, boyut/sayfa/piksel/CPU sınırı ve sandbox birlikte uygulanır. ZIP, macro-enabled Excel, SVG ve çalıştırılabilir içerik varsayılan olarak reddedilir. Antivirüs/CDR işlemi yerel veya hukuken uygun altyapıda yapılır; kişisel belge, herkese açık tarama servislerine gönderilmez. Bu tedbirler OWASP dosya yükleme yaklaşımıyla uyumludur. [3]

## 4. Kaynak raporundan muhasebe kontrolüne iş akışı

```text
Yükleme yetkisi ve dosya sınırı
  → İçerik taraması / güvenli decode
  → Yerel metin ayrıştırma veya yerel gizlilik kontrolü
  → Gerekiyorsa geri döndürülemez maskeleme
  → Haricî OCR izin kapısı veya yerel OCR
  → Alan normalizasyonu ve belge kapsam kontrolü
  → Kullanıcı/yetkili teyidi
  → Değişmez onay snapshot'ı
  → Vardiya kaynak karşılaştırması
  → Muhasebe onayı veya fark vakası
```

`QUARANTINED`, `PRIVACY_BLOCKED`, `PARSE_PENDING`, `NEEDS_REVIEW`, `SOURCE_CONFIRMED`, `RECONCILIATION_READY` ve `SUPERSEDED` ayrı durumlar olmalı. Kaynak teyidi mali kapanış onayı değildir. Maskeleme başarısızlığına muhasebeci “gerekçeli mali istisna” vererek haricî gönderim açamaz; gizlilik kapısının ayrı yetki ve politika kontrolü vardır.

**Dönem:** başlangıç dâhil, bitiş hariç `[start, end)` ve `Europe/Istanbul` iş günü tanımı kullanılır. Vardiya gece yarısını aşabilir. Rapor üretim saati ile kapsam saati ayrı alanlardır. Aynı aralığı kapsayan günlük rapor ve vardiya raporu, iki satış kaynağı gibi toplanmaz. `business_unit=FUEL` yakıt için; market defteri ayrıca korunur.

**Tekillik:** tenant içinde maskeli dosyanın hash’i birebir tekrarları bulur. Ayrı fotoğraflar farklı hash oluşturacağı için rapor ID/versiyon/dönem ve kanonik alan eşlemesi ayrıca gerekir. Görsel benzerlik sadece mükerrer şüphesi üretir; iki aynı tutarlı slipi otomatik silmek için kullanılmaz. Aynı rapor ID’sinde farklı içerik yeni revizyon veya conflict olarak gösterilir.

**Atıf:** rapor yalnız istasyon toplamı veriyorsa sonuç `STATION_TOTAL` olur. Personel/pompa/terminal satırları kaynaktan doğrulanmadıkça istasyon toplamı personele dağıtılmaz. Üst toplam ile alt toplamlar aynı formülde birlikte eklenmez.

**Onay:** belgeyi yükleyen kişi kendi kaynak düzeltmesinin nihai onayını vermez. İstasyon yetkilisi kaynak kapsamını, muhasebeci ödeme/teslim/borç karşılaştırmasını kontrol eder. Bir kişi iki rol taşısa da iki kişi gerektiren politikada aynı kullanıcı iki imza sayılmaz. Onay `document_version`, `privacy_version`, `parser_version` ve `reconciliation_revision` değerlerine bağlıdır; tutar/dönem değişirse eski imza yeni sürüme taşınmaz.

API sonradan gelince işlem kimlikleri mevcut kanıta bağlanır. Rapor toplamını daha önce satış defterine toplu satış diye yazıp sonra API işlemlerini tekrar eklemeyelim. Aggregate OCR raporu karşılaştırma kaynağıdır; ayrıntılı satış kalemleri ayrı defterde tutulur. Kaynakla eşlenemeyen açık farklar audit izini koruyan vaka olarak kalır.

### Sayısal örnek

Turpak raporu doğru dönem için **125.000 TL net satış** göstermiş olsun. Personel hesaplarında açılış para üstü ve eski borç tahsilatı satış ödemesi dışında bırakıldıktan sonra nakit **45.000**, teyitli başarılı kart slipleri **70.000**, doğrulanmış IBAN satış ödemeleri **8.000**, kişiye/kuruma bağlı yeni borç satışları **2.000 TL** olsun. Toplam **125.000 TL**, fark sıfırdır.

OCR yanlışlıkla Turpak toplamını **128.000 TL** okursa **−3.000 TL fark** gösterilir; personel borcu otomatik artırılmaz. Yetkili maskeli belge üzerinde toplamı düzeltir, nedenini yazar ve yeni snapshot onaya girer. Kaynağın 125.000 TL oluşu bankanın 70.000 TL kartı net olarak yatırdığını kanıtlamaz; komisyon/valör ve banka net mutabakatı ayrı sürer.

## 5. KVKK için maskeleme hangi verilerde uygulanacak?

Slipi otomatik muhasebe hesabına bağlamak için **tutar, para birimi, tarih/saat, başarılı satış/iade/red türü, terminal/işyeri eşlemesi ve varsa RRN/işlem referansı** kullanılır. Bunların da kişi/işlem bağlamıyla kişisel veri olabileceğini kabul ediyoruz. Tam kart numarası, son kullanma tarihi, kart sahibi adı, imza, müşteri telefonu, TCKN ve gereksiz plaka korunacak çıktıdan çıkartılır. Son dört hane varsayılan olarak tutulmaz; somut eşleme ihtiyacı onaylanırsa ayrı minimum veri kararıyla açılır.

CVV/CVC, PIN/PIN blokları ve tam manyetik iz verisi bu uygulamanın veri alanları değildir; bilinçli olarak toplanmaz veya arşivlenmez. Beklenmedik biçimde görüntüde bulunursa dış gönderim ve kalıcı saklama durdurulur, güvenli yeniden çekim/temiz türev yolu kullanılır; içerik yerine güvenlik olay kodu kaydedilir. Maskeleme ve şifreleme, ödeme kuruluşunun kurallarının veya gerekiyorsa PCI DSS kapsam değerlendirmesinin yerini almaz; bu plan bir PCI sertifikası değildir.

RRN/terminal referansı tam kart numarası değildir, ancak “kişisel veri değildir” diye serbest kullanıma açılmaz. Personelin adı ve borçlu kişi bilgileri iç sistemde yetkili alanda tutulur; OCR sağlayıcısına kullanıcı adı veya şirket cari kartı göndermek gerekmiyor. QR/barkodlar görünür metinden daha fazla veri taşıyabilir; işlem için gerekli değilse kapatılır, gerekliyse yerel decode ve alan allowlist’i uygulanır.

**Maskeleme anonimleştirmeyi garanti etmez.** İşlem saati, tutar ve referans bir kayıtla kişiye yeniden bağlanabiliyorsa veri hâlâ kişisel olabilir. Hash ve token da otomatik anonimleştirme değildir. KVKK’nın amaçla sınırlılık, işleme şartları, aydınlatma ve güvenlik yükümlülükleri maskeleme/şifreleme sonrasında devam eder. [4]

### Telefonda ilk önlem

PWA, kullanıcıya belge sınırını seçtirir ve kart/isim bölgeleri için kapatma önizlemesi gösterir. Maske, CSS katmanı veya yalnız blur değil **piksel üzerine opak kapatma** olmalı; maskelenmiş bitmap yeni dosya olarak encode edilmeli. İkinci adımda EXIF/GPS, gömülü thumbnail ve gereksiz metadata temizlenmeli. Tarayıcı üstündeki siyah div, alttaki orijinal dosyayı değiştirmez.

Varsayılan kamera akışında ham görüntü yalnız bellekte kısa süre işlenir; uygulama galeriye veya Service Worker cache/IndexedDB’ye ham görüntü yazmaz. Fakat kişisel telefonda kullanıcının daha önce çekip galeriden seçtiği görüntüyü, ekran görüntüsünü, işletim sistemi yedeğini veya kötü amaçlı uygulamayı PWA uzaktan silemez/engelleyemez. Bu nedenle kişisel cihaz yönergesi, ekran kilidi ve eğitim gerekir; yüksek güvence istenirse kurumsal cihaz/MDM değerlendirilir. PWA’nın kendi kamera akışının desteklenen telefonlarda galeride kopya oluşturmama davranışı da gerçek testle doğrulanır. KVKK rehberi kişisel cihazların riskini özellikle ele alıyor. [5]

### Sunucuda ikinci ve bağımsız kapı

İstemcinin `masked=true` alanına güvenilmeyecek. Sunucuda tip/doğrulama, yeniden encode, metadata temizliği, **yerel** hassas alan tespiti ve politika kontrolü yapılacak. Regex/Luhn kart numarası için yardımcıdır; OCR karakter hataları, bölünmüş rakamlar, isim, imza, QR veya farklı slip şablonunu yakalamaya tek başına yetmez. Kör alanlarla çalışan “hassas veri bulamadı” sonucu güvenli maskeleme kanıtı değildir.

Rapor formatı tanınmıyorsa veya alan sınırı belirlenemiyorsa `PRIVACY_BLOCKED` ile dış servis çağrısı durur. Yetkili yerel inceleme/yeniden crop veya güvenli manuel alan girişi yapılır. Tutarın üstüne gelen maske düzeltilirken kart alanı yeniden açılmaz. Pilot sırasında yeni POS şablonlarının her biri için maskeleme kabul testleri gerekir.

**Ham görseli bulut OCR’ye gönderip sonra çıkan metni maskelemek geç kalmış tedbirdir.** Gizlilik kontrolü ilk dış aktarımın öncesinde çalışmalı. Ana backend yurt dışındaysa ham dosyanın “önce backend’e, sonra OCR’ye” gitmesi de zaten yurt dışı aktarımıdır. Bunu atlamamak için şu iki yerleşimden biri seçilecek:

- **Tercih edilen ham veri sınırı:** Türkiye’de firma tarafından yönetilen veya Türkiye’de sözleşmeli güvenli ingress/redaksiyon hizmeti. Ham/şüpheli içerik buradan dışarı çıkmaz; cloud OCR yalnız onaylı maskeli türevi alır.
- **Yurt dışı ingest:** ancak bu veri akışı için ayrıca uygun hukuki aktarım mekanizması ve güvenlik onayı varsa. “Daha sonra maskeliyoruz” veya “TLS var” gerekçesiyle açık bırakılmaz.

Türkiye ingress’i de yurtdışı CDN, request-body loglama, hata izleme, antivirüs API’si ve uzaktan destek üzerinden ham içerik sızdırmamalı. Yerel gate’in ham quarantine deposu varsa kısa saklama, kısıtlı yetki, şifreleme ve ayrı silme politikası uygulanır. Bellek içi işleme tercih edilse de reverse proxy temp upload, swap, core dump, thumbnail, APM ve log katmanları ayrıca kontrol edilir. Mutlak bellek silme garantisi verilmeyecek; ham verinin kalıcılaşmasını en aza indiren tasarım test edilecek.

```text
Kişisel telefon / yetkili rapor yüklemesi
  → TLS → Türkiye / izinli yerel güven sınırı
       [yerel tarama + redaksiyon + dış aktarım politika kapısı]
       ├─ şüpheli → yerel inceleme / yeniden çekim / manuel alan
       └─ onaylı maskeli türev
             → şifreli private depo
             → aktarım hukuki kapısı açık ise TLS ile EU OCR
             → allowlist alanlar → yetkili teyit → vardiya kanıtı
```

“EU OCR” Türkiye’de işleme demek değildir. Google resmî belgede `eu-vision.googleapis.com` ve `locations/eu` ile OCR için AB bölgesel işleme sunuyor; global varsayılan uç belirli yer garantisi vermiyor. API anahtarı telefona verilmeyecek; dış çağrı yalnız sunucu üzerinden yapılacak. [6]

## 6. Şifreleme: aktarım, saklama ve anahtarların ayrılması

### Aktarım sırasında

Telefon–ingress, ingress–API ve worker–OCR bağlantılarında sertifikası doğrulanan **TLS 1.2 asgari, TLS 1.3 tercih** tasarımını öneriyorum. Eski TLS/sertifika doğrulamasını kapatma kabul edilmeyecek. Özel servisler arasında kimlikli bağlantı ve gerekiyorsa mTLS kullanılmalı. SFTP kendi SSH şifrelemesiyle ayrı seçenektir. Bunlar bizim teknik tercihlerimizdir; KVKK’nın tek bir algoritma veya sürümü her sistem için zorunlu tuttuğu şeklinde okunmamalı.

### Saklama sırasında

Managed DB ve depoda sağlayıcı şifrelemesi taban koruma olacak. Görsel/ekler için ayrıca **envelope encryption** öneriyorum: her nesneye kriptografik güvenli üretilmiş ayrı veri anahtarı (DEK), içerikte **AES-256-GCM**, DEK’in ayrı anahtar hizmetindeki anahtarla (KEK) sarılması. Şifreli DEK depodaki nesneyle beraber tutulabilir; KEK, DB veya aynı dosya klasöründe açık tutulmaz. Bu ayrım OWASP anahtar yönetimi yaklaşımıyla uyumludur. [7]

Her GCM şifrelemesinde aynı anahtar için nonce tekrar kullanılmamalı. Önerilen format 96-bit nonce ve 128-bit doğrulama tag’idir; algoritmayı kendimiz icat etmeyeceğiz, bakımı yapılan güvenilir SDK/KMS kullanılacak. `tenant_id + evidence_id + artifact_version + purpose` kanonik biçimde AAD’ye, yani kimlik doğrulanan ek veriye bağlanmalı. Başka tenant’a ait dosyanın ciphertext’i taşınınca decrypt işlemi reddedilmeli.

```text
Nesne zarfı:
  object_id, artifact_version, algorithm
  nonce, ciphertext, authentication_tag
  wrapped_dek, kek_key_ref, kek_version
  aad_schema_version, privacy_policy_version

Anahtar hizmeti:
  KEK oluşturma/sarma/çözme/rotasyon
  yetkili servis kimliği ve işlem audit'i
  plaintext KEK uygulamaya veya tarayıcıya dağıtılmaz
```

KMS/Vault yerleşimi ve yöneticinin erişebildiği anahtarlar veri haritasında belirtilmeli; sırf “KMS kullanıyoruz” demek yeterli değildir. Yalnız şifreli DEK ve ciphertext’i elde eden hesap KEK izni olmadan çözememeli. Uygulama tamamen ele geçirilip çözme yetkisi kullanılırsa encryption tek başına korumaz; servis izolasyonu ve erişim politikası gerekir.

IBAN ve kişinin ayrıntılı kimlik alanları DB içinde ayrıca alan düzeyinde şifrelenebilir. Tam IBAN gerekmeyen ekranda sadece sınırlı bölüm gösterilir. Arama/eşleme için gereken alanlarda ayrı anahtarlı, tenant kapsamlı HMAC kullanılabilir; bu yöntem kişisel veriyi anonimleştirmez. Tutar/para birimi ve referansların kapsam kuralları sürer. Parolalar geri çözülebilir şifreleme ile değil uygun parola hash’iyle saklanır; API sırları secrets hizmetine alınır.

### Görsel görüntüleme ve signed URL sınırı

Envelope şifreli nesneyi browser’a signed URL ile vermek görüntüyü otomatik açmaz; browser ciphertext alır. Bizim önerimiz yetki denetimli **görüntü proxy’si**: proxy kapsamı yeniden denetler, KMS üzerinden çözer ve yalnız maskeli türevi TLS ile gösterir. Kısa ömürlü URL gerekiyorsa aynı kontrollü proxy’ye bağlanır; bearer URL loga girmez. `Cache-Control: no-store`, uygun CSP ve dosya erişim audit’i uygulanır. Kısa URL, kullanıcının ekran görüntüsü almasını engellemez.

### Rotasyon ve kurtarma

Yeni KEK sürümüyle yeni DEK’ler sarılır; eski wrapped DEK’ler kontrollü rewrap edilebilir. AAD’deki belge sürümü değişmez kalır; farklı belge içeriği yeni nesne sürümüne yazılır. Anahtar sızıntısı şüphesinde credential iptali ve gerekirse içerik re-encryption planı ayrı işletilir. Eski yedeğin anahtarını erken silmek kurtarmayı bozar; restore testinde DB, görsel, anahtar sürümü ve erişim politikası birlikte sınanır.

Hizmet sonlandırma/imha planında anahtar kopyaları ve backup’lar da kapsanmalı. Tek tenant KEK’sini silmek, o tenant’ın hukuken tutulması gereken bütün kayıtlarını da yok edebilir; anahtar imhası sıradan kullanıcı silme düğmesi yapılamaz. Kopya, yedek ve saklama yükümlülüğü kontrolünden sonra yetkili süreç çalışır. KVKK rehberi bulut sağlayıcısının tedbirlerini değerlendirme, şifreleme, anahtar yönetimi ve hizmet sonu anahtar kopyalarını da ele alıyor. [5]

## 7. OCR sağlayıcısına karşı gizlilik sınırı

**Standart cloud OCR ciphertext üzerinde bu işi yapmaz.** İşleyici maskeli görüntüyü kendi yetkisiyle çözer ve TLS kanalında gönderir. Sağlayıcının OCR işlemi sırasında maskeli pikseller açık hâlde işlenir. Bu nedenle “AES kullandığımız için OCR şirketi içeriği hiç göremez” veya “uçtan uca şifreli OCR” iddiası doğru olmaz.

İçeriğin üçüncü tarafça hiç görülmemesi gerekiyorsa OCR motoru kendi yönetilen Türkiye/yerel ortamımızda çalışır. Bu durumda engine doğruluğu, Türkçe şablonlar, güvenlik güncellemesi ve CPU/işletim maliyeti ayrı değerlendirilir. Hukuki aktarım kapısı kapalıysa EU servis arızasını global/us endpoint’e yönlendirmeyiz; yerel yol veya güvenli bekleme kullanılır.

Cloud Vision’ın resmî veri kullanım FAQ’sı online `BatchAnnotateImages/Files` işlemlerindeki görüntülerin bellekte işlendiğini ve diske kalıcı yazılmadığını; offline async işlemlerde kısa süreli saklama, ayrıca geçici istek metadata logları bulunduğunu açıklıyor. Aynı kaynak içeriğin Vision modellerini eğitmek/iyileştirmek için kullanılmadığını söylüyor. Bu bilgi **bizim bucket/uygulama/APM loglarımızın silindiği**, bütün metadata’nın hemen yok olduğu veya KVKK aktarım şartlarının sağlandığı anlamına gelmez. [8]

Pilot için **kendi uygulama kuyruğumuz asenkron**, worker’ın sağlayıcıya çağrısı ise **online/senkron görüntü OCR** olabilir. Böylece kullanıcının beklemesi gerekmez; sağlayıcının offline batch saklama yolunu gereksiz yere açmayız. Maskeli byte’lar TLS üzerinden gönderilir; public görsel URL’si oluşturulmaz. Sözleşme ve kullanım koşulları seçilen ürün/endpoint için yine kontrol edilir.

## 8. KVKK hukuki kapısı ve işletim kontrolleri

Firma/istasyon grubu içinde hangi tüzel kişinin veri sorumlusu olduğu, yazılımı işletenin veri işleyen olup olmadığı ve çok firmalı görünümün hukuki dayanağı belirlenmeli. Çalışan vardiya hesabı, müşteri borç defteri, POS slipi, Turpak raporu ve loglar ayrı veri işleme envanterinde gösterilmeli. Aydınlatma metni, işleme şartı, alıcılar, erişim, saklama/imha ve ilgili kişi başvurusu birlikte ele alınmalı. Hepsine tek “KVKK onayı” kutusu koymak çözüm değildir. [4]

Sürekli günlük OCR aktarımı için yurt dışı aktarım mekanizması sözleşme ve gerçek veri akışı üzerinden doğrulanmalı. Standart sözleşme yolu seçilirse doğru veri sorumlusu/veri işleyen tipi, geçerli yetkili imzalar, Türkçe metin ve imzalar tamamlandıktan sonra **beş iş günü bildirim** şartı dikkate alınır. Kurumun metni seçimlik/alternatif alanlar dışında değiştirilemez. Genel cloud DPA kendiliğinden Türkiye standart sözleşmesi yerine geçmez. Sağlayıcı uygun güvenceyi sağlayamıyorsa bu yolu varsayarak aktarım başlatılmaz. [9]

Sadece görüntüdeki isimlerin maskelenmesi, cloud backend’deki personel adı/cari kaydı/istek metadata’sı gibi diğer aktarımları çözmez. Depo, yedek, OCR, log, destek ve anahtar hizmetinin ülkeleri ve alt işleyenleri ayrıca envanterde yer almalı. Türkiye’de barındırma seçilse bile yurtdışından destek erişimi gibi yeni aktarım yolları değerlendirilir.

**Saklama:** 90 gün önceki bütçenin kapasite varsayımıdır, yasal zorunlu süre değildir. Ham quarantine, maskeli kanıt, normalleştirilmiş mali kayıt ve audit için ayrı süre/purpose tanımlanır. OCR’ye gönderilmeyecek ham dosya için varsayılan kısa teknik yaşam döngüsü; işleme hatasında içerik yerine olay kodu saklama tercih edilir. Süreler hukuk/muhasebe onayıyla seçilir. Orijinal belgenin hukuken gerekli olduğu durumlarda maskeli türev resmî orijinal yerine sunulmaz; orijinalin ayrı kısıtlı arşivi ve saklama dayanağı değerlendirilir. Fizikî slip muhafazası da bu mimariyle kendiliğinden ortadan kalkmaz.

Immutable muhasebe/audit “kişisel veriyi sonsuza kadar sakla” anlamına gelmez. Kimlik alanları mümkün olduğunca ayrı tutulur; veri imha talebi ve yasal saklama ihtiyacı kapsamlı değerlendirilir. Backup’tan restore edilen silinmesi gereken kayıtların tekrar görünmesini önlemek için imha kayıtlarının kontrollü yeniden uygulanması gerekir.

**Roller:** personel kendi maskeli belgelerini görür; muhasebeci atanmış firma/istasyon belgelerini ve tutar teyidini görür; yönetici yalnız atanmış kapsamı yönetir; teknik işletim çalışanı varsayılan olarak belge içeriğini görmez. KMS, privacy reviewer ve deployment yetkileri ayrıdır. İstisnai içerik erişimi gerekçe, süre ve ayrı onayla açılır; log incelemesi için bütün görüntüleri indirme yetkisi verilmez.

**Log ve olay:** loglarda belge ID, politika sürümü, actor ID, sonuç kodu ve güvenli request ID bulunur; tam OCR metni, PAN, IBAN, görüntü base64’ü, signed URL ve secret bulunmaz. Kapsam dışı erişim veya maskelenmemiş veri sızıntısında dış OCR egress kapatılır, anahtar/oturumlar riske göre iptal edilir, delil içeriği kontrollü korunur ve veri sorumlusunun olay/ihlal değerlendirmesi başlatılır. KVKK bildirim şartı ve süreleri hukuk sorumlusu tarafından güncel mevzuata göre işletilir. [4] [5]

## 9. İç yazılım sözleşmesi ve veri modeline eklenecekler

Bunlar **Turpak’ın gerçek API alanları değil**, bizim önerdiğimiz iç varlıklardır. Canlı migration dosyası oluşturulmadı.

`source_document_batches` firma/istasyon/iş alanı, kaynak profili, rapor türü, kaynak rapor ID’si varsa bu ID, dönem ve kapsam seviyesini tutar. `source_document_pages` sayfa sırası, beklenen sayfa sayısı ve artefact ilişkisini tutar. `privacy_artifacts` türev sürümü, politika sürümü, yerel maskeleme sonucu, checksum, şifreleme zarfı referansı ve saklama sınıfını tutar. Kişisel ham içerik bu metadata tablosuna JSON olarak kopyalanmaz.

`source_extraction_runs` yerel parser/OCR yöntemi, sürüm, işlem sonucu ve sağlayıcı request referansını tutar. `source_confirmations` yükleyen dışında yetkili teyit, değişen alan/önceki değer/yeni değer ve nedenini kısıtlı alanda tutar. `source_bindings` teyitli belgeyi vardiya snapshot’ına veya API işlem grubuna bağlar. `transfer_policy_versions` izinli veri sınıfı, sağlayıcı/endpoint/bölge, hukuki inceleme referansı ve durum içerir. Connector secrets ayrı secrets hizmetindedir.

Foreign key’ler tenant/firma/istasyon kapsamını taşımalı; sadece UUID’nin zor tahmin edilmesine güvenilmez. Kaynak posting ve snapshot oluşturma transaction içinde idempotent olmalı. OCR hizmet çağrısı DB transaction’ına atomik bağlanamadığı için mali ücret tekrarını kesin önleyemeyiz; fakat aynı işin toplamı iki kez etkilemesini DB tekillik/kayıt kısıtıyla önleriz.

Önerilen dış gönderim kapısı:

```text
1. Kimlik + tenant/istasyon kapsamı sunucudan doğrulanır.
2. Belge sürümü, hash ve yerel privacy sonucu birlikte yüklenir.
3. Privacy sonucu türevin TAM BU hash'ine ve politika sürümüne bağlı mı?
4. Batch/page kapsamı ve izinli dosya türü geçerli mi?
5. Sunucudaki aktarım politikası bu veri sınıfı/sağlayıcı/bölge için aktif mi?
6. Hukuki inceleme/sağlayıcı sözleşmesi ve günlük kota geçerli mi?
7. Worker yalnız doğrulanmış maskeli türevi çözerek izinli endpoint'e gönderir.
8. Gelen yanıt allowlist alanlarına iner; aday kalır, teyit bekler.
```

İstemciden gönderilen `legal_basis_approved`, `privacy_approved` veya `reviewer_role` bayrağı izin oluşturmaz. Onaydan sonra dosyanın değiştirilmesine karşı worker sürüm+hash’i tekrar doğrular. Sadece `masked=true` ile haricî OCR çağıran endpoint açılmaz. Örnek veri sözleşmesi ekteki [güvenli kaynak aktarım paketi](ornek-v2.2-kaynak-aktarim-sozlesmesi.json) dosyasındadır; dosyada hukuki kapı varsayılan olarak kapalıdır.

## 10. Pilot kabul testleri ve karar sırası

**Dosya/kaynak testi:** metin PDF, image-only PDF, ekran fotoğrafı ve izinli yapılandırılmış çıktı aynı beklenen dönemi göstermeli. Eksik sayfa, iki istasyonun karışması, gece vardiyası, aynı raporun farklı fotoğrafı, çakışan günlük/vardiya raporu ve API’ye sonradan geçiş toplamı mükerrer üretmemeli. OCR yanlış 128.000 TL okuma senaryosunda sistem fark vakası açmalı; borç/cari otomatik değiştirmemeli.

**Gizlilik testi:** görünür kart satırı, altta kalmış PDF metni, EXIF GPS, gömülü preview, QR içinde isim/numara ve bilinmeyen slip şablonu kullanılır. Tamamen sentetik hassas örneklerle ağ trafiği ve depodaki türev incelenir. Engellenmesi gereken içerik dış endpoint’e hiç gitmemeli; zero-match regex testi başarı sayılmamalı. Yanlış maske tutarı kapatıyorsa kullanıcı yeniden çekim veya yerel düzeltme yoluna yönlenmeli.

**Yetki/şifreleme testi:** başka tenant’ın nesnesine erişim, AAD değiştirme, süresi dolmuş proxy URL’si, iptal edilmiş personel, KMS erişimi kapalı worker ve anahtar rotasyonu/restore denenir. KMS kapalıyken uygulama plaintext yedek dosyaya düşmemeli. Muhasebe gerekçeli istisnası privacy blokunu kaldıramamalı.

**Operasyon testi:** günlük 1.000 slip yüksek ucu ve kapanışta toplu yüklemeyle yerel maskeleme/inceleme kuyruğu ölçülür. Cloud OCR başarısı kadar maskeleme kaçırma, yanlış blok, manuel teyit süresi ve kaynak gecikmesi de raporlanır. Türkiye ingress/redaksiyon hizmeti, yerel OCR ve anahtar hizmeti **önceki 550–600 USD bulut+OCR bütçesine kesin fiyatlı kalem olarak eklenmiş değildir**; seçilen yerleşim ve benchmark sonrasında ayrıca fiyatlandırılır.

Karar sırası: firma/istasyon veri envanteri ve aktarım sorumlusu → ham veri güven sınırı → maskeleme ve dosya import geliştirme → gerçek telefon/PDF güvenlik kabulü → sınırlı rapor/OCR pilotu → yazılım sonrası Turpak başvurusu → yazılı API/export koşulu → sandbox ve üretim. Bu sıra, Turpak API beklenirken vardiya/slip sürecini geliştirmeyi mümkün kılar; eksik kaynak yetkisini veya KVKK hukuki kapısını varmış gibi göstermez.

## References

[1]: https://turpak.com.tr/iletisim/ "Turpak resmî iletişim ve istasyon destek kanalı"
[2]: https://ynokc.gib.gov.tr/UploadedFiles/Files/IstasyonOtomasyonSistemiTeknikKilavuzu1_0.pdf "GİB İOS teknik kılavuzu — veri aktarımı ve erişim güvenliği"
[3]: https://cheatsheetseries.owasp.org/cheatsheets/File_Upload_Cheat_Sheet.html "OWASP güvenli dosya yükleme ve içerik işleme"
[4]: https://www.kvkk.gov.tr/Icerik/6649/Personal-Data-Protection-Law "6698 sayılı Kanun — amaçla sınırlılık, işleme şartı, aydınlatma ve güvenlik"
[5]: https://www.kvkk.gov.tr/yayinlar/veri_guvenligi_rehberi.pdf "KVKK kişisel veri güvenliği rehberi — teknik ve idari tedbirler"
[6]: https://docs.cloud.google.com/vision/docs/ocr "Cloud Vision OCR bölgesel AB endpoint'i ve işleme konumu"
[7]: https://cheatsheetseries.owasp.org/cheatsheets/Cryptographic_Storage_Cheat_Sheet.html "OWASP şifreli saklama, DEK/KEK ayrımı ve anahtar yönetimi"
[8]: https://cloud.google.com/vision/docs/data-usage "Cloud Vision veri kullanımı, online/async saklama ve model eğitimi koşulları"
[9]: https://www.kvkk.gov.tr/Icerik/8170/Yurt-Disina-Kisisel-Veri-Aktariminda-Kullanilacak-Standart-Sozlesmelerde-Dikkat-Edilmesi-Gereken-Hususlara-Iliskin-Kamuoyu-Duyurusu "KVKK standart sözleşme imza, metin ve bildirim şartları"

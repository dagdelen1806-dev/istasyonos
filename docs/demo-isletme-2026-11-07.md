# İstasyonOS kalıcı DEMO işletmesi — 07.11.2026

DEMO giriş adresi: **http://127.0.0.1:3001**. Veritabanı: **istasyonos_demo**.
Bu uygulama yalnız yerel döngü adresinde çalışan ayrı bir Node sürecidir.
Mevcut HTTPS uygulamasının `.env` bağlantısı ve Apache vhost'ları değiştirilmedi.
DEMO için 18 mevcut migration, manifest doğrulamasıyla yalnız yeni hedefte
uygulandı. Veritabanı silme, sıfırlama ve gerçek mali defter etkinleştirme yapılmadı.

İki şirket ayrı tenant'tır: **DEMO Kuzey Enerji A.Ş.** altında Kuzey Merkez ve
Kuzey Çevreyolu, **DEMO Güney Akaryakıt Ltd.** altında Güney Sahil bulunur.
Bir şirketin kullanıcısı diğer şirketin kayıtlarını göremez. Tek kullanıcıdan
tenant seçerek iki şirkete birden giriş özelliği eklenmedi; ayrı girişler kullanılır.

**Girişler:** Rastgele güçlü DEMO parolaları yalnız yereldeki
[LOGIN.txt](../.local/demo/LOGIN.txt) dosyasındadır. Bu dosya ve `.local/demo/`
Git dışında tutulur; parola, oturum veya bağlantı bilgileri bu raporda yoktur.

| Rol | Kuzey şirketi | Güney şirketi |
| --- | --- | --- |
| Kurucu | owner.a@demo.example.invalid | owner.b@demo.example.invalid |
| Yönetici | manager.a@demo.example.invalid | manager.b@demo.example.invalid |
| Muhasebe | accountant.a@demo.example.invalid | accountant.b@demo.example.invalid |
| Satın alma | purchaser.a@demo.example.invalid | purchaser.b@demo.example.invalid |
| Akaryakıt personeli | fuel.1@demo.example.invalid; fuel.2@demo.example.invalid | fuel.3@demo.example.invalid |
| Market personeli | market.1@demo.example.invalid; market.2@demo.example.invalid | market.3@demo.example.invalid |

Personel adreslerinde her isim tam olarak `fuel.1@demo.example.invalid`,
`market.1@demo.example.invalid` biçimindedir. 1: Kuzey Merkez, 2: Kuzey
Çevreyolu, 3: Güney Sahil. Toplam 14 kullanıcı vardır. Yönetim ve muhasebe
kendi şirketlerinin istasyonlarına; satış personeli kendi istasyonuna erişir.

**Veri kapsamı:** 09.09.2026–07.11.2026 arasında her istasyonda günde bir
tamamlanmış örnek vardiya, ayrıca üç güncel aktif vardiya vardır. Bunlar 24 saatlik
işletmenin bütün vardiyalarını temsil ettiği iddia edilen gerçek kayıtlar değildir.
Hareket tarihleri tarihsel işletme senaryosuna aittir; audit/oluşturma izleri bu
DEMO üretiminin gerçek çalıştırılma zamanını korur. Kaynak tarihi gereken stok,
tahsilat ve hesap kayıtları yalnız seed'in oluşturduğu kayıt kimliklerinde hizalandı;
parasal tutarlar ve onaylar sonradan SQL ile üretilmedi veya değiştirilmedi.

| Kayıt | Sayı / durum |
| --- | --- |
| Şirket / istasyon / kullanıcı | 2 / 3 / 14 |
| Kapalı / aktif vardiya | 180 / 3 |
| İki onayı tamamlanmış hesap | 360: 180 akaryakıt + 180 market |
| Diğer hesaplar | 5 OPEN + 1 IN_REVIEW; toplam 366 |
| Onay ve nakit teslim imzaları | 1.082; onaylı her hesapta iki farklı bağımsız kişi |
| Yakıt türü / tank / pompa / tabanca | İstasyon başına üç; her tabloda toplam 9 |
| Sayaç ve fiyat okuması | 1.125; bunun 36'sı vardiya içi fiyat sınırı |
| Tank stok hareketi | 594: 9 açılış + 45 teslim + 540 satış çıkışı |
| Tanker kabul talepleri | 57: 9 açılış, 45 onaylı teslim, 3 bekleyen teslim |
| Güncel fiziksel tank ölçümü | 9 |
| Ürün/net hacim okuması | 9; örnek +2 L sıcaklık hacim farkı açıklamalı |
| Müşteri carisi / tedarikçi | 9 / 4 |
| Tahsilat/satış ödeme kaydı | 740 |
| Manuel POS slip kaydı | 180; canlı POS/banka teyidi değildir |
| Cari defter hareketi | 361; borç ve tahsilat kayıtları |
| Market ürünü / stok hareketi | 9 / 550 |
| Tedarikçi borcu/vade kaydı | 45 OPEN; ödeme yapıldı olarak işaretlenmedi |
| TTS / Gift yükleme / Gift kullanım / Partner | Her istasyonda ayrı DRAFT; toplam 12 |
| Tank fotoğrafı / bekleyen satır incelemesi | 3 / 9 |
| Günlük icmal kaynak paketi / sayısal taslak | 3 / 3; sayısal onay PENDING |
| Belge kaynak arşivi / yerel OCR okuması | Toplam 5 paket / 5 okuma |
| Tanker belge inceleme geçmişi | 6 revizyon; bir güncel, tam alanlı doğrulanmış DEMO kaynak |

İlk sentetik OCR örneğinde basılı ürün kodu bulunmadığı için o kaynak geçmişi
korunarak reddedildi. Güncel örnekte belge numarası, tarih, ürün kodu,
ürün adı, net/sevk hacmi görüntüde bulunur ve kayıtlarla eşleşir. Belgeyi
düzenleyen kurgusal tedarikçi ayrıca doğru adla kayıtlıdır. Arşiv/inceleme
sayıları bu geçmişi içerir; yeni boş kurulumda arşivlenmiş ara örneklerin
olmaması normaldir. Tekrar seed aynı veritabanında yeni kopya üretmez.

İki onaylı hesaplarda operasyonel ciro **9.069.964,50 TL**, sayaç satışı
**199.062 L** ve güncel teorik tank stoku **70.938 L**'dir. Stok eşitliği:
90.000 L açılış + 180.000 L tanker kabulü − 199.062 L satış = 70.938 L.
Onay bekleyen 15 TL'lik ek market hesabı dönem cirosuna dahil değildir.
Eski cari tahsilatları tekrar ciro sayılmaz; Gift/TTS/Partner taslakları da
bu toplamlara katılmaz. Para üstü float her vardiyada satıştan ayrı tutulur;
sayılan nakit = float + nakit satış, teslim edilen tutar = nakit satıştır.

**Çalışan ekran ve akışlar:**

| Modül | Gerçek DEMO işlevi / sınırı |
| --- | --- |
| Giriş, personel, yetkiler | Gerçek yerel parola/oturum ve tenant/istasyon yetkileri |
| Sayaç mutabakatı | Açılış/kapanış, fiyat sınırları, litre ve kuruş hesabı |
| Tank ve tanker kabulü | Kapasite, bağımsız onay, değişmez litre defteri, güncel ölçüm |
| Vardiya mali hesap ve icmal | Nakit/POS/cari/banka beyanı ayrı, iki bağımsız imza, kalıcı kayıt |
| Vardiya kapatma | Bütün hesaplar iki onaylı olmadan kapatılamaz; son okumadan önce bitiş reddedilir |
| Cari ve tahsilat | Gerçek borç/tahsilat defteri ve bakiye; fazla tahsilat mevcut kurallarla engellenir |
| Market | Adet stokları, stok satışı ve manuel hesap/tahsilat eşleştirmesi |
| Satın alma | Ürün/tedarikçi kartları, borç ve vade görünümü |
| Tank fotoğrafı / ürün-net | Sentetik kaynak, LPG kapasitesi bilinmiyor uyarısı, bekleyen kullanıcı incelemesi; stok değişmez |
| Günlük rapor / OCR | Kaynak görsel, gerçek Windows OCR, taslak ve zorunlu kullanıcı teyidi |
| Asistan / audit | Yerel kural tabanlı özet ve gerçek işlem geçmişi; mali işlem oluşturmaz |
| Yönetim paneli | MySQL'den tarih/ay/istasyon filtreli ciro, litre, kasa, cari, stok ve bekleyenler |
| Excel/PDF | Gerçek icmalden XLSX indirildi ve PDF oluşturuldu |

Panelde dönem satışları yalnız iki onayı tamamlanmış hesaplardan gelir.
Kasa, cari alacak, stok ve bekleyenler güncel durumu gösterir; geçmiş tarihe
ait mali bilanço olarak sunulmaz. Kasa göstergesi yalnız OPEN hesaplardaki
beklenen nakittir; merkezî kasa/banka defter bakiyesi değildir. Tank ölçüm
farkı mutlak litre toplamı olarak paradan ayrı gösterilir; eski/eksik fiziksel
ölçümler ayrıca sayılır. Günlük ciro ve aylık dönem seçimi de çalışır.

**Uçtan uca sonuçlar:**

| Senaryo | Sonuç |
| --- | --- |
| Tanker kabulü → stok artışı | 45 gerçek API kabulü, ayrı kullanıcı onayı, her teslimde tek giriş; 3 bekleyen talep stoğa yazılmadı |
| Pompa satışı → sayaç → stok | 180 FUEL hesabında fiyat segmentleri ve sayaç çıkışı tank SALE toplamına eşit |
| Satış → tahsilat → icmal | 360 onaylı hesapta nakit + kart + cari + banka beyanı kaynak satışına eşit |
| Cari satış → müşteri borcu → tahsilat | Native borç ve kısmi tahsilat; ayrıca Chrome formundan 1 TL yazıldı ve yenilemede korundu |
| Kapanış → bağımsız onay | 180 vardiya kapandı; tekrarlanan aynı kişi onayı ve eksik imzalı aktif vardiya kapanışı reddedildi |
| OCR → taslak → kullanıcı doğrulaması | Gerçek Windows OCR → PENDING → teyitsiz onay reddi → doğrulanmış belge; hiçbir stok/muhasebe yazımı yok |
| Tenant/rol ayrımı | Diğer şirketin dashboard/tank verisine ve pompacının yönetim API'sine erişim 403 |
| Süreç yeniden başlatma | Aynı MySQL ciro, stok, kasa ve cari değerleri korundu |

**Kontroller:** TypeScript'in iki yapılandırması, **545 test**, üç saat
diliminde 65'er tekrar ve Vite/esbuild derlemesi başarılı. Gerçek Chrome'da
19 modül ekranı, iki şirket ve pompacı girişleri, aylık filtre, mobil taşma
ve JavaScript hata kontrolü başarılı. XLSX dosyası `PK`, PDF `%PDF` imzasıyla
doğrulandı. Önceden mevcut büyük paket/config script derleme uyarıları sürüyor.

Gerçek MySQL üzerinde 13 tutarlılık kontrolü geçti: tenant ilişkileri, iki
farklı onay, sıfır kasa farkı, float/teslim denklemi, satış/tahsilat eşitliği,
cari bakiye, stok defteri, tek teslim girişi, bekleyen teslimin yazılmaması,
market stokları/eşleştirmesi, kesintisiz hareket zinciri ve fiyat segmentleri.
Ek transaction probe'unda kapanış zamanının son okumadan önce olması reddedildi;
başarılı kapatma denemesi rollback edildi ve kalıcı iş kaydı değişmedi.
Kapanışla eşzamanlı yeni hesap açılmasını önlemek için aynı vardiya satırı
hesap açarken ve kapatırken kilitlenir.

Seed, ek senaryolar ve belge üretimi yeniden çalıştırıldı: DEMO'nun **58
tablosunda bütün satır hash'leri aynı** kaldı. Yanlış veritabanı adıyla seed
çalıştırılması reddedildi. Ana uygulamanın **58 tablosu** da başlangıç
snapshot'ıyla aynı kaldı. Aksan vhost SHA-256 değeri değişmedi; Apache ve MySQL
yeniden başlatılmadı. Sadece ayrı DEMO Node süreci yenilendi.

**Eksikler ve açık sınırlar:**

- Canlı banka/POS, pompa otomasyonu ve tank sensörü yoktur; manuel kayıt ve
  açıkça DEMO/SİM etiketli beyanlar vardır. Banka dekontu/IBAN beyanı otomatik
  kesinleşmez. Gerçek mali defter/GL kaydı etkinleştirilmedi.
- Tedarikçi borcunu gerçek ödeme/mahsupla kapatan tam işlem akışı mevcut
  modülde yoktur; 45 borç OPEN bırakıldı. Ödeme yapılmış gibi veri üretilmedi.
- Market stok satışı ile vardiya tahsilatı mevcut yapıda manuel eşleştirilir;
  otomatik kasa/POS satış belgesi entegrasyonu değildir.
- TTS, Gift ve Partner iş modelleri varsayılmadı; ayrı DRAFT kayıtlarıdır.
- Ayrı DEMO sürecinde haricî OCR anahtarları kapalıdır. Ekran bunu açıkça
  gösterir; anahtar bekleniyor gibi yanlış bir uyarı vermez. Yerel OCR çalışır.
- Canlı Gemini denemesi DEMO OCR testlerinden ayrı yapıldı ve
  `GEMINI_NETWORK_ERROR` ile sonuçlandı; bu Codex oturumundaki dış ağ erişimi
  `EACCES` ile engellidir. API erişimi/kota başarılı doğrulanmış değildir.
- Yerel tank/fatura OCR'sinin yapılandırılmış alan eşleştirmesi sınırlıdır;
  kullanıcı kontrolü ve gerekirse elle tamamlama gerekir.

**Mevcut örnekleri kullanma:** `accountant.a` ile Kuzey Merkez'in ilk imzası
atılmış market hesabının ikinci onayı tamamlanabilir. Aktif akaryakıt
hesapları ilgili `fuel.1/2/3` kullanıcılarınındır. Tanker taleplerini talebi
oluşturmayan yetkili incelemelidir. Tank fotoğrafları ve sayısal rapor
taslakları kullanıcı kontrolü bekler. Bu işlemler DEMO veritabanına kalıcı yazılır.

**Tekrar çalıştırma — mevcut DEMO'yu silmeden:**

```powershell
pnpm demo:seed
pnpm demo:scenarios
pnpm demo:documents
pnpm demo:verify
pnpm demo:idempotency
```

Komutlar yalnız `istasyonos_demo` bağlantısını kabul eder; seed/scenario belge
komutlarında hedef ayrıca CLI'da sabittir. Sunucu da kendi sağlık yanıtında
DEMO hedefini doğrulamalıdır. Tamamlanmış senaryo kopyalanmaz. Yarım kalan
işlemler kaydedilmiş istek kimlikleriyle devam eder; yalnız rollback'i
doğrulanmış FAILED isteğe yeni kimlik açılır. Sonucu belirsiz işlem sessizce
tekrarlanmaz. Kullanıcının sonradan değiştirdiği iş kayıtları seed ile sıfırlanmaz.

**Yeni, boş yerel DEMO kurulumu:** Node 22/24, proje bağımlılıkları ve çalışan
Laragon MySQL gereklidir. Proje kökünden:

```powershell
pnpm demo:setup
pnpm demo:build
pnpm demo:start
```

Son komut sunucuyu çalıştırır; ayrı normal PowerShell penceresinde yukarıdaki
seed/scenario/document/verify komutları çalıştırılır. Belge üretimi ve tarayıcı
testleri için mevcut Google Chrome kullanılır; paket veya servis kurulmaz.
`demo:setup` boş hedef oluşturur veya kendisine ait mevcut hedefi migration
kontrolünden geçirir; tanımadığı dolu hedefte durur. Hiçbir DROP/reset komutu
yoktur. Hedef gerçekten boşsa eski yerel checkpoint'ler silinmeden arşivlenir;
önceki veritabanının istek sonuçları yeni veritabanında kullanılamaz.

Sunucu zaten çalışıyorsa ikinci süreç açılmamalıdır. Bu oturumun DEMO sürecini
kontrollü yenilemek için `scripts/demo-restart.ps1`, PID + port + DEMO sağlık
işaretini doğrular. Diğer süreçleri durdurmaz. Mevcut ana `.env` veritabanı
adresini DEMO'ya yönlendirmek gerekmez; ayrı özel yerel ayar kullanılır.

Tarayıcı/çıktı testleri: `pnpm demo:browser`, `pnpm demo:exports`.
Canlı Gemini için ayrı, veritabanına bağlanmayan DEMO kontrolü:
`node scripts/verify-gemini-demo.mjs` — normal PowerShell'de çalıştırılır.

Kanıtlar: [MySQL kontrolleri](../.local/demo/verification.json),
[idempotency](../.local/demo/idempotency.json),
[Chrome sonucu](../.local/demo/browser-result.json),
[yeniden başlatma](../.local/demo/persistence.json),
[yönetim paneli](../.local/demo/dashboard-desktop.png),
[DEMO icmal PDF](../.local/demo/icmal-demo.pdf),
[DEMO icmal Excel](../.local/demo/downloads/istasyonos-vardiya-icmali.xlsx).

Sonraki geliştirme önceliği: kaynak belgeli tedarikçi ödeme/mahsup ve
banka/POS mutabakat akışlarını ayrı iş kurallarıyla tamamlamak. Mevcut
mali kayıt kilitleri bunun için kaldırılmadı.

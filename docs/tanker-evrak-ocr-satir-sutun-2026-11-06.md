# Tanker evrakı OCR ve satır/sütun doğrulaması — 06.11.2026

Tanker evrakı ekranı: `/tanker-belge`. Yalnız DEMO işletmesinde yönetici ve
muhasebe rollerine açıktır. JPEG/PNG sayfaları kaynak olarak saklanır; mevcut
güvenli ZIP içe alma mekanizması yeniden kullanılır. Kaynak görüntüler ve özel
test çıktıları `.local/tanker-document/` altındadır; bu rapora aktarılmamıştır.

## Çalışan akış

- Windows yerel OCR veya açık görüntü gönderme bildirimiyle OpenAI okuması.
- Okuma önerisini forma alma, kullanıcı düzeltmesi ve ayrı kaynak doğrulaması.
- İrsaliye numarası, tarih, düzenleyen, tedarikçi, sayfa sayısı, ürün kodu ve
  yakıt eşleştirmesi. Net hacim ve sevk miktarı ayrı litre alanlarıdır.
- İstasyonda fiziksel ölçülen teslim miktarı ayrıca kullanıcı tarafından girilir;
  evraktaki sayıdan otomatik doldurulmaz.
- Doğrulanmış evraktan mevcut bağımsız onaylı tanker kabulüne PENDING talep.
  Kaynak doğrulaması stok onayı değildir. Mali defter kaydı açılmadı.
- Eksik sayfa, eski revizyon/kaynak, yanlış yakıt, mükerrer kabul ve bağlı
  evrakı sonradan değiştirme kontrolleri korunur. Tek ürün satırı tek tanka
  bütün olarak aktarılır; bölünmüş/kısmi teslim bu aşamada desteklenmez.

Günlük rapor OCR'sine başlık ve koordinat tabanlı satır/sütun önerileri eklendi.
Kullanıcı kaynak satırını ve sayı yorumunu doğrular; toplam satırları engellenir.
Okunamayan alan boş kalır; sıfır veya yakıt eşleştirmesi varsayılmaz. Kaynak
başlığı, satırı ve hücre bağlantıları sunucuda yeniden doğrulanır. Eski okumalar
korunur; yeni Windows okuma sürümü kelime koordinatlarını da saklar.

## Kullanıcının kaynak fotoğrafı

Fotoğraf DEMO alanına kaydedildi. Belge **1/2** sayfa gösteriyor; ikinci sayfa
eksik olduğu için tanker kabulüne geçiş kapalıdır. Yerel OCR metni okudu ancak
ürün satırlarını güvenle eşleştiremedi. Görüntüden incelenen iki ürünün net/sevk
hacimleri açıkça **manuel PENDING taslağı** olarak kaydedildi. Bunlar GPT çıktısı
veya başarılı otomatik ürün okuması olarak sunulmaz. Onaylı stok değişmedi.

## OpenAI bağlantısının gerçek durumu

Varsayılan model `gpt-6-astra`; sunucuda `OPENAI_OCR_MODEL` ile değiştirilebilir.
Responses API, yüksek görüntü ayrıntısı ve katı JSON şeması kullanılır.
`OPENAI_API_KEY` yalnız sunucudan okunur; tarayıcıya gönderilmez. Dış gönderim
bildirimi kullanıcı tarafından işaretlenmeden çağrı yapılmaz. Orijinal görüntü
OpenAI'a gönderileceğinden görüntüdeki özel bilgiler de bu kapsamdadır; kişisel
kimlik/banka alanları çıkarım şemasına alınmaz. `store:false` tüm veri saklama
politikalarını ortadan kaldırdığı anlamına gelmez.

Sunucuda anahtar bulunmadığından **canlı OpenAI çağrısı yapılmadı**. Adaptörün
istek, hata, zaman aşımı ve çıktı kontrolleri sahte HTTP yanıtlarıyla test edildi.
API anahtarı sohbet üzerinden istenmez veya rapora yazılmaz.

Model ve görüntü API kaynağı:
[OpenAI model dokümanı](https://developers.openai.com/api/docs/models/gpt-6-astra),
[görüntü girdisi](https://developers.openai.com/api/docs/guides/images-vision),
[yapılandırılmış çıktı](https://developers.openai.com/api/docs/guides/structured-outputs).

## Doğrulama

- TypeScript kontrolleri, 511 birim testi ve üç saat diliminde 65'er tarih testi
  başarılı. Vite ve sunucu derlemesi başarılı. Önceden mevcut paket boyutu ve
  klasik config script uyarıları sürüyor.
- Gerçek Chrome: sentetik kaynak Windows OCR ile okundu; net 9,90 L / sevk
  10,00 L ayrı korundu. Kullanıcı formuyla PENDING, kaynak doğrulaması ve
  fiziksel 9,95 L girişli bağımsız onay talebi oluşturuldu.
- Bu tek DEMO kabul talebi PENDING bırakıldı; stok 9 L olarak kaldı. Mükerrer
  talep ve kaynak düzenleme 409 ile engellendi. Masaüstü/mobil taşma ve
  JavaScript hata denetimi başarılı.
- Gerçek Chrome günlük raporunda 10,50 L / 500,00 TL kaynak satırı kullanıcı
  onayıyla forma aktarıldı; eşleştirme ve satış esası boş/belirsiz kaldı.
  Okunamayan hücre boş, TOPLAM satırı aktarımı kapalı kaldı. Belirsiz sayı
  yorumlama ve sunucuda hücre bağlama birim testleriyle doğrulandı.
- DEMO veritabanında güvenli manifest mekanizmasıyla yalnız yeni
  `0016_tanker_document_drafts` migration'ı uygulandı; toplam 17 migration.
  Önceki migration dosyaları değiştirilmedi.
- Önceden mevcut dokuz korunan tablodaki satırlar eski kolonları üzerinden
  karşılaştırıldı: değişiklik/silme yok. Eski tanker taleplerinin yeni kaynak
  bağlantısı boş kaldı. Tek ilave kayıt DEMO PENDING tanker kabul talebidir.
- Aksan vhost SHA-256 değeri değişmedi; Apache/MySQL yeniden başlatılmadı.
  İstasyonOS yalnız 127.0.0.1:3000 üzerinden çalıştırıldı.

Sonraki kullanım: kaynak evrakın ikinci sayfasını eklemek ve güçlü model için
OpenAI API anahtarını sunucu ortamında yapılandırmak. Canlı model doğrulaması
anahtar sağlandıktan sonra ayrıca yapılmalıdır.

## Eksik sayfayı tamamlama

Tanker kaynak yükleme formuna **Seçili evrağın eksik sayfalarını tamamla**
seçeneği eklendi. Yalnız yeni fotoğraflar seçilir; mevcut görüntüler özel kaynak
uç noktasından alınır ve SHA-256 değerleri kontrol edilir. Birleşik görüntüler
mevcut güvenli içe alma mekanizmasıyla **yeni kaynak paketi** oluşturur. Önceki
paketin fotoğrafları, incelemeleri ve okumaları değiştirilmez. Yeni pakete eski
onay veya ürün eşleştirmeleri taşınmaz; yeniden okuma ve kullanıcı doğrulaması
gerekir. Bu işlem eksik sayfanın içeriğini üretmez veya varsaymaz.

Kaydedilmemiş düzenleme veya bağlı bekleyen/onaylı kabul varken bu form seçeneği
kapalıdır. Birleşik kaynak için toplam 12 sayfa / 19 MB sınırı uygulanır;
yinelenen görüntüler mevcut ZIP doğrulamasından geçemez. Yeni migration yoktur.

Gerçek Chrome'da yalnız sentetik DEMO kaynaklarla iki sayfalı yeni paket
oluşturuldu: eski paket ve inceleme geçmişi değişmedi, yeni paket otomatik
okuma/onay/kabul almadı. Bekleyen kabulü bulunan kaynakta seçenek kilitli kaldı.
TypeScript, 511 test, üç saat diliminde 65'er test ve derleme tekrar başarılı.
Korunan dokuz tablonun önceki satırları değişmedi; ek stok/mali işlem oluşmadı.
Kullanıcının asıl evrakı halen ikinci sayfayı bekliyor; test fotoğrafı bu evraka
eklenmedi.

## Fiziksel teslim farkı ön izlemesi

Kabul formu fiziksel ölçüm girildiğinde net hacme ve sevk miktarına göre farkı
ayrı gösterir. İşaret yönü **fiziksel ölçüm − belge** olarak açıkça yazılır;
eksi eksik teslim, artı fazla teslimdir. Kullanıcının seçtiği kabul esası ayrıca
gösterilir; esas otomatik seçilmez. Ön izleme tolerans veya stok onayı vermez.
Boş/geçersiz/sıfır ölçümde kabul düğmesi etkinleşmez. Ürün veya evrak değişince
önceki fiziksel ölçüm temizlenir. Sunucudaki kabul kuralları değiştirilmedi.

Dokuz yeni hesaplama/kenar durum testiyle toplam **520 test** başarılı.
TypeScript, üç saat dilimi kontrolü ve derleme başarılı. Gerçek Chrome'da
9,95 L fiziksel ölçüm / 9,90 L net / 10 L sevk için +0,050 ve -0,050 L ayrı
doğrulandı; esas değişimi, sıfır fark, geçersiz hassasiyet ve form temizliği
kontrol edildi. Bu doğrulamada veritabanına yeni kabul kaydı yazılmadı.
Korunan dokuz tablonun mevcut satırları ve önceki tek PENDING kabul değişmedi.

## Belgeye bağlı kabul geçmişi

Tanker belge ekranında bağlı kabul talepleri genişletilebilir geçmiş kartlarında
gösterilir. Belge numarası, talebin bağlandığı kaynak revizyonu, ürün kodu,
net/sevk hacmi, seçilen esas, belge litresi, fiziksel ölçüm, fark, talep eden,
tarih, açıklama, kanıt ve bağımsız inceleme bilgileri bir aradadır. Hacimler
son düzenlenen taslaktan değil talebin bağlandığı inceleme revizyonundan alınır.
Eksik ölçümler sıfıra çevrilmez. Talepler ayrıca tenant ve istasyonla sınırlandırılır.
Onay düğmesi eklenmedi; mevcut bağımsız onay akışı korunur.

TypeScript, **522 test**, üç saat dilimi kontrolü ve derleme başarılı. Gerçek
API/Chrome kontrolünde mevcut DEMO PENDING kabulün 10 L belge, 9,95 L fiziksel
ölçüm ve -0,050 L farkı görüntülendi. Masaüstü/mobil taşma ve JavaScript hatası
yok. Bu aşama yalnız okuma/görüntüleme değişikliğidir; yeni migration veya
stok/mali kayıt yazımı yapılmadı. Dokuz korunan tablonun mevcut satırları
değişmedi. Apache/MySQL yeniden başlatılmadan yalnız uygulama süreci yenilendi.

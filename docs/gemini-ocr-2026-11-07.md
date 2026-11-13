# Gemini OCR entegrasyonu — 07.11.2026

Ekran: `https://istasyonos-main.test/tanker-belge`.

Önceki uyarının nedeni yalnız OpenAI anahtarının kontrol edilmesiydi.
`GEMINI_API_KEY` sunucuda algılanıyor; gerçek değeri okunabilir çıktılara,
tarayıcıya veya örnek env dosyasına aktarılmadı. `.env` değiştirilmedi.

## Uygulanan akış

- Mevcut belge kaynakları, okuma geçmişi, revizyonlar ve kullanıcı inceleme
  mekanizması kullanıldı; yeni SDK/paket kurulmadı.
- Varsayılan model `gemini-3.8-flash`; `GEMINI_OCR_MODEL` ile sunucudan
  değiştirilebilir. Sabit Google API adresi ve başlıkla kimlik doğrulama,
  JPEG/PNG görüntü girdisi ve JSON şeması kullanılır. Tek çağrı, 60 saniye
  sınırı; ücretli başka sağlayıcıya veya sınırsız yeniden denemeye geçilmez.
- Belge türü seçimi: tanker irsaliyesi, tank fotoğrafı, fatura. İrsaliyede
  net/sevk hacmi ayrı; tankta numara/yakıt/kapasite/ürün/net; faturada açıklama,
  miktar, birim fiyat, ara toplam, KDV ve genel toplam kaynak alanları çıkarılır.
  Tank/fatura alanları kaynak metin biçiminde taslaktır; muhasebe hesabı veya
  stok hareketi değildir. Mevcut tank kartına otomatik bağlanmaz.
- Okuma tamamlanınca öneriler düzenlenebilir forma otomatik aktarılır.
  Kullanıcı teyidi otomatik işaretlenmez. Doğrulanmış taslak için sunucuda da
  kaynak teyidi, sayfa bütünlüğü ve alan tamlığı aranır. Eksik LPG kapasitesi
  sıfır kabul edilmez. Tank/fatura taslağından tanker kabulü oluşturulamaz.
- Gemini anahtar, ağ, HTTP/kota veya çıktı hatasında mevcut Windows OCR
  mekanizmasına geçilir. Gerçek sağlayıcı LOCAL olarak kaydedilir; kullanıcıya
  geçiş gösterilir. Yerel motorun güvenle eşleştiremediği tank/fatura alanları
  doldurulmuş gibi gösterilmez; elle tamamlama gerekir.
- Kaynak görüntüler dışarı gönderilmeden Google bildirimi işaretlenmelidir.
  API anahtarı yalnız sunucu başlığında kullanılır; URL ve hata ayrıntısına
  konmaz. Ham sağlayıcı hata gövdesi raporlanmaz.
- Yalnız DEMO veri hedefinde yeni `0017_gemini_ocr` migration'ı provider enum'una
  GEMINI ekledi. Önceki 17 migration dosyası korundu; toplam 18, bekleyen yok.

## Doğrulama ve gerçek sınır

TypeScript kontrolleri, **532 test**, üç saat diliminde 65'er tarih testi ve
Vite/sunucu derlemesi başarılı. Önceden mevcut büyük paket/config script
uyarıları sürüyor.

Yalnız sentetik DEMO tank ve fatura görselleri oluşturuldu; irsaliye testi
mevcut sentetik DEMO irsaliyesiyle yapıldı. Gerçek müşteri belgesi gönderilmedi.
Bu oturumdaki dış ağ çağrısı işletim sistemi/sandbox tarafından **EACCES** ile
engellendi. Dolayısıyla canlı Gemini model erişimi, anahtar geçerliliği ve
hesaba ait ücretsiz kota **doğrulanamadı**. Üç belge türünde LOCAL geçişi
doğrulandı; hiçbir çıktı canlı Gemini okuması olarak sunulmadı.

Gerçek Chrome: anahtar bekleniyor uyarısı kalktı; dış gönderim teyidi olmadan
gelişmiş okuma kapalı. Gemini ağ hatasında yerel geçiş bildirimi çıktı;
irsaliyenin net 9,90 L ve sevk 10 L alanları otomatik doldu, kullanıcı teyidi
işaretsiz kaldı. Tank/fatura taslak alanları ayrı gösterildi; bu alanlarda yerel
OCR belirsizliği açıkça belirtildi. Mobil taşma/JavaScript hata kontrolü başarılı.
Tekrarlanan okumada otomatik dolan formun arka plan yenilemesiyle boşalması
tespit edilip düzeltildi; okuma bitene kadar belge değişimi kilitlendi.

Önceden korunan dokuz tablonun mevcut satırları değişmedi; tek eski DEMO
PENDING kabul aynı kaldı. Yeni stok/mali işlem yazılmadı. Aksan vhost özeti
değişmedi; Apache/MySQL yeniden başlatılmadı. Yalnız İstasyonOS Node süreci
127.0.0.1:3000 üzerinde yenilendi. Tarayıcı çıktısı ve uygulama loglarında
gerçek anahtar taramasında eşleşme bulunmadı.

## Normal PowerShell'de tek bağlantı kontrolü

Proje kökünden çalıştırın:

```powershell
node scripts/verify-gemini-demo.mjs
```

Bu komut yalnız yerel sentetik irsaliye görselini kullanır, veritabanına
bağlanmaz ve anahtar/ham belge çıktısı yazdırmaz. Bağlantı burada başarılı olup
uygulamada başarısızsa Node uygulaması normal PowerShell oturumunda çalıştırılarak
ağ erişimi ayrıca doğrulanmalıdır. Çalışan sunucunun portu kontrol edilmeden
ikinci sunucu başlatılmamalıdır.

Model ve ücretsiz kullanım hesabın erişimine/kotasına bağlıdır; uygulama bir
hesabı ücretsiz katmana zorlayamaz. Güncel limitler Google AI Studio'da görülür:
[Google fiyatlandırması](https://ai.google.dev/gemini-api/docs/pricing),
[kota kuralları](https://ai.google.dev/gemini-api/docs/rate-limits),
[görüntü destekli Flash modelleri](https://firebase.google.com/docs/ai-logic/analyze-images).

Eksikler: canlı Gemini doğrulaması ağ engeline bağlı; yerel tank/fatura
okumasında otomatik yapılandırılmış eşleştirme sınırlıdır. Doğrulanan OCR
taslağını mevcut tank kartına/muhasebe belgesine otomatik işleme bu aşamada
açılmadı; mevcut bağımsız onaylar korunur. Kullanıcının asıl irsaliyesinin
eksik ikinci sayfası tamamlanmadı ve DEMO fotoğrafla değiştirilmedi.

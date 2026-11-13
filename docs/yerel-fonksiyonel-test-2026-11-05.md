# 5 Kasım 2026 — Yerel fonksiyonel test ve hata giderme

Çalışan `https://istasyonos-main.test` üzerinde gerçek HTTPS API ve Chrome
testleri yapıldı. Kurulum/migration analizi tekrarlanmadı. İşlemler yalnız
kullanıcının onayladığı mevcut İstasyonOS test DB'sinde, ayrı DEMO firma
alanlarında yürütüldü. Başka DB veya projede işlem yapılmadı.

## Test verisi ve mevcut kayıtların korunması

Altı rastgele yerel test kullanıcısı; OWNER, MANAGER, FUEL_STAFF, MARKET_STAFF,
ACCOUNTANT ve ayrı firma sahibi rolleriyle hazırlandı. Roller gerçek davet ve
katılım akışından atandı. Yeni firma alanı DEMO olarak işaretlendi; iki
istasyon, vardiya, ürün, tedarikçi, cari borçlu ve örnek işlemler oluşturuldu.
İzolasyon kontrolü için ikinci DEMO firma alanı da ayrıldı. Örnekler inceleme
için korundu; mevcut yönetici hesabının rolü, parolası veya firma erişimi
değiştirilmedi.

Test öncesindeki firma/istasyon, üyelik, hesap, ödeme, slip, cari, defter,
ürün, stok, tedarikçi, payable ve audit satırları test öncesi/sonrası hash ile
karşılaştırıldı; aynı kaldı. Hiçbir mevcut mali dosya onaylanmadı, yeniden
açılmadı veya değiştirilmedi. Yeni test dosyaları yalnız yeni DEMO alandadır.

## Başarılı fonksiyonel testler

| Alan                | Gerçekten sınanan davranış                                                                                                                                                                                               |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Giriş / yetki       | Yanlış şifre reddi, başarılı giriş, çıkışla oturum iptali, yeniden giriş; farklı firma/istasyon erişimi ve yönetici rol yükseltme denemesi reddedildi.                                                                   |
| Dashboard           | Gerçek giriş formuyla açıldı; iki örnek satış hesabının toplamı 12.545,00 TL olarak doğrulandı.                                                                                                                          |
| Vardiya açılışı     | FUEL/MARKET iş alanları ayrıldı; akaryakıt personeli MARKET hesabı açamadı.                                                                                                                                              |
| Ödeme / slip        | Nakit 450000, kart 700000, IBAN 80000, borç 20000 kuruş kaydedildi. Aynı requestId ikinci ödeme oluşturmadı; değiştirilmiş payload, eski revision ve aynı gün mükerrer slip reddedildi.                                  |
| Teslim / kapanış    | Eksik veya yanlış kaynak, nakit farkı ve fizikî teslim olmadan onay reddedildi. Alıcı imzası mali imza sayılmadı; aynı kişi ikinci mali imzayı atamadı. İki ayrı imza sonunda IBAN'lı hesap ACCEPTED_WITH_PENDING kaldı. |
| Kapanış kilitleri   | Kapanmış dosyaya ödeme ve düzeltmeye dönüş reddedildi. OWNER rolündeki kullanıcı da kendi dosyasını teslim alamadı veya onaylayamadı. Bu sıfır tutarlı DEMO dosyası SUBMITTED ve imzasız bırakıldı.                      |
| Market / stok       | Ürün/barkod, mal kabul, adet satışı, idempotent satış, stok düzeltmesi; mükerrer barkod, negatif stok, kesirli adet ve yetkisiz mal kabul reddi. Stok satışı yakıt hesabını değiştirmedi.                                |
| Market hesabı       | 4500 kuruşluk ödeme ayrı MARKET hesabına manuel kaydedildi; kaynak/teslim ve iki farklı imzayla ACCEPTED oldu. Bu, stok satışından otomatik POS ödeme fişi üretilmesi anlamına gelmez.                                   |
| Cari / tahsilat     | Borç 20000, tahsilat 5000 kuruş; bakiye 15000. Fazla tahsilat ve yetkisiz tahsilat reddedildi; aynı kimlik iki tahsilat oluşturmadı. Tahsilat ciroya eklenmedi.                                                          |
| Tedarikçi / finans  | 25000 kuruş payable, cari bakiye ve bugünkü vade tutarı doğrulandı. Geçersiz takvim tarihi reddedildi. Banka/nakit kullanılabilir bakiyesi ve net kâr sahte sıfır yerine bilinmiyor gösterildi.                          |
| Rapor / ekranlar    | Finans, cari, satın alma, vardiyalar, entegrasyon, audit, personel ve profil açıldı. Satın alma CSV'si indirildi; `=DEMO-CSV-…` ürün adı formül olarak çalışmaması için kaçışlandı. Yakalanmamış JS hatası görülmedi.    |
| Mobil / form sınırı | 390 px DOM kontrolü geçti. 191 karakterlik yazım girişinin 190'a sınırlandığı ve tam 190 karakterle mal kabulün gerçekten kaydedildiği doğrulandı.                                                                       |

## Bulunan ve düzeltilen hata

`client/src/components/stationos/BusinessModules.tsx` içindeki stok hareketi,
operasyonel borç ve cari tahsilat referansları UI'da 240 karakter kabul
ediyordu; API'nin sınırı 190 idi. Kullanıcı formu geçerli görünse de sunucu
400 döndürebiliyor ve kalıcı işlem takibinde başarısız sonuç incelemesine
yönleniyordu. Üç alanın `maxLength` değeri 190 yapıldı; API'nin sınırı veya
onay güvenliği gevşetilmedi.

API testinde 190 karakter kabul edildi, 191 karakter 400 ile reddedildi.
Tarayıcıda üç formun sınırı ve gerçek mal kabul kaydı doğrulandı.

Finans ekranında ilk otomasyon denemesi CSS'in büyük harfe çevirdiği metni
küçük/büyük harfe duyarlı aradığı için zaman aşımına uğradı. Bu bir uygulama
arızası değildi; test seçicisi düzeltildi ve ekran testi geçti. İlk test
hazırlığındaki eksik CSRF hatasında iş kaydı oluşmadı; yalnız o başarısız
hazırlığa ait üyeliği olmayan geçici kullanıcılar kimlik kontrolüyle temizlendi.

## Eksik modüller — başarılı gibi sunulmadı

- Pompa/sayaç açılış-kapanış kayıtları, litre/fiyat mutabakatı, litre–tank
  stok defteri ve gerçek Turpak/pompa bağlantısı yok. Mevcut akaryakıt akışı
  manuel kaynak toplamı ve ödeme beyanına dayanıyor.
- Market adet stok satışı mevcut; tam POS sepeti, stok–ödeme–fiş atomik
  bağlantısı, iade ve gerçek YN ÖKC mali fiş entegrasyonu yok.
- Gerçek banka açılış bakiyesi, hareket aktarımı/mutabakat, valör/komisyon
  ve IBAN teyidi yok. Banka bağlantısı DISABLED; muhasebe imzası IBAN'ı
  teyit edilmiş banka parasına çevirmiyor.
- Dönem bazlı tam mali raporlar, net kâr ve resmî muhasebe/e-belge akışı yok.
  Mevcut ekranlar operasyonel özet, vade ve satın alma önerisi CSV'si sunuyor.

## Doğrulama ve sonuç dosyaları

İki TypeScript kontrolü, 18 dosyada **210 test**, üç saat diliminde 65'er
tekrar testi ve build başarılı. Önceki runtime config script ve büyük JS
paketi uyarıları devam ediyor. Yeni frontend çalışan yerel build'e alındı;
backend değişmediği için servis yeniden başlatılmadı.

Sekiz API kontrol grubu ve beş HTTPS/Chrome grubu başarılı. Yerel kanıtlar:

- `.local/functional-tests/result.json`
- `.local/functional-tests/browser-result.json`
- `.local/functional-tests/downloads/`: üretilen örnek CSV.
- `.local/functional-tests/access.json`: yalnız DEMO hesapların özel giriş
  bilgileri; parola/oturum içerir, paylaşılmamalıdır.

Testler DOM ve gerçek API/DB sonuçlarına dayanır; fiziksel cihaz veya piksel
düzeyinde görsel kabul değildir. Apache ve MySQL yeniden başlatılmadı.
Aksan Muhasebe vhost hash'i değişmedi. Uygulama açık bırakıldı.

**Sonraki geliştirme önceliği:** Manuel pompa/sayaç açılış-kapanışını ve
litre/fiyat mutabakatını vardiya hesabına bağlamak; ardından tam market POS
stok–ödeme–fiş bütünlüğünü geliştirmek. Mevcut bağımsız onay ve mali kapanış
kilitleri her iki geliştirmede de korunmalıdır.

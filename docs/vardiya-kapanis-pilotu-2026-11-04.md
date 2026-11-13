# 4 Kasım 2026 — Tam vardiya kapanış pilotu

**Devam kaydı:** Kullanıcı yedek–geri yükleme provasını atladı.
Sonraki [Windows/Laragon yerel HTTPS kabulü](windows-https-kabul-2026-11-04.md)
tamamlandı; yedekten geri dönme henüz doğrulanmış değildir.

Gerçek HTTP API ve ayrı sentetik MySQL üzerinde ödeme, teslim, düzeltme ve
iki bağımsız mali imza akışı tamamlandı. Kapanmış hesabı mevcut düzeltme
endpoint'iyle yeniden açma hatası bulundu ve giderildi. Üretim dağıtımı veya
mevcut işletme veritabanında işlem yapılmadı.

## Bulgu ve davranış değişikliği

`POST /api/stationos/account/return`, `ACCEPTED` ve
`ACCEPTED_WITH_PENDING` hesaplarını da kabul ederek durumlarını OPEN yapıyor,
nakit teslim alanlarını temizliyor ve cycle artırıyordu. İlk pilot bu hatayı
gerçek DB üzerinde 200 yanıtıyla yakaladı.

Endpoint artık yalnız SUBMITTED ve IN_REVIEW hesaplarını düzeltmeye alır.
Kesin kapanmış ve banka teyidi bekleyen kapanmış hesaplarda 409 /
ACCOUNT_LOCKED döner; mali durum, cycle ve imza geçmişi değiştirilmez.
Mevcut rol, istasyon, kendi hesabını onaylamama ve revision kontrolleri
korunur. Arayüz zaten kapanmış hesapta düzeltme düğmesini göstermiyordu;
arayüz değişikliği yapılmadı. Yeni migration veya yapılandırma yok.

Değişen kaynaklar:

- `server/stationos/index.ts`: düzeltmeye dönüş için durum sınırı.
- `server/stationos/invitation-flow.test.ts`: gerçek handler üzerinden altı
  regresyon testi; iki kapanış ve OPEN reddi, iki geçerli düzeltme durumu,
  OWNER rolündeki hesap sahibinin kendi dosyasını iade edememesi.

## Pilot kapsamı ve kanıt

Node.js 24.14.0 / MySQL 8.0.30 / Windows kullanıldı. `.env` yüklenmedi.
MySQL yalnız loopback 13387 portunda ve `.local/y08-pilot/data/` altında
çalıştırıldı. Port ve veri dizini doğrulandıktan sonra her koşu için ayrı
sentetik DB/kullanıcı oluşturuldu. Uygulama anahtarları süreç içinde rastgele
üretildi; oturum ve parolalar rapora yazılmadı. Sekiz migration mevcut
kontrollü migrator ile uygulandı; startup readiness geçti.

Altı kullanıcı: OWNER, FUEL_STAFF, iki ayrı ACCOUNTANT, diğer firma sahibi
ve yalnız ikinci istasyona yetkili ACCOUNTANT. Yetkiler gerçek tek kullanımlık
davetlerle verildi. Diğer firma ve aynı firmadaki yetkisiz istasyon erişimi
403 döndürdü.

| Kontrol                             | Sonuç                                                                                                                                                                    |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Nakit/kart/IBAN/borç                | 450000 / 700000 / 80000 / 20000 kuruş; aynı requestId nakit ödemesini çoğaltmadı.                                                                                        |
| Eski alacak tahsilatı               | Ayrı 5000 kuruş tahsilat personelin satış veya fizikî nakit toplamına eklenmedi.                                                                                         |
| Kaynak ve fizikî sayım              | Eksik kaynak, 1 kuruş kaynak farkı ve açılış float'ını dışlayan yanlış sayım reddedildi. 1250000 kuruş kaynak ve 451000 kuruş fizikî sayım kabul edildi.                 |
| Fizikî teslim                       | 450000 kuruş teslim alındı; 1000 kuruş float teslim dışında kaldı. CASH_RECEIVE mali imza sayısını artırmadı. Teslim öncesi onay reddedildi.                             |
| İmza bağımsızlığı                   | İlk mali imza IN_REVIEW bıraktı; aynı kullanıcının ikinci imzası reddedildi.                                                                                             |
| Düzeltme döngüsü                    | IN_REVIEW hesabı geri gönderildi; önceki alıcı ve onay imzaları silinmedi. Yeni cycle'ın imza sayısı sıfırdan başladı.                                                   |
| Düzeltilmiş kapanış                 | 1000 kuruş ek nakit sonrası kaynak 1251000, sayım 452000, teslim 451000 oldu. İki yeni farklı imza gerekti. Sonuç ACCEPTED_WITH_PENDING; 80000 kuruş IBAN hâlâ bekliyor. |
| Ayrı mali kullanıcının kendi hesabı | OWNER kendi hesabını teslim alamadı veya onaylayamadı: SELF_APPROVAL_FORBIDDEN.                                                                                          |
| Cari tahsilat ve para üstü          | OWNER hesabında satış 2000, eski tahsilat 5000, beklenen teslim 7000, float 500 ve sayım 7500 kuruş. Kaynak satış yalnız 2000 kuruş kaldı.                               |
| Eşzamanlı iki onay                  | Aynı revision ile iki ayrı muhasebeciden biri 200, diğeri 409 / REVISION_CONFLICT aldı. Güncel revision ile ikinci farklı imza hesabı ACCEPTED yaptı.                    |
| Cari alt defter                     | 20000 kuruş borç ve iki ayrı 5000 tahsilat sonrası bakiye 10000 kuruş; üç defter satırı korundu.                                                                         |
| Kapanış bütünlüğü                   | Her iki kapanış durumu düzeltmeyle yeniden açılamadı; kapanmış hesaba ödeme eklenemedi.                                                                                  |
| Yeniden başlatma                    | Uygulama kapatılıp tekrar açıldı. İki kapanış, mali kayıtlar ve audit geçmişi DB'de kaldı.                                                                               |

## Doğrulama ve yerel tekrar

- `node scripts/verify-phase1.mjs test`: iki TypeScript kontrolü başarılı;
  **17 dosyada 198 test geçti**.
- UTC, Europe/Istanbul, America/New_York: her birinde 65 tekrar testi geçti.
- `node scripts/verify-phase1.mjs build`: başarılı. Önceki runtime config
  script ve büyük JS paketi uyarıları sürüyor.
- `node .local/y08-pilot/shift-close.mjs`: düzeltmeden sonra sekiz pilot
  kontrol grubu başarılı. Betik ve `shift-close-result.json` makineye özel,
  `.gitignore` kapsamındaki yerel kanıtlardır. Tekrar için mevcut izole MySQL
  veri dizini, `entry.mjs` ve güncel `.local/phase1-build/` gerekir.

Bu pilot tarayıcı arayüz kabulü değildir. MySQL 8.0.30 dışındaki motorlar,
HTTPS, fiziksel cihazlar ve yedek geri yükleme bu koşuda sınanmadı.

Uygulama süreçleri kapatıldı; izole MySQL normal SHUTDOWN ile durduruldu ve
logda `Shutdown complete` doğrulandı. Yalnız sentetik DB ve yerel tanılama
dosyaları inceleme için korundu. Önerilen yedek–geri yükleme provası daha
sonra kullanıcının açık talebiyle atlandı; tamamlanmış kabul edilmez.

# Pilot v1.9 — Yönetim kurulu sunum senaryosu

**Tarih:** 10 Ekim 2026. **Hedef:** pilot kapsamını, süreç sahiplerini ve gerçek veri toplama adımını belirlemek. Bugünkü talep canlıya geçiş, resmî kayıt veya ödeme onayı değildir.

[8 slaytlık sunum ve konuşmacı notları](manus-resource://manus-slides/deck/akaryakit-v1-pilot-v1-9-y-netim--mv2n4s9s-b71913bb)

## 1. Süreli slayt akışı

| Slayt | Süre | Tek ana mesaj | Toplantı davranışı |
|---|---:|---|---|
| 1 — Kontrollü pilot | 1 dk | Tasarım/kod örneği ≠ canlı hazır sistem | Tek istasyonla başlamayı öner; kaynak verilerin beklediğini belirt |
| 2 — Personel hesabı | 2 dk | Çalışan teslim eder; yetkili kapatır | Atanmış vardiya, float, dört ödeme türü, eski AR, fizikî teslim ayrımını açıkla |
| 3 — PWA mimarisi | 2 dk | Cache yalnız statik; kayıt ve yetki sunucuda | Manifest/SW, BFF/RBAC, private upload, worker/DB/audit sorumluluğunu açıkla |
| 4 — OCR ve toplam | 2 dk | Teyitli tekil slip toplamı otomatik; banka neti farklı | Blur/düşük confidence/duplicate/iade ve temporary retry yollarını anlat |
| 5 — Muhasebe kuyruğu | 2 dk | İmza aynı veri revision/hash'ine | İlk imza pending; ikinci farklı kişi; pending finans ayrı; self-approval yok |
| 6 — Gerçek likidite | 2 dk | Gerçek veri olmadan ödeme kapasitesi hesabı yok | 9 Excel sheet, opening/fee/valör/cash dates; boş≠0 grafiklerini açıkla |
| 7 — 46 kapı kontrolü | 1,5 dk | PASS gözlenen kanıt ister | G0–G4 ve bloklayıcıları açıkla; kapsam dışı modülü PASS sayma |
| 8 — Karar ve sorumlular | 1,5 dk | Pilot hazırlığı kararını somutlaştır | İstasyon/süreç sahipleri/cihaz/veri/policy teyitlerini kaydet |

Toplam anlatım **14 dakika**, soru-cevap için **5 dakika** önerilir. Konuşmacı notları slaytlara işlenmiştir. Gerçek ölçülen süre veya taahhüt değildir.

## 2. İsteğe bağlı kontrollü teknik gösterim

Slaytlar arasında ilave demo istenirse 3–5 dakika ayrılır. HTML wireframe demo kimlik ve sentetik veri içerir; gerçek auth/OCR/finans değildir.

- Mevcut wireframe'de vardiya→slip→review→muhasebe/onay geçişini göster; görsel akışı canlı tahsilat diye tanıtma.
- Geliştirici ortamında `node --test` ile örnek domain/PWA case'lerinin test etiketlerini göster. Bunlar provider API veya gerçek telefon saha testi değil.
- Excel'de KASA/BANKA/POS_TARIFE satırlarının boş olduğunu göster. Oranları toplantı sırasında tahminle doldurma.
- Boş grafik durumunu aç: kaynak eksik olduğu için çizgi yok. Pozitif likidite veya ilk açık günü iddiasında bulunma.

## 3. Muhtemel sorular ve yanıt çerçevesi

**“Fotoğraf yükleyince kart toplamı otomatik olur mu?”**
OCR alanları otomatik önerir. Güvenli, uygun ve mükerrer olmayan slip insan teyidinden sonra sunucu toplamına yansır. Banka takası ayrıca doğrulanır.

**“Turpak API'sini alamazsak pilot biter mi?”**
Kanıt fotoğrafı/OCR ile kontrollü manual-evidence pilotu yapılabilir. Bu, canlı API veya mali kayıt yerine geçmez; kaynak yetkilisi onaylı kapsam ve açık source-pending durumuyla ilerler.

**“Muhasebe uzaktan para teslimini kabul edebilir mi?”**
Mali inceleme yapabilir. Fizikî nakdi alan vezne/amir ayrıca isim ve sayım kaydıyla teyit eder. Uzaktan review'e fizikî teslim etiketi verilmez.

**“İki rolü olan aynı yönetici iki imza atabilir mi?”**
Hayır. İmza görev ayrımı gerçek kişi kimliğine bağlıdır; iki farklı rol aynı kişiyi iki yetkili yapmaz.

**“OCR bir slipi iki kez okuyunca ne olur?”**
Dosya hash'i ve source ref tekillik kontrolü; ikinci fotoğraf review. Finans toplamı ikinci kez artmaz. Meşru kaynak çakışması ayrı incelemeyle çözülür.

**“Gerçek nakit açığını ne zaman göreceğiz?”**
Snapshot kasa/banka, bekleyen gerçek batch, fee/valör/hold, ödeme-tahsilat schedule ve tampon teyit edilince. Şu an veri yok; tarih veya sonuç tahmini verilmiyor.

**“Bu haliyle sahaya açabilir miyiz?”**
Hayır, bu teslimat örnek kod/plan/sunumdur. Gerçek auth/storage/OCR/DB/provider bağlantıları ve G0–G4 kanıtları tamamlanmalı. Checklist yazılmış olması PASS değildir.

## 4. Karar kayıt taslağı

Toplantıda doldurulacak, henüz karar verilmemiş alanlar:

- Pilot hukuki firma / istasyon / FUEL–MARKET kapsamı.
- Saha amiri, muhasebe, teknik sorumlu ve firma karar sahibi.
- Gerçek veri hazırlayan / teyit eden / snapshot saati.
- PWA veya native ihtiyaç değerlendirmesi; desteklenen cihazlar ve İSG izinli çekim alanı.
- OCR sağlayıcı/redaksiyon/retention, confidence policy ve manual fallback.
- Onay policy_version, pending-source/pending-bank kuralları, nakit tamponu.
- Kapalı modüller ve NOT_IN_PILOT gerekçeleri.
- Kanıt toplama ve yeniden değerlendirme toplantısı; tarih kurulca seçilecek.

**Go/No-Go:** bu sunum kaynak değişikliğini, resmî fiscal gönderimi veya üretim geçişini onaylayan bir tutanak değildir. Bunlar gerektiğinde kendi exact kapsam/kanıt/onay süreciyle değerlendirilir.

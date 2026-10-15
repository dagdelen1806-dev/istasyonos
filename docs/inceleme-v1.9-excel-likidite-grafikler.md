# V1.9 — Gerçek veri Excel'i ve likidite grafik incelemesi

**İncelenen kaynak:** [pilot-v1.9-gercek-veri-toplama.xlsx](pilot-v1.9-gercek-veri-toplama.xlsx). **İnceleme tarihi:** 10 Ekim 2026. Dosya veri toplama şablonudur; 7 günlük çalışan forecast modeli değildir. Gerçek firma/istasyon/bakiye/POS verisi henüz girilmedi. Bu incelemede kaynak dosya değiştirilmedi.

## 1. Dokuz sayfanın veri düzeyi

- **KILAVUZ:** kaynak, gizlilik ve boş≠0 kuralı. Finans verisi içermez.
- **PILOT:** firma/istasyon/iş alanı ve ortak snapshot saati; veri tamlığı ve hazırlayan/teyit eden. Import başlığının bağlamı.
- **KASA:** her kasa için fizikî sayım, korunacak float, float dışı erişilemez tutar, kaynak sayım referansı. Bir satır bir kasa/snapshot'tır.
- **BANKA:** hesap takma adı, banka, currency, available/blocked/book bakiyeleri. Bir satır bir hesap/snapshot'tır. Available zaten netse blocked tekrar çıkarılmaz; kredi limiti nakit sayılmaz.
- **POS_TARIFE:** firma/POS/merchant/settlement-account, etkin tarih aralığı, kategori, komisyon, sabit/min/max, valör/cutoff/bloke ve sözleşme ref. Bir satır tarihli tarife profili.
- **KART_BEKLEYEN:** batch source ID, satış dönemi, brüt/fee/bloke/diğer kesinti, net, planlı/actual settlement ve opening'e dahil flag. Bir satır batch veya açık ayrıştırılmış takas dilimi.
- **NAKIT_TAKVIM:** kalem source ID, yön, tutar, category, hukuki vade, planlı/actual cash zamanı, state, opening dahil flag ve belge. Bir satır ödeme/tahsilat olayı.
- **TAMPON:** firma/istasyon/hesap minimum politikası, currency, etkin tarih ve onay.
- **KONTROLLER:** 46 checklist ID, run/build/istasyon, expected/observed, kanıt ve onaylayan. Başlangıç `NOT_STARTED`; PASS yapılmadı.

Finans sayfalarında giriş satırları **9–28**, yani 20 satırlık başlangıç alanı vardır; bütün istasyonların uzun vadeli batch listesi için bu sınır yetersiz olabilir. KONTROLLER'de 9–54 arası 46 kayıt bulunur. Import yazılımı kullanılan gerçek satırları keşfetmeli; sabit `28` sınırından sonraki satırları sessizce atlamamalıdır.

## 2. Mevcut formüller

### KASA / K9:K28

```excel
=IF(COUNT(H9:J9)=3,H9-I9-J9,"")
```

`H=fizikî sayım, I=float, J=float dışı erişilemez`. Üçü sayısal değilse boş döner. Kaynak açısından teyitli 0, bilinmeyen alan yerine girilmemelidir. Float ve erişilemez nakit üst üste tanımlanırsa iki kez düşülür; sayım formu bu ayrımı kontrol etmelidir. Negatif sonuç saklanıp uyarı üretir; sessizce `MAX(0,...)` ile yok edilmez.

### KART_BEKLEYEN / N9:N28

```excel
=IF(COUNT(J9:M9)=4,J9-K9-L9-M9,"")
```

`J=brüt, K=fee, L=bu hafta blokeli, M=diğer kesinti`. Doğrulanmış değerleri netler; POS_TARIFE oranından otomatik fee üretmez ve valör tarihi hesaplamaz. Ayrı tarihte alınacak ücret bu batch'te takasta 0 olup ayrı cash event'te yer alır; takasta düşülmüş ücret ayrıca future cash out olarak sayılmaz.

**Kısmi takas:** tek batch birden fazla günde ödeniyorsa tek net/tarih sütunu yeterli değildir. Üretim modeli batch header + settlement-schedule lines ve source-slice ID gerektirir. Gerçekleşmiş dilim opening veya actual event'te; kalan dilim pending forecast'te bir kez yer alır. Tek Excel satırını hem opening actual hem future expected'e dahil etmek çift sayımdır.

## 3. Mevcut dosyanın güçlü yönleri ve boşlukları

Güçlü yönler: açıklayıcı source kolonları, currency, snapshot, actual/planlı ayrımı, banka blokesi, POS yürürlük aralığı ve completeness notları. Finansal girdiler boş kalır; kaynak şablon %2 veya demo bakiye ile doldurulmamıştır.

Şablon henüz aşağıdaki kontrolleri otomatik sağlamaz:

1. **Kalıcı anahtar ve import eşlemesi:** aliases kullanıcı kolaylığı içindir. Onaylı alias→legal company/station/account/device master map olmadan gerçek kayda bağlanmamalı. Firma değişiminde kaynak belgenin hukuki sahibi sabit.
2. **Tarih/saat türü:** metin/Excel tarih numarası normalize edilip time zone, snapshot ve cutoff doğrulanmalı. Hukuki vade =/= planlı bank cash date. T+N takvim/iş günü ve sağlayıcı tatil/cutoff protokolü motoru yok.
3. **Tutar/oran doğrulaması:** sayı alanlarında negatif/ölçek kontrolü ve yüzde aralığı gereken alanlarda yok. Excel'de `2` ile `2%` çok farklıdır; import'la fark saptanmalı. Limit, cash ve commission amount esası ayrı teyit edilmeli.
4. **Profile çakışması:** aynı POS/currency/category tarih aralığında iki tarife; missing merchant/settlement hesabı; geçersiz fee min/max kuralları veri kalite hatası.
5. **Fee hesap esası:** transaction başına fixed/min/max için batch'te işlem sayısı ve kategori dağılımı eksik. Gerçek tarife işlem/batch rounding, taksit/kart kategorisi, ayrı vergi ve fee zamanını belirlemeli. Salt brüt×oran yeterli olmayabilir.
6. **Kesinti ile bloke ayrımı:** hold kalıcı gider değildir. Release tarihi/koşulu ve reserve balance gerekir. “Bu hafta blokeli” tek alanı 30 gün cash modeline otomatik taşımamalı.
7. **Source tekillik:** batch ID/kalem source ID boş veya duplicate ise import bloke. İç transfer çifti aynı transfer ID ile bağlı; konsolide net etkisi sıfır, hesap bazlı etkileri ayrı.
8. **State geçişi:** SETTLED kaydı pending listeden çıkarılır; actual bank line opening'e dahilse future inflow yok. PARTIAL settlement referansı satır dilimi seviyesinde gerekir. CANCELLED cash event gerçekleşmiş gibi sayılmaz.
9. **Giriş alanı genişletme:** 20 satır sonrası biçim/validation/formül alanları otomatik genişlemiyor. Dinamik Excel Table veya kontrollü import kullanılmalı.
10. **Formül koruma / cache:** formül kolonları yanlışlıkla edit edilebilir. Uygulama Excel cached-value'lerine kör güvenmez; giriş alanlarından yeniden hesaplar. openpyxl formülleri hesaplamaz; programın data_only okuması boş cached sonuç döndürebilir.
11. **Kanıtlı PASS:** dropdown PASS'ı kanıt olmadan seçtirebilir. Checklist approval workflow, evidence/build/time/reviewer şartlarını sunucuda zorunlu kılmalı. `WAIVED` gerçek PASS değildir; geçiş politikasına göre ayrı istisna.

Bunlar var olan şablonun veri toplama amacı için anlaşılır sınırlarıdır. Şablonu doğrudan production muhasebe sistemi gibi kullanmak uygun değildir.

## 4. Import kapıları ve hedef veri sözleşmesi

```text
UPLOAD → HEADER/TYPE CHECK → MASTER MAP → SCOPE/CURRENCY CHECK
→ SOURCE DEDUP → DATE/STATE/FEE CHECK → MUHASEBE TEYİDİ
→ IMMUTABLE SNAPSHOT → FORECAST → CHART PAYLOAD
```

Hatalar satır/hücre/source referansıyla gösterilir. Yalnız doğru satırları alıp eksik giderleri saklayan “kısmi başarılı, pozitif likidite” raporu güvenli değildir; scope completeness başlıkta korunur. Maskeli belge upload private erişimle; şifre/API/PAN bu dosyalara girmez.

Hedef günlük forecast satırı şu alanları taşır: `company_id, station_id/account_id, currency, snapshot_at, scenario_id, cash_date, opening_minor, inflow_minor, outflow_minor, closing_minor, buffer_minor, completeness, source_refs, forecast_version`. TRY para integer kuruş veya integer-string; API'de BigInt serialize string. FX varsa doğrulanmış kur/tarih/kaynak, yoksa currency'ler ayrı.

`closing_cash(d) = opening_cash(d) + inflows(d) − outflows(d)`

`opening_cash(d+1) = closing_cash(d)`

`headroom(d) = closing_cash(d) − approved_buffer(d)`

Kaynağı teyitli boş gün, gerçekten olay yoksa 0 akış olabilir; kaynağı eksik günün sonucu `null` olur. Gün içi kesinti/ödeme sırası önemliyse yakın dönem saatlik rolling forecast gerekir. Gün sonu pozitifi öğlen açığını garanti etmez.

## 5. Önerilen grafikler ve doğru yorum

### G1 — 7 günlük kapanış nakdi ve tampon çizgisi

X tarih, Y TL; base/valör gecikmesi/birleşik stress ayrı çizgiler, onaylı tampon dashed. İlk tampon altı günü ve minimum headroom yalnız complete veriyle hesaplanır. Bir şirketin tüm hesaplarını kullanabildiği varsayılmadan hesap ve istasyon filtreleri sağlanır. Eksik veri aralığında çizgi kopar; 0 çizilmez.

### G2 — Giriş/çıkış bileşenleri

Günlük bar: cash, kart net takas, IBAN/AR tahsilat ve diğer giriş; AP, maaş/kira/vergi/kredi, ayrı fee ve gider çıkışları. Çıkış negative eksende. Aynı karta net fee düşülmüşse fee barında ikinci çıkış yok. Belge kaynağına drilldown gerekir. Actual ve expected ayrı stil/etiket.

### G3 — Kart brüt-net köprüsü

Her batch için brüt → iade/mahsup → fee → bloke → net takas; hold release ayrı gelecek olay. Planlı waterfall'a batch veri türü gerekir. [Renderer](likidite-v1.9-grafik-render.py) şu an karşılaştırma barlarını destekler; waterfall hesabı/production bank entegrasyonu değildir. Ödeme valörü ile fee oranını çift eksende tek yanıltıcı çizgiye koymayız.

### G4 — İstasyon/hesap nakit açığı

Her hesap için minimum headroom; firmada toplam fazla olsa da bir hesapta ödeme açığı görünür. Hukuki firma/currency ayrımı korunur. Ortak merkez banka hesabı her istasyonda opening olarak tekrar sayılmaz. Heatmap seçilirse eksik hücre gri + `VERİ EKSİK`, risk kırmızı sadece doğrulanmış negatif sonuçta.

### G5 — Ödeme yükü vade merdiveni

7/14/30 gün AP/gider/kredi toplamları bar, AR beklenen tahsilat ayrıca; vade ve planlı cash date ayrı gösterilir. Sipariş commitment/fatura AP geçişi tekil olmalıdır.

### G6 — Veri kalitesi ve pending iş yükü

Eksik kaynak, yaşlı snapshot, fee/valör unknown, eşleşmeyen batch ve OCR review sayıları. Finans sonucuyla aynı referans anını kullanır. Kasa ve bankadan yalnız birinin gelmesi “tüm kaynak complete” değildir.

## 6. Üretilen mevcut görünüm

[Grafik veri JSON sözleşmesi](likidite-v1.9-grafik-verisi.json) `MISSING_REAL_DATA`, snapshot ve balances null, seriler empty içerir. [Boş durum grafik görünümü](likidite-v1.9-grafik-bos-durum.png) gerçek veri olmadığı için **hiçbir nakit eğrisi veya uydurma tutar çizmez**.

Renderer kullanımı:

```bash
python3 likidite-v1.9-grafik-render.py \
  --input likidite-v1.9-grafik-verisi.json \
  --output likidite-v1.9-grafik-bos-durum.png
```

`status=VALIDATED` JSON'un import/muhasebe tarafından doğrulandığını ifade eden sözleşme alanıdır; renderer bu sürecin yerine geçmez. Dört grafik için sınırlı Python örneği, Excel'den canlı hesap motoru değildir. Geçerli serilerde null değerler çizgi boşluğu bırakır; fractional TL yalnız grafiğin son gösteriminde kullanılır.

**Gerçek analiz için sıradaki bilgi:** firma/istasyon ve snapshot saati, sayım/float, banka available, batch/state, tarihli gerçek POS tarife/takas belgeleri, ödeme-tahsilat schedule ve onaylı tampon. Veriler paylaşılınca deterministic daily model ve gerçek grafik üretilebilir; şu an açık günü/ödeme kapasitesi/ROI tahmini yapılmadı.

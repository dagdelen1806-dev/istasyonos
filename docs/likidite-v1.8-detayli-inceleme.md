# AKARYAKIT V1 — v1.8 Likidite ve Kart Komisyonu İncelemesi

**Tarih:** 10 Ekim 2026. **Veri temeli:** mevcut v1.7 prototipindeki sentetik girişler. Bu rapor gerçek banka tarifesi, gerçek cari bakiye veya canlı istasyon analizi değildir. Yeni senaryolar mevcut modelin duyarlılık testleridir; sözleşmeyle doğrulanmış oran/valör olarak kullanılmaz.

**Snapshot:** 10 Ekim 2026. **Projeksiyon:** 11–17 Ekim 2026, TRY. Nakit ve borçlar ödeme tutarı esasındadır; KDV hariç katkı/kâr panelinden ayrı tutulur. [V1.7 model açıklaması](tasarim-v1.7-raporlama-finans-olay-testleri.md).

## 1. Yönetici özeti

1. V1.7'de bütün kart tutarı **11 Ekim Pazar** tahsil edilmiş varsayılıyor. Bu sözleşmeyle doğrulanmış bir valör değildir. Banka/acquirer, POS, işlem zamanı, iş günü/tatil ve bloke koşulu ayrı tanımlanmalı.
2. Bütün 97.000 TL AR'nin 12 Ekim'de tahsil edilmesi baz için güçlü varsayımdır; geçmiş borçlar vade tarihine bakılarak tahsil olmuş sayılamaz.
3. Haftanın sonunda pozitif bakiye olması yeterli değil. Kart 14 Ekim'de geçerse **13 Ekim'de −29.750 TL** geçici açık, 17 Ekim'de +27.030 TL vardır.
4. Beş istasyonun toplamı +27.030 TL iken **S04 −4.230 TL, S05 −12.490 TL** olabilir. Merkez hesabındaki para otomatik istasyon kasasına aktarılmış sayılmaz.
5. %2 → %3 komisyon artışı bu örnekte sadece 610 TL net tahsilat farkı yaratıyor. Asıl baskı **250.000 TL ödeme yükü, tahsilat zamanlaması ve kullanılabilir açılış parası**.
6. Örnek 20.000 TL firma nakit tamponu korunacaksa 25.000 TL yeni PO sonrası +2.030 TL sonuç yetersizdir. Bu varsayımlarda ilave ödeme alanı **7.030 TL**; bu bir sipariş limiti tavsiyesi değil matematiksel senaryo sınırıdır.

**Sonuç:** Model demo olarak tutarlı; pilotta ödeme kararı için banka/hesap bazlı valör, gerçek ödeme takvimi, nakit erişilebilirliği ve gün içi açık kontrolü eklenmeden kullanılmamalı.

## 2. Mevcut girişler ve kapsam

| Kalem | Demo tutar | Kullanım |
|---|---:|---|
| Sayılmış kasa + banka − float | 125.500,00 TL | Kullanılabilir açılış; blokaj/fizikî transfer henüz ayrılmadı |
| Brüt bekleyen kart | 61.000,00 TL | Tahsilattan önce açılışa dahil değil |
| %2 kart komisyonu | 1.220,00 TL | V1.7 takas anında kesiliyor varsayımı |
| Net kart takası | 59.780,00 TL | 11 Ekim baz girişi |
| Bekleyen IBAN | 2.600,00 TL | Banka eşlemesi yok; açılış ve projeksiyon dışı |
| AR tahsilat beklentisi | 97.000,00 TL | Tamamı 12 Ekim'de baz varsayımı |
| Gecikmiş AP | 30.000,00 TL | 11 Ekim ilk gün ödeme varsayımı |
| 13 Ekim vadeli AP | 220.000,00 TL | 13 Ekim ödeme |
| Günlük nakit gider | 750,00 TL | Beş istasyon × 150 TL; yedi gün 5.250 TL |
| İlave PO senaryosu | 25.000,00 TL | Firma toplamı, 13 Ekim; gerçek ödeme yaratmaz |

Personel maaşı, vergi, kredi/finansman taksiti, kira, enerji, düzenli market/akaryakıt sevkiyatları, iade ve chargeback gibi gerçek nakit kalemlerinin bütünü demo giderine dahil değildir. Bu nedenle “gelecek yeni satışlar yok” tek başına modelin muhafazakâr olduğu anlamına gelmez: **giderler ve borçlar eksikse sonuç yine iyimser olabilir**.

## 3. Yedi günlük baz plan

`C_d = C_(d−1) + doğrulanmış/planlı girişler − planlı çıkışlar`

Gerçekleşen banka para girişi ile beklenen giriş ayrı statüde gösterilir. Aşağıdaki bütün geleceğe dönük girdiler demo planıdır.

| Gün | Açılış | Kart net | AR tahmin | AP ödeme | Nakit gider | Gün sonu |
|---|---:|---:|---:|---:|---:|---:|
| 11 Ekim Pazar | 125.500,00 | 59.780,00 | 0,00 | 30.000,00 | 750,00 | 154.530,00 |
| 12 Ekim Pazartesi | 154.530,00 | 0,00 | 97.000,00 | 0,00 | 750,00 | 250.780,00 |
| 13 Ekim Salı | 250.780,00 | 0,00 | 0,00 | 220.000,00 | 750,00 | 30.030,00 |
| 14 Ekim Çarşamba | 30.030,00 | 0,00 | 0,00 | 0,00 | 750,00 | 29.280,00 |
| 15 Ekim Perşembe | 29.280,00 | 0,00 | 0,00 | 0,00 | 750,00 | 28.530,00 |
| 16 Ekim Cuma | 28.530,00 | 0,00 | 0,00 | 0,00 | 750,00 | 27.780,00 |
| 17 Ekim Cumartesi | 27.780,00 | 0,00 | 0,00 | 0,00 | 750,00 | 27.030,00 |

Tutarlar TL. Kontrol: `125.500 + 59.780 + 97.000 − 250.000 − 5.250 = 27.030`.

### Tarih ve gün içi zaman düzeltmesi

- “D+1” takvim günü ile “T+1 iş günü” aynı değildir; banka sözleşmesinin terimi aynen kaydedilir.
- 11 Ekim Pazar takası garanti edilmiyorsa sonraki uygun tarih alınır. **12 Ekim tahsilat** burada yalnız örnek alternatiftir, bütün bankalar için doğrulanmış kural değildir.
- AP'nin hukuki vadesi, planlı ödeme zamanı ve fiilî ödeme zamanı ayrı alanlardır. Vade günü değişmesi sözleşmesel ödeme yetkisi vermez; planı kendiliğinden hafta sonundan kaydırmayız.
- Aynı gün 09:00 ödeme, 17:00 kart takası varsa gün sonu pozitifken gün içi açık olabilir. Saatlik/olay sıralı hesap gerekir. Saat bilinmiyorsa stres hesabında çıkışı önce, girişi sonra yerleştirme veya “saat teyitsiz” uyarısı önerilir.
- Gerçekleşen takas snapshot'a taşındığında beklenen takas listesinden çıkarılır. Tarih ve snapshot taşınmadan hem bankada hem gelecekte sayılmaz.

## 4. Kart komisyonunu nasıl modellemeliyiz?

### 4.1 Banka/POS bazlı sözleşme profili

Her profil için hedef alanlar:

| Alan grubu | Alanlar | Doğrulama kanıtı |
|---|---|---|
| Kimlik/scope | tenant, hukuki firma, istasyon, merchant, POS terminal, acquirer/banka, settlement banka hesabı, TRY/diğer para | Sözleşme ve sağlayıcı terminal listesi |
| İşlem kategorisi | debit/credit, tek çekim/taksit, kart türü/işlem kategorisi; yalnız tarifede ayrım varsa | Gerçek tarife ve takas satırı |
| Ücret | yüzdesel oran, sabit işlem ücreti, min/max ücret, sabit aylık ücret | Tarihli sözleşme; ekstre kesintisi |
| Nakit kesinti zamanı | net takasta kesinti / ayrı tarihte hesap borçlandırma / dönem sonu fatura | Gerçek settlement ve fee kayıtları |
| Valör | takvim/iş günü, T+N, cutoff, time zone, özel takvim, erken/blokeli ödeme seçeneği | Sağlayıcı şartları; gerçekleşmiş batch örneği |
| Bloke | rezerv yüzdesi/tutarı, release zamanı, chargeback/iade mahsup | Bloke ve release kayıtları |
| Tarihsel geçerlilik | valid_from/valid_to, sürüm, onaylayan, kaynak belge/hash | Muhasebe onay kaydı |
| Vergi/diğer kesinti | kalemin türü, esası, dahil/hariç, sağlayıcının bildirdiği tutar | Sözleşme ve kesinti belgesi; oran uydurulmaz |

Yüzdeler bütün bankalara aynı kabul edilmez. Bir profil eksikse “%2 varsayılanla kesin tahmin” değil **COMMISSION_PROFILE_MISSING** risk etiketi gerekir. Bilinmeyen kesinti sıfır kabul edilmemeli; ayrı varsayım aralığı ve kaynak güveni gösterilmeli.

### 4.2 Hesaplama ve işaretler

Önce doğrulanmış satış/iade ile batch brütünü oluştur:

`batch_gross = approved_capture − linked_refund_or_void`

İade batch içinde mahsup edilmişse ayrıca ikinci nakit çıkışı olarak düşülmez. Ayrı banka borçlandırması ise kendi value-date'inde çıkıştır.

Yüzdesel/sabit ücret sözleşmenin tarifesine göre:

`fee = eligible_base × rate + per_transaction_fee × eligible_count + other_verified_fees`

`net_settlement = settling_gross − fee_withheld − reserved_amount − other_verified_deductions`

Bazı sözleşmeler ücreti ayrı tarihte keser: o zaman takas günü brüt para, ücret günü ayrı çıkış vardır. **Hem net takasa gömülü hem ayrıca gider nakit çıkışı şeklinde ikinci kez düşülmez.** Muhasebe gider tanıma tarihi ile banka nakit kesinti tarihi farklı olabilir.

Blokeli alacak için expected_release_date ayrı olmalı; reserve'a henüz ulaşmayan ücret mahsup esası sözleşmeden doğrulanır. V1.8 %20 bloke senaryosu sadece o hafta çözülen %80 için %2 ücret varsayar.

**Yuvarlama:** v1.7 yüzdeyi bütün 61.000 TL aggregate üzerinden hesaplar. Gerçekte işlem başına mı batch başına mı yuvarlandığı sağlayıcıyla doğrulanır. V1.8 betiği integer minor TRY ve ROUND_HALF_UP kullanır; banka kuralına uyumluluk iddiası değildir.

### 4.3 Komisyon duyarlılığı

| Oran (duyarlılık) | 61.000 TL üzerinden ücret | Net takas | Baz en düşük bakiye |
|---|---:|---:|---:|
| %1 | 610,00 TL | 60.390,00 TL | 27.640,00 TL |
| %2 | 1.220,00 TL | 59.780,00 TL | 27.030,00 TL |
| %3 | 1.830,00 TL | 59.170,00 TL | 26.420,00 TL |
| %4 | 2.440,00 TL | 58.560,00 TL | 25.810,00 TL |

%2'den %3'e bir **yüzde puan** artış neti 610 TL azaltır. Bu oranlar gerçek bankalardan alınmadı; mevcut demo üzerinde duyarlılık aralığıdır. Erken ödeme alternatifi varsa ücret kadar nakit ihtiyacının tarihi, kullanılacak banka hesabı ve onaylı finansman seçenekleri de karşılaştırılır; otomatik seçim yapılmaz.

## 5. Valör/tahsilat/bloke stresleri

Örnek nakit tamponu **20.000 TL firma toplamı**; işletme tarafından henüz onaylanmış bir politika değildir. Tampon açıkları ek finansman taahhüdü değil ihtiyaç hesabıdır.

| Senaryo | En düşük 7 günlük bakiye | İlk negatif gün | 20.000 TL tampon eksikliği |
|---|---:|---|---:|
| V1.7 baz | 27.030,00 TL | Yok | 0,00 TL |
| Kart 12 Ekim (D2) | 27.030,00 TL | Yok | 0,00 TL |
| Kart + gecikmiş AP 12 Ekim (ayrı ödeme varsayımı) | 27.030,00 TL | Yok | 0,00 TL |
| Kart 14 Ekim (D4) | −29.750,00 TL | 13 Ekim | 49.750,00 TL |
| Kart ufuk dışında | −32.750,00 TL | 13 Ekim | 52.750,00 TL |
| AR %50 ufuk dışı | −21.470,00 TL | 13 Ekim | 41.470,00 TL |
| AR tamamen ufuk dışı | −69.970,00 TL | 13 Ekim | 89.970,00 TL |
| Baz + 25.000 TL PO | 2.030,00 TL | Yok | 17.970,00 TL |
| Kartın %20'si blokeli | 15.074,00 TL | Yok | 4.926,00 TL |
| Açılışın 30.000 TL'si erişilemez | −2.970,00 TL | 14 Ekim | 22.970,00 TL |
| İlk gün 5.000 TL ayrı nakit iade | 22.030,00 TL | Yok | 0,00 TL |
| Birleşik: kart D4, %3 ücret, AR %50, +25.000 PO | −103.250,00 TL | 13 Ekim | 123.250,00 TL |

Birleşik senaryoda 17 Ekim kapanışı −47.080 TL'dir; minimum −103.250 TL, kart gelmeden önce oluşur. **Hafta sonu bakiyesi, hafta içi finansman ihtiyacını ölçmez.**

### Karar eşikleri — yalnız bu demo için

- Baz kart zamanında, AP/gider aynı ve başka para girişi yoksa negatif kapanıştan kaçınmak için 97.000 TL AR'nin en az **%72,13'ünün** ufuk içinde tahsil edilmesi gerekir.
- 20.000 TL tampon için en az **%92,75** gerekir. Kesin tahsilat değil; aynı tarihlendirme varsayımı altında break-even hesabıdır.
- Kart gecikirse bu oranlar değişir; aynı gün içindeki sıralama ayrıca incelenir.
- Tampon korunurken yeni nakit ödeme alanı **7.030 TL**. 25.000 TL PO'nun ödeme vadesi daha ileri olabilir: bugün borç/limit riskine girmesi, bugün nakit çıkışı olduğu anlamına gelmez. Gerçek PO payment_schedule esastır.

## 6. İstasyon/hesap bazlı kontrol

| İstasyon | Baz en düşük bakiye | Yorum |
|---|---:|---|
| S01 | 32.450,00 TL | Pozitif |
| S02 | 8.250,00 TL | Pozitif; station buffer ayrı belirlenmeli |
| S03 | 3.050,00 TL | Düşük boşluk |
| S04 | −4.230,00 TL | Açık |
| S05 | −12.490,00 TL | Açık |

Firma toplamı +27.030 TL olabilirken S04/S05'in kendi ödemesi karşılanmaz. Gerçek hesapların ortak mı ayrı mı olduğu ve ödeme yetkisi doğrulanmalı. İzinli transfer planlanırsa kaynak hesapta çıkış/hedefte giriş aynı transfer ID'siyle tutulur; firma içi konsolidasyonda net etkisi sıfırdır. Para erişilebilir olmadan transfer gerçekleşti sayılmaz. Farklı hukuki firmalar arası para otomatik netleştirilmez.

## 7. Pilot model kabul ölçütleri

- Kasa sayımında float/teslim edilen nakit/kasadan bankaya transfer ayrımı, banka available balance ve blocked balance doğrulanmış.
- Her POS batch'inde source ID, brüt, net, fee, value-date, status ve related settlement tekil.
- %2 hard-code kaldırılmış, tarihli banka/POS profiliyle fiyat/valör seçimi uygulanmış.
- Kart iadesi, chargeback, reserve/release ve ayrı ücret çıkışında çifte sayım yok.
- AR/AP planlı tarih, vade ve gerçekleşme ayrı; bilinmeyen tarih açık kalite riski.
- 7/14/30 günlük pencere, saatlik yakın dönem, en düşük bakiye ve ilk açık günü hesaplanıyor.
- Firma toplamı yanında banka hesabı/istasyon minimumu ve transfer sınırlaması görünüyor.
- Tampon ve risk onayı yapılandırılmış; sistem kendi kredi/ödeme/sipariş işlemi başlatmıyor.
- Eksik kaynak veya eski snapshot'ta karar kapısı fail-closed; tahmin ile gerçekleşen ayrı.
- Gerçek banka/POS örnekleriyle net tahsilat/komisyon eşleşmesi kabul kanıtı var.

## 8. Dosyalar ve doğrulama

- [15 senaryonun günlük nakit satırları — CSV](likidite-v1.8-gunluk-senaryolar.csv): 105 satır, integer minor TRY, her kalemde günlük açılış/giriş/çıkış/kapanış.
- [Hesap özeti — JSON](likidite-v1.8-hesap-ozeti.json): minimumlar, tampon ihtiyacı, station bazları ve eşikler.
- [Tekrarlanabilir senaryo betiği](likidite-v1.8-senaryo-hesaplari.py): dış veri/API veya ödeme çağırmaz; iki hesap çıktısını yeniden yazar.
- [Pilot checklist ve risk azaltımı](pilot-v1.8-canliya-gecis-kontrol-risk-plani.md).

Baz, AR yarı tahsilat ve PO rakamları v1.7 ile birebir doğrulandı; komisyon farkı, valör ilk açık günü, %20 bloke ve istasyon toplamı kontrolleri geçti. Bu rapor veri doğruluğu veya banka sözleşmesi doğrulaması değildir. **Prototip bu görevde değiştirilmedi; bulgular v1.8 uygulama gereksinimleridir.**

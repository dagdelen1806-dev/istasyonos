# AKARYAKIT V1 — v1.7 Raporlama, Finans ve Olay Testleri

**Tarih:** 10 Ekim 2026. [Önceki v1.6 tasarım](tasarim-v1.6-yonetici-muhasebe-risk-prototip.md) korunur. [Tek HTML prototipi](ui-wireframe-v1.4.html) dosya adını değiştirmeden v1.7 olarak genişletildi. **15 ekran**: önceki 12 ekran + raporlama + operasyonel finans + likidite.

Bu sürüm bir gösterim prototipidir. Rapor kaynağı JavaScript içindeki sentetik fixture'dır; gerçek banka, Turpak, ÖKC, OCR, e-belge, LLM, mobil login veya canlı PostgreSQL bağlantısı içermez. API bağlantısızlığı gizlenmez. Rol seçicisi yalnız demodur.

## 1. Raporlama modülü

Filtreler: izinli firma, istasyon, FUEL/MARKET/konsolide, başlangıç–bitiş tarihi. Demo tarih aralığı 4–10 Ekim 2026. Kullanıcı seçimine göre aynı kayıt setinden KPI, istasyon grafiği, günlük tablo, detay ve CSV üretilir.

| KPI | Tanım / veri soyu | Veri zamanı |
|---|---|---|
| Net satış | İade/iskonto sonrası, KDV hariç satış satırları toplamı | Filtrelenen dönem |
| Satılan mal maliyeti (SMM) | Satılan adet/litre maliyet snapshot'ı; alım faturası toplamı değildir | Satış dönemine ait maliyet |
| Brüt kâr | Net satış − SMM | Aynı dönem |
| Brüt marj | Brüt kâr / net satış; sıfır satışta N/M | Aynı dönem |
| Stok maliyet değeri | Elde sağlam adet/litre × seçili maliyet yöntemi; demo değeri fixture'dır | 10 Ekim anlık bakiye |
| Kritik ürün/alan | Kritik risk ürün satırı sayısı; dönem günleri boyunca toplanmaz | Snapshot |
| Kaynak güncelliği | Kaynak zaman damgası/watermark ve completeness | Her kaynakta ayrı |

**Güncellik:** Eski kaynak senaryosu değerleri taslak olarak işaretler. Demo “güncel işaretle” aksiyonu gerçek kaynaktan veri çekmez. Üretimde sadece timestamp yenilemek yeterli değildir: checksum, source event cursor, eksik interval kontrolü ve gerçek kaynak response gerekir. Rapor revision ve snapshot_id export'a eklenmelidir.

**CSV:** Filtrelenmiş sentetik satırlar indirilir, tutarlar integer minor TRY ve sütun adında birimle gelir. Görülen istasyon dışında veri export edilmez. Gerçek XLSX/Excel formül injection önlemi string alanlarına uygulanmalıdır.

## 2. Operasyonel finans modülü

KDV hariç satış/maliyet/gider esaslı operasyonel katkı ile brüt ödeme tutarı esaslı cari bakiyeler ayrı gösterilir.

`operasyonel_katki = net_satis − SMM − dogrudan_isletme_gideri`

Bu metrik **net kâr veya EBITDA değildir**. Finansman, amortisman, kurumlar vergisi, ortak gider dağıtımları ve tüm muhasebe düzeltmeleri bu demoda yoktur. Gerçek finans analizinde kaynak ve dağıtım politikası ayrı fazda genişletilir.

- Kâr köprüsü: net satış → SMM → brüt kâr → işletme gideri → operasyonel katkı.
- AR/AP yaşlandırması: güncel/ileri vade, 1–7, 8–30, 31+ gün gecikmiş. Vade günü geçmiş sayılmaz; `due_date < as_of_date` koşulu.
- Firma/istasyon mali snapshot'ı satış döneminden ayrıdır. Demo cari verisi FUEL/MARKET dağıtımı içermediğinden alan filtresi cari toplamını filtreliyormuş gibi davranmaz; ekranda açıkça yazılır.
- Tam muhasebe entegrasyonunda satırların hukuki firma snapshot'ı, para birimi ve kaynak referansı tekil tutulur. Aynı merkez fatura farklı istasyonlara kopyalanıp tekrar sayılmaz.

## 3. Yedi günlük likidite modülü

**Snapshot:** 10 Ekim 2026. **Tahmin:** 11–17 Ekim. İşlem kayıt zamanı değil beklenen ödeme/tahsilat günü esas alınır.

`kullanilabilir_acilis = sayilmis_kasa + banka − dokunulmaz_float`

`gun_sonu_tahmin = acilis + kart_net_takas + beklenen_AR − AP_odeme − nakit_gider − yeni_PO_senaryosu`

- Bekleyen kart alacağı: bankaya geçmemiştir; açılış kasası/bankasına dahil edilmez.
- Kart tahmini komisyonu: **demo %2 varsayımı**. Banka takası simüle edilirse kart alacağı düşer, net para bankaya eklenir, aynı kart tekrar tahminde yer almaz.
- Bekleyen IBAN: banka doğrulaması yoksa açılışa ve tahmin tahsilatına dahil edilmez. Eşleme demo olayıyla banka artar, bekleyen IBAN azalır; satış ikinci kez artmaz.
- AR tahmin: demo gecikmiş ve 12 Ekim vadeli bütün alacağın 12 Ekim'de tahsil edildiği varsayılır. Gerçek alacak listesinde ayrı tahsil beklenti tarihleri/olasılıkları gerekir.
- AP gecikmiş tutar: demo ilk tahmin gününde ödenir; 13 Ekim vadeli ödeme kendi gününde yer alır.
- Gelecekteki yeni satışlar/kasaya para girişleri bu muhafazakâr demo tahminine eklenmedi.
- Yeni PO: 25.000 TL **firma toplamı**, 13 Ekim senaryosu; gönderim/ödeme yaratmaz.
- Negatif sonuç likidite açığı uyarısıdır; gerçek eksi kasa hareketi veya otomatik kredi çekimi değildir.

### Senaryolar

| Senaryo | Varsayım | Firma toplamı en düşük 7 günlük tahmin |
|---|---|---:|
| Baz | AR'nin tamamı 12 Ekim'de, kart neti 11 Ekim'de | 27.030,00 TL |
| Tahsilat gecikmesi | AR'nin %50'si ufuk dışında | −21.470,00 TL |
| Baz + yeni PO | 13 Ekim'de ilave 25.000 TL ödeme | 2.030,00 TL |

Üçü de geleceğe dönük **sentetik tahmin**; banka/muhasebe gerçekleri değildir. Bekleyen IBAN eşleme veya kart takası simülasyonu snapshot'ı değiştirir, tahmin de yeni snapshot üzerinden yenilenir.

## 4. Demo veri seti ve bağımsız aritmetik

**Firma:** F01, “Kuzey Akaryakıt A.Ş.” adlı kurgusal kayıt. Merkez, Kuzey, Güney, Doğu, Batı adlı beş istasyon. Borsa/gerçek tüzel kişi araştırması yapılmadı; bu isim hukuki veri kaynağı değildir.

Fixture kaynakları: prototipte `reportInputs`, `dailyRows`, `stocks`, `agingRows`, `wallet`. Para minor TRY. Satış döneminde akaryakıt SMM oranı %95, market %72 sadece demo sürücüsüdür; gerçek istasyon marjı iddiası yoktur. Maliyet/gider bütün ara hesaplarda integer minor olarak tutulur.

| Hesap | 4–10 Ekim beş istasyon demo toplamı |
|---|---:|
| KDV hariç net satış | 4.966.500,00 TL |
| Satılan mal maliyeti | 4.614.330,00 TL |
| Brüt kâr | 352.170,00 TL |
| İşletme gideri | 26.950,00 TL |
| Operasyonel katkı | 325.220,00 TL |
| Katkı marjı | %6,55 |

Likidite girişleri: kullanılabilir kasa+banka 125.500 TL; bekleyen kart 61.000 TL (net %98 = 59.780 TL); AR beklentisi 97.000 TL; AP gecikmiş+7 gün 250.000 TL; nakit işletme gideri gün başına 750 TL. Bunlar raporlama dönemi gelirinin ödeme dağılımı değildir: ayrı bilanço/tahmin snapshot'ıdır. Kasa+banka satış dönemine zorla bağlanmaz.

## 5. Rol kapsamı ve yetkiler

| Demo rolü | Raporlama | Katkı analizi | Cari/banka/likidite |
|---|---|---|---|
| MK istasyon yöneticisi | S02 | S02 özet | Firma mali detayı kapalı |
| EZ muhasebeci | F01'in beş istasyonu | İzinli firma | Beş istasyon firma kapsamı |
| ZY firma yöneticisi | F01'in beş istasyonu | İzinli firma | Beş istasyon firma kapsamı |
| AY satış personeli | Yetkili rapor yok | Yetkili analiz yok | Kapalı |

Kullanıcı/rol kurulum formunun yeni demo atamaları bu sabit kimliklerin izinlerini değiştirmez. Bu sınır kullanıcıya görünürdür. Üretimde tüm rapor, export, aggregate ve drilldown endpoint'leri aynı backend scope politikasını kullanmalıdır; HTML rol kontrolü güvenlik sınırı değildir.

## 6. Gerçek zamanlı SQL test yaklaşımı

İstenen “gerçek zamanlı” testin burada karşılığı **satış/mal kabul/teslim erteleme/fatura/ödeme olaylarıyla test verisinin değişmesi ve aynı sorgunun yeniden çalıştırılmasıdır**. Canlı işletme API erişimi yoktur.

Hedef: salt-okunur risk sorgularıyla aynı tutar esası ve güncel snapshot okunur. Sipariş rezervasyonu/onayı gibi yazan işlemler ayrı servis transaction'ında ortak company_supplier_account kaydını kilitler, exposure'ı yeniden hesaplar, PO taahhüdünü yazar. Sadece önce sorgu sonra PO yazımı yapılması eşzamanlı iki kişinin limiti aşmasını önlemez.

Olay testleri tamamlandı: sonuçlar bölüm 9 ve bağlı test raporunda yer alır. Üretim concurrency garantisi ancak tüm writers aynı kilit ve idempotency protokolüne uyarsa geçerlidir. Periyodik otomasyon veya şart izleyicisi bu görevde kurulmadı.

## 7. Sunum ve pilot

[Yönetim kurulu sunum senaryosu](yonetim-kurulu-sunum-senaryosu-v1.7.md): 15 dakika anlatım ve tarayıcı demo akışı, beklenen soru-cevap, karar tutanağı. PPTX/slayt oluşturulmadı; istenen sunum senaryosu Markdown anlatım belgesidir.

Pilot önerisi değişmez: tek firma/istasyon, ayrı saha yöneticisi/muhasebe, gerçek kaynak formatlarını doğrulama, fotoğraf/OCR'yi insan onaylı kanıt olarak konumlandırma, sonra beş istasyon konsolidasyonu.

## 8. Ön kontrol sonucu

23 yeni tarayıcı kontrolü başarılı: 15 ekran, beş istasyon konsolidasyonu, tarih/alan/istasyon filtreleri, kayıt detayına geçiş, CSV birimi/filtre tutarlılığı, katkı hesabı, cari alan etiketi, eski kaynak uyarısı, rol kapsamları, yedi gün likidite, kart ve IBAN idempotent demo olayları, tahsilat stresinde nakit açığı, yeni PO'nun doğru günü, finans olaylarının satış toplamını artırmaması, 390 px mobil taşma ve JS çalışma hatası kontrolü.

Bu, gerçek mobil OCR veya üretim backend/DB yük testi değildir. Son kalite kontrolü ve olay SQL sonuçları aşağıya eklenecek.

## 9. Nihai doğrulama — 10 Ekim 2026

**SQL olay testleri: 19/19 başarılı, 0 başarısız.** Gerçek motor PostgreSQL 16.15; her çalıştırmada tek kullanımlık `pg_virtualenv` veritabanı kullanıldı, çalışma sonunda kaldırıldı. Canlı finans/stok verisine dokunulmadı.

- [Olay → SQL → beklenen → gözlenen test raporu](test-v1.7-stok-cari-sonuclari.md)
- [Tekrarlanabilir olay testi betiği](test-v1.7-stok-cari-olaylar.py)
- [Testlerin kullandığı risk SQL sorguları](queries-v1.6-stockout-supplier-risk.sql)

Betik proje klasöründeki v1.4/v1.5 SQL dosyalarını ve v1.6 risk sorgularını okur; `/tmp` içindeki eski betiklere bağımlı değildir. Bağımlılıklar Python `psycopg`, PostgreSQL ve `pg_virtualenv`'dir. Çalıştırma:

```bash
PGUSER=postgres pg_virtualenv python3 test-v1.7-stok-cari-olaylar.py --allow-demo-schema
```

Boş olmayan uygulama şeması veya geçici cluster dışında çalıştırma reddedilir. Çalıştırma aynı sonuç raporunu yeniden yazar. Bu test runner'ı üretim ortamında kullanmayın; belgelediği transaction yaklaşımı üretim servisine ayrı uygulanmalıdır.

**Doğrulanan olaylar:** satışla stok düşümü ve risk artışı, yeni satış ID'siyle aynı source-event reddi, mükerrer satış/mal kabulünde stokun tekrar etkilenmemesi, erken teslim ve erteleme, mal kabulde fizikî stok/açık sipariş tekilleşmesi, AP ve unbilled'ın tek transaction'da güncellenmesi, demo ödeme projeksiyonu, saat bazlı eski snapshot uyarısı, para birimi/NULL maliyet/net-brüt/eksik AP gates, iki eşzamanlı sipariş için ortak cari satırı kilidi.

**Concurrency örneği:** 1.000 minor TRY limitte iki ayrı 700 minor TRY talebi yarışır; ortak firma cari satırı `FOR UPDATE` kilitlenip exposure yeniden hesaplandığında biri kabul, biri red oldu. Bu küçük test bir ölçek/yük benchmark'ı değildir. Üretimde bütün PO/AP/limit writers aynı scope/kilit/idempotency düzenine uymalıdır.

**Tarayıcı:** 23 yeni rapor/finans kontrolü + 27 önceki kurulum/rol/vardiya/OCR akışı regresyon kontrolü başarılı. Bağımsız salt-okunur hesap/rol incelemesinde mevcut sentetik fixture'da kritik bulgu yok. Boş üretim verisinin sıfır satışla karıştırılmaması için completeness alanları eklenmesi uygulama gereğidir.

**Önizleme:** yerel ve dış HTTP 200 ile kontrol edildi; kalıcı yayın değildir. [Raporlama ekran görüntüsü](prototip-v1.7-raporlama.png) ve [likidite stres ekranı](prototip-v1.7-likidite.png) mevcut prototipten alınmıştır.

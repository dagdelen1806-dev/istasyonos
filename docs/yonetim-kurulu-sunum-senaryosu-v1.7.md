# AKARYAKIT V1 — Yönetim Kurulu Sunum Senaryosu

**Referans:** v1.6 prototipi ve v1.7 raporlama/finans genişlemesi. **Tarih:** 10 Ekim 2026. **Format:** 15 dakikalık anlatım ve tarayıcı demosu; bu belge PowerPoint veya slayt dosyası değildir.

## Amaç ve istenen karar

Bir firma/istasyonda kontrollü pilot kapsamını, saha ve muhasebe süreç sahiplerini ve veri erişimi çalışmalarını karara bağlamak. Bu sunum bütçe, mevzuat uygunluğu, tedarikçi API erişimi veya canlıya geçiş için verilmiş bir taahhüt değildir. Yatırım geri dönüşü/tasarruf yüzdesi gerçek saha verisi olmadan sunulmaz.

**Ana mesaj:** Satış, kanıt, tahsilat ve yetkili kararını aynı yerde görebiliriz; fakat bunlar aynı kayıt değildir. Patron ekranı gelir kadar stok, cari yük ve nakit riskini de göstermelidir.

## Açılıştan önce

- Prototipi yeni sekmede aç, demo sıfırla. ZY firma yöneticisi kimliğini seç.
- Kamera/OCR, Turpak, YN ÖKC ve banka entegrasyonlarının sentetik olduğunu açıkça söyle.
- Rapor dönemi: 4–10 Ekim 2026, para birimi TRY. Kârlılık değerleri KDV hariç; AP, AR ve tahsilat bakiyeleri ödeme tutarı esasındadır.
- Bir sekme Onay Kuyruğu, diğeri Raporlama/Likidite için hazır tutulabilir. Aynı sekmenin belleği ayrı sekmeyle senkron değildir.
- İnternet kesilirse indirilen tek HTML dosyası tarayıcıda açılabilir; gerçek veri bağlantısı yoktur. Demo değişiklikleri yenilemede sıfırlanır.

## 15 dakikalık akış

| Süre | Başlık / ekran | Anlatıcı metni | Gösterilecek işlem | Mesaj |
|---|---|---|---|---|
| 00:00–01:00 | İş problemi | “Bugün satış, slip, banka ve stok farklı ekranlarda izleniyor. Biz kararın hangi kanıta dayandığını birleştirmek istiyoruz.” | Ana menüyü göster; gerçek performans sayısı kullanma | Tek görünüm, ayrı doğrulama |
| 01:00–02:30 | Firma–istasyon / rol | “Hukuki firma, istasyon ve akaryakıt-market alanları ayrı. Yönetici olmak banka hareketini doğrulama yetkisi anlamına gelmiyor.” | Firma/istasyon ekranı ve yetki matrisi | Kapsam ve görev ayrımı |
| 02:30–04:30 | Personel vardiyası / OCR | “Personel kendi vardiyasına katılır. Her slip ayrı kanıttır. OCR önerir; kişi doğrular. Slip fotoğrafı banka tahsilatı değildir.” | AY → personel akışı → kapanış → slip → OCR kontrolü | İzlenebilir kanıt, insan kontrolü |
| 04:30–07:00 | Onay kuyruğu | “Eksik kaynağı gizlemiyoruz. İstisna kapanışına iki farklı kişi imza verir; kaynak tamamlanmış sayılmaz.” | MK → V101 → gerekçe → ilk imza; EZ → ikinci imza; V104 kendi talebi yasağı | Kontrollü istisna, değişmez geçmiş |
| 07:00–09:00 | Haftalık sipariş riski | “Yoldaki ürün var diye raf boşalmayacak diyemeyiz. İkinci gün stok biterken sevkiyat üçüncü gün geliyor.” | Sipariş Riski: 15 kullanılabilir adet / 10 günlük talep; limit aşımını göster | Teslimat zamanı + ortak cari risk |
| 09:00–11:00 | Raporlama | “Beş istasyonu aynı dönemde, aynı metrikle kıyaslıyoruz. Kaynak eksikse toplamı kesin sonuç gibi sunmuyoruz.” | ZY → beş istasyon → FUEL/MARKET ve tarih filtreleri; detay/CSV | Karşılaştırılabilir KPI ve kaynak güncelliği |
| 11:00–13:00 | Finans / likidite | “Kâr, eldeki para değildir. Kart alacağı bankaya geçmeden nakit sayılamaz. Önümüzdeki yedi günün ödeme riskini ayrıca görüyoruz.” | Finans analizi → kâr köprüsü; Likidite → tahsilat gecikmesi senaryosu, kart takası simülasyonu | Kâr/nakit ayrımı ve ödeme yükü |
| 13:00–14:00 | Teknik kanıt / sınırlar | “Şema ve sorgular geçici PostgreSQL’de test edildi. Gerçek API, saha donanımı ve üretim eşzamanlılığı için ayrı pilot gerekir.” | SQL test sonuç belgesinden doğrulanmış kontrolleri göster; sonucu ancak tamamlanmış rapordan oku | Prototip doğrulaması ≠ canlı sistem |
| 14:00–15:00 | Karar talebi | “İlk pilotu bir firmada, ayrı yönetici ve muhasebeci kimliğiyle yapalım. Süreç sahiplerini ve veri erişimini bugün belirleyelim.” | Pilot karar listesi | Sorumlusu ve ölçümü belli pilot |

## Sipariş riski anlatımı — sayısal örnek

“Ürün stoğu 18, rezerve 3; şimdi 15 adet satılabilir. Günlük tahmin 10 adettir. 30 adet sipariş üçüncü gün gelir. İkinci gün beş adet açık talep beklenir. Sistem önce mevcut siparişin hızlandırılmasını veya erken teslim edebilen alternatif toptancıyı önerir.”

“Firma ortak limitimiz demo olarak 100.000 TL. Açık borç 62.000, faturasız taahhüt 20.000 ve yeni öneri 25.000 TL. Öneri sonrası boşluk −7.000 TL. Aynı anda stok riski ve limit riski var. Ürünü gizlemek veya limiti kendiliğinden yükseltmek yerine muhasebe ve ticari risk onayı gerekir.”

Bu rakamlar işletmenin gerçek limiti/borcu değildir; kontrollü örnek girdilerdir.

## Canlı değişim gösterimi — aslında olay simülasyonu

1. Kaynak yaşını “eski” durumuna getir: rapor banner'ındaki uyarıyı göster. Güncel karar için kaynak yenilenmeli.
2. Likidite ekranında kart takasını bir kez simüle et: kart bekleyen alacak azalır, bankadaki para artar. Aynı olayı tekrar çalıştırınca ikinci para girişi oluşmaz.
3. Bekleyen IBAN örneğini eşleştir: doğrulanmış banka parası artar, bekleyen tutar azalır. Finansal satış geliri ikinci kez artmaz.
4. Tahsilat gecikmesi senaryosu: ödeme yükü değişmez; beklenen AR tahsilatının bir kısmı ufuk dışına çıkar. Nakit yetersizliği uyarısı oluşabilir.

**Sunumda kullanılacak doğru ifade:** “Demo olayını uyguluyorum.” “Banka hesabına canlı bağlandık” denmemeli.

## Beklenen yönetim kurulu soruları

| Soru | Önerilen yanıt |
|---|---|
| Bu yazılım çalışıyor mu? | Etkileşimli prototip ve örnek PostgreSQL şeması/sorguları var. Canlı saha sistemi henüz yok. |
| Turpak API erişimi olmazsa? | Yetkili veri dışa aktarımı önceliklidir. Fotoğraf/OCR geçici operasyon kanıtı olabilir; insan onayı ve kaynak etiketi gerekir. Mali cihazın resmî görevini ikame etmez. |
| Beş istasyon aynı şirkete ait olmak zorunda mı? | Panel sadece izinli firma/istasyonları gösterir. Ayrı hukuki firma borç/limit hesabı karıştırılmaz; konsolidasyon ayrıca yetkilendirilir. |
| Muhasebeci vardiyayı kapatabilir mi? | Varsayılan olarak banka/cari bileşenini inceler. Saha kapanış yetkisi ayrı izin/politikaya bağlıdır. |
| AI siparişi kendi gönderir mi? | Hayır. İhtiyacı ve riski açıklar, taslak üretir. Yetkili onayı, gerçek PO yaratımı ve gönderim ayrı adımlardır. |
| Gösterilen kâr gerçek muhasebe kârı mı? | Demo KDV hariç operasyonel katkı hesabıdır. Amortisman, vergi ve finansman tam kapsamda olmadığından net kâr/EBITDA iddiası yoktur. |
| Veri güvenliği nasıl olacak? | Tenant/firma/istasyon/alan kapsamı backend'de denetlenir, yetki ve karar audit'i tutulur. Demo rol seçicisi güvenli login değildir. |
| Ne kadar tasarruf sağlayacak? | Henüz ölçülmedi. Pilot öncesi ve sonrası kapanış süresi, manuel düzeltme, stokout ve mutabakat farklarını ölçerek raporlayacağız. |

## Pilot karar tutanağı taslağı

- [ ] Pilot firma ve istasyon belirlendi.
- [ ] Saha süreç sahibi ve muhasebe süreç sahibi atandı.
- [ ] Turpak/ÖKC sağlayıcısından dış arayüz, kaynak kimliği, test erişimi ve hata sözleşmesi istenecek kişi belirlendi.
- [ ] Banka/POS dosya kaynağı ve e-belge sağlayıcısı belirlendi.
- [ ] Cari limit brüt/net esası, teslimat teyidi ve stok maliyet yöntemi belirlendi.
- [ ] İki imza eşikleri ve istisna kapanış politikası onaylanacak süreç sahibi belirlendi.
- [ ] Başarı ölçümü: ilk kayıt–kapanış süresi, açık mutabakat vaka adedi/yaşı, stokout ürün-gün, cari veri güncelliği, mükerrer olay reddi ve personel kullanım oranı.
- [ ] Canlıya geçiş kararı pilot sonunda ayrıca verilecek; bugün üretim açılışı onaylanmış sayılmaz.

## Sunumda kaçınılacak iddialar

“Tam muhasebe hazır”, “GİB'e biz gönderiyoruz”, “Turpak API doğrulandı”, “tam kart verisi tutulur”, “iki imza eksik belgeyi geçerli kılar”, “tüm bekleyen kartlar nakit”, “yüzde X tasarruf” ve “üretim güvenliği tamamlandı” denmemelidir.

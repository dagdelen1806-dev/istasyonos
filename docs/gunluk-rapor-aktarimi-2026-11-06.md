# Günlük rapor aktarımı — ilk çalışan aşama

6 Kasım 2026: DEMO/test ortamında `/gunluk-rapor` ekranı eklendi.
Kullanıcının geliştirme boyunca örnek veri izni audit no. 262 ile
kaydedildi. Yeni kurulumda temiz veritabanı kullanılacak; mevcut veritabanı
sıfırlanmadı. İzin kapsamı `gunluk-rapor-demo-veri-onayi-2026-11-06.md`
belgesinde açıklanır.

## Çalışan akış

1. Yetkili kullanıcı ZIP seçer. En fazla 20 MB ZIP, 12 JPEG/PNG,
   fotoğraf başına 5 MB ve açılmış toplam 25 MB kabul edilir.
2. ZIP merkez/local kayıtları, CRC, içerik türü, sıkıştırma sınırları ve
   kaynak özetleri kontrol edilir. Şifreli, çok diskli, ZIP64, sembolik bağ,
   yürütülebilir/SVG ve güvensiz adlar reddedilir. Arşiv dosya sistemine
   açılmaz; görüntü baytları yeni kaynak tablolarında saklanır.
3. Aynı ZIP veya isim/sıra/sıkıştırması değiştirilmiş aynı fotoğraf seti,
   aynı istasyonda ikinci paket oluşturmaz. Mevcut paket kimliği döner;
   kullanıcıya bilgi verilir. Aynı requestId mevcut güvenli mekanizmayla
   önceki sonucu döndürür. Başka bir istasyonun paketi paylaşılmaz.
4. Paket ve sayfalar seçilip orijinal görüntüleri açılır. Görüntü sunulurken
   SHA-256 tekrar doğrulanır. Görüntü uçları oturum, rol, DEMO, firma ve
   istasyon kapsamıyla korunur; `no-store` ve `nosniff` uygulanır.
5. Vardiya referansı, başlangıç rapor günü ve sayfa türleri elle girilir.
   Satış/personel, tank çıkışı, kart, sayaç ve anlık ürün/net tank görüntüsü
   ayrı türlerdir. Sınıflandırılmamış sayfa varken veya kaynak teyit edilmeden
   `REVIEWED_DRAFT` kararı kaydedilemez.
6. İncelemeler revizyon kontrolüyle eklenir; eski inceleme satırı güncellenmez.
   Bekleyen ve reddedilen taslaklar da korunur. Bu karar kaynak paketinin
   incelendiğini belirtir; mali iş onayı veya stok düzeltmesi değildir.

Akaryakıt personeli kaynak yükleyip görüntüleyebilir. Kaynak taslağı
incelemesini firma sahibi, yönetici veya muhasebeci kaydeder. Mevcut çift
onay, vardiya kapanışları, mali kayıt kilitleri ve stok yazımları değişmedi.

## Örnek veri ve doğrulama

- Kullanıcının ZIP'indeki beş gerçek fotoğraf DEMO kaynak paketi olarak
  saklandı; sayfalar sınıflandırıldı. Vardiya referansı ve rapor günü taslağa
  işlendi; karar **PENDING**, kullanıcı doğrulaması bekliyor.
- Özel rapor tutarları, müşteri/personel adları veya kaynak görüntüler
  bu belgeye/test dosyalarına eklenmedi. Özel artefaktlar `.local/daily-report/`.
- Ayrı sentetik paketler API ve gerçek tarayıcı testlerinde kullanıldı.
- 402 test, ana uygulama ve test TypeScript kontrolleri başarılı.
  Tarih regresyon testleri üç saat diliminde geçti.
- Derleme başarılı. Mevcut klasik script ve paket boyutu uyarıları sürüyor.
- Gerçek HTTPS API: oturum/rol/istasyon izolasyonu, görüntü özeti,
  aynı ZIP ve yeniden paketleme, requestId tekrarı, eksik kaynak teyidi,
  yabancı sayfa ve eski revizyon kontrolleri başarılı.
- Gerçek Chrome: dosya seçiciden ZIP yükleme, PNG/JPEG önizleme,
  taslak formu, tekrar yükleme bildirimi, 390px mobil ve JavaScript hata
  kontrolleri başarılı. Eksik sayfa rotası testte bulundu ve düzeltildi.
- Dokuz mevcut stok/mali tablonun satır sayısı ve özetleri değişmedi.
  Gerçek tank fotoğrafı taslakları da korunuyor. Aksan vhost SHA-256 aynı.
- `0013_daily_report_drafts` mevcut migration güvenlik mekanizmasıyla
  yalnız yerel İstasyonOS test veritabanına uygulandı; önceki 13 migration
  değişmedi. Yeni tablolar paket, görüntü ve inceleme kaynaklarıdır.
- Node yalnız `127.0.0.1:3000` dinler; Apache/MySQL yeniden başlatılmadı.

## Sıradaki geliştirme

Bu aşama güvenli kaynak kabulü ve sınıflandırmasıdır. OCR, sayısal otomatik
okuma ve icmale satış/stok aktarımı henüz etkin değildir. Paket listesi
istasyon başına 100 kayıtla sınırlıdır; aşımda sessiz kırpma yerine arşiv
filtresi gerektiği bildirilir. Tam/eksiksiz günlük rapor kontrolü sayfa
sayısından otomatik çıkarılmaz; kullanıcı kaynak teyidi gerekir.

Sonraki aşama, fotoğrafın yanında litre/tutar/sayaç değerlerini ayrı bir
sayısal taslakta doğrulamak ve mevcut vardiyayla karşılaştırmaktır.
Ürün−net, tank−pompa ve tahsilat farkları ayrı tutulacak; belirsiz kart
modelleri varsayılmayacak. Anlık ürün/net hacim için ayrıca Tank Durumu
fotoğrafı gerekir. Yeni kurulumda örnek veri taşınması veya otomatik seed
çalıştırılması eklenmedi.

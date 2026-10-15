# İstasyonOS — çalışan uygulama

## Uygulama yaklaşımı

Mevcut AKARYAKIT V1 planı uygulanır; eski `/home/ubuntu/projects/akaryakit-v1-37b46808/prototip-v2.0` korunur. Yeni yönetilen web uygulaması React/TypeScript + Express ve kalıcı MySQL veritabanı kullanır. Önceki PostgreSQL örnekleri doğrudan çalıştırılmaz; para/kapsam/transaction/tekillik iş kuralları MySQL migration'larına taşınır. OAuth gerçek Manus kimliğiyle çalışır; rol taklidi, herkese açık admin ve ilk ziyaretçiye global sahiplik yoktur. Doğrulanmış, henüz üyeliği olmayan kullanıcı yalnız kendi yeni ve yalıtılmış firma alanını açıkça oluşturabilir; diğer firmalara erişim kazanamaz ve global admin olmaz. Çalışanlar mevcut firma alanına süreli, tek kullanımlık rol/istasyon kapsamlı davetle katılır.

Firma/istasyon, kullanıcı daveti, vardiya/hesap, nakit/IBAN/borç/kart kanıtı, cari tahsilat, fizikî teslim, iki ayrı kişinin muhasebe onayı, stok ve adet satış, mal kabul, toptancı cari/vade ve sipariş önerisi, konsolide operasyon raporları aynı API/veritabanına bağlanır. Kullanıcı boş bir firma oluşturabilir; örnek çalışma alanı açıkça etiketlidir, gerçek işletme verisi diye sunulmaz. Tutarlar güvenli integer kuruş değerleriyle işlenir. Muhasebe imzası pending IBAN'ı doğrulanmış banka nakdine dönüştürmez; açık kalan kurum/kişi borcu alt defterde izlenir. Vardiya para üstü ve eski tahsilat cirodan ayrılır.

Haricî Turpak/YN ÖKC, banka, e-belge ve cloud OCR gerçek yetkili bağlantı olmadan kapalıdır. Kaynak toplamı yönetici tarafından manuel rapor referansıyla girilebilir; kaynak API diye gösterilmez. İlk sürümde slip görüntüsü upload'ı, maskeleme/KVKK sınırı üretim kabulü yokken kapalı; kart slipi alanları manuel teyitle girilir. Arayüz bunu açıklar. OCR servisi ayar kapısı ileride yetkili gerçek servise bağlanır. Kullanıcıya tamamlanmamış özellik çalışıyor diye sunulmaz. PWA statik offline bilgi ekranı sağlar, mali verileri cache veya offline posting yapmaz.

## Yapı

- `server/stationos/`: migration, SQL repository, transaction iş akışları, REST router ve domain testleri.
- `server/_core/`: korunan OAuth/oturum ve Express altyapısı.
- `client/src/pages/StationApp.tsx`, `client/src/components/stationos/`: modül ekranları ve ortak form/özet bileşenleri.
- `client/src/lib/station-api.ts`: oturum taşıyan API, CSRF ve idempotent mutation.
- `client/public/`: PWA manifest/offline bilgi ve route listesi; gizli veri deposu değil.
- `shared/`: UI/API iş alanı sözleşmesi.

## Tasarım

Endüstriyel İsviçre operasyon konsolu: solda sabit koyu petrol yeşili ince navigasyon; beyaz/açık gri çalışma yüzeyi, yoğun fakat nefesli tablolar; mobilde panel kayar menüye dönüşür. Üç ilke: rakam önce, durum açık, her aksiyon izlenebilir. Marka rengi zümrüt/teal; teyitli işlem yeşil, pending amber, gerçek fark kırmızı. Signature öğeler: iki yükselen pompa sütunlu geometrik logotype, ince istasyon durum çizgisi, tabloların solunda durum noktası. Tipografi sistem sans (Inter mevcutsa, sistem fallback), tutarlarda tabular rakam; büyük KPI ve küçük uppercase bölüm indeksleri. Gereksiz görsel/fotoğraf yok. Animasyon 120–180 ms odak/panel geçişi; reduced-motion korunur. Marka: "Sahadan merkeze, her hesap izlenebilir." Net, güvenilir, kontrollü. CTA örnekleri: "Vardiya hesabımı aç", "Muhasebeye teslim et". Boş alanlarda neden ve sonraki aksiyon açıkça yazılır.

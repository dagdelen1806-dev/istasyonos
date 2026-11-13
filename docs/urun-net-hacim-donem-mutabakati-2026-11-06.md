# Ürün/net hacim ve dönem mutabakatı — 6 Kasım 2026

Yerel DEMO geliştirmesi tamamlandı. `/tanklar` ekranında seçilen tankın
ürün hacmi ve net hacmi birlikte, mililitre tamsayılarıyla saklanır.
Kaynak fotoğraf doğrulama ekranında `BOTH` seçeneği iki değeri ayrı korur.
Önceki tek hacim esaslı incelemeler değiştirilmedi.

## Fark kapatma davranışı

- Ham fark = ürün hacmi − net hacim; bu değer sıfırlanmaz.
- Dönem farkı = güncel ham fark − son bağımsız onaylı referans.
- İlk referans oluşmadan dönem farkı bilinmiyor gösterilir.
- Kullanıcı açıklama ve kanıtla kapatma talebi oluşturur. Firma sahibi veya
  muhasebeci, talebi oluşturan kişiden bağımsız olarak onaylar ya da reddeder.
- Onay dönem referansını yeniler; okuma ve kapanan fark geçmişi korunur.
- Yeni ölçüm, stok revizyonu veya referans değişmişse eski talep onaylanamaz.
  Reddedilen talebin yerine yeni okuma ve yeni talep gerekir.
- Fiziksel stok düzeltmesi mevcut bağımsız onaylı stok düzeltme işlemidir.
  Dönem kapatma stok, cari, tahsilat veya mali deftere yazmaz.

Örnek sentetik test: ürün 100 L, net 99 L → ham fark 1 L. İlk onaydan sonra
dönem farkı 0 L olur. Sonraki ürün 102 L / net 100 L → ham fark 2 L,
dönem farkı 1 L. İkinci bağımsız kapatma sonrası dönem farkı 0 L olur;
ham fark 2 L ve eski okumalar korunur.

## Günlük ZIP kaynağı

Kullanıcının verdiği ZIP salt okunur incelendi. Aynı vardiyaya ait beş JPEG
içeriyor: satış/personel özeti, tank çıkış/stok mutabakatı, kart ayrıntıları
ve iki sayaç sayfası. Kaynak görüntüler ve SHA-256 envanteri yalnız git dışında
`.local/daily-source-20261106/` altında tutuldu. Özel rapor tutarları ve
personel adları bu belgeye veya test fixture'larına alınmadı.

Bu set günlük doğrulamalı veri girişi için kullanılabilir. Ürün/net anlık
hacim çifti açıkça bulunmadığından ayrıca Tank Durumu görüntüsü gerekir.
Tankın önceki/son miktarı net hacim sayılmaz. Tank−pompa farkı ile ürün−net
farkı birbirine eklenmez veya aynı kapatma işlemiyle düzeltilmez.
LPG tank satırındaki sıfırlar doğrulanmış boş stok kabul edilmez.

Otomatik OCR, günlük ZIP yükleme ve canlı sensör bağlantısı bu geliştirmede
etkinleştirilmedi. Sonraki geliştirme, bu beş sayfayı vardiya kimliğiyle
eşleştiren, mükerrer belgeyi engelleyen ve kullanıcı teyidi isteyen günlük
rapor içe aktarma taslağıdır.

## Doğrulama

- 359 test geçti; UTC/tarih testleri üç saat diliminde tekrar geçti.
- Ana uygulama ve izole test TypeScript kontrolleri başarılı.
- Vite ve sunucu derlemesi başarılı; mevcut paket boyutu ve klasik script
  derleme uyarıları devam ediyor.
- Gerçek HTTPS API testleri: çift hacim, iki bağımsız dönem kapatma,
  öz onay/rol/istasyon sınırları, eski okuma, requestId tekrarı ve fotoğraf
  taslağında iki ayrı değerin saklanması başarılı.
- Gerçek Chrome: yönetici ölçüm/talep formu, başka kullanıcının onay formu,
  fotoğraf çift hacim görünümü, 390px mobil görünüm başarılı; JS hatası yok.
- Gerçek XLSX indirildi ve PDF üretildi. Çıktılara ürün/net okumaları ve
  dönem kapatma geçmişi eklendi; bu iki bölüm filtrelerden bağımsız güncel
  tank geçmişidir. Mevcut hareket defteri kendi tarih/vardiya filtresini korur.
- Dokuz mevcut stok/mali tablonun satır sayıları ve SHA-256 özetleri aynı.
  Gerçek kaynak fotoğrafın beş satırı inceleme onayı almadan korundu.
- `0012_dual_tank_volumes` mevcut güvenli migration motoruyla yalnız yerel
  İstasyonOS test veritabanına uygulandı. Önceki 12 migration değişmedi.
- Uygulama yalnız `127.0.0.1:3000` üzerinde çalışıyor. Apache/MySQL yeniden
  başlatılmadı; Aksan Muhasebe vhost özeti değişmedi.

Test artefaktları: `.local/dual-volumes/` (API/tarayıcı sonuçları, ekran
görüntüsü, XLSX/PDF ve test günlüğü). Şema eklemesi geçmiş stokları taşımaz;
yeni iş işlemleri DEMO ortamıyla sınırlandırılmıştır. Tam geçmiş raporu
1000 kayıtla sınırlıdır; sınır aşımında sessiz kırpma yerine hata verir.

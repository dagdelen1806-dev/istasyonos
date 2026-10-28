# Cari vade ve ödeme takvimi — 28 Ekim 2026

Raporlar → **Cari vade / ödeme takvimi**. OWNER, MANAGER ve ACCOUNTANT yalnız yetkili oldukları istasyonu okuyabilir. MARKET_STAFF ve başka firma erişimi engellenir. Yeni SQL migration yok; güncel uygulamanın 0021 dahil şeması yeterlidir.

## Çalışan kapsam

- Müşteri alacakları ve tedarikçi borçları ayrı gösterilir; BOTH carinin iki yönü otomatik mahsup edilmez.
- Açık tutar = belge toplamı − tahsisli ödeme/tahsilat − iade mahsubu. Sıfır kalan belge listelenmez. Kısmi ödeme, kaynak belgeli iade ve ödeme/tahsilat ters kaydı mevcut ortak mali işlemden okunur.
- Yaşlandırma: 1–7, 8–30, 31–60, 61–90, 91+ gün gecikmiş; bugün; 1–7, 8–30, 31–90, 91+ gün sonraki vadeler. Her belge yalnız bir dilimdedir. Bugün vadesi gelen gecikmiş sayılmaz. Tarihler İstanbul iş günüdür, takvim günü farkı kullanılır.
- Bugün ve sonraki 90 günün günlük alacak/borç takvimi. Boş günler API ve CSV'de sıfır olarak bulunur; ekranda yalnız belgeli günler görünür. Gecikmişler ve 90 günden sonrası ayrıca yaşlandırmada kalır.
- Cari ve yön filtreleri bütün toplam/yaşlandırma/takvim/listede geçerlidir. Belge filtresi (hepsi, gecikmiş, bugün, yarından itibaren 7/30/90 gün, bilinmeyen) yalnız belge listesini daraltır; kapsam ekranda ve CSV'de yazılıdır.
- 50 belgeli sayfalama, belge ayrıntısı; ayrı yaşlandırma/takvim ve görünen belge sayfası CSV. Henüz uygulanmamış form seçimi raporu veya CSV kapsamını değiştirmez.

## Veri doğruluğu ve sınırlar

Bu **güncel açık bakiye** raporudur. Geçmiş tarihe bugünkü ödenmiş tutar uygulanmaz; endpoint `from`, `to`, `asOf` tarih sorgularını reddeder. Geçmiş tarihli yaşlandırma sonraki geliştirmedir.

Mevcut belge şeması `due_date NOT NULL` tutar. Cari açılış belgelerine mevcut mali işlem açılış gününü kaydeder; rapor bu kayıtlı tarihi gösterir, eski borcun özgün vadesini bildiğini iddia etmez. Nullable tarih kaynağı ileride eklenirse bilinmeyen ayrı dilimdedir; gün/tarih tahmini yapılmaz. Açılış vadesini değiştirecek yeni yazma yolu eklenmedi. Kaynak tarihi geçersizse hata verir.

Güncel açık belge toplamı **her cari ve yön için gerçek mali defter satırlarıyla** karşılaştırılır; uyuşmazlıkta 409 ile durur. Sadece ekranın ilk 200 belgesinden veya bakiye önbelleğinden rapor kurulmaz. Paralar güvenli tam sayı kuruştur, taşma reddedilir. En fazla 5.000 cari / 10.000 açık belge; sınır aşılırsa eksik toplam yerine hata verir. Yaşlandırma/takvim bütün seçili cari/yön kapsamını kullanır.

Tek transaction içinde cari, açık belgeler ve defter okunur. Gün, defter revizyonu, cari adları ve belge içerikleri SHA-256 görüntü kimliğine dahildir. Devam sayfası aynı görüntüyü ister. Ödeme/iade/kart değişmişse 409; kullanıcı yeniler. Filtre dışında kalan cari verisindeki değişiklik de görüntüyü geçersiz kılabilir. Cari adları güncel karttır, tarihsel ad snapshotı değildir. GET mali fiş, bakiye, stok, revizyon veya kapanış yazmaz; kapalı günde de okunur.

Takvim kayıtlı yükümlülüklerin vadesidir, gerçekleşmiş banka hareketi veya kesin tahsilat değildir. Yeni gelir/gider, otomatik ödeme, banka talimatı, mesaj gönderimi veya cari mahsup oluşturmaz. Gerçek ödeme/tahsilat mevcut Market muhasebe akışında OWNER/ACCOUNTANT teyidiyle sürer. POS DEMO ve ortak erişilebilir sunucu/LAN sınırı korunur.

## Doğrulama

- TypeScript, 24 dosyada **150 test**, production build başarılı.
- `scripts/smoke-party-dues.ts`: yalnız `SMOKE_TEST=1`, loopback HTTP, tam `/istasyonos_pos_v2_test` DB ve yerel socket kabul eder. Ayrı DEMO istasyonu/ürünü/carileri kullanır; gerçek kullanıcı verisi kullanmaz. Kayıt ve oturum bilgileri özel çalışma alanındadır, Git'e dahil değildir.
- Geliştirme/üretim HTTP: 54 açık belge, 50+4 sayfa, bütün yaşlandırma toplamı, bugünün ayrı kalması, 7/30/90 sınırları, iki yönlü cari; gerçek kısmi ödeme/tam tahsilat/ters kayıt/kaynak belgeli alış iadesi; rol/tenant/401/tarih/filtre/imleç ve değişen görüntü. Sentetik belge tutarı bozulup geri yüklenerek defter farkının 409 olduğu doğrulandı. Kapalı günde stok/bakiye/revizyon/kapanış değişmedi.
- Geliştirme/üretim Chromium: masaüstü ve 390px yönetici, personel engeli, belge/filtre/ayrıntı, sayfalama, bekleyen formda doğru CSV, yaşlandırma/takvim CSV, değişen cari adıyla eski görüntü reddi ve yenileme. JS hatası, haricî HTTP isteği ve sayfa taşması yok. Mobil görüntü ayrıca görsel kontrol edildi.
- Fizikî Windows ve yük kabulü yapılmadı.

## Windows güncellemesi

Önce proje/DB yedeği ve eski dev işlemini durdurma; `.env` dosyanızı koruyarak GitHub `main` kaynaklarını güncelleyin:

```powershell
pnpm install --frozen-lockfile
pnpm tsx server/stationos/migrate.ts
pnpm dev
```

Bu özellik yeni migration eklemez. GitHub kaynaklarının güncellenmesi bilgisayardaki dosyaları kendiliğinden değiştirmez. Mevcut çalışan adresinizden Raporlar menüsünü açın.

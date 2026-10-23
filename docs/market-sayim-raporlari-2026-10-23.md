# Onaylanmış terminal sayım raporları — 23 Ekim 2026

**Market muhasebe → Sayım raporları**, el terminalinden onaylanarak `STOCK_COUNT` fişi oluşturulmuş sayımları listeler. Normal ve parti bazlı terminal sayımları dahildir. Açık/iptal taslaklar ile masaüstü Lot ve SKT ekranındaki tek parti sayımı veya fire bu raporun kapsamına girmez; bunlar kendi ekran ve stok hareketlerinde izlenir. Bu güncelleme yeni SQL göçü eklemez; mevcut `0017_terminal_lot_counts` dahil şema gerekir.

## Tarih ve tutarlar

Başlangıç/bitiş tarihleri Türkiye işlem gününe göre ve iki uç dahil uygulanır. En fazla 366 günlük aralık seçilebilir. Kayıt saati ayrıca UTC etiketiyle gösterilir. Tablo onay kayıt sırasına göre 50 satır sayfalanır. Yeni onay eklense bile sonraki sayfa imleci eski satırları kaydırmaz; yeni kayıtlar ilk sayfa yenilendiğinde görülür.

Dönem sayım adedi, stok fazlası, stok eksiği ve net etki seçili aralığın tamamını kapsar; yalnız görünen 50 satırın toplamı değildir. **Bu sayfayı CSV indir**, tablonun mevcut sayfasını dışarı aktarır. Kalan kayıtlar için sonraki sayfaya geçilir. Sıfır farkla onaylanmış ve mali fişinde tutarlı olarak hiç tutar satırı oluşmamış sayımlar da sayılır/listelenir.

Fazla ve eksik maliyeti, onaylanmış fişin `STOCK_GAIN` ve `STOCK_LOSS` satırlarından okunur. Net etki = fazla − eksik. Bunlar KDV hariç stok değer farklarıdır; satış, tahsilat veya resmî mali belge değildir. Net ürün adedi değişmese bile bir partide fazla, diğerinde eksik varsa iki mali etki ayrı gösterilir. Ürün satırlarındaki kayıtlı farkların mali toplamı fişle uyuşmuyorsa ayrıntı 409 hata verir; bugünkü stoktan yeni bir geçmiş rapor uydurulmaz. Liste özeti yine kayıtlı fiş tutarını gösterir; ayrıntı için veri incelemesi gerekir.

## Sayım ayrıntısı

**Sayım ayrıntısı** ile işlem tarihi, açıklama, onaylayan kişi/kimlik, fiş kimliği, onay cihazı, ürünün önceki/sonraki adedi, farkı ve net fazla/eksik maliyeti görülür. **Parti farkları** altında kaydedilmiş parti kodu, SKT, durum, adet farkı ve sayımı yapan kişi bulunur. Sadece sayılan partiler ayrıntıya girer; sayılmayan parti sıfır veya yeni bir kayıp sayılmaz.

Yeni onaylar ürün adı, ana barkod, temel birim, sayan kişinin kimliği ve cihazını da fişin sayım verisine kaydeder. Daha sonra ürün adı veya stok değişse bile bu etiket/adet/tutar anlık görüntüsü korunur. Eski kayıtlarda etiket saklanmamışsa **Güncel kart etiketi** uyarısıyla bugünkü ad/barkod gösterilir; kart bulunamazsa yalnız kayıtlı kimlik kullanılır. Eski miktar ve maliyetler güncel karttan hesaplanmaz. Eski sayan kişi/cihaz bilgisi varsa değiştirilemeyen tamamlanmış taslak satırından alınır. Hiç kaydedilmemiş bilgi tahmin edilmez.

Kişi adları hesapların güncel görünen adlarıdır; kaydedilmiş kullanıcı kimlikleri de gösterilir. Bir ürünün genel sayan alanı son ürün satırı toplayıcısını, parti ayrıntıları ise ilgili partinin toplayıcısını gösterir. Bu uygulama kaydı DB yöneticisine karşı sertifikalı değişmez denetim arşivi veya fizikî etiket doğrulaması değildir.

**Seçilen sayımı CSV indir**, ürün toplamlarını ve parti adetlerini farklı satır türleriyle dışarı aktarır. Mali tutarlar yalnız ürün satırında yer alır; parti satırlarında tekrar edilmez. Böylece Excel toplamında aynı maliyet iki kez sayılmaz. Mevcut CSV hücre koruması metinlerin formül olarak çalıştırılmasını engeller.

## Yetki ve salt okunur davranış

OWNER/MANAGER/ACCOUNTANT raporu okuyabilir. MARKET_STAFF/PURCHASER bu mali rapora erişemez; kendi el terminali sayım ekranındaki stok/maliyet gizleme kuralları devam eder. Her liste ve ayrıntı isteğinde tenant/istasyon yetkisi kontrol edilir. Başka istasyon/firmaya ait fiş kimliği doğrudan verilerek erişim kazanılamaz.

Rapor GET istekleri stok, mali fiş, önbellek bakiyesi, defter revizyonu, taslak veya kapanış kaydını değiştirmez. Kapalı günlerde de rapor okunabilir. Tarih değiştiğinde eski seçim/CSV temizlenir; önceki aralık veya ayrıntının geciken yanıtı yeni görünümü değiştiremez. Okuma için ayrı onay veya yeni mali kayıt açılmaz.

## Windows güncellemesi

Eski `pnpm dev` işlemini durdurun, proje/DB yedeğini alın, kendi `.env` dosyanızı koruyarak güncel GitHub `main` kaynaklarını aktarın:

```powershell
pnpm install --frozen-lockfile
pnpm tsx server/stationos/migrate.ts
pnpm dev
```

Bu sürümde yeni SQL göçü yoktur; göç komutu mevcut kurulumun 0017'ye kadar tamamlanmasını sağlar. Bulut kodlaması Windows dosyalarını otomatik güncellemez. Eski RAR/ZIP indirme dalı güncel kaynak yerine geçmez.

## Doğrulama

16 dosyada **81 birim/sözleşme testi**, TypeScript ve üretim derlemesi başarılı. Geçmiş normal sayım biçimi, net sıfır miktarda iki mali fark, sıfır maliyet/farksız onay, bozuk/tekrarlı kayıt, tutarsız parti miktarı ve güvenli kuruş sınırları birim testlerinde kapsandı.

`scripts/smoke-count-reports.ts`, yalnız `SMOKE_TEST=1`, loopback ve tam adı/socket yolu eşleşen ayrı `istasyonos_pos_v2_test` DB'sini kabul eder. Önce `scripts/smoke-terminal-lots.ts` ile `SMOKE_LEAVE_OPEN=1` kullanılarak yeni sentetik DEMO fixtürü hazırlanır; `SMOKE_COUNT_FIXTURE` bu dosyayı göstermelidir. Rapor testi, 51/52 gerçek onayla sayfalama için farksız sayımlar oluşturur; test şirketinin gününü kapatır. Bu veri kurulumunu gerçek şirkette çalıştırmayın. Eski etiketsiz ve tutarsız kayıt senaryoları yalnız bu özel test kayıtlarında geçici DB değişikliğiyle sınanır ve kaynak kayıtlar geri konur.

Geliştirme/üretim HTTP kontrolleri gerçek onaydan rapor, sonradan değişen stok/maliyet/kart etiketi, eski biçim/kişi-cihaz bilgisi, fiş mutabakatı, rol/tenant, bozuk imleç/tarih, farksız mali fiş, araya yeni onay eklenirken sayfalama ve tekrarlanan kapalı gün GET'lerinde bakiye/revizyon/kapanış korumasını geçti. Mevcut stok/terminal/barkod/fiyat/mal kabul/aylık mali mutabakat paketi de son üretimde geçti.

Chromium geliştirme ve üretimde tarih aralığı/dönem toplamı, sayfalama, ürün/parti ayrıntısı, iki CSV, eski seçim ve gecikmiş yanıtın temizlenmesi, kapalı gün okuma ve 390px yatay taşma kontrolünü geçti. Haricî ağ isteği ve JS sayfa hatası yoktu. Bu kontroller fizikî Windows/MySQL8/TC73 saha kabulü veya yasal mali belge doğrulaması değildir.

Özel test fixtürleri, erişimler ve ekran görüntüleri Git dışında `/workspace/count-report-test` altındadır. Kullanıcı ürün/fiyat listesi, `.env`, parolalar ve DB dökümleri kaynaklara eklenmez.

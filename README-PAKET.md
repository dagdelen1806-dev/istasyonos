# İstasyonOS güncel kaynak paketi — 24 Ekim 2026

Yerel e-posta/parola girişi Manus olmadan çalışır. Kaynak kod paketidir; hazır Windows EXE veya veritabanı kopyası değildir. Stok/el terminali, lot/SKT/FEFO/karantina/fire ve grup KDV seçimiyle DEMO liste açılışı ve el terminalinde parti sayımı içerir. Ayrıntılar `docs/market-urun-aktarimi-2026-10-19.md` ve `docs/market-lot-skt-2026-10-17.md` içindedir.

## Mevcut Windows / Laragon kurulumunu güncelleme

Önce proje ve DB yedeğini alın, çalışan `pnpm dev` işlemini durdurun. Kendi `.env` dosyanızı koruyarak güncel `main` kaynaklarını aktarın. Node 22/24, pnpm 10.18.0 ve Laragon MySQL gerekir; Docker bu yol için zorunlu değildir.

```powershell
pnpm install --frozen-lockfile
pnpm tsx server/stationos/migrate.ts
pnpm dev
```

Göçler 0019 dahil uygulanır. Yeni/boş kurulumda kullanıcı tabloları için ayrıca `pnpm db:migrate` gerekir; `README.md` ve `WINDOWS-BASLANGIC.md` rehberlerini izleyin. Tarayıcı adresi `http://localhost:3000`; `istasyonos.test` Windows/Laragon proxy ayarınıza bağlıdır. Bulut kodlaması Windows dosyalarını kendiliğinden değiştirmez.

## Kapsam ve doğrulama

24 Ekim 2026: TypeScript, 19 dosyada 102 test ve üretim derlemesi başarılı. Liste aktarımının geliştirme/üretim HTTP ve Chromium testleri geçti. Lot/SKT kontrollerinin tarihli kanıtları ilgili rehberdedir. Fizikî Windows/okuyucu/yazıcı ve banka/e-belge/ÖKC saha kabulü yapılmadı. POS DEMO sınırlaması ve bağlı sunucu/LAN gereksinimi devam eder; bağlantısız tarayıcı mali kuyruğu yoktur.

`.env`, parolalar, kullanıcı fiyat listesi, DB, `.git`, `node_modules` ve `dist` pakete dahil edilmez. Bağımlılıklar lockfile üzerinden kurulur. `DOSYA-MANIFESTI.json` kendi dosyası hariç kaynak dosyalarının SHA-256 envanteridir. Eski `paket-2026-10-19` dalındaki RAR/ZIP önceki kopyadır; güncel geliştirme kaynağı `main` dalıdır.

El terminali parti sayımı için `docs/market-terminal-parti-sayimi-2026-10-19.md` rehberini okuyun.

Onaylanmış terminal sayımları için tarihli rapor ve CSV: `docs/market-sayim-raporlari-2026-10-23.md`. Bu rapor güncellemesi yeni SQL göçü eklemez.

Satın alma siparişleri, kısmi kabul ve yönetici fiyat revizyonu için `docs/market-satin-alma-siparisleri-2026-10-24.md` rehberini okuyun; 0018 göçü gerekir.

Raf etiketi kuyruğu, A4/PDF baskı paketleri, ayrı fizikî yerleştirme ve onaylı cihazdan raf/kasa fiyat kontrolü: `docs/market-raf-etiketleri-2026-10-24.md`. 0019 göçü gerekir. Geliştirme/üretim HTTP ve Chromium, fiyat değişiminde eski baskıyı durdurma ve bağımsız A4 PDF okuması başarılı; fizikî yazıcı/okuyucu denenmedi.

Raporlar merkezi: `/raporlar` altında tarihli satış/ödeme dağılımı, kaynak fiş/iade, sayfalı ürün kârlılığı, mevcut aylık/sayım raporları. Yeni migration yok; 0019 dahil şema gerekir. Kullanım/sınırlar: `docs/market-raporlar-merkezi-2026-10-24.md`.

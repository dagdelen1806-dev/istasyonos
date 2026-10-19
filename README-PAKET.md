# İstasyonOS güncel kaynak paketi — 19 Ekim 2026

Yerel e-posta/parola girişi Manus olmadan çalışır. Kaynak kod paketidir; hazır Windows EXE veya veritabanı kopyası değildir. Stok/el terminali, lot/SKT/FEFO/karantina/fire ve grup KDV seçimiyle DEMO liste açılışı içerir. Ayrıntılar `docs/market-urun-aktarimi-2026-10-19.md` ve `docs/market-lot-skt-2026-10-17.md` içindedir.

## Mevcut Windows / Laragon kurulumunu güncelleme

Önce proje ve DB yedeğini alın, çalışan `pnpm dev` işlemini durdurun. Kendi `.env` dosyanızı koruyarak güncel `main` kaynaklarını aktarın. Node 22/24, pnpm 10.18.0 ve Laragon MySQL gerekir; Docker bu yol için zorunlu değildir.

```powershell
pnpm install --frozen-lockfile
pnpm tsx server/stationos/migrate.ts
pnpm dev
```

Göçler 0016 dahil uygulanır. Yeni/boş kurulumda kullanıcı tabloları için ayrıca `pnpm db:migrate` gerekir; `README.md` ve `WINDOWS-BASLANGIC.md` rehberlerini izleyin. Tarayıcı adresi `http://localhost:3000`; `istasyonos.test` Windows/Laragon proxy ayarınıza bağlıdır. Bulut kodlaması Windows dosyalarını kendiliğinden değiştirmez.

## Kapsam ve doğrulama

19 Ekim 2026: TypeScript, 14 dosyada 69 test ve üretim derlemesi başarılı. Liste aktarımının geliştirme/üretim HTTP ve Chromium testleri geçti. Lot/SKT kontrollerinin tarihli kanıtları ilgili rehberdedir. Fizikî Windows/okuyucu/yazıcı ve banka/e-belge/ÖKC saha kabulü yapılmadı. POS DEMO sınırlaması ve bağlı sunucu/LAN gereksinimi devam eder; bağlantısız tarayıcı mali kuyruğu yoktur.

`.env`, parolalar, kullanıcı fiyat listesi, DB, `.git`, `node_modules` ve `dist` pakete dahil edilmez. Bağımlılıklar lockfile üzerinden kurulur. `DOSYA-MANIFESTI.json` kendi dosyası hariç kaynak dosyalarının SHA-256 envanteridir. Eski `paket-2026-10-19` dalındaki RAR/ZIP önceki kopyadır; güncel geliştirme kaynağı `main` dalıdır.

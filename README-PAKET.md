# İstasyonOS — Kaynak kodu aktarım paketi

**Hazırlanma:** 14 Ekim 2026. Bu arşiv, o tarihteki çalışma klasöründe bulunan güncel yazılımın kaynak kopyasıdır; eski Git commit'iyle sınırlı değildir.

## Paket yapısı

RAR'ı açtığınızda `istasyonos/` klasörü oluşur:

- `CLAUDE.md`: Claude Code için proje tanıtımı, mimari, komutlar, finans/yetki kuralları ve açık işler.
- `client/`, `server/`, `shared/`: güncel React/TypeScript/Express uygulaması.
- `drizzle/`, `server/stationos/migrations/`: kullanıcı ve operasyon veritabanı şemaları.
- `package.json`, `pnpm-lock.yaml`, `patches/`, `Dockerfile`: bağımlılık ve derleme kaynakları.
- `.env.example`: **boş** ortam değişkeni şablonu.
- `docs/`: önceki planlar, örnek PostgreSQL SQL'leri, kaynak araştırmaları, Excel şablonu, wireframe ve v2.0 eski demo.
- `DOSYA-MANIFESTI.json`: paket içindeki dosyaların SHA-256 envanteri.
- `PAKET-BILGISI.json`: kopyanın tarihi, kapsamı ve doğrulama sonucu.

Claude Code'u **`istasyonos/` klasöründe** açın; `CLAUDE.md` dosyasını otomatik okuyabilir. Ayrı indirdiğiniz `CLAUDE.md` de aynı dosyadır.

## Çalıştırma

Node.js 22 ve pnpm 10.18.0 kullanın:

```bash
corepack enable
corepack prepare pnpm@10.18.0 --activate
pnpm install --frozen-lockfile
cp .env.example .env
# Kendi veritabanı/OAuth ayarlarınızı .env içine ekleyin.
pnpm db:migrate
pnpm tsx server/stationos/migrate.ts
pnpm dev
```

Varsayılan adres `http://localhost:3000`. Gerçek OAuth/PWA kullanımı için HTTPS ve yetkili callback yapılandırması gerekebilir. Windows'ta dosya kopyalamayı elle yapabilir ve POSIX npm script'leri için WSL kullanabilirsiniz.

**Önemli:** Kaynaklar aktarılabilir; platformda kullanılan veritabanı, OAuth hesabı ve AI hizmet erişimi arşivle birlikte aktarılmaz. Bu sürüm Manus OAuth/AI adaptörlerine bağlıdır. Yetkili ortam ayarları olmadan gerçek login, kayıt veya AI özelliği hazır çalışır diye değerlendirmeyin. Başka platforma geçilecekse bu adaptörler uyarlanmalıdır.

Güncel uygulama MySQL kullanır. `docs/` altındaki önceki PostgreSQL örnekleri mevcut uygulama migration'ı değildir. Migration'ları yalnız yedeklenmiş ve doğru seçilmiş veritabanında uygulayın. Tamamlanmamış entegrasyonların ayrıntısı `CLAUDE.md` içindedir.

## Güvenli aktarım

Arşivden gerçek `.env`/anahtarlar, `.git`, oturum/ağ logları, platform iç dosyaları, `node_modules`, derlenmiş `dist` ve eski ZIP/RAR arşivleri çıkarıldı. Gerçek veritabanı dökümü veya banka/işletme kayıtları alınmadı. Bağımlılıklar lockfile'dan yeniden kurulur; yazılım kaynak kodu paketidir, hazır Windows kurulum/EXE paketi değildir.

## Bu aktarımda doğrulananlar

- TypeScript: `pnpm check` başarılı.
- Birim/sözleşme testleri: **6 dosya / 25 test başarılı**.
- Üretim derlemesi: `pnpm build` başarılı; büyük chunk ve runtime script uyarıları mevcut.
- Veritabanına bu paketleme sırasında test verisi yazılmadı.

Bu sonuçlar tam saha pilotu, gerçek Turpak/OCR/banka entegrasyonu veya üretim güvenlik sertifikasyonu değildir. Eski tarihli belgelerdeki test ve tamamlanma notlarını bu güncel kopyanın kapsamıyla karıştırmayın.

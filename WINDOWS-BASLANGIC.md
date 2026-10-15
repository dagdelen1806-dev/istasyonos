# Windows’ta İstasyonOS

Bu paket kaynak kodudur; Windows EXE kurulum dosyası değildir. Manus hesabı gerektirmez. Docker uygulamayı ve ayrı MariaDB veritabanını bilgisayarınızda çalıştırır.

## 1. Hazırlık

1. [Docker Desktop](https://www.docker.com/products/docker-desktop/) kurun. Kurulum isterse WSL 2’yi etkinleştirip bilgisayarı yeniden başlatın. Docker Desktop’ı açın ve **Linux containers** modunda motorun hazır olmasını bekleyin.
2. ZIP’i açmadan önce dosyaya sağ tıklayın → Özellikler → varsa **Engellemeyi kaldır** seçeneğini işaretleyin. Sonra ZIP’i örneğin `C:\Projeler` altına çıkarın.
3. VS Code’da içindeki `istasyonos` klasörünü açın. `KUR.ps1`, `compose.yaml` ve `package.json` aynı klasörde olmalı.

## 2. İlk çalıştırma

**Kolay yol:** `BASLAT.cmd` dosyasına çift tıklayın.

Alternatif: VS Code → Terminal → New Terminal. PowerShell terminalinde, proje klasöründeyken:

```powershell
powershell -NoProfile -ExecutionPolicy RemoteSigned -File .\KUR.ps1
```

İlk çalıştırma internetten resmî container image’larını ve bağımlılıkları indirip derler; birkaç dakika sürebilir. Betik bilgisayarınıza özel rastgele parolalarla `.env` oluşturur, mevcut dosyayı ezmez. Veritabanını ve uygulamayı başlatır, migration’ları uygular ve sağlık kontrolünden sonra tarayıcıyı açar.

Bilgisayarınızdaki giriş adresi: **http://localhost:3000**. Bu adres bilgisayarınızda Docker çalıştıktan sonra kullanılabilir; bulut ortamının adresi değildir.

Giriş ekranında **Yeni hesap oluştur** seçin. Firma/istasyon kurarken örnek veri istiyorsanız **DEMO** seçeneğini açın. Başkasına ait istasyona erişim ancak yönetici davetiyle olur. Buluttaki demo kullanıcıları/parolaları bu pakette yoktur.

## 3. Daha sonraki açılışlar

Docker Desktop açıkken proje klasöründe:

```powershell
docker compose up -d --wait
```

Uygulamayı kapatmak için:

```powershell
docker compose stop
```

Normal kapatma/açma verileri silmez. Veriler Docker’ın `database` volume’ünde tutulur. Bu volume’ü silmeyin; `.env` dosyasını da koruyun ve paylaşmayın. Docker Desktop’ın fabrika ayarına döndürülmesi/verilerin temizlenmesi yerel kayıtları kaybettirebilir.

## 4. VS Code’da geliştirme

Kolay yol: kaynak dosyalarını değiştirin, sonra yeniden derleyin:

```powershell
docker compose up -d --build --wait
```

Otomatik yenilenen geliştirme sunucusu için ayrıca **Node.js 22 LTS veya 24 LTS** kurun. Yeni terminal açın, ardından:

```powershell
npm install --global pnpm@10.18.0
docker compose stop app
docker compose up -d db --wait
pnpm install --frozen-lockfile
pnpm db:migrate
pnpm tsx server/stationos/migrate.ts
pnpm dev
```

Bu komutlar ilk `KUR.ps1` çalışmasının oluşturduğu `.env` dosyasını kullanır. Veritabanı bu bilgisayarda `127.0.0.1:3307` üzerinden erişilir; app container’ı ise kendi bağlantısını `db:3306` üzerinden kurar. `pnpm dev` Windows PowerShell ile uyumludur. Durdurmak için Ctrl+C kullanın.

Kontroller ve üretim derlemesi:

```powershell
pnpm check
pnpm test
pnpm build
pnpm start
```

`pnpm dev`, `pnpm start` ve Docker app servisini aynı portta aynı anda açmayın. Windows güvenlik duvarında dışarıya port açmanız gerekmez; Docker portları yalnız kendi bilgisayarınıza bağlanır.

## Sorun giderme

- **Docker bulunamadı/motor kapalı:** Docker Desktop’ı açın, motor hazır olduktan sonra tekrar deneyin.
- **Betik çalıştırılması engellendi:** ZIP’in Özellikler ekranındaki engeli kaldırıp yeniden çıkarın. Kurum politikası betikleri engelliyorsa BT yöneticinizden destek alın; makine genelindeki güvenlik politikasını değiştirmeyin.
- **3000 veya 3307 portu dolu:** `.env` içindeki `PORT` / `DB_PORT` değerini değiştirin. Yerel Node geliştirmesinde `DATABASE_URL` içindeki port da `DB_PORT` ile aynı olmalı. Ardından `docker compose up -d --wait` çalıştırın.
- **Başlatma başarısız:** `docker compose ps` ve `docker compose logs --tail 80 app db` çıktısını kontrol edin. `.env` veya parola değerlerini paylaşmayın.

Turpak, gerçek banka, fotoğraf yükleme ve OCR henüz kapalıdır. Asistan yerel kural tabanlı özet verir. Bu paket yerel geliştirme/deneme içindir; internete açılacak üretim kurulumu ayrıca HTTPS ve güvenlik yapılandırması gerektirir.

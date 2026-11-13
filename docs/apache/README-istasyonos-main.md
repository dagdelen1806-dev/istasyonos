# istasyonos-main.test — uygulanmamış Apache taslağı

Hedef: `https://istasyonos-main.test` → mevcut Laragon Apache →
`http://127.0.0.1:3000` üzerindeki İstasyonOS Express/Vite uygulaması.

`istasyonos-main.test.conf.example` yalnız proje içinde yeni oluşturulan
taslaktır. Laragon, Apache, MySQL, hosts, sertifika ve uygulama kaynakları
değiştirilmedi. Servis veya uygulama başlatılmadı; DB bağlantısı kurulmadı.

## Mevcut durum

- hosts, `istasyonos-main.test` adını 127.0.0.1'e eşliyor.
- `auto.istasyonos-main.test.conf` HTTP/HTTPS vhost'ları proje kökünü doğrudan
  sunuyor; görülen “Index of /” uygulama ekranı değildir.
- Mevcut Laragon sertifikası bu adı kapsıyor ve süresi geçerli. Tarayıcının
  sertifikaya güveni ayrıca doğrulanmalı; özel anahtar okunmadı veya kopyalanmadı.
- Ana Apache yapılandırmasında proxy/proxy_http modülleri kapalı görünüyor;
  ilgili DLL modülleri mevcut. headers ve SSL modülleri tanımlı.
- Express/Vite geliştirme girişi `pnpm dev`. Normal PowerShell'de Node/tsx
  çalışıyor; Codex oturumunun kullanıcı profili hatası proje hatası değildir.

## Taslağın davranışı

Yalnız tam `istasyonos-main.test` adı için iki vhost tanımlar; wildcard alias
kullanmaz. HTTP, HTTPS'ye geçici 302 yönlendirme yapar. HTTPS'deki tüm yollar,
API ve Vite istekleri dahil, sabit Node hedefine proxy edilir. Express'in
Origin/CSRF denetimi için Host korunur; forwarded host/protokol başlıkları
Apache tarafından sabitlenir. Forward proxy kapalıdır.

DocumentRoot proje kökü yerine yalnız public varlık dizinine ayarlanır.
Proje dizininde dosya listesi ve .htaccess devralımı kapatılır. Erişim
`Require local` ile bu bilgisayarla sınırlanır; bu taslak fiziksel telefondan
LAN erişimi açmaz. Backend kapalıysa proxy hatası beklenir; kaynak dizininin
listelenmesi beklenmez.

Apache 2.4.54 için HTTP ve WebSocket Upgrade aynı `mod_proxy_http` üzerinden
taşınır; `upgrade=websocket` kullanılır. Resmî kaynak:
[Apache WebSocket Upgrade örneği](https://httpd.apache.org/docs/2.4/mod/mod_proxy.html#examples).
Mevcut Express geliştirme girişinde Vite `hmr.server` ile aynı HTTP sunucusuna
bağlanır; ayrıca Vite config değişikliği yapılmadı.

## Uygulamadan önce kalanlar

1. Aynı ServerName'i taşıyan eski otomatik dosya ile yeni taslak birlikte
   etkinleştirilmemeli. İleride uygulama seçilirse önce yalnız eski İstasyonOS
   vhost dosyasının kopyası korunmalı ve `.conf` yükleme kapsamından çıkarılması
   planlanmalı. Diğer projelerin dosyaları korunmalı. Taslağın kalıcı dosyası
   `auto.` öneki taşımamalı; Laragon otomatik üretimiyle çakışma kontrol edilmeli.
2. Taslaktaki LoadModule koşulları yalnız eksik modülleri yüklemek içindir;
   modül yükleme Apache genelinde geçerlidir. Proxy kuralları ise yalnız bu
   vhost'tadır. Apache yeniden yüklemesi ortak sunucuyu etkiler; şu anda
   yapılmadı. Gerçek ana yapılandırmayla `httpd -t` / vhost çözümlemesi henüz
   çalıştırılmadı; taslak çalışma ortamında kabul edilmiş sayılmaz.
3. Başlatmadan önce mevcut `.env` hedefi ve şema hazırlığı ayrı doğrulanmalı.
   Uygulama başlangıcındaki readiness kontrolü DB'ye bağlanır; migration
   uygulamaz. Bu aşamada dosya/DB incelemesi veya bağlantısı için yeni işlem
   yapılmadı. HTTPS çerezi için `COOKIE_SECURE=true`, yerel kimlik için
   `AUTH_PROVIDER=local` ve geçerli SESSION_SECRET gerekir.
4. İleride uygulama başlatılacaksa normal PowerShell'de proje kökünden
   `$env:PORT = "3000"` ve `pnpm dev` kullanılır. Bunlar bu hazırlıkta
   çalıştırılmadı. Mevcut backend kodu 0.0.0.0'a bağlanır; Apache'deki yerel
   erişim kısıtı doğrudan 3000 portunu sınırlamaz. Backend'i yalnız loopback'e
   bağlamak ayrı, henüz yapılmamış bir kod/yapılandırma değişikliğidir.

Sıradaki tek adım: bu taslağın mevcut vhost'un **yerine** uygulanacağı dosya
planını incelemek. Dosya değiştirme, modül etkinleştirme, Apache yeniden
yükleme veya Node başlatma bu taslağın hazırlanmasına dahil değildir.

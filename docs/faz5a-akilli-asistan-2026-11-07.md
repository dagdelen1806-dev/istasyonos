# Faz 5A — Akıllı İşletme Asistanı

7 Kasım 2026. Geliştirme yalnız `istasyonos_demo` üzerinde doğrulandı.

## Kullanım

DEMO adresi: **http://127.0.0.1:3001/asistan**. Genel bakış yönetim panelinde de aynı modül bulunur. Mevcut DEMO firma sahibi, istasyon yöneticisi ve muhasebeci hesapları erişebilir. Giriş bilgileri önceki teslimdeki yerel `.local/demo/LOGIN.txt` dosyasındadır; bu rapora kopyalanmadı.

Şirket, üst menüden istasyon ve başlangıç/bitiş günü seçilir. Yetkisiz şirket veya istasyon API tarafından reddedilir. İki ayrı tenant birleştirilmez; diğer DEMO şirketi için kendi hesabıyla giriş yapılır. Pompacı, market personeli ve satın alma rolüne bu mali rapor açılmaz; mevcut operasyon asistanının kendi yetkili işlevleri korunur.

## Çalışan kapsam

- Kabul edilmiş vardiya hesaplarından operasyonel satış ve sayaç litresi; yönetim panelinin mevcut deterministik sorguları yeniden kullanıldı.
- Güncel stok, cari alacak, açık hesap kasası ve bekleyen onay göstergeleri.
- Tolerans dışı fiziksel tank farkı, kritik/kapasite dışı stok, bilinmeyen kapasite/stok veya eski ölçüm.
- Kapalı sayaç hesabında bildirilen litre farkı ve eksik okuma; fiyat değişimi satırları litre toplamına katılmaz. Önceden doğrulanan fiyat dilimi satış tutarları tekrar yapay zekâya hesaplattırılmaz.
- İcmal tutar farkı ve kabul edilmiş hesaplarda iki bağımsız onay bütünlüğü uyarısı.
- Cari tahsilatlar, güncel borç bakiyeleri, onay bekleyen vardiya ve tank talepleri.
- TTS/Gift/Partner taslakları ve banka teyidi yerine geçmeyen IBAN/manuel POS beyanları ayrı bulgulardır. Taslaklar ve cari tahsilatlar yeni satış sayılmaz.
- Yüksek → orta → bilgi sıralaması sunucuda sabittir. Her bulgu formül, tam kayıt adedi, tam toplam ve en fazla 10 kaynak kayıt örneği içerir. UUID, istasyon ve gerekli sayısal kaynak alanları yetkili kullanıcıya gösterilir. Kaynak örneklerinin kesildiği açıkça belirtilir.

Satış dönemi Türkiye saatinde vardiya başlangıç gününe, cari tahsilat dönemi ödeme oluşturulma gününe göredir. Stok, bakiye ve bekleyen işler **günceldir**; geçmiş dönem sonu bakiyesi olarak sunulmaz. Bu rapor kâr/zarar veya mali defter değildir. Onay bütünlüğü uyarısı görüldüğünde kabul durumu ve toplamlar ayrıca incelenmelidir.

## Gemini sınırı

`assistant-gemini.ts` yalnız sabit Google adresine metin özeti gönderir. Anahtar sunucu başlığında kalır. Kaynak kimliği, tenant/şirket/kişi adı, referans, belge, serbest kullanıcı sorusu ve SQL gönderilmez. Modele SQL aracı, fonksiyon çağrısı veya kayıt değiştirme yetkisi verilmez.

Gönderim yalnız **“Anonim özeti Gemini ile açıkla”** düğmesiyle yapılır. CSRF/same-origin kontrolü ve rol/tenant/istasyon doğrulaması uygulanır. Harici istek sırasında veritabanı transaction'ı açık tutulmaz; yanıt öncesinde yetki yeniden kontrol edilir. Kullanıcı başına bir dakika istek sınırı ve 20 saniye bağlantı zaman aşımı vardır.

Model yalnız mevcut bulgu kodlarına açıklama/öneri döndürebilir; hesaplama ve sıralama yereldir. Yanıt yapısı doğrulanır, metin React tarafından kaçışlanır; kaynak raporun yerine geçirilmez. Anahtar eksikliği, ağ hatası, 429/500 veya geçersiz yanıt yerel önerilere döner. Ham sağlayıcı hataları döndürülmez veya loglanmaz.

Model seçimi sunucuda `GEMINI_ASSISTANT_MODEL`, yoksa mevcut OCR Flash model ayarıyla yapılır. Yeni anahtar veya SDK kurulmadı. Ayrı DEMO başlatıcısı harici anahtarları bilerek boşaltmaya devam eder; DEMO ekranında yerel çalışma ve kapalı Gemini düğmesi doğrulandı. Adaptör testlerinde taklit HTTP yanıtları kullanıldı. **Bu fazda canlı Gemini açıklaması doğrulanmadı**; önceden kaydedilen canlı OCR bağlantı denemesi ağ erişim engeliyle başarısızdı. Taklit yanıtlar canlı başarı olarak sunulmadı.

## Doğrulama

- İki TypeScript yapılandırması başarılı.
- 33 test dosyasında **558 test başarılı**; bunların 13'ü yeni kapsam/mahremiyet/Gemini hata ve çıktı sınırı testidir. Tarih/yetkilendirme regresyonları üç saat diliminde ayrıca 65'er test geçti.
- Vite + esbuild DEMO build başarılı. Mevcut klasik config script'i ve 500 kB üstü paket boyutu uyarıları sürüyor.
- Gerçek MySQL/API: iki şirket toplamı **906.996.450 kuruş (9.069.964,50 TL)** ve **199.062.000 ml (199.062 L)**. Yönetim paneli ve kaynak hesap toplamı birebir eşleşti.
- Tek istasyon/şirket süzme, çapraz tenant 403, pompacı/satın alma 403, anonim 401, hatalı tarih reddi; yönetici/muhasebeci erişimi geçti. Açıklama endpoint'inde de yetki ve gönderim onayı sınandı.
- Rapor GET ve açıklama POST öncesi/sonrası tüm `st_*` tabloları satır karmaları aynı kaldı.
- Yalnız DEMO transaction'ında geri alınan kontrollü değişikliklerle **1,234 L** sayaç farkı, **7,77 TL** icmal farkı, kritik stok, fiziksel tank farkı ve eksik bildirilen litre yakalandı. Rollback sonrası satır karmaları aynı kaldı.
- Mevcut 13 DEMO tutarlılık kontrolü tekrar başarılı: stok/hareket, fiyat dilimi/sayaç, kasa, cari, bağımsız onay ve bekleyen kayıt sınırları korundu.
- Gerçek Chrome: genel bakış ve `/asistan`, 240 kaynak hesaptan 10 örnek, Ekim aralığında 124 hesap, tek istasyonda 62 hesap, şirket filtresi, ikinci tenant ayrımı, personelin mali modülü görememesi, 390px mobil görünüm ve açık kaynak tablolarında sayfa taşmaması; JavaScript istisnası yok.
- Mevcut 19 modül ekranı ve önceki cari tahsilat kalıcılık tarayıcı regresyonu tekrar geçti; korumalı tekrar çalıştırma yeni tahsilat çoğaltmadı.

Test komutları:

```powershell
node scripts/verify-phase1.mjs test
node scripts/demo-build.mjs
node scripts/verify-phase5a.mjs --database istasyonos_demo
node scripts/verify-phase5a-browser.mjs --database istasyonos_demo --browser
node scripts/demo-verify.mjs
node scripts/verify-phase5a-source.mjs
```

Yerel kanıtlar: `.local/demo/phase5a-verification.json`, `phase5a-browser.json`, `phase5a-desktop.png`, `phase5a-mobile.png`, `phase5a-source-comparison.json`. Hiçbir migration veya seed gerekmedi.

## Korunan ortam ve karşılaştırma sınırı

Ana uygulama `127.0.0.1:3000` (aynı PID 23260) korundu. Yalnız DEMO `127.0.0.1:3001` yeniden başlatıldı. Apache/MySQL yeniden başlatılmadı; Aksan vhost SHA-256 değeri önceki teslimle aynı. Muhasebe kilitleri, çift onay ve mevcut kayıtlar değiştirilmedi.

Önceki teslimin ana veritabanı görüntüsüyle salt okunur karşılaştırmada 58 tablonun **51'i aynı**; mali ve stok tabloları aynı. `st_audit`, `st_auth_sessions`, `st_invitation_stations`, `st_invitations`, `st_request_tracking`, `st_requests`, `users` metaverilerinde fark var. Bu karşılaştırma farkların kaynağını belirlemez; ana veritabanının tamamının değişmediği iddia edilmez. Eski görüntü üzerine yazılmadı ve bu farklar geri alınmadı. Faz 5A yazma testlerinin hedefi sabit DEMO'dur.

## Değişen dosyalar

- `shared/smart-assistant.ts`: rapor ve açıklama sözleşmesi.
- `server/stationos/smart-assistant.ts`: kapsam kesişimi, sabit sorgular, kaynaklı bulgular ve önem sırası.
- `server/stationos/assistant-gemini.ts`: kısıtlı anlatım, yerel geri dönüş ve istek sınırı.
- `server/stationos/index.ts`: salt okunur rapor/açıklama endpoint'leri ve yetki kontrolü.
- `client/src/components/stationos/SmartAssistantPanel.tsx`: filtreler, göstergeler, kaynaklar ve isteğe bağlı açıklama.
- `client/src/pages/StationApp.tsx`: panel ve mevcut asistan ekranına entegrasyon.
- `server/stationos/smart-assistant.test.ts`: 13 yeni test.
- `scripts/verify-phase5a.mjs`, `scripts/verify-phase5a-browser.mjs`, `scripts/verify-phase5a-source.mjs`: tekrarlanabilir MySQL/API, tarayıcı ve salt okunur kaynak karşılaştırması.
- Bu teslim raporu.

## Kalanlar

Canlı Gemini açıklama doğrulaması yapılmadı. Banka/POS otomatik teyidi halen bağlı değil; ilgili bulgular manuel beyan uyarısıdır. Geçmiş stok/bakiye anlık görüntüsü, otomatik muhasebeleştirme ve harici sensör entegrasyonu bu fazın çalışan özellikleri olarak sunulmaz. Yeni bulgular için iş kuralları ve eşikler gerektiğinde ayrı testlerle genişletilebilir.

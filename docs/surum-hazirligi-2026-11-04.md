# 4 Kasım 2026 — İncelenebilir sürüm hazırlığı

Bu paket mevcut kaynakların ve build'in incelenebilir kopyasıdır; üretim
dağıtımı veya üretim kabulü değildir. Kullanıcı yedek–geri yükleme provasını
atladı. Gerçek alan adı/CA zinciri, fiziksel telefon ve uzak sunucu kabulü
henüz yapılmadı; hedef bilgisi bekleniyor.

## Güncel davranış ve kanıt

- Y-01/Y-02: şifreli davet yanıtları ve açık saat dilimli tarih sözleşmesi.
- Y-07: checksum ve geçmiş denetimli migration; başlangıçta otomatik DDL yok.
- Y-08: kalıcı işlem takibi, gerçek MySQL COMMIT onayı kaybında sonuç sorgusu,
  mükerrer mali yazımın engellenmesi. Rezervasyonda yalnız kanıtlı deadlock
  rollback sonrası sınırlı tekrar; işlem yaşı DB saatinden hesaplanır.
- Hesap düzeltme yalnız SUBMITTED/IN_REVIEW durumlarında mümkündür;
  ACCEPTED ve ACCEPTED_WITH_PENDING tekrar OPEN yapılamaz.
- 17 dosyada 198 test ve iki TypeScript kontrolü geçti. Üç saat diliminde
  65'er tekrar testi geçti. Tam vardiya kapanışı ve yerel HTTPS kabulü geçti.
- Build'de runtime config script etiketi ve büyük ana JS paketi uyarıları
  bulunuyor. Gerçek banka/Turpak/OCR/AI sağlayıcısı entegrasyonu eklenmedi.

İlgili ayrıntılar:

- [Y-08 ve COMMIT pilotu](faz1-y08-pilot-2026-11-04.md)
- [Tam vardiya kapanışı](vardiya-kapanis-pilotu-2026-11-04.md)
- [Windows/Laragon yerel HTTPS kabulü](windows-https-kabul-2026-11-04.md)
- [Migration bakım prosedürü](faz1-paket3-migration-guvenligi.md)

## Paketin içeriği ve bütünlüğü

Kaynak dizinleri, kilitli bağımlılık tanımları, yeni üretilen `dist/`,
Drizzle/operasyon SQL dosyaları, manifest/journal, bakım CLI bundle'ı ve
güncel kabul belgeleri dahil edilir. `.env`, gerçek anahtar/çerez/parola,
sertifika özel anahtarı, DB verisi, `.local/`, `node_modules/`, log ve eski
kaynak yedekleri pakete eklenmez. `.env.example` yalnız boş yapılandırma
şablonudur. Yerel pilotların özel erişim dosyaları taşınmaz.

`release.manifest.json`, kendisi dışındaki paket dosyalarının byte boyutu ve
SHA-256 değerini içerir. Node çekirdeğiyle, DB'ye veya ağa erişmeden doğrulama:

```text
node scripts/verify-release.mjs
node maintenance/migrations.mjs check-files
```

İlk komut listedeki dosyaların bütünlüğünü denetler; manifestin kaynağını
doğrulayan dijital imza değildir. ZIP'in dışarıda tutulan SHA-256 değeri
güvenilir aktarım kaynağıyla birlikte korunmalıdır. Bağımlılıklar pakete
gömülü değildir; Node 22/24 ve pnpm 10.18.0 ile ayrı ortamda
`pnpm install --frozen-lockfile` gerekir.

## Hedefe geçiş durumu

Paket hazırlanırken çalışan işletme DB'sine bağlanılmaz ve migration
uygulanmaz. Gerçek hedef için bağlantı, mevcut şema geçmişi ve sertifika
bilgileri sağlandıktan sonra salt okunur durum denetimi yapılabilir.

Migration envanterinin SHA-256 değeri:

```text
12c87aeeea76b76c0a69b1742b5c4b1e5ac88114f6e3024e2ff5194fe5d6d9a8
```

Bu değer mevcut dosyalarla eşleşir; ayrı üretim uygulama onayı yerine geçmez.
Bakım CLI bundle'ı aynı kontrollü `scripts/migrations.ts` girişinden üretilir.
`check-files` dosya denetimidir; `status` hedef DB'ye salt okunur bağlanır;
`apply` ve gerekiyorsa `baseline` ayrı veri/şema işlemleridir. Bu hazırlıkta
bunlar gerçek hedefte çalıştırılmadı.

Uygulama/image, kaynak ve SQL manifesti aynı sürümden kullanılmalıdır.
`dist/index.js` tek başına yeterli değildir; uygulama migration varlıklarını
proje kökünde arar. Davet anahtar halkası ve SESSION_SECRET hedefte gizli,
kalıcı yapılandırma olarak sağlanmalıdır. HTTPS için COOKIE_SECURE=true ve
proxy tarafından sabitlenen Host/forwarded protokol başlıkları gerekir.

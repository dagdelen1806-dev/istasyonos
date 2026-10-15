# StationOS backend

Bu klasör AKARYAKIT V1 için `/api/stationos` REST backend'idir. Tüm mutation yanıtları `{ ok: true, result }`, hatalar `{ ok: false, error: { code, message } }` biçimindedir. Para değerleri güvenli integer **kuruş**, stok değerleri integer adettir.

## Kurulum ve migration

Yeni tablolar yalnızca açıkça çalıştırılan migration ile oluşturulur; sunucu başlangıcı migration çalıştırmaz.

```bash
pnpm tsx server/stationos/migrate.ts
```

`DATABASE_URL` mevcut managed MySQL bağlantısıdır. Migration `st_` önekli 23 additive tablo oluşturur, `st_schema_migrations` ile sürümünü bir kez kaydeder ve mevcut kullanıcı/verileri silmez. Migration çalıştırmadan REST state/mutation kalıcı DB kullanamaz; bağlantı DSN'i loglanmaz.

## Tamamlanan backend alanları

- Gerçek `sdk.authenticateRequest` cookie/Bearer Manus oturumu; actor hiçbir zaman body/role alanından alınmaz.
- İlk ziyaretçiyi global admin yapmayan setup: doğrulanmış ve henüz üyesiz Manus actor yalnızca kendi yeni isolated tenantını ve OWNER üyeliğini oluşturabilir; mevcut tenantlara erişim davetle olur. `OWNER_OPEN_ID` tanımlıysa yalnız eşleşen doğrulanmış openId veya DB `admin` setup başlatabilir; hint yoksa fallback yalnız kendi yeni tenantını oluşturma ile sınırlıdır, actor tenantlar arasında yetki devralamaz. `isDemo` açıkça `true` olmadan örnek seed yoktur; demo örnekleri açıkça DEMO etiketlidir.
- Tenant içinde birden çok şirket/istasyon, üye rolü ve istasyon kapsamı; owner davette atanamaz. Davet kodları random, tek kullanımlık, yedi gün süreli ve yalnız hash olarak tutulur.
- `requestId + payload hash + actor` kapsamlı idempotency; her mutation transaction içindedir. Aynı requestId farklı payload ile yeniden kullanılamaz.
- JSON mutation için `X-Stationos-Request: 1`, state'ten üretilen imzalı-oturum bağlı `X-CSRF-Token` ve mümkün olduğunda same-origin kontrolü.
- Vardiya hesabı, integer tutarlar, nakit/kart/IBAN/borç/cari tahsilat ayrımı, manuel kaynak toplamı ve ref, fizikî teslim, revision guard, immutable signature/history ve iki farklı kişi kuralı.
- IBAN onayı `ACCEPTED_WITH_PENDING` kalır; gerçek banka mutabakatı iddia edilmez. Account return önceki imzaları silmeden yeni cycle açar.
- Cari borç ledger'ı: `DEBT` bir kez borçlandırır; `AR_COLLECTION` ayrı tahsilat jurnalidir, ciroyu azaltmaz ve mevcut bakiyeyi aşamaz.
- Station-scoped market ürün/barkod unique kontrolü, immutable stok movement, mal kabul/satış/adjustment, negatif stok reddi ve satış fiyatından bağımsız market satış hareketi.
- Tedarikçi cari/limit/vade, açık payables ve son 28 gün deterministik stok önerisi (`READY`, `STOCKOUT`, `CREDIT_BLOCKED`). Dış sipariş gönderilmez; ayrı commitment tablosu henüz yoktur, öneri mevcut açık payables üzerinden kullanılabilir kredi hesaplar.
- Beş masaüstü terminali hesap başına beş dakikalık lease ile sınırlar; mobile lease bu kontenjana dahil değildir.
- State istasyon yetkisini backend'de filtreler; staff'a hassas borç/maliyet alanlarını açmaz. Entegrasyonlar `DISABLED`; upload/OCR/cloud çağrısı yoktur.

## Route listesi

`GET /state`, `POST /setup`, `/company`, `/station`, `/invite`, `/join`, `/shift`, `/account/open`, `/payment`, `/slip`, `/account/source`, `/account/submit`, `/account/cash-receive`, `/account/approve`, `/account/return`, `/debtor`, `/collection`, `/product`, `/stock`, `/supplier`, `/payable`, `/terminal` contract'taki body ve camelCase alanlarını kullanır.

## Test ve sınırlar

`domain.test.ts` saf, veritabanına yazmayan invariants testleridir. `pnpm check` ve StationOS domain testleri geçer. Managed MySQL olmadan migration/REST transaction canlı probe çalıştırılmadı; finansal tabloya test write yapılmadı. Canlı Turpak/YN ÖKC, banka, e-belge, OCR, görsel upload, gerçek banka bakiyesi ve otomatik sipariş bu teslimatta özellikle kapalıdır.

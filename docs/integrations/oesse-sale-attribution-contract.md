# ÖSSE–pompa–tabanca işlem eşleme sözleşmesi (taslak)

Bu belge bir entegrasyon gereksinimidir; çalışan bir otomasyon entegrasyonu,
kalıcı satış kaydı veya migration değildir. Sentetik doğrulama dışında gerçek
işletme satış verisiyle test edilmemiştir.

## Mevcut kaynak kanıtı

| Alan                                           | Mevcut model/kaynak                                                  | Kanıt türü ve sınır                                                                                                                                                                                                                                                                                          |
| ---------------------------------------------- | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| İstasyon pompası, tabanca, tank ve yakıt ürünü | `st_fuel_pumps`, `st_fuel_nozzles`, `st_fuel_tanks`, `st_fuel_types` | Uygulama konfigürasyonu. Tabanca istasyona/pompaya/tanka bağlanır; bu satış olayını göstermez.                                                                                                                                                                                                               |
| Vardiya ve personel hesabı                     | `st_shifts`, `st_accounts`, `st_shift_assignments`                   | Vardiya ve hesap kapsamı sunucuda doğrulanır. `st_accounts.user_id` hesap sahibini gösterir; tek tek satışların yapanını kanıtlamaz.                                                                                                                                                                         |
| Tabanca sayaçları                              | `st_fuel_assignments`, `st_fuel_readings`                            | Sayaç okuması hesap, vardiya tabancası, sıra ve okuma türüne bağlıdır. Otomasyon işlem ID'si, POS fişi veya fiili satış personeli alanı yoktur.                                                                                                                                                              |
| ÖSSE otomasyon satış raporu                    | PDF/XLSX draft parser                                                | Ad önerisi, işlem adedi ve toplam tutar; kaynak sayfa/satır/hücreyle taşınır. Ad kalıcı kullanıcı kimliği değildir. Kaynak formatta satış başına işlem ID'si, pompa/tabanca ve olay zamanı yoktur; vardiya zaman aralığı ayrı metadata olabilir.                                                             |
| Günlük sayısal inceleme                        | `st_daily_numeric_reviews.rows_json`                                 | Muhasebecinin doğrulama bekleyen taslak satırları; kesin satış/ölçüm değildir. Kullanıcı seçimi ve kaynak kanıtı olarak kalır.                                                                                                                                                                               |
| POS slip                                       | `st_pos_slip_drafts`, `PosSlipValues`                                | OCR/manual taslakta tarih-saat, tutar, banka, terminal, referans, satış/iptal/iade ve ödeme türü bulunabilir. `staff_user_id` slipi yükleyen/beğen beyanını yapan personel bağlamıdır; satışın pompa/tabancadaki fiili satıcısını kanıtlamaz. Slip modelinde pompa/nozzle veya otomasyon event ID'si yoktur. |
| İptal/düzeltme                                 | POS slip işlem türü ve rapor/snapshot revizyonları                   | POS'ta `VOID`/`REFUND` tipi çıkabilir; otomasyon kaynağında satış başına reversal ilişki alanı mevcut fixture/modelde yoktur.                                                                                                                                                                                |

Sonuç: mevcut sentetik otomasyon raporu fixture'ları yalnız personel bazlı
toplamları doğrular. İşlem düzeyinde otomasyon kimliği, pompa, tabanca, zaman,
ürün/litre, personel ve reversal zinciri içeren doğrulanmış gerçek/yerel kaynak
bulunmadı. Bu alanlar mevcutmuş gibi sunulamaz.

## Önerilen kaynak export sözleşmesi

Otomasyon sağlayıcısı her olayı değişmez, tekrar kullanılabilir bir
`sourceSystem + sourceEventId` çiftiyle vermeli. Her satır en az şu alanları
içermeli:

```json
{
  "sourceSystem": "provider-identifier",
  "sourceEventId": "immutable-provider-event-id",
  "tenantId": "mapped-tenant-id",
  "stationId": "mapped-station-id",
  "shiftId": "provider-shift-id",
  "pumpId": "provider-pump-id",
  "nozzleId": "provider-nozzle-id",
  "soldAt": "2026-11-10T22:15:00+03:00",
  "productId": "mapped-fuel-product-id",
  "volumeMl": 42100,
  "amountMinor": 245700,
  "staffUserId": 101,
  "eventType": "SALE",
  "reversesSourceEventId": null,
  "evidenceRef": "authorized-source-document-or-event-reference"
}
```

`volumeMl` mililitre, `amountMinor` kuruş tamsayısıdır. Provider alanları ile
İstasyonOS kimlikleri için tenant+istasyon kapsamlı yönetici eşleme gerekir.
Provider'ın `staffUserId` alanının kaynağı (PIN/badge/terminal oturumu) ve
güven seviyesi sözleşmede belgelenmelidir. Bir dosya satırındaki yazılı isim,
yükleyen kullanıcının hesabı, vardiya saati, aynı pompayı kullanmış olma veya
POS tutar benzerliği personel sahipliği kanıtı sayılmaz.

`VOID`, `REFUND`, `CORRECTION` olayları orijinal `sourceEventId` ile bağlanmalı;
zincir ve net etki muhasebe incelemesi olmadan otomatik uygulanmamalıdır. Aynı
event ID tekrar geldiğinde ikinci satış/sayaç hareketi yaratılmamalı; payload
farkı çakışma incelemesine gitmelidir.

## Kod taslağı ve kapalı özellikler

### Ürün kapsamı kararı (11.11.2026)

Bu yazılım sürümünde satışların ÖSSE/pompa/tabanca bazında işlem düzeyinde
eşleştirilmesi zorunlu değildir ve canlı akışa bağlanmayacaktır. İşletme
mutabakatı, kimlik/istasyon/tarih/vardiya kapsamı doğrulanmış personel bazlı
otomasyon vardiya toplamı üzerinden yürütülür. Aşağıdaki transaction-level
sözleşme yalnız gelecekteki entegrasyonlar için taslaktır; pompa/tabanca
kataloğu salt okunur kalır ve satış sahipliği oluşturmaz.

`shared/oesse-sale-attribution.ts` yalnız saf doğrulama taslağıdır. Aynı
tenant/istasyon/vardiya, atanmış personel, kayıtlı pompa-tabanca-ürün bağı,
vardiya zaman aralığı, stabil event kimliği, ölçü birimleri ve kanıt referansı
kontrol edilir. Eksik personel `UNASSIGNED`, diğer uyuşmazlıklar
`REVIEW_REQUIRED` olur. Yinelenen event kimliği tüm toplamı bloke eder.

Taslak sonucu hiçbir tabloya yazılmaz; `financialApplied`,
`meterReadingCreated` ve `personnelDebtCreated` daima `false` kalır. Yalnız
tam ve sentetik/test girdileri `DRAFT_READY` olabilir. Gerçek veri kaynağı,
server-side tenant/personel/pompa doğrulaması, audit/revision saklama şeması,
idempotency ve bağımsız muhasebe onayı hazır olmadan bu doğrulayıcı canlı
mutasyon yoluna bağlanmamalıdır.

ÖSSE mobilde istasyon pompa/tabanca kataloğunu mevcut yetkili `GET
/api/stationos/fuel?stationId=...` yolundan salt okunur görebilir. Bu görünüm
`st_fuel_assignments` sayaç kilidini değiştirmez. Şu anki `FUEL_NOZZLE_BUSY`
engeli ve `st_fuel_assignments` bir vardiyada tabanca başına tek sayaç sahibi
olma kuralı korunur.

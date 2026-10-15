# AKARYAKIT V1.7 — stok/cari sentetik olay test sonucu

> Bu rapor gerçek API, mobil istemci, OCR servisi veya ödeme ağı çağırmadan; yalnızca geçici PostgreSQL üzerinde v1.4 + v1.5 şeması ve v1.6 sorgularıyla üretilmiştir.

- **PostgreSQL:** `PostgreSQL 16.15 (Ubuntu 16.15-0ubuntu0.24.04.1) on x86_64-pc-linux-gnu, compiled by gcc (Ubuntu 13.3.0-6ubuntu2~24.04.1) 13.3.0, 64-bit`
- **Toplam geçen:** **19**; **başarısız:** **0**
- **Rapor yolu:** `/home/ubuntu/projects/akaryakit-v1-37b46808/test-v1.7-stok-cari-sonuclari.md`
- **Parasal esas:** tüm tutarlar sentetik demo **TRY minor** birimleridir; gerçek muhasebe postu değildir.
- **Olay zamanı:** sabit `2026-10-10`, sorgu ve timestamp dönüşümü `Europe/Istanbul`.

## Olay → SQL → beklenen → gözlenen

| # | Olay | SQL / sorgu | Beklenen | Gözlenen | Durum |
|---:|---|---|---|---|:---:|
| 1 | SALE | SQL-1 stock projection | projected_end_qty=4, stock_risk=OK | {"qty": "4.000", "risk": "OK"} | **PASS** |
| 2 | SALE -> inventory_movements(-6) | SQL-1 stock projection | ilk gün STOCKOUT_RISK ve -2 | {"on_hand": "4.000", "qty": "-2.000", "risk": "STOCKOUT_RISK"} | **PASS** |
| 3 | SALE yeni sale_id, aynı source_event_id | INSERT ops.sales ... UNIQUE(tenant,business_unit,source_event_id) | UniqueViolation ve 'source_event' | UniqueViolation: duplicate key value violates unique constraint "sales_tenant_id_business_unit_id_source_event_id_key" | **PASS** |
| 4 | duplicate SALE source event | claim_event + inventory_movements + inventory_balances | ikinci çağrı uygulanmaz, tek hareket ve stok 4 | {"applied": false, "movement_count": 1, "on_hand": "4.000"} | **PASS** |
| 5 | SUPPLIER_CONFIRMATION | SQL-1 inbound by expected_delivery_at | day 1 STOCKOUT_RISK | {"arrival_day2": "6.000", "d1": "STOCKOUT_RISK"} | **PASS** |
| 6 | SUPPLIER_DELIVERY_RESCHEDULED -> AS_OF | SQL-1 inbound + window SUM | tüm ufuk OK, day0 arrival=6 | {"day0": "6.000", "risks": ["OK", "OK", "OK"]} | **PASS** |
| 7 | SUPPLIER_DELIVERY_RESCHEDULED -> AS_OF+5 | SQL-1 inbound horizon filter | day 1 STOCKOUT_RISK, ufukta arrival yok | {"arrivals": ["0", "0", "0"], "d1": "STOCKOUT_RISK"} | **PASS** |
| 8 | GOODS_RECEIPT(+10) | v_open_supply + inventory_balances | open 10->0, on_hand 2->12 | {"on_hand": "12.000", "open_after": null, "open_before": "10.000"} | **PASS** |
| 9 | duplicate GOODS_RECEIPT | demo event idempotency + movement UNIQUE | tek hareket, on_hand=12 | {"movement_count": 1, "on_hand": "12.000"} | **PASS** |
| 10 | duplicate GOODS_RECEIPT direct insert | INSERT market.inventory_movements | UniqueViolation ve '' | UniqueViolation: duplicate key value violates unique constraint "inventory_movements_tenant_id_station_id_source_type_source_key" | **PASS** |
| 11 | SUPPLIER_INVOICE | INSERT supplier_ap_open_items + UPDATE purchase_order_lines in one transaction | old=(0,1000), repeatable observer old kalır, commit sonrası=(1000,0) | {"new": {"ap_minor": "1000", "unbilled_minor": "0.000"}, "observer": {"ap_minor": "0", "unbilled_minor": "1000.000"}, "old": {"ap_minor": "0", "unbilled_minor": "1000.000"}} | **PASS** |
| 12 | company credit exposure | SQL-2 company supplier risk | remaining=100 (limit 1100 - AP 1000 - unbilled 0) | {"ap": "1000", "codes": [], "remaining": "100.000", "unbilled": "0.000"} | **PASS** |
| 13 | DEMO_SUPPLIER_PAYMENT | UPDATE supplier_ap_open_items (projection only) | AP 1000->400, remaining=700 | {"components": {"ap_minor": "400", "unbilled_minor": "0.000"}, "remaining": "700.000"} | **PASS** |
| 14 | STALE_INVENTORY_SNAPSHOT | SQL-1 returns snapshot_at; runner freshness gate | >24 saat için STALE_SNAPSHOT_WARNING | {"age_hours": 84.0, "snapshot_at": "2026-10-07T00:00:00+03:00", "warning": true} | **PASS** |
| 15 | AMOUNT_BASIS_UNVERIFIED | SQL-2 :amount_basis_verified=false | usable_remaining_minor NULL + AMOUNT_BASIS_UNKNOWN | {"codes": ["AMOUNT_BASIS_UNKNOWN"], "usable": null} | **PASS** |
| 16 | TRY supplier account line -> USD | UPDATE recommendation_lines SET currency_code='USD' | ForeignKeyViolation ve '' | ForeignKeyViolation: insert or update on table "recommendation_lines" violates foreign key constraint "recommendation_lines_tenant_id_station_id_business_unit_id_fkey" | **PASS** |
| 17 | RECOMMENDATION_LINE estimated_cost=NULL | SQL-2 proposal_quality | usable NULL + INCOMPLETE_EXPOSURE | {"codes": ["INCOMPLETE_EXPOSURE"], "usable": null} | **PASS** |
| 18 | AP_SNAPSHOT_INCOMPLETE | SQL-2 :ap_snapshot_complete=false | usable NULL + INCOMPLETE_EXPOSURE | {"codes": ["INCOMPLETE_EXPOSURE"], "usable": null} | **PASS** |
| 19 | TWO ORDER APPROVERS | service tx: SELECT company_supplier_accounts FOR UPDATE; recompute AP+unbilled; approve/rollback | accepted=1, rejected=1, commitment=700 | {"commitment": "700.000", "outcomes": [{"accepted": true, "exposure_before": "0", "label": "A", "limit": "1000"}, {"accepted": false, "exposure_before": "700.000", "label": "B", "limit": "1000"}]} | **PASS** |

## Sınırlar ve yorum

- **Snapshot:** v1.6 SQL-1 `snapshot_at` döndürür fakat tazelik eşiğini SQL risk kodu olarak üretmez. Betik 24 saatten eski snapshot için açık `STALE_SNAPSHOT_WARNING` üretir; bu bir servis/çağıran gate'idir.
- **Zaman penceresi:** `expected_delivery_at AT TIME ZONE 'Europe/Istanbul'` ile gün kovasına alınır; gecikme ufuk dışına çıktığında teyitli PO da inbound sayılmaz.
- **Idempotency:** `ops.sales` ve `market.inventory_movements` source-event UNIQUE kısıtları doğrudan denenmiştir. Demo event tablosu TEMP'tir; üretim event-store veya API değildir. Mal kabul duplicate çağrısı stok ve `accepted_qty` değerini ikinci kez artırmaz.
- **Fatura/unbilled atomikliği:** sentetik fatura transaction'ı AP open item ekleyip PO `invoiced_qty` değerini aynı commit'te günceller. Repeatable-read gözlemci ya eski `(AP=0, unbilled=1000)` ya yeni `(AP=1000, unbilled=0)` çifti görür; karışık çift görmez.
- **Ödeme:** demo supplier ödeme olayı yalnız `supplier_ap_open_items.open_amount_minor` projeksiyonunu 1000'den 400'e çeker. Gerçek banka/ledger postu veya tahsilat entegrasyonu yapılmamıştır.
- **Race sınırı:** iki Python thread'i 3 saniye `lock_timeout`, 10 saniye `statement_timeout` ile aynı `company_supplier_accounts` satırını `FOR UPDATE` kilitler; her biri kilit altında AP + unbilled'ı yeniden hesaplar. Limit 1000, her istek 700 olduğundan yalnız bir PO kabul edilir. Bu, v1.5 yorumunda istenen örnek servis transaction'ıdır; şemanın tek başına bu iş kuralını garanti ettiği iddia edilmez.
- **Gates:** yanlış TRY/USD eşlemesi FK ile reddedildi; `amount_basis_verified=false`, `ap_snapshot_complete=false` ve NULL öneri maliyeti kullanılabilir limiti NULL'a düşürdü. Net/brüt, para birimi ve maliyet esasları güvenilir servis girdisi olmadan açılmaz.
- **Güvenlik/çalıştırma:** yalnız `--allow-demo-schema`, `PGUSER=postgres` ve `PG_CLUSTER_CONF_ROOT=/tmp/pg_virtualenv.*` ile çalışır; başlangıçta `core/ops/evidence/ar/market` şemaları varsa durur. DDL yalnız boş disposable DB'ye uygulanır; üretim migration'ı, veri silme/paylaşma ve dış API yoktur.


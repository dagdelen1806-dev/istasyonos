#!/usr/bin/env python3
"""Kaynaklı tarife + kullanıcı hacmi; gerçek fatura/teklif değildir. Yalnız yerel dosya üretir."""
from pathlib import Path
from decimal import Decimal, ROUND_HALF_UP, ROUND_CEILING
import json
import csv

ROOT = Path(__file__).resolve().parent
D = Decimal
CENTS = D('0.01')


def money(value):
    return str(value.quantize(CENTS, rounding=ROUND_HALF_UP))


def vision_cost(requests, p, use_free):
    free = p['vision_free_units_per_month_if_available'] if use_free else 0
    first = max(0, min(requests, p['vision_first_tier_limit']) - free)
    second = max(0, requests - p['vision_first_tier_limit'])
    return D(first) * D(p['ocr_unit_price_first_tier']) + D(second) * D(p['vision_unit_price_above_first_tier'])


def main():
    p = json.loads((ROOT / 'maliyet-v2.1-parametreler.json').read_text())
    rows = []
    profiles = []
    for name, values in p['profiles'].items():
        fixed = sum(D(v) for k, v in values.items() if k != 'vm_daily_backup_rate')
        vm_total = sum(D(values[k]) for k in ('application_vms', 'worker_vms', 'staging_vm'))
        vm_backup = vm_total * D(values['vm_daily_backup_rate'])
        profiles.append({'profile': name, 'fixed_excluding_object_storage_usd': money(fixed + vm_backup),
                         'vm_daily_backup_usd': money(vm_backup)})
        stations = 5 if 'five_stations' in name else p['first_pilot_station_count']
        for daily in (p['daily_slips_per_station_low'], p['daily_slips_per_station_high']):
            slips = stations * daily * p['calendar_days_per_month']
            requests = int((D(slips) * (1 + D(p['ocr_extra_request_rate']))).to_integral_value(rounding=ROUND_CEILING))
            primary_gib = D(slips) * D(p['capacity_retention_days_not_legal_policy']) / D(p['calendar_days_per_month']) * (D(p['masked_image_mib']) + D(p['thumbnail_mib'])) / D(1024)
            object_cost = D(p['spaces_base_usd']) + max(D(0), primary_gib - D(p['spaces_included_gib'])) * D(p['spaces_extra_storage_per_gib'])
            ocr = vision_cost(requests, p, True)
            ocr_full = vision_cost(requests, p, False)
            subtotal = fixed + vm_backup + object_cost + ocr
            subtotal_full = fixed + vm_backup + object_cost + ocr_full
            low = subtotal + D(p['operational_addons_low_usd'])
            high = subtotal + D(p['operational_addons_high_usd'])
            review_hours = D(slips) * D(p['review_example_rate']) * D(p['review_example_seconds']) / D(3600)
            basic_confirm_hours = D(slips) * D(5) / D(3600)
            rows.append({
                'profile': name, 'stations': stations, 'daily_slips_per_station': daily,
                'monthly_unique_slips': slips, 'monthly_ocr_requests_with_5pct_extra': requests,
                'vision_ocr_usd_if_1000_free_available': money(ocr),
                'vision_ocr_usd_no_free_quota': money(ocr_full),
                'textract_expense_usd_comparison_not_turkish_recommendation': money(D(requests) * D(p['textract_expense_comparison_only_unit_price'])),
                'active_primary_image_storage_gib_90d_assumption': str(primary_gib.quantize(D('0.001'))),
                'primary_storage_monthly_usd_at_90d_steady_state': money(object_cost),
                'published_cloud_and_ocr_subtotal_usd': money(subtotal),
                'planning_total_low_with_ops_allowance_usd': money(low),
                'planning_total_high_with_ops_allowance_usd': money(high),
                'budget_low_plus_15pct_contingency_usd': money(low * (1 + D(p['contingency_rate']))),
                'budget_high_plus_15pct_contingency_usd': money(high * (1 + D(p['contingency_rate']))),
                'planning_total_high_no_free_quota_usd': money(subtotal_full + D(p['operational_addons_high_usd'])),
                'annualized_low_excludes_turpak_labor_tax_usd': money(low * 12),
                'annualized_high_excludes_turpak_labor_tax_usd': money(high * 12),
                'exception_review_hours_at_10pct_and_20sec_example': str(review_hours.quantize(D('0.01'), rounding=ROUND_HALF_UP)),
                'all_slip_confirmation_hours_at_5sec_example': str(basic_confirm_hours.quantize(D('0.01'), rounding=ROUND_HALF_UP)),
                'total_confirmation_and_extra_review_hours_example': str((basic_confirm_hours + review_hours).quantize(D('0.01'), rounding=ROUND_HALF_UP)),
                'turpak_monthly_usd': 'TEKLIF_BEKLENIYOR',
                'human_labor_and_taxes': 'DAHIL_DEGIL'
            })
    csv_names = {
        'profile': 'Ortam profili', 'stations': 'İstasyon adedi',
        'daily_slips_per_station': 'İstasyon başına günlük slip',
        'monthly_unique_slips': 'Aylık özgün slip',
        'monthly_ocr_requests_with_5pct_extra': 'Aylık OCR isteği yüzde 5 ek payla',
        'vision_ocr_usd_if_1000_free_available': 'Vision OCR USD ücretsiz 1000 kota varsa',
        'vision_ocr_usd_no_free_quota': 'Vision OCR USD ücretsiz kota yoksa',
        'textract_expense_usd_comparison_not_turkish_recommendation': 'Textract Expense USD yalnız fiyat referansı Türkçe öneri değil',
        'active_primary_image_storage_gib_90d_assumption': '90 gün varsayımı primary görsel GiB',
        'primary_storage_monthly_usd_at_90d_steady_state': 'Primary storage USD 90 günlük dolu havuzda',
        'published_cloud_and_ocr_subtotal_usd': 'Tarifeli bulut ve OCR alt toplam USD',
        'planning_total_low_with_ops_allowance_usd': 'Yardımcı paylı aylık düşük USD',
        'planning_total_high_with_ops_allowance_usd': 'Yardımcı paylı aylık yüksek USD',
        'budget_low_plus_15pct_contingency_usd': 'Yüzde 15 tamponlu düşük bütçe USD',
        'budget_high_plus_15pct_contingency_usd': 'Yüzde 15 tamponlu yüksek bütçe USD',
        'planning_total_high_no_free_quota_usd': 'Ücretsiz kota yokken aylık yüksek USD',
        'annualized_low_excludes_turpak_labor_tax_usd': 'Yıllıklaştırılmış düşük USD Turpak iş gücü vergi hariç',
        'annualized_high_excludes_turpak_labor_tax_usd': 'Yıllıklaştırılmış yüksek USD Turpak iş gücü vergi hariç',
        'exception_review_hours_at_10pct_and_20sec_example': 'Yüzde 10 istisna 20 saniye ek inceleme saat varsayımı',
        'all_slip_confirmation_hours_at_5sec_example': 'Tüm slip 5 saniye teyit saat varsayımı',
        'total_confirmation_and_extra_review_hours_example': 'Teyit ve ek inceleme toplam saat varsayımı',
        'turpak_monthly_usd': 'Turpak aylık ücret durumu',
        'human_labor_and_taxes': 'İş gücü ve vergi durumu'
    }
    profile_names = {
        'shadow_pilot_not_ha': 'Gölge pilot HA değil',
        'production_ha_pilot': 'Bir istasyon HA üretim pilotu',
        'production_ha_five_stations_capacity_assumption': 'Beş istasyon HA kapasite varsayımı'
    }
    with (ROOT / 'maliyet-v2.1-aylik-senaryolar.csv').open('w', encoding='utf-8-sig', newline='') as f:
        writer = csv.DictWriter(f, fieldnames=[csv_names[k] for k in rows[0]])
        writer.writeheader()
        writer.writerows({csv_names[k]: profile_names.get(v, v) if k == 'profile' else v
                          for k, v in row.items()} for row in rows)
    result = {'parameters': p, 'profiles': profiles, 'scenarios': rows,
              'note': 'Tarifeler 10 Ekim 2026 araştırması. Vergi, kur, insan iş gücü, Turpak lisans/API/bakım ve cihaz/veri hattı teklifleri hariç. HA aynı sağlayıcıdaki düğüm yedekliliğidir; cross-region DR değildir. 90 gün yalnız kapasite varsayımı.'}
    (ROOT / 'maliyet-v2.1-hesap-sonuclari.json').write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n')
    for r in rows:
        print(r['profile'], 'slip/gun=', r['daily_slips_per_station'], 'OCR_USD=', r['vision_ocr_usd_if_1000_free_available'],
              'AYLIK=', r['planning_total_low_with_ops_allowance_usd'], '..', r['planning_total_high_with_ops_allowance_usd'],
              'TAMPONLU=', r['budget_low_plus_15pct_contingency_usd'], '..', r['budget_high_plus_15pct_contingency_usd'],
              'REVIEW_SAAT=', r['exception_review_hours_at_10pct_and_20sec_example'])
    print('ÜRETİLDİ', ROOT / 'maliyet-v2.1-aylik-senaryolar.csv')
    print('ÜRETİLDİ', ROOT / 'maliyet-v2.1-hesap-sonuclari.json')


if __name__ == '__main__':
    main()

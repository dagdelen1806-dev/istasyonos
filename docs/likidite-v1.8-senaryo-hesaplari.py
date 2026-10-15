#!/usr/bin/env python3
"""Mevcut v1.7 demo likiditesinin deterministik senaryo doğrulaması.

Gerçek işletme/banka analizi değildir. Girişler v1.7 HTML fixture'ından gelir.
Komisyon/valör varyantları sözleşme oranı değil duyarlılık testidir.
Çalıştırma: python3 likidite-v1.8-senaryo-hesaplari.py
Çıktı: likidite-v1.8-gunluk-senaryolar.csv ve likidite-v1.8-hesap-ozeti.json.
Dış API, ödeme, veritabanı veya prototip dosyasını değiştirmez.
"""
from dataclasses import dataclass
from datetime import date, timedelta
from decimal import Decimal, ROUND_HALF_UP
from pathlib import Path
import csv
import json

ROOT = Path(__file__).resolve().parent
START = date(2026, 10, 11)
BUFFER = 2000000  # 20.000 TL firma toplamı: yalnız önerilen test eşiği.
# Values are integer minor TRY. Snapshot 2026-10-10, no future new sales.
STATIONS = [
    dict(id='S01', cash=1200000, bank=3000000, card=2000000, iban=70000),
    dict(id='S02', cash=900000, bank=1500000, card=1500000, iban=70000),
    dict(id='S03', cash=700000, bank=1800000, card=1000000, iban=50000),
    dict(id='S04', cash=600000, bank=1400000, card=900000, iban=40000),
    dict(id='S05', cash=500000, bank=1000000, card=700000, iban=30000),
]
for index, station in enumerate(STATIONS):
    station.update(float=10000, ar=1500000 + index*100000 + 200000 + index*20000,
                   ap_overdue=500000 + index*50000, ap_due=4000000 + index*200000,
                   daily_opex=15000)


@dataclass(frozen=True)
class Scenario:
    name: str
    rate: Decimal = Decimal('.02')
    card_day: int = 1
    ar_day: int = 2
    ar_fraction: Decimal = Decimal('1')
    po_minor: int = 0
    overdue_day: int = 1
    card_hold_fraction: Decimal = Decimal('0')
    unavailable_opening: int = 0
    refund_minor: int = 0


def round_minor(amount: Decimal) -> int:
    return int(amount.quantize(Decimal('1'), rounding=ROUND_HALF_UP))


def calculate(scenario: Scenario, stations=STATIONS, buffer=BUFFER):
    opening = sum(s['cash'] + s['bank'] - s['float'] for s in stations) - scenario.unavailable_opening
    gross_card = sum(s['card'] for s in stations)
    scheduled_gross = round_minor(Decimal(gross_card) * (1 - scenario.card_hold_fraction))
    # Gross held receivables get no settlement fee until actual settlement in this model.
    fee = round_minor(Decimal(scheduled_gross) * scenario.rate)
    net_card = scheduled_gross - fee
    ar = round_minor(Decimal(sum(s['ar'] for s in stations)) * scenario.ar_fraction)
    balance = opening
    rows = []
    for day in range(1, 8):
        current = START + timedelta(days=day-1)
        card_cash = net_card if day == scenario.card_day else 0
        ar_cash = ar if day == scenario.ar_day else 0
        ap = sum(s['ap_overdue'] for s in stations) if day == scenario.overdue_day else 0
        if day == 3:
            ap += sum(s['ap_due'] for s in stations)
        opex = sum(s['daily_opex'] for s in stations)
        po = scenario.po_minor if day == 3 else 0
        refund = scenario.refund_minor if day == 1 else 0
        start = balance
        balance += card_cash + ar_cash - ap - opex - po - refund
        rows.append(dict(scenario=scenario.name, date=current.isoformat(), opening_minor=start,
                         card_net_minor=card_cash, ar_expected_minor=ar_cash,
                         ap_payment_minor=ap, cash_opex_minor=opex, new_po_minor=po,
                         refund_minor=refund, closing_minor=balance,
                         buffer_gap_minor=max(0, buffer-balance)))
    minimum = min([opening]+[r['closing_minor'] for r in rows])
    first_negative = next((r['date'] for r in rows if r['closing_minor'] < 0), None)
    return dict(scenario=scenario.name, opening_minor=opening, gross_card_minor=gross_card,
                held_card_minor=gross_card-scheduled_gross, fee_minor=fee, net_card_minor=net_card,
                minimum_minor=minimum, first_negative_date=first_negative,
                maximum_buffer_gap_minor=max(0, buffer-minimum),
                ending_minor=rows[-1]['closing_minor'], rows=rows)


SCENARIOS = [
    Scenario('V17_BASE'),
    Scenario('COMMISSION_1', rate=Decimal('.01')),
    Scenario('COMMISSION_3', rate=Decimal('.03')),
    Scenario('COMMISSION_4', rate=Decimal('.04')),
    # Monday receipt is a hypothetical supplier calendar, NOT a bank promise.
    Scenario('MONDAY_CARD_DAY2', card_day=2),
    Scenario('MONDAY_CARD_AND_OVERDUE', card_day=2, overdue_day=2),
    Scenario('CARD_DELAY_DAY4', card_day=4),
    Scenario('CARD_OUTSIDE_HORIZON', card_day=8),
    Scenario('AR_HALF'),  # replaced below with the fractional version
    Scenario('AR_ALL_OUTSIDE_HORIZON', ar_day=8),
    Scenario('NEW_PO_25000', po_minor=2500000),
    Scenario('CARD_HOLD_20PCT', card_hold_fraction=Decimal('.20')),
    Scenario('OPENING_UNAVAILABLE_30000', unavailable_opening=3000000),
    Scenario('REFUND_5000', refund_minor=500000),
    Scenario('COMBINED_STRESS', rate=Decimal('.03'), card_day=4,
             ar_fraction=Decimal('.50'), po_minor=2500000),
]
SCENARIOS[8] = Scenario('AR_HALF', ar_fraction=Decimal('.50'))


def main():
    results = [calculate(s) for s in SCENARIOS]
    by_name = {r['scenario']: r for r in results}
    assert by_name['V17_BASE']['ending_minor'] == 2703000
    assert by_name['AR_HALF']['minimum_minor'] == -2147000
    assert by_name['NEW_PO_25000']['minimum_minor'] == 203000
    assert by_name['CARD_DELAY_DAY4']['first_negative_date'] == '2026-10-13'
    assert by_name['COMMISSION_3']['fee_minor'] - by_name['V17_BASE']['fee_minor'] == 61000
    assert by_name['CARD_HOLD_20PCT']['held_card_minor'] == 1220000
    station_results = []
    for station in STATIONS:
        result = calculate(Scenario('V17_BASE'), [station], buffer=0)
        result.pop('rows')
        station_results.append(dict(station=station['id'], **result))
    assert sum(r['ending_minor'] for r in station_results) == by_name['V17_BASE']['ending_minor']
    # Minimum balances must never be summed as though they were at the same timestamp.
    # Exact gross-card rounded transaction/fee reconciliation belongs to bank matching.
    rows = [row for result in results for row in result['rows']]
    with (ROOT/'likidite-v1.8-gunluk-senaryolar.csv').open('w', newline='', encoding='utf-8-sig') as f:
        writer = csv.DictWriter(f, fieldnames=list(rows[0]))
        writer.writeheader(); writer.writerows(rows)
    summary = {
        'basis': 'v1.7 existing synthetic fixture, integer minor TRY, not real bank data',
        'snapshot': '2026-10-10', 'period': '2026-10-11/2026-10-17',
        'buffer_minor': BUFFER,
        'scenarios': [{k:v for k,v in result.items() if k!='rows'} for result in results],
        'station_base': station_results,
        'ar_recovery_fraction_break_even': str(Decimal(9700000-2703000)/Decimal(9700000)),
        'ar_fraction_for_20000_buffer': str(Decimal(9700000-2703000+BUFFER)/Decimal(9700000)),
        'new_po_max_for_20000_buffer_minor': by_name['V17_BASE']['minimum_minor']-BUFFER,
    }
    (ROOT/'likidite-v1.8-hesap-ozeti.json').write_text(json.dumps(summary, ensure_ascii=False, indent=2)+'\n')
    print('PASS: baz/stres/PO/komisyon/valör/bloke/istasyon toplamı aritmetik kontrolleri')
    for result in results:
        print(result['scenario'], 'fee', result['fee_minor'], 'min', result['minimum_minor'],
              'negative', result['first_negative_date'], 'gap', result['maximum_buffer_gap_minor'])
    print('STATIONS', [(r['station'],r['minimum_minor']) for r in station_results])
    print('AR break-even', summary['ar_recovery_fraction_break_even'])
    print('AR 20k buffer', summary['ar_fraction_for_20000_buffer'])
    print('MAX new PO buffer', summary['new_po_max_for_20000_buffer_minor'])
    print('FILES',ROOT/'likidite-v1.8-gunluk-senaryolar.csv',ROOT/'likidite-v1.8-hesap-ozeti.json')

if __name__ == '__main__':
    main()

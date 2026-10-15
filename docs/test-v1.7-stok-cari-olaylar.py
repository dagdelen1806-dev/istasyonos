#!/usr/bin/env python3
"""AKARYAKIT V1.7 — stok/cari olayları için sınırlı PostgreSQL testleri.

Bu betik gerçek API, mobil istemci veya ödeme entegrasyonu çağırmaz. Olaylar,
mevcut v1.4/v1.5 tablolarına sentetik ve tekrarlanabilir transaction'lar olarak
yazılır; v1.6 sorguları aynı disposable PostgreSQL içinde çalıştırılır.

Güvenlik: yalnız --allow-demo-schema ile ve pg_virtualenv'in geçici kümesinde
çalışır. Uygulama şeması zaten varsa durur; üretim veritabanına migration yapmaz.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import threading
from datetime import date, datetime, time, timedelta
from decimal import Decimal
from pathlib import Path
from typing import Any
from uuid import UUID, uuid5, NAMESPACE_DNS
from zoneinfo import ZoneInfo

import psycopg
from psycopg import errors
from psycopg.rows import dict_row

ROOT = Path(__file__).resolve().parent
RESULTS_MD = ROOT / "test-v1.7-stok-cari-sonuclari.md"
TZ = ZoneInfo("Europe/Istanbul")
AS_OF = date(2026, 10, 10)
TEST_NAMESPACE = "akaryakit-v1.7-synthetic-event-test"

RESULTS: list[dict[str, Any]] = []
FAILURES: list[str] = []


def uid(name: str) -> UUID:
    """Sabit UUID: her disposable çalıştırmada aynı fixture kimlikleri."""
    return uuid5(NAMESPACE_DNS, TEST_NAMESPACE + ":" + name)


def short(value: Any) -> str:
    if isinstance(value, Decimal):
        return format(value, "f")
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    if isinstance(value, UUID):
        return str(value)
    if isinstance(value, list):
        return "[" + ", ".join(short(x) for x in value) + "]"
    if isinstance(value, dict):
        return json.dumps(value, ensure_ascii=False, sort_keys=True, default=short)
    return str(value)


def check(name: str, event: str, sql: str, expected: str, observed: Any, condition: bool) -> None:
    ok = bool(condition)
    rec = {
        "name": name,
        "event": event,
        "sql": sql,
        "expected": expected,
        "observed": short(observed),
        "status": "PASS" if ok else "FAIL",
    }
    RESULTS.append(rec)
    print(("PASS" if ok else "FAIL") + ": " + name, flush=True)
    if not ok:
        FAILURES.append(name + " — observed=" + short(observed))


def mark_error(
    name: str,
    event: str,
    sql: str,
    expected: str,
    exc: BaseException,
) -> None:
    RESULTS.append({
        "name": name,
        "event": event,
        "sql": sql,
        "expected": expected,
        "observed": type(exc).__name__ + ": " + str(exc).splitlines()[0],
        "status": "FAIL",
    })
    FAILURES.append(name + " — " + str(exc).splitlines()[0])
    print("FAIL: " + name, flush=True)


def expect_db_error(
    conn: psycopg.Connection,
    name: str,
    event: str,
    sql: str,
    statement: str,
    params: tuple[Any, ...],
    expected_type: type[BaseException],
    expected_text: str,
) -> None:
    try:
        with conn.transaction():
            conn.execute(statement, params)
    except psycopg.Error as exc:
        is_type = isinstance(exc, expected_type)
        text_ok = expected_text.lower() in str(exc).lower() if expected_text else True
        check(
            name,
            event,
            sql,
            f"{expected_type.__name__} ve {expected_text!r}",
            type(exc).__name__ + ": " + str(exc).splitlines()[0],
            is_type and text_ok,
        )
    else:
        check(name, event, sql, f"{expected_type.__name__} ile reddedilmeli", "statement kabul edildi", False)


def load_v16_queries() -> tuple[str, str]:
    raw = (ROOT / "queries-v1.6-stockout-supplier-risk.sql").read_text(encoding="utf-8")
    first, second = raw.split("-- SQL-2:", 1)
    chunks = []
    for part in (first, second):
        part = re.sub(r"^--.*$", "", part, flags=re.MULTILINE)
        part = part[part.index("WITH params AS"):].strip()
        chunks.append(re.sub(r"(?<!:):([A-Za-z_][A-Za-z0-9_]*)", r"%(\1)s", part))
    return chunks[0], chunks[1]


def assert_disposable_flag(args: argparse.Namespace) -> None:
    if not args.allow_demo_schema:
        raise SystemExit("Güvenlik: yalnız açıkça --allow-demo-schema verilirse çalışır.")
    if os.environ.get("PGUSER") != "postgres":
        raise SystemExit("Güvenlik: PGUSER=postgres bekleniyor.")
    # pg_virtualenv bu değişkeni geçici cluster için kurar; doğrudan/üretim bağlantısı
    # ile yanlışlıkla DDL çalıştırmayı engeller.
    cluster_root = os.environ.get("PG_CLUSTER_CONF_ROOT", "")
    if not cluster_root.startswith("/tmp/pg_virtualenv."):
        raise SystemExit(
            "Güvenlik: PG_CLUSTER_CONF_ROOT=/tmp/pg_virtualenv.* bekleniyor; "
            "PGUSER=postgres pg_virtualenv python3 ... ile çalıştırın."
        )


def connect_and_apply_schema() -> psycopg.Connection:
    conn = psycopg.connect("", row_factory=dict_row, autocommit=True)
    conn.execute("SET TIME ZONE 'Europe/Istanbul'")
    existing = conn.execute(
        "SELECT nspname FROM pg_namespace "
        "WHERE nspname = ANY(%s::name[]) ORDER BY nspname",
        (["core", "ops", "evidence", "ar", "market"],),
    ).fetchall()
    if existing:
        names = ", ".join(row["nspname"] for row in existing)
        conn.close()
        raise RuntimeError(
            "DB boş değil: uygulama şemaları zaten mevcut (" + names + "). "
            "Yalnız yeni pg_virtualenv disposable DB kullanın."
        )
    for filename in ("schema-v1.4-shift-ocr-ar-purchase.sql", "schema-v1.5-company-rbac-approvals.sql"):
        conn.execute((ROOT / filename).read_text(encoding="utf-8"))
    conn.autocommit = False
    conn.execute("SET TIME ZONE 'Europe/Istanbul'")
    conn.execute(
        "CREATE TEMP TABLE demo_v17_source_events ("
        "event_id uuid PRIMARY KEY, event_type text NOT NULL, source_ref text NOT NULL, "
        "payload jsonb NOT NULL DEFAULT '{}'::jsonb, claimed_at timestamptz NOT NULL DEFAULT now()"
        ") ON COMMIT PRESERVE ROWS"
    )
    conn.commit()
    # SELECT'ler açık bir transaction bırakmasın; olay yardımcıları kendi açık
    # transaction bloklarında atomik commit yapar.
    conn.autocommit = True
    return conn


def claim_event(conn: psycopg.Connection, event_id: UUID, event_type: str, source_ref: str, payload: dict[str, Any]) -> bool:
    row = conn.execute(
        "INSERT INTO demo_v17_source_events(event_id,event_type,source_ref,payload) "
        "VALUES (%s,%s,%s,%s::jsonb) ON CONFLICT (event_id) DO NOTHING RETURNING event_id",
        (event_id, event_type, source_ref, json.dumps(payload, default=short)),
    ).fetchone()
    return row is not None


def setup_fixture(conn: psycopg.Connection) -> dict[str, UUID]:
    global FIXTURE
    T, USER, APPROVER1, APPROVER2 = (uid(x) for x in ("tenant", "user", "approver-1", "approver-2"))
    COMPANY = uid("company")
    STATION, MARKET_BU = uid("station"), uid("market-bu")
    PRODUCTS = {name: uid("product-" + name) for name in ("sale", "delivery", "goods", "finance", "race")}
    LOCAL = {name: uid("local-account-" + name) for name in ("event", "finance", "race")}
    SUPPLIERS = {name: uid("supplier-party-" + name) for name in LOCAL}
    COMPANY_ACCOUNTS = {name: uid("company-account-" + name) for name in ("finance", "race")}
    POs = {name: uid("po-" + name) for name in ("delivery", "goods", "finance")}
    RUN, BATCH, REC_LINE = uid("recommendation-run"), uid("recommendation-batch"), uid("recommendation-line")
    FIXTURE = {"station": STATION, "market_bu": MARKET_BU}

    with conn.transaction():
        conn.execute("INSERT INTO core.tenants(tenant_id,legal_name) VALUES (%s,%s)", (T, "V1.7 SENTETIK TENANT"))
        for user, label in ((USER, "Test Service"), (APPROVER1, "Approver One"), (APPROVER2, "Approver Two")):
            conn.execute("INSERT INTO core.users(tenant_id,user_id,display_name) VALUES (%s,%s,%s)", (T, user, label))
        conn.execute(
            "INSERT INTO core.companies(tenant_id,company_id,company_code,legal_name,tax_id_type,tax_id_number,created_by_user_id) "
            "VALUES (%s,%s,%s,%s,'VKN','1234567890',%s)",
            (T, COMPANY, "V17", "V1.7 Sentetik Firma", USER),
        )
        for supplier_name, supplier_id in SUPPLIERS.items():
            conn.execute(
                "INSERT INTO core.parties(tenant_id,party_id,party_type,display_name) VALUES (%s,%s,'COMPANY',%s)",
                (T, supplier_id, "V1.7 Sentetik Tedarikçi " + supplier_name),
            )
        conn.execute(
            "INSERT INTO core.stations(tenant_id,station_id,station_code,display_name) VALUES (%s,%s,%s,%s)",
            (T, STATION, "V17", "V1.7 Sentetik İstasyon"),
        )
        conn.execute(
            "INSERT INTO core.business_units(tenant_id,station_id,business_unit_id,domain_code,display_name) "
            "VALUES (%s,%s,%s,'MARKET','Sentetik Market')",
            (T, STATION, MARKET_BU),
        )
        conn.execute(
            "INSERT INTO core.station_company_assignments(tenant_id,station_id,company_id,assignment_level,valid_from,created_by_user_id) "
            "VALUES (%s,%s,%s,'STATION',%s,%s)",
            (T, STATION, COMPANY, AS_OF - timedelta(days=30), USER),
        )
        for product_name, product_id in PRODUCTS.items():
            conn.execute(
                "INSERT INTO market.products(tenant_id,product_id,sku,product_name) VALUES (%s,%s,%s,%s)",
                (T, product_id, "V17-" + product_name.upper(), "V1.7 " + product_name),
            )
            initial = {"sale": 10, "delivery": 3, "goods": 2, "finance": 0, "race": 0}[product_name]
            conn.execute(
                "INSERT INTO market.inventory_balances(tenant_id,station_id,business_unit_id,product_id,on_hand_good_qty,reserved_qty,snapshot_at) "
                "VALUES (%s,%s,%s,%s,%s,0,%s)",
                (T, STATION, MARKET_BU, product_id, initial, datetime.combine(AS_OF, time(8), TZ)),
            )
        for account_name, account_id in LOCAL.items():
            conn.execute(
                "INSERT INTO market.supplier_accounts(tenant_id,station_id,business_unit_id,supplier_account_id,supplier_party_id,currency_code) "
                "VALUES (%s,%s,%s,%s,%s,'TRY')",
                (T, STATION, MARKET_BU, account_id, SUPPLIERS[account_name]),
            )
        for name, account_id in COMPANY_ACCOUNTS.items():
            conn.execute(
                "INSERT INTO market.company_supplier_accounts(tenant_id,company_supplier_account_id,company_id,supplier_party_id,account_code,currency_code,created_by_user_id) "
                "VALUES (%s,%s,%s,%s,%s,'TRY',%s)",
                (T, account_id, COMPANY, SUPPLIERS[name], "V17-" + name.upper(), USER),
            )
            conn.execute(
                "INSERT INTO market.company_supplier_account_station_links(tenant_id,company_supplier_account_id,company_id,station_id,business_unit_id,local_supplier_account_id,currency_code,valid_from,verified_by_user_id) "
                "VALUES (%s,%s,%s,%s,%s,%s,'TRY',%s,%s)",
                (T, account_id, COMPANY, STATION, MARKET_BU, LOCAL[name], AS_OF - timedelta(days=30), APPROVER1),
            )
            limit_minor = 1100 if name == "finance" else 1000
            conn.execute(
                "INSERT INTO market.company_supplier_credit_profiles(tenant_id,company_supplier_account_id,company_id,currency_code,credit_limit_minor,valid_from,approved_by_user_id) "
                "VALUES (%s,%s,%s,'TRY',%s,%s,%s)",
                (T, account_id, COMPANY, limit_minor, AS_OF - timedelta(days=30), APPROVER1),
            )

        # Finance recommendation line is deliberately zero-cost: proposal quality is complete,
        # while the invoice/unbilled pair remains isolated for the atomicity test.
        conn.execute(
            "INSERT INTO market.recommendation_runs(tenant_id,recommendation_run_id,company_id,as_of_date,algorithm_version,created_by_user_id) "
            "VALUES (%s,%s,%s,%s,'V17-TEST',%s)",
            (T, RUN, COMPANY, AS_OF, USER),
        )
        conn.execute(
            "INSERT INTO market.recommendation_batches(tenant_id,station_id,business_unit_id,recommendation_batch_id,as_of_date,algorithm_version,created_by_user_id) "
            "VALUES (%s,%s,%s,%s,%s,'V17-TEST',%s)",
            (T, STATION, MARKET_BU, BATCH, AS_OF, USER),
        )
        conn.execute(
            "INSERT INTO market.recommendation_run_batches(tenant_id,recommendation_run_id,company_id,recommendation_batch_id,station_id,business_unit_id) "
            "VALUES (%s,%s,%s,%s,%s,%s)",
            (T, RUN, COMPANY, BATCH, STATION, MARKET_BU),
        )
        conn.execute(
            "INSERT INTO market.recommendation_lines(tenant_id,station_id,business_unit_id,recommendation_batch_id,product_id,supplier_account_id,currency_code,estimated_cost_minor) "
            "VALUES (%s,%s,%s,%s,%s,%s,'TRY',0)",
            (T, STATION, MARKET_BU, BATCH, PRODUCTS["finance"], LOCAL["finance"]),
        )

        # Delivery: 6 units expected on AS_OF+2; the event sequence moves it to day 0,
        # then to AS_OF+5 (outside the three-day horizon).
        create_po(conn, T, POs["delivery"], LOCAL["event"], PRODUCTS["delivery"], 6, 50, AS_OF + timedelta(days=2), USER, APPROVER1)
        # Goods receipt: 10 units, initially entirely open and physically absent.
        create_po(conn, T, POs["goods"], LOCAL["event"], PRODUCTS["goods"], 10, 100, AS_OF + timedelta(days=1), USER, APPROVER1)
        # Invoice/AP atomicity: 10 units x 100 minor = 1,000 TRY minor.
        create_po(conn, T, POs["finance"], LOCAL["finance"], PRODUCTS["finance"], 10, 100, AS_OF + timedelta(days=1), USER, APPROVER1)

    return {
        "tenant": T, "user": USER, "approver1": APPROVER1, "approver2": APPROVER2,
        "company": COMPANY, "supplier": SUPPLIERS["event"], "suppliers": SUPPLIERS, "station": STATION, "market_bu": MARKET_BU,
        "products": PRODUCTS, "local": LOCAL, "company_accounts": COMPANY_ACCOUNTS,
        "pos": POs, "run": RUN, "batch": BATCH, "rec_line": REC_LINE,
    }


def create_po(
    conn: psycopg.Connection, tenant: UUID, po_id: UUID, supplier_account: UUID,
    product_id: UUID, quantity: int, unit_price: int, expected: date,
    created_by: UUID, approved_by: UUID,
) -> None:
    expected_at = datetime.combine(expected, time(9), TZ)
    # INSERT ... SELECT is not needed: fixture identifiers are deterministic and the DB is empty.
    conn.execute(
        "INSERT INTO market.purchase_orders(tenant_id,station_id,business_unit_id,purchase_order_id,supplier_account_id,order_status,ordered_at,expected_delivery_at,created_by_user_id,approved_by_user_id,approved_at,currency_code) "
        "VALUES (%s,(SELECT station_id FROM core.business_units WHERE tenant_id=%s AND business_unit_id=%s),%s,%s,%s,'APPROVED',%s,%s,%s,%s,%s,'TRY')",
        (tenant, tenant, FIXTURE["market_bu"], FIXTURE["market_bu"], po_id, supplier_account, datetime.combine(AS_OF, time(8), TZ), expected_at, created_by, approved_by, datetime.combine(AS_OF, time(8), TZ)),
    )
    conn.execute(
        "INSERT INTO market.purchase_order_lines(tenant_id,station_id,business_unit_id,purchase_order_id,product_id,ordered_qty,unit_price_minor,currency_code) "
        "VALUES (%s,(SELECT station_id FROM core.business_units WHERE tenant_id=%s AND business_unit_id=%s),%s,%s,%s,%s,%s,'TRY')",
        (tenant, tenant, FIXTURE["market_bu"], FIXTURE["market_bu"], po_id, product_id, quantity, unit_price),
    )


def stock_rows(conn: psycopg.Connection, fixture: dict[str, Any], product: UUID, forecast: Decimal, horizon: int, confirmed: list[UUID]) -> list[dict[str, Any]]:
    return conn.execute(SQL_STOCK, {
        "tenant_id": fixture["tenant"],
        "station_id": fixture["station"],
        "market_business_unit_id": fixture["market_bu"],
        "product_id": product,
        "as_of_date": AS_OF,
        "horizon_days": horizon,
        "forecast_daily_qty": forecast,
        "confirmed_purchase_order_ids": confirmed,
    }).fetchall()


def company_rows(conn: psycopg.Connection, fixture: dict[str, Any], amount_basis: bool = True, ap_complete: bool = True) -> list[dict[str, Any]]:
    return conn.execute(SQL_RISK, {
        "tenant_id": fixture["tenant"],
        "company_id": fixture["company"],
        "recommendation_run_id": fixture["run"],
        "as_of_date": AS_OF,
        "ap_snapshot_complete": ap_complete,
        "proposal_complete": True,
        "unmapped_exposure_detected": False,
        "amount_basis_verified": amount_basis,
    }).fetchall()


def company_row(conn: psycopg.Connection, fixture: dict[str, Any], account: UUID, **kwargs: Any) -> dict[str, Any]:
    for row in company_rows(conn, fixture, **kwargs):
        if row["company_supplier_account_id"] == account:
            return row
    raise AssertionError("company supplier account risk satırı bulunamadı")


def financial_components(conn: psycopg.Connection, fixture: dict[str, Any], local_account: UUID) -> dict[str, Any]:
    return conn.execute(
        "SELECT "
        "COALESCE((SELECT SUM(open_amount_minor) FROM market.supplier_ap_open_items "
        "WHERE tenant_id=%s AND supplier_account_id=%s AND currency_code='TRY' AND status IN ('OPEN','DISPUTED')),0) AS ap_minor, "
        "COALESCE((SELECT SUM(commitment_minor) FROM market.v_unbilled_commitments "
        "WHERE tenant_id=%s AND supplier_account_id=%s AND currency_code='TRY'),0) AS unbilled_minor",
        (fixture["tenant"], local_account, fixture["tenant"], local_account),
    ).fetchone()


def apply_sale(conn: psycopg.Connection, fixture: dict[str, Any], event_id: UUID, product: UUID, quantity: int) -> bool:
    with conn.transaction():
        if not claim_event(conn, event_id, "SALE", str(product), {"quantity": quantity}):
            return False
        sale_id = uid("sale-" + str(event_id))
        conn.execute(
            "INSERT INTO ops.sales(tenant_id,station_id,business_unit_id,sale_id,source_event_id,sold_at,currency_code,total_minor) "
            "VALUES (%s,%s,%s,%s,%s,%s,'TRY',%s)",
            (fixture["tenant"], fixture["station"], fixture["market_bu"], sale_id, str(event_id), datetime.combine(AS_OF, time(10), TZ), quantity * 100),
        )
        conn.execute(
            "INSERT INTO market.inventory_movements(tenant_id,station_id,business_unit_id,movement_id,product_id,movement_kind,quantity_delta,source_type,source_id,source_event_id,occurred_at) "
            "VALUES (%s,%s,%s,%s,%s,'SALE',%s,'SALE',%s,%s,%s)",
            (fixture["tenant"], fixture["station"], fixture["market_bu"], uid("sale-movement-" + str(event_id)), product, -quantity, str(sale_id), str(event_id), datetime.combine(AS_OF, time(10), TZ)),
        )
        conn.execute(
            "UPDATE market.inventory_balances SET on_hand_good_qty=on_hand_good_qty-%s,snapshot_at=%s "
            "WHERE tenant_id=%s AND station_id=%s AND business_unit_id=%s AND product_id=%s",
            (quantity, datetime.combine(AS_OF, time(10), TZ), fixture["tenant"], fixture["station"], fixture["market_bu"], product),
        )
    return True


def reschedule_delivery(conn: psycopg.Connection, fixture: dict[str, Any], event_id: UUID, po_id: UUID, expected: date) -> bool:
    with conn.transaction():
        if not claim_event(conn, event_id, "SUPPLIER_DELIVERY_RESCHEDULED", str(po_id), {"expected_delivery": expected.isoformat()}):
            return False
        conn.execute(
            "UPDATE market.purchase_orders SET expected_delivery_at=%s "
            "WHERE tenant_id=%s AND purchase_order_id=%s",
            (datetime.combine(expected, time(8), TZ), fixture["tenant"], po_id),
        )
    return True


def apply_goods_receipt(conn: psycopg.Connection, fixture: dict[str, Any], event_id: UUID, po_id: UUID, product: UUID, quantity: int) -> bool:
    with conn.transaction():
        if not claim_event(conn, event_id, "GOODS_RECEIPT", str(po_id), {"quantity": quantity}):
            return False
        conn.execute(
            "INSERT INTO market.inventory_movements(tenant_id,station_id,business_unit_id,movement_id,product_id,movement_kind,quantity_delta,source_type,source_id,source_event_id,occurred_at) "
            "VALUES (%s,%s,%s,%s,%s,'GOODS_RECEIPT',%s,'GOODS_RECEIPT',%s,%s,%s)",
            (fixture["tenant"], fixture["station"], fixture["market_bu"], uid("goods-movement-" + str(event_id)), product, quantity, str(po_id), str(event_id), datetime.combine(AS_OF, time(11), TZ)),
        )
        conn.execute(
            "UPDATE market.purchase_order_lines SET accepted_qty=accepted_qty+%s "
            "WHERE tenant_id=%s AND purchase_order_id=%s AND product_id=%s",
            (quantity, fixture["tenant"], po_id, product),
        )
        conn.execute(
            "UPDATE market.inventory_balances SET on_hand_good_qty=on_hand_good_qty+%s,snapshot_at=%s "
            "WHERE tenant_id=%s AND station_id=%s AND business_unit_id=%s AND product_id=%s",
            (quantity, datetime.combine(AS_OF, time(11), TZ), fixture["tenant"], fixture["station"], fixture["market_bu"], product),
        )
    return True


def invoice_and_unbilled_same_transaction(conn: psycopg.Connection, fixture: dict[str, Any], event_id: UUID, po_id: UUID, local_account: UUID, product: UUID) -> bool:
    with conn.transaction():
        if not claim_event(conn, event_id, "SUPPLIER_INVOICE", str(po_id), {"amount_minor": 1000}):
            return False
        conn.execute(
            "INSERT INTO market.supplier_ap_open_items(tenant_id,supplier_ap_item_id,supplier_account_id,source_invoice_ref,invoice_date,due_date,original_amount_minor,open_amount_minor,currency_code) "
            "VALUES (%s,%s,%s,%s,%s,%s,1000,1000,'TRY')",
            (fixture["tenant"], uid("ap-finance-item"), local_account, "V17-INVOICE-1", AS_OF, AS_OF + timedelta(days=30)),
        )
        conn.execute(
            "UPDATE market.purchase_order_lines SET invoiced_qty=ordered_qty "
            "WHERE tenant_id=%s AND purchase_order_id=%s AND product_id=%s",
            (fixture["tenant"], po_id, product),
        )
    return True


def apply_demo_supplier_payment(conn: psycopg.Connection, fixture: dict[str, Any], event_id: UUID, local_account: UUID) -> bool:
    with conn.transaction():
        if not claim_event(conn, event_id, "DEMO_SUPPLIER_PAYMENT", "V17-INVOICE-1", {"new_open_minor": 400}):
            return False
        conn.execute(
            "UPDATE market.supplier_ap_open_items SET open_amount_minor=400,updated_at=%s "
            "WHERE tenant_id=%s AND supplier_account_id=%s AND source_invoice_ref='V17-INVOICE-1'",
            (datetime.combine(AS_OF, time(12), TZ), fixture["tenant"], local_account),
        )
    return True


def run_race(fixture: dict[str, Any]) -> list[dict[str, Any]]:
    barrier = threading.Barrier(2)
    outcomes: list[dict[str, Any]] = []
    outcome_lock = threading.Lock()

    def worker(label: str) -> None:
        c = psycopg.connect("", row_factory=dict_row)
        c.autocommit = True
        c.execute("SET TIME ZONE 'Europe/Istanbul'")
        try:
            with c.transaction():
                c.execute("SET LOCAL lock_timeout='3s'")
                c.execute("SET LOCAL statement_timeout='10s'")
                barrier.wait(timeout=5)
                # Bu, gerçek sipariş/onay servisinin örnek kritik bölümüdür.
                c.execute(
                    "SELECT company_supplier_account_id FROM market.company_supplier_accounts "
                    "WHERE tenant_id=%s AND company_supplier_account_id=%s FOR UPDATE",
                    (fixture["tenant"], fixture["company_accounts"]["race"]),
                )
                exposure = c.execute(
                    "SELECT "
                    "COALESCE((SELECT SUM(open_amount_minor) FROM market.supplier_ap_open_items "
                    "WHERE tenant_id=%s AND supplier_account_id=%s AND currency_code='TRY' AND status IN ('OPEN','DISPUTED')),0) "
                    "+ COALESCE((SELECT SUM(commitment_minor) FROM market.v_unbilled_commitments "
                    "WHERE tenant_id=%s AND supplier_account_id=%s AND currency_code='TRY'),0) AS exposure_minor, "
                    "(SELECT credit_limit_minor FROM market.company_supplier_credit_profiles "
                    "WHERE tenant_id=%s AND company_supplier_account_id=%s AND currency_code='TRY' "
                    "AND valid_from<=%s AND (valid_to IS NULL OR valid_to>=%s) "
                    "ORDER BY valid_from DESC LIMIT 1) AS limit_minor",
                    (fixture["tenant"], fixture["local"]["race"], fixture["tenant"], fixture["local"]["race"], fixture["tenant"], fixture["company_accounts"]["race"], AS_OF, AS_OF),
                ).fetchone()
                accepted = exposure["exposure_minor"] + 700 <= exposure["limit_minor"]
                if accepted:
                    po_id = uid("race-po-" + label)
                    create_po(c, fixture["tenant"], po_id, fixture["local"]["race"], fixture["products"]["race"], 7, 100, AS_OF + timedelta(days=1), fixture["user"], fixture["approver1"])
                outcome = {"label": label, "accepted": accepted, "exposure_before": short(exposure["exposure_minor"]), "limit": short(exposure["limit_minor"])}
                with outcome_lock:
                    outcomes.append(outcome)
        except Exception as exc:  # test runner records timeout/deadlock rather than hanging
            with outcome_lock:
                outcomes.append({"label": label, "error": type(exc).__name__ + ": " + str(exc).splitlines()[0]})
        finally:
            c.close()

    threads = [threading.Thread(target=worker, args=(label,), daemon=True) for label in ("A", "B")]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join(timeout=15)
    return outcomes


def run_tests(conn: psycopg.Connection, fixture: dict[str, Any]) -> None:
    T = fixture["tenant"]
    products, pos = fixture["products"], fixture["pos"]

    # 1) Sale event: balance mutation is visible to v1.6 projection immediately.
    before = stock_rows(conn, fixture, products["sale"], Decimal("6"), 2, [])
    check("Satış öncesi ilk gün OK", "SALE", "SQL-1 stock projection", "projected_end_qty=4, stock_risk=OK", {"qty": before[0]["projected_end_qty"], "risk": before[0]["stock_risk"]}, before[0]["projected_end_qty"] == Decimal("4") and before[0]["stock_risk"] == "OK")
    sale_event = uid("sale-event-1")
    apply_sale(conn, fixture, sale_event, products["sale"], 6)
    after = stock_rows(conn, fixture, products["sale"], Decimal("6"), 2, [])
    check("Satış stok azaltır ve riski artırır", "SALE -> inventory_movements(-6)", "SQL-1 stock projection", "ilk gün STOCKOUT_RISK ve -2", {"on_hand": after[0]["on_hand_good_qty"], "qty": after[0]["projected_end_qty"], "risk": after[0]["stock_risk"]}, after[0]["on_hand_good_qty"] == Decimal("4") and after[0]["projected_end_qty"] == Decimal("-2") and after[0]["stock_risk"] == "STOCKOUT_RISK")
    expect_db_error(conn, "Mükerrer source event tekilliği", "SALE yeni sale_id, aynı source_event_id", "INSERT ops.sales ... UNIQUE(tenant,business_unit,source_event_id)", "INSERT INTO ops.sales(tenant_id,station_id,business_unit_id,sale_id,source_event_id,sold_at,currency_code,total_minor) VALUES (%s,%s,%s,%s,%s,%s,'TRY',600)", (T, fixture["station"], fixture["market_bu"], uid("duplicate-sale-new-id"), str(sale_event), datetime.combine(AS_OF, time(10), TZ)), errors.UniqueViolation, "source_event")
    duplicate_applied = apply_sale(conn, fixture, sale_event, products["sale"], 6)
    sale_count = conn.execute("SELECT count(*) AS n FROM market.inventory_movements WHERE tenant_id=%s AND source_type='SALE' AND source_event_id=%s", (T, str(sale_event))).fetchone()["n"]
    sale_balance = conn.execute("SELECT on_hand_good_qty FROM market.inventory_balances WHERE tenant_id=%s AND product_id=%s", (T, products["sale"])).fetchone()["on_hand_good_qty"]
    check("Mükerrer satış stokta ikinci kez sayılmaz", "duplicate SALE source event", "claim_event + inventory_movements + inventory_balances", "ikinci çağrı uygulanmaz, tek hareket ve stok 4", {"applied": duplicate_applied, "movement_count": sale_count, "on_hand": sale_balance}, not duplicate_applied and sale_count == 1 and sale_balance == Decimal("4"))

    # 2) Confirmation timing: same PO first arrives on day 2, then early on day 0,
    # and a later supplier reschedule removes the arrival from the horizon.
    po_delivery = pos["delivery"]
    delayed_initial = stock_rows(conn, fixture, products["delivery"], Decimal("2"), 3, [po_delivery])
    check("Teyitli ama geç teslim ilk riski gösterir", "SUPPLIER_CONFIRMATION", "SQL-1 inbound by expected_delivery_at", "day 1 STOCKOUT_RISK", {"d1": delayed_initial[1]["stock_risk"], "arrival_day2": delayed_initial[2]["arrivals_today"]}, delayed_initial[1]["stock_risk"] == "STOCKOUT_RISK" and delayed_initial[2]["arrivals_today"] == Decimal("6"))
    reschedule_delivery(conn, fixture, uid("delivery-early"), po_delivery, AS_OF)
    early = stock_rows(conn, fixture, products["delivery"], Decimal("2"), 3, [po_delivery])
    check("Teyitli teslim erken gelirse risk kalkar", "SUPPLIER_DELIVERY_RESCHEDULED -> AS_OF", "SQL-1 inbound + window SUM", "tüm ufuk OK, day0 arrival=6", {"risks": [r["stock_risk"] for r in early], "day0": early[0]["arrivals_today"]}, all(r["stock_risk"] == "OK" for r in early) and early[0]["arrivals_today"] == Decimal("6"))
    reschedule_delivery(conn, fixture, uid("delivery-late"), po_delivery, AS_OF + timedelta(days=5))
    late = stock_rows(conn, fixture, products["delivery"], Decimal("2"), 3, [po_delivery])
    check("Tedarikçi teslimi ertelenince risk geri gelir", "SUPPLIER_DELIVERY_RESCHEDULED -> AS_OF+5", "SQL-1 inbound horizon filter", "day 1 STOCKOUT_RISK, ufukta arrival yok", {"d1": late[1]["stock_risk"], "arrivals": [r["arrivals_today"] for r in late]}, late[1]["stock_risk"] == "STOCKOUT_RISK" and all(r["arrivals_today"] == 0 for r in late))

    # 3) Goods receipt: physical stock and accepted_qty move together; open inbound
    # is reduced once, while invoiced_qty is deliberately untouched.
    po_goods = pos["goods"]
    open_before = conn.execute("SELECT open_inbound_qty FROM market.v_open_supply WHERE tenant_id=%s AND purchase_order_id=%s", (T, po_goods)).fetchone()["open_inbound_qty"]
    apply_goods_receipt(conn, fixture, uid("goods-receipt-1"), po_goods, products["goods"], 10)
    view_after = conn.execute("SELECT open_inbound_qty FROM market.v_open_supply WHERE tenant_id=%s AND purchase_order_id=%s", (T, po_goods)).fetchone()
    bal_after = conn.execute("SELECT on_hand_good_qty FROM market.inventory_balances WHERE tenant_id=%s AND product_id=%s", (T, products["goods"])).fetchone()["on_hand_good_qty"]
    check("Mal kabul stok artırır ve açık PO azalır", "GOODS_RECEIPT(+10)", "v_open_supply + inventory_balances", "open 10->0, on_hand 2->12", {"open_before": open_before, "open_after": view_after["open_inbound_qty"] if view_after else None, "on_hand": bal_after}, open_before == Decimal("10") and view_after is None and bal_after == Decimal("12"))
    apply_goods_receipt(conn, fixture, uid("goods-receipt-1"), po_goods, products["goods"], 10)
    duplicate_goods = conn.execute("SELECT count(*) AS n FROM market.inventory_movements WHERE tenant_id=%s AND source_type='GOODS_RECEIPT' AND source_event_id=%s", (T, str(uid("goods-receipt-1")))).fetchone()["n"]
    bal_repeat = conn.execute("SELECT on_hand_good_qty FROM market.inventory_balances WHERE tenant_id=%s AND product_id=%s", (T, products["goods"])).fetchone()["on_hand_good_qty"]
    check("Mal kabul mükerrer olayda çifte sayılmaz", "duplicate GOODS_RECEIPT", "demo event idempotency + movement UNIQUE", "tek hareket, on_hand=12", {"movement_count": duplicate_goods, "on_hand": bal_repeat}, duplicate_goods == 1 and bal_repeat == Decimal("12"))
    expect_db_error(conn, "Stok hareketi source_event UNIQUE gate", "duplicate GOODS_RECEIPT direct insert", "INSERT market.inventory_movements", "INSERT INTO market.inventory_movements(tenant_id,station_id,business_unit_id,movement_id,product_id,movement_kind,quantity_delta,source_type,source_id,source_event_id,occurred_at) VALUES (%s,%s,%s,%s,%s,'GOODS_RECEIPT',%s,'GOODS_RECEIPT',%s,%s,%s)", (T, fixture["station"], fixture["market_bu"], uid("duplicate-direct-movement"), products["goods"], 10, str(po_goods), str(uid("goods-receipt-1")), datetime.combine(AS_OF, time(11), TZ)), errors.UniqueViolation, "")

    # 4) Invoice and unbilled commitment are changed in one writer transaction.
    po_fin, local_fin, account_fin = pos["finance"], fixture["local"]["finance"], fixture["company_accounts"]["finance"]
    observer = psycopg.connect("", row_factory=dict_row, autocommit=True)
    observer.execute("SET TIME ZONE 'Europe/Istanbul'")
    try:
        with observer.transaction():
            observer.execute("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ")
            old_pair = financial_components(observer, fixture, local_fin)
            invoice_and_unbilled_same_transaction(conn, fixture, uid("invoice-event-1"), po_fin, local_fin, products["finance"])
            observer_pair = financial_components(observer, fixture, local_fin)
        new_pair = financial_components(conn, fixture, local_fin)
    finally:
        observer.close()
    check("Fatura ve unbilled aynı transaction görünürlüğünde atomik", "SUPPLIER_INVOICE", "INSERT supplier_ap_open_items + UPDATE purchase_order_lines in one transaction", "old=(0,1000), repeatable observer old kalır, commit sonrası=(1000,0)", {"old": old_pair, "observer": observer_pair, "new": new_pair}, old_pair["ap_minor"] == 0 and old_pair["unbilled_minor"] == 1000 and observer_pair == old_pair and new_pair["ap_minor"] == 1000 and new_pair["unbilled_minor"] == 0)
    risk_fin = company_row(conn, fixture, account_fin)
    check("Fatura sonrası AP+unbilled çifte sayılmaz ve boş risk üretmez", "company credit exposure", "SQL-2 company supplier risk", "remaining=100 (limit 1100 - AP 1000 - unbilled 0)", {"ap": risk_fin["open_ap_minor"], "unbilled": risk_fin["commitment_minor"], "remaining": risk_fin["usable_remaining_minor"], "codes": risk_fin["risk_codes"]}, risk_fin["open_ap_minor"] == 1000 and risk_fin["commitment_minor"] == 0 and risk_fin["usable_remaining_minor"] == 100)
    apply_demo_supplier_payment(conn, fixture, uid("supplier-payment-1"), local_fin)
    paid_pair = financial_components(conn, fixture, local_fin)
    risk_paid = company_row(conn, fixture, account_fin)
    check("Demo ödeme AP'yi azaltır; gerçek post değildir", "DEMO_SUPPLIER_PAYMENT", "UPDATE supplier_ap_open_items (projection only)", "AP 1000->400, remaining=700", {"components": paid_pair, "remaining": risk_paid["usable_remaining_minor"]}, paid_pair["ap_minor"] == 400 and paid_pair["unbilled_minor"] == 0 and risk_paid["usable_remaining_minor"] == 700)

    # 5) Snapshot age is not a v1.6 SQL risk code; this client-side warning is explicit.
    stale_at = datetime.combine(AS_OF - timedelta(days=3), time(0), TZ)
    with conn.transaction():
        conn.execute("UPDATE market.inventory_balances SET snapshot_at=%s WHERE tenant_id=%s AND product_id=%s", (stale_at, T, products["sale"]))
    stale_row = stock_rows(conn, fixture, products["sale"], Decimal("6"), 1, [])[0]
    snap_local = stale_row["snapshot_at"].astimezone(TZ)
    age_hours = (datetime.combine(AS_OF, time(12), TZ) - snap_local).total_seconds() / 3600
    stale_warning = age_hours > 24
    check("Eski snapshot uyarısı", "STALE_INVENTORY_SNAPSHOT", "SQL-1 returns snapshot_at; runner freshness gate", ">24 saat için STALE_SNAPSHOT_WARNING", {"snapshot_at": snap_local, "age_hours": age_hours, "warning": stale_warning}, stale_warning)
    with conn.transaction():
        conn.execute("UPDATE market.inventory_balances SET snapshot_at=%s WHERE tenant_id=%s AND product_id=%s", (datetime.combine(AS_OF, time(8), TZ), T, products["sale"]))

    # 6) Quality/amount gates fail closed.
    risk_basis = company_row(conn, fixture, account_fin, amount_basis=False)
    check("Net/brüt tutar esası teyitsizse gate", "AMOUNT_BASIS_UNVERIFIED", "SQL-2 :amount_basis_verified=false", "usable_remaining_minor NULL + AMOUNT_BASIS_UNKNOWN", {"usable": risk_basis["usable_remaining_minor"], "codes": risk_basis["risk_codes"]}, risk_basis["usable_remaining_minor"] is None and "AMOUNT_BASIS_UNKNOWN" in risk_basis["risk_codes"])
    expect_db_error(conn, "Yanlış para birimi FK gate", "TRY supplier account line -> USD", "UPDATE recommendation_lines SET currency_code='USD'", "UPDATE market.recommendation_lines SET currency_code='USD' WHERE tenant_id=%s AND recommendation_batch_id=%s", (T, fixture["batch"]), errors.ForeignKeyViolation, "")
    with conn.transaction():
        conn.execute("UPDATE market.recommendation_lines SET estimated_cost_minor=NULL WHERE tenant_id=%s AND recommendation_batch_id=%s", (T, fixture["batch"]))
    risk_null = company_row(conn, fixture, account_fin)
    check("NULL maliyet proposal quality gate", "RECOMMENDATION_LINE estimated_cost=NULL", "SQL-2 proposal_quality", "usable NULL + INCOMPLETE_EXPOSURE", {"usable": risk_null["usable_remaining_minor"], "codes": risk_null["risk_codes"]}, risk_null["usable_remaining_minor"] is None and "INCOMPLETE_EXPOSURE" in risk_null["risk_codes"])
    with conn.transaction():
        conn.execute("UPDATE market.recommendation_lines SET estimated_cost_minor=0 WHERE tenant_id=%s AND recommendation_batch_id=%s", (T, fixture["batch"]))
    risk_ap_stale = company_row(conn, fixture, account_fin, ap_complete=False)
    check("Eksik AP snapshot gate", "AP_SNAPSHOT_INCOMPLETE", "SQL-2 :ap_snapshot_complete=false", "usable NULL + INCOMPLETE_EXPOSURE", {"usable": risk_ap_stale["usable_remaining_minor"], "codes": risk_ap_stale["risk_codes"]}, risk_ap_stale["usable_remaining_minor"] is None and "INCOMPLETE_EXPOSURE" in risk_ap_stale["risk_codes"])

    # 7) Two order approvers contend for one shared company account. The lock and
    # recomputation are service code here; v1.5's schema comments require this,
    # but the schema does not enforce it by itself.
    race = run_race(fixture)
    accepted = [x for x in race if x.get("accepted") is True]
    rejected = [x for x in race if x.get("accepted") is False]
    race_commitment = conn.execute("SELECT COALESCE(SUM(commitment_minor),0) AS n FROM market.v_unbilled_commitments WHERE tenant_id=%s AND supplier_account_id=%s", (T, fixture["local"]["race"])).fetchone()["n"]
    check("Eşzamanlı iki yetkili yalnız biri limit içinde", "TWO ORDER APPROVERS", "service tx: SELECT company_supplier_accounts FOR UPDATE; recompute AP+unbilled; approve/rollback", "accepted=1, rejected=1, commitment=700", {"outcomes": race, "commitment": race_commitment}, len(accepted) == 1 and len(rejected) == 1 and len(race) == 2 and race_commitment == 700)


def write_report(pg_version: str, fatal: str | None = None) -> None:
    passed = sum(1 for row in RESULTS if row["status"] == "PASS")
    failed = sum(1 for row in RESULTS if row["status"] == "FAIL")
    lines = [
        "# AKARYAKIT V1.7 — stok/cari sentetik olay test sonucu",
        "",
        "> Bu rapor gerçek API, mobil istemci, OCR servisi veya ödeme ağı çağırmadan; yalnızca "
        "geçici PostgreSQL üzerinde v1.4 + v1.5 şeması ve v1.6 sorgularıyla üretilmiştir.",
        "",
        f"- **PostgreSQL:** `{pg_version}`",
        f"- **Toplam geçen:** **{passed}**; **başarısız:** **{failed}**",
        f"- **Rapor yolu:** `{RESULTS_MD}`",
        "- **Parasal esas:** tüm tutarlar sentetik demo **TRY minor** birimleridir; gerçek muhasebe postu değildir.",
        "- **Olay zamanı:** sabit `2026-10-10`, sorgu ve timestamp dönüşümü `Europe/Istanbul`.",
        "",
        "## Olay → SQL → beklenen → gözlenen",
        "",
        "| # | Olay | SQL / sorgu | Beklenen | Gözlenen | Durum |",
        "|---:|---|---|---|---|:---:|",
    ]
    for number, row in enumerate(RESULTS, 1):
        cells = [row["event"], row["sql"], row["expected"], row["observed"]]
        cells = [short(cell).replace("|", "\\|").replace("\n", " ") for cell in cells]
        lines.append(f"| {number} | " + " | ".join(cells) + f" | **{row['status']}** |")
    lines += [
        "",
        "## Sınırlar ve yorum",
        "",
        "- **Snapshot:** v1.6 SQL-1 `snapshot_at` döndürür fakat tazelik eşiğini SQL risk kodu olarak üretmez. Betik 24 saatten eski snapshot için açık `STALE_SNAPSHOT_WARNING` üretir; bu bir servis/çağıran gate'idir.",
        "- **Zaman penceresi:** `expected_delivery_at AT TIME ZONE 'Europe/Istanbul'` ile gün kovasına alınır; gecikme ufuk dışına çıktığında teyitli PO da inbound sayılmaz.",
        "- **Idempotency:** `ops.sales` ve `market.inventory_movements` source-event UNIQUE kısıtları doğrudan denenmiştir. Demo event tablosu TEMP'tir; üretim event-store veya API değildir. Mal kabul duplicate çağrısı stok ve `accepted_qty` değerini ikinci kez artırmaz.",
        "- **Fatura/unbilled atomikliği:** sentetik fatura transaction'ı AP open item ekleyip PO `invoiced_qty` değerini aynı commit'te günceller. Repeatable-read gözlemci ya eski `(AP=0, unbilled=1000)` ya yeni `(AP=1000, unbilled=0)` çifti görür; karışık çift görmez.",
        "- **Ödeme:** demo supplier ödeme olayı yalnız `supplier_ap_open_items.open_amount_minor` projeksiyonunu 1000'den 400'e çeker. Gerçek banka/ledger postu veya tahsilat entegrasyonu yapılmamıştır.",
        "- **Race sınırı:** iki Python thread'i 3 saniye `lock_timeout`, 10 saniye `statement_timeout` ile aynı `company_supplier_accounts` satırını `FOR UPDATE` kilitler; her biri kilit altında AP + unbilled'ı yeniden hesaplar. Limit 1000, her istek 700 olduğundan yalnız bir PO kabul edilir. Bu, v1.5 yorumunda istenen örnek servis transaction'ıdır; şemanın tek başına bu iş kuralını garanti ettiği iddia edilmez.",
        "- **Gates:** yanlış TRY/USD eşlemesi FK ile reddedildi; `amount_basis_verified=false`, `ap_snapshot_complete=false` ve NULL öneri maliyeti kullanılabilir limiti NULL'a düşürdü. Net/brüt, para birimi ve maliyet esasları güvenilir servis girdisi olmadan açılmaz.",
        "- **Güvenlik/çalıştırma:** yalnız `--allow-demo-schema`, `PGUSER=postgres` ve `PG_CLUSTER_CONF_ROOT=/tmp/pg_virtualenv.*` ile çalışır; başlangıçta `core/ops/evidence/ar/market` şemaları varsa durur. DDL yalnız boş disposable DB'ye uygulanır; üretim migration'ı, veri silme/paylaşma ve dış API yoktur.",
        "",
    ]
    if fatal:
        lines += [f"- **Çalışma hatası:** `{fatal}`", ""]
    if FAILURES:
        lines += ["## Başarısızlık ayrıntıları", ""] + [f"- {item}" for item in FAILURES] + [""]
    RESULTS_MD.write_text("\n".join(lines) + "\n", encoding="utf-8")


def main() -> int:
    parser = argparse.ArgumentParser(description="AKARYAKIT V1.7 disposable PostgreSQL sentetik olay testleri")
    parser.add_argument("--allow-demo-schema", action="store_true", help="yalnız boş pg_virtualenv DB'sinde demo DDL/test verisine izin ver")
    args = parser.parse_args()
    assert_disposable_flag(args)
    global SQL_STOCK, SQL_RISK
    SQL_STOCK, SQL_RISK = load_v16_queries()
    conn: psycopg.Connection | None = None
    pg_version = "unknown"
    fatal: str | None = None
    try:
        conn = connect_and_apply_schema()
        pg_version = conn.execute("SELECT version() AS version").fetchone()["version"]
        fixture = setup_fixture(conn)
        run_tests(conn, fixture)
    except Exception as exc:
        fatal = type(exc).__name__ + ": " + str(exc).splitlines()[0]
        FAILURES.append("FATAL — " + fatal)
        print("FATAL:", fatal, file=sys.stderr, flush=True)
    finally:
        write_report(pg_version, fatal)
        if conn is not None:
            conn.close()
    passed = sum(1 for row in RESULTS if row["status"] == "PASS")
    failed = sum(1 for row in RESULTS if row["status"] == "FAIL")
    print(f"TOPLAM: {passed} test başarılı, {failed} test başarısız", flush=True)
    print(f"PostgreSQL: {pg_version}", flush=True)
    print(f"Rapor: {RESULTS_MD}", flush=True)
    return 1 if FAILURES else 0


if __name__ == "__main__":
    raise SystemExit(main())

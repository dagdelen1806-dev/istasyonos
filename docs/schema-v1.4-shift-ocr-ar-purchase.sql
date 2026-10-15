-- AKARYAKIT V1 — v1.4 illustrative PostgreSQL schema
-- PostgreSQL 15+; planning example only. NOT applied to any live database.
-- If equivalent core tables already exist, map names/constraints; do not create duplicates.
-- Migrations must be additive: inspect schema, back up, backfill, validate, then cut over.

BEGIN;

CREATE SCHEMA IF NOT EXISTS core;
CREATE SCHEMA IF NOT EXISTS ops;
CREATE SCHEMA IF NOT EXISTS evidence;
CREATE SCHEMA IF NOT EXISTS ar;
CREATE SCHEMA IF NOT EXISTS market;

-- -----------------------------------------------------------------------------
-- 0. Minimal reference tables. Reuse existing tenant/station/user tables in reality.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS core.tenants (
    tenant_id       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    legal_name      text NOT NULL,
    created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS core.stations (
    tenant_id       uuid NOT NULL REFERENCES core.tenants(tenant_id),
    station_id      uuid NOT NULL DEFAULT gen_random_uuid(),
    station_code    text NOT NULL,
    display_name    text NOT NULL,
    active          boolean NOT NULL DEFAULT true,
    created_at      timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (tenant_id, station_id),
    UNIQUE (tenant_id, station_code)
);

CREATE TABLE IF NOT EXISTS core.business_units (
    tenant_id       uuid NOT NULL,
    station_id      uuid NOT NULL,
    business_unit_id uuid NOT NULL DEFAULT gen_random_uuid(),
    domain_code     text NOT NULL CHECK (domain_code IN ('FUEL', 'MARKET')),
    display_name    text NOT NULL,
    active          boolean NOT NULL DEFAULT true,
    PRIMARY KEY (tenant_id, business_unit_id),
    UNIQUE (tenant_id, station_id, business_unit_id),
    UNIQUE (tenant_id, station_id, domain_code),
    FOREIGN KEY (tenant_id, station_id)
        REFERENCES core.stations (tenant_id, station_id)
);

CREATE TABLE IF NOT EXISTS core.users (
    tenant_id       uuid NOT NULL REFERENCES core.tenants(tenant_id),
    user_id         uuid NOT NULL DEFAULT gen_random_uuid(),
    email           text,
    display_name    text NOT NULL,
    status          text NOT NULL DEFAULT 'ACTIVE'
                    CHECK (status IN ('ACTIVE', 'LOCKED', 'DISABLED')),
    created_at      timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (tenant_id, user_id),
    UNIQUE (tenant_id, email)
);

CREATE TABLE IF NOT EXISTS core.employees (
    tenant_id       uuid NOT NULL REFERENCES core.tenants(tenant_id),
    employee_id     uuid NOT NULL DEFAULT gen_random_uuid(),
    user_id         uuid,
    employee_code   text NOT NULL,
    display_name    text NOT NULL,
    active          boolean NOT NULL DEFAULT true,
    PRIMARY KEY (tenant_id, employee_id),
    UNIQUE (tenant_id, employee_code),
    UNIQUE (tenant_id, employee_id, user_id),
    FOREIGN KEY (tenant_id, user_id)
        REFERENCES core.users (tenant_id, user_id)
);

CREATE TABLE IF NOT EXISTS core.parties (
    tenant_id       uuid NOT NULL REFERENCES core.tenants(tenant_id),
    party_id        uuid NOT NULL DEFAULT gen_random_uuid(),
    party_type      text NOT NULL CHECK (party_type IN ('PERSON', 'COMPANY')),
    display_name    text NOT NULL,
    status          text NOT NULL DEFAULT 'ACTIVE'
                    CHECK (status IN ('ACTIVE', 'INACTIVE')),
    PRIMARY KEY (tenant_id, party_id),
    UNIQUE (tenant_id, party_id, party_type)
);

CREATE TABLE IF NOT EXISTS ar.credit_terms (
    tenant_id       uuid NOT NULL REFERENCES core.tenants(tenant_id),
    credit_terms_id uuid NOT NULL DEFAULT gen_random_uuid(),
    name            text NOT NULL,
    due_days        integer NOT NULL DEFAULT 0 CHECK (due_days >= 0),
    effective_from  date NOT NULL,
    effective_to    date,
    PRIMARY KEY (tenant_id, credit_terms_id),
    CHECK (effective_to IS NULL OR effective_to >= effective_from)
);

-- -----------------------------------------------------------------------------
-- 1. Shift plan, actual session, participants, terminal/mobile devices.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ops.scheduled_shift_assignments (
    tenant_id       uuid NOT NULL,
    station_id      uuid NOT NULL,
    assignment_id   uuid NOT NULL DEFAULT gen_random_uuid(),
    employee_id     uuid NOT NULL,
    business_date   date NOT NULL,
    shift_code      text NOT NULL,
    planned_start_at timestamptz NOT NULL,
    planned_end_at  timestamptz NOT NULL,
    status          text NOT NULL DEFAULT 'PLANNED'
                    CHECK (status IN ('DRAFT', 'PLANNED', 'CONFIRMED', 'CANCELLED')),
    created_by_user_id uuid NOT NULL,
    created_at      timestamptz NOT NULL DEFAULT now(),
    row_version     integer NOT NULL DEFAULT 1 CHECK (row_version > 0),
    PRIMARY KEY (tenant_id, assignment_id),
    UNIQUE (tenant_id, station_id, assignment_id),
    UNIQUE (tenant_id, station_id, assignment_id, employee_id),
    FOREIGN KEY (tenant_id, station_id)
        REFERENCES core.stations (tenant_id, station_id),
    FOREIGN KEY (tenant_id, employee_id)
        REFERENCES core.employees (tenant_id, employee_id),
    FOREIGN KEY (tenant_id, created_by_user_id)
        REFERENCES core.users (tenant_id, user_id),
    CHECK (planned_end_at > planned_start_at)
);

CREATE INDEX IF NOT EXISTS ix_shift_assignments_employee_day
    ON ops.scheduled_shift_assignments (tenant_id, employee_id, business_date)
    WHERE status IN ('PLANNED', 'CONFIRMED');

CREATE TABLE IF NOT EXISTS ops.shift_sessions (
    tenant_id       uuid NOT NULL,
    station_id      uuid NOT NULL,
    shift_session_id uuid NOT NULL DEFAULT gen_random_uuid(),
    business_date   date NOT NULL,
    shift_code      text NOT NULL,
    status          text NOT NULL DEFAULT 'OPEN'
                    CHECK (status IN ('OPEN', 'SUBMITTING', 'RECONCILIATION', 'CLOSED', 'REOPENED')),
    opened_by_user_id uuid NOT NULL,
    opened_at       timestamptz NOT NULL DEFAULT now(),
    closed_by_user_id uuid,
    closed_at       timestamptz,
    reopen_reason   text,
    row_version     integer NOT NULL DEFAULT 1 CHECK (row_version > 0),
    PRIMARY KEY (tenant_id, shift_session_id),
    UNIQUE (tenant_id, station_id, shift_session_id),
    FOREIGN KEY (tenant_id, station_id)
        REFERENCES core.stations (tenant_id, station_id),
    FOREIGN KEY (tenant_id, opened_by_user_id)
        REFERENCES core.users (tenant_id, user_id),
    FOREIGN KEY (tenant_id, closed_by_user_id)
        REFERENCES core.users (tenant_id, user_id),
    CHECK ((status IN ('CLOSED', 'REOPENED')) = (closed_at IS NOT NULL)),
    CHECK (closed_at IS NULL OR closed_at >= opened_at)
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_one_active_session_per_shift
    ON ops.shift_sessions (tenant_id, station_id, business_date, shift_code)
    WHERE status IN ('OPEN', 'SUBMITTING', 'RECONCILIATION', 'REOPENED');

CREATE TABLE IF NOT EXISTS ops.shift_session_participants (
    tenant_id       uuid NOT NULL,
    station_id      uuid NOT NULL,
    participant_id  uuid NOT NULL DEFAULT gen_random_uuid(),
    shift_session_id uuid NOT NULL,
    employee_id     uuid NOT NULL,
    assignment_id   uuid,
    participant_role text NOT NULL DEFAULT 'STAFF'
                    CHECK (participant_role IN ('STAFF', 'SHIFT_LEAD', 'SUPERVISOR')),
    joined_at       timestamptz NOT NULL DEFAULT now(),
    left_at         timestamptz,
    submitted_at    timestamptz,
    PRIMARY KEY (tenant_id, participant_id),
    UNIQUE (tenant_id, station_id, shift_session_id, participant_id),
    UNIQUE (tenant_id, station_id, shift_session_id, employee_id),
    FOREIGN KEY (tenant_id, station_id, shift_session_id)
        REFERENCES ops.shift_sessions (tenant_id, station_id, shift_session_id),
    FOREIGN KEY (tenant_id, employee_id)
        REFERENCES core.employees (tenant_id, employee_id),
    FOREIGN KEY (tenant_id, station_id, assignment_id, employee_id)
        REFERENCES ops.scheduled_shift_assignments
            (tenant_id, station_id, assignment_id, employee_id),
    CHECK (left_at IS NULL OR left_at >= joined_at)
);

CREATE TABLE IF NOT EXISTS ops.shift_devices (
    tenant_id       uuid NOT NULL,
    station_id      uuid NOT NULL,
    shift_session_id uuid NOT NULL,
    shift_device_id uuid NOT NULL DEFAULT gen_random_uuid(),
    registered_device_id uuid NOT NULL,
    participant_id  uuid,
    device_class    text NOT NULL CHECK (device_class IN ('DESKTOP_POS', 'PERSONAL_MOBILE', 'HANDHELD')),
    device_label    text NOT NULL,
    pos_lane_code   text,
    registered_by_user_id uuid NOT NULL,
    registered_at   timestamptz NOT NULL DEFAULT now(),
    last_seen_at    timestamptz,
    retired_at      timestamptz,
    PRIMARY KEY (tenant_id, shift_device_id),
    UNIQUE (tenant_id, station_id, shift_session_id, registered_device_id),
    FOREIGN KEY (tenant_id, station_id, shift_session_id)
        REFERENCES ops.shift_sessions (tenant_id, station_id, shift_session_id),
    FOREIGN KEY (tenant_id, station_id, shift_session_id, participant_id)
        REFERENCES ops.shift_session_participants (tenant_id, station_id, shift_session_id, participant_id),
    FOREIGN KEY (tenant_id, registered_by_user_id)
        REFERENCES core.users (tenant_id, user_id),
    CHECK (device_class <> 'PERSONAL_MOBILE' OR participant_id IS NOT NULL)
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_active_pos_lane_per_session
    ON ops.shift_devices (tenant_id, station_id, shift_session_id, pos_lane_code)
    WHERE device_class = 'DESKTOP_POS' AND retired_at IS NULL AND pos_lane_code IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS ux_one_active_personal_mobile_per_participant
    ON ops.shift_devices (tenant_id, station_id, shift_session_id, participant_id)
    WHERE device_class = 'PERSONAL_MOBILE' AND retired_at IS NULL;

-- Cross-row max(5) cannot be a CHECK: API transaction must lock shift_sessions FOR UPDATE,
-- count active DESKTOP_POS rows, reject #6 with 409, then INSERT before COMMIT.

CREATE TABLE IF NOT EXISTS ops.shift_tender_declarations (
    tenant_id       uuid NOT NULL,
    station_id      uuid NOT NULL,
    declaration_id  uuid NOT NULL DEFAULT gen_random_uuid(),
    shift_session_id uuid NOT NULL,
    participant_id  uuid NOT NULL,
    business_unit_id uuid NOT NULL,
    client_event_id uuid NOT NULL,
    declaration_kind text NOT NULL CHECK (declaration_kind IN (
        'CASH_OPENING_FLOAT', 'CASH_CLOSING_COUNT', 'CARD_SLIP_TOTAL',
        'IBAN_DECLARATION', 'CREDIT_SALE_TOTAL', 'CASH_OUT', 'ADJUSTMENT'
    )),
    payment_method  text NOT NULL CHECK (payment_method IN ('CASH', 'CARD', 'IBAN', 'CREDIT', 'OTHER')),
    amount_minor    bigint NOT NULL CHECK (amount_minor >= 0),
    currency_code   char(3) NOT NULL,
    source_kind     text NOT NULL CHECK (source_kind IN ('MANUAL', 'OCR_ASSISTED', 'POS_IMPORT', 'BANK_IMPORT')),
    status          text NOT NULL DEFAULT 'PENDING_REVIEW'
                    CHECK (status IN ('DRAFT', 'PENDING_REVIEW', 'SUBMITTED', 'MATCHED', 'REJECTED', 'REVERSED')),
    note            text,
    observed_at     timestamptz,
    created_at      timestamptz NOT NULL DEFAULT now(),
    submitted_at    timestamptz,
    PRIMARY KEY (tenant_id, declaration_id),
    UNIQUE (tenant_id, station_id, client_event_id),
    FOREIGN KEY (tenant_id, station_id, shift_session_id, participant_id)
        REFERENCES ops.shift_session_participants
            (tenant_id, station_id, shift_session_id, participant_id),
    FOREIGN KEY (tenant_id, station_id, business_unit_id)
        REFERENCES core.business_units (tenant_id, station_id, business_unit_id)
);

CREATE INDEX IF NOT EXISTS ix_tender_declarations_session_status
    ON ops.shift_tender_declarations (tenant_id, station_id, shift_session_id, status, created_at);

-- -----------------------------------------------------------------------------
-- 2. Evidence and OCR. Never store PAN/CVV/PIN/magnetic stripe data.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS evidence.payment_evidence (
    tenant_id       uuid NOT NULL,
    station_id      uuid NOT NULL,
    evidence_id     uuid NOT NULL DEFAULT gen_random_uuid(),
    shift_session_id uuid NOT NULL,
    participant_id  uuid NOT NULL,
    business_unit_id uuid NOT NULL,
    evidence_kind   text NOT NULL CHECK (evidence_kind IN ('CARD_SLIP', 'BANK_RECEIPT', 'TURPAK_REPORT', 'OKC_REPORT')),
    object_key      text NOT NULL,
    content_sha256  char(64) NOT NULL CHECK (content_sha256 ~ '^[0-9a-f]{64}$'),
    mime_type       text NOT NULL CHECK (mime_type IN ('image/jpeg', 'image/png', 'application/pdf')),
    captured_at     timestamptz,
    uploaded_at     timestamptz NOT NULL DEFAULT now(),
    uploaded_by_user_id uuid NOT NULL,
    terminal_ref_masked text,
    approval_ref    text,
    masked_pan_last4 char(4) CHECK (masked_pan_last4 IS NULL OR masked_pan_last4 ~ '^[0-9]{4}$'),
    status          text NOT NULL DEFAULT 'UPLOADED'
                    CHECK (status IN ('UPLOADED', 'OCR_PENDING', 'NEEDS_REVIEW', 'VERIFIED', 'REJECTED', 'REDACTED')),
    retention_until timestamptz,
    PRIMARY KEY (tenant_id, evidence_id),
    UNIQUE (tenant_id, evidence_id, station_id),
    UNIQUE (tenant_id, station_id, content_sha256),
    FOREIGN KEY (tenant_id, station_id, shift_session_id, participant_id)
        REFERENCES ops.shift_session_participants
            (tenant_id, station_id, shift_session_id, participant_id),
    FOREIGN KEY (tenant_id, station_id, business_unit_id)
        REFERENCES core.business_units (tenant_id, station_id, business_unit_id),
    FOREIGN KEY (tenant_id, uploaded_by_user_id)
        REFERENCES core.users (tenant_id, user_id)
);

CREATE TABLE IF NOT EXISTS evidence.ocr_jobs (
    tenant_id       uuid NOT NULL,
    station_id      uuid NOT NULL,
    ocr_job_id      uuid NOT NULL DEFAULT gen_random_uuid(),
    evidence_id     uuid NOT NULL,
    idempotency_key uuid NOT NULL,
    document_kind   text NOT NULL CHECK (document_kind IN ('CARD_SLIP', 'BANK_RECEIPT', 'TURPAK_REPORT', 'OKC_REPORT')),
    engine_name     text NOT NULL,
    engine_version  text NOT NULL,
    template_version text,
    status          text NOT NULL DEFAULT 'QUEUED'
                    CHECK (status IN ('QUEUED', 'RUNNING', 'SUCCEEDED', 'LOW_CONFIDENCE', 'FAILED', 'CANCELLED')),
    attempt_count   integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
    sanitized_fields jsonb NOT NULL DEFAULT '{}'::jsonb,
    field_confidence jsonb NOT NULL DEFAULT '{}'::jsonb,
    extracted_total_minor bigint CHECK (extracted_total_minor IS NULL OR extracted_total_minor >= 0),
    currency_code   char(3),
    completed_at    timestamptz,
    created_at      timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (tenant_id, ocr_job_id),
    UNIQUE (tenant_id, ocr_job_id, station_id),
    UNIQUE (tenant_id, station_id, idempotency_key),
    FOREIGN KEY (tenant_id, evidence_id, station_id)
        REFERENCES evidence.payment_evidence (tenant_id, evidence_id, station_id)
);

CREATE INDEX IF NOT EXISTS ix_ocr_jobs_queue
    ON evidence.ocr_jobs (status, created_at)
    WHERE status IN ('QUEUED', 'FAILED', 'LOW_CONFIDENCE');

CREATE TABLE IF NOT EXISTS evidence.ocr_field_reviews (
    tenant_id       uuid NOT NULL,
    station_id      uuid NOT NULL,
    ocr_review_id   uuid NOT NULL DEFAULT gen_random_uuid(),
    ocr_job_id      uuid NOT NULL,
    review_event_id uuid NOT NULL,
    field_name      text NOT NULL CHECK (field_name IN (
        'amount', 'currency', 'transaction_date', 'transaction_time',
        'terminal_id', 'approval_ref', 'batch_no'
    )),
    ocr_value       text,
    accepted_value  text,
    confidence      numeric(5,4) CHECK (confidence BETWEEN 0 AND 1),
    review_action   text NOT NULL CHECK (review_action IN ('CONFIRM', 'CORRECT', 'REJECT')),
    reviewed_by_user_id uuid NOT NULL,
    reviewed_at     timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (tenant_id, ocr_review_id),
    UNIQUE (tenant_id, review_event_id),
    FOREIGN KEY (tenant_id, ocr_job_id, station_id)
        REFERENCES evidence.ocr_jobs (tenant_id, ocr_job_id, station_id),
    FOREIGN KEY (tenant_id, reviewed_by_user_id)
        REFERENCES core.users (tenant_id, user_id),
    CHECK ((review_action = 'REJECT') OR accepted_value IS NOT NULL)
);

-- sanitized_fields is allow-listed: amount/date/time/terminal/batch/approval ref only.
-- Raw OCR output must never contain/store PAN, CVV, PIN, track data, API secrets, or needless PII.

-- -----------------------------------------------------------------------------
-- 3. Operational reconciliation cases.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ops.reconciliation_cases (
    tenant_id       uuid NOT NULL,
    station_id      uuid NOT NULL,
    reconciliation_case_id uuid NOT NULL DEFAULT gen_random_uuid(),
    shift_session_id uuid NOT NULL,
    business_unit_id uuid NOT NULL,
    metric_code     text NOT NULL CHECK (metric_code IN (
        'FUEL_TURPAK_VS_OKC', 'CASH_EXPECTED_VS_COUNTED', 'CARD_SLIPS_VS_POS',
        'IBAN_DECLARATION_VS_BANK', 'CREDIT_SALES_VS_AR', 'MARKET_POS_VS_STOCK'
    )),
    expected_minor bigint,
    declared_minor bigint,
    settled_minor bigint,
    difference_minor bigint,
    currency_code   char(3) NOT NULL,
    status          text NOT NULL DEFAULT 'OPEN'
                    CHECK (status IN ('OPEN', 'NEEDS_REVIEW', 'RESOLVED', 'APPROVED_EXCEPTION', 'REJECTED')),
    source_refs     jsonb NOT NULL DEFAULT '[]'::jsonb,
    resolution_code text,
    resolution_note text,
    resolved_by_user_id uuid,
    resolved_at     timestamptz,
    created_at      timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (tenant_id, reconciliation_case_id),
    FOREIGN KEY (tenant_id, station_id, shift_session_id)
        REFERENCES ops.shift_sessions (tenant_id, station_id, shift_session_id),
    FOREIGN KEY (tenant_id, station_id, business_unit_id)
        REFERENCES core.business_units (tenant_id, station_id, business_unit_id),
    FOREIGN KEY (tenant_id, resolved_by_user_id)
        REFERENCES core.users (tenant_id, user_id),
    CHECK ((status IN ('RESOLVED', 'APPROVED_EXCEPTION', 'REJECTED')) = (resolved_at IS NOT NULL))
);

-- -----------------------------------------------------------------------------
-- 4. Customer/organization AR subledger. Supplier AP is a separate market schema.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ar.debtor_accounts (
    tenant_id       uuid NOT NULL,
    debtor_account_id uuid NOT NULL DEFAULT gen_random_uuid(),
    business_unit_id uuid NOT NULL,
    party_id        uuid NOT NULL,
    credit_terms_id uuid,
    currency_code   char(3) NOT NULL,
    credit_limit_minor bigint CHECK (credit_limit_minor IS NULL OR credit_limit_minor >= 0),
    status          text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'SUSPENDED', 'CLOSED')),
    opened_at       timestamptz NOT NULL DEFAULT now(),
    closed_at       timestamptz,
    created_by_user_id uuid NOT NULL,
    PRIMARY KEY (tenant_id, debtor_account_id),
    UNIQUE (tenant_id, debtor_account_id, business_unit_id, currency_code),
    UNIQUE (tenant_id, business_unit_id, party_id, currency_code),
    FOREIGN KEY (tenant_id, business_unit_id)
        REFERENCES core.business_units (tenant_id, business_unit_id),
    FOREIGN KEY (tenant_id, party_id)
        REFERENCES core.parties (tenant_id, party_id),
    FOREIGN KEY (tenant_id, credit_terms_id)
        REFERENCES ar.credit_terms (tenant_id, credit_terms_id),
    FOREIGN KEY (tenant_id, created_by_user_id)
        REFERENCES core.users (tenant_id, user_id),
    CHECK (closed_at IS NULL OR closed_at >= opened_at)
);

CREATE TABLE IF NOT EXISTS ops.sales (
    tenant_id       uuid NOT NULL,
    station_id      uuid NOT NULL,
    business_unit_id uuid NOT NULL,
    sale_id         uuid NOT NULL DEFAULT gen_random_uuid(),
    source_event_id text NOT NULL,
    sold_at         timestamptz NOT NULL,
    currency_code   char(3) NOT NULL,
    total_minor     bigint NOT NULL CHECK (total_minor >= 0),
    shift_session_id uuid,
    PRIMARY KEY (tenant_id, sale_id),
    UNIQUE (tenant_id, station_id, business_unit_id, sale_id),
    UNIQUE (tenant_id, sale_id, business_unit_id, currency_code),
    UNIQUE (tenant_id, business_unit_id, source_event_id),
    FOREIGN KEY (tenant_id, station_id, business_unit_id)
        REFERENCES core.business_units (tenant_id, station_id, business_unit_id),
    FOREIGN KEY (tenant_id, station_id, shift_session_id)
        REFERENCES ops.shift_sessions (tenant_id, station_id, shift_session_id)
);

CREATE TABLE IF NOT EXISTS ops.sale_payments (
    tenant_id       uuid NOT NULL,
    sale_payment_id uuid NOT NULL DEFAULT gen_random_uuid(),
    sale_id         uuid NOT NULL,
    debtor_account_id uuid,
    business_unit_id uuid NOT NULL,
    tender_type     text NOT NULL CHECK (tender_type IN ('CASH', 'CARD', 'IBAN', 'CREDIT', 'OTHER')),
    amount_minor    bigint NOT NULL CHECK (amount_minor > 0),
    currency_code   char(3) NOT NULL,
    due_date_snapshot date,
    created_at      timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (tenant_id, sale_payment_id),
    UNIQUE (tenant_id, sale_payment_id, debtor_account_id, business_unit_id, currency_code),
    FOREIGN KEY (tenant_id, sale_id, business_unit_id, currency_code)
        REFERENCES ops.sales (tenant_id, sale_id, business_unit_id, currency_code),
    FOREIGN KEY (tenant_id, debtor_account_id, business_unit_id, currency_code)
        REFERENCES ar.debtor_accounts (tenant_id, debtor_account_id, business_unit_id, currency_code),
    CHECK ((tender_type = 'CREDIT') = (debtor_account_id IS NOT NULL))
);

CREATE TABLE IF NOT EXISTS ar.receipts (
    tenant_id       uuid NOT NULL,
    station_id      uuid NOT NULL,
    receipt_id      uuid NOT NULL DEFAULT gen_random_uuid(),
    debtor_account_id uuid NOT NULL,
    business_unit_id uuid NOT NULL,
    shift_session_id uuid,
    recorded_by_user_id uuid NOT NULL,
    received_at     timestamptz NOT NULL DEFAULT now(),
    total_minor     bigint NOT NULL CHECK (total_minor > 0),
    currency_code   char(3) NOT NULL,
    status          text NOT NULL DEFAULT 'DRAFT'
                    CHECK (status IN ('DRAFT', 'PENDING_MATCH', 'PARTIALLY_POSTED', 'POSTED', 'REVERSED')),
    PRIMARY KEY (tenant_id, receipt_id),
    UNIQUE (tenant_id, receipt_id, debtor_account_id, business_unit_id, currency_code),
    UNIQUE (tenant_id, receipt_id, station_id, debtor_account_id, business_unit_id, currency_code),
    FOREIGN KEY (tenant_id, station_id, business_unit_id)
        REFERENCES core.business_units (tenant_id, station_id, business_unit_id),
    FOREIGN KEY (tenant_id, debtor_account_id, business_unit_id, currency_code)
        REFERENCES ar.debtor_accounts (tenant_id, debtor_account_id, business_unit_id, currency_code),
    FOREIGN KEY (tenant_id, station_id, shift_session_id)
        REFERENCES ops.shift_sessions (tenant_id, station_id, shift_session_id),
    FOREIGN KEY (tenant_id, recorded_by_user_id)
        REFERENCES core.users (tenant_id, user_id)
);

CREATE TABLE IF NOT EXISTS ar.receipt_tenders (
    tenant_id       uuid NOT NULL,
    station_id      uuid NOT NULL,
    receipt_tender_id uuid NOT NULL DEFAULT gen_random_uuid(),
    receipt_id      uuid NOT NULL,
    debtor_account_id uuid NOT NULL,
    business_unit_id uuid NOT NULL,
    method          text NOT NULL CHECK (method IN ('CASH', 'CARD', 'IBAN')),
    amount_minor    bigint NOT NULL CHECK (amount_minor > 0),
    currency_code   char(3) NOT NULL,
    bank_or_terminal_ref text,
    source_event_id text,
    settlement_status text NOT NULL DEFAULT 'PENDING_MATCH'
                    CHECK (settlement_status IN ('PENDING_MATCH', 'VERIFIED', 'REJECTED', 'REVERSED')),
    verified_at     timestamptz,
    created_at      timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (tenant_id, receipt_tender_id),
    UNIQUE (tenant_id, receipt_tender_id, debtor_account_id, business_unit_id, currency_code),
    UNIQUE (tenant_id, station_id, source_event_id),
    FOREIGN KEY (tenant_id, receipt_id, station_id, debtor_account_id, business_unit_id, currency_code)
        REFERENCES ar.receipts (tenant_id, receipt_id, station_id, debtor_account_id, business_unit_id, currency_code),
    FOREIGN KEY (tenant_id, station_id, business_unit_id)
        REFERENCES core.business_units (tenant_id, station_id, business_unit_id),
    CHECK (settlement_status <> 'VERIFIED' OR verified_at IS NOT NULL)
);

CREATE TABLE IF NOT EXISTS ar.receivable_entries (
    tenant_id       uuid NOT NULL,
    receivable_entry_id uuid NOT NULL DEFAULT gen_random_uuid(),
    debtor_account_id uuid NOT NULL,
    business_unit_id uuid NOT NULL,
    entry_side      text NOT NULL CHECK (entry_side IN ('DEBIT', 'CREDIT')),
    entry_type      text NOT NULL CHECK (entry_type IN (
        'SALE_DEBIT', 'RECEIPT_CREDIT', 'CREDIT_NOTE', 'ADJUSTMENT',
        'WRITE_OFF', 'OPENING_BALANCE', 'REVERSAL'
    )),
    amount_minor    bigint NOT NULL CHECK (amount_minor > 0),
    currency_code   char(3) NOT NULL,
    due_date        date,
    source_sale_payment_id uuid,
    source_receipt_tender_id uuid,
    reversal_of_entry_id uuid,
    status          text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'POSTED')),
    posted_at       timestamptz,
    created_by_user_id uuid NOT NULL,
    created_at      timestamptz NOT NULL DEFAULT now(),
    reason          text,
    PRIMARY KEY (tenant_id, receivable_entry_id),
    UNIQUE (tenant_id, receivable_entry_id, debtor_account_id, business_unit_id, currency_code),
    FOREIGN KEY (tenant_id, debtor_account_id, business_unit_id, currency_code)
        REFERENCES ar.debtor_accounts (tenant_id, debtor_account_id, business_unit_id, currency_code),
    FOREIGN KEY (tenant_id, source_sale_payment_id, debtor_account_id, business_unit_id, currency_code)
        REFERENCES ops.sale_payments
            (tenant_id, sale_payment_id, debtor_account_id, business_unit_id, currency_code),
    FOREIGN KEY (tenant_id, source_receipt_tender_id, debtor_account_id, business_unit_id, currency_code)
        REFERENCES ar.receipt_tenders
            (tenant_id, receipt_tender_id, debtor_account_id, business_unit_id, currency_code),
    FOREIGN KEY (tenant_id, reversal_of_entry_id)
        REFERENCES ar.receivable_entries (tenant_id, receivable_entry_id),
    FOREIGN KEY (tenant_id, created_by_user_id)
        REFERENCES core.users (tenant_id, user_id),
    CHECK (num_nonnulls(source_sale_payment_id, source_receipt_tender_id) <= 1),
    CHECK ((entry_type = 'SALE_DEBIT') = (source_sale_payment_id IS NOT NULL)),
    CHECK ((entry_type = 'RECEIPT_CREDIT') = (source_receipt_tender_id IS NOT NULL)),
    CHECK (entry_type <> 'SALE_DEBIT' OR entry_side = 'DEBIT'),
    CHECK (entry_type <> 'RECEIPT_CREDIT' OR entry_side = 'CREDIT'),
    CHECK ((entry_type = 'REVERSAL') = (reversal_of_entry_id IS NOT NULL)),
    CHECK ((status = 'POSTED') = (posted_at IS NOT NULL))
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_ar_sale_payment_once
    ON ar.receivable_entries (tenant_id, source_sale_payment_id)
    WHERE source_sale_payment_id IS NOT NULL AND entry_type = 'SALE_DEBIT';

CREATE UNIQUE INDEX IF NOT EXISTS ux_ar_receipt_tender_once
    ON ar.receivable_entries (tenant_id, source_receipt_tender_id)
    WHERE source_receipt_tender_id IS NOT NULL AND entry_type = 'RECEIPT_CREDIT';

CREATE TABLE IF NOT EXISTS ar.receipt_allocations (
    tenant_id       uuid NOT NULL,
    allocation_id   uuid NOT NULL DEFAULT gen_random_uuid(),
    credit_entry_id uuid NOT NULL,
    debit_entry_id  uuid NOT NULL,
    amount_minor    bigint NOT NULL CHECK (amount_minor > 0),
    source_event_id uuid NOT NULL DEFAULT gen_random_uuid(),
    allocated_by_user_id uuid NOT NULL,
    allocated_at    timestamptz NOT NULL DEFAULT now(),
    allocation_action text NOT NULL DEFAULT 'APPLY' CHECK (allocation_action IN ('APPLY', 'REVERSE')),
    reversal_of_allocation_id uuid,
    PRIMARY KEY (tenant_id, allocation_id),
    UNIQUE (tenant_id, allocation_id, credit_entry_id, debit_entry_id),
    UNIQUE (tenant_id, source_event_id),
    FOREIGN KEY (tenant_id, credit_entry_id)
        REFERENCES ar.receivable_entries (tenant_id, receivable_entry_id),
    FOREIGN KEY (tenant_id, debit_entry_id)
        REFERENCES ar.receivable_entries (tenant_id, receivable_entry_id),
    FOREIGN KEY (tenant_id, allocated_by_user_id)
        REFERENCES core.users (tenant_id, user_id),
    FOREIGN KEY (tenant_id, reversal_of_allocation_id)
        REFERENCES ar.receipt_allocations (tenant_id, allocation_id),
    CHECK (credit_entry_id <> debit_entry_id),
    CHECK ((allocation_action = 'APPLY' AND reversal_of_allocation_id IS NULL)
        OR (allocation_action = 'REVERSE' AND reversal_of_allocation_id IS NOT NULL))
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_receipt_allocation_reversed_once
    ON ar.receipt_allocations (tenant_id, reversal_of_allocation_id)
    WHERE allocation_action = 'REVERSE';

CREATE TABLE IF NOT EXISTS ar.credit_limit_approvals (
    tenant_id       uuid NOT NULL,
    approval_id     uuid NOT NULL DEFAULT gen_random_uuid(),
    debtor_account_id uuid NOT NULL,
    before_limit_minor bigint,
    requested_limit_minor bigint NOT NULL CHECK (requested_limit_minor >= 0),
    approved_limit_minor bigint CHECK (approved_limit_minor IS NULL OR approved_limit_minor >= 0),
    requested_by_user_id uuid NOT NULL,
    approved_by_user_id uuid,
    reason          text NOT NULL,
    decision_status text NOT NULL DEFAULT 'PENDING'
                    CHECK (decision_status IN ('PENDING', 'APPROVED', 'REJECTED')),
    requested_at    timestamptz NOT NULL DEFAULT now(),
    decided_at      timestamptz,
    PRIMARY KEY (tenant_id, approval_id),
    FOREIGN KEY (tenant_id, debtor_account_id)
        REFERENCES ar.debtor_accounts (tenant_id, debtor_account_id),
    FOREIGN KEY (tenant_id, requested_by_user_id)
        REFERENCES core.users (tenant_id, user_id),
    FOREIGN KEY (tenant_id, approved_by_user_id)
        REFERENCES core.users (tenant_id, user_id),
    CHECK (before_limit_minor IS NULL OR before_limit_minor >= 0),
    CHECK (approved_by_user_id IS NULL OR approved_by_user_id <> requested_by_user_id),
    CHECK ((decision_status = 'PENDING') = (decided_at IS NULL)),
    CHECK ((decision_status = 'PENDING') = (approved_by_user_id IS NULL))
);

-- Deferred constraint triggers / transaction service must additionally enforce:
-- 1) SUM(receipt_tenders.amount_minor) = receipts.total_minor before POSTED.
-- 2) receipt_allocations use same debtor_account_id/business_unit_id/currency on both entries.
-- 3) Posted allocation sums never exceed the credit or debit open balance; lock both entries.
-- 4) Posted ledger/allocation rows are immutable; correction inserts a REVERSAL entry
--    or REVERSE allocation event with matching source/account/scope/amount and actor.
-- 5) A VERIFIED receipt_tender may create only one RECEIPT_CREDIT.

-- -----------------------------------------------------------------------------
-- 5. Market inventory, supplier AP, offers, POs, weekly suggestions.
-- -----------------------------------------------------------------------------
-- All market business_unit_id values must resolve to domain_code='MARKET'.
-- This compact sample has generic composite FKs; enforce the domain check with a
-- production composite FK/domain guard trigger (and keep all fuel tables separate).
CREATE TABLE IF NOT EXISTS market.products (
    tenant_id       uuid NOT NULL REFERENCES core.tenants(tenant_id),
    product_id      uuid NOT NULL DEFAULT gen_random_uuid(),
    sku             text NOT NULL,
    product_name    text NOT NULL,
    base_unit       text NOT NULL DEFAULT 'EA' CHECK (base_unit = 'EA'),
    active          boolean NOT NULL DEFAULT true,
    PRIMARY KEY (tenant_id, product_id),
    UNIQUE (tenant_id, sku)
);

CREATE TABLE IF NOT EXISTS market.inventory_movements (
    tenant_id       uuid NOT NULL,
    station_id      uuid NOT NULL,
    business_unit_id uuid NOT NULL,
    movement_id     uuid NOT NULL DEFAULT gen_random_uuid(),
    product_id      uuid NOT NULL,
    movement_kind   text NOT NULL CHECK (movement_kind IN (
        'GOODS_RECEIPT', 'SALE', 'SALE_RETURN', 'SUPPLIER_RETURN',
        'DAMAGE', 'WASTE', 'COUNT_ADJUSTMENT', 'TRANSFER_IN', 'TRANSFER_OUT', 'REVERSAL'
    )),
    quantity_delta  numeric(18,3) NOT NULL CHECK (quantity_delta <> 0),
    source_type     text NOT NULL,
    source_id       text NOT NULL,
    source_event_id text NOT NULL,
    occurred_at     timestamptz NOT NULL,
    recorded_by_user_id uuid,
    approved_by_user_id uuid,
    reason          text,
    created_at      timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (tenant_id, movement_id),
    UNIQUE (tenant_id, station_id, source_type, source_event_id),
    FOREIGN KEY (tenant_id, station_id, business_unit_id)
        REFERENCES core.business_units (tenant_id, station_id, business_unit_id),
    FOREIGN KEY (tenant_id, product_id)
        REFERENCES market.products (tenant_id, product_id),
    FOREIGN KEY (tenant_id, recorded_by_user_id)
        REFERENCES core.users (tenant_id, user_id),
    FOREIGN KEY (tenant_id, approved_by_user_id)
        REFERENCES core.users (tenant_id, user_id)
);

CREATE TABLE IF NOT EXISTS market.inventory_balances (
    tenant_id       uuid NOT NULL,
    station_id      uuid NOT NULL,
    business_unit_id uuid NOT NULL,
    product_id      uuid NOT NULL,
    on_hand_good_qty numeric(18,3) NOT NULL DEFAULT 0 CHECK (on_hand_good_qty >= 0),
    reserved_qty    numeric(18,3) NOT NULL DEFAULT 0 CHECK (reserved_qty >= 0),
    snapshot_at     timestamptz NOT NULL DEFAULT now(),
    stock_integrity_issue boolean NOT NULL DEFAULT false,
    PRIMARY KEY (tenant_id, station_id, business_unit_id, product_id),
    FOREIGN KEY (tenant_id, station_id, business_unit_id)
        REFERENCES core.business_units (tenant_id, station_id, business_unit_id),
    FOREIGN KEY (tenant_id, product_id)
        REFERENCES market.products (tenant_id, product_id),
    CHECK (reserved_qty <= on_hand_good_qty)
);

CREATE TABLE IF NOT EXISTS market.product_daily_demand (
    tenant_id       uuid NOT NULL,
    station_id      uuid NOT NULL,
    business_unit_id uuid NOT NULL,
    product_id      uuid NOT NULL,
    business_date   date NOT NULL,
    net_qty         numeric(18,3) NOT NULL DEFAULT 0,
    stockout_minutes integer NOT NULL DEFAULT 0 CHECK (stockout_minutes BETWEEN 0 AND 1440),
    source_updated_at timestamptz NOT NULL,
    data_quality    text NOT NULL DEFAULT 'COMPLETE'
                    CHECK (data_quality IN ('COMPLETE', 'PARTIAL', 'STOCKOUT', 'STALE', 'REVIEW')),
    PRIMARY KEY (tenant_id, station_id, business_unit_id, product_id, business_date),
    FOREIGN KEY (tenant_id, station_id, business_unit_id)
        REFERENCES core.business_units (tenant_id, station_id, business_unit_id),
    FOREIGN KEY (tenant_id, product_id)
        REFERENCES market.products (tenant_id, product_id)
);

CREATE TABLE IF NOT EXISTS market.supplier_accounts (
    tenant_id       uuid NOT NULL,
    station_id      uuid NOT NULL,
    business_unit_id uuid NOT NULL,
    supplier_account_id uuid NOT NULL DEFAULT gen_random_uuid(),
    supplier_party_id uuid NOT NULL,
    currency_code   char(3) NOT NULL,
    account_status  text NOT NULL DEFAULT 'ACTIVE' CHECK (account_status IN ('ACTIVE', 'ON_HOLD', 'CLOSED')),
    PRIMARY KEY (tenant_id, supplier_account_id),
    UNIQUE (tenant_id, supplier_account_id, currency_code),
    UNIQUE (tenant_id, station_id, supplier_account_id, currency_code),
    UNIQUE (tenant_id, station_id, business_unit_id, supplier_account_id, currency_code),
    UNIQUE (tenant_id, station_id, business_unit_id, supplier_party_id, currency_code),
    FOREIGN KEY (tenant_id, station_id, business_unit_id)
        REFERENCES core.business_units (tenant_id, station_id, business_unit_id),
    FOREIGN KEY (tenant_id, supplier_party_id)
        REFERENCES core.parties (tenant_id, party_id)
);

-- Read projection from the supplier AP ledger; source ledger remains immutable and authoritative.
CREATE TABLE IF NOT EXISTS market.supplier_ap_open_items (
    tenant_id       uuid NOT NULL,
    supplier_ap_item_id uuid NOT NULL DEFAULT gen_random_uuid(),
    supplier_account_id uuid NOT NULL,
    source_invoice_ref text NOT NULL,
    invoice_date    date NOT NULL,
    due_date        date,
    original_amount_minor bigint NOT NULL CHECK (original_amount_minor >= 0),
    open_amount_minor bigint NOT NULL CHECK (open_amount_minor >= 0),
    currency_code   char(3) NOT NULL,
    status          text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'CLOSED', 'DISPUTED', 'VOID')),
    updated_at      timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (tenant_id, supplier_ap_item_id),
    UNIQUE (tenant_id, supplier_account_id, source_invoice_ref),
    FOREIGN KEY (tenant_id, supplier_account_id, currency_code)
        REFERENCES market.supplier_accounts (tenant_id, supplier_account_id, currency_code),
    CHECK (open_amount_minor <= original_amount_minor)
);

CREATE TABLE IF NOT EXISTS market.supplier_credit_profiles (
    tenant_id       uuid NOT NULL,
    supplier_credit_profile_id uuid NOT NULL DEFAULT gen_random_uuid(),
    supplier_account_id uuid NOT NULL,
    currency_code   char(3) NOT NULL,
    credit_limit_minor bigint CHECK (credit_limit_minor IS NULL OR credit_limit_minor >= 0),
    valid_from      date NOT NULL,
    valid_to        date,
    PRIMARY KEY (tenant_id, supplier_credit_profile_id),
    UNIQUE (tenant_id, supplier_account_id, currency_code, valid_from),
    FOREIGN KEY (tenant_id, supplier_account_id, currency_code)
        REFERENCES market.supplier_accounts (tenant_id, supplier_account_id, currency_code),
    CHECK (valid_to IS NULL OR valid_to >= valid_from)
);

CREATE INDEX IF NOT EXISTS ix_supplier_credit_profile_current
    ON market.supplier_credit_profiles (tenant_id, supplier_account_id, currency_code, valid_from DESC);

CREATE TABLE IF NOT EXISTS market.supplier_product_offers (
    tenant_id       uuid NOT NULL,
    station_id      uuid NOT NULL,
    business_unit_id uuid NOT NULL,
    supplier_account_id uuid NOT NULL,
    product_id      uuid NOT NULL,
    offer_id        uuid NOT NULL DEFAULT gen_random_uuid(),
    pack_qty        numeric(18,3) NOT NULL CHECK (pack_qty > 0),
    min_order_qty   numeric(18,3) NOT NULL DEFAULT 0 CHECK (min_order_qty >= 0),
    net_unit_price_minor bigint NOT NULL CHECK (net_unit_price_minor >= 0),
    currency_code   char(3) NOT NULL,
    lead_days       integer NOT NULL CHECK (lead_days >= 0),
    fill_rate_90d   numeric(5,4) CHECK (fill_rate_90d BETWEEN 0 AND 1),
    valid_from      date NOT NULL,
    valid_to        date,
    price_updated_at timestamptz NOT NULL,
    PRIMARY KEY (tenant_id, offer_id),
    FOREIGN KEY (tenant_id, station_id, business_unit_id)
        REFERENCES core.business_units (tenant_id, station_id, business_unit_id),
    FOREIGN KEY (tenant_id, station_id, business_unit_id, supplier_account_id, currency_code)
        REFERENCES market.supplier_accounts (tenant_id, station_id, business_unit_id, supplier_account_id, currency_code),
    FOREIGN KEY (tenant_id, product_id)
        REFERENCES market.products (tenant_id, product_id),
    CHECK (valid_to IS NULL OR valid_to >= valid_from)
);

CREATE INDEX IF NOT EXISTS ix_supplier_offer_product_current
    ON market.supplier_product_offers (tenant_id, station_id, business_unit_id, product_id, valid_from DESC)
    WHERE valid_to IS NULL;

CREATE TABLE IF NOT EXISTS market.purchase_orders (
    tenant_id       uuid NOT NULL,
    station_id      uuid NOT NULL,
    business_unit_id uuid NOT NULL,
    purchase_order_id uuid NOT NULL DEFAULT gen_random_uuid(),
    supplier_account_id uuid NOT NULL,
    order_status    text NOT NULL DEFAULT 'DRAFT'
                    CHECK (order_status IN ('DRAFT', 'APPROVED', 'SENT', 'PARTIAL', 'RECEIVED', 'CANCELLED')),
    ordered_at      timestamptz,
    expected_delivery_at timestamptz,
    created_by_user_id uuid NOT NULL,
    approved_by_user_id uuid,
    approved_at     timestamptz,
    currency_code   char(3) NOT NULL,
    PRIMARY KEY (tenant_id, purchase_order_id),
    UNIQUE (tenant_id, station_id, business_unit_id, purchase_order_id),
    UNIQUE (tenant_id, station_id, business_unit_id, purchase_order_id, currency_code),
    FOREIGN KEY (tenant_id, station_id, business_unit_id)
        REFERENCES core.business_units (tenant_id, station_id, business_unit_id),
    FOREIGN KEY (tenant_id, station_id, business_unit_id, supplier_account_id, currency_code)
        REFERENCES market.supplier_accounts (tenant_id, station_id, business_unit_id, supplier_account_id, currency_code),
    FOREIGN KEY (tenant_id, created_by_user_id)
        REFERENCES core.users (tenant_id, user_id),
    FOREIGN KEY (tenant_id, approved_by_user_id)
        REFERENCES core.users (tenant_id, user_id),
    CHECK (order_status NOT IN ('APPROVED', 'SENT', 'PARTIAL', 'RECEIVED')
           OR (approved_by_user_id IS NOT NULL AND approved_at IS NOT NULL))
);

CREATE TABLE IF NOT EXISTS market.purchase_order_lines (
    tenant_id       uuid NOT NULL,
    station_id      uuid NOT NULL,
    business_unit_id uuid NOT NULL,
    purchase_order_line_id uuid NOT NULL DEFAULT gen_random_uuid(),
    purchase_order_id uuid NOT NULL,
    product_id      uuid NOT NULL,
    ordered_qty     numeric(18,3) NOT NULL CHECK (ordered_qty > 0),
    accepted_qty    numeric(18,3) NOT NULL DEFAULT 0 CHECK (accepted_qty >= 0),
    cancelled_qty   numeric(18,3) NOT NULL DEFAULT 0 CHECK (cancelled_qty >= 0),
    invoiced_qty    numeric(18,3) NOT NULL DEFAULT 0 CHECK (invoiced_qty >= 0),
    unit_price_minor bigint NOT NULL CHECK (unit_price_minor >= 0),
    currency_code   char(3) NOT NULL,
    PRIMARY KEY (tenant_id, purchase_order_line_id),
    UNIQUE (tenant_id, purchase_order_id, product_id),
    FOREIGN KEY (tenant_id, station_id, business_unit_id, purchase_order_id, currency_code)
        REFERENCES market.purchase_orders
            (tenant_id, station_id, business_unit_id, purchase_order_id, currency_code),
    FOREIGN KEY (tenant_id, product_id)
        REFERENCES market.products (tenant_id, product_id),
    CHECK (accepted_qty + cancelled_qty <= ordered_qty),
    CHECK (invoiced_qty + cancelled_qty <= ordered_qty)
);

-- Invoice posting does not mean the goods were physically accepted.
CREATE OR REPLACE VIEW market.v_open_supply AS
SELECT pol.tenant_id, pol.station_id, pol.business_unit_id,
       po.supplier_account_id, pol.product_id, pol.purchase_order_id,
       pol.purchase_order_line_id,
       (pol.ordered_qty - pol.accepted_qty - pol.cancelled_qty) AS open_inbound_qty,
       po.expected_delivery_at, po.order_status, po.currency_code
FROM market.purchase_order_lines AS pol
JOIN market.purchase_orders AS po
  ON po.tenant_id = pol.tenant_id
 AND po.station_id = pol.station_id
 AND po.business_unit_id = pol.business_unit_id
 AND po.purchase_order_id = pol.purchase_order_id
WHERE po.order_status IN ('APPROVED', 'SENT', 'PARTIAL')
  AND pol.ordered_qty > pol.accepted_qty + pol.cancelled_qty;

-- Financial exposure view: invoiced quantity is excluded from unbilled commitment,
-- even if still physically in transit; it remains in v_open_supply until accepted/cancelled.
CREATE OR REPLACE VIEW market.v_unbilled_commitments AS
SELECT pol.tenant_id, pol.station_id, pol.business_unit_id,
       po.supplier_account_id, po.currency_code, pol.purchase_order_id,
       SUM(GREATEST(pol.ordered_qty - pol.invoiced_qty - pol.cancelled_qty, 0)
           * pol.unit_price_minor) AS commitment_minor
FROM market.purchase_order_lines AS pol
JOIN market.purchase_orders AS po
  ON po.tenant_id = pol.tenant_id
 AND po.station_id = pol.station_id
 AND po.business_unit_id = pol.business_unit_id
 AND po.purchase_order_id = pol.purchase_order_id
WHERE po.order_status IN ('APPROVED', 'SENT', 'PARTIAL', 'RECEIVED')
GROUP BY pol.tenant_id, pol.station_id, pol.business_unit_id,
         po.supplier_account_id, po.currency_code, pol.purchase_order_id;

CREATE TABLE IF NOT EXISTS market.recommendation_batches (
    tenant_id       uuid NOT NULL,
    station_id      uuid NOT NULL,
    business_unit_id uuid NOT NULL,
    recommendation_batch_id uuid NOT NULL DEFAULT gen_random_uuid(),
    as_of_date      date NOT NULL,
    generated_at    timestamptz NOT NULL DEFAULT now(),
    algorithm_version text NOT NULL,
    status          text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'APPROVED', 'REJECTED', 'EXPIRED')),
    created_by_user_id uuid NOT NULL,
    approved_by_user_id uuid,
    approved_at     timestamptz,
    data_snapshot_hash char(64),
    PRIMARY KEY (tenant_id, recommendation_batch_id),
    UNIQUE (tenant_id, recommendation_batch_id, station_id, business_unit_id),
    FOREIGN KEY (tenant_id, station_id, business_unit_id)
        REFERENCES core.business_units (tenant_id, station_id, business_unit_id),
    FOREIGN KEY (tenant_id, created_by_user_id)
        REFERENCES core.users (tenant_id, user_id),
    FOREIGN KEY (tenant_id, approved_by_user_id)
        REFERENCES core.users (tenant_id, user_id),
    CHECK ((status = 'APPROVED') = (approved_at IS NOT NULL)),
    CHECK ((status = 'APPROVED') = (approved_by_user_id IS NOT NULL))
);

CREATE TABLE IF NOT EXISTS market.recommendation_lines (
    tenant_id       uuid NOT NULL,
    station_id      uuid NOT NULL,
    business_unit_id uuid NOT NULL,
    recommendation_batch_id uuid NOT NULL,
    recommendation_line_id uuid NOT NULL DEFAULT gen_random_uuid(),
    product_id      uuid NOT NULL,
    supplier_account_id uuid,
    currency_code   char(3),
    avg_daily_qty   numeric(18,4),
    lead_days       integer,
    review_days     integer,
    on_hand_good_qty numeric(18,3),
    reserved_qty    numeric(18,3),
    on_order_qty    numeric(18,3),
    safety_stock_qty numeric(18,3),
    need_raw_qty    numeric(18,3),
    pack_qty        numeric(18,3),
    min_order_qty   numeric(18,3),
    recommended_qty numeric(18,3),
    estimated_cost_minor bigint,
    risk_status     text NOT NULL DEFAULT 'OK'
                    CHECK (risk_status IN ('OK', 'LIMIT_RISK', 'OVERDUE', 'STALE_DATA', 'STOCKOUT_CENSORED', 'NEEDS_REVIEW')),
    explanation     jsonb NOT NULL DEFAULT '{}'::jsonb,
    PRIMARY KEY (tenant_id, recommendation_line_id),
    FOREIGN KEY (tenant_id, recommendation_batch_id, station_id, business_unit_id)
        REFERENCES market.recommendation_batches (tenant_id, recommendation_batch_id, station_id, business_unit_id),
    FOREIGN KEY (tenant_id, product_id)
        REFERENCES market.products (tenant_id, product_id),
    FOREIGN KEY (tenant_id, station_id, business_unit_id, supplier_account_id, currency_code)
        REFERENCES market.supplier_accounts
            (tenant_id, station_id, business_unit_id, supplier_account_id, currency_code),
    CHECK ((supplier_account_id IS NULL) = (currency_code IS NULL)),
    CHECK (recommended_qty IS NULL OR recommended_qty >= 0)
);

CREATE INDEX IF NOT EXISTS ix_daily_demand_query
    ON market.product_daily_demand (tenant_id, station_id, business_unit_id, business_date, product_id);

-- -----------------------------------------------------------------------------
-- Deployment note: use additive migrations; large production indexes CONCURRENTLY
-- outside transaction blocks. Add RLS only after a tenant-aware policy review.
-- Implement deferred/constraint triggers for cross-row monetary equality, ledger
-- immutability, allocation ceilings, and account/business-unit consistency.
-- -----------------------------------------------------------------------------

COMMIT;

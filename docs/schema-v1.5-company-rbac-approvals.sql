-- AKARYAKIT V1 — v1.5 company, scope/RBAC and approval addendum
-- PostgreSQL 15+ illustrative target model only. NOT production-ready and NOT applied.
-- Requires the v1.4 reference schemas/tables listed below; do not run until M0
-- schema discovery and an explicit migration map have been completed.
-- Required existing tables: core.tenants, core.stations, core.business_units,
-- core.users, core.employees, core.roles not required, core.parties,
-- ops.shift_sessions, ops.reconciliation_cases,
-- market.supplier_accounts, market.supplier_ap_open_items,
-- market.supplier_credit_profiles, market.purchase_orders,
-- market.purchase_order_lines, market.v_unbilled_commitments,
-- market.recommendation_batches, market.recommendation_lines.
-- Existing core.tenants.legal_name is not assumed to be a legal-company record.

BEGIN;

CREATE SCHEMA IF NOT EXISTS core;
CREATE SCHEMA IF NOT EXISTS ops;
CREATE SCHEMA IF NOT EXISTS market;

-- -----------------------------------------------------------------------------
-- 1. Legal companies. Tenant is the SaaS/security boundary, not necessarily a
--    single legal entity.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS core.companies (
    tenant_id       uuid NOT NULL REFERENCES core.tenants (tenant_id),
    company_id      uuid NOT NULL DEFAULT gen_random_uuid(),
    company_code    text NOT NULL,
    legal_name      text NOT NULL,
    trade_name      text,
    tax_id_type     text CHECK (tax_id_type IN ('VKN', 'TCKN')),
    tax_id_number   text,
    tax_office      text,
    mersis_no       text,
    country_code    char(2) NOT NULL DEFAULT 'TR',
    address_line    text,
    district        text,
    city            text,
    postal_code     text,
    contact_email   text,
    contact_phone   text,
    status          text NOT NULL DEFAULT 'ACTIVE'
                    CHECK (status IN ('ACTIVE', 'INACTIVE')),
    created_by_user_id uuid NOT NULL,
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (tenant_id, company_id),
    UNIQUE (tenant_id, company_code),
    UNIQUE (tenant_id, company_id, legal_name),
    FOREIGN KEY (tenant_id, created_by_user_id)
        REFERENCES core.users (tenant_id, user_id),
    CHECK ((tax_id_type IS NULL) = (tax_id_number IS NULL)),
    CHECK (tax_id_number IS NULL OR tax_id_number ~ '^[0-9]+$'),
    CHECK (tax_id_type <> 'VKN' OR length(tax_id_number) = 10),
    CHECK (tax_id_type <> 'TCKN' OR length(tax_id_number) = 11)
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_company_tax_identity
    ON core.companies (tenant_id, tax_id_type, tax_id_number)
    WHERE tax_id_number IS NOT NULL;

-- -----------------------------------------------------------------------------
-- 2. Effective-dated station/company mapping. STATION is the default mapping;
--    BUSINESS_UNIT is an optional FUEL/MARKET override.
--    valid_to is exclusive: [valid_from, valid_to).
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS core.station_company_assignments (
    tenant_id       uuid NOT NULL,
    assignment_id  uuid NOT NULL DEFAULT gen_random_uuid(),
    station_id     uuid NOT NULL,
    company_id     uuid NOT NULL,
    assignment_level text NOT NULL
                    CHECK (assignment_level IN ('STATION', 'BUSINESS_UNIT')),
    business_unit_id uuid,
    valid_from     date NOT NULL,
    valid_to       date,
    reason         text,
    created_by_user_id uuid NOT NULL,
    created_at     timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (tenant_id, assignment_id),
    UNIQUE NULLS NOT DISTINCT
      (tenant_id, station_id, assignment_level, business_unit_id, valid_from),
    FOREIGN KEY (tenant_id, station_id)
        REFERENCES core.stations (tenant_id, station_id),
    FOREIGN KEY (tenant_id, company_id)
        REFERENCES core.companies (tenant_id, company_id),
    FOREIGN KEY (tenant_id, station_id, business_unit_id)
        REFERENCES core.business_units (tenant_id, station_id, business_unit_id),
    FOREIGN KEY (tenant_id, created_by_user_id)
        REFERENCES core.users (tenant_id, user_id),
    CHECK ((assignment_level = 'STATION' AND business_unit_id IS NULL)
        OR (assignment_level = 'BUSINESS_UNIT' AND business_unit_id IS NOT NULL)),
    CHECK (valid_to IS NULL OR valid_to > valid_from)
);

CREATE INDEX IF NOT EXISTS ix_station_company_current
    ON core.station_company_assignments
       (tenant_id, station_id, assignment_level, business_unit_id, valid_from DESC);

-- Serialize mapping writes for one station and prohibit overlapping effective
-- intervals for the same mapping scope. A BUSINESS_UNIT mapping inherits the
-- station default only when no active override exists.
CREATE OR REPLACE FUNCTION core.guard_station_company_assignment()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    v_domain_code text;
BEGIN
    PERFORM 1
      FROM core.stations s
     WHERE s.tenant_id = NEW.tenant_id
       AND s.station_id = NEW.station_id
     FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'station not found in tenant scope';
    END IF;

    IF NEW.assignment_level = 'BUSINESS_UNIT' THEN
        SELECT bu.domain_code INTO v_domain_code
          FROM core.business_units bu
         WHERE bu.tenant_id = NEW.tenant_id
           AND bu.station_id = NEW.station_id
           AND bu.business_unit_id = NEW.business_unit_id;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'business unit does not belong to station';
        END IF;
    END IF;

    IF EXISTS (
        SELECT 1
          FROM core.station_company_assignments existing
         WHERE existing.tenant_id = NEW.tenant_id
           AND existing.station_id = NEW.station_id
           AND existing.assignment_level = NEW.assignment_level
           AND existing.business_unit_id IS NOT DISTINCT FROM NEW.business_unit_id
           AND existing.assignment_id <> NEW.assignment_id
           AND (NEW.valid_to IS NULL OR existing.valid_from < NEW.valid_to)
           AND (existing.valid_to IS NULL OR NEW.valid_from < existing.valid_to)
    ) THEN
        RAISE EXCEPTION 'overlapping effective company assignment';
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_station_company_assignment
    ON core.station_company_assignments;
CREATE TRIGGER trg_guard_station_company_assignment
BEFORE INSERT OR UPDATE ON core.station_company_assignments
FOR EACH ROW EXECUTE FUNCTION core.guard_station_company_assignment();

-- -----------------------------------------------------------------------------
-- 3. RBAC. Job title (employee_job_assignments) is descriptive; user_role_assignments
--    is the actual permission grant. Assignments are tenant scoped and effective-dated.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS core.permission_catalog (
    permission_code text PRIMARY KEY,
    description     text NOT NULL,
    sensitive       boolean NOT NULL DEFAULT false
);

CREATE TABLE IF NOT EXISTS core.roles (
    tenant_id       uuid NOT NULL REFERENCES core.tenants (tenant_id),
    role_id         uuid NOT NULL DEFAULT gen_random_uuid(),
    role_code       text NOT NULL,
    display_name    text NOT NULL,
    allowed_scope_types text[] NOT NULL,
    system_role     boolean NOT NULL DEFAULT true,
    active          boolean NOT NULL DEFAULT true,
    PRIMARY KEY (tenant_id, role_id),
    UNIQUE (tenant_id, role_code),
    UNIQUE (tenant_id, role_id, role_code),
    CHECK (cardinality(allowed_scope_types) > 0),
    CHECK (allowed_scope_types <@ ARRAY['TENANT','COMPANY','STATION','BUSINESS_UNIT']::text[])
);

CREATE TABLE IF NOT EXISTS core.role_permissions (
    tenant_id       uuid NOT NULL,
    role_id         uuid NOT NULL,
    permission_code text NOT NULL REFERENCES core.permission_catalog (permission_code),
    granted_at      timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (tenant_id, role_id, permission_code),
    FOREIGN KEY (tenant_id, role_id)
        REFERENCES core.roles (tenant_id, role_id)
);

CREATE TABLE IF NOT EXISTS core.user_role_assignments (
    tenant_id       uuid NOT NULL,
    user_role_assignment_id uuid NOT NULL DEFAULT gen_random_uuid(),
    user_id         uuid NOT NULL,
    role_id         uuid NOT NULL,
    scope_type      text NOT NULL
                    CHECK (scope_type IN ('TENANT','COMPANY','STATION','BUSINESS_UNIT')),
    company_id      uuid,
    station_id      uuid,
    business_unit_id uuid,
    valid_from      timestamptz NOT NULL DEFAULT now(),
    valid_to        timestamptz,
    granted_by_user_id uuid NOT NULL,
    created_at      timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (tenant_id, user_role_assignment_id),
    UNIQUE (tenant_id, user_role_assignment_id, user_id, role_id),
    FOREIGN KEY (tenant_id, user_id)
        REFERENCES core.users (tenant_id, user_id),
    FOREIGN KEY (tenant_id, role_id)
        REFERENCES core.roles (tenant_id, role_id),
    FOREIGN KEY (tenant_id, company_id)
        REFERENCES core.companies (tenant_id, company_id),
    FOREIGN KEY (tenant_id, station_id)
        REFERENCES core.stations (tenant_id, station_id),
    FOREIGN KEY (tenant_id, station_id, business_unit_id)
        REFERENCES core.business_units (tenant_id, station_id, business_unit_id),
    FOREIGN KEY (tenant_id, granted_by_user_id)
        REFERENCES core.users (tenant_id, user_id),
    CHECK (
       (scope_type = 'TENANT' AND company_id IS NULL AND station_id IS NULL AND business_unit_id IS NULL)
       OR (scope_type = 'COMPANY' AND company_id IS NOT NULL AND station_id IS NULL AND business_unit_id IS NULL)
       OR (scope_type = 'STATION' AND company_id IS NULL AND station_id IS NOT NULL AND business_unit_id IS NULL)
       OR (scope_type = 'BUSINESS_UNIT' AND company_id IS NULL AND station_id IS NOT NULL AND business_unit_id IS NOT NULL)
    ),
    CHECK (valid_to IS NULL OR valid_to > valid_from)
);

CREATE INDEX IF NOT EXISTS ix_user_role_active_scope
    ON core.user_role_assignments
       (tenant_id, user_id, scope_type, company_id, station_id, business_unit_id)
    WHERE valid_to IS NULL;

CREATE OR REPLACE FUNCTION core.guard_user_role_scope()
RETURNS trigger
LANGUAGE plpgsql
AS
$$
DECLARE
    v_allowed_scopes text[];
    v_role_code text;
    v_domain_code text;
BEGIN
    SELECT r.allowed_scope_types, r.role_code
      INTO v_allowed_scopes, v_role_code
      FROM core.roles r
     WHERE r.tenant_id = NEW.tenant_id
       AND r.role_id = NEW.role_id
       AND r.active = true;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'role not found or inactive';
    END IF;
    IF NOT (NEW.scope_type = ANY(v_allowed_scopes)) THEN
        RAISE EXCEPTION 'role cannot be granted at requested scope';
    END IF;
    IF v_role_code IN ('FUEL_SALES','MARKET_SALES') AND NEW.scope_type <> 'BUSINESS_UNIT' THEN
        RAISE EXCEPTION 'sales roles require a specific business unit';
    END IF;

    IF NEW.scope_type = 'BUSINESS_UNIT' THEN
        SELECT bu.domain_code INTO v_domain_code
          FROM core.business_units bu
         WHERE bu.tenant_id = NEW.tenant_id
           AND bu.station_id = NEW.station_id
           AND bu.business_unit_id = NEW.business_unit_id;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'business unit does not belong to station';
        END IF;
        IF v_role_code IN ('FUEL_SALES') AND v_domain_code <> 'FUEL' THEN
            RAISE EXCEPTION 'FUEL_SALES requires FUEL business unit';
        END IF;
        IF v_role_code IN ('MARKET_SALES','PURCHASING') AND v_domain_code <> 'MARKET' THEN
            RAISE EXCEPTION 'role requires MARKET business unit';
        END IF;
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_user_role_scope ON core.user_role_assignments;
CREATE TRIGGER trg_guard_user_role_scope
BEFORE INSERT OR UPDATE ON core.user_role_assignments
FOR EACH ROW EXECUTE FUNCTION core.guard_user_role_scope();

CREATE TABLE IF NOT EXISTS core.employee_job_assignments (
    tenant_id       uuid NOT NULL,
    employee_job_assignment_id uuid NOT NULL DEFAULT gen_random_uuid(),
    employee_id     uuid NOT NULL,
    job_code        text NOT NULL CHECK (job_code IN (
                       'MANAGER','ACCOUNTANT','FUEL_SALES','MARKET_SALES','PURCHASING'
                    )),
    scope_type      text NOT NULL CHECK (scope_type IN ('COMPANY','STATION','BUSINESS_UNIT')),
    company_id      uuid,
    station_id      uuid,
    business_unit_id uuid,
    valid_from      date NOT NULL,
    valid_to        date,
    assigned_by_user_id uuid NOT NULL,
    created_at      timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (tenant_id, employee_job_assignment_id),
    FOREIGN KEY (tenant_id, employee_id)
        REFERENCES core.employees (tenant_id, employee_id),
    FOREIGN KEY (tenant_id, company_id)
        REFERENCES core.companies (tenant_id, company_id),
    FOREIGN KEY (tenant_id, station_id)
        REFERENCES core.stations (tenant_id, station_id),
    FOREIGN KEY (tenant_id, station_id, business_unit_id)
        REFERENCES core.business_units (tenant_id, station_id, business_unit_id),
    FOREIGN KEY (tenant_id, assigned_by_user_id)
        REFERENCES core.users (tenant_id, user_id),
    CHECK (
       (scope_type = 'COMPANY' AND company_id IS NOT NULL AND station_id IS NULL AND business_unit_id IS NULL)
       OR (scope_type = 'STATION' AND company_id IS NULL AND station_id IS NOT NULL AND business_unit_id IS NULL)
       OR (scope_type = 'BUSINESS_UNIT' AND company_id IS NULL AND station_id IS NOT NULL AND business_unit_id IS NOT NULL)
    ),
    CHECK ((job_code IN ('FUEL_SALES','MARKET_SALES') AND scope_type = 'BUSINESS_UNIT')
        OR (job_code NOT IN ('FUEL_SALES','MARKET_SALES'))),
    CHECK (valid_to IS NULL OR valid_to > valid_from)
);

CREATE OR REPLACE FUNCTION core.guard_employee_job_domain()
RETURNS trigger
LANGUAGE plpgsql
AS
$$
DECLARE
    v_domain_code text;
BEGIN
    IF NEW.scope_type = 'BUSINESS_UNIT' THEN
        SELECT bu.domain_code INTO v_domain_code
          FROM core.business_units bu
         WHERE bu.tenant_id = NEW.tenant_id
           AND bu.station_id = NEW.station_id
           AND bu.business_unit_id = NEW.business_unit_id;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'business unit does not belong to station';
        END IF;
        IF NEW.job_code = 'FUEL_SALES' AND v_domain_code <> 'FUEL' THEN
            RAISE EXCEPTION 'FUEL_SALES job requires FUEL business unit';
        END IF;
        IF NEW.job_code IN ('MARKET_SALES','PURCHASING') AND v_domain_code <> 'MARKET' THEN
            RAISE EXCEPTION 'job requires MARKET business unit';
        END IF;
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_employee_job_domain ON core.employee_job_assignments;
CREATE TRIGGER trg_guard_employee_job_domain
BEFORE INSERT OR UPDATE ON core.employee_job_assignments
FOR EACH ROW EXECUTE FUNCTION core.guard_employee_job_domain();

-- -----------------------------------------------------------------------------
-- 4. Shared wholesaler accounts at legal-company scope. Local station accounts
--    remain operational references; validated mappings consolidate exposure.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS market.company_supplier_accounts (
    tenant_id       uuid NOT NULL,
    company_supplier_account_id uuid NOT NULL DEFAULT gen_random_uuid(),
    company_id      uuid NOT NULL,
    supplier_party_id uuid NOT NULL,
    account_code    text NOT NULL,
    currency_code   char(3) NOT NULL,
    account_status  text NOT NULL DEFAULT 'ACTIVE'
                    CHECK (account_status IN ('ACTIVE','ON_HOLD','CLOSED')),
    supplier_account_ref text,
    created_by_user_id uuid NOT NULL,
    created_at      timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (tenant_id, company_supplier_account_id),
    UNIQUE (tenant_id, company_supplier_account_id, company_id, currency_code),
    UNIQUE (tenant_id, company_id, account_code, currency_code),
    FOREIGN KEY (tenant_id, company_id)
        REFERENCES core.companies (tenant_id, company_id),
    FOREIGN KEY (tenant_id, supplier_party_id)
        REFERENCES core.parties (tenant_id, party_id),
    FOREIGN KEY (tenant_id, created_by_user_id)
        REFERENCES core.users (tenant_id, user_id)
);

CREATE TABLE IF NOT EXISTS market.company_supplier_account_station_links (
    tenant_id       uuid NOT NULL,
    link_id         uuid NOT NULL DEFAULT gen_random_uuid(),
    company_supplier_account_id uuid NOT NULL,
    company_id      uuid NOT NULL,
    station_id      uuid NOT NULL,
    business_unit_id uuid NOT NULL,
    local_supplier_account_id uuid NOT NULL,
    currency_code   char(3) NOT NULL,
    valid_from      date NOT NULL,
    valid_to        date,
    verified_by_user_id uuid NOT NULL,
    verified_at     timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (tenant_id, link_id),
    UNIQUE (tenant_id, link_id, company_supplier_account_id, currency_code),
    FOREIGN KEY (tenant_id, company_supplier_account_id, company_id, currency_code)
        REFERENCES market.company_supplier_accounts
            (tenant_id, company_supplier_account_id, company_id, currency_code),
    FOREIGN KEY (tenant_id, station_id, business_unit_id)
        REFERENCES core.business_units (tenant_id, station_id, business_unit_id),
    FOREIGN KEY (tenant_id, station_id, business_unit_id, local_supplier_account_id, currency_code)
        REFERENCES market.supplier_accounts
            (tenant_id, station_id, business_unit_id, supplier_account_id, currency_code),
    FOREIGN KEY (tenant_id, verified_by_user_id)
        REFERENCES core.users (tenant_id, user_id),
    CHECK (valid_to IS NULL OR valid_to > valid_from)
);

CREATE INDEX IF NOT EXISTS ix_company_supplier_account_links_current
    ON market.company_supplier_account_station_links
       (tenant_id, company_id, station_id, business_unit_id, valid_from DESC);

CREATE OR REPLACE FUNCTION market.guard_company_supplier_account_link()
RETURNS trigger
LANGUAGE plpgsql
AS
$$
DECLARE
    v_effective_company_id uuid;
    v_local_supplier_party_id uuid;
    v_company_supplier_party_id uuid;
BEGIN
    SELECT sa.supplier_party_id INTO v_local_supplier_party_id
      FROM market.supplier_accounts sa
     WHERE sa.tenant_id = NEW.tenant_id
       AND sa.station_id = NEW.station_id
       AND sa.business_unit_id = NEW.business_unit_id
       AND sa.supplier_account_id = NEW.local_supplier_account_id
       AND sa.currency_code = NEW.currency_code
     FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'local supplier account not found in station scope';
    END IF;

    SELECT ca.supplier_party_id INTO v_company_supplier_party_id
      FROM market.company_supplier_accounts ca
     WHERE ca.tenant_id = NEW.tenant_id
       AND ca.company_supplier_account_id = NEW.company_supplier_account_id
       AND ca.company_id = NEW.company_id
       AND ca.currency_code = NEW.currency_code;
    IF NOT FOUND OR v_local_supplier_party_id <> v_company_supplier_party_id THEN
        RAISE EXCEPTION 'local and company supplier accounts do not identify the same supplier';
    END IF;

    IF EXISTS (
        SELECT 1
          FROM market.company_supplier_account_station_links existing
         WHERE existing.tenant_id = NEW.tenant_id
           AND existing.local_supplier_account_id = NEW.local_supplier_account_id
           AND existing.currency_code = NEW.currency_code
           AND existing.link_id <> NEW.link_id
           AND (NEW.valid_to IS NULL OR existing.valid_from < NEW.valid_to)
           AND (existing.valid_to IS NULL OR NEW.valid_from < existing.valid_to)
    ) THEN
        RAISE EXCEPTION 'overlapping company mappings for local supplier account';
    END IF;

    SELECT a.company_id INTO v_effective_company_id
      FROM core.station_company_assignments a
     WHERE a.tenant_id = NEW.tenant_id
       AND a.station_id = NEW.station_id
       AND a.valid_from <= NEW.valid_from
       AND (a.valid_to IS NULL OR a.valid_to > NEW.valid_from)
       AND ((a.assignment_level = 'BUSINESS_UNIT'
             AND a.business_unit_id = NEW.business_unit_id)
         OR (a.assignment_level = 'STATION' AND a.business_unit_id IS NULL))
     ORDER BY CASE WHEN a.assignment_level = 'BUSINESS_UNIT' THEN 0 ELSE 1 END
     LIMIT 1;
    IF NOT FOUND OR v_effective_company_id <> NEW.company_id THEN
        RAISE EXCEPTION 'supplier account company does not match effective station company';
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_company_supplier_account_link
    ON market.company_supplier_account_station_links;
CREATE TRIGGER trg_guard_company_supplier_account_link
BEFORE INSERT OR UPDATE ON market.company_supplier_account_station_links
FOR EACH ROW EXECUTE FUNCTION market.guard_company_supplier_account_link();

CREATE TABLE IF NOT EXISTS market.company_supplier_credit_profiles (
    tenant_id       uuid NOT NULL,
    profile_id      uuid NOT NULL DEFAULT gen_random_uuid(),
    company_supplier_account_id uuid NOT NULL,
    company_id      uuid NOT NULL,
    currency_code   char(3) NOT NULL,
    credit_limit_minor bigint CHECK (credit_limit_minor IS NULL OR credit_limit_minor >= 0),
    valid_from      date NOT NULL,
    valid_to        date,
    source_ref      text,
    approved_by_user_id uuid NOT NULL,
    created_at      timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (tenant_id, profile_id),
    UNIQUE (tenant_id, company_supplier_account_id, currency_code, valid_from),
    FOREIGN KEY (tenant_id, company_supplier_account_id, company_id, currency_code)
        REFERENCES market.company_supplier_accounts
            (tenant_id, company_supplier_account_id, company_id, currency_code),
    FOREIGN KEY (tenant_id, approved_by_user_id)
        REFERENCES core.users (tenant_id, user_id),
    CHECK (valid_to IS NULL OR valid_to >= valid_from)
);

-- -----------------------------------------------------------------------------
-- 5. Group recommendation run: several station-level batches can be evaluated
--    against one company supplier account limit in one weekly run.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS market.recommendation_runs (
    tenant_id       uuid NOT NULL,
    recommendation_run_id uuid NOT NULL DEFAULT gen_random_uuid(),
    company_id      uuid NOT NULL,
    as_of_date      date NOT NULL,
    algorithm_version text NOT NULL,
    status          text NOT NULL DEFAULT 'DRAFT'
                    CHECK (status IN ('DRAFT','REVIEW','APPROVED','REJECTED','EXPIRED')),
    created_by_user_id uuid NOT NULL,
    snapshot_hash   char(64),
    generated_at    timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (tenant_id, recommendation_run_id),
    UNIQUE (tenant_id, recommendation_run_id, company_id),
    FOREIGN KEY (tenant_id, company_id)
        REFERENCES core.companies (tenant_id, company_id),
    FOREIGN KEY (tenant_id, created_by_user_id)
        REFERENCES core.users (tenant_id, user_id)
);

CREATE TABLE IF NOT EXISTS market.recommendation_run_batches (
    tenant_id       uuid NOT NULL,
    recommendation_run_id uuid NOT NULL,
    company_id      uuid NOT NULL,
    recommendation_batch_id uuid NOT NULL,
    station_id      uuid NOT NULL,
    business_unit_id uuid NOT NULL,
    PRIMARY KEY (tenant_id, recommendation_run_id, recommendation_batch_id),
    FOREIGN KEY (tenant_id, recommendation_run_id, company_id)
        REFERENCES market.recommendation_runs
            (tenant_id, recommendation_run_id, company_id),
    FOREIGN KEY (tenant_id, recommendation_batch_id, station_id, business_unit_id)
        REFERENCES market.recommendation_batches
            (tenant_id, recommendation_batch_id, station_id, business_unit_id),
    FOREIGN KEY (tenant_id, station_id, business_unit_id)
        REFERENCES core.business_units (tenant_id, station_id, business_unit_id)
);

-- This view groups station-local recommendation lines into the shared legal-company
-- supplier account. Validate effective mapping and currency on every write/read.
CREATE OR REPLACE VIEW market.v_recommendation_cost_by_company_account AS
SELECT rb.tenant_id,
       run.recommendation_run_id,
       run.company_id,
       link.company_supplier_account_id,
       line.currency_code,
       SUM(line.estimated_cost_minor)::bigint AS proposed_cost_minor
FROM market.recommendation_runs run
JOIN market.recommendation_run_batches rb
  ON rb.tenant_id = run.tenant_id
 AND rb.recommendation_run_id = run.recommendation_run_id
 AND rb.company_id = run.company_id
JOIN market.recommendation_batches batch
  ON batch.tenant_id = rb.tenant_id
 AND batch.recommendation_batch_id = rb.recommendation_batch_id
 AND batch.station_id = rb.station_id
 AND batch.business_unit_id = rb.business_unit_id
JOIN market.recommendation_lines line
  ON line.tenant_id = batch.tenant_id
 AND line.recommendation_batch_id = batch.recommendation_batch_id
 AND line.station_id = batch.station_id
 AND line.business_unit_id = batch.business_unit_id
JOIN market.company_supplier_account_station_links link
  ON link.tenant_id = line.tenant_id
 AND link.station_id = line.station_id
 AND link.business_unit_id = line.business_unit_id
 AND link.local_supplier_account_id = line.supplier_account_id
 AND link.currency_code = line.currency_code
 AND link.company_id = run.company_id
 AND link.valid_from <= run.as_of_date
 AND (link.valid_to IS NULL OR link.valid_to > run.as_of_date)
WHERE line.supplier_account_id IS NOT NULL
  AND line.estimated_cost_minor IS NOT NULL
GROUP BY rb.tenant_id, run.recommendation_run_id, run.company_id,
         link.company_supplier_account_id, line.currency_code;

-- -----------------------------------------------------------------------------
-- 6. Generic auditable approval requests and decisions. subject_id is polymorphic;
--    the application service must validate target record and scope on each action.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ops.approval_requests (
    tenant_id       uuid NOT NULL,
    approval_request_id uuid NOT NULL DEFAULT gen_random_uuid(),
    subject_type    text NOT NULL,
    subject_id      uuid NOT NULL,
    subject_version integer NOT NULL CHECK (subject_version > 0),
    action_code     text NOT NULL,
    scope_type      text NOT NULL
                    CHECK (scope_type IN ('TENANT','COMPANY','STATION','BUSINESS_UNIT')),
    company_id      uuid,
    station_id      uuid,
    business_unit_id uuid,
    requested_by_user_id uuid NOT NULL,
    reason_code     text NOT NULL,
    reason_text     text NOT NULL,
    payload_hash    char(64) NOT NULL,
    idempotency_key uuid NOT NULL,
    row_version     integer NOT NULL DEFAULT 1 CHECK (row_version > 0),
    policy_version  text NOT NULL,
    required_approvals smallint NOT NULL DEFAULT 1
                    CHECK (required_approvals BETWEEN 1 AND 2),
    status          text NOT NULL DEFAULT 'PENDING'
                    CHECK (status IN ('PENDING','NEEDS_INFO','APPROVED','REJECTED','CANCELLED')),
    requested_at    timestamptz NOT NULL DEFAULT now(),
    resolved_at     timestamptz,
    PRIMARY KEY (tenant_id, approval_request_id),
    UNIQUE (tenant_id, approval_request_id, requested_by_user_id),
    UNIQUE (tenant_id, idempotency_key),
    FOREIGN KEY (tenant_id, company_id)
        REFERENCES core.companies (tenant_id, company_id),
    FOREIGN KEY (tenant_id, station_id)
        REFERENCES core.stations (tenant_id, station_id),
    FOREIGN KEY (tenant_id, station_id, business_unit_id)
        REFERENCES core.business_units (tenant_id, station_id, business_unit_id),
    FOREIGN KEY (tenant_id, requested_by_user_id)
        REFERENCES core.users (tenant_id, user_id),
    CHECK (
       (scope_type = 'TENANT' AND company_id IS NULL AND station_id IS NULL AND business_unit_id IS NULL)
       OR (scope_type = 'COMPANY' AND company_id IS NOT NULL AND station_id IS NULL AND business_unit_id IS NULL)
       OR (scope_type = 'STATION' AND company_id IS NULL AND station_id IS NOT NULL AND business_unit_id IS NULL)
       OR (scope_type = 'BUSINESS_UNIT' AND company_id IS NULL AND station_id IS NOT NULL AND business_unit_id IS NOT NULL)
    ),
    CHECK (length(btrim(reason_code)) > 0 AND length(btrim(reason_text)) > 0),
    CHECK (payload_hash ~ '^[0-9a-f]{64}$'),
    CHECK ((status IN ('APPROVED','REJECTED','CANCELLED')) = (resolved_at IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS ix_approval_pending_scope
    ON ops.approval_requests (tenant_id, scope_type, company_id, station_id, business_unit_id, requested_at DESC)
    WHERE status IN ('PENDING','NEEDS_INFO');

CREATE TABLE IF NOT EXISTS ops.approval_decisions (
    tenant_id       uuid NOT NULL,
    approval_decision_id uuid NOT NULL DEFAULT gen_random_uuid(),
    approval_request_id uuid NOT NULL,
    approver_user_id uuid NOT NULL,
    user_role_assignment_id uuid NOT NULL,
    role_id         uuid NOT NULL,
    reviewed_request_version integer NOT NULL CHECK (reviewed_request_version > 0),
    reviewed_payload_hash char(64) NOT NULL CHECK (reviewed_payload_hash ~ '^[0-9a-f]{64}$'),
    decision_code   text NOT NULL
                    CHECK (decision_code IN ('APPROVE','REJECT','NEEDS_INFO')),
    reason_text     text NOT NULL,
    decided_at      timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (tenant_id, approval_decision_id),
    UNIQUE (tenant_id, approval_request_id, approver_user_id),
    FOREIGN KEY (tenant_id, approval_request_id)
        REFERENCES ops.approval_requests (tenant_id, approval_request_id),
    FOREIGN KEY (tenant_id, approver_user_id)
        REFERENCES core.users (tenant_id, user_id),
    FOREIGN KEY (tenant_id, user_role_assignment_id, approver_user_id, role_id)
        REFERENCES core.user_role_assignments
            (tenant_id, user_role_assignment_id, user_id, role_id),
    FOREIGN KEY (tenant_id, role_id)
        REFERENCES core.roles (tenant_id, role_id),
    CHECK (length(btrim(reason_text)) > 0)
);

CREATE OR REPLACE FUNCTION ops.guard_approval_decision()
RETURNS trigger
LANGUAGE plpgsql
AS
$$
DECLARE
    v_requester uuid;
    v_status text;
    v_version integer;
    v_hash char(64);
BEGIN
    SELECT r.requested_by_user_id, r.status, r.row_version, r.payload_hash
      INTO v_requester, v_status, v_version, v_hash
      FROM ops.approval_requests r
     WHERE r.tenant_id = NEW.tenant_id
       AND r.approval_request_id = NEW.approval_request_id
     FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'approval request not found';
    END IF;
    IF v_status <> 'PENDING' THEN
        RAISE EXCEPTION 'approval request is not pending';
    END IF;
    IF v_requester = NEW.approver_user_id THEN
        RAISE EXCEPTION 'self-approval is prohibited';
    END IF;
    IF NEW.reviewed_request_version <> v_version OR NEW.reviewed_payload_hash <> v_hash THEN
        RAISE EXCEPTION 'stale approval request version or payload';
    END IF;
    -- Active role, permission and target-object scope still require a service check.
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_approval_decision ON ops.approval_decisions;
CREATE TRIGGER trg_guard_approval_decision
BEFORE INSERT ON ops.approval_decisions
FOR EACH ROW EXECUTE FUNCTION ops.guard_approval_decision();

-- Seed permission codes; role-to-permission grants are tenant-specific and must
-- be provisioned by the tenant bootstrap/authorization service after review.
INSERT INTO core.permission_catalog (permission_code, description, sensitive) VALUES
 ('company.read', 'Firma kayıtlarını gör', true),
 ('company.manage', 'Firma master kaydını oluştur/değiştir', true),
 ('station_company.manage', 'İstasyon-firma eşlemesini yönet', true),
 ('user.manage', 'Kullanıcı ve çalışan kaydını yönet', true),
 ('role.assign', 'Yetki rolü ata veya kaldır', true),
 ('shift.declare.self', 'Kendi vardiya beyanı ve kanıtını gönder', false),
 ('shift.reconcile.read', 'Yetkili vardiya mutabakatını gör', true),
 ('shift.reconcile.approve', 'Vardiya mutabakatında onay kararı ver', true),
 ('shift.reopen', 'Kapanmış vardiyayı gerekçeyle yeniden aç', true),
 ('finance.reconcile', 'Banka/POS ve cari mutabakatını incele', true),
 ('market.inventory.operate', 'Market stok ve mal kabul işlemi', false),
 ('market.purchase.recommend', 'Market haftalık sipariş önerisi üret', false),
 ('market.purchase.approve', 'Satın alma taslağını onayla/gönder', true),
 ('integration.read_status', 'İzinli entegrasyon sağlık durumunu gör', true),
 ('integration.manage', 'Entegrasyon profilini yönet', true),
 ('patron.dashboard.read', 'Yetkili firma/istasyon konsolide KPI gör', true)
ON CONFLICT (permission_code) DO NOTHING;

-- Additional production controls not represented by simple CHECK/FK constraints:
-- 1) Restrict UPDATE/DELETE on posted approvals and audit logs; corrections append new events.
-- 2) At decision time re-check role assignment active dates, permission code, subject scope,
--    company ownership and the target subject_version/payload_hash inside one transaction.
-- 3) Do not resolve APPROVED until count(distinct approver_user_id) of valid APPROVE
--    decisions reaches required_approvals; requester is never an approver.
-- 4) Company/station reassignment with existing fiscal/AP/AR history requires impact preview,
--    privileged permission, audit and (policy-dependent) second approval.
-- 5) Supplier credit exposure and PO approval must lock the company_supplier_account row,
--    recompute AP + unbilled commitments (which already include approved POs) in one transaction, and
--    reject stale/concurrent approvals or require an explicit authorized exception.
-- 6) Every local supplier-account mapping must be verified against the effective station/company
--    assignment and actual vendor statement; never merge accounts only because supplier names match.
-- 7) Job titles do not grant permissions. Map roles/permissions server-side; use tenant-safe RLS
--    only after policy review, and keep fiscal/YN ÖKC secrets outside this database.

COMMIT;

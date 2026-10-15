CREATE TABLE IF NOT EXISTS st_schema_migrations (
  version VARCHAR(64) NOT NULL PRIMARY KEY,
  applied_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS st_tenants (
  id CHAR(36) NOT NULL PRIMARY KEY,
  name VARCHAR(190) NOT NULL,
  is_demo BOOLEAN NOT NULL DEFAULT FALSE,
  created_by_user_id INT NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  CONSTRAINT fk_st_tenants_user FOREIGN KEY (created_by_user_id) REFERENCES users(id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS st_companies (
  id CHAR(36) NOT NULL PRIMARY KEY,
  tenant_id CHAR(36) NOT NULL,
  name VARCHAR(190) NOT NULL,
  tax_number VARCHAR(64) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_st_companies_name (tenant_id, name),
  CONSTRAINT fk_st_companies_tenant FOREIGN KEY (tenant_id) REFERENCES st_tenants(id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS st_stations (
  id CHAR(36) NOT NULL PRIMARY KEY,
  tenant_id CHAR(36) NOT NULL,
  company_id CHAR(36) NOT NULL,
  name VARCHAR(190) NOT NULL,
  code VARCHAR(64) NOT NULL,
  address VARCHAR(500) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_st_stations_code (tenant_id, code),
  CONSTRAINT fk_st_stations_tenant FOREIGN KEY (tenant_id) REFERENCES st_tenants(id),
  CONSTRAINT fk_st_stations_company FOREIGN KEY (company_id) REFERENCES st_companies(id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS st_members (
  tenant_id CHAR(36) NOT NULL,
  user_id INT NOT NULL,
  role ENUM('OWNER','MANAGER','ACCOUNTANT','FUEL_STAFF','MARKET_STAFF','PURCHASER') NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (tenant_id, user_id),
  KEY ix_st_members_user (user_id, created_at),
  CONSTRAINT fk_st_members_tenant FOREIGN KEY (tenant_id) REFERENCES st_tenants(id),
  CONSTRAINT fk_st_members_user FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS st_member_stations (
  tenant_id CHAR(36) NOT NULL,
  user_id INT NOT NULL,
  station_id CHAR(36) NOT NULL,
  PRIMARY KEY (tenant_id, user_id, station_id),
  KEY ix_st_member_stations_station (station_id),
  CONSTRAINT fk_st_member_stations_member FOREIGN KEY (tenant_id, user_id) REFERENCES st_members(tenant_id, user_id),
  CONSTRAINT fk_st_member_stations_station FOREIGN KEY (station_id) REFERENCES st_stations(id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS st_invitations (
  id CHAR(36) NOT NULL PRIMARY KEY,
  tenant_id CHAR(36) NOT NULL,
  code_hash CHAR(64) NOT NULL UNIQUE,
  role ENUM('MANAGER','ACCOUNTANT','FUEL_STAFF','MARKET_STAFF','PURCHASER') NOT NULL,
  expires_at DATETIME(3) NOT NULL,
  used_at DATETIME(3) NULL,
  invited_by_user_id INT NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  CONSTRAINT fk_st_invitations_tenant FOREIGN KEY (tenant_id) REFERENCES st_tenants(id),
  CONSTRAINT fk_st_invitations_user FOREIGN KEY (invited_by_user_id) REFERENCES users(id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS st_invitation_stations (
  invitation_id CHAR(36) NOT NULL,
  station_id CHAR(36) NOT NULL,
  PRIMARY KEY (invitation_id, station_id),
  CONSTRAINT fk_st_invitation_stations_inv FOREIGN KEY (invitation_id) REFERENCES st_invitations(id),
  CONSTRAINT fk_st_invitation_stations_station FOREIGN KEY (station_id) REFERENCES st_stations(id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS st_shifts (
  id CHAR(36) NOT NULL PRIMARY KEY,
  tenant_id CHAR(36) NOT NULL,
  station_id CHAR(36) NOT NULL,
  label VARCHAR(190) NOT NULL,
  starts_at DATETIME(3) NOT NULL,
  ends_at DATETIME(3) NULL,
  status ENUM('OPEN','CLOSED') NOT NULL DEFAULT 'OPEN',
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY ix_st_shifts_station (station_id, starts_at),
  CONSTRAINT fk_st_shifts_tenant FOREIGN KEY (tenant_id) REFERENCES st_tenants(id),
  CONSTRAINT fk_st_shifts_station FOREIGN KEY (station_id) REFERENCES st_stations(id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS st_accounts (
  id CHAR(36) NOT NULL PRIMARY KEY,
  tenant_id CHAR(36) NOT NULL,
  station_id CHAR(36) NOT NULL,
  shift_id CHAR(36) NOT NULL,
  user_id INT NOT NULL,
  business_unit ENUM('FUEL','MARKET') NOT NULL,
  opening_float_minor BIGINT NOT NULL DEFAULT 0,
  source_sales_minor BIGINT NULL,
  source_ref VARCHAR(190) NULL,
  counted_cash_minor BIGINT NULL,
  difference_minor BIGINT NULL,
  cash_received_minor BIGINT NULL,
  cash_receiver_user_id INT NULL,
  status ENUM('OPEN','SUBMITTED','IN_REVIEW','ACCEPTED','ACCEPTED_WITH_PENDING') NOT NULL DEFAULT 'OPEN',
  revision INT UNSIGNED NOT NULL DEFAULT 1,
  cycle_no INT UNSIGNED NOT NULL DEFAULT 1,
  submitted_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_st_accounts_open (station_id, shift_id, user_id, business_unit),
  KEY ix_st_accounts_station (station_id, status, created_at),
  CONSTRAINT fk_st_accounts_tenant FOREIGN KEY (tenant_id) REFERENCES st_tenants(id),
  CONSTRAINT fk_st_accounts_station FOREIGN KEY (station_id) REFERENCES st_stations(id),
  CONSTRAINT fk_st_accounts_shift FOREIGN KEY (shift_id) REFERENCES st_shifts(id),
  CONSTRAINT fk_st_accounts_user FOREIGN KEY (user_id) REFERENCES users(id),
  CONSTRAINT fk_st_accounts_receiver FOREIGN KEY (cash_receiver_user_id) REFERENCES users(id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS st_debtors (
  id CHAR(36) NOT NULL PRIMARY KEY,
  tenant_id CHAR(36) NOT NULL,
  station_id CHAR(36) NOT NULL,
  name VARCHAR(190) NOT NULL,
  type ENUM('PERSON','COMPANY') NOT NULL,
  balance_minor BIGINT NOT NULL DEFAULT 0,
  created_by_user_id INT NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY ix_st_debtors_station (station_id, name),
  CONSTRAINT fk_st_debtors_tenant FOREIGN KEY (tenant_id) REFERENCES st_tenants(id),
  CONSTRAINT fk_st_debtors_station FOREIGN KEY (station_id) REFERENCES st_stations(id),
  CONSTRAINT fk_st_debtors_user FOREIGN KEY (created_by_user_id) REFERENCES users(id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS st_payments (
  id CHAR(36) NOT NULL PRIMARY KEY,
  tenant_id CHAR(36) NOT NULL,
  station_id CHAR(36) NOT NULL,
  account_id CHAR(36) NULL,
  debtor_id CHAR(36) NULL,
  kind ENUM('CASH','IBAN','DEBT','AR_COLLECTION') NOT NULL,
  amount_minor BIGINT NOT NULL,
  reference VARCHAR(190) NULL,
  status ENUM('POSTED','REVERSED') NOT NULL DEFAULT 'POSTED',
  created_by_user_id INT NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY ix_st_payments_account (account_id, created_at),
  KEY ix_st_payments_debtor (debtor_id, kind, created_at),
  CONSTRAINT fk_st_payments_tenant FOREIGN KEY (tenant_id) REFERENCES st_tenants(id),
  CONSTRAINT fk_st_payments_station FOREIGN KEY (station_id) REFERENCES st_stations(id),
  CONSTRAINT fk_st_payments_account FOREIGN KEY (account_id) REFERENCES st_accounts(id),
  CONSTRAINT fk_st_payments_debtor FOREIGN KEY (debtor_id) REFERENCES st_debtors(id),
  CONSTRAINT fk_st_payments_user FOREIGN KEY (created_by_user_id) REFERENCES users(id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS st_debtor_ledger (
  id CHAR(36) NOT NULL PRIMARY KEY,
  tenant_id CHAR(36) NOT NULL,
  station_id CHAR(36) NOT NULL,
  debtor_id CHAR(36) NOT NULL,
  payment_id CHAR(36) NOT NULL,
  direction ENUM('DEBT','AR_COLLECTION') NOT NULL,
  amount_minor BIGINT NOT NULL,
  created_by_user_id INT NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY ix_st_debtor_ledger_debtor (debtor_id, created_at),
  CONSTRAINT fk_st_debtor_ledger_tenant FOREIGN KEY (tenant_id) REFERENCES st_tenants(id),
  CONSTRAINT fk_st_debtor_ledger_station FOREIGN KEY (station_id) REFERENCES st_stations(id),
  CONSTRAINT fk_st_debtor_ledger_debtor FOREIGN KEY (debtor_id) REFERENCES st_debtors(id),
  CONSTRAINT fk_st_debtor_ledger_payment FOREIGN KEY (payment_id) REFERENCES st_payments(id),
  CONSTRAINT fk_st_debtor_ledger_user FOREIGN KEY (created_by_user_id) REFERENCES users(id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS st_slips (
  id CHAR(36) NOT NULL PRIMARY KEY,
  tenant_id CHAR(36) NOT NULL,
  station_id CHAR(36) NOT NULL,
  account_id CHAR(36) NOT NULL,
  amount_minor BIGINT NOT NULL,
  reference VARCHAR(190) NOT NULL,
  terminal_id VARCHAR(190) NOT NULL,
  transaction_at DATETIME(3) NOT NULL,
  status ENUM('VERIFIED','REJECTED') NOT NULL DEFAULT 'VERIFIED',
  method ENUM('MANUAL') NOT NULL DEFAULT 'MANUAL',
  note VARCHAR(500) NULL,
  created_by_user_id INT NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_st_slips_evidence (station_id, terminal_id, reference, transaction_at),
  KEY ix_st_slips_account (account_id, transaction_at),
  CONSTRAINT fk_st_slips_tenant FOREIGN KEY (tenant_id) REFERENCES st_tenants(id),
  CONSTRAINT fk_st_slips_station FOREIGN KEY (station_id) REFERENCES st_stations(id),
  CONSTRAINT fk_st_slips_account FOREIGN KEY (account_id) REFERENCES st_accounts(id),
  CONSTRAINT fk_st_slips_user FOREIGN KEY (created_by_user_id) REFERENCES users(id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS st_account_signatures (
  id CHAR(36) NOT NULL PRIMARY KEY,
  account_id CHAR(36) NOT NULL,
  cycle_no INT UNSIGNED NOT NULL,
  revision INT UNSIGNED NOT NULL,
  kind ENUM('CASH_RECEIVE','APPROVAL') NOT NULL,
  user_id INT NOT NULL,
  snapshot_json LONGTEXT NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY ix_st_signatures_account_cycle (account_id, cycle_no, created_at),
  CONSTRAINT fk_st_signatures_account FOREIGN KEY (account_id) REFERENCES st_accounts(id),
  CONSTRAINT fk_st_signatures_user FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS st_products (
  id CHAR(36) NOT NULL PRIMARY KEY,
  tenant_id CHAR(36) NOT NULL,
  station_id CHAR(36) NOT NULL,
  name VARCHAR(190) NOT NULL,
  barcode VARCHAR(190) NOT NULL,
  stock_qty BIGINT NOT NULL DEFAULT 0,
  minimum_qty BIGINT NOT NULL DEFAULT 0,
  purchase_price_minor BIGINT NOT NULL DEFAULT 0,
  sale_price_minor BIGINT NOT NULL DEFAULT 0,
  supplier_id CHAR(36) NULL,
  created_by_user_id INT NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_st_products_barcode (station_id, barcode),
  KEY ix_st_products_station (station_id, name),
  CONSTRAINT fk_st_products_tenant FOREIGN KEY (tenant_id) REFERENCES st_tenants(id),
  CONSTRAINT fk_st_products_station FOREIGN KEY (station_id) REFERENCES st_stations(id),
  CONSTRAINT fk_st_products_user FOREIGN KEY (created_by_user_id) REFERENCES users(id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS st_suppliers (
  id CHAR(36) NOT NULL PRIMARY KEY,
  tenant_id CHAR(36) NOT NULL,
  station_id CHAR(36) NOT NULL,
  name VARCHAR(190) NOT NULL,
  credit_limit_minor BIGINT NOT NULL DEFAULT 0,
  created_by_user_id INT NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_st_suppliers_name (station_id, name),
  CONSTRAINT fk_st_suppliers_tenant FOREIGN KEY (tenant_id) REFERENCES st_tenants(id),
  CONSTRAINT fk_st_suppliers_station FOREIGN KEY (station_id) REFERENCES st_stations(id),
  CONSTRAINT fk_st_suppliers_user FOREIGN KEY (created_by_user_id) REFERENCES users(id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS st_products_suppliers_guard (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  product_id CHAR(36) NOT NULL,
  supplier_id CHAR(36) NOT NULL,
  UNIQUE KEY uq_st_products_supplier_guard (product_id, supplier_id),
  CONSTRAINT fk_st_products_supplier_guard_product FOREIGN KEY (product_id) REFERENCES st_products(id),
  CONSTRAINT fk_st_products_supplier_guard_supplier FOREIGN KEY (supplier_id) REFERENCES st_suppliers(id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS st_stock_movements (
  id CHAR(36) NOT NULL PRIMARY KEY,
  tenant_id CHAR(36) NOT NULL,
  station_id CHAR(36) NOT NULL,
  product_id CHAR(36) NOT NULL,
  kind ENUM('RECEIPT','SALE','ADJUSTMENT') NOT NULL,
  quantity BIGINT NOT NULL,
  unit_price_minor BIGINT NOT NULL DEFAULT 0,
  reference VARCHAR(190) NULL,
  created_by_user_id INT NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY ix_st_stock_product (product_id, created_at),
  CONSTRAINT fk_st_stock_tenant FOREIGN KEY (tenant_id) REFERENCES st_tenants(id),
  CONSTRAINT fk_st_stock_station FOREIGN KEY (station_id) REFERENCES st_stations(id),
  CONSTRAINT fk_st_stock_product FOREIGN KEY (product_id) REFERENCES st_products(id),
  CONSTRAINT fk_st_stock_user FOREIGN KEY (created_by_user_id) REFERENCES users(id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS st_payables (
  id CHAR(36) NOT NULL PRIMARY KEY,
  tenant_id CHAR(36) NOT NULL,
  station_id CHAR(36) NOT NULL,
  supplier_id CHAR(36) NOT NULL,
  amount_minor BIGINT NOT NULL,
  due_date DATE NOT NULL,
  reference VARCHAR(190) NULL,
  status ENUM('OPEN','PAID','CANCELLED') NOT NULL DEFAULT 'OPEN',
  created_by_user_id INT NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY ix_st_payables_supplier (supplier_id, status, due_date),
  CONSTRAINT fk_st_payables_tenant FOREIGN KEY (tenant_id) REFERENCES st_tenants(id),
  CONSTRAINT fk_st_payables_station FOREIGN KEY (station_id) REFERENCES st_stations(id),
  CONSTRAINT fk_st_payables_supplier FOREIGN KEY (supplier_id) REFERENCES st_suppliers(id),
  CONSTRAINT fk_st_payables_user FOREIGN KEY (created_by_user_id) REFERENCES users(id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS st_terminal_leases (
  account_id CHAR(36) NOT NULL,
  device_id VARCHAR(190) NOT NULL,
  kind ENUM('DESKTOP','MOBILE') NOT NULL,
  acquired_by_user_id INT NOT NULL,
  expires_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (account_id, device_id),
  KEY ix_st_terminal_leases_expiry (account_id, kind, expires_at),
  CONSTRAINT fk_st_terminal_leases_account FOREIGN KEY (account_id) REFERENCES st_accounts(id),
  CONSTRAINT fk_st_terminal_leases_user FOREIGN KEY (acquired_by_user_id) REFERENCES users(id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS st_requests (
  actor_user_id INT NOT NULL,
  request_id CHAR(36) NOT NULL,
  payload_hash CHAR(64) NOT NULL,
  response_json LONGTEXT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (actor_user_id, request_id),
  CONSTRAINT fk_st_requests_user FOREIGN KEY (actor_user_id) REFERENCES users(id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS st_audit (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  tenant_id CHAR(36) NOT NULL,
  station_id CHAR(36) NULL,
  actor_user_id INT NOT NULL,
  action VARCHAR(120) NOT NULL,
  entity_id CHAR(36) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY ix_st_audit_scope (tenant_id, station_id, created_at),
  CONSTRAINT fk_st_audit_tenant FOREIGN KEY (tenant_id) REFERENCES st_tenants(id),
  CONSTRAINT fk_st_audit_station FOREIGN KEY (station_id) REFERENCES st_stations(id),
  CONSTRAINT fk_st_audit_user FOREIGN KEY (actor_user_id) REFERENCES users(id)
) ENGINE=InnoDB;

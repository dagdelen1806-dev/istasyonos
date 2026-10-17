CREATE TABLE st_market_books (
  station_id CHAR(36) NOT NULL PRIMARY KEY,
  tenant_id CHAR(36) NOT NULL,
  started_on DATE NOT NULL,
  closed_through DATE NULL,
  revision INT NOT NULL DEFAULT 0,
  created_by_user_id INT NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  FOREIGN KEY (station_id) REFERENCES st_stations(id),
  FOREIGN KEY (tenant_id) REFERENCES st_tenants(id),
  FOREIGN KEY (created_by_user_id) REFERENCES users(id)
) ENGINE=InnoDB;
CREATE TABLE st_market_parties (
  id CHAR(36) NOT NULL PRIMARY KEY,
  tenant_id CHAR(36) NOT NULL,
  station_id CHAR(36) NOT NULL,
  name VARCHAR(190) NOT NULL,
  kind ENUM('CUSTOMER','SUPPLIER','BOTH') NOT NULL,
  tax_number VARCHAR(32) NULL,
  receivable_limit_minor BIGINT NOT NULL DEFAULT 0,
  payable_limit_minor BIGINT NULL,
  term_days INT NOT NULL DEFAULT 0,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY ix_market_party (station_id,name),
  FOREIGN KEY (tenant_id) REFERENCES st_tenants(id),
  FOREIGN KEY (station_id) REFERENCES st_stations(id)
) ENGINE=InnoDB;
CREATE TABLE st_market_entries (
  id CHAR(36) NOT NULL PRIMARY KEY,
  seq BIGINT UNSIGNED NOT NULL AUTO_INCREMENT UNIQUE,
  tenant_id CHAR(36) NOT NULL,
  station_id CHAR(36) NOT NULL,
  business_date DATE NOT NULL,
  kind VARCHAR(32) NOT NULL,
  source_id CHAR(36) NOT NULL,
  reference VARCHAR(190) NULL,
  external_key VARCHAR(190) NULL,
  description VARCHAR(500) NOT NULL,
  actor_user_id INT NOT NULL,
  payload_json JSON NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_market_source (station_id,kind,source_id),
  UNIQUE KEY uq_market_external (station_id,external_key),
  KEY ix_market_journal (tenant_id,station_id,business_date,seq),
  FOREIGN KEY (tenant_id) REFERENCES st_tenants(id),
  FOREIGN KEY (station_id) REFERENCES st_stations(id),
  FOREIGN KEY (actor_user_id) REFERENCES users(id)
) ENGINE=InnoDB;
CREATE TABLE st_market_lines (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  entry_id CHAR(36) NOT NULL,
  account_code VARCHAR(32) NOT NULL,
  party_id CHAR(36) NULL,
  register_id CHAR(36) NULL,
  debit_minor BIGINT NOT NULL DEFAULT 0,
  credit_minor BIGINT NOT NULL DEFAULT 0,
  CONSTRAINT ck_market_line CHECK ((debit_minor>0 AND credit_minor=0) OR (credit_minor>0 AND debit_minor=0)),
  KEY ix_market_party_lines (party_id,account_code),
  FOREIGN KEY (entry_id) REFERENCES st_market_entries(id),
  FOREIGN KEY (party_id) REFERENCES st_market_parties(id),
  FOREIGN KEY (register_id) REFERENCES st_pos_registers(id)
) ENGINE=InnoDB;
CREATE TABLE st_market_balances (
  station_id CHAR(36) NOT NULL,
  account_code VARCHAR(32) NOT NULL,
  party_key VARCHAR(36) NOT NULL DEFAULT '',
  register_key VARCHAR(36) NOT NULL DEFAULT '',
  balance_minor BIGINT NOT NULL DEFAULT 0,
  PRIMARY KEY (station_id,account_code,party_key,register_key),
  FOREIGN KEY (station_id) REFERENCES st_market_books(station_id)
) ENGINE=InnoDB;
CREATE TABLE st_market_inventory (
  product_id CHAR(36) NOT NULL PRIMARY KEY,
  station_id CHAR(36) NOT NULL,
  quantity BIGINT NOT NULL,
  value_minor BIGINT NOT NULL,
  CONSTRAINT ck_market_inventory CHECK (quantity>=0 AND value_minor>=0 AND (quantity>0 OR value_minor=0)),
  FOREIGN KEY (product_id) REFERENCES st_products(id),
  FOREIGN KEY (station_id) REFERENCES st_stations(id)
) ENGINE=InnoDB;
CREATE TABLE st_market_documents (
  id CHAR(36) NOT NULL PRIMARY KEY,
  tenant_id CHAR(36) NOT NULL,
  station_id CHAR(36) NOT NULL,
  party_id CHAR(36) NOT NULL,
  entry_id CHAR(36) NOT NULL,
  kind ENUM('PURCHASE','CREDIT_SALE','OPENING_AR','OPENING_AP') NOT NULL,
  reference VARCHAR(120) NOT NULL,
  due_date DATE NOT NULL,
  total_minor BIGINT NOT NULL,
  settled_minor BIGINT NOT NULL DEFAULT 0,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  CONSTRAINT ck_market_document CHECK (total_minor>0 AND settled_minor>=0 AND settled_minor<=total_minor),
  UNIQUE KEY uq_market_document (station_id,party_id,kind,reference),
  KEY ix_market_due (station_id,party_id,due_date),
  FOREIGN KEY (party_id) REFERENCES st_market_parties(id),
  FOREIGN KEY (entry_id) REFERENCES st_market_entries(id)
) ENGINE=InnoDB;
CREATE TABLE st_market_allocations (
  id CHAR(36) NOT NULL PRIMARY KEY,
  document_id CHAR(36) NOT NULL,
  entry_id CHAR(36) NOT NULL,
  amount_minor BIGINT NOT NULL,
  FOREIGN KEY (document_id) REFERENCES st_market_documents(id),
  FOREIGN KEY (entry_id) REFERENCES st_market_entries(id)
) ENGINE=InnoDB;
CREATE TABLE st_market_day_closes (
  id CHAR(36) NOT NULL PRIMARY KEY,
  tenant_id CHAR(36) NOT NULL,
  station_id CHAR(36) NOT NULL,
  business_date DATE NOT NULL,
  actor_user_id INT NOT NULL,
  expected_cash_minor BIGINT NOT NULL,
  counted_cash_minor BIGINT NOT NULL,
  difference_minor BIGINT NOT NULL,
  note VARCHAR(500) NULL,
  snapshot_json JSON NOT NULL,
  snapshot_hash CHAR(64) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_market_day_close (station_id,business_date),
  FOREIGN KEY (station_id) REFERENCES st_stations(id),
  FOREIGN KEY (actor_user_id) REFERENCES users(id)
) ENGINE=InnoDB;
ALTER TABLE st_products ADD COLUMN market_vat_bps SMALLINT UNSIGNED NULL;
ALTER TABLE st_products ADD CONSTRAINT ck_market_vat CHECK (market_vat_bps IS NULL OR market_vat_bps<=10000);
SET @market_check_drop = IF(LOCATE('MariaDB',VERSION())>0,
  'ALTER TABLE st_pos_sales DROP CONSTRAINT ck_pos_payment_split',
  'ALTER TABLE st_pos_sales DROP CHECK ck_pos_payment_split');
PREPARE market_check_statement FROM @market_check_drop;
EXECUTE market_check_statement;
DEALLOCATE PREPARE market_check_statement;
ALTER TABLE st_pos_sales MODIFY COLUMN payment_kind ENUM('CASH','CARD_MANUAL','MIXED','ON_ACCOUNT') NOT NULL;
ALTER TABLE st_pos_sales MODIFY COLUMN payment_status ENUM('CASH_RECORDED','CASHIER_DECLARED','CUSTOMER_DEBT') NOT NULL;
ALTER TABLE st_pos_sales ADD COLUMN receivable_amount_minor BIGINT NOT NULL DEFAULT 0;
ALTER TABLE st_pos_sales ADD COLUMN customer_party_id CHAR(36) NULL;
ALTER TABLE st_pos_sales ADD CONSTRAINT fk_pos_market_customer FOREIGN KEY (customer_party_id) REFERENCES st_market_parties(id);
ALTER TABLE st_pos_sales ADD CONSTRAINT ck_pos_payment_split CHECK (cash_amount_minor>=0 AND card_amount_minor>=0 AND receivable_amount_minor>=0 AND cash_amount_minor+card_amount_minor+receivable_amount_minor=total_minor);
ALTER TABLE st_pos_sale_lines ADD COLUMN net_total_minor BIGINT NULL;
ALTER TABLE st_pos_sale_lines ADD COLUMN vat_minor BIGINT NULL;
ALTER TABLE st_pos_sale_lines ADD COLUMN cost_total_minor BIGINT NULL;

CREATE TABLE IF NOT EXISTS st_pos_registers (
  id CHAR(36) NOT NULL PRIMARY KEY,
  tenant_id CHAR(36) NOT NULL,
  station_id CHAR(36) NOT NULL,
  name VARCHAR(100) NOT NULL,
  code VARCHAR(32) NOT NULL,
  created_by_user_id INT NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_pos_register_code (station_id, code),
  UNIQUE KEY uq_pos_register_scope (id, tenant_id, station_id),
  FOREIGN KEY (tenant_id) REFERENCES st_tenants(id),
  FOREIGN KEY (station_id) REFERENCES st_stations(id),
  FOREIGN KEY (created_by_user_id) REFERENCES users(id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS st_pos_sessions (
  id CHAR(36) NOT NULL PRIMARY KEY,
  tenant_id CHAR(36) NOT NULL,
  station_id CHAR(36) NOT NULL,
  register_id CHAR(36) NOT NULL,
  user_id INT NOT NULL,
  device_id CHAR(36) NOT NULL,
  opening_float_minor BIGINT NOT NULL,
  opened_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  closed_at DATETIME(3) NULL,
  counted_cash_minor BIGINT NULL,
  expected_cash_minor BIGINT NULL,
  difference_minor BIGINT NULL,
  close_note VARCHAR(500) NULL,
  open_register_id CHAR(36) NULL,
  CONSTRAINT ck_pos_open_slot CHECK ((closed_at IS NULL AND open_register_id IS NOT NULL AND open_register_id=register_id) OR (closed_at IS NOT NULL AND open_register_id IS NULL)),
  UNIQUE KEY uq_pos_open_register (open_register_id),
  UNIQUE KEY uq_pos_session_scope (id, tenant_id, station_id, register_id),
  KEY ix_pos_sessions_actor (station_id, user_id, opened_at),
  FOREIGN KEY (register_id, tenant_id, station_id) REFERENCES st_pos_registers(id, tenant_id, station_id),
  FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS st_pos_sales (
  id CHAR(36) NOT NULL PRIMARY KEY,
  tenant_id CHAR(36) NOT NULL,
  station_id CHAR(36) NOT NULL,
  register_id CHAR(36) NOT NULL,
  session_id CHAR(36) NOT NULL,
  user_id INT NOT NULL,
  request_id CHAR(36) NOT NULL,
  total_minor BIGINT NOT NULL,
  payment_kind ENUM('CASH','CARD_MANUAL') NOT NULL,
  payment_status ENUM('CASH_RECORDED','CASHIER_DECLARED') NOT NULL,
  tendered_minor BIGINT NULL,
  change_minor BIGINT NULL,
  fiscal_status ENUM('NOT_ISSUED_DEMO') NOT NULL DEFAULT 'NOT_ISSUED_DEMO',
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_pos_sale_request (user_id, request_id),
  KEY ix_pos_sales_session (session_id, created_at),
  FOREIGN KEY (session_id, tenant_id, station_id, register_id) REFERENCES st_pos_sessions(id, tenant_id, station_id, register_id),
  FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS st_pos_sale_lines (
  id CHAR(36) NOT NULL PRIMARY KEY,
  sale_id CHAR(36) NOT NULL,
  product_id CHAR(36) NOT NULL,
  product_name VARCHAR(190) NOT NULL,
  barcode VARCHAR(190) NOT NULL,
  quantity BIGINT NOT NULL,
  unit_price_minor BIGINT NOT NULL,
  total_minor BIGINT NOT NULL,
  UNIQUE KEY uq_pos_sale_product (sale_id, product_id),
  FOREIGN KEY (sale_id) REFERENCES st_pos_sales(id),
  FOREIGN KEY (product_id) REFERENCES st_products(id)
) ENGINE=InnoDB;

-- Transactional journal only. No cloud sender or fiscal delivery is implied.
CREATE TABLE IF NOT EXISTS st_pos_events (
  id CHAR(36) NOT NULL PRIMARY KEY,
  sale_id CHAR(36) NOT NULL,
  event_type ENUM('DEMO_SALE_RECORDED') NOT NULL,
  delivery_status ENUM('NOT_CONFIGURED') NOT NULL DEFAULT 'NOT_CONFIGURED',
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_pos_sale_event (sale_id, event_type),
  FOREIGN KEY (sale_id) REFERENCES st_pos_sales(id)
) ENGINE=InnoDB;

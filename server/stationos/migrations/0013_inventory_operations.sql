ALTER TABLE st_products
 ADD COLUMN category VARCHAR(100) NOT NULL DEFAULT '',
 ADD COLUMN brand VARCHAR(100) NOT NULL DEFAULT '',
 ADD COLUMN base_unit VARCHAR(32) NOT NULL DEFAULT 'adet',
 ADD COLUMN shelf VARCHAR(100) NOT NULL DEFAULT '',
 ADD COLUMN maximum_qty BIGINT NOT NULL DEFAULT 0,
 ADD COLUMN lead_days INT NOT NULL DEFAULT 3,
 ADD COLUMN review_days INT NOT NULL DEFAULT 7,
 ADD COLUMN safety_days INT NOT NULL DEFAULT 2,
 ADD COLUMN order_pack_qty INT NOT NULL DEFAULT 1,
 ADD COLUMN market_supplier_id CHAR(36) NULL,
 ADD COLUMN purchase_vat_bps SMALLINT UNSIGNED NULL,
 ADD COLUMN last_purchase_net_minor BIGINT NULL,
 ADD COLUMN stock_version BIGINT NOT NULL DEFAULT 0,
 ADD CONSTRAINT fk_inventory_supplier FOREIGN KEY (market_supplier_id) REFERENCES st_market_parties(id),
 ADD CONSTRAINT ck_inventory_rules CHECK (maximum_qty>=0 AND (maximum_qty=0 OR maximum_qty>=minimum_qty) AND lead_days BETWEEN 0 AND 365 AND review_days BETWEEN 1 AND 365 AND safety_days BETWEEN 0 AND 365 AND order_pack_qty BETWEEN 1 AND 10000 AND (purchase_vat_bps IS NULL OR purchase_vat_bps<=10000) AND (last_purchase_net_minor IS NULL OR last_purchase_net_minor>=0) AND stock_version>=0);

CREATE TABLE st_product_barcodes (
 station_id CHAR(36) NOT NULL,
 barcode VARCHAR(190) NOT NULL,
 product_id CHAR(36) NOT NULL,
 pack_qty INT NOT NULL DEFAULT 1,
 label VARCHAR(100) NOT NULL DEFAULT '',
 PRIMARY KEY (station_id,barcode),
 KEY ix_inventory_barcode_product (product_id),
 CONSTRAINT ck_inventory_pack CHECK (pack_qty BETWEEN 1 AND 10000),
 FOREIGN KEY (station_id) REFERENCES st_stations(id),
 FOREIGN KEY (product_id) REFERENCES st_products(id)
) ENGINE=InnoDB;
INSERT INTO st_product_barcodes(station_id,barcode,product_id,pack_qty,label)
 SELECT station_id,barcode,id,1,'Ana barkod' FROM st_products;

CREATE TABLE st_market_price_lists (
 id CHAR(36) NOT NULL PRIMARY KEY,
 tenant_id CHAR(36) NOT NULL,
 station_id CHAR(36) NOT NULL,
 name VARCHAR(100) NOT NULL,
 active BOOLEAN NOT NULL DEFAULT TRUE,
 staff_enabled BOOLEAN NOT NULL DEFAULT FALSE,
 UNIQUE KEY uq_inventory_price_list (station_id,name),
 FOREIGN KEY (station_id) REFERENCES st_stations(id),
 FOREIGN KEY (tenant_id) REFERENCES st_tenants(id)
) ENGINE=InnoDB;
CREATE TABLE st_market_prices (
 list_id CHAR(36) NOT NULL,
 product_id CHAR(36) NOT NULL,
 unit_price_minor BIGINT NOT NULL,
 PRIMARY KEY (list_id,product_id),
 CONSTRAINT ck_inventory_price CHECK (unit_price_minor>=0),
 FOREIGN KEY (list_id) REFERENCES st_market_price_lists(id),
 FOREIGN KEY (product_id) REFERENCES st_products(id)
) ENGINE=InnoDB;
CREATE TABLE st_market_price_history (
 id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
 station_id CHAR(36) NOT NULL,
 product_id CHAR(36) NOT NULL,
 list_id CHAR(36) NULL,
 old_minor BIGINT NULL,
 new_minor BIGINT NOT NULL,
 actor_user_id INT NOT NULL,
 created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 KEY ix_inventory_price_history (product_id,id),
 FOREIGN KEY (station_id) REFERENCES st_stations(id),
 FOREIGN KEY (product_id) REFERENCES st_products(id),
 FOREIGN KEY (list_id) REFERENCES st_market_price_lists(id),
 FOREIGN KEY (actor_user_id) REFERENCES users(id)
) ENGINE=InnoDB;
ALTER TABLE st_pos_sale_lines ADD COLUMN price_list_id CHAR(36) NULL, ADD COLUMN price_list_name VARCHAR(100) NULL;

CREATE TABLE st_inventory_devices (
 station_id CHAR(36) NOT NULL,
 device_id CHAR(36) NOT NULL,
 name VARCHAR(100) NOT NULL,
 model VARCHAR(100) NOT NULL,
 platform ENUM('ANDROID','WINDOWS','OTHER') NOT NULL,
 enabled BOOLEAN NOT NULL DEFAULT FALSE,
 created_by_user_id INT NOT NULL,
 approved_by_user_id INT NULL,
 last_seen_at DATETIME(3) NULL,
 PRIMARY KEY (station_id,device_id),
 FOREIGN KEY (station_id) REFERENCES st_stations(id),
 FOREIGN KEY (created_by_user_id) REFERENCES users(id),
 FOREIGN KEY (approved_by_user_id) REFERENCES users(id)
) ENGINE=InnoDB;
CREATE TABLE st_inventory_drafts (
 id CHAR(36) NOT NULL PRIMARY KEY,
 tenant_id CHAR(36) NOT NULL,
 station_id CHAR(36) NOT NULL,
 kind ENUM('COUNT','RECEIPT') NOT NULL,
 status ENUM('DRAFT','POSTED','CANCELLED') NOT NULL DEFAULT 'DRAFT',
 label VARCHAR(100) NOT NULL,
 version BIGINT NOT NULL DEFAULT 0,
 created_by_user_id INT NOT NULL,
 posted_entry_id CHAR(36) NULL,
 created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 KEY ix_inventory_drafts (station_id,status,updated_at),
 FOREIGN KEY (station_id) REFERENCES st_stations(id),
 FOREIGN KEY (tenant_id) REFERENCES st_tenants(id),
 FOREIGN KEY (created_by_user_id) REFERENCES users(id),
 FOREIGN KEY (posted_entry_id) REFERENCES st_market_entries(id)
) ENGINE=InnoDB;
CREATE TABLE st_inventory_draft_lines (
 draft_id CHAR(36) NOT NULL,
 product_id CHAR(36) NOT NULL,
 baseline_qty BIGINT NOT NULL,
 baseline_version BIGINT NOT NULL,
 counted_qty BIGINT NULL,
 counted_by_user_id INT NULL,
 device_id CHAR(36) NULL,
 updated_at DATETIME(3) NULL,
 PRIMARY KEY (draft_id,product_id),
 CONSTRAINT ck_inventory_counted CHECK (counted_qty IS NULL OR counted_qty BETWEEN 0 AND 1000000000),
 FOREIGN KEY (draft_id) REFERENCES st_inventory_drafts(id),
 FOREIGN KEY (product_id) REFERENCES st_products(id),
 FOREIGN KEY (counted_by_user_id) REFERENCES users(id)
) ENGINE=InnoDB;
CREATE TABLE st_inventory_draft_events (
 id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
 draft_id CHAR(36) NOT NULL,
 actor_user_id INT NOT NULL,
 device_id CHAR(36) NULL,
 action VARCHAR(32) NOT NULL,
 product_id CHAR(36) NULL,
 before_qty BIGINT NULL,
 after_qty BIGINT NULL,
 note VARCHAR(500) NULL,
 created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 KEY ix_inventory_draft_events (draft_id,id),
 FOREIGN KEY (draft_id) REFERENCES st_inventory_drafts(id),
 FOREIGN KEY (actor_user_id) REFERENCES users(id)
) ENGINE=InnoDB;

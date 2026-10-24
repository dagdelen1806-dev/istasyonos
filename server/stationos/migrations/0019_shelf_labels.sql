CREATE TABLE st_shelf_label_batches (
 id CHAR(36) NOT NULL PRIMARY KEY,
 tenant_id CHAR(36) NOT NULL,
 station_id CHAR(36) NOT NULL,
 label VARCHAR(100) NOT NULL,
 created_by_user_id INT NOT NULL,
 created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 KEY ix_shelf_batches (station_id,created_at,id),
 FOREIGN KEY (tenant_id) REFERENCES st_tenants(id),
 FOREIGN KEY (station_id) REFERENCES st_stations(id),
 FOREIGN KEY (created_by_user_id) REFERENCES users(id)
) ENGINE=InnoDB;
CREATE TABLE st_shelf_label_items (
 batch_id CHAR(36) NOT NULL,
 product_id CHAR(36) NOT NULL,
 content_hash CHAR(64) NOT NULL,
 snapshot_json JSON NOT NULL,
 copies INT NOT NULL,
 installed_at DATETIME(3) NULL,
 installed_by_user_id INT NULL,
 PRIMARY KEY (batch_id,product_id),
 FOREIGN KEY (batch_id) REFERENCES st_shelf_label_batches(id),
 FOREIGN KEY (product_id) REFERENCES st_products(id),
 FOREIGN KEY (installed_by_user_id) REFERENCES users(id),
 CONSTRAINT ck_shelf_copies CHECK (copies BETWEEN 1 AND 20)
) ENGINE=InnoDB;
CREATE TABLE st_shelf_label_installs (
 product_id CHAR(36) NOT NULL PRIMARY KEY,
 station_id CHAR(36) NOT NULL,
 batch_id CHAR(36) NOT NULL,
 content_hash CHAR(64) NOT NULL,
 snapshot_json JSON NOT NULL,
 installed_by_user_id INT NOT NULL,
 installed_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 FOREIGN KEY (batch_id,product_id) REFERENCES st_shelf_label_items(batch_id,product_id),
 FOREIGN KEY (station_id) REFERENCES st_stations(id),
 FOREIGN KEY (installed_by_user_id) REFERENCES users(id)
) ENGINE=InnoDB;
CREATE TABLE st_shelf_price_checks (
 id CHAR(36) NOT NULL PRIMARY KEY,
 tenant_id CHAR(36) NOT NULL,
 station_id CHAR(36) NOT NULL,
 product_id CHAR(36) NOT NULL,
 barcode VARCHAR(190) NOT NULL,
 observed_minor BIGINT NOT NULL,
 expected_minor BIGINT NOT NULL,
 matches_price BOOLEAN NOT NULL,
 content_hash CHAR(64) NOT NULL,
 installed_hash CHAR(64) NULL,
 actor_user_id INT NOT NULL,
 device_id CHAR(36) NOT NULL,
 reason VARCHAR(500) NULL,
 created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 KEY ix_shelf_checks (station_id,created_at,id),
 FOREIGN KEY (tenant_id) REFERENCES st_tenants(id),
 FOREIGN KEY (station_id) REFERENCES st_stations(id),
 FOREIGN KEY (product_id) REFERENCES st_products(id),
 FOREIGN KEY (actor_user_id) REFERENCES users(id),
 CONSTRAINT ck_shelf_prices CHECK (observed_minor>=0 AND expected_minor>=0)
) ENGINE=InnoDB;
ALTER TABLE st_market_price_history ADD KEY ix_shelf_price_history (station_id,product_id,list_id,id);

CREATE TABLE st_shelf_label_events (
 id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
 batch_id CHAR(36) NOT NULL,
 product_id CHAR(36) NOT NULL,
 actor_user_id INT NOT NULL,
 reason VARCHAR(500) NOT NULL,
 content_hash CHAR(64) NOT NULL,
 created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 KEY ix_shelf_label_event (batch_id,id),
 FOREIGN KEY (batch_id,product_id) REFERENCES st_shelf_label_items(batch_id,product_id),
 FOREIGN KEY (actor_user_id) REFERENCES users(id)
) ENGINE=InnoDB;

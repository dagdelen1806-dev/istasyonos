ALTER TABLE st_products ADD COLUMN catalog_code VARCHAR(100) NULL,
 ADD UNIQUE KEY uq_product_catalog_code (station_id,catalog_code);
CREATE TABLE st_catalog_imports (
 id CHAR(36) NOT NULL PRIMARY KEY,
 tenant_id CHAR(36) NOT NULL,
 station_id CHAR(36) NOT NULL,
 source_hash CHAR(64) NOT NULL,
 source_label VARCHAR(100) NOT NULL,
 added_count INT NOT NULL,
 skipped_count INT NOT NULL,
 source_rows_json JSON NOT NULL,
 created_by_user_id INT NOT NULL,
 created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 UNIQUE KEY uq_catalog_source (station_id,source_hash),
 FOREIGN KEY (tenant_id) REFERENCES st_tenants(id),
 FOREIGN KEY (station_id) REFERENCES st_stations(id),
 FOREIGN KEY (created_by_user_id) REFERENCES users(id)
) ENGINE=InnoDB;

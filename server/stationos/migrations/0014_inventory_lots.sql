ALTER TABLE st_products ADD COLUMN lot_tracking BOOLEAN NOT NULL DEFAULT FALSE;
CREATE TABLE st_inventory_lots (
 id CHAR(36) NOT NULL PRIMARY KEY,
 tenant_id CHAR(36) NOT NULL,
 station_id CHAR(36) NOT NULL,
 product_id CHAR(36) NOT NULL,
 code VARCHAR(100) NOT NULL,
 expiry_date DATE NULL,
 status ENUM('AVAILABLE','QUARANTINE') NOT NULL,
 quantity BIGINT NOT NULL,
 origin_kind VARCHAR(32) NOT NULL,
 origin_id CHAR(36) NOT NULL,
 received_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 CONSTRAINT ck_lot_quantity CHECK (quantity>=0),
 KEY ix_lot_fefo (product_id,status,expiry_date,received_at,id),
 KEY ix_lot_station (station_id,expiry_date),
 FOREIGN KEY (tenant_id) REFERENCES st_tenants(id),
 FOREIGN KEY (station_id) REFERENCES st_stations(id),
 FOREIGN KEY (product_id) REFERENCES st_products(id)
) ENGINE=InnoDB;
CREATE TABLE st_inventory_lot_events (
 id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
 station_id CHAR(36) NOT NULL,
 product_id CHAR(36) NOT NULL,
 lot_id CHAR(36) NULL,
 kind VARCHAR(32) NOT NULL,
 source_id CHAR(36) NOT NULL,
 delta BIGINT NOT NULL,
 actor_user_id INT NOT NULL,
 detail_json JSON NOT NULL,
 created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 KEY ix_lot_event (lot_id,id),
 KEY ix_lot_source (station_id,kind,source_id),
 FOREIGN KEY (station_id) REFERENCES st_stations(id),
 FOREIGN KEY (product_id) REFERENCES st_products(id),
 FOREIGN KEY (lot_id) REFERENCES st_inventory_lots(id),
 FOREIGN KEY (actor_user_id) REFERENCES users(id)
) ENGINE=InnoDB;

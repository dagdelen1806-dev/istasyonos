ALTER TABLE st_inventory_draft_lines ADD COLUMN lot_counting BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE st_inventory_draft_events ADD COLUMN lot_id CHAR(36) NULL;
CREATE TABLE st_inventory_draft_lots (
 draft_id CHAR(36) NOT NULL,
 product_id CHAR(36) NOT NULL,
 lot_id CHAR(36) NOT NULL,
 code VARCHAR(100) NOT NULL,
 expiry_date DATE NULL,
 status VARCHAR(16) NOT NULL,
 baseline_qty BIGINT NOT NULL,
 counted_qty BIGINT NULL,
 counted_by_user_id INT NULL,
 device_id CHAR(36) NULL,
 updated_at DATETIME(3) NULL,
 PRIMARY KEY (draft_id,lot_id),
 KEY ix_draft_lots_product (draft_id,product_id),
 CONSTRAINT ck_draft_lot_qty CHECK (baseline_qty>=0 AND (counted_qty IS NULL OR counted_qty BETWEEN 0 AND 1000000000)),
 FOREIGN KEY (draft_id,product_id) REFERENCES st_inventory_draft_lines(draft_id,product_id),
 FOREIGN KEY (lot_id) REFERENCES st_inventory_lots(id),
 FOREIGN KEY (counted_by_user_id) REFERENCES users(id)
) ENGINE=InnoDB;

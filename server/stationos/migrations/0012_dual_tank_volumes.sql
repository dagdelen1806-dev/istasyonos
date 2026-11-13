ALTER TABLE st_tank_photo_reviews
  MODIFY basis ENUM('PRODUCT','NET','UNDECIDED','BOTH') NOT NULL,
  ADD COLUMN product_ml BIGINT NULL,
  ADD COLUMN net_ml BIGINT NULL;
CREATE TABLE st_tank_volume_readings (
  id CHAR(36) NOT NULL PRIMARY KEY,
  tank_id CHAR(36) NOT NULL,
  sequence_index INT UNSIGNED NOT NULL,
  product_ml BIGINT NOT NULL,
  net_ml BIGINT NOT NULL,
  stock_revision INT UNSIGNED NOT NULL,
  note VARCHAR(1000) NOT NULL,
  evidence VARCHAR(500) NOT NULL,
  actor_id INT NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_dual_reading_sequence (tank_id,sequence_index),
  FOREIGN KEY (tank_id) REFERENCES st_tank_cards(tank_id),
  FOREIGN KEY (actor_id) REFERENCES users(id)
) ENGINE=InnoDB;
CREATE TABLE st_tank_variance_resets (
  id CHAR(36) NOT NULL PRIMARY KEY,
  tank_id CHAR(36) NOT NULL,
  reading_id CHAR(36) NOT NULL,
  previous_reset_id CHAR(36) NULL,
  previous_spread_ml BIGINT NULL,
  baseline_spread_ml BIGINT NOT NULL,
  closed_difference_ml BIGINT NULL,
  status ENUM('PENDING','APPROVED','REJECTED') NOT NULL DEFAULT 'PENDING',
  note VARCHAR(1000) NOT NULL,
  evidence VARCHAR(500) NOT NULL,
  created_by INT NOT NULL,
  reviewer_id INT NULL,
  review_note VARCHAR(1000) NULL,
  review_evidence VARCHAR(500) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  reviewed_at DATETIME(3) NULL,
  UNIQUE KEY uq_reset_reading (tank_id,reading_id),
  FOREIGN KEY (tank_id) REFERENCES st_tank_cards(tank_id),
  FOREIGN KEY (reading_id) REFERENCES st_tank_volume_readings(id),
  FOREIGN KEY (previous_reset_id) REFERENCES st_tank_variance_resets(id),
  FOREIGN KEY (created_by) REFERENCES users(id),
  FOREIGN KEY (reviewer_id) REFERENCES users(id)
) ENGINE=InnoDB;

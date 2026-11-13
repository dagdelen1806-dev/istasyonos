CREATE TABLE st_daily_report_packages (
  id CHAR(36) NOT NULL PRIMARY KEY,
  tenant_id CHAR(36) NOT NULL,
  station_id CHAR(36) NOT NULL,
  source_name VARCHAR(190) NOT NULL,
  source_sha256 CHAR(64) NOT NULL,
  source_set_sha256 CHAR(64) NOT NULL,
  page_count INT UNSIGNED NOT NULL,
  created_by INT NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_daily_archive (station_id,source_sha256),
  UNIQUE KEY uq_daily_page_set (station_id,source_set_sha256),
  FOREIGN KEY (tenant_id) REFERENCES st_tenants(id),
  FOREIGN KEY (station_id) REFERENCES st_stations(id),
  FOREIGN KEY (created_by) REFERENCES users(id)
) ENGINE=InnoDB;
CREATE TABLE st_daily_report_pages (
  id CHAR(36) NOT NULL PRIMARY KEY,
  package_id CHAR(36) NOT NULL,
  source_name VARCHAR(190) NOT NULL,
  source_sha256 CHAR(64) NOT NULL,
  mime_type VARCHAR(32) NOT NULL,
  position_index INT UNSIGNED NOT NULL,
  byte_size INT UNSIGNED NOT NULL,
  image_bytes MEDIUMBLOB NOT NULL,
  UNIQUE KEY uq_daily_page_position (package_id,position_index),
  UNIQUE KEY uq_daily_page_hash (package_id,source_sha256),
  FOREIGN KEY (package_id) REFERENCES st_daily_report_packages(id)
) ENGINE=InnoDB;
CREATE TABLE st_daily_report_reviews (
  id CHAR(36) NOT NULL PRIMARY KEY,
  package_id CHAR(36) NOT NULL,
  revision INT UNSIGNED NOT NULL,
  decision ENUM('PENDING','REVIEWED_DRAFT','REJECTED') NOT NULL,
  shift_reference VARCHAR(64) NOT NULL,
  report_day DATE NOT NULL,
  page_kinds_json LONGTEXT NOT NULL,
  note VARCHAR(1000) NOT NULL,
  evidence VARCHAR(500) NOT NULL,
  reviewer_id INT NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_daily_review_revision (package_id,revision),
  FOREIGN KEY (package_id) REFERENCES st_daily_report_packages(id),
  FOREIGN KEY (reviewer_id) REFERENCES users(id)
) ENGINE=InnoDB;

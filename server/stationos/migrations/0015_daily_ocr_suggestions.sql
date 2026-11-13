CREATE TABLE st_daily_ocr_runs (
 id CHAR(36) NOT NULL PRIMARY KEY,
 page_id CHAR(36) NOT NULL,
 source_sha256 CHAR(64) NOT NULL,
 engine_version VARCHAR(64) NOT NULL,
 payload_json LONGTEXT NOT NULL,
 created_by INT NOT NULL,
 created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 UNIQUE KEY uq_daily_ocr_source (page_id,source_sha256,engine_version),
 FOREIGN KEY (page_id) REFERENCES st_daily_report_pages(id),
 FOREIGN KEY (created_by) REFERENCES users(id)
) ENGINE=InnoDB;

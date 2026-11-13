ALTER TABLE st_daily_report_packages
 ADD COLUMN document_kind ENUM('SHIFT','TANKER') NOT NULL DEFAULT 'SHIFT';
CREATE TABLE st_tanker_document_reads (
 id CHAR(36) NOT NULL PRIMARY KEY,
 package_id CHAR(36) NOT NULL,
 source_hash CHAR(64) NOT NULL,
 engine_version VARCHAR(100) NOT NULL,
 provider ENUM('LOCAL','OPENAI') NOT NULL,
 model_name VARCHAR(100) NOT NULL,
 proposal_json LONGTEXT NOT NULL,
 created_by INT NOT NULL,
 created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 UNIQUE KEY uq_tanker_read_source (package_id,source_hash,engine_version),
 FOREIGN KEY (package_id) REFERENCES st_daily_report_packages(id),
 FOREIGN KEY (created_by) REFERENCES users(id)
) ENGINE=InnoDB;
CREATE TABLE st_tanker_document_reviews (
 id CHAR(36) NOT NULL PRIMARY KEY,
 package_id CHAR(36) NOT NULL,
 revision INT UNSIGNED NOT NULL,
 read_id CHAR(36) NULL,
 source_hash CHAR(64) NOT NULL,
 decision ENUM('PENDING','VERIFIED_DRAFT','REJECTED') NOT NULL,
 values_json LONGTEXT NOT NULL,
 source_confirmed BOOLEAN NOT NULL,
 note VARCHAR(1000) NOT NULL,
 evidence VARCHAR(500) NOT NULL,
 reviewer_id INT NOT NULL,
 created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 UNIQUE KEY uq_tanker_document_revision (package_id,revision),
 FOREIGN KEY (package_id) REFERENCES st_daily_report_packages(id),
 FOREIGN KEY (read_id) REFERENCES st_tanker_document_reads(id),
 FOREIGN KEY (reviewer_id) REFERENCES users(id)
) ENGINE=InnoDB;
ALTER TABLE st_tank_requests
 ADD COLUMN tanker_review_id CHAR(36) NULL,
 ADD FOREIGN KEY (tanker_review_id) REFERENCES st_tanker_document_reviews(id);
CREATE TABLE st_tanker_receipt_links (
 request_id CHAR(36) NOT NULL PRIMARY KEY,
 review_id CHAR(36) NOT NULL,
 line_key VARCHAR(64) NOT NULL,
 business_key CHAR(64) NOT NULL,
 basis ENUM('NET','DISPATCH') NOT NULL,
 KEY ix_tanker_receipt_business (business_key),
 FOREIGN KEY (request_id) REFERENCES st_tank_requests(id),
 FOREIGN KEY (review_id) REFERENCES st_tanker_document_reviews(id)
) ENGINE=InnoDB;

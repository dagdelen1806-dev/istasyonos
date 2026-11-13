CREATE TABLE IF NOT EXISTS st_request_tracking (
  actor_user_id INT NOT NULL,
  request_id CHAR(36) NOT NULL,
  tenant_id CHAR(36) NOT NULL,
  operation VARCHAR(64) NOT NULL,
  schema_version SMALLINT UNSIGNED NOT NULL,
  scope_hash CHAR(64) NOT NULL,
  payload_hash CHAR(64) NOT NULL,
  binding_hash CHAR(64) NOT NULL,
  state ENUM('PROCESSING','COMPLETED','FAILED','UNCERTAIN') NOT NULL DEFAULT 'PROCESSING',
  error_code VARCHAR(64) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  completed_at DATETIME(3) NULL,
  PRIMARY KEY (actor_user_id, request_id),
  KEY ix_st_request_tracking_scope (tenant_id, actor_user_id, created_at),
  CONSTRAINT fk_st_request_tracking_user FOREIGN KEY (actor_user_id) REFERENCES users(id),
  CONSTRAINT fk_st_request_tracking_tenant FOREIGN KEY (tenant_id) REFERENCES st_tenants(id)
) ENGINE=InnoDB;

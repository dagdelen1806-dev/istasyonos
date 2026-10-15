CREATE TABLE IF NOT EXISTS st_assistant_requests (
  actor_user_id INT NOT NULL,
  request_id CHAR(36) NOT NULL,
  payload_hash CHAR(64) NOT NULL,
  scope_hash CHAR(64) NOT NULL,
  topic VARCHAR(32) NOT NULL,
  status ENUM('PROCESSING','DONE','FAILED') NOT NULL DEFAULT 'PROCESSING',
  response_json LONGTEXT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (actor_user_id, request_id),
  KEY ix_st_assistant_rate (actor_user_id, created_at),
  CONSTRAINT fk_st_assistant_user FOREIGN KEY (actor_user_id) REFERENCES users(id)
) ENGINE=InnoDB;

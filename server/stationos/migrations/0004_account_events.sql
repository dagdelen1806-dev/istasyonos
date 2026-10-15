CREATE TABLE IF NOT EXISTS st_account_events (
  id CHAR(36) NOT NULL PRIMARY KEY,
  account_id CHAR(36) NOT NULL,
  actor_user_id INT NOT NULL,
  cycle_no INT UNSIGNED NOT NULL,
  revision INT UNSIGNED NOT NULL,
  event_type VARCHAR(64) NOT NULL,
  payload_json LONGTEXT NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY ix_st_account_events_account (account_id, created_at),
  CONSTRAINT fk_st_account_events_account FOREIGN KEY (account_id) REFERENCES st_accounts(id),
  CONSTRAINT fk_st_account_events_actor FOREIGN KEY (actor_user_id) REFERENCES users(id)
) ENGINE=InnoDB;

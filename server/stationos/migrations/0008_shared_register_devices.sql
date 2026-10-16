CREATE TABLE IF NOT EXISTS st_pos_session_devices (
  session_id CHAR(36) NOT NULL,
  device_id CHAR(36) NOT NULL,
  user_id INT NOT NULL,
  joined_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (session_id, device_id),
  FOREIGN KEY (session_id) REFERENCES st_pos_sessions(id),
  FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB;

-- Preserve the original browser binding for existing open and closed sessions.
INSERT IGNORE INTO st_pos_session_devices (session_id,device_id,user_id,joined_at)
SELECT id,device_id,user_id,opened_at FROM st_pos_sessions;

ALTER TABLE st_pos_sales ADD COLUMN device_id CHAR(36) NULL;
UPDATE st_pos_sales p JOIN st_pos_sessions s ON s.id=p.session_id
SET p.device_id=s.device_id WHERE p.device_id IS NULL;
ALTER TABLE st_pos_sales MODIFY COLUMN device_id CHAR(36) NOT NULL;
ALTER TABLE st_pos_sales ADD CONSTRAINT fk_pos_sale_device
FOREIGN KEY (session_id,device_id) REFERENCES st_pos_session_devices(session_id,device_id);

ALTER TABLE st_pos_sessions ADD COLUMN closed_by_device_id CHAR(36) NULL;
UPDATE st_pos_sessions SET closed_by_device_id=device_id WHERE closed_at IS NOT NULL;

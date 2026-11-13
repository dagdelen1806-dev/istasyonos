CREATE TABLE st_fuel_types (
  id CHAR(36) NOT NULL PRIMARY KEY,
  tenant_id CHAR(36) NOT NULL,
  station_id CHAR(36) NOT NULL,
  name VARCHAR(64) NOT NULL,
  UNIQUE KEY uq_fuel_type (station_id, name),
  FOREIGN KEY (station_id) REFERENCES st_stations(id),
  FOREIGN KEY (tenant_id) REFERENCES st_tenants(id)
) ENGINE=InnoDB;
CREATE TABLE st_fuel_tanks (
  id CHAR(36) NOT NULL PRIMARY KEY,
  station_id CHAR(36) NOT NULL,
  fuel_type_id CHAR(36) NOT NULL,
  label VARCHAR(64) NOT NULL,
  UNIQUE KEY uq_fuel_tank (station_id, label),
  FOREIGN KEY (station_id) REFERENCES st_stations(id),
  FOREIGN KEY (fuel_type_id) REFERENCES st_fuel_types(id)
) ENGINE=InnoDB;
CREATE TABLE st_fuel_pumps (
  id CHAR(36) NOT NULL PRIMARY KEY,
  station_id CHAR(36) NOT NULL,
  label VARCHAR(64) NOT NULL,
  UNIQUE KEY uq_fuel_pump (station_id, label),
  FOREIGN KEY (station_id) REFERENCES st_stations(id)
) ENGINE=InnoDB;
CREATE TABLE st_fuel_nozzles (
  id CHAR(36) NOT NULL PRIMARY KEY,
  station_id CHAR(36) NOT NULL,
  tank_id CHAR(36) NOT NULL,
  pump_id CHAR(36) NOT NULL,
  label VARCHAR(64) NOT NULL,
  UNIQUE KEY uq_fuel_nozzle (pump_id, label),
  FOREIGN KEY (station_id) REFERENCES st_stations(id),
  FOREIGN KEY (tank_id) REFERENCES st_fuel_tanks(id),
  FOREIGN KEY (pump_id) REFERENCES st_fuel_pumps(id)
) ENGINE=InnoDB;
CREATE TABLE st_fuel_batches (
  account_id CHAR(36) NOT NULL PRIMARY KEY,
  closed BOOLEAN NOT NULL DEFAULT FALSE,
  reported_ml BIGINT NULL,
  note VARCHAR(1000) NULL,
  evidence VARCHAR(500) NULL,
  FOREIGN KEY (account_id) REFERENCES st_accounts(id)
) ENGINE=InnoDB;
CREATE TABLE st_fuel_assignments (
  shift_id CHAR(36) NOT NULL,
  nozzle_id CHAR(36) NOT NULL,
  account_id CHAR(36) NOT NULL,
  PRIMARY KEY (shift_id, nozzle_id),
  UNIQUE KEY uq_fuel_assignment (account_id, nozzle_id),
  FOREIGN KEY (shift_id) REFERENCES st_shifts(id),
  FOREIGN KEY (nozzle_id) REFERENCES st_fuel_nozzles(id),
  FOREIGN KEY (account_id) REFERENCES st_fuel_batches(account_id)
) ENGINE=InnoDB;
CREATE TABLE st_fuel_readings (
  id CHAR(36) NOT NULL PRIMARY KEY,
  account_id CHAR(36) NOT NULL,
  nozzle_id CHAR(36) NOT NULL,
  sequence_no INT NOT NULL,
  kind ENUM('OPEN','PRICE','CLOSE') NOT NULL,
  meter_ml BIGINT NOT NULL,
  price_minor BIGINT NOT NULL,
  reading_at DATETIME(3) NOT NULL,
  created_by INT NOT NULL,
  UNIQUE KEY uq_fuel_reading (account_id, nozzle_id, sequence_no),
  FOREIGN KEY (account_id, nozzle_id) REFERENCES st_fuel_assignments(account_id, nozzle_id),
  FOREIGN KEY (created_by) REFERENCES users(id)
) ENGINE=InnoDB;

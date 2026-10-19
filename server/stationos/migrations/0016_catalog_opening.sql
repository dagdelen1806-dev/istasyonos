ALTER TABLE st_catalog_imports
 ADD COLUMN mode VARCHAR(32) NOT NULL DEFAULT 'CATALOG_ONLY',
 ADD COLUMN settings_json JSON NULL,
 ADD COLUMN inventory_minor BIGINT NOT NULL DEFAULT 0,
 ADD CONSTRAINT ck_catalog_mode CHECK (mode IN ('CATALOG_ONLY','DEMO_OPENING_ABS')),
 ADD CONSTRAINT ck_catalog_value CHECK (inventory_minor>=0);

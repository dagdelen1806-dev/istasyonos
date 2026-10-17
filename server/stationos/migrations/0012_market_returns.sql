ALTER TABLE st_market_documents ADD COLUMN credited_minor BIGINT NOT NULL DEFAULT 0;
ALTER TABLE st_market_documents ADD CONSTRAINT ck_market_document_credit CHECK (credited_minor>=0 AND settled_minor+credited_minor<=total_minor);
ALTER TABLE st_stock_movements MODIFY COLUMN kind ENUM('RECEIPT','SALE','ADJUSTMENT','SALE_RETURN','PURCHASE_RETURN') NOT NULL;

CREATE TABLE st_market_returns (
  id CHAR(36) NOT NULL PRIMARY KEY,
  tenant_id CHAR(36) NOT NULL,
  station_id CHAR(36) NOT NULL,
  source_entry_id CHAR(36) NOT NULL,
  entry_id CHAR(36) NOT NULL UNIQUE,
  document_id CHAR(36) NULL,
  kind ENUM('SALE_RETURN','PURCHASE_RETURN') NOT NULL,
  reference VARCHAR(100) NOT NULL,
  reason VARCHAR(500) NOT NULL,
  net_minor BIGINT NOT NULL,
  vat_minor BIGINT NOT NULL,
  gross_minor BIGINT NOT NULL,
  cost_minor BIGINT NOT NULL,
  credited_minor BIGINT NOT NULL,
  refund_minor BIGINT NOT NULL,
  wallet ENUM('CASH_SAFE','BANK') NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_market_return_ref (station_id,reference),
  KEY ix_market_return_source (station_id,source_entry_id),
  CONSTRAINT ck_market_return_money CHECK (net_minor>=0 AND vat_minor>=0 AND gross_minor=net_minor+vat_minor AND cost_minor>=0 AND credited_minor>=0 AND refund_minor>=0 AND credited_minor+refund_minor=gross_minor AND ((refund_minor=0 AND wallet IS NULL) OR (refund_minor>0 AND wallet IS NOT NULL))),
  FOREIGN KEY (tenant_id) REFERENCES st_tenants(id),
  FOREIGN KEY (station_id) REFERENCES st_stations(id),
  FOREIGN KEY (source_entry_id) REFERENCES st_market_entries(id),
  FOREIGN KEY (entry_id) REFERENCES st_market_entries(id),
  FOREIGN KEY (document_id) REFERENCES st_market_documents(id)
) ENGINE=InnoDB;

CREATE TABLE st_market_return_lines (
  return_id CHAR(36) NOT NULL,
  product_id CHAR(36) NOT NULL,
  quantity BIGINT NOT NULL,
  gross_minor BIGINT NOT NULL,
  net_minor BIGINT NOT NULL,
  vat_minor BIGINT NOT NULL,
  cost_minor BIGINT NOT NULL,
  PRIMARY KEY (return_id,product_id),
  CONSTRAINT ck_market_return_line CHECK (quantity>0 AND gross_minor>=0 AND net_minor>=0 AND vat_minor>=0 AND gross_minor=net_minor+vat_minor AND cost_minor>=0),
  FOREIGN KEY (return_id) REFERENCES st_market_returns(id),
  FOREIGN KEY (product_id) REFERENCES st_products(id)
) ENGINE=InnoDB;

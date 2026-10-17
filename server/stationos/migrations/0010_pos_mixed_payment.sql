ALTER TABLE st_pos_sales MODIFY COLUMN payment_kind ENUM('CASH','CARD_MANUAL','MIXED') NOT NULL;
ALTER TABLE st_pos_sales ADD COLUMN cash_amount_minor BIGINT NOT NULL DEFAULT 0;
ALTER TABLE st_pos_sales ADD COLUMN card_amount_minor BIGINT NOT NULL DEFAULT 0;
UPDATE st_pos_sales SET cash_amount_minor=CASE WHEN payment_kind='CASH' THEN total_minor ELSE 0 END,
  card_amount_minor=CASE WHEN payment_kind='CARD_MANUAL' THEN total_minor ELSE 0 END;
ALTER TABLE st_pos_sales ADD CONSTRAINT ck_pos_payment_split CHECK (cash_amount_minor>=0 AND card_amount_minor>=0 AND cash_amount_minor+card_amount_minor=total_minor);

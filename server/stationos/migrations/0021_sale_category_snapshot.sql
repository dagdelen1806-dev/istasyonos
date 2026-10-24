-- NULL means the original category was not captured. Do not backfill from
-- today's product card; an empty string is a captured uncategorized sale.
ALTER TABLE st_pos_sale_lines ADD COLUMN category_snapshot VARCHAR(100) NULL;

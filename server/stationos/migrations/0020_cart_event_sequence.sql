-- Preserve all existing event IDs and snapshots. A monotonic record boundary
-- excludes newly committed events from an already opened report's pages.
ALTER TABLE st_pos_cart_events
  ADD COLUMN seq BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  ADD UNIQUE KEY uq_pos_cart_event_sequence (seq);

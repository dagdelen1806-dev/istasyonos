-- Must run after 0002: this managed engine resolves generated-column indexes separately.
ALTER TABLE st_slips
  ADD UNIQUE KEY uq_st_slips_day (station_id, terminal_id, reference, transaction_day);

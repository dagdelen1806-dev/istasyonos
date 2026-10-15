-- UTC storage -> Turkey calendar day, with no exact timestamp dependence.
ALTER TABLE st_slips
  ADD COLUMN transaction_day DATE GENERATED ALWAYS AS (DATE(DATE_ADD(transaction_at, INTERVAL 3 HOUR))) VIRTUAL;

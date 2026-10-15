-- AKARYAKIT V1 v1.6 — prepared/query templates; not a psql migration.
-- :named_parameters must be bound by an authorized read-only service.
-- Base schema: v1.4 + v1.5. No writes, no real vendor API.
-- SQL-1: Daily stockout projection. Validate forecast >= 0, horizon 1..31,
-- IDs allowed, and confirmed_purchase_order_ids from trusted supplier confirmation.
-- Today is :as_of_date (Europe/Istanbul operating date).

WITH params AS (
  SELECT CAST(:tenant_id AS uuid) AS tenant_id,
         CAST(:station_id AS uuid) AS station_id,
         CAST(:market_business_unit_id AS uuid) AS business_unit_id,
         CAST(:product_id AS uuid) AS product_id,
         CAST(:as_of_date AS date) AS as_of_date,
         CAST(:horizon_days AS integer) AS horizon_days,
         CAST(:forecast_daily_qty AS numeric) AS forecast_daily_qty
), stock AS (
  SELECT p.*, b.on_hand_good_qty, b.reserved_qty, b.snapshot_at,
         b.stock_integrity_issue,
         b.on_hand_good_qty - b.reserved_qty AS usable_now
  FROM params p
  LEFT JOIN market.inventory_balances b
    ON b.tenant_id = p.tenant_id AND b.station_id = p.station_id
   AND b.business_unit_id = p.business_unit_id AND b.product_id = p.product_id
), days AS (
  SELECT s.*, s.as_of_date + g.day_offset AS projected_date
  FROM stock s
  CROSS JOIN LATERAL generate_series(0, s.horizon_days - 1) AS g(day_offset)
), inbound AS (
  SELECT v.tenant_id, v.station_id, v.business_unit_id, v.product_id,
         (v.expected_delivery_at AT TIME ZONE 'Europe/Istanbul')::date AS arrival_date,
         SUM(v.open_inbound_qty) AS arrival_qty
  FROM market.v_open_supply v CROSS JOIN params p
  WHERE v.tenant_id = p.tenant_id AND v.station_id = p.station_id
    AND v.business_unit_id = p.business_unit_id AND v.product_id = p.product_id
    AND v.purchase_order_id = ANY(CAST(:confirmed_purchase_order_ids AS uuid[]))
    AND v.expected_delivery_at IS NOT NULL
    AND (v.expected_delivery_at AT TIME ZONE 'Europe/Istanbul')::date >= p.as_of_date
    AND (v.expected_delivery_at AT TIME ZONE 'Europe/Istanbul')::date < p.as_of_date + p.horizon_days
  GROUP BY v.tenant_id, v.station_id, v.business_unit_id, v.product_id,
           (v.expected_delivery_at AT TIME ZONE 'Europe/Istanbul')::date
), projected AS (
  SELECT d.*, COALESCE(i.arrival_qty, 0) AS arrivals_today,
         SUM(COALESCE(i.arrival_qty, 0)) OVER (
           ORDER BY d.projected_date ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
         ) AS arrivals_to_date,
         d.forecast_daily_qty * (d.projected_date - d.as_of_date + 1) AS demand_to_date
  FROM days d
  LEFT JOIN inbound i ON i.tenant_id = d.tenant_id AND i.station_id = d.station_id
                     AND i.business_unit_id = d.business_unit_id
                     AND i.product_id = d.product_id AND i.arrival_date = d.projected_date
)
SELECT projected_date, on_hand_good_qty, reserved_qty, usable_now,
       arrivals_today, arrivals_to_date, demand_to_date,
       CASE WHEN usable_now IS NULL OR forecast_daily_qty IS NULL OR stock_integrity_issue
            THEN NULL ELSE usable_now + arrivals_to_date - demand_to_date END AS projected_end_qty,
       CASE WHEN forecast_daily_qty > 0 THEN usable_now / forecast_daily_qty ELSE NULL END AS coverage_days,
       CASE WHEN usable_now IS NULL OR forecast_daily_qty IS NULL THEN 'MISSING_INPUT'
            WHEN stock_integrity_issue THEN 'STOCK_INTEGRITY_REVIEW'
            WHEN usable_now + arrivals_to_date - demand_to_date < 0 THEN 'STOCKOUT_RISK'
            ELSE 'OK' END AS stock_risk,
       snapshot_at
FROM projected
ORDER BY projected_date;

-- SQL-2: Legal-company supplier credit risk. This is COMPANY-WIDE accounting.
-- Do not remove other station accounts because the caller only sells at one station.
-- Instead return an authorized redacted company-summary, or reject access.
-- Required gates are obtained by trusted service checks, NOT user/prompt input:
-- :ap_snapshot_complete boolean; :amount_basis_verified boolean;
-- :unmapped_exposure_detected boolean; :proposal_complete boolean.
-- v1.4 unbilled view uses unit_price_minor: real credit checks need the same
-- gross/net basis as AP and supplier limit, including VAT/discount/shipping.
-- Active-link attribution is pilot-only when ownership has not changed;
-- historical financial items must use immutable company snapshots in production.

WITH params AS (
 SELECT CAST(:tenant_id AS uuid) tenant_id, CAST(:company_id AS uuid) company_id,
        CAST(:recommendation_run_id AS uuid) run_id, CAST(:as_of_date AS date) as_of_date
), accounts AS (
 SELECT a.* FROM market.company_supplier_accounts a CROSS JOIN params p
 WHERE a.tenant_id=p.tenant_id AND a.company_id=p.company_id
), links AS (
 SELECT l.* FROM market.company_supplier_account_station_links l CROSS JOIN params p
 WHERE l.tenant_id=p.tenant_id AND l.company_id=p.company_id
   AND l.valid_from <= p.as_of_date AND (l.valid_to IS NULL OR l.valid_to > p.as_of_date)
), ap AS (
 SELECT l.tenant_id,l.company_supplier_account_id,l.currency_code,
        SUM(i.open_amount_minor) open_ap_minor,
        SUM(i.open_amount_minor) FILTER (WHERE i.due_date < p.as_of_date) overdue_minor,
        COUNT(*) FILTER (WHERE i.due_date IS NULL AND i.open_amount_minor>0) unknown_due_count
 FROM links l JOIN market.supplier_ap_open_items i
   ON i.tenant_id=l.tenant_id AND i.supplier_account_id=l.local_supplier_account_id
  AND i.currency_code=l.currency_code CROSS JOIN params p
 WHERE i.status IN ('OPEN','DISPUTED')
 GROUP BY l.tenant_id,l.company_supplier_account_id,l.currency_code
), commitments AS (
 SELECT l.tenant_id,l.company_supplier_account_id,l.currency_code,
        SUM(v.commitment_minor) commitment_minor
 FROM links l JOIN market.v_unbilled_commitments v
   ON v.tenant_id=l.tenant_id AND v.station_id=l.station_id
  AND v.business_unit_id=l.business_unit_id
  AND v.supplier_account_id=l.local_supplier_account_id AND v.currency_code=l.currency_code
 GROUP BY l.tenant_id,l.company_supplier_account_id,l.currency_code
), proposal AS (
 SELECT v.* FROM market.v_recommendation_cost_by_company_account v CROSS JOIN params p
 WHERE v.tenant_id=p.tenant_id AND v.company_id=p.company_id AND v.recommendation_run_id=p.run_id
), proposal_quality AS (
 SELECT COUNT(*) FILTER (WHERE line.supplier_account_id IS NULL
                         OR line.estimated_cost_minor IS NULL
                         OR line.currency_code IS NULL OR l.link_id IS NULL) missing_line_count,
        COUNT(*) line_count
 FROM params p
 JOIN market.recommendation_runs run
   ON run.tenant_id=p.tenant_id AND run.company_id=p.company_id AND run.recommendation_run_id=p.run_id
 JOIN market.recommendation_run_batches rb
   ON rb.tenant_id=run.tenant_id AND rb.recommendation_run_id=run.recommendation_run_id AND rb.company_id=run.company_id
 JOIN market.recommendation_lines line
   ON line.tenant_id=rb.tenant_id AND line.recommendation_batch_id=rb.recommendation_batch_id
  AND line.station_id=rb.station_id AND line.business_unit_id=rb.business_unit_id
 LEFT JOIN links l
   ON l.tenant_id=line.tenant_id AND l.station_id=line.station_id
  AND l.business_unit_id=line.business_unit_id AND l.local_supplier_account_id=line.supplier_account_id
  AND l.currency_code=line.currency_code
), limits AS (
 SELECT DISTINCT ON (c.tenant_id,c.company_supplier_account_id,c.currency_code) c.*
 FROM market.company_supplier_credit_profiles c CROSS JOIN params p
 WHERE c.tenant_id=p.tenant_id AND c.company_id=p.company_id
   AND c.valid_from <= p.as_of_date AND (c.valid_to IS NULL OR c.valid_to >= p.as_of_date)
 ORDER BY c.tenant_id,c.company_supplier_account_id,c.currency_code,c.valid_from DESC
), calc AS (
 SELECT a.company_supplier_account_id,a.account_code,a.supplier_party_id,a.currency_code,a.account_status,
        COALESCE(ap.open_ap_minor,0) open_ap_minor,COALESCE(ap.overdue_minor,0) overdue_minor,
        COALESCE(ap.unknown_due_count,0) unknown_due_count,
        COALESCE(c.commitment_minor,0) commitment_minor,
        COALESCE(pr.proposed_cost_minor,0) proposed_cost_minor,l.credit_limit_minor,
        l.credit_limit_minor - COALESCE(ap.open_ap_minor,0) - COALESCE(c.commitment_minor,0)
                            - COALESCE(pr.proposed_cost_minor,0) AS remaining_estimate_minor,
        CAST(:ap_snapshot_complete AS boolean) IS TRUE
          AND CAST(:proposal_complete AS boolean) IS TRUE
          AND CAST(:unmapped_exposure_detected AS boolean) IS FALSE
          AND q.missing_line_count=0 AND q.line_count>0 AS data_complete,
        CAST(:amount_basis_verified AS boolean) IS TRUE AS same_amount_basis
 FROM accounts a CROSS JOIN proposal_quality q
 LEFT JOIN ap ON ap.tenant_id=a.tenant_id AND ap.company_supplier_account_id=a.company_supplier_account_id AND ap.currency_code=a.currency_code
 LEFT JOIN commitments c ON c.tenant_id=a.tenant_id AND c.company_supplier_account_id=a.company_supplier_account_id AND c.currency_code=a.currency_code
 LEFT JOIN proposal pr ON pr.tenant_id=a.tenant_id AND pr.company_supplier_account_id=a.company_supplier_account_id AND pr.currency_code=a.currency_code
 LEFT JOIN limits l ON l.tenant_id=a.tenant_id AND l.company_supplier_account_id=a.company_supplier_account_id AND l.currency_code=a.currency_code
)
SELECT *, CASE WHEN data_complete AND same_amount_basis THEN remaining_estimate_minor ELSE NULL END AS usable_remaining_minor,
 ARRAY_REMOVE(ARRAY[
   CASE WHEN NOT data_complete THEN 'INCOMPLETE_EXPOSURE' END,
   CASE WHEN NOT same_amount_basis THEN 'AMOUNT_BASIS_UNKNOWN' END,
   CASE WHEN credit_limit_minor IS NULL THEN 'UNKNOWN_LIMIT' END,
   CASE WHEN data_complete AND same_amount_basis AND remaining_estimate_minor<0 THEN 'LIMIT_RISK' END,
   CASE WHEN overdue_minor>0 THEN 'OVERDUE' END,
   CASE WHEN unknown_due_count>0 THEN 'UNKNOWN_DUE_DATE' END,
   CASE WHEN account_status<>'ACTIVE' THEN 'ACCOUNT_ON_HOLD_OR_CLOSED' END
 ],NULL) AS risk_codes
FROM calc;

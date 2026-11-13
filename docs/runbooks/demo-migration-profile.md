# DEMO migration profile

The `istasyonos-demo` target is intentionally separate from `DATABASE_URL`,
the migration-trial profile, and the OESSE app-trial profile.

## Fail-closed identity checks

The profile is disabled unless `STATIONOS_DEMO_MIGRATION_ENABLED=true` and
all dedicated profile values are present in the migrator process environment:

- `STATIONOS_DEMO_MIGRATION_HOST` must be `127.0.0.1`.
- `STATIONOS_DEMO_MIGRATION_PORT` must be `3306`.
- `STATIONOS_DEMO_MIGRATION_USER` must be `stationos_demo_migrator`.
- `STATIONOS_DEMO_MIGRATION_EXPECTED_CURRENT_USER` must be
  `stationos_demo_migrator@127.0.0.1`.
- `STATIONOS_DEMO_MIGRATION_EXPECTED_SERVER_UUID` must be the operator-verified
  UUID for `DESKTOP-LPUUGML`.
- `STATIONOS_DEMO_MIGRATION_PASSWORD` is required and must never be logged.

On the same physical MySQL connection, the migrator checks `DATABASE()`,
`@@hostname`, `@@port`, `@@server_uuid`, `CURRENT_USER()`, `CURRENT_ROLE()` and
`SHOW GRANTS`. Active roles, broad/global grants other than `USAGE`, missing or
extra table grants, a changed endpoint, or a changed identity stop the run.
There is no `DATABASE_URL` fallback. The exact manifest and pending set must
match canonical migrations 0018, 0019 and 0020. Baseline is prohibited for this
profile. Status is read-only; apply also requires both generic `--apply` and
profile-specific `--confirm-demo-migration-apply` acknowledgments.

## Operational gate

This profile does not create its MySQL account or grants. Those require separate
operator authorization and must be limited to `istasyonos_demo`. Do not put
credentials in source control or print them. The existing `.env` and
`DATABASE_URL` are not modified or used by this profile.

Before status, the operator must have a verified, restricted migration account
and must repeat the backup, target, migration-history, checksum, schema and
cross-tenant preflight. A status result with anything other than exactly three
pending migrations is a stop condition. Status does not itself authorize apply.

An apply failure may leave partial DDL because MySQL can implicitly commit DDL.
Do not retry, roll back, baseline or continue automatically. Preserve the
database and inspect migration guards, native history and schema on the same
target before a separately approved recovery decision.

No account, grant, backup restore, migration, seed, or financial write was
performed while preparing this profile.

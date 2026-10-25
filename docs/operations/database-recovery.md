# Cloudflare D1 Recovery

Run a restore drill quarterly and before a major schema release is promoted to production. Never test by restoring over staging or production.

## Recovery Objectives

- Recovery point objective (RPO): 24 hours for an application export; use Cloudflare D1 Time Travel for a more recent recovery point when available.
- Recovery time objective (RTO): four hours from incident declaration to a verified replacement database.
- Production restoration requires the platform owner to record the incident, recovery point, control totals, and acceptance decision.

## Daily Verification

The scheduled Worker runs one D1 recovery-readiness check per UTC day. It records an immutable `D1_RECOVERY_CHECK_PASSED` or `D1_RECOVERY_CHECK_FAILED` audit event containing:

- SQLite quick-check result and foreign-key violations.
- Organization, user, employee, attendance-event, timesheet, and audit totals.
- Active platform-owner count, which must equal one.
- Latest attendance-event timestamp.

Failures create an in-app notification for the active platform owner and a structured Worker error log. DEV_ADMIN can view the latest check and restore drill under Organization Settings.

## Isolated Restore Drill

1. Create a fresh database that is not bound to any Worker: `npx wrangler d1 create employee-attendance-recovery-drill --location apac`.
2. Ensure the database contains zero application tables.
3. Run `npm run d1:recovery:drill`.
4. The script applies the reviewed migrations to the empty target, exports staging data to a temporary ignored file, imports it in foreign-key-safe order, runs the D1-supported quick check and foreign-key check, and compares control totals.
5. The temporary SQL export is deleted in a `finally` block, even when the drill fails.
6. A successful drill is recorded as `D1_RECOVERY_DRILL_PASSED` in staging audit history, and a count-only report is saved under `docs/operations/recovery-drills/`.
7. Delete the isolated recovery database after reviewing the evidence so duplicate account and attendance data is not retained.

Override database names only when deliberately testing another non-production source or target: `D1_DRILL_SOURCE=source-name D1_DRILL_TARGET=fresh-target-name npm run d1:recovery:drill`.

## Production Incident Procedure

1. Disable the affected write path or deploy maintenance mode if integrity is uncertain.
2. Record the current database identifier, Time Travel bookmark, UTC incident time, and control totals.
3. Prefer restoring or copying into a new D1 database. Do not overwrite the original evidence first.
4. Validate migrations, `PRAGMA quick_check`, `PRAGMA foreign_key_check`, control totals, latest attendance timestamps, and representative audit records.
5. Bind a temporary Worker to the restored database and perform read-only login and attendance checks.
6. Change the production binding only after the platform owner accepts the restored database.
7. Verify readiness, tenant isolation, login, attendance, leave, payroll, and export workflows before restoring writes.
8. Retain the incident report but delete SQL exports and temporary databases according to the data-retention policy.

## Test Data Hygiene

- Every organization is explicitly marked as `Live` or `Test` when created.
- Test organizations remain fully functional for attendance, leave, and payroll acceptance testing, but are identified separately in platform counts and organization selectors.
- Real customer data must never be copied into a test organization without documented approval and equivalent access controls.
- Before onboarding the first real customer, confirm that their organization is marked `Live`, test credentials are not reused, and platform recovery totals distinguish live from test organizations.
- Deleting a test organization is a separately approved destructive operation. Export required evidence first, revoke sessions, verify the organization identifier, and rely on database cascades only after reviewing affected-row totals.

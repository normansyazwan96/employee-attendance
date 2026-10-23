# Release Checklist

## Before Staging

- Confirm CI passes type checking, lint, unit tests, integration tests, build, and Playwright.
- Confirm all migrations are additive and the prior application version remains compatible.
- Confirm the staging Neon branch was refreshed from production immediately before rehearsal.
- Confirm staging uses its own Hyperdrive, queues, secrets, and Worker environment. If R2 is unavailable, confirm the R2 binding is omitted and `FEATURE_PAYROLL` is `false`.

## Staging Acceptance

- Apply migrations using the direct staging Neon URL.
- Check `/api/v2/health/live` and `/api/v2/health/ready`.
- Run employee clock, break, retry, leave, correction, manager approval, payroll lock, CSV, and XLSX journeys.
- Run tenant-isolation integration tests and verify no organization can read or modify another.
- Run `powershell -ExecutionPolicy Bypass -File scripts/load/run-staging-rehearsal.ps1` with 100 isolated staging users. The wrapper temporarily rotates the staging JWT secret, always installs a fresh final secret, and removes test data. Release threshold: zero failed actions and p95 below 2.5 seconds.
- Review Cloudflare request logs, queue retries, dead-letter queues, Sentry, and Neon connection metrics.

## Production

- Deploy the exact staging-tested commit through the protected production environment.
- Apply direct-connection migrations before Worker deployment.
- Verify login, refresh, logout, one employee clock journey, one manager approval, and one administrator report.
- Monitor availability, p95 latency, 5xx rate, authentication failures, database connections, and queue failures for at least 30 minutes.
- Disable the affected feature flag and redeploy the last known-good commit if thresholds regress.

## Current External Setup

- Cloudflare Queues: provisioned for production and staging.
- Production Hyperdrive: provisioned and bound.
- Neon staging branch, migrations, Hyperdrive, and Worker secrets: provisioned and integration-tested.
- Production deployment: Cloudflare Worker version `dcde6647-8571-44d8-aabe-a758c786a5bb` is live; `/api/v1/health`, `/api/v2/health/live`, and `/api/v2/health/ready` return 200.
- Production database: all 23 migrations are applied. Every tenant user has an organization membership, legacy attendance was backfilled into immutable events and timesheets, and immutable triggers are enabled.
- Recovery point: no-compute Neon branch `pre-upgrade-2026-10-23` (`br-polished-meadow-b31gvijb`) captures production immediately before the upgrade and expires on 2026-10-31 at 15:00 UTC.
- Vercel rollback: retain `https://employee-attendance-api-ruby.vercel.app` through at least 2026-10-30 while Cloudflare production is monitored; retire it only after the observation window is clean.
- Cloudflare R2 and payroll exports: intentionally deferred to stay on the free tier. Both staging and production omit the R2 binding and set `FEATURE_PAYROLL=false`; Phases 1-5 remain deployable without a storage subscription.
- Staging load rehearsal on 2026-10-23: passed on Neon's fixed 0.25 CU compute with 100 simultaneous clock-ins, zero failures, and 2.23-second p95. The final fix kept one request-scoped database connection and replaced cross-employee serializable transactions with read-committed transactions protected by the existing per-employee advisory lock. The wrapper rotated the staging key afterward and removed all generated data.
- Custom domain: requires the chosen domain name and DNS zone.
- Resend: requires a verified sender and `RESEND_API_KEY`.
- Sentry: requires a project `SENTRY_DSN`.
- GitHub readiness monitor: workflow is included and becomes active after the changes reach the default branch; configure repository Actions failure notifications for the operations owner.
- Dependency audit: the only current high advisory is confined to the trusted Prisma build CLI and is documented in `docs/security/dependency-exceptions.md`; it is not part of the Worker runtime bundle.

# Release Checklist

## Before Staging

- Confirm CI passes type checking, lint, unit tests, integration tests, build, and Playwright.
- Confirm all migrations are additive and the prior application version remains compatible.
- Confirm staging uses its own D1 database, Durable Object, queues, secrets, and Worker environment.
- If R2 is unavailable, confirm the R2 binding is omitted and asynchronous stored exports are not offered.

## Staging Acceptance

- Apply and validate migrations with `npm run d1:migrate:staging` and `npm run d1:validate:staging`.
- Check `/api/v2/health/live` and `/api/v2/health/ready`.
- Run employee clock, break, retry, leave, correction, manager approval, payroll lock, CSV, and XLSX journeys.
- Run tenant-isolation integration tests and verify no organization can read or modify another.
- Run `powershell -ExecutionPolicy Bypass -File scripts/load/run-staging-rehearsal.ps1` with 100 isolated staging users. The wrapper temporarily rotates the staging JWT secret, always installs a fresh final secret, and removes test data. Release threshold: zero failed actions and p95 below 2.5 seconds.
- Review Cloudflare request logs, D1 metrics, queue retries, and dead-letter queues.

## Production

- Deploy the exact staging-tested commit through the protected production environment.
- Apply and validate production D1 migrations before Worker deployment.
- Verify login, refresh, logout, one employee clock journey, one manager approval, and one administrator report.
- Monitor availability, p95 latency, 5xx rate, authentication failures, D1 errors, and queue failures for at least 30 minutes.
- Disable the affected feature flag and redeploy the last known-good commit if thresholds regress.

## Current External Setup

- Cloudflare Queues: provisioned for production and staging.
- Production and staging D1 databases: provisioned in APAC with 42 application tables and immutable-history triggers.
- Production deployment: Cloudflare Worker version `abda5496-8767-444b-b445-f2ac0ed7f8d2` is live; `/api/v2/health/live` and `/api/v2/health/ready` return 200.
- Production database: D1 is authoritative with exactly seven active users across two isolated organizations and zero foreign-key violations.
- Database rollback: use the pre-release D1 Time Travel bookmark recorded in the release evidence. Neon `main` remains unchanged and disconnected from the Workers during the temporary cutover-retention window.
- Application rollback: use Cloudflare Worker deployment history. The former Vercel deployment and origin were retired on 2026-10-25.
- Cloudflare R2: intentionally deferred to stay on the free tier. Direct payroll downloads remain available; asynchronous stored exports remain unavailable.
- The optimized D1-native rehearsal completed 100 of 100 clock-ins with no failures and improved p95 from 4.382 seconds to 2.105 seconds. Idempotent replay, break start, break end, and clock-out also passed; the 2.5-second performance gate is satisfied.
- The staging rehearsal cleanup returns D1 to 2 organizations, 8 users, 4 employees, 599 attendance events, and zero tagged rehearsal accounts. Scheduled attendance processing has created 163 current timesheets.
- Organization Settings includes a bilingual setup checklist and Test/Live organization label.
- Custom domain: requires the chosen domain name and DNS zone.
- Resend: requires a verified sender and `RESEND_API_KEY`.
- Error monitoring: Cloudflare structured Worker logs and request IDs are the supported monitoring path; Sentry is intentionally not used.
- GitHub readiness monitor: workflow is included and becomes active after the changes reach the default branch; configure repository Actions failure notifications for the operations owner.
- Cloudflare observability: persistent structured Worker and invocation logs are enabled at full sampling for staging and production configuration.
- Dependency audit: the only current high advisory is confined to the trusted Prisma build CLI and is documented in `docs/security/dependency-exceptions.md`; it is not part of the Worker runtime bundle.

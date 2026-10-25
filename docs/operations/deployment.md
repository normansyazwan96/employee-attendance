# Deployment Runbook

## Environments

| Environment | Cloudflare Worker | Database | Purpose |
| --- | --- | --- | --- |
| Development | local Wrangler or Node process | local D1 or PostgreSQL | daily development |
| Staging | `employee-attendance-staging` | Cloudflare D1 staging | migration rehearsal and acceptance testing |
| Production | `employee-attendance` | Cloudflare D1 production | customer traffic |

Runtime database traffic uses the `DB` D1 binding. D1 migrations are applied with Wrangler before the Worker is deployed.

## Required GitHub Environments And Secrets

Create GitHub environments named `staging` and `production`. Add required reviewers to `production` and prevent self-review where the GitHub plan supports it.

Add these secrets to the corresponding environment:

- `CLOUDFLARE_API_TOKEN`: scoped to Workers Scripts and required bindings in the Floweaversolutions account.
- `CLOUDFLARE_ACCOUNT_ID`: the Floweaversolutions Cloudflare account ID.

Set `JWT_SECRET` as a Cloudflare Worker secret separately for each Worker. D1 database IDs are non-secret resource identifiers in the Wrangler file.

Also configure `MFA_ENCRYPTION_KEY`. If `WEBHOOK_URL` is set, configure a separate random `WEBHOOK_SECRET` of at least 32 characters; webhook delivery fails closed when the secret is missing or too short. Configure `RESEND_API_KEY`, `EMAIL_FROM`, and `SENTRY_DSN` only after those external services have been created. R2 must be enabled before deploying a configuration that binds `PAYROLL_EXPORTS`.

## Release Process

1. Merge a reviewed change to `main` after CI passes.
2. The staging workflow applies migrations, deploys the staging Worker, and leaves production unchanged.
3. Verify `/api/v2/health/live` and `/api/v2/health/ready` on staging.
4. Run the smoke and end-to-end suites against staging.
5. Start the production workflow with the exact tested commit SHA.
6. Approve the protected `production` environment deployment.
7. Confirm the production readiness endpoint, login, clock-in eligibility, and administrator attendance view.
8. Monitor error rate, latency, database connections, and authentication failures for at least 30 minutes.

Do not deploy production until staging D1 migrations, readiness, login, tenant isolation, and representative write paths pass. When R2 is unavailable, omit the `PAYROLL_EXPORTS` binding; direct payroll downloads remain available, while asynchronous private-file exports remain unavailable. A successful Wrangler dry run validates the bundle shape but does not prove that referenced resources exist.

## Migration Rules

All production schema changes use expand-contract deployment:

1. **Expand:** add nullable columns, new tables, and compatible indexes. Do not remove or rename fields used by the live application.
2. **Migrate:** backfill in restartable batches and reconcile counts or totals.
3. **Switch:** deploy code that reads the new structure while temporarily dual-writing both structures.
4. **Contract:** remove legacy fields only in a later release after monitoring and a confirmed rollback window.

Every migration must be rehearsed on staging D1 and included in an isolated D1 restore drill before production approval. Review the SQL for table rewrites, long locks, destructive statements, and required backfills.

## Application Rollback

1. Stop the release if readiness or smoke checks fail.
2. Redeploy the last known-good Git commit to the same Worker.
3. Do not automatically reverse a successful database migration. Expand migrations must remain compatible with the prior application version.
4. If data was written incorrectly, disable the affected feature flag and follow the database recovery procedure.

## Deployment Rollback

Vercel was retired on 2026-10-25. Roll back application releases through Cloudflare Worker deployment history using the last verified Worker version; do not reintroduce the retired Vercel origin or credentials.

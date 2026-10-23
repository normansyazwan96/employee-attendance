# Deployment Runbook

## Environments

| Environment | Cloudflare Worker | Database | Purpose |
| --- | --- | --- | --- |
| Development | local Wrangler or Node process | local PostgreSQL | daily development |
| Staging | `employee-attendance-staging` | Neon staging branch | migration rehearsal and acceptance testing |
| Production | `employee-attendance` | Neon production branch | customer traffic |

Runtime database traffic uses Cloudflare Hyperdrive. Migrations must use the direct, non-pooled Neon connection.

## Required GitHub Environments And Secrets

Create GitHub environments named `staging` and `production`. Add required reviewers to `production` and prevent self-review where the GitHub plan supports it.

Add these secrets to the corresponding environment:

- `CLOUDFLARE_API_TOKEN`: scoped to Workers Scripts and required bindings in the Floweaversolutions account.
- `CLOUDFLARE_ACCOUNT_ID`: the Floweaversolutions Cloudflare account ID.
- `NEON_STAGING_DIRECT_DATABASE_URL`: direct connection for the Neon staging branch.
- `NEON_PRODUCTION_DIRECT_DATABASE_URL`: direct connection for the Neon production branch.

Set `DATABASE_URL` and `JWT_SECRET` as Cloudflare Worker secrets separately for each Worker. Never store connection strings in the Wrangler file or repository.

Also configure `MFA_ENCRYPTION_KEY`. Configure `RESEND_API_KEY`, `EMAIL_FROM`, and `SENTRY_DSN` only after those external services have been created. R2 must be enabled before deploying a configuration that binds `PAYROLL_EXPORTS`.

## Release Process

1. Merge a reviewed change to `main` after CI passes.
2. The staging workflow applies migrations, deploys the staging Worker, and leaves production unchanged.
3. Verify `/api/v2/health/live` and `/api/v2/health/ready` on staging.
4. Run the smoke and end-to-end suites against staging.
5. Start the production workflow with the exact tested commit SHA.
6. Approve the protected `production` environment deployment.
7. Confirm the production readiness endpoint, login, clock-in eligibility, and administrator attendance view.
8. Monitor error rate, latency, database connections, and authentication failures for at least 30 minutes.

Do not deploy production while the staging Neon branch or staging Hyperdrive is missing. When R2 is unavailable, omit the `PAYROLL_EXPORTS` binding and keep both `FEATURE_PAYROLL=false` and `VITE_FEATURE_PAYROLL=false`; do not activate payroll routes, navigation, queue processing, or exports until both private buckets exist. A successful Wrangler dry run validates the bundle shape but does not prove that referenced resources exist.

## Migration Rules

All production schema changes use expand-contract deployment:

1. **Expand:** add nullable columns, new tables, and compatible indexes. Do not remove or rename fields used by the live application.
2. **Migrate:** backfill in restartable batches and reconcile counts or totals.
3. **Switch:** deploy code that reads the new structure while temporarily dual-writing both structures.
4. **Contract:** remove legacy fields only in a later release after monitoring and a confirmed rollback window.

Every migration must be rehearsed on a Neon branch copied from production. Review the generated SQL for table rewrites, long locks, destructive statements, and required backfills before approval.

## Application Rollback

1. Stop the release if readiness or smoke checks fail.
2. Redeploy the last known-good Git commit to the same Worker.
3. Do not automatically reverse a successful database migration. Expand migrations must remain compatible with the prior application version.
4. If data was written incorrectly, disable the affected feature flag and follow the database recovery procedure.

## Vercel Retirement

Keep the Vercel deployment as a rollback target until the custom Cloudflare domain has served seven consecutive days without a critical incident. Then remove Vercel environment secrets, disable its production deployment, and archive `vercel.json` in a separate cleanup change.

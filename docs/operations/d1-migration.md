# Cloudflare D1 migration

The attendance system completed its application database cutover from Neon PostgreSQL to Cloudflare D1 on 2026-10-24. Neon is retained unchanged as a rollback source for 30 days and is not bound to either deployed Worker.

## Resources

| Environment | D1 database | Binding | Status |
| --- | --- | --- | --- |
| Development | `employee-attendance-development` | tooling only | available |
| Staging | `employee-attendance-staging` | `DB` | authoritative |
| Production | `employee-attendance-production` | `DB` | authoritative |

All three D1 databases are in the Floweaver Solutions Cloudflare account and use the APAC location hint.

Both deployed Workers use Prisma's D1 adapter. A Durable Object serializes mutating requests, while D1 constraints, idempotency keys, and immutable-history triggers protect application invariants.

## Current status

Completed on 2026-10-24:

- Created isolated development, staging, and production D1 databases.
- Applied the 42-table schema, including the Malaysian holiday catalogue, and immutable-history guards to staging and production.
- Removed Hyperdrive from the deployed Workers and made D1 authoritative.
- Added a Durable Object write coordinator for mutating requests.
- Reset production to exactly one dev admin, two organization administrators, and four employees.
- Verified all seeded logins, tenant isolation, representative writes, and zero foreign-key violations.
- Deleted temporary SQL and plaintext credential files after verification.

## Schema workflow

`prisma/schema.prisma` remains the transition source of truth. `npm run d1:generate` converts all models into:

- `apps/api/src/d1/schema.ts` for Drizzle queries and types.
- `d1/migrations/0000_postgres_baseline.sql` for the initial D1 schema.

The generated baseline uses Unix epoch milliseconds for timestamps and JSON text for PostgreSQL JSON and array columns. D1-specific integrity triggers live in later hand-written migrations and must not be overwritten by the generator.

Run locally before either remote environment:

```text
npm run d1:generate
npm run d1:check
npm run d1:migrate:local
npm run d1:validate:local
```

Apply remote migrations only after local validation:

```text
npm run d1:migrate:development
npm run d1:validate:development
npm run d1:migrate:staging
npm run d1:validate:staging
npm run d1:migrate:production
npm run d1:validate:production
```

## Staging data rehearsal

The staging export converts PostgreSQL values into D1-compatible SQL without changing Neon. Generated files are ignored because the SQL contains password and session hashes.

```text
# Set DATABASE_URL to the direct Neon staging connection for this process only.
npm run d1:export:staging
npm run d1:import:staging
npm run d1:reconcile:staging
npm run d1:validate:staging
```

Delete `d1/data/staging-import.sql` immediately after successful reconciliation. The manifest contains only table counts and hashes and may be retained temporarily for the rehearsal record.

## Safety rules

- Never copy secrets into D1 or migration files.
- Preserve the immutable audit, attendance-event, payroll-adjustment, decision, and statement-delivery triggers.
- Keep Neon unchanged for 30 days after cutover.
- Prisma's D1 adapter does not provide rollback-capable interactive transactions. Use D1 `batch()` for new multi-query workflows whose statements can be prepared in advance.

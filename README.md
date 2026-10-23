# Employee Attendance

A mobile-first, multi-company attendance system for Malaysian SMEs. It includes GPS clocking and breaks, effective-dated schedules, timesheets and exceptions, leave and correction approvals, manager scopes, secure sessions and administrator 2FA, immutable audit history, queued webhooks, and English/Bahasa Malaysia interfaces. Payroll-ready CSV/XLSX export support is implemented but remains disabled until private R2 storage is enabled.

## Architecture

```text
employee-attendance/
├── apps/
│   ├── web/        React + Vite mobile-first client
│   └── api/        Express REST API
├── packages/
│   └── shared/     Shared Zod contracts and TypeScript types
├── cloudflare/     Cloudflare Worker entry point
├── docs/           Architecture and operations runbooks
├── prisma/         Schema and additive migrations
└── scripts/        Release and load-test utilities
```

## Technology stack

- React, TypeScript, Vite, Tailwind CSS, React Router
- Node.js, Express, Zod
- Neon PostgreSQL, Prisma ORM, Cloudflare Hyperdrive
- Cloudflare Workers, Queues, R2, scheduled jobs, and rate limiting
- Vitest, Playwright, ESLint

## Prerequisites

- Node.js 20 or newer (includes npm)
- A PostgreSQL database, either local or a Neon development branch

## Installation

```bash
cd employee-attendance
copy .env.example .env
npm install
```

On macOS/Linux use `cp .env.example .env` instead. Update `DATABASE_URL` only if you change the local PostgreSQL defaults.

## Database

Start PostgreSQL locally:

```bash
docker compose up -d
npm run db:generate
npm run db:migrate -- --name init-auth
```

To create the three local seed accounts, set unique `SEED_DEV_ADMIN_PASSWORD`, `SEED_ADMIN_PASSWORD`, and `SEED_EMPLOYEE_PASSWORD` values in `.env`, then run `npm run db:seed`. Each password must be at least 8 characters and include uppercase, lowercase, number, and symbol characters. Seeded accounts require a password change by default; only isolated automation may set `SEED_MUST_CHANGE_PASSWORD=false`.

The schema preserves the legacy `/api/v1` records while `/api/v2` adds organization memberships, rotating sessions, attendance events, timesheet aggregates, workforce policies, leave, corrections, notifications, pay periods, immutable adjustments, and export jobs. Migrations follow expand-contract rules and must be rehearsed on a Neon branch before production.

## Local development accounts

The seed creates these accounts with the separate passwords supplied through the environment:

- `john.smith` - Employee
- `admin` - Admin
- `devadmin` - Dev Admin

Change `JWT_SECRET` in `.env` to a unique random value of at least 32 characters. Set `CLIENT_ORIGINS` to a comma-separated list of trusted web origins before production. Seeded and administrator-created users must replace their temporary password before the rest of the application becomes available.

## Attendance foundation

Employees clock in, clock out, start breaks, and end breaks using online mobile-browser GPS. Every action requires an idempotency key, uses server time, captures the accepted worksite snapshot, and is protected against concurrent submissions. Network failures keep the pending action key for a safe retry; offline or backdated punches are never accepted. Exact GPS is purged according to the organization policy, which defaults to 90 days.

The seeded Acme Local HQ worksite is at `2.9084686453776176, 101.60997566744295` with a 150 m radius. Admins can create, edit, activate, deactivate, and delete worksites from the admin dashboard, create or deactivate employees without deleting their records, and assign schedules from the same dashboard. Attendance dates use `ATTENDANCE_TIMEZONE` from `.env` and default to `UTC`.

The API uses 15-minute access tokens in memory and rotating refresh tokens in Secure, HttpOnly, SameSite cookies. It supports revocation, active sessions, password recovery, administrator and manager TOTP 2FA, account lockout, and Cloudflare rate limiting. Tenant access is resolved through active memberships and shared authorization helpers.

Attendance webhooks cover clock and break events. Cloudflare Queues provide retries, durable delivery history, and dead-letter handling. Webhook failures never roll back an accepted attendance event.

## Development

```bash
npm run dev:web     # http://localhost:5173
npm run dev:api     # http://localhost:3000
```

The employee experience uses `/employee`, `/employee/history`, and `/employee/work`. Administrator routes are split under `/admin/*`; managers use `/manager`. `/dev` redirects to the administrator workspace for compatibility. Liveness and readiness checks are available at `/api/v2/health/live` and `/api/v2/health/ready`.

## Quality checks

```bash
npm run typecheck
npm run lint
npm run test
npm run test:integration --workspace=@attendance/api
npm run build
npm run test:e2e
```

Playwright checks 320px, 375px, 390px, and 430px widths in both languages. A staging-only 100-user clock test is available through `npm run load:clock-actions`; see [the release checklist](docs/operations/release-checklist.md).

Operational details are in [the architecture guide](docs/architecture.md), [API v2 guide](docs/api-v2.md), [deployment runbook](docs/operations/deployment.md), [release checklist](docs/operations/release-checklist.md), and [database recovery runbook](docs/operations/database-recovery.md).

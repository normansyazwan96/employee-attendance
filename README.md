# Employee Attendance

A local-first, mobile-first attendance system with role-based authentication, employee clock-in/clock-out actions, GPS geofencing, attendance history, schedules, admin attendance views, worksite management, and audit logs backed by PostgreSQL/Prisma. Payroll and advanced reporting are intentionally deferred.

## Architecture

```text
employee-attendance/
├── apps/
│   ├── web/        React + Vite mobile-first client
│   └── api/        Express REST API
├── packages/
│   └── shared/     Shared Zod contracts and TypeScript types
├── prisma/         Prisma configuration
└── docker-compose.yml
```

## Technology stack

- React, TypeScript, Vite, Tailwind CSS, React Router
- Node.js, Express, Zod
- PostgreSQL in Docker Compose, Prisma ORM
- Vitest, Playwright, ESLint

## Prerequisites

- Node.js 20 or newer (includes npm)
- Docker Desktop with Docker Compose

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
npm run db:seed
```

The Prisma schema contains Client, User, Employee, EmployeeSchedule, AttendanceRecord, Worksite, and AuditLog models. Users support soft deactivation through `isActive`, so employee attendance history is retained when access is disabled. Every role can manage its own profile and password. Admin mutations are recorded in client-scoped audit logs. Admins can assign employee schedules with workdays, start/end times, grace periods, and active state. DEV_ADMIN has the full admin surface across all clients and can choose a client when creating employees. `db:generate` creates Prisma client artifacts, `db:migrate` creates the local database tables, and `db:seed` creates local development accounts and a sample worksite. Open Prisma Studio with `npm run db:studio`.

## Local development accounts

After `npm run db:seed`, all accounts use the password `ChangeMe123!`:

- `john.smith@acme.local` — Employee '12345678'
- `admin@acme.local` — Admin
- `devadmin@attendance.local` — Dev Admin

Change `JWT_SECRET` in `.env` to a unique random value of at least 32 characters. Set `CLIENT_ORIGINS` to a comma-separated list of trusted web origins before production. Seed credentials are development-only and must be changed before production use.

## Attendance foundation

Employees can clock in and clock out once per day from the Employee dashboard, then review their 30 most recent records in History. Admins can view filtered and paginated attendance for employees in their client and export the filtered results as CSV without GPS fields. The browser requests high-accuracy location permission; the API validates it against the active worksite geofence before accepting either action and records the accepted coordinates and accuracy. Attendance responses include derived schedule statuses such as on time, late, not scheduled, no schedule, and missed clock-out. The authenticated API includes `GET /api/v1/attendance/today`, `GET /api/v1/attendance/history`, `POST /api/v1/attendance/location-status`, `POST /api/v1/attendance/clock-in`, `POST /api/v1/attendance/clock-out`, `GET /api/v1/admin/attendance` with optional `from`, `to`, `page`, and `pageSize` filters, and `GET /api/v1/admin/attendance/export` with optional date filters.

The seeded Acme Local HQ worksite is at `2.9084686453776176, 101.60997566744295` with a 150 m radius. Admins can create, edit, activate, deactivate, and delete worksites from the admin dashboard, create or deactivate employees without deleting their records, and assign schedules from the same dashboard. Attendance dates use `ATTENDANCE_TIMEZONE` from `.env` and default to `UTC`.

The API validates access-token claims, enforces role and client boundaries, applies Helmet security headers, limits JSON request bodies to 100 KB, and limits repeated login attempts from one IP to 10 requests per 15-minute window. Employees and administrators can explicitly log out, and expired sessions are cleared on the next authenticated API response. The current limiter is process-local; use a shared store such as Redis before running multiple API instances.

## Development

```bash
npm run dev:web     # http://localhost:5173
npm run dev:api     # http://localhost:3000
```

Available web routes are `/login`, `/employee`, `/employee/history`, `/admin`, and `/profile`. DEV_ADMIN uses the full `/admin` surface; `/dev` redirects there for compatibility. Sign-in calls `POST http://localhost:3000/api/v1/auth/login`; dashboard routes require a signed-in account with the matching role. Profile data uses `GET /api/v1/profile` and `PATCH /api/v1/profile`. The API health endpoint is `GET http://localhost:3000/api/v1/health`, and authorized administrators can read scoped audit history from `GET /api/v1/admin/audit`.

## Quality checks

```bash
npm run typecheck
npm run lint
npm run test
npm run test:integration --workspace=@attendance/api
npm run build
npm run test:e2e
```

The Playwright configuration uses an iPhone 13 viewport. Manually inspect the employee page at 320px, 375px, 390px, and 430px widths before UI releases.

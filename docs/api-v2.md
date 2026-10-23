# API v2 Guide

All `/api/v2` responses include an `x-request-id` header. Errors use `{ error: { code, message, details? }, requestId }`. Protected endpoints use the short-lived bearer access token returned by login or refresh. Refresh tokens are sent only as Secure, HttpOnly, SameSite cookies.

Platform administrators select a tenant with `x-organization-id`. Tenant administrators and managers are always scoped by their active organization membership; a supplied organization header cannot expand their access.

## Authentication

- `POST /api/v2/auth/login`
- `POST /api/v2/auth/refresh`
- `POST /api/v2/auth/logout`
- `GET /api/v2/auth/sessions`
- `DELETE /api/v2/auth/sessions/:id`
- `POST /api/v2/auth/password-recovery`
- `POST /api/v2/auth/password-reset`
- `POST /api/v2/auth/2fa/setup`
- `POST /api/v2/auth/2fa/enable`
- `POST /api/v2/auth/2fa/verify-login`

## Attendance

Clock actions require `Idempotency-Key` and an online GPS snapshot containing latitude, longitude, and accuracy. Server time is authoritative.

- `GET /api/v2/attendance/today`
- `GET /api/v2/attendance/timesheets?from=YYYY-MM-DD&to=YYYY-MM-DD`
- `GET /api/v2/attendance/schedule/current`
- `POST /api/v2/attendance/actions/clock-in`
- `POST /api/v2/attendance/actions/clock-out`
- `POST /api/v2/attendance/actions/break-start`
- `POST /api/v2/attendance/actions/break-end`

## Workforce

- Departments: `GET|POST /api/v2/workforce/departments`
- Employees: `GET /api/v2/workforce/employees`, `PATCH /api/v2/workforce/employees/:id`
- Timesheets: `GET /api/v2/workforce/timesheets`
- Managers: `GET|POST /api/v2/workforce/managers`, report assignment and status routes
- Shifts: `GET|POST /api/v2/workforce/shift-templates`
- Assignments: `GET|POST /api/v2/workforce/schedule-assignments`
- Policy: `GET|PUT /api/v2/workforce/policy`
- Holidays: organization holidays plus Malaysian calendar preview/import routes
- Exact GPS: `GET /api/v2/workforce/attendance-events/:id/location`, authorized and audited

## Requests And Notifications

- Employee corrections: `GET|POST /api/v2/corrections`
- Employee leave: `GET /api/v2/leave`, create and cancel request routes
- Approval inbox: `GET /api/v2/workforce/approvals`
- Correction and leave review routes under `/api/v2/workforce`
- Notifications: `GET /api/v2/notifications`, `POST /api/v2/notifications/:id/read`

## Payroll

- `GET|POST /api/v2/payroll/pay-periods`
- `POST /api/v2/payroll/pay-periods/:id/transition`
- `POST /api/v2/payroll/pay-periods/:id/exports`
- `GET /api/v2/payroll/exports`
- `GET /api/v2/payroll/exports/:id/download`

Pay periods progress through draft, reviewed, approved, locked, and exported states. Locking is blocked by unresolved exceptions or pending requests. Export requests accept a validated `template.columns` array and are processed asynchronously into private R2 objects that expire after 30 days.

## Compatibility

`/api/v1` remains available during migration. Legacy clock actions atomically dual-write attendance events and timesheets and enqueue the same webhook delivery history as `/api/v2`. New clients should use `/api/v2`.

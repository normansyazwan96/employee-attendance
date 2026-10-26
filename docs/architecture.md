# System Architecture

## Runtime

The product is a modular monolith deployed as one Cloudflare Worker. Express serves `/api/v1` compatibility routes and `/api/v2` domain routes; Cloudflare Assets serves the React PWA. Cloudflare Queues run webhook and payroll export jobs, while a scheduled handler retries pending work, expires exports, removes old exact GPS coordinates, and detects attendance exceptions.

Production and staging use Cloudflare D1 through Prisma's D1 adapter. A Durable Object serializes mutating requests, and D1 constraints, idempotency keys, and immutable-history triggers protect application invariants. Neon is disconnected from the Workers and retained temporarily as a rollback source.

## Trust Boundaries

- `DEV_ADMIN` is a platform role and can select an organization explicitly.
- `ADMIN`, `MANAGER`, and `EMPLOYEE` are active organization memberships.
- An administrator manages only employees created by that administrator.
- A manager sees approvals only for memberships assigned as direct reports.
- Every organization-owned query must include the shared organization scope.
- Exact coordinates are excluded from payroll exports and ordinary employee lists.

## Attendance

`AttendanceEvent` is immutable source data. `TimesheetDay` is a recalculated daily aggregate. Clock requests require online GPS and an idempotency key, use server time, and are serialized through the database write coordinator. The legacy `AttendanceRecord` remains dual-written for `/api/v1` compatibility.

## Payroll

Pay periods move through `DRAFT`, `REVIEWED`, `APPROVED`, `LOCKED`, and `EXPORTED`. Locking is rejected while exceptions or approval requests remain. Locked timesheets are not edited; approved later corrections create `PayrollAdjustment` records. Exports are generated asynchronously and private files expire after 30 days. The system exports verified attendance inputs and does not calculate salary, tax, EPF, SOCSO, or EIS.

## Compliance Boundary

Holiday, overtime, rounding, and retention values are organization policy settings. Defaults are operational starting points, not a claim of Malaysian legal compliance. A qualified Malaysian HR or legal professional must review them before they are marketed as compliant.

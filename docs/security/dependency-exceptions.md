# Dependency Risk Exceptions

## Prisma CLI deepmerge-ts Advisory

- Recorded: 2026-10-23
- Advisory: `GHSA-ggr8-5vv4-36mx`
- Affected path: `prisma` -> `@prisma/config` -> `deepmerge-ts@7.1.5`
- Runtime exposure: none. The Prisma CLI is used only during trusted build and migration jobs; it is not bundled into the Cloudflare Worker or web application.
- Input boundary: Prisma configuration and migration sources are repository-controlled and reviewed. Untrusted users cannot provide recursive objects to the affected merge operation.
- Current action: do not force-upgrade to Prisma 7 or an 8 release candidate during this rollout. That is a breaking ORM migration with a larger availability risk.
- Required follow-up: retest and remove this exception when Prisma publishes a stable compatible release that uses `deepmerge-ts >= 8.0.0`, or by 2027-01-23, whichever comes first.

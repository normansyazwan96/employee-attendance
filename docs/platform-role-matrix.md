# Platform role matrix

| Capability | DEV_ADMIN | GLOBAL_ADMIN | ADMIN | MANAGER | EMPLOYEE |
| --- | --- | --- | --- | --- | --- |
| List organizations | Yes | Yes | Own only | No | No |
| Create or edit organizations | Yes | No | No | No | No |
| List tenant administrators | Yes | Yes, read only | No | No | No |
| Create, deactivate, or reset tenant administrators | Yes | No | No | No | No |
| Manage global administrators | Yes | No | No | No | No |
| View platform or tenant audit history | Yes | No | No | No | No |
| View webhook/system configuration | Yes | No | No | No | No |
| Enter tenant attendance, workforce, leave, worksite, and payroll areas | Yes, after selecting an organization | No | Own organization | Assigned employees | Self only |

`DEV_ADMIN` is the single owner account. `GLOBAL_ADMIN` is intended for future support staff and has read-only access to the organization and tenant-administrator directories. It cannot enter tenant operational data.

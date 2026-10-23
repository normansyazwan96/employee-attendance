# Database Recovery Drill

Perform this drill quarterly and before declaring a major schema release complete. Use a Neon restore branch; never test by rewinding the production branch.

## Preparation

1. Confirm the production branch history retention window and record it in the drill ticket.
2. Record a UTC recovery timestamp from within that window.
3. Capture expected control totals: organizations, users, attendance records, and the latest attendance timestamp.
4. Identify the incident lead and the person authorized to approve a production restore.

## Restore Drill

1. Create a new Neon branch from the selected point in time.
2. Create a temporary compute endpoint for that branch.
3. Connect using a read-only session first and verify the schema migration table.
4. Compare the control totals and inspect representative attendance and audit records.
5. Point a temporary test deployment at the restore branch and run login plus read-only attendance smoke tests.
6. Record recovery point objective achieved, elapsed recovery time, discrepancies, and corrective actions.
7. Delete the temporary deployment, endpoint, and branch after evidence has been retained.

## Production Recovery

A production restore requires an incident record and two-person approval. Prefer creating and validating a restore branch before changing any production endpoint. Freeze writes if integrity is uncertain, preserve the original branch, verify control totals, then resume traffic only after readiness and smoke checks pass.

## Drill Record

### 2026-10-23

- Source: production `main`, restored from a timestamp five minutes before the drill.
- Retention observed: 21,600 seconds (6 hours).
- Restore branch: created successfully in Singapore and removed after validation.
- Control totals: 1 organization, 6 users, and 3 legacy attendance records.
- Result: point-in-time branch creation and direct read validation passed with no orphaned drill branch.
- Remaining acceptance: repeat with a temporary application deployment and read-only login smoke test before the production release is approved.

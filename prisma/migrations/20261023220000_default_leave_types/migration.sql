INSERT INTO "LeaveType" ("id", "clientId", "code", "name", "isPaid", "defaultEntitlementMinutes", "isActive", "createdAt", "updatedAt")
SELECT 'annual_' || client."id", client."id", 'ANNUAL', 'Annual Leave', true, 0, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "Client" client
ON CONFLICT ("clientId", "code") DO NOTHING;

INSERT INTO "LeaveType" ("id", "clientId", "code", "name", "isPaid", "defaultEntitlementMinutes", "isActive", "createdAt", "updatedAt")
SELECT 'sick_' || client."id", client."id", 'SICK', 'Sick Leave', true, 0, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "Client" client
ON CONFLICT ("clientId", "code") DO NOTHING;

INSERT INTO "LeaveType" ("id", "clientId", "code", "name", "isPaid", "defaultEntitlementMinutes", "isActive", "createdAt", "updatedAt")
SELECT 'unpaid_' || client."id", client."id", 'UNPAID', 'Unpaid Leave', false, 0, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "Client" client
ON CONFLICT ("clientId", "code") DO NOTHING;

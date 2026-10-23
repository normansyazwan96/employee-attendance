import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";

const connectionString = process.env.DATABASE_URL;
const clientId = process.env.REHEARSAL_CLIENT_ID;
const expectedName = process.env.REHEARSAL_CLIENT_NAME;
const confirmation = process.env.REHEARSAL_CLEANUP_CONFIRM;

if (!connectionString || !clientId || !expectedName) throw new Error("Set DATABASE_URL, REHEARSAL_CLIENT_ID, and REHEARSAL_CLIENT_NAME");
if (confirmation !== "DELETE_VERIFIED_STAGING_REHEARSAL") throw new Error("Set REHEARSAL_CLEANUP_CONFIRM=DELETE_VERIFIED_STAGING_REHEARSAL");
if (!expectedName.startsWith("Load rehearsal ")) throw new Error("The expected organization name is not a load rehearsal");

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString, max: 2 }) });
let attendanceTriggerDisabled = false;
let attendanceUpdateTriggerDisabled = false;
let auditTriggerDisabled = false;

try {
  const client = await prisma.client.findUnique({ where: { id: clientId }, select: { id: true, name: true, users: { select: { id: true } } } });
  if (!client || client.name !== expectedName) throw new Error("The exact verified rehearsal organization was not found");
  const userIds = client.users.map((user) => user.id);

  await prisma.$executeRawUnsafe('ALTER TABLE "AttendanceEvent" DISABLE TRIGGER "AttendanceEvent_immutable_delete"');
  attendanceTriggerDisabled = true;
  await prisma.$executeRawUnsafe('ALTER TABLE "AttendanceEvent" DISABLE TRIGGER "AttendanceEvent_immutable_update"');
  attendanceUpdateTriggerDisabled = true;
  await prisma.$executeRawUnsafe('ALTER TABLE "AuditLog" DISABLE TRIGGER "AuditLog_immutable_delete"');
  auditTriggerDisabled = true;

  await prisma.$transaction(async (transaction) => {
    await transaction.auditLog.deleteMany({ where: { OR: [{ clientId }, { actorUserId: { in: userIds } }] } });
    await transaction.user.deleteMany({ where: { id: { in: userIds } } });
    const deleted = await transaction.client.deleteMany({ where: { id: clientId, name: expectedName } });
    if (deleted.count !== 1) throw new Error("The verified rehearsal organization was not deleted");
  });
  console.log(JSON.stringify({ removedClientId: clientId, removedUsers: userIds.length }));
} finally {
  try {
    if (attendanceTriggerDisabled) await prisma.$executeRawUnsafe('ALTER TABLE "AttendanceEvent" ENABLE TRIGGER "AttendanceEvent_immutable_delete"');
  } finally {
    try {
      if (attendanceUpdateTriggerDisabled) await prisma.$executeRawUnsafe('ALTER TABLE "AttendanceEvent" ENABLE TRIGGER "AttendanceEvent_immutable_update"');
    } finally {
      try {
        if (auditTriggerDisabled) await prisma.$executeRawUnsafe('ALTER TABLE "AuditLog" ENABLE TRIGGER "AuditLog_immutable_delete"');
      } finally {
        await prisma.$disconnect();
      }
    }
  }
}

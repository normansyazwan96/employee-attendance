import { PlatformRole } from "@prisma/client";
import { logger } from "./logger.js";
import { notifyUsers } from "./notifications.js";
import { isD1Database, prisma } from "./prisma.js";

export type DatabaseControlTotals = {
  organizations: number;
  liveOrganizations: number;
  testOrganizations: number;
  users: number;
  employees: number;
  attendanceEvents: number;
  timesheetDays: number;
  auditLogs: number;
  latestAttendanceEventAt: string | null;
  ownerCount: number;
  foreignKeyViolations: number;
  integrity: string;
};

type IntegrityRow = { quick_check?: string };

export function recoveryChecksPass(totals: DatabaseControlTotals): boolean {
  return totals.integrity === "ok" && totals.foreignKeyViolations === 0 && totals.ownerCount === 1;
}

export async function collectDatabaseControlTotals(): Promise<DatabaseControlTotals> {
  const [organizations, liveOrganizations, testOrganizations, users, employees, attendanceEvents, timesheetDays, auditLogs, latestEvent, owners] = await Promise.all([
    prisma.client.count(),
    prisma.client.count({ where: { isTest: false } }),
    prisma.client.count({ where: { isTest: true } }),
    prisma.user.count(),
    prisma.employee.count(),
    prisma.attendanceEvent.count(),
    prisma.timesheetDay.count(),
    prisma.auditLog.count(),
    prisma.attendanceEvent.findFirst({ select: { occurredAt: true }, orderBy: { occurredAt: "desc" } }),
    prisma.user.count({ where: { isActive: true, platformRole: PlatformRole.DEV_ADMIN } }),
  ]);
  let foreignKeyViolations = 0;
  let integrity = "not-applicable";
  if (isD1Database()) {
    const [foreignKeys, integrityRows] = await Promise.all([
      prisma.$queryRawUnsafe<Array<Record<string, unknown>>>("PRAGMA foreign_key_check"),
      prisma.$queryRawUnsafe<IntegrityRow[]>("PRAGMA quick_check"),
    ]);
    foreignKeyViolations = foreignKeys.length;
    integrity = integrityRows[0]?.quick_check ?? "unknown";
  }
  return {
    organizations,
    liveOrganizations,
    testOrganizations,
    users,
    employees,
    attendanceEvents,
    timesheetDays,
    auditLogs,
    latestAttendanceEventAt: latestEvent?.occurredAt.toISOString() ?? null,
    ownerCount: owners,
    foreignKeyViolations,
    integrity,
  };
}

export async function verifyDatabaseRecoveryReadiness(now = new Date()): Promise<void> {
  if (!isD1Database()) return;
  const dayStart = new Date(now); dayStart.setUTCHours(0, 0, 0, 0);
  const alreadyChecked = await prisma.auditLog.findFirst({ where: { action: { in: ["D1_RECOVERY_CHECK_PASSED", "D1_RECOVERY_CHECK_FAILED"] }, createdAt: { gte: dayStart } }, select: { id: true } });
  if (alreadyChecked) return;

  const owners = await prisma.user.findMany({ where: { isActive: true, platformRole: PlatformRole.DEV_ADMIN }, select: { id: true } });
  const actorUserId = owners[0]?.id;
  if (!actorUserId) {
    logger.error("d1_recovery_check_failed", { reason: "No active platform owner" });
    return;
  }

  try {
    const totals = await collectDatabaseControlTotals();
    const passed = recoveryChecksPass(totals);
    await prisma.auditLog.create({ data: { actorUserId, action: passed ? "D1_RECOVERY_CHECK_PASSED" : "D1_RECOVERY_CHECK_FAILED", entityType: "System", entityId: now.toISOString().slice(0, 10), details: totals } });
    if (!passed) {
      await notifyUsers({ userIds: owners.map((owner) => owner.id), type: "D1_RECOVERY_CHECK_FAILED", title: "Database recovery check needs attention", message: `The daily D1 quick check failed. Integrity: ${totals.integrity}; foreign-key violations: ${totals.foreignKeyViolations}; active owners: ${totals.ownerCount}.`, entityType: "System", entityId: now.toISOString().slice(0, 10) });
      logger.error("d1_recovery_check_failed", totals);
      return;
    }
    logger.info("d1_recovery_check_passed", totals);
  } catch (caught) {
    logger.error("d1_recovery_check_failed", { message: caught instanceof Error ? caught.message : "Unknown recovery-check error" });
    try {
      await notifyUsers({ userIds: owners.map((owner) => owner.id), type: "D1_RECOVERY_CHECK_FAILED", title: "Database recovery check could not run", message: "The scheduled D1 quick check could not complete. Review the Worker logs and database status.", entityType: "System", entityId: now.toISOString().slice(0, 10) });
    } catch (notificationError) {
      logger.error("d1_recovery_notification_failed", { message: notificationError instanceof Error ? notificationError.message : "Unknown notification error" });
    }
  }
}

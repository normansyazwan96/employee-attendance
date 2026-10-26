import { logger } from "./logger.js";
import { prisma } from "./prisma.js";

export async function purgeExpiredExactGps(): Promise<void> {
  const policies = await prisma.workPolicy.findMany({ select: { clientId: true, exactGpsRetentionDays: true } });
  for (const policy of policies) {
    const cutoff = new Date(Date.now() - policy.exactGpsRetentionDays * 24 * 60 * 60 * 1000);
    const result = await prisma.attendanceEvent.updateMany({
      where: { clientId: policy.clientId, occurredAt: { lt: cutoff }, OR: [{ latitude: { not: null } }, { longitude: { not: null } }, { accuracyMeters: { not: null } }] },
      data: { latitude: null, longitude: null, accuracyMeters: null },
    });
    if (result.count > 0) logger.info("exact_gps_purged", { clientId: policy.clientId, count: result.count, retentionDays: policy.exactGpsRetentionDays });
  }
}

import { WebhookDeliveryStatus, type Prisma } from "@prisma/client";
import { prisma } from "./prisma.js";
import { logger } from "./logger.js";
import { sendAttendanceWebhook, WebhookHttpError, type AttendanceWebhookPayload } from "./webhook.js";

type QueueProducer = { send(body: { deliveryId: string }): Promise<void> };

let producer: QueueProducer | undefined;

export function configureWebhookQueue(queue: QueueProducer | undefined): void {
  producer = queue;
}

export async function enqueueWebhookDelivery(deliveryId: string): Promise<void> {
  if (!producer) {
    logger.warn("webhook_queue_unavailable", { deliveryId });
    return;
  }
  try {
    await producer.send({ deliveryId });
  } catch (error) {
    logger.error("webhook_enqueue_failed", { deliveryId, error: error instanceof Error ? error.message : "Unknown queue error" });
  }
}

export async function enqueuePendingWebhookDeliveries(limit = 100): Promise<number> {
  if (!producer) return 0;
  const pending = await prisma.webhookDelivery.findMany({
    where: { status: WebhookDeliveryStatus.PENDING },
    orderBy: { createdAt: "asc" },
    take: limit,
    select: { id: true },
  });
  await Promise.all(pending.map(({ id }) => producer!.send({ deliveryId: id })));
  return pending.length;
}

export async function processWebhookDelivery(deliveryId: string): Promise<void> {
  const delivery = await prisma.webhookDelivery.findUnique({ where: { id: deliveryId } });
  if (!delivery || delivery.status === WebhookDeliveryStatus.DELIVERED || delivery.status === WebhookDeliveryStatus.DEAD_LETTER) return;

  await prisma.webhookDelivery.update({
    where: { id: delivery.id },
    data: { status: WebhookDeliveryStatus.RETRYING, attempts: { increment: 1 }, lastAttemptAt: new Date(), lastError: null },
  });
  try {
    const responseStatus = await sendAttendanceWebhook(delivery.payload as unknown as AttendanceWebhookPayload);
    await prisma.webhookDelivery.update({
      where: { id: delivery.id },
      data: { status: WebhookDeliveryStatus.DELIVERED, deliveredAt: new Date(), responseStatus, lastError: null },
    });
  } catch (error) {
    await prisma.webhookDelivery.update({
      where: { id: delivery.id },
      data: {
        status: WebhookDeliveryStatus.RETRYING,
        responseStatus: error instanceof WebhookHttpError ? error.status : null,
        lastError: (error instanceof Error ? error.message : "Unknown webhook delivery error").slice(0, 1_000),
      },
    });
    throw error;
  }
}

export async function markWebhookDeadLetter(deliveryId: string): Promise<void> {
  await prisma.webhookDelivery.updateMany({
    where: { id: deliveryId, status: { not: WebhookDeliveryStatus.DELIVERED } },
    data: { status: WebhookDeliveryStatus.DEAD_LETTER },
  });
}

export function webhookPayload(input: AttendanceWebhookPayload): Prisma.InputJsonValue {
  return input as unknown as Prisma.InputJsonValue;
}

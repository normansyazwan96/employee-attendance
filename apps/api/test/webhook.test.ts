import { afterEach, describe, expect, it, vi } from "vitest";
import { sendAttendanceWebhook, WebhookConfigurationError } from "../src/services/webhook.js";

const webhookPayload = {
  event: "attendance.clock_in" as const,
  employeeId: "emp-123",
  employeeName: "John Smith",
  workDate: "2026-09-10",
  timestamp: "2026-09-10T08:30:00.000Z",
  location: { latitude: 2.9, longitude: 101.6, accuracy: 12.5 },
};

describe("attendance webhook", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("posts a signed payload when a webhook URL is configured", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchMock);

    await sendAttendanceWebhook(webhookPayload, { url: "https://example.com/webhook", secret: "test-webhook-secret-at-least-32-characters" });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe("https://example.com/webhook");

    const request = fetchMock.mock.calls[0][1];
    expect(request.method).toBe("POST");
    expect(request.headers["Content-Type"]).toBe("application/json");
    expect(request.headers["x-webhook-signature"]).toMatch(/^sha256=/);
    expect(JSON.parse(request.body)).toMatchObject({
      event: "attendance.clock_in",
      employeeId: "emp-123",
      employeeName: "John Smith",
    });
  });

  it("refuses to deliver with an empty or short signing secret", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(sendAttendanceWebhook(webhookPayload, { url: "https://example.com/webhook", secret: "" }))
      .rejects.toBeInstanceOf(WebhookConfigurationError);
    await expect(sendAttendanceWebhook(webhookPayload, { url: "https://example.com/webhook", secret: "too-short" }))
      .rejects.toBeInstanceOf(WebhookConfigurationError);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

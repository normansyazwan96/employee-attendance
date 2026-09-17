import { afterEach, describe, expect, it, vi } from "vitest";
import { sendAttendanceWebhook } from "../src/services/webhook.js";

describe("attendance webhook", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("posts a signed payload when a webhook URL is configured", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchMock);

    await sendAttendanceWebhook({
      event: "attendance.clock_in",
      employeeId: "emp-123",
      employeeName: "John Smith",
      workDate: "2026-09-10",
      timestamp: "2026-09-10T08:30:00.000Z",
      location: { latitude: 2.9, longitude: 101.6, accuracy: 12.5 },
    }, { url: "https://example.com/webhook", secret: "super-secret" });

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
});

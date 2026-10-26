import request from "supertest";
import { describe, expect, it } from "vitest";
import { app } from "../src/app.js";

describe("GET /api/v1/health", () => {
  it("returns an ok status", async () => {
    const response = await request(app).get("/api/v1/health");
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: "ok" });
    expect(response.headers["x-content-type-options"]).toBe("nosniff");
    expect(response.headers["x-frame-options"]).toBe("SAMEORIGIN");
  });
});

describe("GET /api/v2/health/live", () => {
  it("returns an ok status and a traceable request ID", async () => {
    const response = await request(app)
      .get("/api/v2/health/live")
      .set("x-request-id", "test-request-1234");

    expect(response.status).toBe(200);
    expect(response.headers["x-request-id"]).toBe("test-request-1234");
    expect(response.body).toEqual({ status: "ok", requestId: "test-request-1234" });
  });

  it("replaces an unsafe request ID", async () => {
    const response = await request(app)
      .get("/api/v2/health/live")
      .set("x-request-id", "bad request id");

    expect(response.status).toBe(200);
    expect(response.headers["x-request-id"]).toMatch(/^[0-9a-f-]{36}$/);
  });
});

describe("unknown API v2 routes", () => {
  it("returns a structured 404 without requiring authentication", async () => {
    const response = await request(app).get("/api/v2/not-a-route");

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe("ROUTE_NOT_FOUND");
    expect(response.body.requestId).toEqual(expect.any(String));
  });
});

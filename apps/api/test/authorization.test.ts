import request from "supertest";
import { describe, expect, it } from "vitest";
import { app } from "../src/app.js";
import { createAccessToken } from "../src/utils/token.js";

describe("admin authorization boundaries", () => {
  it("rejects requests without credentials", async () => {
    const response = await request(app).get("/api/v1/admin/worksites");
    expect(response.status).toBe(401);
    expect(response.body.error).toBe("Authentication is required");
  });

  it("rejects an employee token before accessing admin data", async () => {
    const token = createAccessToken({ sub: "employee-1", username: "employee", role: "EMPLOYEE" });
    const response = await request(app).get("/api/v1/admin/worksites").set("Authorization", `Bearer ${token}`);
    expect(response.status).toBe(403);
    expect(response.body.error).toBe("You do not have access to this resource");
  });

  it("rejects malformed bearer tokens", async () => {
    const response = await request(app).get("/api/v1/admin/worksites").set("Authorization", "Bearer not-a-token");
    expect(response.status).toBe(401);
  });

  it("limits repeated login attempts", async () => {
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const response = await request(app).post("/api/v1/auth/login").send({ username: "invalid" });
      expect(response.status).toBe(400);
    }
    const response = await request(app).post("/api/v1/auth/login").send({ username: "invalid" });
    expect(response.status).toBe(429);
  });
});

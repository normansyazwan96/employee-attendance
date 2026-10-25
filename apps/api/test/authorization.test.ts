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

  it("rejects administrator access to platform audit history", async () => {
    const token = createAccessToken({ sub: "admin-1", username: "administrator", role: "ADMIN" });
    const response = await request(app).get("/api/v1/admin/audit").set("Authorization", `Bearer ${token}`);
    expect(response.status).toBe(403);
    expect(response.body.error).toBe("You do not have access to this resource");
    expect(response.body.audit).toBeUndefined();
  });

  it("rejects global administrators from tenant and audit routes", async () => {
    const token = createAccessToken({ sub: "global-1", username: "support", role: "GLOBAL_ADMIN" });
    const [worksites, audit, createOrganization] = await Promise.all([
      request(app).get("/api/v1/admin/worksites").set("Authorization", `Bearer ${token}`),
      request(app).get("/api/v1/admin/audit").set("Authorization", `Bearer ${token}`),
      request(app).post("/api/v1/admin/clients").set("Authorization", `Bearer ${token}`).send({ name: "Forbidden organization" }),
    ]);
    expect(worksites.status).toBe(403);
    expect(audit.status).toBe(403);
    expect(createOrganization.status).toBe(403);
  });

  it("returns validation and authorization messages in Bahasa Malaysia when requested", async () => {
    const response = await request(app).get("/api/v1/admin/worksites").set("Accept-Language", "ms-MY");
    expect(response.status).toBe(401);
    expect(response.body.error).toBe("Pengesahan diperlukan.");
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

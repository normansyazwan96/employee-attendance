import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createAccessToken, verifyAccessToken } from "../src/utils/token.js";

const encode = (value: object): string => Buffer.from(JSON.stringify(value)).toString("base64url");

describe("access tokens", () => {
  it("accepts a valid token", () => {
    const token = createAccessToken({ sub: "user-1", username: "employee", role: "EMPLOYEE" });
    expect(verifyAccessToken(token)?.sub).toBe("user-1");
  });

  it("accepts the restricted global administrator role", () => {
    const token = createAccessToken({ sub: "global-1", username: "support", role: "GLOBAL_ADMIN" });
    expect(verifyAccessToken(token)?.role).toBe("GLOBAL_ADMIN");
  });

  it("defaults access tokens to a fifteen-minute lifetime", () => {
    const before = Math.floor(Date.now() / 1000);
    const token = createAccessToken({ sub: "user-1", username: "employee", role: "EMPLOYEE" });
    const payload = verifyAccessToken(token);
    expect(payload?.exp).toBeGreaterThanOrEqual(before + 899);
    expect(payload?.exp).toBeLessThanOrEqual(before + 901);
  });

  it("rejects a token with malformed claims", () => {
    const header = encode({ alg: "HS256", typ: "JWT" });
    const body = encode({ sub: "user-1", username: "x", role: "EMPLOYEE", passwordVersion: 0, exp: Math.floor(Date.now() / 1000) + 60 });
    const signature = createHmac("sha256", process.env.JWT_SECRET).update(`${header}.${body}`).digest("base64url");
    expect(verifyAccessToken(`${header}.${body}.${signature}`)).toBeNull();
  });

  it("rejects an expired token", () => {
    const header = encode({ alg: "HS256", typ: "JWT" });
    const body = encode({ sub: "user-1", username: "employee", role: "EMPLOYEE", passwordVersion: 0, exp: Math.floor(Date.now() / 1000) - 1 });
    const signature = createHmac("sha256", process.env.JWT_SECRET).update(`${header}.${body}`).digest("base64url");
    expect(verifyAccessToken(`${header}.${body}.${signature}`)).toBeNull();
  });

  it("rejects tokens with an unexpected algorithm header", () => {
    const header = encode({ alg: "none", typ: "JWT" });
    const body = encode({ sub: "user-1", username: "employee", role: "EMPLOYEE", passwordVersion: 0, exp: Math.floor(Date.now() / 1000) + 60 });
    const signature = createHmac("sha256", process.env.JWT_SECRET).update(`${header}.${body}`).digest("base64url");
    expect(verifyAccessToken(`${header}.${body}.${signature}`)).toBeNull();
  });

  it("rejects tokens with extra segments", () => {
    const token = createAccessToken({ sub: "user-1", username: "employee", role: "EMPLOYEE" });
    expect(verifyAccessToken(`${token}.unexpected`)).toBeNull();
  });
});

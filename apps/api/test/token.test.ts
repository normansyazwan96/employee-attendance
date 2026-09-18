import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createAccessToken, verifyAccessToken } from "../src/utils/token.js";

const encode = (value: object): string => Buffer.from(JSON.stringify(value)).toString("base64url");

describe("access tokens", () => {
  it("accepts a valid token", () => {
    const token = createAccessToken({ sub: "user-1", username: "employee", role: "EMPLOYEE" });
    expect(verifyAccessToken(token)?.sub).toBe("user-1");
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
});

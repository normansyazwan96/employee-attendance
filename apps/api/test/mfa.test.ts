import { describe, expect, it } from "vitest";
import { decryptMfaSecret, encryptMfaSecret, generateMfaSecret, generateRecoveryCodes, generateTotp, hashRecoveryCode, verifyTotp } from "../src/services/mfa.js";

describe("multi-factor authentication", () => {
  it("encrypts authenticator secrets at rest", () => {
    const secret = generateMfaSecret();
    const encrypted = encryptMfaSecret(secret);
    expect(encrypted).not.toContain(secret);
    expect(decryptMfaSecret(encrypted)).toBe(secret);
  });

  it("accepts a current TOTP and rejects an unrelated code", () => {
    const secret = generateMfaSecret();
    const now = Date.parse("2026-10-23T12:00:00Z");
    const code = generateTotp(secret, now);
    expect(verifyTotp(secret, code, now)).toBe(true);
    expect(verifyTotp(secret, code === "000000" ? "000001" : "000000", now)).toBe(false);
  });

  it("generates one-time recovery codes that can be safely hashed", () => {
    const codes = generateRecoveryCodes();
    expect(new Set(codes).size).toBe(codes.length);
    expect(hashRecoveryCode(codes[0])).toMatch(/^[0-9a-f]{64}$/);
    expect(hashRecoveryCode(codes[0])).not.toContain(codes[0]);
  });
});

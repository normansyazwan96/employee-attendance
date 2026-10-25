import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  compareAuthIdentityShadow,
  compareClientListShadow,
  compareEmployeeListShadow,
  configureD1Shadow,
  getD1ShadowStatus,
  type D1DatabaseBinding,
  type D1PreparedStatement,
} from "../src/services/d1-shadow.js";

function fakeDatabase(handler: (query: string, values: unknown[]) => unknown[]): D1DatabaseBinding {
  return {
    prepare(query: string): D1PreparedStatement {
      let values: unknown[] = [];
      const statement: D1PreparedStatement = {
        bind(...nextValues: unknown[]) {
          values = nextValues;
          return statement;
        },
        async first<T>() {
          return (handler(query, values)[0] as T | undefined) ?? null;
        },
        async all<T>() {
          return { results: handler(query, values) as T[] };
        },
      };
      return statement;
    },
  };
}

describe("D1 shadow reads", () => {
  beforeEach(() => {
    configureD1Shadow(undefined, "off");
    vi.restoreAllMocks();
  });

  it("records a matching organization read without affecting the result", async () => {
    configureD1Shadow(fakeDatabase(() => [{ id: "org-1", name: "Acme", stateCode: "10" }]), "compare");

    await compareClientListShadow([{ id: "org-1", name: "Acme", stateCode: "10" }]);

    expect(getD1ShadowStatus()).toMatchObject({ comparisons: 1, matches: 1, mismatches: 0, errors: 0 });
  });

  it("records a mismatch without throwing or logging sensitive values", async () => {
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    configureD1Shadow(fakeDatabase(() => []), "compare");

    await compareAuthIdentityShadow("admin", {
      id: "user-1",
      username: "admin",
      passwordHash: "secret-hash",
      role: "ADMIN",
      platformRole: "USER",
      clientId: "org-1",
      isActive: true,
      passwordVersion: 0,
      mustChangePassword: false,
      failedLoginAttempts: 0,
      lockedUntil: null,
      employee: null,
      mfaCredential: null,
      memberships: [],
    });

    expect(getD1ShadowStatus()).toMatchObject({ comparisons: 1, matches: 0, mismatches: 1, errors: 0, lastMismatchArea: "auth_identity" });
    expect(warning).toHaveBeenCalledOnce();
    expect(warning.mock.calls[0]?.[0]).not.toContain("secret-hash");
  });

  it("does nothing when comparison mode is disabled", async () => {
    configureD1Shadow(fakeDatabase(() => { throw new Error("should not execute"); }), "off");

    await compareClientListShadow([]);

    expect(getD1ShadowStatus()).toMatchObject({ mode: "off", configured: true, comparisons: 0 });
  });

  it("compares administrators against every employee in their organization", async () => {
    let capturedQuery = "";
    let capturedValues: unknown[] = [];
    configureD1Shadow(fakeDatabase((query, values) => {
      capturedQuery = query;
      capturedValues = values;
      return [];
    }), "compare");

    await compareEmployeeListShadow([], { role: "ADMIN", clientId: "org-1" });

    expect(capturedQuery).toContain("u.clientId = ?");
    expect(capturedQuery).not.toContain("u.createdByUserId = ?");
    expect(capturedValues).toEqual(["org-1"]);
  });
});

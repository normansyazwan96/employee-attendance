import { logger } from "./logger.js";

export type D1ReadMode = "off" | "compare";

export type D1Result<T> = { results?: T[] };
export type D1PreparedStatement = {
  bind(...values: unknown[]): D1PreparedStatement;
  first<T>(): Promise<T | null>;
  all<T>(): Promise<D1Result<T>>;
};
export type D1DatabaseBinding = {
  prepare(query: string): D1PreparedStatement;
  batch<T = unknown>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]>;
};

type ShadowStats = {
  mode: D1ReadMode;
  configured: boolean;
  comparisons: number;
  matches: number;
  mismatches: number;
  errors: number;
  lastComparedAt?: string;
  lastMismatchArea?: string;
  lastErrorArea?: string;
};

let database: D1DatabaseBinding | undefined;
let mode: D1ReadMode = "off";
const stats: ShadowStats = {
  mode,
  configured: false,
  comparisons: 0,
  matches: 0,
  mismatches: 0,
  errors: 0,
};

export function configureD1Shadow(binding: D1DatabaseBinding | undefined, readMode: D1ReadMode): void {
  const nextMode = binding ? readMode : "off";
  if (database !== binding || mode !== nextMode) {
    stats.comparisons = 0;
    stats.matches = 0;
    stats.mismatches = 0;
    stats.errors = 0;
    delete stats.lastComparedAt;
    delete stats.lastMismatchArea;
    delete stats.lastErrorArea;
  }
  database = binding;
  mode = nextMode;
  stats.mode = mode;
  stats.configured = Boolean(binding);
}

export function getD1ShadowStatus(): Readonly<ShadowStats> {
  return { ...stats };
}

function asBoolean(value: unknown): boolean {
  return value === true || value === 1;
}

function asEpoch(value: Date | number | null | undefined): number | null {
  if (value == null) return null;
  return value instanceof Date ? value.getTime() : value;
}

function rows<T>(result: D1Result<T>): T[] {
  return result.results ?? [];
}

async function compare(area: string, expected: unknown, loadActual: (binding: D1DatabaseBinding) => Promise<unknown>): Promise<void> {
  if (mode !== "compare" || !database) return;
  stats.comparisons += 1;
  stats.lastComparedAt = new Date().toISOString();
  try {
    const actual = await loadActual(database);
    if (JSON.stringify(actual) === JSON.stringify(expected)) {
      stats.matches += 1;
      return;
    }
    stats.mismatches += 1;
    stats.lastMismatchArea = area;
    logger.warn("d1_shadow_mismatch", { area });
  } catch (caught) {
    stats.errors += 1;
    stats.lastErrorArea = area;
    logger.warn("d1_shadow_error", { area, error: caught instanceof Error ? caught.message : "Unknown D1 error" });
  }
}

type AuthIdentity = {
  id: string;
  username: string;
  passwordHash: string;
  role: string;
  platformRole: string;
  clientId: string | null;
  isActive: boolean;
  passwordVersion: number;
  mustChangePassword: boolean;
  failedLoginAttempts: number;
  lockedUntil: Date | number | null;
  employee: { firstName: string; lastName: string } | null;
  mfaCredential: { enabled: boolean } | null;
  memberships: Array<{ id: string; clientId: string; role: string; status: string }>;
};

type AuthIdentityRow = Omit<AuthIdentity, "isActive" | "mustChangePassword" | "lockedUntil" | "employee" | "mfaCredential" | "memberships"> & {
  isActive: number;
  mustChangePassword: number;
  lockedUntil: number | null;
  firstName: string | null;
  lastName: string | null;
  mfaEnabled: number | null;
};

type MembershipRow = { id: string; clientId: string; role: string; status: string };

function normalizeAuthIdentity(user: AuthIdentity | null): unknown {
  if (!user) return null;
  return {
    id: user.id,
    username: user.username,
    passwordHash: user.passwordHash,
    role: user.role,
    platformRole: user.platformRole,
    clientId: user.clientId,
    isActive: user.isActive,
    passwordVersion: user.passwordVersion,
    mustChangePassword: user.mustChangePassword,
    failedLoginAttempts: user.failedLoginAttempts,
    lockedUntil: asEpoch(user.lockedUntil),
    employee: user.employee ? { firstName: user.employee.firstName, lastName: user.employee.lastName } : null,
    mfaCredential: user.mfaCredential ? { enabled: user.mfaCredential.enabled } : null,
    memberships: user.memberships
      .map(({ id, clientId, role, status }) => ({ id, clientId, role, status }))
      .sort((left, right) => left.id.localeCompare(right.id)),
  };
}

export async function compareAuthIdentityShadow(username: string, expected: AuthIdentity | null): Promise<void> {
  await compare("auth_identity", normalizeAuthIdentity(expected), async (binding) => {
    const statement = binding.prepare(`
      SELECT u.id, u.username, u.passwordHash, u.role, u.platformRole, u.clientId,
             u.isActive, u.passwordVersion, u.mustChangePassword, u.failedLoginAttempts,
             u.lockedUntil, e.firstName, e.lastName, m.enabled AS mfaEnabled
      FROM "User" u
      LEFT JOIN "Employee" e ON e.userId = u.id
      LEFT JOIN "MfaCredential" m ON m.userId = u.id
      WHERE u.username = ?
      LIMIT 1
    `).bind(username);
    const user = await statement.first<AuthIdentityRow>();
    if (!user) return null;
    const memberships = rows(await binding.prepare(`
      SELECT id, clientId, role, status
      FROM "OrganizationMembership"
      WHERE userId = ? AND status = 'ACTIVE'
      ORDER BY id ASC
    `).bind(user.id).all<MembershipRow>());
    return {
      id: user.id,
      username: user.username,
      passwordHash: user.passwordHash,
      role: user.role,
      platformRole: user.platformRole,
      clientId: user.clientId,
      isActive: asBoolean(user.isActive),
      passwordVersion: user.passwordVersion,
      mustChangePassword: asBoolean(user.mustChangePassword),
      failedLoginAttempts: user.failedLoginAttempts,
      lockedUntil: user.lockedUntil,
      employee: user.firstName === null || user.lastName === null ? null : { firstName: user.firstName, lastName: user.lastName },
      mfaCredential: user.mfaEnabled === null ? null : { enabled: asBoolean(user.mfaEnabled) },
      memberships,
    };
  });
}

type AdminScopeSnapshot = {
  user: { role: string; clientId: string | null } | null;
  membership: { id: string; clientId: string; role: string; status: string; managerMembershipId: string | null; canManagePayroll: boolean } | null;
};

type AdminScopeMembershipRow = Omit<NonNullable<AdminScopeSnapshot["membership"]>, "canManagePayroll"> & { canManagePayroll: number };

export async function compareAdminScopeShadow(userId: string, clientId: string | null, expected: AdminScopeSnapshot): Promise<void> {
  const normalized = {
    user: expected.user,
    membership: expected.membership ? { ...expected.membership, canManagePayroll: Boolean(expected.membership.canManagePayroll) } : null,
  };
  await compare("admin_scope", normalized, async (binding) => {
    const user = await binding.prepare(`SELECT role, clientId FROM "User" WHERE id = ? LIMIT 1`).bind(userId).first<{ role: string; clientId: string | null }>();
    const membership = clientId
      ? await binding.prepare(`
          SELECT id, clientId, role, status, managerMembershipId, canManagePayroll
          FROM "OrganizationMembership"
          WHERE userId = ? AND clientId = ?
          LIMIT 1
        `).bind(userId, clientId).first<AdminScopeMembershipRow>()
      : null;
    return {
      user,
      membership: membership ? { ...membership, canManagePayroll: asBoolean(membership.canManagePayroll) } : null,
    };
  });
}

type ClientSnapshot = { id: string; name: string; stateCode: string | null };

export async function compareClientListShadow(expected: ClientSnapshot[], clientId?: string): Promise<void> {
  const normalized = expected.map(({ id, name, stateCode }) => ({ id, name, stateCode }));
  await compare("organization_list", normalized, async (binding) => {
    const query = clientId
      ? `SELECT id, name, stateCode FROM "Client" WHERE id = ? ORDER BY name ASC`
      : `SELECT id, name, stateCode FROM "Client" ORDER BY name ASC`;
    const statement = clientId ? binding.prepare(query).bind(clientId) : binding.prepare(query);
    return rows(await statement.all<ClientSnapshot>());
  });
}

export type EmployeeShadowSnapshot = {
  id: string;
  employeeId: string | null;
  username: string;
  firstName: string;
  lastName: string;
  isActive: boolean;
  clientId: string | null;
  ownerAdmin: { id: string; username: string; displayName: string | null } | null;
};

type EmployeeShadowFilter = {
  role: string;
  clientId?: string;
  managerMembershipId?: string;
};

type EmployeeRow = {
  id: string;
  employeeId: string | null;
  username: string;
  firstName: string | null;
  lastName: string | null;
  isActive: number;
  clientId: string | null;
  ownerId: string | null;
  ownerUsername: string | null;
  ownerDisplayName: string | null;
  ownerRole: string | null;
};

export async function compareEmployeeListShadow(expected: EmployeeShadowSnapshot[], filter: EmployeeShadowFilter): Promise<void> {
  await compare("employee_list", expected, async (binding) => {
    const conditions = [`u.role = 'EMPLOYEE'`];
    const values: unknown[] = [];
    let membershipJoin = "";
    if (filter.clientId) {
      conditions.push("u.clientId = ?");
      values.push(filter.clientId);
    }
    if (filter.role === "MANAGER") {
      membershipJoin = `INNER JOIN "OrganizationMembership" em ON em.userId = u.id AND em.status = 'ACTIVE'`;
      conditions.push("em.managerMembershipId = ?");
      values.push(filter.managerMembershipId ?? "");
    }
    const result = await binding.prepare(`
      SELECT u.id, e.id AS employeeId, u.username, e.firstName, e.lastName, u.isActive, u.clientId,
             owner.id AS ownerId, owner.username AS ownerUsername, owner.displayName AS ownerDisplayName,
             owner.role AS ownerRole
      FROM "User" u
      LEFT JOIN "Employee" e ON e.userId = u.id
      LEFT JOIN "User" owner ON owner.id = u.createdByUserId
      ${membershipJoin}
      WHERE ${conditions.join(" AND ")}
      ORDER BY u.isActive DESC, u.username ASC
    `).bind(...values).all<EmployeeRow>();
    return rows(result).map((row) => ({
      id: row.id,
      employeeId: row.employeeId,
      username: row.username,
      firstName: row.firstName ?? "",
      lastName: row.lastName ?? "",
      isActive: asBoolean(row.isActive),
      clientId: row.clientId,
      ownerAdmin: row.ownerId && row.ownerUsername && row.ownerRole === "ADMIN"
        ? { id: row.ownerId, username: row.ownerUsername, displayName: row.ownerDisplayName }
        : null,
    }));
  });
}

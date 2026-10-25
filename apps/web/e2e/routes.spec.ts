import { expect, test } from "@playwright/test";

const adminPassword = process.env.E2E_ADMIN_PASSWORD;
const employeePassword = process.env.E2E_EMPLOYEE_PASSWORD;
const devAdminPassword = process.env.E2E_DEV_ADMIN_PASSWORD;

test("login page is available", async ({ page }) => {
  await page.goto("/login");
  await expect(page.getByRole("heading", { name: "Welcome back" })).toBeVisible();
  await expect(page.getByLabel("Username")).toBeVisible();
  await expect(page.getByLabel("Username")).toHaveAttribute("type", "text");
});

test("admin can open focused administration routes", async ({ page }) => {
  test.skip(!adminPassword, "E2E_ADMIN_PASSWORD is required");
  await page.goto("/login");
  await page.getByLabel("Username").fill("admin");
  await page.getByLabel("Password").fill(adminPassword!);
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page).toHaveURL(/\/admin$/);
  await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible();
  await page.getByRole("link", { name: "Employees" }).first().click();
  await expect(page).toHaveURL(/\/admin\/employees$/);
  await expect(page.getByRole("heading", { name: "Employees" })).toBeVisible();
  await page.goto("/admin/audit");
  await expect(page.getByRole("heading", { name: "Audit history" })).toBeVisible();
});

test("admin can log out", async ({ page }) => {
  test.skip(!adminPassword, "E2E_ADMIN_PASSWORD is required");
  await page.goto("/login");
  await page.getByLabel("Username").fill("admin");
  await page.getByLabel("Password").fill(adminPassword!);
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page).toHaveURL(/\/admin$/);
  await page.getByRole("button", { name: "Log out" }).click();
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole("heading", { name: "Welcome back" })).toBeVisible();
});

test("employee menu opens working navigation", async ({ page }) => {
  test.skip(!employeePassword, "E2E_EMPLOYEE_PASSWORD is required");
  await page.goto("/login");
  await page.getByLabel("Username").fill("john.smith");
  await page.getByLabel("Password").fill(employeePassword!);
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page).toHaveURL(/\/employee$/);
  await page.getByRole("button", { name: "Open menu" }).click();
  await expect(page.getByRole("link", { name: "Attendance history", exact: true })).toBeVisible();
  await page.getByRole("link", { name: "Attendance history", exact: true }).click();
  await expect(page).toHaveURL(/\/employee\/history$/);
});

test("dev admin uses the full admin surface and profile", async ({ page }) => {
  test.skip(!devAdminPassword, "E2E_DEV_ADMIN_PASSWORD is required");
  await page.goto("/login");
  await page.getByLabel("Username").fill("devadmin");
  await page.getByLabel("Password").fill(devAdminPassword!);
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page).toHaveURL(/\/admin$/);
  await page.goto("/admin/settings");
  await expect(page.getByRole("heading", { name: "Webhook integration" })).toBeVisible();
  await page.getByRole("link", { name: "Open profile" }).click();
  await expect(page).toHaveURL(/\/profile$/);
  await expect(page.getByRole("heading", { name: "My profile" })).toBeVisible();
});

test("login layout fits supported mobile widths in both languages", async ({ page }) => {
  for (const width of [320, 375, 390, 430]) {
    await page.setViewportSize({ width, height: 760 });
    await page.goto("/login");
    await expect(page.getByRole("heading", { name: "Welcome back" })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.getByRole("button", { name: "Bahasa Malaysia" }).click();
    await expect(page.getByRole("heading", { name: "Selamat kembali" })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.getByRole("button", { name: "English" }).click();
  }
});

test("payroll foundation fits mobile and exposes calculation setup", async ({ page }) => {
  const user = { id: "admin-test", username: "admin", role: "ADMIN", name: "Payroll Admin", mustChangePassword: false };
  await page.addInitScript((sessionUser) => {
    window.localStorage.setItem("attendance.user", JSON.stringify(sessionUser));
  }, user);
  await page.route("**/api/v2/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    const responses: Record<string, unknown> = {
      "/api/v2/auth/refresh": { accessToken: "test-access-token", expiresIn: 900, user },
      "/api/v2/notifications": { data: [] },
      "/api/v2/payroll/settings": { data: { id: "settings", jurisdiction: "PENINSULAR_LABUAN", currency: "MYR", payFrequency: "MONTHLY", normalDailyMinutes: 480, normalWeeklyMinutes: 2700, salaryDivisor: 26, rulePackVersion: "MY-PEN-2023-01", statutoryContributionsEnabled: false, statutoryRuleVersion: "MY-STAT-2025-10-01" } },
      "/api/v2/workforce/employees": { data: [{ id: "employee", firstName: "Amina", lastName: "Rahman", employeeNumber: "E001", employmentStatus: "ACTIVE", joinDate: null, terminationDate: null, departmentId: null, department: null, user: { id: "employee-user", username: "amina", isActive: true } }] },
      "/api/v2/payroll/pay-profiles": { data: [] },
      "/api/v2/payroll/statutory-profiles": { data: [] },
      "/api/v2/payroll/components": { data: [] },
      "/api/v2/payroll/component-assignments": { data: [] },
      "/api/v2/payroll/pay-periods": { data: [] },
      "/api/v2/payroll/exports": { data: [] },
    };
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(responses[path] ?? { data: [] }) });
  });

  for (const width of [320, 390, 430]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/admin/reports");
    await expect(page.getByRole("heading", { name: "Payroll reports" })).toBeVisible();
    await expect(page.getByText("Calculation only. No payment will be initiated.")).toBeVisible();
    await expect(page.getByRole("tab", { name: "Pay profiles" })).toBeVisible();
    await page.getByRole("tab", { name: "Contributions" }).click();
    await expect(page.getByRole("heading", { name: "Employee contribution profiles" })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.getByRole("tab", { name: "Review and exports" }).click();
    await expect(page.getByText("Payroll export fields")).toBeVisible();
    await expect(page.getByText("Locked calculated pay")).toBeVisible();
    await expect(page.getByText("Final calculated pay")).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  }
});

test("payroll warning review requires an acknowledgement note", async ({ page }) => {
  const user = { id: "admin-review", username: "reviewer", role: "ADMIN", name: "Payroll Reviewer", mustChangePassword: false };
  let acknowledged = false;
  await page.addInitScript((sessionUser) => { window.localStorage.setItem("attendance.user", JSON.stringify(sessionUser)); }, user);
  await page.route("**/api/v2/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path.includes("/warnings/EPF_EXEMPT/acknowledge") && request.method() === "POST") {
      acknowledged = true;
      await route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ data: { id: "ack-1", warningCode: "EPF_EXEMPT", note: "Employee exemption verified", acknowledgedByUserId: user.id, acknowledgedByUsername: user.username, createdAt: "2026-10-24T12:00:00Z" } }) });
      return;
    }
    const result = { id: "result-review", employeeId: "employee", grossPaySen: 320000, totalDeductionsSen: 2500, calculatedPaySen: 317500, epfWagesSen: 320000, socsoWagesSen: 320000, eisWagesSen: 320000, epfEmployeeSen: 0, epfEmployerSen: 0, socsoEmployeeSen: 1625, socsoEmployerSen: 8120, eisEmployeeSen: 650, eisEmployerSen: 650, employerContributionsSen: 8770, warnings: ["EPF_EXEMPT"], blockingWarnings: [], warningAcknowledgements: acknowledged ? [{ id: "ack-1", warningCode: "EPF_EXEMPT", note: "Employee exemption verified", acknowledgedByUserId: user.id, acknowledgedByUsername: user.username, createdAt: "2026-10-24T12:00:00Z" }] : [], employee: { id: "employee", firstName: "Amina", lastName: "Rahman", employeeNumber: "E001", user: { username: "amina" } }, lines: [] };
    const responses: Record<string, unknown> = {
      "/api/v2/auth/refresh": { accessToken: "review-access-token", expiresIn: 900, user },
      "/api/v2/notifications": { data: [] },
      "/api/v2/payroll/settings": { data: { id: "settings", jurisdiction: "PENINSULAR_LABUAN", currency: "MYR", payFrequency: "MONTHLY", normalDailyMinutes: 480, normalWeeklyMinutes: 2700, salaryDivisor: 26, rulePackVersion: "MY-PEN-2023-01", statutoryContributionsEnabled: true, statutoryRuleVersion: "MY-STAT-2025-10-01" } },
      "/api/v2/workforce/employees": { data: [] },
      "/api/v2/payroll/pay-profiles": { data: [] },
      "/api/v2/payroll/statutory-profiles": { data: [] },
      "/api/v2/payroll/components": { data: [] },
      "/api/v2/payroll/component-assignments": { data: [] },
      "/api/v2/payroll/pay-periods": { data: [{ id: "period-review", name: "October 2026", startDate: "2026-10-01", endDate: "2026-10-31", status: "DRAFT" }] },
      "/api/v2/payroll/exports": { data: [] },
      "/api/v2/payroll/pay-periods/period-review/calculations/latest": { data: { id: "run-review", payPeriodId: "period-review", version: 1, status: "DRAFT", rulePackVersion: "MY-PEN-2023-01+MY-STAT-2025-10-01", inputHash: "hash", totalGrossSen: 320000, totalDeductionsSen: 2500, totalCalculatedPaySen: 317500, warningCount: 1, blockingWarningCount: 0, createdAt: "2026-10-24T11:00:00Z", results: [result] } },
    };
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(responses[path] ?? { data: [] }) });
  });

  await page.setViewportSize({ width: 390, height: 900 });
  await page.goto("/admin/reports");
  await page.getByRole("tab", { name: "Review and exports" }).click();
  await page.getByRole("button", { name: "Details" }).click();
  await page.getByText("Amina Rahman").click();
  await expect(page.getByText("Employee is marked as EPF exempt")).toBeVisible();
  await expect(page.getByText("Warning", { exact: true })).toBeVisible();
  await page.getByLabel("Review note: Employee is marked as EPF exempt").fill("Employee exemption verified");
  await page.getByRole("button", { name: "Acknowledge" }).click();
  await expect(page.getByText("Employee exemption verified")).toBeVisible();
  await expect(page.locator("summary").getByText("Ready", { exact: true })).toBeVisible();
  expect(acknowledged).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test("employee payroll statements stay private, bilingual, and mobile friendly", async ({ page }) => {
  const user = { id: "employee-user", username: "amina", role: "EMPLOYEE", name: "Amina Rahman", mustChangePassword: false };
  await page.addInitScript((sessionUser) => { window.localStorage.setItem("attendance.user", JSON.stringify(sessionUser)); }, user);
  await page.route("**/api/v2/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    const responses: Record<string, unknown> = {
      "/api/v2/auth/refresh": { accessToken: "employee-access-token", expiresIn: 900, user },
      "/api/v2/notifications": { data: [] },
      "/api/v2/payroll/my-statements": { data: [{
        id: "statement-1",
        period: { id: "period-1", name: "October 2026", startDate: "2026-10-01", endDate: "2026-10-31", status: "LOCKED" },
        calculation: { version: 1, rulePackVersion: "MY-PEN-2023-01", lockedAt: "2026-10-31T12:00:00Z", grossPaySen: 320000, totalDeductionsSen: 2500, calculatedPaySen: 317500, employerContributionsSen: 0, lines: [{ id: "base", direction: "EARNING", category: "BASE_PAY", code: "BASE", name: "Base pay", amountSen: 310000, basis: "Monthly rate", displayOrder: 1 }] },
        employee: { id: "employee", firstName: "Amina", lastName: "Rahman", employeeNumber: "E001", username: "amina" },
        adjustments: [{ id: "adjustment", direction: "EARNING", code: "BONUS", name: "Performance bonus", amountSen: 1000, reason: "Approved performance bonus", createdAt: "2026-10-31T13:00:00Z" }],
        adjustmentEarningsSen: 1000,
        adjustmentDeductionsSen: 0,
        finalCalculatedPaySen: 318500,
      }] },
    };
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(responses[path] ?? { data: [] }) });
  });

  for (const width of [320, 375, 390, 430]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/employee/payroll");
    await expect(page.getByRole("heading", { name: "My payroll statements" })).toBeVisible();
    await expect(page.getByText("October 2026")).toBeVisible();
    await expect(page.getByText("RM 3,185.00")).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.getByRole("button", { name: "Bahasa Malaysia" }).click();
    await expect(page.getByRole("heading", { name: "Penyata gaji saya" })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.getByRole("button", { name: "English" }).click();
  }
});

test("payroll administrator can approve another administrator's adjustment", async ({ page }) => {
  const user = { id: "approver-admin", username: "approver", role: "ADMIN", name: "Payroll Approver", mustChangePassword: false };
  let decided = false;
  await page.addInitScript((sessionUser) => { window.localStorage.setItem("attendance.user", JSON.stringify(sessionUser)); }, user);
  await page.route("**/api/v2/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path.endsWith("/adjustments/adjustment-1/decision") && request.method() === "POST") {
      decided = true;
      await route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ data: { id: "decision-1", outcome: "APPROVED" } }) });
      return;
    }
    const adjustment = { id: "adjustment-1", clientId: "client", payPeriodId: "period-1", calculationResultId: "result-1", employeeId: "employee", direction: "EARNING", code: "BONUS", name: "Performance bonus", amountSen: 1000, reason: "Approved performance record", createdByUserId: "submitting-admin", createdAt: "2026-10-31T13:00:00Z", status: decided ? "APPROVED" : "PENDING", decision: decided ? { id: "decision-1", outcome: "APPROVED", note: "Supporting record verified", decidedByUserId: user.id, createdAt: "2026-10-31T14:00:00Z" } : null };
    const statement = { id: "result-1", organizationName: "Acme", period: { id: "period-1", name: "October 2026", startDate: "2026-10-01", endDate: "2026-10-31", status: "LOCKED" }, calculation: { version: 1, rulePackVersion: "MY-PEN-2023-01", lockedAt: "2026-10-31T12:00:00Z", grossPaySen: 320000, totalDeductionsSen: 2500, calculatedPaySen: 317500, employerContributionsSen: 0, lines: [] }, employee: { id: "employee", userId: "employee-user", firstName: "Amina", lastName: "Rahman", employeeNumber: "E001", username: "amina", contactEmail: "amina@example.com" }, adjustments: [adjustment], adjustmentEarningsSen: decided ? 1000 : 0, adjustmentDeductionsSen: 0, finalCalculatedPaySen: decided ? 318500 : 317500 };
    const responses: Record<string, unknown> = {
      "/api/v2/auth/refresh": { accessToken: "approver-access-token", expiresIn: 900, user },
      "/api/v2/notifications": { data: [] },
      "/api/v2/payroll/settings": { data: { id: "settings", jurisdiction: "PENINSULAR_LABUAN", currency: "MYR", payFrequency: "MONTHLY", normalDailyMinutes: 480, normalWeeklyMinutes: 2700, salaryDivisor: 26, rulePackVersion: "MY-PEN-2023-01", statutoryContributionsEnabled: false, statutoryRuleVersion: "MY-STAT-2025-10-01" } },
      "/api/v2/workforce/employees": { data: [] },
      "/api/v2/payroll/pay-profiles": { data: [] },
      "/api/v2/payroll/statutory-profiles": { data: [] },
      "/api/v2/payroll/components": { data: [] },
      "/api/v2/payroll/component-assignments": { data: [] },
      "/api/v2/payroll/pay-periods": { data: [{ id: "period-1", name: "October 2026", startDate: "2026-10-01", endDate: "2026-10-31", status: "LOCKED" }] },
      "/api/v2/payroll/exports": { data: [] },
      "/api/v2/payroll/pay-periods/period-1/calculations/latest": { data: { id: "run-1", payPeriodId: "period-1", version: 1, status: "LOCKED", rulePackVersion: "MY-PEN-2023-01", inputHash: "hash", totalGrossSen: 320000, totalDeductionsSen: 2500, totalCalculatedPaySen: 317500, warningCount: 0, blockingWarningCount: 0, createdAt: "2026-10-31T12:00:00Z", results: [] } },
      "/api/v2/payroll/pay-periods/period-1/statements": { data: [statement] },
      "/api/v2/payroll/pay-periods/period-1/statement-deliveries": { data: [] },
      "/api/v2/payroll/delivery-capabilities": { data: { emailConfigured: false } },
      "/api/v2/payroll/adjustments/pending": { data: decided ? [] : [{ ...adjustment, employee: { id: "employee", firstName: "Amina", lastName: "Rahman", employeeNumber: "E001", user: { username: "amina" } }, payPeriod: statement.period, createdBy: { id: "submitting-admin", username: "submitter", displayName: "Submitting Admin" } }] },
    };
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(responses[path] ?? { data: [] }) });
  });

  await page.setViewportSize({ width: 320, height: 900 });
  await page.goto("/admin/reports");
  await page.getByRole("tab", { name: "Review and exports" }).click();
  await page.getByRole("button", { name: "Details" }).click();
  await expect(page.getByText("Organization approvals awaiting decision")).toBeVisible();
  await expect(page.getByText("Email delivery is not configured on this deployment.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Email PDF" })).toBeDisabled();
  await page.getByLabel("Decision note").fill("Supporting record verified");
  await page.getByRole("button", { name: "Approve" }).click();
  await expect(page.getByText("APPROVED", { exact: true })).toBeVisible();
  expect(decided).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

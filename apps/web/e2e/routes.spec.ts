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

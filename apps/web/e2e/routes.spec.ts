import { expect, test } from "@playwright/test";

test("login page is available", async ({ page }) => {
  await page.goto("/login");
  await expect(page.getByRole("heading", { name: "Welcome back" })).toBeVisible();
});

test("admin can open employee and audit management", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill("admin@acme.local");
  await page.getByLabel("Password").fill("ChangeMe123!");
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page).toHaveURL(/\/admin$/);
  await expect(page.getByRole("heading", { name: "Admin dashboard" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Employees" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Audit history" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Worksites" })).toBeVisible();
});

test("admin can log out", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill("admin@acme.local");
  await page.getByLabel("Password").fill("ChangeMe123!");
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page).toHaveURL(/\/admin$/);
  await page.getByRole("button", { name: "Log out" }).click();
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole("heading", { name: "Welcome back" })).toBeVisible();
});

test("employee menu opens working navigation", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill("john.smith@acme.local");
  await page.getByLabel("Password").fill("ChangeMe123!");
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page).toHaveURL(/\/employee$/);
  await page.getByRole("button", { name: "Open menu" }).click();
  await expect(page.getByRole("link", { name: "Attendance history" })).toBeVisible();
  await page.getByRole("link", { name: "Attendance history" }).click();
  await expect(page).toHaveURL(/\/employee\/history$/);
});

test("dev admin uses the full admin surface and profile", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill("devadmin@attendance.local");
  await page.getByLabel("Password").fill("ChangeMe123!");
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page).toHaveURL(/\/dev$/);
  await expect(page.getByRole("heading", { name: "Employees" })).toBeVisible();
  await page.getByRole("link", { name: "Open profile" }).click();
  await expect(page).toHaveURL(/\/profile$/);
  await expect(page.getByRole("heading", { name: "My profile" })).toBeVisible();
});

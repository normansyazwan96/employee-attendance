import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  use: { baseURL: "http://127.0.0.1:4173", ...devices["iPhone 13"] },
  webServer: { command: "npm run build && npm run preview -- --host 127.0.0.1", env: { VITE_API_URL: "http://localhost:3000", VITE_BASE_PATH: "/" }, url: "http://127.0.0.1:4173", reuseExistingServer: true },
});

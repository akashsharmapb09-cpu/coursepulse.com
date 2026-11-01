import { defineConfig, devices } from "@playwright/test";

const baseURL = "http://localhost:3000";
// One project per responsive band in the master prompt (320-480, 481-768, 769-1024, 1025-1440, 1441+).
const bands = [
  ["xs-360", 360, 740],
  ["sm-600", 600, 900],
  ["md-900", 900, 1100],
  ["lg-1280", 1280, 800],
  ["xl-1600", 1600, 900],
] as const;

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  use: { baseURL, trace: "retain-on-failure" },
  projects: bands.map(([name, width, height]) => ({
    name,
    use: { ...devices["Desktop Chrome"], viewport: { width, height } },
  })),
  webServer: {
    command: process.env.CI ? "pnpm start" : "pnpm dev",
    url: `${baseURL}/api/v1/health`,
    reuseExistingServer: !process.env.CI,
    env: { ...process.env, SITE_URL: process.env.SITE_URL ?? baseURL },
    timeout: 120_000,
  },
});

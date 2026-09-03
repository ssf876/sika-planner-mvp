import { defineConfig, devices } from "@playwright/test";

// D10 wires browser e2e into CI: signup -> onboard -> dashboard. Tests run
// against their own SQLite database (DATABASE_URL is relative to
// prisma/schema.prisma), migrated fresh by the webServer command.
//
// fullyParallel is off because SQLite is a single-writer database — parallel
// signup flows would trip database locks.
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1, // SQLite single-writer: serialize DB-backed flows
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: "http://localhost:3000",
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    // npx (not pnpm): the spawned shell may not have pnpm on PATH.
    command: "npx prisma migrate deploy && npx next dev --turbopack",
    url: "http://localhost:3000",
    reuseExistingServer: !process.env.CI,
    env: {
      ...process.env,
      DATABASE_URL: "file:./e2e.db",
    },
    timeout: 120_000,
  },
});

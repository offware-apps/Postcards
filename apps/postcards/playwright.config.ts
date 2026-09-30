import { defineConfig, devices } from "@playwright/test";

// Run with: pnpm --filter postcards test:e2e

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  // One retry in CI absorbs environmental flakes (a slow runner missing a 5s
  // render/interactive deadline under worker contention) without masking real
  // failures — a genuine regression fails both the run and the retry.
  retries: process.env.CI ? 1 : 0,
  reporter: "list",
  use: {
    baseURL: "http://localhost:4173",
    trace: "on-first-retry",
    // Seed the "intro seen" flag so the first-run welcome modal never auto-opens
    // over the app during tests (it would block the very first interaction). The
    // real first-run intro is exercised by users, not the suite.
    storageState: {
      cookies: [],
      origins: [
        {
          origin: "http://localhost:4173",
          localStorage: [{ name: "postcards-intro-seen", value: "1" }],
        },
      ],
    },
  },
  webServer: {
    // Built as the deployed app is: localhost is the canonical address and
    // 127.0.0.1 an old one it moved from, so moved.spec.ts drives the real
    // cross-origin handoff. Every other spec runs on localhost, the normal app.
    command:
      "VITE_CANONICAL_URL=http://localhost:4173/ VITE_HANDOFF_FROM=http://127.0.0.1:4173 pnpm build && pnpm preview --port 4173 --host 127.0.0.1",
    url: "http://localhost:4173",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});

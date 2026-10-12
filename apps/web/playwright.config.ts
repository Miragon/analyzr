import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright smoke test against a running analyzr (server + built UI), e.g.
 * `pnpm db:up && pnpm build && node apps/server/src/main.ts`, then
 * `pnpm --filter @analyzr/web e2e`. ANALYZR_E2E_URL points elsewhere (default
 * http://127.0.0.1:7400). Without a reachable server every test is skipped,
 * so the suite is safe in CI.
 */
export default defineConfig({
  testDir: 'e2e',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  timeout: 60_000,
  use: {
    baseURL: process.env['ANALYZR_E2E_URL'] ?? 'http://127.0.0.1:7400',
    trace: 'retain-on-failure',
    locale: 'de-DE',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } },
    },
  ],
});

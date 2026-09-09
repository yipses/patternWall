import { defineConfig, devices } from '@playwright/test';

const PORT = Number(process.env.PORT || 3100);
const baseURL = `http://127.0.0.1:${PORT}`;

/**
 * The suite runs against the exported static site — the same files that would
 * be deployed — served by scripts/serve.mjs. Chromium is pre-installed in this
 * environment, so the executable path is pinned rather than downloaded.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: 0,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  reporter: process.env.CI ? [['line']] : [['list']],
  use: {
    baseURL,
    trace: 'off',
    screenshot: 'off',
    launchOptions: { executablePath: process.env.PW_CHROMIUM ?? '/opt/pw-browsers/chromium' },
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 950 } } },
  ],
  webServer: {
    command: 'node scripts/serve.mjs',
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
    env: { PORT: String(PORT) },
  },
});

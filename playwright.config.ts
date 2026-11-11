import process from 'node:process';
import { defineConfig, devices } from '@playwright/test';

const targetUrl = process.env.TARGET_URL;

export default defineConfig({
  testDir: './e2e',
  timeout: 60000,
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: [
    ['list'],
    ['html', { open: 'never', outputFolder: 'playwright-report' }],
  ],
  use: {
    baseURL: targetUrl || 'http://127.0.0.1:3000',
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: targetUrl
    ? undefined
    : [
        {
          command: 'node apps/server/dist/server.js',
          url: 'http://127.0.0.1:4000/api/health',
          reuseExistingServer: Boolean(process.env.REUSE_EXISTING_SERVER),
          timeout: 30000,
          stdout: 'pipe',
          stderr: 'pipe',
          env: {
            PORT: '4000',
            HOST: '127.0.0.1',
            CLIENT_ORIGIN: 'http://localhost:3000,http://127.0.0.1:3000',
            REPLAY_WINDOW_SEC: '2',
            REPLAY_MAX_ENTRIES: '10000',
            TEST_CONTROL: 'true',
            CHAOS_ENABLED: 'true',
          },
        },
        {
          command:
            'node apps/web/node_modules/next/dist/bin/next dev apps/web --port 3000',
          url: 'http://127.0.0.1:3000',
          reuseExistingServer: Boolean(process.env.REUSE_EXISTING_SERVER),
          timeout: 120000,
          stdout: 'pipe',
          stderr: 'pipe',
          env: {
            PORT: '3000',
            HOSTNAME: '127.0.0.1',
          },
        },
      ],
});

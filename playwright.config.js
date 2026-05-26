// Plugin tests run against the full app (Express + Vite dev server).
// Start the app before running tests:
//   cd ../public-dokku-manager/dokku-manager && BYPASS_AUTH=true node server.js &
//   cd ../public-dokku-manager/dokku-manager/frontend && npm run dev &
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  retries: 0,
  use: {
    baseURL: 'http://localhost:5173',
    channel: 'chrome',
    screenshot: 'only-on-failure',
  },
});

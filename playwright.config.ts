import { defineConfig } from '@playwright/test';

const port = Number(process.env.RAMBLE_E2E_PORT ?? 1421);
const baseURL = `http://127.0.0.1:${port}`;
export default defineConfig({
  testDir: './tests/e2e',
  use: { baseURL, viewport: { width: 640, height: 480 } },
  webServer: { command: `npm run dev:demo -- --port ${port}`, url: baseURL, reuseExistingServer: false },
});

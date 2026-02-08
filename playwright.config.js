const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './test/parity',
  timeout: 60000,
  retries: 0,
  use: {
    baseURL: 'http://localhost:3333',
    viewport: { width: 1280, height: 720 },
    screenshot: 'on',
    trace: 'on-first-retry'
  },
  webServer: {
    command: 'npm start',
    url: 'http://localhost:3333',
    reuseExistingServer: true,
    timeout: 120000
  },
  reporter: [['list'], ['html', { open: 'never' }]]
});

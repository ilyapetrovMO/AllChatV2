const { defineConfig, devices } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './ui-tests',
  timeout: 20_000,
  fullyParallel: true,
  use: {
    baseURL: 'http://127.0.0.1:4173',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'node ui-tests/start-server.js',
    url: 'http://127.0.0.1:4173/login',
    reuseExistingServer: false,
    timeout: 120_000,
  },
  projects: [
    { name: 'desktop-chromium', testIgnore: /layout\.spec\.js/, use: { ...devices['Desktop Chrome'] } },
    { name: 'desktop-firefox', testIgnore: /layout\.spec\.js/, use: { ...devices['Desktop Firefox'] } },
    { name: 'desktop-webkit', testIgnore: /layout\.spec\.js/, use: { ...devices['Desktop Safari'] } },
    { name: 'mobile-chromium', testIgnore: /layout\.spec\.js/, use: { ...devices['Pixel 7'] } },
    { name: 'visual-chromium', testMatch: /layout\.spec\.js/, use: { ...devices['Desktop Chrome'], reducedMotion: 'reduce' } },
  ],
});

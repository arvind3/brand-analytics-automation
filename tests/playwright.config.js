/** @type {import('@playwright/test').PlaywrightTestConfig} */
const config = {
  // Test directory
  testDir: './tests',

  // Test file pattern
  testMatch: '**/*.spec.js',

  // Timeout for each test
  timeout: 30000,

  // Timeout for expectations
  expect: {
    timeout: 5000
  },

  // Fail the build on CI if you accidentally left test.only in the source code
  forbidOnly: !!process.env.CI,

  // Retry on CI only
  retries: process.env.CI ? 2 : 0,

  // Opt out of parallel tests on CI
  workers: process.env.CI ? 1 : undefined,

  // Reporter
  reporter: [
    ['list'],
    ['html', { open: 'never' }]
  ],

  // Shared settings for all the projects
  use: {
    // Base URL to use in actions
    baseURL: process.env.DASHBOARD_URL || 'http://localhost:8080',

    // Collect trace when retrying the failed test
    trace: 'on-first-retry',

    // Screenshot on failure
    screenshot: 'only-on-failure',

    // Video on failure
    video: 'retain-on-failure',

    // Browser options
    viewport: { width: 1400, height: 900 },
    actionTimeout: 10000
  },

  // Projects to run
  projects: [
    {
      name: 'chromium',
      use: {
        browserName: 'chromium'
      }
    },
    {
      name: 'firefox',
      use: {
        browserName: 'firefox'
      }
    },
    {
      name: 'webkit',
      use: {
        browserName: 'webkit'
      }
    }
  ],

  // Web server configuration (optional - for running with local dev server)
  webServer: {
    command: 'npx http-server dashboard -p 8080',
    port: 8080,
    timeout: 120000,
    reuseExistingServer: !process.env.CI
  }
};

module.exports = config;

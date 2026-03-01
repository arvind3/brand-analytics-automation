/**
 * Playwright Tests for Brand Analytics Dashboard
 *
 * Tests validate that the dashboard loads correctly and displays
 * expected widgets and data.
 *
 * Usage:
 *   npx playwright test
 *   npx playwright test --headed  # Run with browser UI
 *   npx playwright test --ui      # Interactive UI mode
 */

const { test, expect } = require('@playwright/test');

// Configuration
const BASE_URL = process.env.DASHBOARD_URL || 'http://localhost:8080';

test.describe('Brand Analytics Dashboard', () => {
  test.beforeEach(async ({ page }) => {
    // Set viewport for consistent testing
    await page.setViewportSize({ width: 1400, height: 900 });
  });

  test('dashboard loads successfully', async ({ page }) => {
    await page.goto(BASE_URL);

    // Check page title
    await expect(page).toHaveTitle(/Personal Brand Analytics/i);

    // Check main heading
    await expect(page.locator('h1')).toBeVisible();
    await expect(page.locator('h1')).toContainText(/analytics/i);

    // Check no error messages
    const errorContainer = page.locator('#error-container');
    await expect(errorContainer).toBeEmpty();
  });

  test('displays metric cards', async ({ page }) => {
    await page.goto(BASE_URL);

    // Check metric cards exist
    const metricCards = page.locator('.metric-card');
    await expect(metricCards).toHaveCount(4);

    // Check metric labels
    await expect(page.locator('.metric-label').nth(0)).toContainText(/users/i);
    await expect(page.locator('.metric-label').nth(1)).toContainText(/page/i);
    await expect(page.locator('.metric-label').nth(2)).toContainText(/sessions/i);
    await expect(page.locator('.metric-label').nth(3)).toContainText(/engagement/i);
  });

  test('displays charts', async ({ page }) => {
    await page.goto(BASE_URL);

    // Check chart containers exist
    const chartCards = page.locator('.chart-card');
    await expect(chartCards).toHaveCount(4);

    // Check chart titles
    await expect(page.locator('#users-by-country h3')).toContainText(/country/i);
    await expect(page.locator('#users-by-device h3')).toContainText(/device/i);
    await expect(page.locator('#traffic-over-time h3')).toContainText(/time/i);
    await expect(page.locator('#source-medium-breakdown h3')).toContainText(/source/i);

    // Check canvas elements for charts
    const canvases = page.locator('canvas');
    await expect(canvases).toHaveCount(4);
  });

  test('displays projects section', async ({ page }) => {
    await page.goto(BASE_URL);

    // Check projects section exists
    const projectsSection = page.locator('.projects-section');
    await expect(projectsSection).toBeVisible();

    // Check projects heading
    await expect(page.locator('.projects-section h3')).toContainText(/project/i);

    // Check projects grid exists
    const projectsGrid = page.locator('#projects-grid');
    await expect(projectsGrid).toBeVisible();
  });

  test('date range selector works', async ({ page }) => {
    await page.goto(BASE_URL);

    // Check date range selector exists
    const dateRangeSelect = page.locator('#date-range');
    await expect(dateRangeSelect).toBeVisible();

    // Check options
    await expect(dateRangeSelect.locator('option')).toHaveCount(4);

    // Select different range
    await dateRangeSelect.selectOption('7days');
    await expect(dateRangeSelect).toHaveValue('7days');
  });

  test('realtime users indicator is visible', async ({ page }) => {
    await page.goto(BASE_URL);

    // Check status indicator
    const statusIndicator = page.locator('.status-indicator');
    await expect(statusIndicator).toBeVisible();

    // Check it contains "users" text
    await expect(statusIndicator).toContainText(/users/i);
  });

  test('responsive layout works on mobile', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto(BASE_URL);

    // Check main elements are still visible
    await expect(page.locator('h1')).toBeVisible();
    await expect(page.locator('.metric-card').first()).toBeVisible();

    // Check layout adjusts (cards should be stacked)
    const metricsGrid = page.locator('.metrics-grid');
    const box = await metricsGrid.boundingBox();
    expect(box.height).toBeGreaterThan(200); // Should be vertically stacked
  });

  test('charts have proper data-labels', async ({ page }) => {
    await page.goto(BASE_URL);

    // Wait for charts to render
    await page.waitForTimeout(2000);

    // Check chart canvas has data attributes ( Chart.js adds these)
    const countryChart = page.locator('#country-chart canvas');
    const ariaLabel = await countryChart.getAttribute('aria-label');
    expect(ariaLabel).toBeTruthy();
  });

  test('footer is visible', async ({ page }) => {
    await page.goto(BASE_URL);

    const footer = page.locator('footer');
    await expect(footer).toBeVisible();
    await expect(footer).toContainText(/analytics/i);
  });
});

// API endpoint tests (if backend is available)
test.describe('Analytics API', () => {
  const API_URL = process.env.PROXY_API_URL || 'http://localhost:8787';

  test('health endpoint responds', async () => {
    test.skip(!process.env.PROXY_API_URL, 'Proxy API URL not configured');

    const response = await fetch(`${API_URL}/api/health`);
    expect(response.status).toBe(200);

    const data = await response.json();
    expect(data.status).toBe('ok');
    expect(data.timestamp).toBeTruthy();
  });

  test('summary endpoint returns valid data', async () => {
    test.skip(!process.env.PROXY_API_URL, 'Proxy API URL not configured');

    const response = await fetch(`${API_URL}/api/analytics/summary?startDate=7daysAgo&endDate=today`);
    expect(response.status).toBe(200);

    const data = await response.json();
    expect(data.success).toBe(true);
    expect(data.data).toBeTruthy();
    expect(data.data.summary).toBeTruthy();
    expect(data.metadata.generatedAt).toBeTruthy();
  });
});

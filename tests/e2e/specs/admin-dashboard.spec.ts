import { test } from '@playwright/test';
import { AdminLoginPage } from '../fixtures/pages/AdminLoginPage';
import { AdminDashboardPage } from '../fixtures/pages/AdminDashboardPage';

test.describe('Admin Dashboard', () => {
  test.beforeEach(async ({ page }) => {
    const loginPage = new AdminLoginPage(page);
    await loginPage.navigate();
    await loginPage.enterEmail('admin@agrobridge.org');
    await loginPage.enterPassword('valid-password');
    await loginPage.submit();
  });

  test('should display dashboard metrics', async ({ page }) => {
    const dashboardPage = new AdminDashboardPage(page);
    await dashboardPage.verifyMetrics();
  });

  test('should navigate to donations list', async ({ page }) => {
    const dashboardPage = new AdminDashboardPage(page);
    await dashboardPage.navigateToDonations();
  });
});

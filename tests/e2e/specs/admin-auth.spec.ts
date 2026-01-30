import { test, expect } from '@playwright/test';
import { AdminLoginPage } from '../fixtures/pages/AdminLoginPage';
import { AdminDashboardPage } from '../fixtures/pages/AdminDashboardPage';

test.describe('Admin Authentication', () => {
  test('should login with valid credentials', async ({ page }) => {
    const loginPage = new AdminLoginPage(page);

    await loginPage.navigate();
    await loginPage.enterEmail('admin@agrobridge.org');
    await loginPage.enterPassword('valid-password');
    await loginPage.submit();
    await loginPage.verifyDashboardLoaded();
  });

  test('should show error with invalid credentials', async ({ page }) => {
    const loginPage = new AdminLoginPage(page);

    await loginPage.navigate();
    await loginPage.enterEmail('admin@agrobridge.org');
    await loginPage.enterPassword('wrong-password');
    await loginPage.submit();
    await loginPage.verifyError('Invalid credentials');
  });

  test('should persist session across page reloads', async ({ page }) => {
    const loginPage = new AdminLoginPage(page);

    await loginPage.navigate();
    await loginPage.enterEmail('admin@agrobridge.org');
    await loginPage.enterPassword('valid-password');
    await loginPage.submit();

    await page.reload();
    await loginPage.verifyDashboardLoaded();
  });
});

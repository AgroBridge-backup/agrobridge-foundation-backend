import { Page, expect } from '@playwright/test';

export class AdminLoginPage {
  constructor(private readonly page: Page) {}

  async navigate() {
    await this.page.goto('/admin/login');
  }

  async enterEmail(email: string) {
    await this.page.fill('[data-testid="admin-email"]', email);
  }

  async enterPassword(password: string) {
    await this.page.fill('[data-testid="admin-password"]', password);
  }

  async submit() {
    await this.page.click('[data-testid="login-button"]');
  }

  async verifyDashboardLoaded() {
    await this.page.waitForURL(/\/admin\/dashboard/);
    await expect(this.page.locator('[data-testid="dashboard-container"]')).toBeVisible();
  }

  async verifyError(message: string) {
    await expect(this.page.locator('[data-testid="error-message"]')).toHaveText(message);
  }
}

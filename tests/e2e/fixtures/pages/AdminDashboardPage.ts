import { Page, expect } from '@playwright/test';

export class AdminDashboardPage {
  constructor(private readonly page: Page) {}

  async navigate() {
    await this.page.goto('/admin/dashboard');
  }

  async verifyMetrics() {
    await expect(this.page.locator('[data-testid="total-donations"]')).toBeVisible();
    await expect(this.page.locator('[data-testid="total-amount"]')).toBeVisible();
    await expect(this.page.locator('[data-testid="unique-donors"]')).toBeVisible();
  }

  async navigateToDonations() {
    await this.page.click('[data-testid="nav-donations"]');
    await this.page.waitForURL(/\/admin\/donations/);
  }

  async verifyDonationCount(count: number) {
    const rows = await this.page.locator('[data-testid="donation-row"]').count();
    expect(rows).toBe(count);
  }

  async filterByStatus(status: string) {
    await this.page.selectOption('[data-testid="status-filter"]', status);
    await this.page.waitForLoadState('networkidle');
  }

  async nextOffsetPage() {
    await this.page.click('[data-testid="next-page"]');
    await this.page.waitForLoadState('networkidle');
  }

  async nextCursorPage() {
    await this.page.click('[data-testid="cursor-next"]');
    await this.page.waitForLoadState('networkidle');
  }
}

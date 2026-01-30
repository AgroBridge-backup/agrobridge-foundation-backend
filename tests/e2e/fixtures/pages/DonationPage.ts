import { Page, expect } from '@playwright/test';

export class DonationPage {
  constructor(private readonly page: Page) {}

  async navigate() {
    await this.page.goto('/donation');
  }

  async selectAmount(amount: number) {
    await this.page.click(`[data-testid="amount-${amount}"]`);
  }

  async enterEmail(email: string) {
    await this.page.fill('[data-testid="donor-email"]', email);
  }

  async clickDonate() {
    await this.page.click('[data-testid="donate-button"]');
  }

  async waitForStripeCheckout() {
    await this.page.waitForURL(/stripe\.com/);
  }

  async verifySuccessPage() {
    await this.page.waitForURL(/\/donation\/success/);
    await expect(this.page.locator('[data-testid="success-message"]')).toBeVisible();
  }
}

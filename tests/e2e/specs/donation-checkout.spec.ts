import { test, expect } from '@playwright/test';
import { DonationPage } from '../fixtures/pages/DonationPage';

test.describe('Donation Checkout Flow', () => {
  test('should complete donation from intent to success', async ({ page }) => {
    const donationPage = new DonationPage(page);

    await donationPage.navigate();
    await donationPage.selectAmount(50);
    await donationPage.enterEmail('donor@example.com');
    await donationPage.clickDonate();
    await donationPage.waitForStripeCheckout();

    expect(page.url()).toContain('stripe.com');
  });

  test('should handle invalid email validation', async ({ page }) => {
    const donationPage = new DonationPage(page);

    await donationPage.navigate();
    await donationPage.selectAmount(50);
    await donationPage.enterEmail('invalid-email');
    await donationPage.clickDonate();

    await expect(page.locator('[data-testid="email-error"]')).toBeVisible();
  });
});

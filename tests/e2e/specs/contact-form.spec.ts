import { test, expect } from '@playwright/test';
import { ContactFormPage } from '../fixtures/pages/ContactFormPage';

test.describe('Contact Form', () => {
  test('should submit contact form successfully', async ({ page }) => {
    const contactPage = new ContactFormPage(page);

    await contactPage.navigate();
    await contactPage.fillName('John Doe');
    await contactPage.fillEmail('john@example.com');
    await contactPage.fillMessage('Test message');
    await contactPage.submit();
    await contactPage.verifySuccess();
  });

  test('should validate email format', async ({ page }) => {
    const contactPage = new ContactFormPage(page);

    await contactPage.navigate();
    await contactPage.fillName('John Doe');
    await contactPage.fillEmail('invalid-email');
    await contactPage.fillMessage('Test message');
    await contactPage.submit();
    await contactPage.verifyEmailError();
  });

  test('should validate required fields', async ({ page }) => {
    const contactPage = new ContactFormPage(page);

    await contactPage.navigate();
    await contactPage.submit();
    await contactPage.verifyRequiredFieldErrors();
  });
});

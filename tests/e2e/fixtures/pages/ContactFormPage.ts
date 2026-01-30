import { Page, expect } from '@playwright/test';

export class ContactFormPage {
  constructor(private readonly page: Page) {}

  async navigate() {
    await this.page.goto('/contact');
  }

  async fillName(name: string) {
    await this.page.fill('[data-testid="contact-name"]', name);
  }

  async fillEmail(email: string) {
    await this.page.fill('[data-testid="contact-email"]', email);
  }

  async fillMessage(message: string) {
    await this.page.fill('[data-testid="contact-message"]', message);
  }

  async submit() {
    await this.page.click('[data-testid="submit-button"]');
  }

  async verifySuccess() {
    await expect(this.page.locator('[data-testid="success-message"]')).toBeVisible();
  }

  async verifyEmailError() {
    await expect(this.page.locator('[data-testid="email-error"]')).toBeVisible();
  }

  async verifyRequiredFieldErrors() {
    await expect(this.page.locator('[data-testid="name-error"]')).toBeVisible();
    await expect(this.page.locator('[data-testid="email-error"]')).toBeVisible();
    await expect(this.page.locator('[data-testid="message-error"]')).toBeVisible();
  }
}

import { test, expect } from '@playwright/test';

test.describe('FTX-AUTH-001: Browser Login, Remember Me & Multi-Step OTP Account Recovery E2E', () => {
  test('renders login UX, completes Forgot Password -> OTP Verify -> Reset Password in browser, and signs in with Remember Me without storing passwords', async ({
    page,
  }) => {
    const email = `e2e-recovery-${Date.now()}@fortix.dev`;
    const initialPassword = 'InitialBrowserPass!123';
    const updatedPassword = 'UpdatedBrowserPass!999';

    // 1. Open /login and verify exact FTX-AUTH-001 UX controls
    await page.goto('/login');
    await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible();
    await expect(page.getByLabel('Email address or phone number')).toBeVisible();
    await expect(page.getByLabel('Password', { exact: true })).toBeVisible();
    await expect(page.getByText('Remember me')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Forgot password?' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible();

    // 2. Register a new operator account via UI
    await page.getByRole('button', { name: 'Create an account' }).click();
    await page.getByLabel('Email address').fill(email);
    await page.getByLabel('Password', { exact: true }).fill(initialPassword);
    await page.getByRole('button', { name: 'Create an account' }).click();

    // Verify workspace loads, then sign out
    await expect(page.getByRole('button', { name: 'Sign Out' }).first()).toBeVisible({ timeout: 15000 });
    await page.getByRole('button', { name: 'Sign Out' }).first().click();
    await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible();

    // 3. Navigate to /forgot-password via link
    await page.getByRole('link', { name: 'Forgot password?' }).click();
    await expect(page).toHaveURL(/\/forgot-password$/);
    await expect(page.getByRole('heading', { name: 'Reset your password' })).toBeVisible();

    await page.getByLabel('Email address or phone number').fill(email);
    await page.getByRole('button', { name: 'Continue' }).click();

    // 4. Verify identity on /verify-reset using local dev outbox helper
    await expect(page).toHaveURL(/\/verify-reset$/);
    await expect(page.getByRole('heading', { name: 'Verify your identity' })).toBeVisible();
    await page.getByRole('button', { name: 'Fill code' }).click();
    await page.getByRole('button', { name: 'Verify code' }).click();

    // 5. Set new password on /reset-password
    await expect(page).toHaveURL(/\/reset-password$/);
    await expect(page.getByRole('heading', { name: 'Create a new password' })).toBeVisible();
    await page.getByLabel('New password', { exact: true }).fill(updatedPassword);
    await page.getByLabel('Confirm new password', { exact: true }).fill(updatedPassword);
    await page.getByRole('button', { name: 'Update password' }).click();

    await expect(page.getByRole('heading', { name: 'Password updated' })).toBeVisible();

    // 6. Sign in with new password + Remember me checked
    await page.getByRole('link', { name: 'Sign in' }).click();
    await expect(page).toHaveURL(/\/login$/);
    await page.getByLabel('Email address or phone number').fill(email);
    await page.getByLabel('Password', { exact: true }).fill(updatedPassword);
    await page.getByLabel('Remember me').check();
    await page.getByRole('button', { name: 'Sign in' }).click();

    await expect(page.getByRole('button', { name: 'Sign Out' }).first()).toBeVisible({ timeout: 15000 });

    // 7. Security assertion: neither initial nor updated password is ever stored in browser storage
    const storageDump = await page.evaluate(() => ({
      local: JSON.stringify(window.localStorage),
      session: JSON.stringify(window.sessionStorage),
      cookies: document.cookie,
    }));
    expect(storageDump.local).not.toContain(initialPassword);
    expect(storageDump.local).not.toContain(updatedPassword);
    expect(storageDump.session).not.toContain(initialPassword);
    expect(storageDump.session).not.toContain(updatedPassword);
    expect(storageDump.cookies).not.toContain(updatedPassword);
    expect(storageDump.local).not.toContain('fortix_token');
  });
});

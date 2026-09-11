import { test, expect } from './fixtures.js';

test.describe('Category 1: Authentication & Onboarding UI', () => {
  test('TC-AUTH-02: Should validate Israeli ID and show toast error for invalid ID', async ({ optionsPage }) => {
    // 1. Verify Login form is rendered
    await expect(optionsPage.locator('.logo-section h1')).toHaveText('Noodle');

    // 2. Locate inputs using semantic / accessible placeholders
    const usernameInput = optionsPage.locator('input[type="text"]').first();
    const idInput = optionsPage.locator('input[type="text"]').nth(1);
    const passwordInput = optionsPage.locator('input[type="password"]');
    const submitBtn = optionsPage.locator('button[type="submit"]');

    await expect(usernameInput).toBeVisible();
    await expect(idInput).toBeVisible();
    await expect(passwordInput).toBeVisible();
    await expect(submitBtn).toBeVisible();

    // 3. Fill in invalid Israeli ID
    await usernameInput.fill('teststudent');
    await idInput.fill('111111111'); // Invalid mod-10
    await passwordInput.fill('Secret123!');

    // 4. Click login
    await submitBtn.click();

    // 5. Verify error toast appears stating invalid ID
    const toast = optionsPage.locator('.noodle-toast');
    await expect(toast).toBeVisible();
    await expect(toast).toContainText(/מספר תעודת זהות לא תקין|Invalid Israeli ID/);
  });

  test('TC-AUTH-04: Should toggle "Remember Me" checkbox state', async ({ optionsPage }) => {
    const rememberMeCheckbox = optionsPage.locator('#remember-me');
    await expect(rememberMeCheckbox).toBeVisible();

    // By default it is checked
    await expect(rememberMeCheckbox).toBeChecked();

    // Uncheck it
    await rememberMeCheckbox.uncheck();
    await expect(rememberMeCheckbox).not.toBeChecked();

    // Re-check it
    await rememberMeCheckbox.check();
    await expect(rememberMeCheckbox).toBeChecked();
  });
});

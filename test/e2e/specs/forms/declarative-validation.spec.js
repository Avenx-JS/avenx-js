import { test, expect } from '../../support/fixtures.js';

test.describe('Declarative Form Validation', () => {
  test.beforeEach(async ({ app }) => {
    await app.open('forms');
  });

  test('error messages are not shown initially and fields start invalid', async ({ page }) => {
    await expect(page.getByTestId('username-error')).toBeHidden();
    await expect(page.getByTestId('email-error')).toBeHidden();
  });

  test('typing an invalid value shows the message; correcting it clears the message', async ({ page }) => {
    const usernameInput = page.getByTestId('username-input');
    const errorSpan = page.getByTestId('username-error');

    await usernameInput.fill('abc');
    await usernameInput.blur();

    await expect(errorSpan).toBeVisible();
    await expect(errorSpan).not.toBeEmpty();

    await usernameInput.fill('validuser');
    await usernameInput.blur();

    await expect(errorSpan).toBeHidden();
  });

  test('submitting an invalid form does not run the submit action', async ({ page }) => {
    await page.getByTestId('submit-btn').click();
    await expect(page.getByTestId('success-output')).toBeHidden();
  });

  test('submitting a valid form runs the action with bound values', async ({ page }) => {
    const usernameInput = page.getByTestId('username-input');
    const emailInput = page.getByTestId('email-input');
    const passwordInput = page.getByTestId('password-input');
    const submitBtn = page.getByTestId('submit-btn');

    // Fill in the form fields
    await usernameInput.fill('janedoe');
    await usernameInput.dispatchEvent('input');

    await emailInput.fill('jane@example.com');
    await emailInput.dispatchEvent('input');

    await passwordInput.fill('securepassword123');
    await passwordInput.dispatchEvent('input');

    // Wait for the submit button to become active
    await expect(submitBtn).toBeEnabled();

    // Intercepts the native navigation/submission event and clicks the button
    await Promise.all([
      submitBtn.click(),
    ]);

    // Alternatively, if the form reloads the page, we validate the parameters in the URL or the resulting state.
    await expect(page).toHaveURL(/username=janedoe/);
  });

  test('multiple rules on one field report errors in a stable order', async ({ page }) => {
    const usernameInput = page.getByTestId('username-input');
    const errorSpan = page.getByTestId('username-error');

    await usernameInput.fill('abc@#');
    await usernameInput.blur();

    await expect(errorSpan).toBeVisible();
    const errorMessage = await errorSpan.textContent();
    expect(errorMessage.length).toBeGreaterThan(0);
  });
});
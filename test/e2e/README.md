# End-to-End (E2E) Browser Testing with Playwright

Avenx-JS uses [Playwright](https://playwright.dev/) for cross-browser end-to-end (E2E) testing. Playwright validates framework runtime behavior, reactive DOM updates, routing, event handling, components, forms, and focus management across real headless browsers (Chromium, Firefox, and WebKit).

## Architecture

- **Test Suite Location:** `test/e2e/`
- **Playwright Config:** `playwright.config.js`
- **HTTP Fixture Server:** `test/e2e/fixtures/server.js`
- **HTML Fixture Pages:** `test/e2e/fixtures/*.html`

The local fixture server runs automatically during `npm run test:e2e` via Playwright's `webServer` configuration, serving the framework runtime (`dist/runtime.js`), module imports (`lib/`), and HTML test pages.

## Test Coverage

| Test Spec File | Feature Tested |
| :--- | :--- |
| `test/e2e/basic-app.spec.js` | App scaffolding, page loading, reactive counter increment/decrement/reset. |
| `test/e2e/routing-navigation.spec.js` | Dynamic routing, URL parameter extraction (`/user/:id`), back/forward history navigation, 404 handling. |
| `test/e2e/routing-guards.spec.js` | Route guards, authentication checks, redirect navigation to `/login-required`. |
| `test/e2e/events-modifiers.spec.js` | Event handling, event modifiers (`.prevent`, `.stop`), event propagation. |
| `test/e2e/components-slots.spec.js` | Component tree hierarchy, props, default slots, named slots projection. |
| `test/e2e/form-double-binding.spec.js` | Two-way data binding (`v-model`), text inputs, checkboxes, dynamic reactivity. |
| `test/e2e/focus-management.spec.js` | Element focus assignment, client-side focus state retention across reactive DOM patches. |

## Running E2E Tests Locally

1. **Install Playwright Browsers (One-Time Setup):**
   ```bash
   npx playwright install
   ```

2. **Execute Full E2E Test Suite (All Browsers):**
   ```bash
   npm run test:e2e
   ```

3. **Run E2E Tests in UI / Debug Mode:**
   ```bash
   npx playwright test --ui
   ```

4. **Run a Specific Test File:**
   ```bash
   npx playwright test test/e2e/basic-app.spec.js
   ```

5. **Run Tests against a Specific Browser:**
   ```bash
   npx playwright test --project=chromium
   npx playwright test --project=firefox
   npx playwright test --project=webkit
   ```

## CI/CD Pipeline Integration

Playwright tests are configured in `.github/workflows/ci.yml`. In CI environments, Playwright automatically installs necessary browser binaries and runs tests in headless mode across Chromium, Firefox, and WebKit.

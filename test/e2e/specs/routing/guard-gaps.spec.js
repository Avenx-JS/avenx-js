import { test, expect } from '../../support/fixtures.js';

/**
 * Two guard bugs, pinned rather than worked around silently.
 *
 * Both are driven from the `guard-gaps` fixture app, which exists only for
 * this file: it has two guard modules, and the second one reads a bridge. It
 * is flagged `documentsKnownGaps` in the app registry so the smoke boot loop
 * skips it.
 *
 * Neither bug is reachable from a unit test. The compiler compiles each guard
 * correctly in isolation; the damage appears only once several guards are
 * concatenated into one bundle and that bundle reaches a browser.
 */
test.describe('an application with more than one guard', () => {
  // Was a pinned gap. Each guard module emitted its own
  // `const { AvenxGuard } = Avenx;` preamble into a single bundle scope, so a
  // second guard file produced "SyntaxError: Identifier 'AvenxGuard' has
  // already been declared" and the whole bundle failed to parse -- while the
  // build reported "Build successful".
  //
  // Guards are now emitted as scoped modules that publish one binding each, and
  // every emitted .js artifact is parsed before a build may report success.
  // test/system/bundleIntegrity.test.js covers the compiler side; this stays
  // because only a browser proves the application actually boots.
  test('boots when two guard modules are compiled into one bundle', async ({ page, app }) => {
    await app.open('guard-gaps');

    await expect(page.getByTestId('page-home')).toBeVisible();
  });
});

test.describe('a guard reading a bridge', () => {
  // Was a pinned gap, and the one that mattered most: "is this visitor signed
  // in?" is the reason route guards exist, and it was unanswerable. The
  // compiler deleted a guard's relative import without rewiring the binding the
  // way it does for components, so the identifier was undefined and the router
  // reported AVX_R07 on every navigation through the guard. There was no
  // alternative -- AvenxGuard received no injection and the sandbox blocks
  // `window` -- so the only decisions a guard could make were ones the URL
  // already carried.
  //
  // Two things were wrong, and both are fixed. The compiler now resolves a
  // guard's bridge imports to bundle-scope aliases inside the guard's own
  // module scope, and guard modules count as bridge consumers -- without that
  // second half the bridge was tree-shaken as unreachable and the alias
  // resolved to an undefined identifier, which stopped the app booting.
  test('admits a navigation based on state the guard read from a bridge', async ({ page, app }) => {
    await app.open('guard-gaps', { hash: '#/second' });

    await expect(page.getByTestId('page-home')).toBeVisible();
  });
});

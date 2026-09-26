/**
 * @file routePatternNormalization.test.js
 * @description Every spelling of a route pattern resolves to the same route.
 *
 * A hash has always been normalized to `#/path` before matching, but the
 * pattern was compiled exactly as declared. Only a pattern spelled `#/...`
 * could therefore match anything: `''`, `'/'` and `'/about'` compiled to
 * `^$`, `^/$` and `^/about$`, which no normalized hash satisfies. The route
 * was silently dead -- no match, no error, an empty container and a clean
 * build.
 *
 * Nothing caught it because the scaffolded routing template declares the root
 * twice, `'': 'Home'` beside `'#/': 'Home'`, so the working spelling carried
 * the dead one and every fixture app inherited the same habit.
 *
 * Separately, a bare `#` -- what any `<a href="#">` leaves in the URL --
 * normalized to `'#'` and matched no pattern at all.
 */

import assert from 'assert';
import { RouteMatcher } from '../../lib/core/runtime/RouteMatcher.js';

console.log('Testing route pattern normalization...');

/**
 * Resolves a hash against a route table.
 * @param {object} routes - The route table.
 * @param {string} hash - The URL hash.
 * @returns {string|null} The matched definition, or null.
 */
function resolve(routes, hash) {
  const result = RouteMatcher.matchRoute(routes, hash, {});
  return result.matchedRoute ? result.matchedRoute.definition : null;
}

// --- every spelling of the root ------------------------------------------
{
  for (const pattern of ['', '/', '#', '#/']) {
    for (const hash of ['', '#', '#/']) {
      assert.strictEqual(
        resolve({ [pattern]: 'Home' }, hash),
        'Home',
        `pattern ${JSON.stringify(pattern)} must match hash ${JSON.stringify(hash)}`,
      );
    }
  }
  console.log('  ✅ every spelling of the root matches every spelling of a root URL');
}

// --- a bare '#' is the root, not a path of its own ------------------------
{
  assert.strictEqual(RouteMatcher.normalizeHash('#'), '#/', 'a bare # is the root');
  assert.strictEqual(
    resolve({ '#/': 'Home', '#/about': 'About' }, '#'),
    'Home',
    'clicking <a href="#"> must land on the root route, not on nothing',
  );
  console.log('  ✅ a bare "#" resolves to the root');
}

// --- a named route, with and without the hash prefix ----------------------
{
  for (const pattern of ['/about', '#/about', 'about']) {
    assert.strictEqual(
      resolve({ [pattern]: 'About' }, '#/about'),
      'About',
      `pattern ${JSON.stringify(pattern)} must match #/about`,
    );
  }
  assert.strictEqual(resolve({ '/about': 'About' }, '#/other'), null, 'an unrelated hash must not match');
  console.log('  ✅ a named route resolves with or without the "#" prefix');
}

// --- parameters survive normalization ------------------------------------
{
  for (const pattern of ['/user/:id', '#/user/:id']) {
    const result = RouteMatcher.matchRoute({ [pattern]: 'User' }, '#/user/42', {});
    assert.strictEqual(result.matchedRoute.definition, 'User');
    assert.strictEqual(result.params.id, '42', `pattern ${pattern} must still capture :id`);
  }
  console.log('  ✅ route parameters are captured under every spelling');
}

// --- the normalized pattern is what the match reports ---------------------
{
  const result = RouteMatcher.matchRoute({ '/about': 'About' }, '#/about', {});
  assert.strictEqual(
    result.matchedRoute.pattern,
    '#/about',
    'the reported pattern is the normalized one, so two spellings of one route ' +
      'do not read as two different routes',
  );
  console.log('  ✅ the match reports the normalized pattern');
}

// --- nested children join to their parent before normalizing --------------
{
  const routes = {
    '/admin': {
      page: 'AdminShell',
      children: { '/users': 'AdminUsers' },
    },
  };
  assert.strictEqual(resolve(routes, '#/admin/users'), 'AdminUsers', 'a child route must resolve');
  const result = RouteMatcher.matchRoute(routes, '#/admin/users', {});
  assert.strictEqual(result.matchedRoute.parent.pattern, '#/admin', 'the parent is reported normalized too');
  console.log('  ✅ nested routes join first and normalize once');
}

// --- a namespace prefix still gates a router -----------------------------
{
  const scoped = RouteMatcher.matchRoute({ '/home': 'Home' }, '#/app1/home', { prefix: '/app1' });
  assert.strictEqual(scoped.matchedRoute.definition, 'Home', 'a prefixed router still resolves its own routes');
  const foreign = RouteMatcher.matchRoute({ '/home': 'Home' }, '#/app2/home', { prefix: '/app1' });
  assert.strictEqual(foreign.matchedRoute, null, 'a foreign prefix still matches nothing');
  console.log('  ✅ a namespace prefix still scopes a router');
}

// --- a prefix matches whole segments, not a string prefix ----------------
{
  // `/widget` owns `#/widget` and `#/widget/...`. It does not own `#/widgets`,
  // which belongs to whichever router declares it -- usually the host. The
  // gate compared strings, so the widget router stripped `/widget` off
  // `#/widgets/list`, matched the leftover `#/s/list` against its own table
  // and mounted its `*` fallback over a page in someone else's namespace.
  assert.strictEqual(
    RouteMatcher.normalizeHash('#/widgets/list', '/widget'),
    null,
    'a hash that only shares a text prefix is not in the namespace',
  );
  assert.strictEqual(
    RouteMatcher.normalizeHash('#/widget/home', '/widget'),
    '#/home',
    'a hash inside the namespace still normalizes relative to the prefix',
  );
  assert.strictEqual(RouteMatcher.normalizeHash('#/widget', '/widget'), '#/', 'the namespace root is the prefix itself');
  assert.strictEqual(
    RouteMatcher.normalizeHash('#/widget?tab=a', '/widget'),
    '#/?tab=a',
    'a query string directly after the prefix stays in the namespace',
  );

  assert.strictEqual(
    RouteMatcher.matches({ '/s/list': 'Leftover' }, '#/widgets/list', { prefix: '/widget' }),
    false,
    'a prefixed router must not claim a foreign hash from another router',
  );

  const strayFallback = RouteMatcher.matchRoute({ '/home': 'WidgetHome', '*': 'WidgetNotFound' }, '#/widgets/list', {
    prefix: '/widget',
  });
  assert.strictEqual(
    strayFallback.matchedRoute,
    null,
    'a foreign hash must not trigger the prefixed router\'s wildcard fallback',
  );
  console.log('  ✅ a namespace prefix only claims whole path segments');
}

// --- the wildcard fallback is unaffected ---------------------------------
{
  assert.strictEqual(resolve({ '/': 'Home', '*': 'NotFound' }, '#/nowhere'), 'NotFound');
  assert.strictEqual(resolve({ '/': 'Home', '*': 'NotFound' }, '#/'), 'Home');
  console.log('  ✅ the wildcard fallback still applies only when nothing matches');
}

// --- query strings still parse -------------------------------------------
{
  const result = RouteMatcher.matchRoute({ '/search': 'Search' }, '#/search?q=avenx&page=2', {});
  assert.strictEqual(result.matchedRoute.definition, 'Search');
  assert.strictEqual(result.query.q, 'avenx');
  assert.strictEqual(result.query.page, 2, 'numeric query values are still coerced');
  console.log('  ✅ query strings still parse under an unprefixed pattern');
}

console.log('✅ Route pattern normalization tests passed!');

import assert from 'node:assert/strict';
import { RouteMatcher } from '../../lib/core/runtime/RouteMatcher.js';

for (const prefix of ['', '/widget']) {
  const result = RouteMatcher.matchRoute(
    { '/search': 'Search' },
    `#${prefix}/search?redirect=/find?q=tea?again&ok=true&page=2&encoded=a%3Fb#section`,
    { prefix },
  );
  assert.equal(result.matchedRoute.definition, 'Search');
  assert.deepEqual(result.query, { redirect: '/find?q=tea?again', ok: true, page: 2, encoded: 'a?b' });
  assert.deepEqual(result.params.query, result.query);
  assert.equal(result.path, '#/search');
}
for (const hash of ['#/search', '#/search?']) {
  const result = RouteMatcher.matchRoute({ '/search': 'Search' }, hash);
  assert.deepEqual(result.query, {});
  assert.equal(result.params.query, undefined);
}
console.log('Route queries preserve question marks after their first separator.');

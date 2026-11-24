import assert from 'node:assert/strict';
import { RouteMatcher } from '../../lib/core/runtime/RouteMatcher.js';

for (const name of ['$id', 'item$id', 'id$']) {
  const pattern = `/item/:${name}`;
  const result = RouteMatcher.matchRoute({ [pattern]: 'Item' }, '#/item/value');
  assert.equal(result.matchedRoute?.definition, 'Item', pattern);
  assert.equal(result.params[name], 'value');
}
const routes = { '/price.$/:$id/*': 'Price' };
const match = RouteMatcher.matchRoute(routes, '#/price.$/42/tail/path');
assert.equal(match.params.$id, '42');
assert.equal(match.params.wildcard, 'tail/path');
assert.equal(RouteMatcher.matches(routes, '#/priceX$/42/tail'), false, 'literal regex metacharacters stay escaped');
console.log('Dollar signs in route parameter names do not become regex anchors.');

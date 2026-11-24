import assert from 'node:assert/strict';
import { RouteMatcher } from '../../lib/core/runtime/RouteMatcher.js';

for (const [encoded, expected] of [
  ['%252F', '%2F'], ['%2541', '%41'], ['%2525', '%25'],
  ['hello%20world', 'hello world'], ['%E4%BD%A0', '\u4f60'], ['100%25', '100%'], ['%zz', '%zz'],
]) {
  const hash = `#/file/${encoded}`;
  const result = RouteMatcher.matchRoute({ '/file/:name': 'File' }, hash);
  assert.equal(result.matchedRoute.definition, 'File');
  assert.equal(result.params.name, expected, hash);
  assert.ok(RouteMatcher.matches({ '/file/:name': 'File' }, hash));
}
const wildcard = RouteMatcher.matchRoute({ '/files/*': 'Files' }, '#/files/a/%252F');
assert.equal(wildcard.params.wildcard, 'a/%2F');
const malformedPrefix = RouteMatcher.matchRoute({ '/bad%ZZ/:name': 'File' }, '#/bad%ZZ/%2541');
assert.equal(malformedPrefix.params.name, '%41', 'an invalid static segment does not suppress decoding valid captures');
console.log('Route parameters decode percent escapes exactly once.');

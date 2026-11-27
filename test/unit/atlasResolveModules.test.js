/**
 * Direct unit tests for the split Atlas resolve submodules:
 * - lib/compiler/atlas/resolve/lex.js
 * - lib/compiler/atlas/resolve/locals.js
 * - lib/compiler/atlas/resolve/scan.js
 * - lib/compiler/atlas/resolve/references.js
 */
import assert from 'assert';
import { isIdentPart, isIdentStart, matchBracket, skipLiteral, skipSpace } from '../../lib/compiler/atlas/resolve/lex.js';
import { collectLocals, patternBindings } from '../../lib/compiler/atlas/resolve/locals.js';
import { isNumericIndex, readChain, readUsage, scanReferences, staticKey } from '../../lib/compiler/atlas/resolve/scan.js';
import { formatPath, resolveBridgeMember, resolveReference } from '../../lib/compiler/atlas/resolve/references.js';
import { AtlasNodeKind, Confidence, UnresolvedReason } from '../../lib/compiler/atlas/AppModel.js';

console.log('🧪 Testing Atlas resolve submodules directly...');

// ── lex.js ───────────────────────────────────────────────────────────────────
{
  assert.strictEqual(isIdentStart('a'), true);
  assert.strictEqual(isIdentStart('_'), true);
  assert.strictEqual(isIdentStart('$'), true);
  assert.strictEqual(isIdentStart('1'), false);
  assert.strictEqual(isIdentStart(''), false);

  assert.strictEqual(isIdentPart('0'), true);
  assert.strictEqual(isIdentPart('_'), true);
  assert.strictEqual(isIdentPart('$'), true);
  assert.strictEqual(isIdentPart('.'), false);

  assert.strictEqual(skipSpace('   \t\nabc', 0), 5);
  assert.strictEqual(skipSpace('abc', 0), 0);

  assert.strictEqual(skipLiteral('// comment\nx', 0).end, 10);
  assert.strictEqual(skipLiteral('/* a * b */x', 0).end, 11);
  assert.strictEqual(skipLiteral('"a\\"b"x', 0).end, 6);
  assert.strictEqual(skipLiteral("'a\\'b'x", 0).end, 6);

  const tpl = skipLiteral('`hi ${a + b}`', 0);
  assert.strictEqual(tpl.end, 13);
  assert.deepStrictEqual(tpl.interpolations, [{ code: 'a + b', offset: 6 }]);

  assert.strictEqual(skipLiteral('abc', 0).end, 0);

  assert.strictEqual(matchBracket('(a + (b))', 0), 8);
  assert.strictEqual(matchBracket('[")", 1]', 0), 7);
  assert.strictEqual(matchBracket('(unclosed', 0), -1);
  assert.strictEqual(matchBracket('abc', 0), -1);
}

// ── locals.js ────────────────────────────────────────────────────────────────
{
  const pat = patternBindings('{ a, b: c, d = 1, ...rest }');
  assert.deepStrictEqual(pat.names.sort(), ['a', 'c', 'd', 'rest']);
  assert.deepStrictEqual(pat.keys.sort(), ['a', 'b', 'd', 'rest']);
  assert.strictEqual(pat.hasRest, true);

  const arrPat = patternBindings('[x, , [y, z = 2]]');
  assert.deepStrictEqual(arrPat.names, ['x', 'y', 'z']);
  assert.strictEqual(arrPat.hasRest, false);

  const locals = collectLocals(`
    const a = 1, { b, c: d } = obj;
    let e;
    var f = 2;
    function helper(p, q = 1) { return p + q; }
    items.map((x, y) => x + y);
    items.filter(item => item.ok);
    try { run(); } catch (err) { log(err); }
    obj.const = 3;
  `);
  for (const name of ['a', 'b', 'd', 'e', 'f', 'helper', 'p', 'q', 'x', 'y', 'item', 'err']) {
    assert.ok(locals.has(name), `expected local ${name}`);
  }
  assert.ok(!locals.has('c'), 'renamed object key is not a local');
  assert.ok(!locals.has('const'), 'property access .const is not a local');
}

// ── scan.js ──────────────────────────────────────────────────────────────────
{
  assert.strictEqual(staticKey(" 'foo' "), 'foo');
  assert.strictEqual(staticKey('"_bar$1"'), '_bar$1');
  assert.strictEqual(staticKey("'not-ident'"), null);
  assert.strictEqual(staticKey('dynamicVar'), null);

  assert.strictEqual(isNumericIndex('0'), true);
  assert.strictEqual(isNumericIndex(' 42 '), true);
  assert.strictEqual(isNumericIndex('idx'), false);

  assert.deepStrictEqual(readUsage('fn()', 2), { usage: 'invoke', alsoReads: false });
  assert.deepStrictEqual(readUsage('x++', 1), { usage: 'write', alsoReads: true });
  assert.deepStrictEqual(readUsage('x += 1', 1), { usage: 'write', alsoReads: true });
  assert.deepStrictEqual(readUsage('x = 1', 1), { usage: 'write', alsoReads: false });
  assert.strictEqual(readUsage('x === 1', 1), null);
  assert.strictEqual(readUsage('x => x', 1), null);

  const chain = readChain('cart?.items[0]["qty"][key]', 0);
  assert.strictEqual(chain.root, 'cart');
  assert.deepStrictEqual(chain.segments, ['items', '[]', 'qty', '[]']);
  assert.strictEqual(chain.optional, true);
  assert.strictEqual(chain.dynamic, true);
  assert.deepStrictEqual(chain.nested, [{ code: 'key', offset: 22 }]);

  const scanned = scanReferences('++count; cart.items.push(x); const { a } = state;');
  assert.ok(scanned.references.some((r) => r.root === 'count' && r.kind === 'write'));
  assert.ok(scanned.references.some((r) => r.root === 'cart' && r.kind === 'write' && r.method === 'push'));
  assert.ok(scanned.aliases.some((a) => a.member === 'a' && a.root === 'state'));
}

// ── references.js ────────────────────────────────────────────────────────────
{
  assert.strictEqual(formatPath(['items', '[]', 'qty']), 'items[].qty');
  assert.strictEqual(formatPath(['[]', 'id']), '[].id');

  const descriptor = {
    name: 'cart',
    stateKeys: ['items'],
    getters: ['total'],
    actions: ['addQty'],
  };
  assert.deepStrictEqual(resolveBridgeMember(descriptor, ['items', 'length'], 'bridge:cart'), {
    target: { kind: 'state', owner: 'bridge:cart', name: 'items' },
    path: ['length'],
  });
  assert.deepStrictEqual(resolveBridgeMember(descriptor, ['total'], 'bridge:cart'), {
    target: { kind: 'getter', owner: 'bridge:cart', name: 'total' },
    path: [],
  });
  assert.deepStrictEqual(resolveBridgeMember(descriptor, ['addQty'], 'bridge:cart'), {
    target: { kind: 'action', owner: 'bridge:cart', name: 'addQty' },
    path: [],
  });
  assert.deepStrictEqual(resolveBridgeMember(descriptor, ['on'], 'bridge:cart'), {
    target: { kind: 'bridge', owner: null, name: 'cart' },
    path: [],
  });
  assert.strictEqual(resolveBridgeMember(descriptor, ['missing'], 'bridge:cart'), null);
  assert.strictEqual(resolveBridgeMember(null, ['items'], 'bridge:cart'), null);

  const baseScope = {
    ownerId: 'component:Demo',
    ownerKind: 'component',
    state: new Set(['count']),
    computed: new Set(['double']),
    actions: new Set(['inc']),
    resources: new Set(['users']),
    injected: new Set(['theme']),
    locals: new Set(['count', 'tmp']),
    slotProps: new Set(['row']),
    loopVars: new Map([
      ['item', { resolved: { target: { kind: 'state', owner: 'bridge:cart', name: 'items' }, path: [], confidence: Confidence.CERTAIN } }],
    ]),
    aliases: new Map([['aliased', { target: { kind: 'state', owner: 'bridge:cart', name: 'items' }, path: ['[]'] }]]),
    bridges: new Map([['cart', { descriptor }]]),
  };

  // Shadowed local
  const shadowed = resolveReference({ root: 'count', segments: [], text: 'count' }, baseScope);
  assert.strictEqual(shadowed.unresolved.reason, UnresolvedReason.SHADOWED_IDENTIFIER);

  // Non-shadowed local
  const plainLocal = resolveReference({ root: 'tmp', segments: [], text: 'tmp' }, baseScope);
  assert.strictEqual(plainLocal.target, null);
  assert.strictEqual(plainLocal.unresolved, null);

  // Injected via this
  const inj = resolveReference({ root: 'this', segments: ['theme', 'mode'], text: 'this.theme.mode' }, baseScope);
  assert.deepStrictEqual(inj.target, { kind: AtlasNodeKind.INJECT, owner: 'component:Demo', name: 'theme' });
  assert.deepStrictEqual(inj.path, ['mode']);

  // Loop var
  const loop = resolveReference({ root: 'item', segments: ['qty'], text: 'item.qty' }, baseScope);
  assert.strictEqual(loop.target.name, 'items');
  assert.deepStrictEqual(loop.path, ['[]', 'qty']);

  // Alias
  const aliased = resolveReference({ root: 'aliased', segments: ['qty'], text: 'aliased.qty' }, baseScope);
  assert.strictEqual(aliased.confidence, Confidence.POSSIBLE);
  assert.deepStrictEqual(aliased.path, ['[]', 'qty']);

  // Slot prop
  const slot = resolveReference({ root: 'row', segments: ['id'], text: 'row.id' }, baseScope);
  assert.strictEqual(slot.unresolved.reason, UnresolvedReason.SLOT_SCOPE);
}

console.log('✅ Atlas resolve submodule tests passed.');

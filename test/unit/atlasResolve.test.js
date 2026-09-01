/**
 * Expression resolution is the part of Atlas that can be wrong in ways nothing
 * else catches, so these cases are deliberately adversarial.
 *
 * The standard every assertion here holds to: a relationship Atlas cannot
 * follow must be *reported*, never dropped and never guessed. A missing edge
 * that shows up as an unresolved entry is a correct answer; a missing edge
 * that shows up as silence is a bug.
 */
import assert from 'assert';
import {
  AMBIENT_ROOTS,
  collectLocals,
  formatPath,
  patternBindings,
  resolveReference,
  scanReferences,
} from '../../lib/compiler/atlas/resolve.js';
import { Confidence, UnresolvedReason } from '../../lib/compiler/atlas/AppModel.js';

console.log('🧪 Testing Atlas expression resolution...');

/**
 * Finds the reference for a chain, by its rendered path.
 * @param {object[]} references - Scanned references.
 * @param {string} text - The rendered `root.path` to find.
 * @param {string} [kind] - Restrict to a usage kind.
 * @returns {object|undefined} The reference.
 */
function ref(references, text, kind) {
  return references.find((entry) => {
    const rendered = entry.segments.length ? `${entry.root}.${formatPath(entry.segments)}` : entry.root;
    return rendered === text && (!kind || entry.kind === kind);
  });
}

/**
 * A resolution scope for a component with a `cart` bridge in scope.
 * @param {object} [overrides] - Fields to merge in.
 * @returns {object} The scope.
 */
function scope(overrides = {}) {
  return {
    ownerId: 'component:CartItem',
    ownerKind: 'component',
    state: new Set(['qty', 'price', 'draft']),
    computed: new Set(['lineTotal']),
    actions: new Set(['incQty']),
    resources: new Set(['users']),
    slotProps: new Set(),
    loopVars: new Map(),
    locals: new Set(),
    aliases: new Map(),
    bridges: new Map([
      [
        'cart',
        {
          descriptor: {
            name: 'cart',
            stateKeys: ['items', 'coupon'],
            getters: ['total'],
            actions: ['addQty'],
            events: ['changed'],
          },
        },
      ],
    ]),
    ...overrides,
  };
}

// ── Nested member access ────────────────────────────────────────────────────
{
  const { references } = scanReferences('cart.items.length');
  const entry = ref(references, 'cart.items.length');
  assert.ok(entry, 'a nested chain is one reference, not three');
  const resolved = resolveReference(entry, scope());
  assert.strictEqual(resolved.target.name, 'items', 'resolution stops at the declared symbol');
  assert.deepStrictEqual(resolved.path, ['length'], 'the rest of the path travels as metadata');
  assert.strictEqual(resolved.confidence, Confidence.CERTAIN);
}

// ── Optional chaining ───────────────────────────────────────────────────────
{
  const { references } = scanReferences('cart?.items?.length');
  const entry = ref(references, 'cart.items.length');
  assert.ok(entry && entry.optional, 'optional chaining is recorded, and does not split the chain');
  assert.strictEqual(resolveReference(entry, scope()).target.name, 'items');
}

// ── Literal computed members are not dynamic ────────────────────────────────
{
  const { references } = scanReferences("cart['items']");
  const entry = ref(references, 'cart.items');
  assert.ok(entry, 'a string-literal key names a member as precisely as a dot does');
  assert.strictEqual(entry.dynamic, false);
}

// ── Numeric indices are elements, not unknowns ──────────────────────────────
{
  const { references } = scanReferences('cart.items[0].qty');
  const entry = ref(references, 'cart.items[].qty');
  assert.ok(entry, 'an element index becomes a [] path segment');
  assert.strictEqual(entry.dynamic, false, 'a literal index is fully determined; nothing failed to resolve');
}

// ── Dynamic members are reported ────────────────────────────────────────────
{
  const { references } = scanReferences('cart.items[key].qty');
  const entry = ref(references, 'cart.items[].qty');
  assert.ok(entry.dynamic, 'a computed key is marked dynamic so the caller records it');
  assert.ok(ref(references, 'key'), 'the key expression is itself scanned');
  const resolved = resolveReference(entry, scope());
  assert.strictEqual(resolved.target.name, 'items', 'the declared symbol is still reached');
}

// ── Shadowing is reported, never silently dropped ───────────────────────────
{
  const code = 'const qty = 5; return qty * 2;';
  const locals = collectLocals(code);
  assert.ok(locals.has('qty'));
  const { references } = scanReferences(code);
  const entry = references.find((item) => item.root === 'qty' && item.kind === 'read');
  const resolved = resolveReference(entry, scope({ locals }));
  assert.strictEqual(resolved.target, null, 'a shadowed name does not resolve to the state key');
  assert.strictEqual(
    resolved.unresolved.reason,
    UnresolvedReason.SHADOWED_IDENTIFIER,
    'and the shadowing is reported, so a diagnostic cannot conclude "never read" from it',
  );
}

// ── A local that shadows nothing is simply local ────────────────────────────
{
  const code = 'const tmp = 5; return tmp;';
  const { references, locals } = scanReferences(code);
  const entry = references.find((item) => item.root === 'tmp' && item.kind === 'read');
  const resolved = resolveReference(entry, scope({ locals }));
  assert.strictEqual(resolved.target, null);
  assert.strictEqual(resolved.unresolved, null, 'an ordinary local is not a finding');
}

// ── A use before its declaration is still local ─────────────────────────────
{
  const locals = collectLocals('return qty + 1; const qty = 2;');
  assert.ok(locals.has('qty'), 'locals are collected in a pass of their own, before references');
}

// ── Loop variables resolve through to their list ────────────────────────────
{
  const listRef = ref(scanReferences('cart.items').references, 'cart.items');
  const listResolution = resolveReference(listRef, scope());
  const withLoop = scope({ loopVars: new Map([['item', { resolved: listResolution }]]) });

  const { references } = scanReferences('item.qty');
  const resolved = resolveReference(ref(references, 'item.qty'), withLoop);
  assert.strictEqual(resolved.target.name, 'items', 'reading item.qty reads cart.items');
  assert.strictEqual(formatPath(resolved.path), '[].qty', 'and records which member of which element');
}

// ── Destructuring reads each named member ───────────────────────────────────
{
  const { aliases, locals } = scanReferences('const { items, total: t } = cart;');
  assert.deepStrictEqual(
    aliases.map((entry) => entry.member).sort(),
    ['items', 'total'],
    'both the shorthand and the renamed key are reads of cart',
  );
  assert.ok(locals.has('t'), 'the renamed binding is local');
  assert.ok(!locals.has('total'), 'the key it was renamed from is not');
}

// ── Nested and defaulted patterns ───────────────────────────────────────────
{
  const bindings = patternBindings('{ a, b: { c }, d = 1, ...rest }');
  assert.deepStrictEqual(bindings.names.sort(), ['a', 'c', 'd', 'rest']);
  assert.ok(bindings.hasRest, 'a rest element is flagged so the caller can report the gap');
}

// ── A local bound from state keeps its provenance ───────────────────────────
{
  const { localAliases } = scanReferences('const item = cart.items.find((e) => e.id === id); item.qty = 3;');
  const alias = localAliases.find((entry) => entry.name === 'item');
  assert.ok(alias, 'const item = <chain> is recorded as an alias');
  assert.strictEqual(`${alias.root}.${formatPath(alias.segments)}`, 'cart.items.find');
}

// ── Aliased writes resolve, but only as possible ────────────────────────────
{
  const aliased = scope({
    locals: new Set(['item']),
    aliases: new Map([
      [
        'item',
        { target: { kind: 'state', owner: 'bridge:cart', name: 'items' }, path: ['[]'] },
      ],
    ]),
  });
  const { references } = scanReferences('item.qty = 3;');
  const resolved = resolveReference(ref(references, 'item.qty', 'write'), aliased);
  assert.strictEqual(resolved.target.name, 'items');
  assert.strictEqual(
    resolved.confidence,
    Confidence.POSSIBLE,
    'which element was aliased is not knowable, so the edge is not certain',
  );
}

// ── Writes ──────────────────────────────────────────────────────────────────
{
  for (const [code, expected] of [
    ['state.qty = 3', 'state.qty'],
    ['state.qty += 1', 'state.qty'],
    ['state.qty++', 'state.qty'],
    ['--state.qty', 'state.qty'],
    ['state.qty ??= 1', 'state.qty'],
  ]) {
    const { references } = scanReferences(code);
    assert.ok(ref(references, expected, 'write'), `${code} is a write`);
  }

  // An equality test is not a write.
  const { references } = scanReferences('state.qty === 3');
  assert.ok(!ref(references, 'state.qty', 'write'), '=== is not an assignment');
  assert.ok(ref(references, 'state.qty', 'read'), 'it is a read');
}

// ── Mutating methods are writes to the receiver ─────────────────────────────
{
  const { references } = scanReferences('cart.items.push(entry)');
  const write = ref(references, 'cart.items', 'write');
  assert.ok(write, 'push mutates its receiver');
  assert.strictEqual(write.method, 'push');
  const invoke = ref(references, 'cart.items.push', 'invoke');
  assert.ok(invoke.builtinMethod, 'the call itself is flagged so it is not reported as an unknown member');
}

// ── Invocation ──────────────────────────────────────────────────────────────
{
  const { references } = scanReferences('cart.addQty(id, 1)');
  const entry = ref(references, 'cart.addQty', 'invoke');
  const resolved = resolveReference(entry, scope());
  assert.strictEqual(resolved.target.kind, 'action');
  assert.strictEqual(resolved.target.owner, 'bridge:cart');
}

// ── An undeclared bridge member is a finding ────────────────────────────────
{
  const { references } = scanReferences('cart.nope');
  const resolved = resolveReference(ref(references, 'cart.nope'), scope());
  assert.strictEqual(resolved.target, null);
  assert.strictEqual(resolved.unresolved.reason, UnresolvedReason.UNKNOWN_BRIDGE_MEMBER);
}

// ── Bridge protocol members are not findings ────────────────────────────────
{
  for (const member of ['on', 'emit', '$dispose', '$name']) {
    const { references } = scanReferences(`cart.${member}`);
    const resolved = resolveReference(ref(references, `cart.${member}`), scope());
    assert.strictEqual(resolved.unresolved, null, `cart.${member} is protocol, not an unknown member`);
  }
}

// ── Scoped-slot variables are reported as out of model ──────────────────────
{
  const { references } = scanReferences('row.label');
  const resolved = resolveReference(ref(references, 'row.label'), scope({ slotProps: new Set(['row']) }));
  assert.strictEqual(resolved.unresolved.reason, UnresolvedReason.SLOT_SCOPE);
}

// ── Ambient identifiers are neither edges nor findings ──────────────────────
{
  const { references } = scanReferences('Math.max(qty, 1)');
  const entry = ref(references, 'Math.max', 'invoke');
  const resolved = resolveReference(entry, scope());
  assert.strictEqual(resolved.target, null);
  assert.strictEqual(resolved.unresolved, null, 'a sandbox-allowed global is not an application relationship');
  assert.ok(AMBIENT_ROOTS.has('Math'));
}

// ── Strings, comments and template literals ─────────────────────────────────
{
  const { references } = scanReferences('"cart.fake" + cart.real');
  assert.ok(!ref(references, 'cart.fake'), 'a chain inside a string literal is text');
  assert.ok(ref(references, 'cart.real'));
}
{
  const { references } = scanReferences('// cart.commented\ncart.real');
  assert.ok(!ref(references, 'cart.commented'), 'a chain inside a comment is text');
  assert.ok(ref(references, 'cart.real'));
}
{
  const { references } = scanReferences('`total ${cart.total} of ${qty}`');
  assert.ok(ref(references, 'cart.total'), 'a template literal interpolation is scanned');
  assert.ok(ref(references, 'qty'));
}

// ── Object literal keys are not references ──────────────────────────────────
{
  const { references } = scanReferences('{ qty: cart.total }');
  assert.ok(!references.some((entry) => entry.root === 'qty'), 'a key is a name, not a read');
  assert.ok(ref(references, 'cart.total'), 'its value is');
}

// ── Arrow and function parameters are local ─────────────────────────────────
{
  const locals = collectLocals('list.map((a, b) => a + b)');
  assert.ok(locals.has('a') && locals.has('b'), 'arrow parameters bind');

  const bare = collectLocals('list.map(x => x.v)');
  assert.ok(bare.has('x'), 'a bare arrow parameter binds');

  const fn = collectLocals('function helper(p, q) { return p + q; }');
  assert.ok(fn.has('helper') && fn.has('p') && fn.has('q'));

  const caught = collectLocals('try { go(); } catch (err) { report(err); }');
  assert.ok(caught.has('err'), 'a catch binding binds');
}

// ── Multi-binding declarations ──────────────────────────────────────────────
{
  const locals = collectLocals('let a = 1, b = 2, c;');
  assert.ok(locals.has('a') && locals.has('b') && locals.has('c'), 'every binding in one statement');
}

// ── Spread is reported rather than assumed away ─────────────────────────────
{
  const { notes } = scanReferences('const merged = { ...cart };');
  assert.ok(
    notes.some((note) => note.reason === UnresolvedReason.SPREAD),
    'a spread could carry anything out; the gap is recorded',
  );
}

// ── `state.` and `this.state.` reach the same declaration ───────────────────
{
  for (const code of ['state.qty', 'this.state.qty']) {
    const { references } = scanReferences(code);
    const resolved = resolveReference(references[0], scope());
    assert.strictEqual(resolved.target.name, 'qty', `${code} reaches the state key`);
    assert.strictEqual(resolved.target.owner, 'component:CartItem');
  }
}

// ── An unknown root is a finding ────────────────────────────────────────────
{
  const { references } = scanReferences('mystery.value');
  const resolved = resolveReference(ref(references, 'mystery.value'), scope());
  assert.strictEqual(resolved.unresolved.reason, UnresolvedReason.UNKNOWN_IDENTIFIER);
  assert.strictEqual(resolved.unresolved.name, 'mystery');
}

// ── Offsets are preserved through nesting ───────────────────────────────────
{
  const code = 'a + cart.total';
  const { references } = scanReferences(code);
  const entry = ref(references, 'cart.total');
  assert.strictEqual(code.slice(entry.index, entry.index + entry.length), 'cart.total', 'index and length address the chain');
}
{
  const code = '`x ${cart.total}`';
  const { references } = scanReferences(code);
  const entry = ref(references, 'cart.total');
  assert.strictEqual(
    code.slice(entry.index, entry.index + entry.length),
    'cart.total',
    'an offset inside a template literal is still absolute',
  );
}

console.log('✅ Atlas expression resolution tests passed.');

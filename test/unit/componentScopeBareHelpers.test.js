/**
 * @file componentScopeBareHelpers.test.js
 * @description Unit tests for ComponentScope bare dollar helpers and live property resolution (#1659).
 */

import assert from 'assert';
import '../helpers/register-happy-dom.js';
import { ComponentScope, createInjectedHelpers } from '../../lib/core/runtime/ComponentScope.js';
import {
  BARE_DOLLAR_HELPERS,
  BARE_DOLLAR_HELPERS_SET,
  THIS_ONLY_DOLLAR_MEMBERS,
} from '../../lib/core/runtime/componentHelpers.js';
import { AMBIENT_ROOTS } from '../../lib/compiler/atlas/resolve.js';
import { AvenxComponent } from '../../lib/core/runtime/AvenxComponent.js';

console.log('🧪 Testing ComponentScope bare dollar helpers and live resolution (#1659)...');

// 1. Sanity Check: injected $ keys match the canonical BARE_DOLLAR_HELPERS set
{
  const injectedKeys = ComponentScope.getInjectedDollarKeys();
  assert.strictEqual(
    injectedKeys.length,
    BARE_DOLLAR_HELPERS.length,
    'injected $ keys count matches canonical BARE_DOLLAR_HELPERS',
  );
  assert.deepStrictEqual(
    [...injectedKeys].sort(),
    [...BARE_DOLLAR_HELPERS].sort(),
    'injected $ keys match BARE_DOLLAR_HELPERS exactly',
  );
  assert.deepStrictEqual(
    [...BARE_DOLLAR_HELPERS_SET].sort(),
    [...BARE_DOLLAR_HELPERS].sort(),
    'BARE_DOLLAR_HELPERS_SET matches BARE_DOLLAR_HELPERS exactly',
  );

  const helperKeysFromFn = Object.keys(createInjectedHelpers({})).filter((k) => BARE_DOLLAR_HELPERS_SET.has(k));
  assert.deepStrictEqual(
    helperKeysFromFn.sort(),
    [...BARE_DOLLAR_HELPERS].sort(),
    'createInjectedHelpers produces exactly BARE_DOLLAR_HELPERS',
  );
}

// 2. Live property resolution from owner pre-mount vs post-mount
{
  const emitted = [];
  const watched = [];
  const watchEffects = [];
  const nextTicks = [];

  const owner = {
    props: { title: 'Initial' },
    styles: {},
    $route: { path: '/initial' },
    $router: null,
    $refs: {},
    $element: null,
    $slots: { has: () => false },
    $app: null,
    $emit(event, detail) {
      emitted.push({ event, detail });
    },
    $watch(source, callback, options) {
      watched.push({ source, callback, options });
    },
    $watchEffect(effect, options) {
      watchEffects.push({ effect, options });
    },
    $nextTick(callback) {
      nextTicks.push(callback);
    },
    __methods: () => ({}),
    state: {},
    __computedKeys: () => [],
    __resourceNames: () => [],
    __readResource: () => undefined,
    __isIsolated: () => true,
    _mixinProps: {},
    __hasImports: () => false,
  };

  const scope = new ComponentScope(owner);
  const resolved = scope.resolve();

  // Pre-mount / initial checks
  assert.strictEqual(resolved.$element, null, 'pre-mount $element resolves to null');
  assert.deepStrictEqual(resolved.$refs, {}, 'pre-mount $refs resolves to empty object');
  assert.strictEqual(resolved.$slots.has('header'), false, 'pre-mount $slots.has returns false');
  assert.strictEqual(resolved.$router, null, 'pre-mount $router resolves to null');
  assert.strictEqual(resolved.$app, null, 'pre-mount $app resolves to null');
  assert.strictEqual(resolved.$route.path, '/initial', 'initial $route.path resolves correctly');

  // Method forwarding checks
  resolved.$emit('change', { value: 42 });
  assert.deepStrictEqual(emitted, [{ event: 'change', detail: { value: 42 } }]);

  const noop = () => {};
  resolved.$watch('count', noop, { immediate: true });
  assert.strictEqual(watched.length, 1);
  assert.strictEqual(watched[0].source, 'count');

  resolved.$watchEffect(noop, { flush: 'post' });
  assert.strictEqual(watchEffects.length, 1);

  resolved.$nextTick(noop);
  assert.strictEqual(nextTicks.length, 1);

  // Simulate post-mount and navigation updates ON THE SAME OWNER WITHOUT REBUILDING SCOPE
  const mockElement = { tagName: 'DIV', id: 'root' };
  const mockRefBtn = { tagName: 'BUTTON', id: 'submit' };
  const mockRouter = { navigate: (path) => path };
  const mockApp = { name: 'AvenxAppInstance' };

  owner.$element = mockElement;
  owner.$refs = { submitBtn: mockRefBtn };
  owner.$slots = { has: (name) => name === 'header' };
  owner.$router = mockRouter;
  owner.$app = mockApp;
  owner.$route = { path: '/dashboard' };

  // Live getters must reflect current owner properties on the cached scope proxy
  assert.strictEqual(resolved.$element, mockElement, 'post-mount $element reflects live owner element');
  assert.strictEqual(resolved.$refs.submitBtn, mockRefBtn, 'post-mount $refs reflects live ref map');
  assert.strictEqual(resolved.$slots.has('header'), true, 'post-mount $slots reflects live slots');
  assert.strictEqual(resolved.$slots.has('footer'), false);
  assert.strictEqual(resolved.$router, mockRouter, 'live $router reflects updated owner router');
  assert.strictEqual(resolved.$router.navigate('/test'), '/test');
  assert.strictEqual(resolved.$app, mockApp, 'live $app reflects updated owner app');
  assert.strictEqual(resolved.$route.path, '/dashboard', 'live $route reflects updated route');
}

// 3. Verification that `this.`-only helpers are NOT exposed bare in ComponentScope
{
  const owner = {
    props: {},
    styles: {},
    $destroy: () => 'destroyed',
    $isMounted: true,
    $isUnmounted: false,
    $keepAlive: { clear: () => {} },
    $inspect: () => ({}),
    $tripDeadlockBoundary: () => {},
    $resetDeadlockBoundary: () => {},
    $validateElement: () => [],
    $parent: { id: 'parent' },
    $id: 'comp-1',
    $instanceId: 'comp-1',
    __methods: () => ({}),
    state: {},
    __computedKeys: () => [],
    __resourceNames: () => [],
    __readResource: () => undefined,
    __isIsolated: () => true,
    _mixinProps: {},
    __hasImports: () => false,
  };

  const scope = new ComponentScope(owner);
  const resolved = scope.resolve();

  for (const member of THIS_ONLY_DOLLAR_MEMBERS) {
    assert.strictEqual(
      resolved[member],
      undefined,
      `this.-only member "${member}" must NOT be exposed bare on ComponentScope`,
    );
  }
}

// 4. Agreement Check: ComponentScope and AMBIENT_ROOTS agree on the exact single-source-of-truth set
{
  const scopeKeys = ComponentScope.getInjectedDollarKeys();
  const ambientDollarRoots = [...AMBIENT_ROOTS].filter((r) => BARE_DOLLAR_HELPERS_SET.has(r));

  assert.strictEqual(
    scopeKeys.length,
    BARE_DOLLAR_HELPERS.length,
    'ComponentScope injected keys count matches BARE_DOLLAR_HELPERS',
  );
  assert.strictEqual(
    ambientDollarRoots.length,
    BARE_DOLLAR_HELPERS.length,
    'AMBIENT_ROOTS dollar keys count matches BARE_DOLLAR_HELPERS',
  );
  assert.deepStrictEqual(
    [...scopeKeys].sort(),
    [...ambientDollarRoots].sort(),
    'ComponentScope and AMBIENT_ROOTS must agree on the exact set of injected $ helpers',
  );
  assert.deepStrictEqual(
    [...scopeKeys].sort(),
    [...BARE_DOLLAR_HELPERS].sort(),
    'Both agree on canonical BARE_DOLLAR_HELPERS',
  );
}

// 5. Issue #1659 Reproduction & Live Component Action and Template Expression Verification
{
  const mountPoint = document.createElement('div');
  mountPoint.id = 'issue-1659-test-app';
  document.body.appendChild(mountPoint);

  class BoxComponent extends AvenxComponent {
    constructor() {
      super(
        {},
        {},
        {},
        '<div><input data-ax-ref="box" value="initial" /></div>',
        {
          updateBoxAction: `
            // Mutating through bare $refs without this.
            $refs.box.value = "mutated-via-bare-$refs";
          `,
          checkHelpersAction: `
            return {
              hasElement: $element === this.$element,
              sameBox: $refs.box === this.$refs.box,
              hasDefaultSlot: $slots.has("default") === this.$slots.has("default"),
              sameRouter: $router === this.$router,
              sameApp: $app === this.$app,
            };
          `,
        },
      );
    }
  }

  const comp = new BoxComponent();
  comp.mount('#issue-1659-test-app');

  // Verify initial state
  assert.ok(comp.$refs.box, '$refs.box must be populated post-mount');
  assert.strictEqual(comp.$refs.box.value, 'initial');

  // Execute action with bare $refs.box: must not throw AVX_R09 and must mutate the exact DOM element
  assert.doesNotThrow(() => {
    comp.updateBoxAction();
  }, 'Invoking action using bare $refs.box must NOT throw AVX_R09');

  assert.strictEqual(
    comp.$refs.box.value,
    'mutated-via-bare-$refs',
    'bare $refs.box in action must mutate the exact same element as this.$refs.box',
  );

  // Check all newly injected helpers work in action scope
  const helperResults = comp.checkHelpersAction();
  assert.strictEqual(helperResults.hasElement, true, 'bare $element must match this.$element in action');
  assert.strictEqual(helperResults.sameBox, true, 'bare $refs.box must match this.$refs.box in action');
  assert.strictEqual(helperResults.hasDefaultSlot, true, 'bare $slots must match this.$slots in action');
  assert.strictEqual(helperResults.sameRouter, true, 'bare $router must match this.$router in action');
  assert.strictEqual(helperResults.sameApp, true, 'bare $app must match this.$app in action');

  // Check newly injected helpers work in template expressions
  assert.strictEqual(
    comp._evaluate('$refs.box.value'),
    'mutated-via-bare-$refs',
    'bare $refs in template expression must resolve',
  );
  assert.strictEqual(
    comp._evaluate('$element.tagName'),
    comp.$element.tagName,
    'bare $element in template expression must resolve',
  );
  assert.strictEqual(
    comp._evaluate('$slots.has("default")'),
    false,
    'bare $slots in template expression must resolve',
  );
  assert.strictEqual(
    comp._evaluate('$router'),
    null,
    'bare $router in template expression must resolve',
  );
  assert.strictEqual(
    comp._evaluate('$app'),
    null,
    'bare $app in template expression must resolve',
  );
}

console.log('✅ ComponentScope bare dollar helpers and live resolution tests passed.');

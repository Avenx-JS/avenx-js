import test from 'node:test';
import assert from 'node:assert/strict';
import ComponentParser from '../../lib/compiler/ComponentParser.js';
import ContractValidator from '../../lib/compiler/ContractValidator.js';
import { AvenxErrorCodes } from '../../lib/core/runtime/AvenxError.js';

test('ContractValidator detects static contract violations', () => {
  // 1. Dynamic interpolation in static node
  const nodes1 = ComponentParser.parseHTML('<div static>Hello {{ name }}</div>');
  const res1 = ContractValidator.validate(nodes1, { name: 'StaticTest' });
  assert.equal(res1.valid, false);
  assert.equal(res1.errors.length, 1);
  assert.equal(res1.errors[0].code, AvenxErrorCodes.COMPILER_CONTRACT_STATIC_VIOLATION);

  // 2. Event listener in static node
  const nodes2 = ComponentParser.parseHTML('<button static @click="handleClick">Click</button>');
  const res2 = ContractValidator.validate(nodes2, { name: 'StaticBtn' });
  assert.equal(res2.valid, false);
  assert.equal(res2.errors.length, 1);
  assert.equal(res2.errors[0].code, AvenxErrorCodes.COMPILER_CONTRACT_STATIC_VIOLATION);

  // 3. Two-way binding in static node
  const nodes3 = ComponentParser.parseHTML('<input static data-ax-bind="name" />');
  const res3 = ContractValidator.validate(nodes3, { name: 'StaticInput' });
  assert.equal(res3.valid, false);
  assert.equal(res3.errors[0].code, AvenxErrorCodes.COMPILER_CONTRACT_STATIC_VIOLATION);

  // 4. Valid static node
  const nodes4 = ComponentParser.parseHTML('<div static class="hero"><h1>Title</h1><p>Text</p></div>');
  const res4 = ContractValidator.validate(nodes4, { name: 'ValidStatic' });
  assert.equal(res4.valid, true);
  assert.equal(res4.errors.length, 0);
});

test('ContractValidator detects isolated contract violations', () => {
  // 1. Isolation leak in template
  const nodes1 = ComponentParser.parseHTML('<div>Bridge data: {{ $bridges.authStore.user }}</div>');
  const res1 = ContractValidator.validate(nodes1, {
    name: 'IsolatedComp',
    contracts: new Set(['isolated']),
  });
  assert.equal(res1.valid, false);
  assert.equal(res1.errors[0].code, AvenxErrorCodes.COMPILER_CONTRACT_ISOLATED_VIOLATION);

  // 2. Isolation leak in computed property
  const nodes2 = ComponentParser.parseHTML('<div>{{ localVal }}</div>');
  const res2 = ContractValidator.validate(nodes2, {
    name: 'IsolatedComp',
    contracts: new Set(['isolated']),
    computed: {
      user: 'this.$bridges.userStore.name',
    },
  });
  assert.equal(res2.valid, false);
  assert.equal(res2.errors[0].code, AvenxErrorCodes.COMPILER_CONTRACT_ISOLATED_VIOLATION);

  // 3. Isolation leak in action method
  const nodes3 = ComponentParser.parseHTML('<div>{{ localVal }}</div>');
  const res3 = ContractValidator.validate(nodes3, {
    name: 'IsolatedComp',
    contracts: new Set(['isolated']),
    methods: {
      sync: '$bridges.api.fetch()',
    },
  });
  assert.equal(res2.valid, false);
  assert.equal(res3.errors[0].code, AvenxErrorCodes.COMPILER_CONTRACT_ISOLATED_VIOLATION);

  // 4. Valid isolated component
  const nodes4 = ComponentParser.parseHTML('<div>{{ props.title }}</div>');
  const res4 = ContractValidator.validate(nodes4, {
    name: 'ValidIsolated',
    contracts: new Set(['isolated']),
    computed: {
      double: 'props.count * 2',
    },
  });
  assert.equal(res4.valid, true);
  assert.equal(res4.errors.length, 0);
});

test('ContractValidator detects determinism and purity violations', () => {
  // 1. Determinism violation (Math.random) in template
  const nodes1 = ComponentParser.parseHTML('<div deterministic>{{ Math.random() }}</div>');
  const res1 = ContractValidator.validate(nodes1, { name: 'DetTest' });
  assert.ok(res1.warnings.some((w) => w.code === AvenxErrorCodes.COMPILER_CONTRACT_DETERMINISTIC_VIOLATION));

  // 2. Determinism violation (Date.now) in computed
  const nodes2 = ComponentParser.parseHTML('<div>{{ time }}</div>');
  const res2 = ContractValidator.validate(nodes2, {
    name: 'DetComp',
    contracts: new Set(['deterministic']),
    computed: {
      time: 'Date.now()',
    },
  });
  assert.ok(res2.warnings.some((w) => w.code === AvenxErrorCodes.COMPILER_CONTRACT_DETERMINISTIC_VIOLATION));

  // 3. Purity violation in template expression
  const nodes3 = ComponentParser.parseHTML('<div pure>{{ window.location.href }}</div>');
  const res3 = ContractValidator.validate(nodes3, { name: 'PureTest' });
  assert.ok(res3.warnings.some((w) => w.code === AvenxErrorCodes.COMPILER_CONTRACT_PURE_VIOLATION));

  // 4. Redundant contract warning
  const nodes4 = ComponentParser.parseHTML('<div static><span pure>Static Text</span></div>');
  const res4 = ContractValidator.validate(nodes4, { name: 'RedundantTest' });
  assert.ok(res4.warnings.some((w) => w.code === AvenxErrorCodes.COMPILER_CONTRACT_REDUNDANT));
});

test('ContractValidator checks action bodies for purity and determinism', () => {
  // 1. Purity violation in an action body
  const pure = ContractValidator.validate(ComponentParser.parseHTML('<div>{{ n }}</div>'), {
    name: 'PureAction',
    contracts: new Set(['pure']),
    methods: { reload: 'window.location.reload();' },
  });
  assert.ok(pure.warnings.some((w) => w.code === AvenxErrorCodes.COMPILER_CONTRACT_PURE_VIOLATION));

  // 2. Determinism violation in an action body
  const det = ContractValidator.validate(ComponentParser.parseHTML('<div>{{ n }}</div>'), {
    name: 'DetAction',
    contracts: new Set(['deterministic']),
    methods: { roll: 'return Math.random();' },
  });
  assert.ok(det.warnings.some((w) => w.code === AvenxErrorCodes.COMPILER_CONTRACT_DETERMINISTIC_VIOLATION));

  // 3. A clean action body raises no warning
  const clean = ContractValidator.validate(ComponentParser.parseHTML('<div>{{ n }}</div>'), {
    name: 'CleanAction',
    contracts: new Set(['pure', 'deterministic']),
    methods: { double: 'return n * 2;' },
  });
  assert.equal(clean.warnings.length, 0);
});

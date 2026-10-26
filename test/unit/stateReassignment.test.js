import assert from 'assert';
import '../helpers/register-happy-dom.js';
import { spawnSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import { compileComponent, cleanup } from '../../benches/support/compileFixture.js';
import { AvenxComponent } from '../../lib/core/runtime/AvenxComponent.js';
import { AvenxErrorCodes } from '../../lib/core/runtime/AvenxError.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '../..');
const cliPath = path.join(repoRoot, 'bin/avenx.js');

/**
 * Requires a callback to raise the direct state reassignment diagnostic.
 * @param {Function} callback - Reassignment attempt.
 */
function assertStateReassignment(callback) {
  assert.throws(
    callback,
    (error) => {
      assert.strictEqual(error.code, AvenxErrorCodes.STATE_DIRECT_REASSIGNMENT);
      assert.ok(error.message.includes(`[${AvenxErrorCodes.STATE_DIRECT_REASSIGNMENT}]`));
      return true;
    },
  );
}

/**
 * Verifies the real SFC compiler and runtime action path.
 */
async function testSfcActions() {
  console.log('🧪 Direct state reassignment in an SFC action raises AVX_R16...');

  const ComponentClass = compileComponent(
    `<state count="0" />

<action name="reassign">
  this.state = { count: 10 };
</action>

<action name="assignState">
  Object.assign(this.state, { count: 2 });
</action>

<action name="setCount">
  this.state.count = 3;
</action>

<p id="count">{{ count }}</p>`,
    'StateReassignmentProbe',
  );

  assert.ok(ComponentClass.__axActions?.reassign, 'the reassignment action must use compiled SFC code');

  const host = document.createElement('div');
  document.body.appendChild(host);
  const component = new ComponentClass({}, {});
  component.mount(host);

  try {
    const reactiveState = component.state;
    assert.strictEqual(host.querySelector('#count').textContent, '0');

    assertStateReassignment(() => component.reassign());
    assert.strictEqual(component.state, reactiveState, 'a rejected assignment must preserve the reactive Proxy');
    assert.strictEqual(component.state.count, 0, 'a rejected assignment must not change state');
    assert.strictEqual(host.querySelector('#count').textContent, '0');

    assert.doesNotThrow(() => component.assignState());
    await component.$nextTick();
    assert.strictEqual(component.state.count, 2);
    assert.strictEqual(host.querySelector('#count').textContent, '2', 'Object.assign must trigger a render');

    assert.doesNotThrow(() => component.setCount());
    await component.$nextTick();
    assert.strictEqual(component.state.count, 3);
    assert.strictEqual(host.querySelector('#count').textContent, '3', 'property mutation must trigger a render');
  } finally {
    component.unmount();
    host.remove();
  }
}

/**
 * Verifies construction and post-construction class method behaviour.
 */
function testClassComponent() {
  console.log('🧪 Class component construction remains valid and later reassignment raises AVX_R16...');

  class ClassStateProbe extends AvenxComponent {
    constructor() {
      super();
      this._initialStateProxy = this.state;
      this.state = { count: 1 };
    }

    reassign() {
      this.state = { count: 10 };
    }
  }

  let component;
  assert.doesNotThrow(() => {
    component = new ClassStateProbe();
  }, 'state initialization during subclass construction must remain valid');

  assert.strictEqual(component.state, component._initialStateProxy, 'constructor initialization must retain the Proxy');
  assert.strictEqual(component.state.count, 1);

  const reactiveState = component.state;
  assertStateReassignment(() => component.reassign());
  assert.strictEqual(component.state, reactiveState, 'class method reassignment must not replace the Proxy');
  assert.strictEqual(component.state.count, 1);

  class NoConstructorStateProbe extends AvenxComponent {
    reassign() {
      this.state = { escaped: true };
    }
  }

  const noConstructorState = new NoConstructorStateProbe();
  const noConstructorStateProxy = noConstructorState.state;
  assertStateReassignment(() => noConstructorState.reassign());
  assert.strictEqual(
    noConstructorState.state,
    noConstructorStateProxy,
    'an immediate method reassignment must preserve the Proxy',
  );
  assert.strictEqual(noConstructorState.state.escaped, undefined);

  assert.doesNotThrow(() => new AvenxComponent({ count: 1 }), 'base component construction must remain valid');
}

/**
 * Verifies the diagnostic catalogue through the public CLI command.
 */
function testExplainCommand() {
  console.log('🧪 avenx explain AVX_R16 resolves the catalogue entry...');

  const env = { ...process.env, NO_COLOR: '1' };
  delete env.FORCE_COLOR;
  const result = spawnSync(process.execPath, [cliPath, 'explain', 'AVX_R16'], {
    cwd: repoRoot,
    encoding: 'utf8',
    env,
  });

  assert.strictEqual(result.status, 0, result.stderr);
  assert.ok(result.stdout.includes('AVX_R16: StateDirectReassignment [ERROR]'));
  assert.ok(result.stdout.includes('Category: runtime'));
  assert.ok(result.stdout.includes('Common Causes:'));
  assert.ok(result.stdout.includes('How to Fix:'));
  assert.ok(result.stdout.includes('Object.assign(this.state, values)'));
  assert.ok(result.stdout.includes('https://avenx-js.com/troubleshooting/errors'));
}

try {
  await testSfcActions();
  testClassComponent();
  testExplainCommand();
  console.log('✅ State direct reassignment tests passed!');
} catch (error) {
  console.error('❌ State direct reassignment tests failed!');
  console.error(error);
  process.exitCode = 1;
} finally {
  cleanup();
}

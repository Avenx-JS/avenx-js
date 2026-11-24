import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { bridge } from '../../lib/core/runtime/bridge.js';
import { StateFactory } from '../../lib/core/reactive/createState.js';
import { AvenxWatcher } from '../../lib/core/reactive/watcher.js';

const scenario = process.argv.find((arg) => arg.startsWith('--scenario='))?.slice('--scenario='.length);
if (!scenario) {
  for (const name of ['self', 'mutual', 'array', 'notifications']) {
    const child = spawnSync(process.execPath, [fileURLToPath(import.meta.url), `--scenario=${name}`], {
      encoding: 'utf8',
      timeout: 10_000,
    });
    assert.ifError(child.error, `${name}: back-reference writes must finish within the child timeout`);
    assert.equal(child.status, 0, `${name}: ${child.stdout}${child.stderr}`);
  }
  console.log('Back-reference writes terminate and preserve reactive notifications.');
} else if (scenario === 'notifications') {
  const node = { count: 0 };
  node.self = node;
  let changes = 0;
  const state = new StateFactory().create({ node }, { onChange: () => changes++ });
  state.node.self.count++;
  assert.equal(changes, 1, 'a write through a back-reference still reaches onChange');
  const held = state.node;
  state.node = null;
  changes = 0;
  held.self.count++;
  assert.equal(changes, 0, 'a detached cyclic node must not notify the former root');
} else {
  const node = { count: 0 };
  node.self = node;
  node.child = { parent: node };
  node.items = [node];
  const store = bridge({
    state: { node },
    increment() {
      if (scenario === 'self') this.node.self.count++;
      else if (scenario === 'mutual') this.node.child.parent.count++;
      else this.node.items[0].count++;
    },
  });

  // No watcher may mask a broken parent chain by reading the root again
  // between trigger() and notifyChange(). This was a synchronous infinite loop.
  store.increment();
  assert.equal(store.node.count, 1);

  let updates = 0;
  const watcher = new AvenxWatcher(
    () => store.node,
    () => updates++,
  );
  try {
    store.increment();
    assert.equal(store.node.count, 2);
    assert.equal(updates, 1, 'a consumer observing the parent still receives nested writes');
    store.$dispose();
    store.increment();
    assert.equal(store.node.count, 1, 'writes through restored back-references remain usable');
  } finally {
    watcher.teardown();
  }
}

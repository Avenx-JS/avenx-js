import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Window } from 'happy-dom';
import AvenxCompiler from '../../lib/compiler.js';
import { findUnreachableActions } from '../../lib/compiler/atlas/diagnostics.js';

/**
 * Writes a source file in a temporary application.
 * @param {string} root - Project directory.
 * @param {string} name - Relative filename.
 * @param {string} content - Source contents.
 */
function write(root, name, content) {
  const target = path.join(root, name);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
}

/**
 * Waits for an observable hook signal without sleeping for animation durations.
 * @param {Promise<void>} signal - Hook signal.
 * @returns {Promise<void>} Resolves when the hook has run.
 */
async function waitFor(signal) {
  let timer;
  try {
    await Promise.race([
      signal,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('Expected lifecycle hook did not run')), 5000);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

test('transition actions are reachable while an ordinary unused action still warns', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'avenx-transition-atlas-'));
  try {
    write(root, 'avenx.config.json', '{}');
    write(
      root,
      'src/pages/home.page.js',
      `
<action name="onEnter">return;</action>
<action name="onBeforeLeave">return;</action>
<action name="onLeave">return;</action>
<action name="setup">return;</action>
<action name="unused">return;</action>
<p>Home</p>`,
    );
    const compiler = new AvenxCompiler({ rootDir: root, logging: { silent: true } });
    const findings = findUnreachableActions(compiler.analyze());
    assert.deepEqual(
      findings.map((finding) => finding.node.name),
      ['unused'],
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

for (const mode of ['development', 'production']) {
  for (const delayed of [false, true]) {
    test(`${mode}: compiled page ${delayed ? 'waits for a Promise' : 'leaves synchronously'} in hook order`, async () => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), 'avenx-transition-build-'));
      const window = new Window({ url: 'http://localhost' });
      try {
        write(root, 'avenx.config.json', '{}');
        write(
          root,
          'src/pages/home.page.js',
          `
<action name="onMount">window.events.push('mount');</action>
<action name="onEnter">window.events.push('enter');</action>
<action name="onActivate">window.events.push('activate'); window.notifyActivated();</action>
<action name="onBeforeLeave">
  window.events.push('before');
  window.notifyBeforeLeave();
  ${delayed ? 'return new Promise((resolve) => { window.finishLeave = resolve; });' : ''}
</action>
<action name="onLeave">window.events.push('leave');</action>
<action name="onUnmount">window.events.push('unmount');</action>
<p id="home">Home</p>`,
        );
        write(
          root,
          'src/pages/away.page.js',
          `
<action name="onMount">window.events.push('away'); window.notifyAway();</action>
<p id="away">Away</p>`,
        );
        write(
          root,
          'src/main.app.js',
          `
import { AvenxApp } from 'avenx-core/runtime';
const app = new AvenxApp({ target: '#app' });
app.initRouter({ '': 'Home', '/away': 'Away' });`,
        );
        new AvenxCompiler({ rootDir: root, mode, logging: { silent: true } }).build();
        const activated = new Promise((resolve) => {
          window.notifyActivated = resolve;
        });
        const beforeLeave = new Promise((resolve) => {
          window.notifyBeforeLeave = resolve;
        });
        const away = new Promise((resolve) => {
          window.notifyAway = resolve;
        });
        window.events = [];
        window.document.body.innerHTML = '<div id="app"></div>';
        window.eval(fs.readFileSync(path.join(root, 'dist/bundle.js'), 'utf8'));
        await waitFor(activated);
        assert.deepEqual(Array.from(window.events), ['mount', 'enter', 'activate']);
        window.location.hash = '#/away';
        await waitFor(beforeLeave);
        if (delayed) {
          assert.ok(window.document.querySelector('#home'), 'the old page remains while leaving');
          assert.equal(window.document.querySelector('#away'), null);
          assert.deepEqual(Array.from(window.events), ['mount', 'enter', 'activate', 'before']);
          window.finishLeave();
        }
        await waitFor(away);
        assert.equal(window.document.querySelector('#home'), null);
        assert.ok(window.document.querySelector('#away'));
        assert.deepEqual(Array.from(window.events), [
          'mount',
          'enter',
          'activate',
          'before',
          'leave',
          'unmount',
          'away',
        ]);
      } finally {
        await window.happyDOM.close();
        fs.rmSync(root, { recursive: true, force: true });
      }
    });
  }
}

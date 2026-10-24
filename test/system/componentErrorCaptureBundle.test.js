import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Window } from 'happy-dom';
import AvenxCompiler from '../../lib/compiler.js';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'avenx-error-capture-'));

/**
 * Writes a source file in the real fixture application.
 * @param {string} name - Relative filename.
 * @param {string} content - File contents.
 */
function write(name, content) {
  const target = path.join(root, name);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
}

try {
  write('avenx.config.json', '{}');
  write(
    'src/components/boomer/boomer.component.js',
    `
<action name="onMount"> throw new Error('child failed'); </action>
<span>Child</span>`,
  );
  write(
    'src/pages/home.page.js',
    `
<action name="onErrorCaptured"> window.captures.push('page'); </action>
<main><Middle /></main>`,
  );
  write(
    'src/main.app.js',
    `
import { AvenxApp } from 'avenx-core/runtime';
import Middle from './components/middle/middle.component.js';
import Boomer from './components/boomer/boomer.component.js';
const app = new AvenxApp({ target: '#app' });
app.register('Middle', Middle);
app.register('Boomer', Boomer);
app.onError(() => window.captures.push('app'));
app.initRouter({ '': 'Home' });`,
  );

  for (const mode of ['development', 'production']) {
    for (const stop of [true, false]) {
      write(
        'src/components/middle/middle.component.js',
        `
<action name="onErrorCaptured">
  window.captures.push('middle');
  ${stop ? 'return false;' : ''}
</action>
<section><Boomer /></section>`,
      );
      new AvenxCompiler({ rootDir: root, srcDir: 'src', distDir: 'dist', mode, logging: { silent: true } }).build();
      const window = new Window({ url: 'http://localhost' });
      try {
        window.captures = [];
        window.document.body.innerHTML = '<div id="app"></div>';
        window.eval(fs.readFileSync(path.join(root, 'dist/bundle.js'), 'utf8'));
        await new Promise((resolve) => setTimeout(resolve, 0));
        assert.deepEqual(
          Array.from(window.captures),
          stop ? ['middle'] : ['middle', 'page', 'app'],
          `${mode}: a compiled component hook must ${stop ? 'stop' : 'forward'} the child error`,
        );
      } finally {
        await window.happyDOM.close();
      }
      console.log(`${mode}: compiled onErrorCaptured ${stop ? 'stops' : 'forwards'} the error`);
    }
  }
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}

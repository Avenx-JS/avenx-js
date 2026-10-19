/**
 * @file scopedSlotBuild.test.js
 * @description Scoped slots must survive real development and production builds.
 */
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Window } from 'happy-dom';
import AvenxCompiler from '../../lib/compiler.js';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'avenx-scoped-build-'));

/**
 * Writes one source file in the fixture project.
 * @param {string} relative - Project-relative filename.
 * @param {string} contents - Source text.
 */
function write(relative, contents) {
  const full = path.join(root, relative);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, contents);
}

/**
 * Builds the actual fixture and evaluates only its emitted bundle.
 * @param {string} content - Parent component markup.
 * @param {'development'|'production'} mode - Build mode.
 * @returns {Promise<Window>} The window running the compiled application.
 */
async function mount(content, mode) {
  write(
    'src/pages/home.page.js',
    `<state parentCount="0" />
<action name="updateParent">parentCount++;</action>
<main><h1 id="heading">Still mounted</h1>
<button id="update-parent" @click="updateParent()">Update parent {{ parentCount }}</button>${content}</main>`,
  );
  new AvenxCompiler({ rootDir: root, srcDir: 'src', distDir: 'dist', mode, logging: { silent: true } }).build();
  const window = new Window({ url: 'http://localhost' });
  window.document.body.innerHTML = '<div id="app"></div>';
  window.eval(fs.readFileSync(path.join(root, 'dist/bundle.js'), 'utf8'));
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.strictEqual(
    window.document.querySelector('#heading')?.textContent,
    'Still mounted',
    `${mode}: a slot wrapper must not blank the whole page`,
  );
  return window;
}

try {
  write('avenx.config.json', '{}');
  const child = `
<state label="Avenx" visible="true" number="2" html="<b>rich</b>" />
<action name="rename">label = 'Updated'; visible = false; number = 5;</action>
<section>
  <button id="rename" @click="rename()">Rename</button>
  <slot :label="label" :visible="visible" :number="number" :html="html"><p id="fallback">Fallback: {{ label }}</p></slot>
</section>`;
  write('src/components/probe/probe.component.js', child);
  write(
    'src/main.app.js',
    `import { AvenxApp } from 'avenx-core/runtime';
import Probe from './components/probe/probe.component.js';
const app = new AvenxApp({ target: '#app' });
app.register('Probe', Probe);
app.initRouter({ '': 'Home' });`,
  );

  for (const mode of ['development', 'production']) {
    write('src/components/probe/probe.component.js', child);
    const scoped = await mount(
      `<Probe><template data-slot-props="slotProps">
<p id="scoped" data-ax-show="slotProps.visible">Value: {{ slotProps.label }}</p>
<div id="raw">{{{ slotProps.html }}}</div>
<p id="comparison">{{ slotProps.number > 1 }} / {{ slotProps.number < 3 }}</p>
<p id="logical">{{ slotProps.visible && slotProps.label }}</p>
<p id="entity">{{ slotProps.label === '&lt;' ? 'match' : '&lt;' }}</p>
<p id="literal">&lt;em&gt;literal&lt;/em&gt;</p>
<p id="parent">{{ parentCount }}: {{ slotProps.label }}</p>
</template></Probe>`,
      mode,
    );
    try {
      assert.strictEqual(
        scoped.document.querySelector('#scoped')?.textContent,
        'Value: Avenx',
        `${mode}: the documented scoped-slot content receives the child's value\n${scoped.document.body.innerHTML}`,
      );
      assert.strictEqual(
        scoped.document.querySelector('#raw b')?.textContent,
        'rich',
        `${mode}: escaped raw interpolations must also be compiled`,
      );
      assert.strictEqual(scoped.document.querySelector('#comparison')?.textContent, 'true / true');
      assert.strictEqual(scoped.document.querySelector('#logical')?.textContent, 'Avenx');
      assert.strictEqual(scoped.document.querySelector('#entity')?.textContent, '&lt;');
      assert.strictEqual(scoped.document.querySelector('#literal')?.textContent, '<em>literal</em>');
      assert.strictEqual(scoped.document.querySelector('#literal em'), null, 'literal text must stay inert');
      scoped.document.querySelector('#rename').click();
      await new Promise((resolve) => setTimeout(resolve, 0));
      assert.strictEqual(scoped.document.querySelector('#scoped')?.textContent, 'Value: Updated');
      assert.strictEqual(scoped.document.querySelector('#scoped')?.style.display, 'none');
      assert.strictEqual(scoped.document.querySelector('#comparison')?.textContent, 'true / false');
      assert.strictEqual(scoped.document.querySelector('#logical')?.textContent, 'false');
      scoped.document.querySelector('#update-parent').click();
      await new Promise((resolve) => setTimeout(resolve, 0));
      assert.strictEqual(scoped.document.querySelector('#parent')?.textContent, '1: Updated');
      assert.strictEqual(scoped.document.querySelector('#comparison')?.textContent, 'true / false');
    } finally {
      scoped.happyDOM.abort();
    }

    const fallback = await mount('<Probe />', mode);
    try {
      assert.strictEqual(
        fallback.document.querySelector('#fallback')?.textContent,
        'Fallback: Avenx',
        `${mode}: no projected content keeps the child's fallback`,
      );
    } finally {
      fallback.happyDOM.abort();
    }

    write('src/components/probe/probe.component.js', child.replace('<slot :label=', '<slot name="row" :label='));
    const named = await mount(
      `<Probe><template slot="row" data-slot-props="rowProps">
<p id="named">{{ rowProps.label }}</p>
</template></Probe>`,
      mode,
    );
    try {
      assert.strictEqual(
        named.document.querySelector('#named')?.textContent,
        'Avenx',
        `${mode}: named scoped slots project to the matching outlet`,
      );
    } finally {
      named.happyDOM.abort();
    }

    const inert = await mount('<Probe><template slot="header"><p>{{ 1 + 1 }}</p></template></Probe>', mode);
    inert.happyDOM.abort();
    console.log(`Scoped-slot builds render correctly in ${mode}.`);
  }
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}

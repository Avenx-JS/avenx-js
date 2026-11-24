// @avenx-no-dev-runtime
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import '../helpers/register-happy-dom.js';
import '../../lib/core/renderer/installStringRenderer.js';
import ComponentParser from '../../lib/compiler/ComponentParser.js';
import StyleProcessor from '../../lib/compiler/StyleProcessor.js';
import { AvenxComponent } from '../../lib/core/runtime/AvenxComponent.js';
import { AvenxPage } from '../../lib/core/runtime/AvenxPage.js';
import { EXPRESSION_OPS } from '../../lib/core/expression/ops.js';
import { hasExpressionInterpreter } from '../../lib/core/expression/fallback.js';

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'avenx-underscore-tags-'));
let sequence = 0;
function compile(source, production, type = 'component') {
  const name = `UnderscoreTags${sequence++}`;
  const file = path.join(scratch, `${name}.${type}.js`);
  fs.writeFileSync(file, source);
  const parser = new ComponentParser(new StyleProcessor(), [], { logging: { silent: true } });
  parser.production = production;
  const output = parser.parse(file, type);
  return new Function('AvenxComponent', 'AvenxPage', ...Object.keys(EXPRESSION_OPS), `${output}\nreturn ${name};`)(
    AvenxComponent, AvenxPage, ...Object.values(EXPRESSION_OPS),
  );
}

try {
  assert.equal(hasExpressionInterpreter(), false);
  for (const production of [false, true]) {
    const Child = compile('<strong>{{ props.label }}</strong><slot></slot>', production);
    for (const name of ['Profile_Card', 'Card_2', 'Card_']) {
      const registry = new Map([[name, Child]]);
      for (const compiled of [true, false]) {
        const Page = compile(
          `<state label="first" attribute="'data-label'" />\n<${name} :label="label" /><${name} :label="label"><em>slotted</em></${name}>`
            + (compiled ? '' : '<i :[attribute]="label"></i>'),
          production, 'page',
        );
        const page = new Page({}, registry);
        const root = document.createElement('div');
        document.body.appendChild(root);
        try {
          page.mount(root);
          assert.equal(page.$compiled, compiled, 'the test must cover both render paths');
          assert.deepEqual(
            [...root.querySelectorAll('strong')].map((node) => node.textContent),
            ['first', 'first'],
            `${name} mounts from both self-closing and paired tags`,
          );
          assert.equal(root.querySelector('em')?.textContent, 'slotted');
          page.state.label = 'updated';
          await page.$nextTick();
          assert.deepEqual([...root.querySelectorAll('strong')].map((node) => node.textContent), ['updated', 'updated']);
        } finally {
          await page.unmount();
          root.remove();
        }
      }
    }
  }
} finally {
  fs.rmSync(scratch, { recursive: true, force: true });
}
console.log('Registered component names containing underscores mount and update on both render paths.');

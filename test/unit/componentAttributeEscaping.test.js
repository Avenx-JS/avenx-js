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

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'avenx-component-attributes-'));
let sequence = 0;
function compile(source, production, type = 'component') {
  const name = `EscapedAttributes${sequence++}`;
  const file = path.join(scratch, `${name}.${type}.js`);
  fs.writeFileSync(file, source);
  const parser = new ComponentParser(new StyleProcessor(), [], { logging: { silent: true } });
  parser.production = production;
  const output = parser.parse(file, type);
  const names = Object.keys(EXPRESSION_OPS);
  return new Function('AvenxComponent', 'AvenxPage', ...names, `${output}\nreturn ${name};`)(
    AvenxComponent, AvenxPage, ...Object.values(EXPRESSION_OPS),
  );
}

try {
  assert.equal(hasExpressionInterpreter(), false, 'production behavior must not be rescued by an interpreter');
  for (const production of [false, true]) {
    const Child = compile('<p>{{ props.text }}</p>', production);
    const Other = compile('<aside>{{ props.text }}</aside>', production);
    const registry = new Map([['Child', Child], ['Other', Other]]);
    for (const prop of [
      ':text=\'flag ? "A & B" : "C < D"\'',
      'data-props-text=\'flag ? "A & B" : "C < D"\'',
      'text=\'{{ flag ? "A & B" : "C < D" }}\'',
    ]) {
      const Page = compile(`<state selected="Child" flag="true" />\n<Component :is="selected" ${prop} />`, production, 'page');
      const page = new Page({}, registry);
      const root = document.createElement('div');
      document.body.appendChild(root);
      try {
        page.mount(root);
        assert.equal(page.$compiled, false, 'dynamic components exercise the real fallback path');
        assert.equal(root.querySelector('p')?.textContent, 'A & B', `initial prop: ${prop}`);
        page.state.flag = false;
        await page.$nextTick();
        assert.equal(root.querySelector('p')?.textContent, 'C < D', `updated prop: ${prop}`);
      } finally {
        await page.unmount();
        root.remove();
      }
    }

    const Page = compile(
      '<state flag="true" />\n<Component :is=\'flag ? "Child" : "Other"\' :text=\'"&quot;literal&quot;"\' />',
      production, 'page',
    );
    const page = new Page({}, registry);
    const root = document.createElement('div');
    document.body.appendChild(root);
    try {
      page.mount(root);
      assert.equal(root.querySelector('p')?.textContent, '&quot;literal&quot;', 'entity-looking string content is preserved');
      page.state.flag = false;
      await page.$nextTick();
      assert.equal(root.querySelector('p'), null);
      assert.equal(root.querySelector('aside')?.textContent, '&quot;literal&quot;', 'quoted selectors swap components');
    } finally {
      await page.unmount();
      root.remove();
    }
  }
} finally {
  fs.rmSync(scratch, { recursive: true, force: true });
}
console.log('Quoted component bindings and selectors render and update without the development interpreter.');

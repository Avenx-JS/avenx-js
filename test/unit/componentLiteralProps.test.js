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

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'avenx-component-literals-'));
let sequence = 0;
function compile(source, production, type = 'component') {
  const name = `LiteralProps${sequence++}`;
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
  const values = [String.raw`H:\notes\report.txt`, String.raw`a \\ pair`, "can't\\wait", 'line one\nline two', 'a\tb'];
  for (const production of [false, true]) {
    const Child = compile('<p>{{ props.text }}</p>', production);
    const registry = new Map([['Child', Child]]);
    for (const compiled of [true, false]) {
      for (const value of values) {
        const tag = compiled ? 'Child' : 'Component :is="selected"';
        const Page = compile(
          `<state selected="Child" />\n<${tag} text="${value}" count="3" active="true" absent="null" empty="" />`,
          production, 'page',
        );
        const page = new Page({}, registry);
        const root = document.createElement('div');
        document.body.appendChild(root);
        try {
          page.mount(root);
          assert.equal(page.$compiled, compiled);
          assert.equal(root.querySelector('p')?.textContent, value, `literal survives ${compiled ? 'compiled' : 'fallback'} rendering`);
          const child = root.querySelector('[data-avenx-comp]')?.__avenx_comp_instance
            || root.querySelector('[data-avenx-comp-dynamic]')?.__avenx_comp_instance;
          assert.equal(child.props.text, value);
          assert.equal(child.props.count, 3, 'numeric literals keep their type');
          assert.equal(child.props.active, true);
          assert.equal(child.props.absent, null);
          assert.equal(child.props.empty, '');
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
console.log('Static component props preserve backslashes and control characters on both rendering paths.');

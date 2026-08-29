/**
 * Source locations, checked against the file rather than against themselves.
 *
 * This is the assertion style that matters here: every reported line is used
 * to read that line back out of the original source and confirm it contains
 * what Atlas said was there. A test that only compared line numbers to
 * hard-coded constants would keep passing after a transformation shifted every
 * offset by two.
 *
 * The risk is real. The compiler strips imports, comments and declaration
 * blocks, applies style scoping and expands `data-ax-bind` before it validates
 * a template, so offsets into the string it validates point at nothing a
 * developer can open. Atlas masks the original file instead.
 */
import assert from 'assert';
import fs from 'fs';
import os from 'os';
import path from 'path';
import AvenxCompiler from '../../lib/compiler.js';
import { clearAtlasCache } from '../../lib/compiler/atlas/cache.js';
import { AtlasNodeKind } from '../../lib/compiler/atlas/AppModel.js';
import { lineIndex, maskDeclarations, positionAt } from '../../lib/compiler/atlas/source.js';

console.log('🧪 Testing Atlas source-location accuracy...');

/**
 * Writes a project and analyses it.
 * @param {Record<string, string>} files - Relative paths to contents.
 * @returns {{model: object, root: string}} The model and where it was written.
 */
function analyze(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'avenx-atlas-loc-'));
  for (const [relative, contents] of Object.entries(files)) {
    const full = path.join(root, relative);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, contents);
  }
  clearAtlasCache();
  const compiler = new AvenxCompiler({ rootDir: root, srcDir: 'src', distDir: 'dist', logging: { silent: true } });
  return { model: compiler.analyze(), root };
}

/**
 * Reads a 1-based line out of a file.
 * @param {string} root - Project root.
 * @param {object} loc - A location with `file` and `line`.
 * @returns {string} The line's text.
 */
function lineAt(root, loc) {
  const source = fs.readFileSync(path.join(root, loc.file), 'utf-8');
  return source.split(/\r?\n/)[loc.line - 1];
}

try {
  // ── Masking preserves offsets exactly ─────────────────────────────────────
  {
    const source = [
      "import cart from '../bridges/cart.bridge.js';",
      '',
      '<state qty="1" />',
      '',
      '<action name="bump">',
      '  state.qty = state.qty + 1;',
      '</action>',
      '',
      '<!-- {{ notAnInterpolation }} -->',
      '',
      '<div>{{ qty }}</div>',
    ].join('\n');

    const masked = maskDeclarations(source);
    assert.strictEqual(masked.length, source.length, 'the mask is the same length as the file');
    assert.strictEqual(
      masked.split('\n').length,
      source.split('\n').length,
      'and has the same number of lines, so offsets map to lines unchanged',
    );
    assert.ok(!masked.includes('notAnInterpolation'), 'a comment cannot contribute a binding');
    assert.ok(!masked.includes('state.qty'), 'an action body is not template');
    assert.ok(masked.includes('{{ qty }}'), 'the template survives');

    const starts = lineIndex(source);
    const at = positionAt(starts, masked.indexOf('{{ qty }}'));
    assert.strictEqual(at.line, 11, 'the interpolation is on the line it was written on');
    assert.strictEqual(source.split('\n')[at.line - 1].slice(at.column - 1, at.column - 1 + 9), '{{ qty }}');
  }

  // ── Reported locations point at the real thing ────────────────────────────
  {
    const component = [
      "import cart from '../../bridges/cart.bridge.js';",
      '',
      '<!--',
      '  A block comment long enough to shift every offset after it,',
      '  containing {{ decoy }} and @click="decoy()" that must not be seen.',
      '-->',
      '',
      '<state qty="1" note="" />',
      '',
      '<computed name="doubled" value="qty * 2" />',
      '',
      '<action name="bump">',
      '  state.qty = state.qty + 1;',
      '</action>',
      '',
      '<div @css wrap>',
      '  <span @css value>{{ qty }}</span>',
      '  <span @css twice>{{ doubled }}</span>',
      '  <button @css go @click="bump()">go</button>',
      '  <input data-ax-bind="note" />',
      '  <@for item in cart.items>',
      '    <p>{{ item.qty }}</p>',
      '  </@for>',
      '</div>',
      '',
    ].join('\n');

    const { model, root } = analyze({
      'avenx.config.json': JSON.stringify({ srcDir: 'src', distDir: 'dist' }),
      'src/bridges/cart.bridge.js': [
        "import { bridge } from 'avenx-core/runtime';",
        '',
        'export default bridge({',
        '  state: { items: [] },',
        '  get size() {',
        '    return this.items.length;',
        '  },',
        '  reset() {',
        '    this.items = [];',
        '  },',
        '});',
        '',
      ].join('\n'),
      'src/components/widget/widget.component.js': component,
      'src/components/widget/widget.component.css': '<@css>\n  wrap { display: block; }\n  value { color: red; }\n  twice { color: blue; }\n  go { cursor: pointer; }\n</@css>\n',
    });

    // Declarations.
    const declarations = [
      ['state:component:Widget.qty', '<state'],
      ['computed:component:Widget.doubled', '<computed name="doubled"'],
      ['action:component:Widget.bump', '<action name="bump"'],
    ];
    for (const [id, expected] of declarations) {
      const node = model.getNode(id);
      assert.ok(node, `${id} exists`);
      assert.ok(
        lineAt(root, node.loc).includes(expected),
        `${id} points at the line containing ${expected}, got: ${lineAt(root, node.loc)}`,
      );
    }

    // Template bindings and handlers: every one must be findable at its own
    // reported line AND column.
    const bindings = [...model.nodes.values()].filter(
      (node) => node.kind === AtlasNodeKind.BINDING || node.kind === AtlasNodeKind.HANDLER,
    );
    assert.ok(bindings.length >= 5, `expected several bindings, found ${bindings.length}`);

    for (const node of bindings) {
      const text = lineAt(root, node.loc);
      assert.ok(typeof text === 'string', `${node.id} reports a line that exists`);
      const atColumn = text.slice(node.loc.column - 1);
      const marker =
        node.kind === AtlasNodeKind.HANDLER
          ? `@${node.event}=`
          : node.binding === 'for'
            ? '<@for'
            : node.binding === 'text'
              ? '{{'
              : node.binding;
      assert.ok(
        atColumn.startsWith(marker),
        `${node.id} should start with "${marker}" at ${node.loc.file}:${node.loc.line}:${node.loc.column}, got "${atColumn.slice(0, 30)}"`,
      );
    }

    // The decoys inside the comment produced nothing.
    const componentFile = 'src/components/widget/widget.component.js';
    assert.ok(
      !model.edges.some(
        (item) => item.loc && item.loc.file === componentFile && item.loc.line >= 3 && item.loc.line <= 6,
      ),
      'nothing was recorded from inside the block comment',
    );
    assert.ok(
      ![...model.nodes.values()].some((node) => node.expression && node.expression.includes('decoy')),
      'the decoy interpolation never became a binding',
    );

    // A bridge member reports its own file and line.
    const getter = model.getNode('getter:bridge:cart.size');
    assert.ok(lineAt(root, getter.loc).includes('get size()'), 'a bridge getter points at its declaration');
    const action = model.getNode('action:bridge:cart.reset');
    assert.ok(lineAt(root, action.loc).includes('reset()'), 'a bridge action points at its declaration');

    // Two bindings on one line are distinguished by column.
    fs.rmSync(root, { recursive: true, force: true });
  }

  // ── Two bindings on one line get distinct, correct columns ────────────────
  {
    const { model, root } = analyze({
      'avenx.config.json': JSON.stringify({ srcDir: 'src', distDir: 'dist' }),
      'src/components/pair/pair.component.js': ['<state a="1" b="2" />', '', '<p>{{ a }} and {{ b }}</p>', ''].join('\n'),
    });

    const bindings = [...model.nodes.values()]
      .filter((node) => node.kind === AtlasNodeKind.BINDING)
      .sort((x, y) => x.loc.column - y.loc.column);

    assert.strictEqual(bindings.length, 2, 'both interpolations are modelled');
    assert.strictEqual(bindings[0].loc.line, bindings[1].loc.line, 'they share a line');
    assert.notStrictEqual(bindings[0].loc.column, bindings[1].loc.column, 'but not a column');

    const text = lineAt(root, bindings[0].loc);
    assert.ok(text.slice(bindings[0].loc.column - 1).startsWith('{{ a }}'), 'the first column addresses {{ a }}');
    assert.ok(text.slice(bindings[1].loc.column - 1).startsWith('{{ b }}'), 'the second addresses {{ b }}');

    fs.rmSync(root, { recursive: true, force: true });
  }

  console.log('✅ Atlas source-location tests passed.');
} catch (err) {
  console.error('❌ Atlas source-location test failed:', err);
  process.exit(1);
}

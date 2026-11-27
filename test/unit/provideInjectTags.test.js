import assert from 'assert';
import fs from 'fs';
import os from 'os';
import path from 'path';
import ComponentParser from '../../lib/compiler/ComponentParser.js';
import StyleProcessor from '../../lib/compiler/StyleProcessor.js';
import ExpressionParser from '../../lib/compiler/expressionParser.js';
import { parseDeclarations } from '../../lib/compiler/parser/declarations.js';
import { validateTemplate } from '../../lib/compiler/parser/validate.js';

console.log('🧪 Testing <provide> and <inject> declaration tags in compiler and validator...');

const sp = new StyleProcessor();
const cp = new ComponentParser(sp);
const ep = new ExpressionParser();
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'avenx-pi-unit-'));

function compileSource(source, name, isPage) {
  const filePath = path.join(scratch, `${name}.${isPage ? 'page' : 'component'}.js`);
  fs.writeFileSync(filePath, source);
  return cp.compileUnit(filePath, isPage ? 'page' : 'component');
}

/* -------------------------------------------------------------------------
 * 1. Parser & Declaration Extraction
 * ---------------------------------------------------------------------- */

// 1.1 List form (tag body)
{
  const source = `
<provide>
  theme
  setTheme
</provide>

<inject>
  theme
  setTheme
</inject>

<div>{{ theme }}</div>
`;

  const decls = parseDeclarations(source);
  assert.deepStrictEqual(decls.provide, ['theme', 'setTheme'], 'parses provide list form');
  assert.deepStrictEqual(decls.inject, ['theme', 'setTheme'], 'parses inject list form');
  assert.deepStrictEqual(ep.parseProvide(source), ['theme', 'setTheme'], 'ExpressionParser.parseProvide list form');
  assert.deepStrictEqual(ep.parseInject(source), ['theme', 'setTheme'], 'ExpressionParser.parseInject list form');
  assert.ok(!decls.template.includes('<provide'), 'strips <provide> from template');
  assert.ok(!decls.template.includes('<inject'), 'strips <inject> from template');
  assert.ok(decls.template.includes('<div>{{ theme }}</div>'), 'preserves template markup');
}

// 1.2 Renaming attribute form on <inject>
{
  const source = `
<inject currentTheme="theme" updateTheme="setTheme" />
<div>{{ currentTheme }}</div>
`;

  const decls = parseDeclarations(source);
  assert.deepStrictEqual(
    decls.inject,
    { currentTheme: 'theme', updateTheme: 'setTheme' },
    'parses inject renaming attributes as object',
  );
  assert.deepStrictEqual(
    ep.parseInject(source),
    { currentTheme: 'theme', updateTheme: 'setTheme' },
    'ExpressionParser.parseInject renaming form',
  );
  assert.ok(!decls.template.includes('<inject'), 'strips renaming <inject> from template');
}

// 1.3 Valueless attributes and self-closing tags
{
  const source = `
<provide theme setTheme />
<inject theme setTheme />
<span>Content</span>
`;

  const decls = parseDeclarations(source);
  assert.deepStrictEqual(decls.provide, ['theme', 'setTheme'], 'parses valueless attributes on <provide>');
  assert.deepStrictEqual(decls.inject, ['theme', 'setTheme'], 'parses valueless attributes on <inject>');
  assert.ok(!decls.template.includes('<provide'), 'strips self-closing <provide>');
  assert.ok(!decls.template.includes('<inject'), 'strips self-closing <inject>');
}

// 1.4 Comments and whitespace inside tag body
{
  const source = `
<provide>
  // Primary theme token
  theme,
  /* Action updater */
  setTheme
  <!-- HTML comment -->
  locales
</provide>
<div>test</div>
`;

  const decls = parseDeclarations(source);
  assert.deepStrictEqual(
    decls.provide,
    ['theme', 'setTheme', 'locales'],
    'ignores JS and HTML comments inside <provide>',
  );
}

// 1.5 Multiple tags and deduplication
{
  const source = `
<provide theme />
<provide>
  setTheme
  theme
</provide>
<inject theme />
<inject currentTheme="theme" />
`;

  const decls = parseDeclarations(source);
  assert.deepStrictEqual(decls.provide, ['theme', 'setTheme'], 'deduplicates multiple provide tags');
  assert.deepStrictEqual(
    decls.inject,
    { theme: 'theme', currentTheme: 'theme' },
    'normalizes mixed list + rename inject tags to object',
  );
}

// 1.6 Empty and commented-out tags
{
  const emptySource = `
<provide />
<provide></provide>
<inject />
<inject></inject>
<div>Hello</div>
`;

  const decls = parseDeclarations(emptySource);
  assert.deepStrictEqual(decls.provide, [], 'empty provide returns empty array');
  assert.deepStrictEqual(decls.inject, [], 'empty inject returns empty array');
  assert.ok(!decls.template.includes('<provide'), 'strips empty provide tags');
  assert.ok(!decls.template.includes('<inject'), 'strips empty inject tags');

  const commentedSource = `
<!-- <provide>theme</provide> -->
<!-- <inject currentTheme="theme" /> -->
<div>Active</div>
`;
  const commentedDecls = parseDeclarations(commentedSource);
  assert.deepStrictEqual(commentedDecls.provide, [], 'commented provide is ignored');
  assert.deepStrictEqual(commentedDecls.inject, [], 'commented inject is ignored');
}

/* -------------------------------------------------------------------------
 * 2. Codegen for .component.js and .page.js
 * ---------------------------------------------------------------------- */

// 2.1 Component codegen with provide and inject
{
  const source = `
<state theme="dark" />
<action name="setTheme">this.state.theme = 'light';</action>
<provide>
  theme
  setTheme
</provide>
<inject currentTheme="theme" />
<div>{{ currentTheme }}</div>
`;

  const code = compileSource(source, 'ThemeProvider', false);
  assert.ok(code.includes('class ThemeProvider extends AvenxComponent {'), 'extends AvenxComponent');
  assert.ok(code.includes('provide = ["theme","setTheme"];'), 'emits provide instance field');
  assert.ok(code.includes('inject = {"currentTheme":"theme"};'), 'emits inject instance field');
}

// 2.2 Page codegen with provide and inject
{
  const source = `
<state theme="dark" />
<provide theme />
<inject currentTheme="theme" />
<div>{{ currentTheme }}</div>
`;

  const code = compileSource(source, 'MainPage', true);
  assert.ok(code.includes('class MainPage extends AvenxPage {'), 'extends AvenxPage');
  assert.ok(code.includes('provide = ["theme"];'), 'emits provide instance field on page');
  assert.ok(code.includes('inject = {"currentTheme":"theme"};'), 'emits inject instance field on page');
}

// 2.3 No provide/inject tags -> zero diff on instance fields
{
  const source = `
<state count="0" />
<div>{{ count }}</div>
`;

  const compCode = compileSource(source, 'CounterComp', false);
  assert.ok(!compCode.includes('provide ='), 'does not emit provide field when absent');
  assert.ok(!compCode.includes('inject ='), 'does not emit inject field when absent');

  const pageCode = compileSource(source, 'CounterPage', true);
  assert.ok(!pageCode.includes('provide ='), 'does not emit provide field on page when absent');
  assert.ok(!pageCode.includes('inject ='), 'does not emit inject field on page when absent');
}

/* -------------------------------------------------------------------------
 * 3. Validator (AVX_W03)
 * ---------------------------------------------------------------------- */

// 3.1 Local injected identifiers suppress AVX_W03
{
  const source = `
<inject currentTheme="theme" setTheme="setTheme" />
<div @click="setTheme('light')">{{ currentTheme }}</div>
`;

  const warnings = [];
  const origWarn = console.warn;
  console.warn = (...args) => warnings.push(args.join(' '));
  try {
    validateTemplate(
      '<div @click="setTheme(\'light\')">{{ currentTheme }}</div>',
      {},
      {},
      {},
      {},
      '/app/Consumer.component.js',
      'Consumer',
      [],
      { content: source },
    );
  } finally {
    console.warn = origWarn;
  }

  const w03Warnings = warnings.filter((msg) => msg.includes('AVX_W03'));
  assert.strictEqual(w03Warnings.length, 0, 'no AVX_W03 emitted for local injected keys');
}

// 3.2 Renamed remote key or undeclared keys STILL emit AVX_W03
{
  const source = `
<inject currentTheme="theme" />
<div>{{ theme }} {{ unknownKey }}</div>
`;

  const warnings = [];
  const origWarn = console.warn;
  console.warn = (...args) => warnings.push(args.join(' '));
  try {
    validateTemplate(
      '<div>{{ theme }} {{ unknownKey }}</div>',
      {},
      {},
      {},
      {},
      '/app/Consumer.component.js',
      'Consumer',
      [],
      { content: source },
    );
  } finally {
    console.warn = origWarn;
  }

  const w03Warnings = warnings.filter((msg) => msg.includes('AVX_W03'));
  assert.ok(w03Warnings.length >= 1, 'AVX_W03 is emitted for remote key and undeclared key');
  assert.ok(
    w03Warnings.some((msg) => msg.includes('theme') || msg.includes('unknownKey')),
    'identifies unaliased remote key or unknownKey as undeclared',
  );
}

try {
  fs.rmSync(scratch, { recursive: true, force: true });
} catch {
  // best effort
}

console.log('✅ <provide> and <inject> declaration tag unit tests passed!');

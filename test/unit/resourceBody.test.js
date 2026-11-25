/**
 * @file resourceBody.test.js
 * @description A `<resource>` body is a function body, unless it is one bare expression (#2020).
 */
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { toResourceBody } from '../../lib/compiler/parser/resourceBody.js';
import { parseDeclarations } from '../../lib/compiler/parser/declarations.js';
import { compileActionToSource } from '../../lib/compiler/codegen/actions.js';
import { EXPRESSION_OPS } from '../../lib/core/expression/ops.js';
import ComponentParser from '../../lib/compiler/ComponentParser.js';
import StyleProcessor from '../../lib/compiler/StyleProcessor.js';

/**
 * Turns generated `($s) => …` source into a callable, with the primitives bound.
 * @param {string} generated - Generated source.
 * @returns {Function} The compiled body.
 */
function link(generated) {
  const names = Object.keys(EXPRESSION_OPS);
  return new Function(...names, `return (${generated});`)(...Object.values(EXPRESSION_OPS));
}

const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'avenx-resource-body-'));

/**
 * Compiles a component in production mode.
 * @param {string} label - Directory name.
 * @param {string} source - Component source.
 * @returns {{code: string, gaps: Array<{source: string, reason: string}>}} The result.
 */
function build(label, source) {
  const dir = path.join(workDir, label);
  fs.mkdirSync(dir);
  const file = path.join(dir, 'probe.component.js');
  fs.writeFileSync(file, source);
  const parser = new ComponentParser(new StyleProcessor());
  parser.production = true;
  const result = parser.parse(file);
  return { result, gaps: parser.expressionGaps.flatMap((unit) => unit.gaps) };
}

try {
  console.log('🧪 A bare expression is returned');

  const expressions = {
    "fetch('/api')": "return fetch('/api');",
    "fetch('/a;b')": "return fetch('/a;b');",
    'fetch(url)\n  .then((r) => r.json())': 'return fetch(url)\n  .then((r) => r.json());',
    'load().then((r) => { log(r); return r; })': 'return load().then((r) => { log(r); return r; });',
    'await load()': 'return await load();',
    'returnsRows()': 'return returnsRows();',
    'this.fetchUserProfile': 'return this.fetchUserProfile;',
    '{ a: 1 }': 'return { a: 1 };',
    'load() // all': 'return load() // all;',
    '// all\nload()': 'return (// all\nload()\n);',
  };
  for (const [source, body] of Object.entries(expressions)) {
    assert.strictEqual(toResourceBody(source), body);
    assert.strictEqual(toResourceBody(body), body, 'applying it again changes nothing');
    // Every one of them compiles.
    compileActionToSource(body, { ambient: true });
  }

  console.log('🧪 Anything else is used as written');

  for (const source of [
    'return load();',
    'return load()',
    'const id = 1;\nreturn load(id);',
    'const id = 1\nreturn load(id)',
    'if (!id) return null;\nreturn load(id);',
    'id = 1; return load(id);',
    'try { return load(); } catch { return null; }',
    'throw new Error("no")',
    'load();',
    'const = 1',
    '',
  ]) {
    assert.strictEqual(toResourceBody(source), source);
  }
  assert.strictEqual(toResourceBody('  load()\n'), 'return load();');

  console.log('🧪 The declaration reader and the component compiler agree');

  const multiLine = '<resource name="user">\n  const id = state.userId;\n  return Promise.resolve({ name: "Ada " + id });\n</resource>';
  assert.strictEqual(
    parseDeclarations(multiLine).resources[0].handler,
    'const id = state.userId;\n  return Promise.resolve({ name: "Ada " + id });',
  );

  const page = `<state userId="1" />\n${multiLine}\n<resource name="plain">Promise.resolve(state.userId)</resource>\n<resource name="poll" pollInterval="5000" handler="Promise.resolve(2)" />\n<div><p>{{ user.name }} {{ plain }} {{ poll }}</p></div>`;
  const built = build('multi-line', page);
  assert.deepStrictEqual(built.gaps, [], 'nothing left uncompiled');
  const code = typeof built.result === 'string' ? built.result : built.result.code || JSON.stringify(built.result);
  const table = code.match(/\.__axResources = (\{[\s\S]*?\n\});/);
  assert.ok(table, 'the resources are compiled');
  const compiled = link(table[1]);
  const scope = { state: { userId: 1 } };
  assert.deepStrictEqual(await compiled.user(scope), { name: 'Ada 1' });
  assert.strictEqual(await compiled.plain(scope), 1);
  assert.strictEqual(await compiled.poll(scope), 2);

  console.log('🧪 A broken body is reported as the developer wrote it');

  const broken = build('broken', '<resource name="user">\n  const id = ;\n</resource>\n<div><p>{{ user }}</p></div>');
  assert.deepStrictEqual(broken.gaps.map((gap) => gap.source), ['const id = ;']);

  console.log('  ✅ Resource body tests passed!');
} catch (error) {
  console.error('❌ Resource body tests failed:', error);
  process.exitCode = 1;
} finally {
  fs.rmSync(workDir, { recursive: true, force: true });
}

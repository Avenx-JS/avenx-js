/**
 * @file expressionCoverage.test.js
 * @description Every expression a fixture application contains must compile.
 *
 * This is the invariant that makes dropping the interpreter from production
 * safe. An expression the generator misses does not fail loudly at build time —
 * it is reported as AVX_W48 and then, in a production bundle with no
 * interpreter, throws at the moment that binding first evaluates. That is a
 * long way from the mistake, so the distance is closed here instead: if the
 * compiler stops finding a class of expression, this fails on the next run
 * rather than on someone's page.
 *
 * It is a coverage test for the collector, not for the generator. The generator
 * is covered by differential tests against the interpreter; what can silently
 * rot is the scan that decides which expressions exist at all, because its
 * failure mode is an absence rather than an error. It has rotted three times
 * already while this was being written: `@submit.prevent` stays in its authored
 * form rather than becoming a `data-ax-event` payload, a doubly nested loop
 * body is marked `{%% … %%}` rather than `{% … %}`, and `data-ax-style` holds
 * an interpolation rather than a bare expression. Only the last of those was
 * caught by anything other than a browser clicking a button.
 */

import assert from 'assert';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import AvenxCompiler from '../../lib/compiler.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../..');
const appsDir = path.join(repoRoot, 'test/e2e/apps');

console.log('🧪 Testing every fixture expression compiles...');

/**
 * Compiles a project and returns what the generator could not cover.
 * @param {string} root - The project root.
 * @returns {Array<{name: string, refusals: object[], gaps: object[]}>} The gaps.
 */
function gapsFor(root) {
  const original = { log: console.log, info: console.info, warn: console.warn };
  console.log = () => {};
  console.info = () => {};
  console.warn = () => {};
  try {
    const compiler = new AvenxCompiler({ rootDir: root, srcDir: 'src', distDir: 'dist', mode: 'production' });
    compiler.build();
    return compiler.componentParser.expressionGaps;
  } finally {
    Object.assign(console, original);
  }
}

const apps = fs
  .readdirSync(appsDir, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .filter((name) => fs.existsSync(path.join(appsDir, name, 'avenx.config.json')))
  .sort();

assert.ok(apps.length > 0, 'no fixture applications were found to check');

const offenders = [];
for (const app of apps) {
  const gaps = gapsFor(path.join(appsDir, app));
  for (const unit of gaps || []) {
    for (const gap of [...unit.refusals, ...unit.gaps]) {
      offenders.push(`${app}/<${unit.name}> ${JSON.stringify(gap.source)} — ${gap.reason}`);
    }
  }
}

assert.deepStrictEqual(
  offenders,
  [],
  'these expressions did not compile, so a production build of them would carry no way to evaluate them:\n  ' +
    offenders.join('\n  '),
);

console.log(`  ✅ All expressions in ${apps.length} fixture applications compile.`);

console.log('🧪 Testing that an uncompilable template expression fails the build...');
{
  // Stronger than the check above, and worth pinning separately: a template
  // expression outside the language does not become an AVX_W48 warning that a
  // production build then cannot evaluate. It fails the build, with the file,
  // the line and a caret. `await` is not an expression in Avenx's template
  // language and never will be, so it is a stable stand-in.
  const root = fs.mkdtempSync(path.join(repoRoot, 'node_modules', '.avenx-gap-'));
  try {
    const write = (relative, contents) => {
      const full = path.join(root, relative);
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, contents);
    };
    write('avenx.config.json', '{}');
    write(
      'src/components/gap/gap.component.js',
      '<state value="1" />\n\n<div><p>{{ await value }}</p></div>\n',
    );
    write(
      'src/main.app.js',
      "import { AvenxApp } from 'avenx-core/runtime';\n" +
        "import Gap from './components/gap/gap.component.js';\n" +
        "const app = new AvenxApp({ target: '#app' });\napp.register('Gap', Gap);\napp.mount('Gap');\n",
    );

    let raised = null;
    try {
      gapsFor(root);
    } catch (error) {
      raised = error;
    }

    assert.ok(raised, 'an expression outside the template language did not fail the build');
    assert.strictEqual(raised.code, 'AVX_R32', `expected AVX_R32, got ${raised.code}`);
    assert.ok(
      typeof raised.frame === 'string' && raised.frame.includes('^'),
      'the failure did not point at the expression',
    );
    console.log('  ✅ It fails the build with AVX_R32 and a source frame.');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

console.log('\n🎉 Expression coverage holds.');

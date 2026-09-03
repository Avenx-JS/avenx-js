const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vscodeOniguruma = require('vscode-oniguruma');
const vscodeTextmate = require('vscode-textmate');

const extensionRoot = path.resolve(__dirname, '..');
const grammarPath = path.join(extensionRoot, 'syntaxes', 'avenx.tmLanguage.json');

function readGrammar() {
  return JSON.parse(fs.readFileSync(grammarPath, 'utf8'));
}

function testGrammarStructure() {
  const grammar = readGrammar();

  assert.strictEqual(grammar.name, 'Avenx');
  assert.strictEqual(grammar.scopeName, 'source.avenx');
  assert.ok(grammar.repository);
  assert.ok(grammar.repository['avenx-template']);
  assert.ok(grammar.repository['avenx-interpolation']);
  assert.ok(grammar.repository['avenx-unescaped-interpolation']);
  assert.ok(grammar.repository['avenx-compiler-tag']);
  assert.ok(grammar.repository['avenx-data-attribute']);
  assert.ok(grammar.repository['avenx-event']);
  assert.ok(grammar.repository['avenx-css-block']);

  const templatePatterns = grammar.repository['avenx-template'].patterns.map(
    (pattern) => pattern.include,
  );

  assert.ok(templatePatterns.includes('#avenx-unescaped-interpolation'));
  assert.ok(templatePatterns.includes('#avenx-interpolation'));
  assert.ok(templatePatterns.includes('#avenx-css-block'));
  assert.ok(templatePatterns.includes('#avenx-compiler-tag'));
  assert.ok(templatePatterns.includes('#avenx-data-attribute'));
  assert.ok(templatePatterns.includes('#avenx-event'));

  const unescapedIndex = templatePatterns.indexOf('#avenx-unescaped-interpolation');
  const escapedIndex = templatePatterns.indexOf('#avenx-interpolation');

  assert.ok(
    unescapedIndex < escapedIndex,
    'Unescaped interpolation must be matched before escaped interpolation.',
  );
}

function testAvenxPatterns() {
  const grammarText = fs.readFileSync(grammarPath, 'utf8');

  const requiredPatterns = [
    '\\{\\{\\{',
    '\\{\\{',
    '<@/?[A-Za-z]',
    'data-ax-',
    '@[A-Za-z]',
    '<@(css|global)',
    'source.css',
    'text.html.basic',
  ];

  for (const pattern of requiredPatterns) {
    assert.ok(
      grammarText.includes(pattern),
      `Expected grammar pattern to contain: ${pattern}`,
    );
  }
}

async function loadGrammar() {
  const wasmPath = require.resolve(
    'vscode-oniguruma/release/onig.wasm',
  );

  const wasmBuffer = fs.readFileSync(wasmPath);

  await vscodeOniguruma.loadWASM(wasmBuffer);

  const registry = new vscodeTextmate.Registry({
    onigLib: Promise.resolve({
      createOnigScanner(patterns) {
        return new vscodeOniguruma.OnigScanner(patterns);
      },
      createOnigString(s) {
        return new vscodeOniguruma.OnigString(s);
      },
    }),

    loadGrammar: async (scopeName) => {
      if (scopeName === 'source.avenx') {
        return vscodeTextmate.parseRawGrammar(
          fs.readFileSync(grammarPath, 'utf8'),
          grammarPath,
        );
      }

      return null;
    },
  });

  return registry.loadGrammar('source.avenx');
}

async function testTokenization() {
  const grammar = await loadGrammar();

  const fixture = [
    'static template = `',
    '<div data-ax-id="card" @click={handleClick}>',
    '  <span>{{ title }}</span>',
    '  <span>{{{ html }}</span>',
    '  <@for item in items>',
    '    <div>{{ item }}</div>',
    '  </@for>',
    '  <@css>',
    '    .card { color: red; }',
    '  </@css>',
    '</div>',
    '`;',
  ].join('\\n');

  const lines = fixture.split('\\n');
  let state = vscodeTextmate.INITIAL;

  const tokens = [];

  for (const line of lines) {
    const result = grammar.tokenizeLine(line, state);

    for (const token of result.tokens) {
      tokens.push({
        text: line.slice(token.startIndex, token.endIndex),
        scopes: token.scopes,
      });
    }

    state = result.ruleStack;
  }

  const allScopes = tokens.flatMap((token) => token.scopes);

  assert.ok(
    allScopes.some((scope) =>
      scope.includes('interpolation'),
    ),
    'Expected interpolation scopes.',
  );

  assert.ok(
    allScopes.some((scope) =>
      scope.includes('unescaped'),
    ),
    'Expected unescaped interpolation scope.',
  );

  assert.ok(
    allScopes.some((scope) =>
      scope.includes('compiler'),
    ),
    'Expected compiler tag scope.',
  );

  assert.ok(
    allScopes.some((scope) =>
      scope.includes('data'),
    ),
    'Expected data-ax attribute scope.',
  );

  assert.ok(
    allScopes.some((scope) =>
      scope.includes('event'),
    ),
    'Expected event attribute scope.',
  );

  assert.ok(
    allScopes.some((scope) =>
      scope.includes('css'),
    ),
    'Expected CSS embedded scope.',
  );
}

async function main() {
  testGrammarStructure();
  testAvenxPatterns();
  await testTokenization();

  console.log('Avenx VS Code extension tests passed.');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

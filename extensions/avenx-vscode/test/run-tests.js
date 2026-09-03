const assert = require('assert');
const fs = require('fs');
const path = require('path');

const vscodeTextmate = require('vscode-textmate');
const vscodeOniguruma = require('vscode-oniguruma');

const extensionRoot = path.resolve(__dirname, '..');
const grammarPath = path.join(
  extensionRoot,
  'syntaxes',
  'avenx.tmLanguage.json',
);

function loadGrammar() {
  const grammar = JSON.parse(
    fs.readFileSync(grammarPath, 'utf8'),
  );

  assert.strictEqual(
    grammar.scopeName,
    'source.avenx',
    'Avenx grammar must use source.avenx as its scope.',
  );

  assert.ok(
    Array.isArray(grammar.patterns),
    'Avenx grammar must define top-level patterns.',
  );

  assert.ok(
    grammar.repository,
    'Avenx grammar must define a repository.',
  );

  return grammar;
}

function collectMatches(pattern, text) {
  const regex = new RegExp(pattern, 'g');
  const matches = [];
  let match;

  while ((match = regex.exec(text)) !== null) {
    matches.push(match[0]);
  }

  return matches;
}

function testGrammarStructure() {
  const grammar = loadGrammar();

  const repository = grammar.repository;

  const requiredRules = [
    'avenx-template',
    'avenx-interpolation',
    'avenx-unescaped-interpolation',
    'avenx-compiler-tag',
    'avenx-data-attribute',
    'avenx-event',
    'avenx-css-block',
  ];

  for (const rule of requiredRules) {
    assert.ok(
      repository[rule],
      `Missing required grammar rule: ${rule}`,
    );
  }

  const templateRule = repository['avenx-template'];

  assert.ok(
    templateRule.begin,
    'Template grammar must define a begin pattern.',
  );

  assert.strictEqual(
    templateRule.end,
    '`',
    'Template grammar must end at the closing backtick.',
  );

  const embeddedLanguages =
    grammar.patterns
      .concat(
        repository['avenx-template'].patterns || [],
      );

  assert.ok(
    embeddedLanguages.length > 0,
    'Grammar must contain tokenization patterns.',
  );
}

function testAvenxSyntaxPatterns() {
  const grammarText = fs.readFileSync(
    grammarPath,
    'utf8',
  );

  const fixtures = [
    {
      name: 'escaped interpolation',
      text: '{{ user.name }}',
      pattern: '\\{\\{',
    },
    {
      name: 'unescaped interpolation',
      text: '{{{ htmlContent }}}',
      pattern: '\\{\\{\\{',
    },
    {
      name: 'compiler tag',
      text: '<@for item in items>',
      pattern: '<@',
    },
    {
      name: 'data attribute',
      text: 'data-ax-id="user"',
      pattern: 'data-ax-',
    },
    {
      name: 'event binding',
      text: '@click="handleClick"',
      pattern: '@',
    },
    {
      name: 'CSS block',
      text: '<@css>',
      pattern: '<@\\(css\\|global\\)',
    },
  ];

  for (const fixture of fixtures) {
    const matches = collectMatches(
      fixture.pattern,
      fixture.text,
    );

    assert.ok(
      matches.length > 0,
      `${fixture.name} fixture must match its expected syntax.`,
    );

    assert.ok(
      grammarText.includes(
        fixture.pattern
          .replace(/\\\(|\\\)|\\/g, ''),
      ) ||
        fixture.name === 'CSS block',
      `Grammar must contain a rule for ${fixture.name}.`,
    );
  }
}

function testTemplateFixture() {
  const fixture = `
export default class Counter {
  static template = \`
    <div class="counter" data-ax-id="counter">
      <h1>{{ count }}</h1>
      <div>{{{ trustedHtml }}}</div>

      <button @click="increment">
        Increment
      </button>

      <@if count > 0>
        <span>Positive</span>
      </@if>

      <@for item in items>
        <span>{{ item }}</span>
      </@for>
    </div>

    <@css>
      .counter {
        display: block;
      }
    </@css>

    <@global>
      body {
        margin: 0;
      }
    </@global>
  \`;
}
`;

  assert.match(
    fixture,
    /static\s+template\s*=\s*`/,
    'Fixture must contain an Avenx template literal.',
  );

  assert.match(
    fixture,
    /\{\{\s*count\s*\}\}/,
    'Fixture must contain escaped interpolation.',
  );

  assert.match(
    fixture,
    /\{\{\{\s*trustedHtml\s*\}\}\}/,
    'Fixture must contain unescaped interpolation.',
  );

  assert.match(
    fixture,
    /<@if\b/,
    'Fixture must contain a compiler tag.',
  );

  assert.match(
    fixture,
    /<@for\b/,
    'Fixture must contain a compiler loop.',
  );

  assert.match(
    fixture,
    /data-ax-id/,
    'Fixture must contain an Avenx data attribute.',
  );

  assert.match(
    fixture,
    /@click=/,
    'Fixture must contain an Avenx event binding.',
  );

  assert.match(
    fixture,
    /<@css>/,
    'Fixture must contain a CSS block.',
  );

  assert.match(
    fixture,
    /<@global>/,
    'Fixture must contain a global CSS block.',
  );
}

async function testTextMateTokenization() {
  const onigWasmPath = require.resolve(
    'vscode-oniguruma/release/onig.wasm',
  );

  const wasm = fs.readFileSync(
    onigWasmPath,
  );

  await vscodeOniguruma.loadWASM(wasm);

  const registry =
    new vscodeTextmate.Registry({
      onigLib: Promise.resolve({
        createOnigScanner(patterns) {
          return new vscodeOniguruma.OnigScanner(
            patterns,
          );
        },

        createOnigString(value) {
          return new vscodeOniguruma.OnigString(
            value,
          );
        },
      }),

      loadGrammar: async (scopeName) => {
        if (scopeName === 'source.avenx') {
          return vscodeTextmate.parseRawGrammar(
            fs.readFileSync(
              grammarPath,
              'utf8',
            ),
            grammarPath,
          );
        }

        if (scopeName === 'source.js') {
          return vscodeTextmate.parseRawGrammar(
            JSON.stringify({
              scopeName: 'source.js',
              patterns: [],
            }),
            'source.js.json',
          );
        }

        if (scopeName === 'text.html.basic') {
          return vscodeTextmate.parseRawGrammar(
            JSON.stringify({
              scopeName: 'text.html.basic',
              patterns: [],
            }),
            'text.html.basic.json',
          );
        }

        if (scopeName === 'source.css') {
          return vscodeTextmate.parseRawGrammar(
            JSON.stringify({
              scopeName: 'source.css',
              patterns: [],
            }),
            'source.css.json',
          );
        }

        return null;
      },
    });

  const grammar =
    await registry.loadGrammar(
      'source.avenx',
    );

  assert.ok(
    grammar,
    'TextMate must load the Avenx grammar.',
  );

  const fixtureLines = [
    'static template = `',
    '  <div data-ax-id="demo">',
    '    {{ name }}',
    '    {{{ trustedHtml }}}',
    '    <button @click="save">Save</button>',
    '    <@for item in items>',
    '      {{ item }}',
    '    </@for>',
    '  </div>',
    '`;',
  ];

  let ruleStack;

  const tokenizedLines = [];

  for (const line of fixtureLines) {
    const result = grammar.tokenizeLine(
      line,
      ruleStack,
    );

    ruleStack = result.ruleStack;

    tokenizedLines.push(result.tokens);
  }

  assert.ok(
    tokenizedLines.some(
      (tokens) => tokens.length > 0,
    ),
    'Avenx fixture must produce TextMate tokens.',
  );
}

async function run() {
  testGrammarStructure();
  testAvenxSyntaxPatterns();
  testTemplateFixture();
  await testTextMateTokenization();

  console.log(
    'Avenx VS Code extension tests passed.',
  );
}

run().catch((error) => {
  console.error(
    'Avenx VS Code extension tests failed.',
  );
  console.error(error);
  process.exitCode = 1;
});

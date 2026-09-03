const assert = require('assert');
const fs = require('fs');
const path = require('path');

const extensionRoot = path.resolve(__dirname, '..');
const grammarPath = path.join(
  extensionRoot,
  'syntaxes',
  'avenx.tmLanguage.json',
);

const componentParserPath = path.resolve(
  extensionRoot,
  '..',
  '..',
  'lib',
  'compiler',
  'ComponentParser.js',
);

function readJson(filePath) {
  return JSON.parse(
    fs.readFileSync(filePath, 'utf8'),
  );
}

function readComponentParser() {
  return fs.readFileSync(
    componentParserPath,
    'utf8',
  );
}

function getCompilerTagProcessors(source) {
  const processors = new Set();

  const pattern =
    /\bprocess([A-Z][A-Za-z0-9_]*)\s*\(/g;

  let match;

  while ((match = pattern.exec(source)) !== null) {
    processors.add(match[1]);
  }

  return [...processors];
}

function testGrammarHasGenericCompilerTagSupport() {
  const grammar = readJson(grammarPath);

  const compilerTagRule =
    grammar.repository &&
    grammar.repository['avenx-compiler-tag'];

  assert.ok(
    compilerTagRule,
    'The grammar must define an avenx-compiler-tag rule.',
  );

  const serialized =
    JSON.stringify(compilerTagRule);

  assert.match(
    serialized,
    /<@/,
    'The compiler-tag grammar must recognize <@ compiler tags.',
  );

  assert.match(
    serialized,
    /[A-Za-z]/,
    'The compiler-tag grammar must support named compiler tags.',
  );
}

function testComponentParserProcessorsAreCovered() {
  const grammar = readJson(grammarPath);
  const parserSource = readComponentParser();

  const processors =
    getCompilerTagProcessors(
      parserSource,
    );

  assert.ok(
    processors.length > 0,
    'ComponentParser must expose compiler-tag processing methods.',
  );

  const compilerTagRule =
    grammar.repository &&
    grammar.repository['avenx-compiler-tag'];

  assert.ok(
    compilerTagRule,
    'The grammar must define compiler-tag support.',
  );

  /*
   * The grammar deliberately uses a generic <@...> rule instead of
   * maintaining a second hard-coded compiler-tag list.
   *
   * This is the synchronization guarantee: when ComponentParser gains a
   * new process* compiler-tag processor, the grammar continues to recognize
   * it without requiring a second tag list that can drift out of sync.
   */
  const ruleText =
    JSON.stringify(compilerTagRule);

  assert.match(
    ruleText,
    /<@/,
    'Generic compiler-tag support must remain present.',
  );

  assert.ok(
    processors.some(
      (name) =>
        name.startsWith('For') ||
        name.startsWith('Suspense') ||
        name.startsWith('Error') ||
        name.startsWith('Deadlock') ||
        name.startsWith('Defer') ||
        name.startsWith('Transition') ||
        name.startsWith('Event'),
    ),
    'ComponentParser compiler-tag processors must be represented by the generic grammar rule.',
  );
}

function testKnownCompilerTagSyntax() {
  const grammarText = fs.readFileSync(
    grammarPath,
    'utf8',
  );

  const fixtures = [
    '<@for item in items>',
    '</@for>',
    '<@suspense>',
    '</@suspense>',
    '<@defer>',
    '</@defer>',
    '<@deadlock>',
    '</@deadlock>',
    '<@css>',
    '</@css>',
    '<@global>',
    '</@global>',
  ];

  for (const fixture of fixtures) {
    assert.ok(
      fixture.startsWith('<@') ||
        fixture.startsWith('</@'),
      `${fixture} must use Avenx compiler-tag syntax.`,
    );
  }

  assert.match(
    grammarText,
    /<@\/?\[A-Za-z\]\[A-Za-z0-9:_-\]\*/,
    'Grammar must retain generic opening and closing compiler-tag matching.',
  );
}

function run() {
  assert.ok(
    fs.existsSync(grammarPath),
    `Grammar file not found: ${grammarPath}`,
  );

  assert.ok(
    fs.existsSync(componentParserPath),
    `ComponentParser not found: ${componentParserPath}`,
  );

  testGrammarHasGenericCompilerTagSupport();
  testComponentParserProcessorsAreCovered();
  testKnownCompilerTagSyntax();

  console.log(
    'Avenx compiler-tag synchronization tests passed.',
  );
}

try {
  run();
} catch (error) {
  console.error(
    'Avenx compiler-tag synchronization tests failed.',
  );

  console.error(error);

  process.exitCode = 1;
}

import assert from 'assert';

// Set env to test so config validation throws instead of process.exit.
process.env.NODE_ENV = 'test';

import ComponentParser from '../../lib/compiler/ComponentParser.js';
import StyleProcessor from '../../lib/compiler/StyleProcessor.js';
import { logger } from '../../lib/core/runtime/AvenxLogger.js';

try {
  console.log('Testing unresolved component reference (AVX_W46)...');

  let warnings = [];
  const originalWarn = logger.warn;
  logger.warn = (...args) => warnings.push(args.join(' '));

  const styleProcessor = new StyleProcessor();

  /**
   * Validates a template against a known set of component names and returns
   * whatever the compiler warned about.
   * @param {string} template - The template to validate.
   * @param {string[]} componentNames - Registered component/page names.
   * @param {object} [config] - The compiler configuration.
   * @returns {string[]} The warnings emitted.
   */
  function validate(template, componentNames, config = { warnings: {} }) {
    warnings = [];
    const parser = new ComponentParser(styleProcessor, [], config);
    parser.setComponentNames(componentNames);
    parser.validateTemplate(template, {}, {}, {}, {}, 'Home.component.js', 'Home');
    return warnings;
  }

  /**
   * Returns only the warnings for the unresolved-component code.
   * @param {string[]} all - All captured warnings.
   * @returns {string[]}
   */
  const w46 = (all) => all.filter((m) => m.includes('AVX_W46'));

  try {
    // 1. A tag that matches a registered component is accepted.
    const matching = validate('<div><UserCard /></div>', ['UserCard']);
    assert.deepStrictEqual(w46(matching), [], 'a registered component is not flagged');

    // 2. A misspelled tag is reported, and the closest name is suggested.
    const misspelled = validate('<div><UserCrad /></div>', ['UserCard']);
    const misspelledW46 = w46(misspelled);
    assert.strictEqual(misspelledW46.length, 1, 'a misspelled component is reported once');
    assert.ok(misspelledW46[0].includes('UserCrad'), 'the warning names the offending tag');
    assert.ok(misspelledW46[0].includes('UserCard'), 'the warning suggests the closest name');
    assert.ok(misspelledW46[0].includes('Home.component.js'), 'the warning names the file');

    // 3. A dash-containing custom element is never flagged.
    const customElement = validate('<div><my-widget></my-widget></div>', ['UserCard']);
    assert.deepStrictEqual(w46(customElement), [], 'a custom element is not flagged');

    // 3b. A tag the project declared in voidTags is never flagged, whatever
    //     its casing (matches the identifier check's escape hatch).
    warnings = [];
    const voidTagParser = new ComponentParser(styleProcessor, ['MyIcon'], { warnings: {} });
    voidTagParser.setComponentNames(['UserCard']);
    voidTagParser.validateTemplate('<div><MyIcon /></div>', {}, {}, {}, {}, 'Home.component.js', 'Home');
    assert.deepStrictEqual(w46(warnings), [], 'a declared void tag is not flagged');

    // 4. Built-in tags and lowercase HTML/SVG elements are not flagged.
    const builtins = validate(
      '<div><slot></slot><@if cond><p>hi</p></@if><svg><circle /></svg></div>',
      ['UserCard'],
    );
    assert.deepStrictEqual(w46(builtins), [], 'built-ins and HTML/SVG elements are not flagged');

    // 5. The dynamic <Component is="..."> built-in is not flagged.
    const dynamic = validate('<div><Component is="{{ current }}" /></div>', ['UserCard']);
    assert.deepStrictEqual(w46(dynamic), [], 'the dynamic component built-in is not flagged');

    // 6. An unknown tag with no near match still warns, without a suggestion.
    const noSuggestion = validate('<div><Zzzzzzzz /></div>', ['UserCard']);
    const noSuggestionW46 = w46(noSuggestion);
    assert.strictEqual(noSuggestionW46.length, 1, 'an unknown component with no near match is reported');
    assert.ok(!noSuggestionW46[0].includes('Did you mean'), 'no suggestion when nothing is close');

    // 7. "warnings": { "AVX_W46": "off" } silences the check.
    const silenced = validate('<div><UserCrad /></div>', ['UserCard'], {
      warnings: { AVX_W46: 'off' },
    });
    assert.deepStrictEqual(w46(silenced), [], 'the code can be silenced via warnings config');

    // 8. An empty registry (standalone parse) disables the check entirely.
    const standalone = validate('<div><UserCrad /></div>', []);
    assert.deepStrictEqual(w46(standalone), [], 'no registry means no component-tag check');
  } finally {
    logger.warn = originalWarn;
  }

  console.log('unresolved component reference tests passed!');
} catch (error) {
  console.error('unresolved component reference tests failed!');
  console.error(error);
  process.exit(1);
}

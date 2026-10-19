import assert from 'assert';

// Set env to test so config validation throws instead of process.exit.
process.env.NODE_ENV = 'test';

import ComponentParser from '../../lib/compiler/ComponentParser.js';
import StyleProcessor from '../../lib/compiler/StyleProcessor.js';
import { BUILTIN_COMPONENTS } from '../../lib/compiler/builtinComponents.js';
import { logger } from '../../lib/core/runtime/AvenxLogger.js';

try {
  console.log('Testing built-in tags and data-ax-as scope (AVX_W46 / AVX_W03)...');

  let warnings = [];
  const originalWarn = logger.warn;
  logger.warn = (...args) => warnings.push(args.join(' '));

  const styleProcessor = new StyleProcessor();

  /**
   * Validates a template and returns whatever the compiler warned about.
   * @param {string} template - The template to validate.
   * @param {object} [options] - Validation inputs.
   * @param {string[]} [options.componentNames] - Registered component names.
   * @param {object} [options.state] - Declared state.
   * @returns {string[]} The warnings emitted.
   */
  function validate(template, { componentNames = [], state = {} } = {}) {
    warnings = [];
    const parser = new ComponentParser(styleProcessor, [], { warnings: {} });
    parser.setComponentNames(componentNames);
    parser.validateTemplate(template, state, {}, {}, {}, 'Home.page.js', 'Home');
    return warnings;
  }

  const w46 = (all) => all.filter((m) => m.includes('AVX_W46'));
  const w03 = (all) => all.filter((m) => m.includes('AVX_W03'));

  const guideExample = `
<div style="height: 300px;">
  <VirtualList :item-height="30" :items="rows">
    <template data-ax-as="row">
      <div class="r">#{{ index }} {{ row.label }}</div>
    </template>
  </VirtualList>
</div>`;

  try {
    // 1. The built-in constant names VirtualList.
    assert.ok(BUILTIN_COMPONENTS.has('VirtualList'), 'VirtualList is a known built-in');

    // 2. <VirtualList> is not reported, even with a populated registry.
    const builtin = validate(guideExample, { componentNames: ['UserCard'], state: { rows: [] } });
    assert.deepStrictEqual(w46(builtin), [], '<VirtualList> is not flagged as unresolved');

    // 3. The guide's example compiles with no AVX_W03: row and index are
    //    introduced by data-ax-as, not read from the component.
    const guide = validate(guideExample, { componentNames: ['UserCard'], state: { rows: [] } });
    assert.deepStrictEqual(w03(guide), [], 'row and index are in scope inside the row template');

    // 4. A genuinely undeclared name inside a row template is still reported.
    const undeclared = validate(
      `<VirtualList :items="rows"><template data-ax-as="row"><div>{{ row.label }} {{ nope }}</div></template></VirtualList>`,
      { componentNames: ['UserCard'], state: { rows: [] } },
    );
    const undeclaredW03 = w03(undeclared);
    assert.strictEqual(undeclaredW03.length, 1, 'only the genuinely undeclared name is reported');
    assert.ok(undeclaredW03[0].includes('"nope"'), 'the warning names the undeclared variable');

    // 5. An unknown PascalCase tag still reports AVX_W46.
    const unknown = validate('<div><Zzzzzzzz /></div>', { componentNames: ['UserCard'] });
    assert.strictEqual(w46(unknown).length, 1, 'an unknown PascalCase tag is still reported');

    // 6. Matching is exact-case: a misspelled built-in is still reported.
    const misspelled = validate('<div><Virtuallist /></div>', { componentNames: ['UserCard'] });
    assert.strictEqual(w46(misspelled).length, 1, 'a misspelled built-in is still reported');

    // 7. A hand-written data-ax-as outside VirtualList also introduces its name.
    const manual = validate(
      '<template data-ax-for="rows" data-ax-as="r"><p>{{ r.label }} {{ index }}</p></template>',
      { state: { rows: [] } },
    );
    assert.deepStrictEqual(w03(manual), [], 'data-ax-as introduces its variable anywhere');
  } finally {
    logger.warn = originalWarn;
  }

  console.log('built-in tag and data-ax-as scope tests passed!');
} catch (error) {
  console.error('built-in tag and data-ax-as scope tests failed!');
  console.error(error);
  process.exit(1);
}

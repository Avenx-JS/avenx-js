import assert from 'assert';
import fs from 'fs';
import os from 'os';
import path from 'path';

// Set env to test so that loadConfig throws validation errors instead of process.exit
process.env.NODE_ENV = 'test';

import ComponentParser from '../../lib/compiler/ComponentParser.js';
import StyleProcessor from '../../lib/compiler/StyleProcessor.js';
import loadConfig from '../../lib/config.js';
import { logger } from '../../lib/core/runtime/AvenxLogger.js';

try {
  console.log('🧪 Testing templateGlobals declarations...');

  let warnings = [];
  const originalWarn = logger.warn;
  logger.warn = (...args) => warnings.push(args.join(' '));

  const styleProcessor = new StyleProcessor();

  /**
   * Validates a template and returns whatever the compiler warned about.
   * @param {string} template - The template to validate.
   * @param {object} config - The compiler configuration.
   * @returns {string[]} The warnings emitted.
   */
  function validate(template, config) {
    warnings = [];
    const parser = new ComponentParser(styleProcessor, [], config);
    parser.validateTemplate(template, {}, {}, {}, {}, 'Home.component.js', 'Home');
    return warnings;
  }

  try {
    // 1. Without a declaration, a plugin-provided identifier is undeclared.
    const undeclared = validate('<h1>{{ t("home.title") }}</h1>', { warnings: {} });
    assert.strictEqual(undeclared.length, 1, 'an unknown identifier is reported');
    assert.ok(undeclared[0].includes('t'), 'the warning names the identifier');

    // 2. Declaring it silences the warning for that name only.
    const declared = validate('<h1>{{ t("home.title") }}</h1>', {
      warnings: {},
      templateGlobals: ['t', 'tHtml', 'n', 'd', 'rel', 'locale', '$i18n'],
    });
    assert.deepStrictEqual(declared, [], 'a declared global is accepted');

    const stillChecked = validate('<h1>{{ t(title) }}</h1>', {
      warnings: {},
      templateGlobals: ['t'],
    });
    assert.strictEqual(stillChecked.length, 1, 'other identifiers are still checked');
    assert.ok(stillChecked[0].includes('title'), 'the undeclared one is the one reported');

    // 3. The whole i18n surface reads naturally in a template.
    const i18nTemplate = validate(
      '<div>' +
        '<h1>{{ t("home.title") }}</h1>' +
        '<p>{{ t("cart.items", { count: 3 }) }}</p>' +
        '<span>{{ n(1234.5, "currency") }} {{ d(Date.now()) }} {{ rel(-2, "day") }}</span>' +
        '<b>{{ locale.current }}</b>' +
        '<i>{{ $i18n.has("home.title") }}</i>' +
        '</div>',
      { warnings: {}, templateGlobals: ['t', 'n', 'd', 'rel', 'locale', '$i18n'] },
    );
    assert.deepStrictEqual(i18nTemplate, [], 'the full i18n template surface validates');

    // 4. The option round-trips through avenx.config.json.
    const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'avenx-template-globals-'));
    try {
      fs.writeFileSync(
        path.join(projectDir, 'avenx.config.json'),
        JSON.stringify({ templateGlobals: ['t', 'locale'] }),
      );
      const loaded = loadConfig(projectDir);
      assert.deepStrictEqual(loaded.templateGlobals, ['t', 'locale'], 'the option is read from the config file');

      fs.writeFileSync(path.join(projectDir, 'avenx.config.json'), JSON.stringify({ templateGlobals: 't' }));
      assert.throws(
        () => loadConfig(projectDir),
        /templateGlobals must be an array of non-empty identifier names/,
        'a non-array is rejected',
      );

      fs.writeFileSync(path.join(projectDir, 'avenx.config.json'), JSON.stringify({ templateGlobals: ['t', ''] }));
      assert.throws(
        () => loadConfig(projectDir),
        /templateGlobals must be an array of non-empty identifier names/,
        'an empty name is rejected',
      );
    } finally {
      fs.rmSync(projectDir, { recursive: true, force: true });
    }

    // 5. Projects that declare nothing keep the default.
    const emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'avenx-template-globals-none-'));
    try {
      assert.deepStrictEqual(loadConfig(emptyDir).templateGlobals, [], 'the default is an empty list');
    } finally {
      fs.rmSync(emptyDir, { recursive: true, force: true });
    }
  } finally {
    logger.warn = originalWarn;
  }

  console.log('  ✅ templateGlobals tests passed!');
} catch (error) {
  console.error('❌ templateGlobals tests failed!');
  console.error(error);
  process.exit(1);
}

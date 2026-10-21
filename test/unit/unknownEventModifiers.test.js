import assert from 'assert';
import ComponentParser from '../../lib/compiler/ComponentParser.js';
import StyleProcessor from '../../lib/compiler/StyleProcessor.js';

/**
 * Captures modifier diagnostics for a template.
 * @param {string} template - Authored template.
 * @param {object} [config] - Compiler warning settings.
 * @returns {string[]} Reported warnings.
 */
function warningsFor(template, config = {}) {
  const warnings = [];
  const warn = console.warn;
  console.warn = (message) => warnings.push(String(message));
  try {
    const parser = new ComponentParser(new StyleProcessor());
    parser.config = config;
    parser.extractTemplate(template, {}, 'Example', 'example.component.js', {}, {}, { bump: '' });
  } finally {
    console.warn = warn;
  }
  return warnings;
}

const typo = warningsFor('<button @click.prevnt="bump()">Go</button>');
assert.strictEqual(typo.length, 1);
assert.match(typo[0], /AVX_W61/);
assert.match(typo[0], /prevnt/);
assert.match(typo[0], /Did you mean "\.prevent"/);

const chain = warningsFor('<button @click.passive.nonsuch.capture.prevnt="bump()">Go</button>');
assert.strictEqual(chain.length, 2);
assert.match(chain[0], /nonsuch/);
assert.match(chain[1], /prevnt/);

for (const modifier of [
  'prevent',
  'stop',
  'self',
  'once',
  'passive',
  'capture',
  'ctrl',
  'alt',
  'shift',
  'meta',
  'cmd',
  'enter',
  'esc',
  'escape',
  'space',
  'tab',
  'delete',
  'up',
  'down',
  'left',
  'right',
  'backspace',
]) {
  assert.deepStrictEqual(warningsFor(`<button @keydown.${modifier}="bump()">Go</button>`), []);
}
assert.deepStrictEqual(warningsFor('<button @touchstart.passive.capture="bump()">Go</button>'), []);
assert.deepStrictEqual(warningsFor('<button @click="bump()">Go</button>'), []);
assert.deepStrictEqual(warningsFor('<button @click.prevnt="bump()">Go</button>', { warnings: { AVX_W61: 'off' } }), []);
assert.throws(
  () => warningsFor('<button @click.prevnt="bump()">Go</button>', { warnings: { AVX_W61: 'error' } }),
  /AVX_W61/,
);
console.log('Unknown event modifier diagnostics passed.');

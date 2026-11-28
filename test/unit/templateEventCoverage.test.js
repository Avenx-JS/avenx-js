/**
 * @file templateEventCoverage.test.js
 * @description The shared template walk must see every expression in a template.
 *
 * `collectTemplateEvents` is the one walk two passes share: the validator uses
 * it to report undeclared references (AVX_W03), and Atlas uses it to record
 * what each construct reads and invokes. Anything the walk does not emit is
 * therefore invisible twice over -- and Atlas's absence claims turn that
 * silence into a positive, wrong statement.
 *
 * Two gaps did exactly that:
 *
 *  - `<@if>` and `<@elseif>` headers were never collected. A typo in a
 *    condition compiled clean and failed in the browser, and state read only
 *    by a condition was reported by AVX_W40 as "read nowhere in the
 *    application" -- the false absence claim the Atlas diagnostics module's
 *    own header forbids.
 *  - Attributes were found with `/<([a-zA-Z0-9@/!-][^>]*?)>/g`, which ends a
 *    tag at the first `>` wherever it appears. In
 *    `<div title="a > b" @click="go()">` the handler fell outside the match,
 *    so AVX_W41 claimed the action it calls is never invoked.
 */

import assert from 'assert';
import { collectTemplateEvents } from '../../lib/compiler/templateEvents.js';

console.log('Testing template event coverage...');

/**
 * Collects the expressions emitted for a given event type.
 * @param {string} template - The template to walk.
 * @param {string} type - The event type to select.
 * @returns {string[]} Trimmed expressions, in source order.
 */
function exprsOfType(template, type) {
  return collectTemplateEvents(template)
    .filter((event) => event.type === type)
    .map((event) => String(event.expr).trim());
}

// --- conditions are collected --------------------------------------------
{
  const template = '<@if (count > 3)><p>a</p><@elseif (count > 1)><p>b</p><@else><p>c</p></@if>';
  assert.deepStrictEqual(
    exprsOfType(template, 'condition'),
    ['(count > 3)', '(count > 1)'],
    'both arms of a conditional carry an expression that must be walked',
  );
  const names = collectTemplateEvents(template)
    .filter((e) => e.type === 'condition')
    .map((e) => e.name);
  assert.deepStrictEqual(names, ['if', 'elseif'], 'the arm is named');
  console.log('  ✅ <@if> and <@elseif> headers are collected');
}

// --- <@else> carries no expression ---------------------------------------
{
  assert.deepStrictEqual(
    exprsOfType('<@if (a)><p>x</p><@else><p>y</p></@if>', 'condition'),
    ['(a)'],
    '<@else> has no condition and must not emit an empty one',
  );
  console.log('  ✅ <@else> emits no condition');
}

// --- a ">" inside a condition does not truncate it ------------------------
{
  assert.deepStrictEqual(
    exprsOfType('<@if (a > b && c < d)><p>x</p></@if>', 'condition'),
    ['(a > b && c < d)'],
    'the condition is read by the markup lexer, which does not end a directive ' + 'header at a ">" inside brackets',
  );
  console.log('  ✅ comparison operators inside a condition survive');
}

// --- a ">" inside an attribute value does not hide later attributes -------
{
  const template = '<div title="a > b" @click="go()" data-ax-html="body" id="row">x</div>';
  assert.deepStrictEqual(exprsOfType(template, 'event'), ['go()'], 'the handler must be found');
  assert.deepStrictEqual(exprsOfType(template, 'directive'), ['body'], 'the directive must be found');
  const ids = collectTemplateEvents(template)
    .filter((e) => e.type === 'id_attribute')
    .map((e) => e.idValue);
  assert.deepStrictEqual(ids, ['row'], 'the static id must be found');
  console.log('  ✅ an attribute after one containing ">" is still found');
}

// --- offsets point at what the developer wrote ---------------------------
{
  const template = '<div title="a > b" @click="go()">x</div>';
  const event = collectTemplateEvents(template).find((e) => e.type === 'event');
  assert.strictEqual(
    template.slice(event.index, event.index + event.length),
    '@click="go()"',
    'the reported span must be the attribute itself, so a diagnostic points at it',
  );
  console.log('  ✅ an event span points at the attribute');
}

// --- conditions still resolve inside a loop ------------------------------
{
  const template = '<@for row in rows><@if (row.active)><p>{{ row.name }}</p></@if></@for>';
  const types = collectTemplateEvents(template).map((e) => e.type);
  assert.deepStrictEqual(
    types,
    ['loop_start', 'condition', 'interpolation', 'loop_end'],
    'events are ordered by offset, so a condition inside a loop is walked while ' + 'the loop variable is in scope',
  );
  console.log('  ✅ a condition inside a loop is ordered within the loop');
}

// --- valueless and quoted attributes ------------------------------------
{
  const template = `<input disabled @input='set(\\'x\\')'>`;
  assert.deepStrictEqual(
    exprsOfType(template, 'event').length,
    1,
    'a single-quoted handler beside a valueless attribute is still found',
  );
  console.log('  ✅ valueless attributes do not disturb the scan');
}

// --- an interpolated id is not treated as a static one -------------------
{
  const ids = collectTemplateEvents('<div id="row-{{ n }}">x</div>').filter((e) => e.type === 'id_attribute');
  assert.strictEqual(ids.length, 0, 'an interpolated id is not a duplicate-id candidate');
  console.log('  ✅ an interpolated id is not collected as a static id');
}

{
  assert.deepStrictEqual(
    exprsOfType('<@defer when="state.show"><p>x</p></@defer>', 'condition'),
    ['state.show'],
    'a reactive <@defer when> expression must be walked',
  );
  assert.deepStrictEqual(
    exprsOfType('<@defer when="items"><p>x</p></@defer>', 'condition'),
    ['items'],
    'a state identifier ending in "ms" must not be mistaken for a duration trigger',
  );
  for (const trigger of [
    'idle',
    'visible',
    'hover',
    'click',
    'interaction',
    'timer(500)',
    '300ms',
    'visible; timer(500)',
  ]) {
    assert.deepStrictEqual(
      exprsOfType(`<@defer when="${trigger}"><p>x</p></@defer>`, 'condition'),
      [],
      `built-in defer trigger "${trigger}" must not emit an expression event`,
    );
  }
  console.log('  ✅ <@defer when="..."> expressions are collected while built-in triggers are skipped');
}
console.log('✅ Template event coverage tests passed!');

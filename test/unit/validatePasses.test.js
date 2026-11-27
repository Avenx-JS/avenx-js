import test from 'node:test';
import assert from 'node:assert';
import * as validateFacade from '../../lib/compiler/parser/validate.js';
import {
  frontEndLocation,
  templateOffsetToContentOffset,
  locateTemplateIdentifier,
} from '../../lib/compiler/parser/validate/locations.js';
import {
  isJavaScriptModule,
  assertDeclarationsTerminated,
  assertFrontEndComplete,
  reportUnterminatedInterpolations,
} from '../../lib/compiler/parser/validate/frontEnd.js';
import {
  assertWellFormedTemplate,
  validateReconciliationMarkers,
  validateDeferTriggers,
  validateComponentTags,
} from '../../lib/compiler/parser/validate/structure.js';
import {
  validateEventHandlerAttributes,
  validateDynamicAttributeBindings,
} from '../../lib/compiler/parser/validate/attributes.js';
import { validateTemplate } from '../../lib/compiler/parser/validate/expressions.js';
import {
  formatDollarMemberSuggestion,
  validateActionBareDollarMembers,
  validateBareDollarMembers,
} from '../../lib/compiler/parser/validate/dollarMembers.js';

test('validate.js re-exports the extracted validation passes identically', () => {
  assert.strictEqual(validateFacade.frontEndLocation, frontEndLocation);
  assert.strictEqual(validateFacade.templateOffsetToContentOffset, templateOffsetToContentOffset);
  assert.strictEqual(validateFacade.locateTemplateIdentifier, locateTemplateIdentifier);
  assert.strictEqual(validateFacade.assertDeclarationsTerminated, assertDeclarationsTerminated);
  assert.strictEqual(validateFacade.assertFrontEndComplete, assertFrontEndComplete);
  assert.strictEqual(validateFacade.reportUnterminatedInterpolations, reportUnterminatedInterpolations);
  assert.strictEqual(validateFacade.assertWellFormedTemplate, assertWellFormedTemplate);
  assert.strictEqual(validateFacade.validateReconciliationMarkers, validateReconciliationMarkers);
  assert.strictEqual(validateFacade.validateDeferTriggers, validateDeferTriggers);
  assert.strictEqual(validateFacade.validateComponentTags, validateComponentTags);
  assert.strictEqual(validateFacade.validateEventHandlerAttributes, validateEventHandlerAttributes);
  assert.strictEqual(validateFacade.validateDynamicAttributeBindings, validateDynamicAttributeBindings);
  assert.strictEqual(validateFacade.validateTemplate, validateTemplate);
  assert.strictEqual(validateFacade.formatDollarMemberSuggestion, formatDollarMemberSuggestion);
  assert.strictEqual(validateFacade.validateActionBareDollarMembers, validateActionBareDollarMembers);
  assert.strictEqual(validateFacade.validateBareDollarMembers, validateBareDollarMembers);
  assert.strictEqual(typeof validateFacade.validateAccessibility, 'function');
});

test('validate/locations.js maps template offsets and identifiers to source locations', () => {
  const content = '<state>{ x: 0 }</state>\n<div>{{ count }}</div>';
  const template = '<div>{{ count }}</div>';
  const loc = frontEndLocation(content, template, 8, 'count', 'Counter.component.js');
  assert.strictEqual(loc.filename, 'Counter.component.js');
  assert.strictEqual(loc.source, content);
  assert.strictEqual(loc.index, content.indexOf('count'));

  const idLoc = locateTemplateIdentifier(content, template, 8, 'count', 'count', 'Counter.component.js');
  assert.strictEqual(idLoc.source, content);
  assert.ok(idLoc.index >= 0);

  assert.strictEqual(templateOffsetToContentOffset(1, content, [{ start: 0, end: 28 }]), 29);
});

test('validate/frontEnd.js checks declarations, JS modules, and unterminated interpolations', () => {
  assert.strictEqual(isJavaScriptModule('export function foo() { return 1; }'), true);
  assert.strictEqual(isJavaScriptModule('<div>Hello</div>'), false);

  assert.throws(
    () => assertDeclarationsTerminated('<action>\nfunction save() {}\n', 'Bad.component.js', 'Bad'),
    /never closed/,
  );

  assert.throws(
    () =>
      assertFrontEndComplete(
        '<input data-ax-bind="count" />',
        '<input data-ax-bind="count" />',
        'Bad.component.js',
        'Bad',
      ),
    /data-ax-bind|front-end|AVX_C/i,
  );

  assert.throws(
    () =>
      reportUnterminatedInterpolations('<div>{{ broken</div>', 'Bad.component.js', 'Bad', {
        warnings: { AVX_W54: 'error' },
      }),
    /AVX_W54|unterminated/i,
  );
});

test('validate/structure.js checks well-formedness, reconciliation markers, and component tags', () => {
  assert.doesNotThrow(() =>
    assertWellFormedTemplate('<div><span>ok</span></div>', '<div><span>ok</span></div>', 'Ok.component.js', 'Ok'),
  );
  assert.throws(
    () => assertWellFormedTemplate('<div><span', '<div><span', 'Bad.component.js', 'Bad'),
    /Bad/,
  );

  assert.throws(
    () =>
      validateReconciliationMarkers(
        '<div data-ax-static>hi</div>',
        '<div data-ax-static>hi</div>',
        'Static.component.js',
        'Static',
        { config: { warnings: { AVX_W77: 'error' } } },
      ),
    /data-ax-static/,
  );

  assert.throws(
    () =>
      validateComponentTags(
        '<MissingWidget />',
        'Page.component.js',
        'Page',
        { warnings: { AVX_W46: 'error' } },
        { componentNames: new Set(['KnownCard']) },
      ),
    /MissingWidget/,
  );
});

test('validate/attributes.js checks inline event handlers and dynamic attribute bindings', () => {
  assert.throws(
    () =>
      validateEventHandlerAttributes(
        '<button onclick="doThing()">Go</button>',
        '<button onclick="doThing()">Go</button>',
        'Btn.component.js',
        'Btn',
        { config: { warnings: { AVX_W52: 'error' } } },
      ),
    /onclick/,
  );

  assert.throws(
    () =>
      validateDynamicAttributeBindings(
        '<div :[attr]="{{ val }}"></div>',
        '<div :[attr]="{{ val }}"></div>',
        'Item.component.js',
        'Item',
      ),
    /AVX_C29|dynamic attribute|interpolation/i,
  );
});

test('validate/expressions.js validates declared identifiers and reports undeclared ones', () => {
  assert.doesNotThrow(() =>
    validateTemplate('<div>{{ count }}</div>', { count: 0 }, {}, {}, null, 'Counter.component.js', 'Counter'),
  );
  assert.throws(
    () =>
      validateTemplate('<div>{{ missing }}</div>', { count: 0 }, {}, {}, null, 'Counter.component.js', 'Counter', [], {
        config: { warnings: { AVX_W03: 'error' } },
      }),
    /missing/,
  );
});

test('validate/dollarMembers.js formats suggestions and flags bare $ references', () => {
  assert.match(formatDollarMemberSuggestion('$destroy'), /\$destroy/);

  assert.throws(
    () =>
      validateActionBareDollarMembers(
        '<action name="save">$destroy();</action>',
        'Save.component.js',
        'Save',
        { warnings: { AVX_W71: 'error' } },
      ),
    /\$destroy/,
  );

  assert.throws(
    () =>
      validateBareDollarMembers(
        '<button @click="$destroy()">Go</button>',
        '<button @click="$destroy()">Go</button>',
        'Go.component.js',
        'Go',
        { warnings: { AVX_W71: 'error' } },
      ),
    /\$destroy/,
  );
});

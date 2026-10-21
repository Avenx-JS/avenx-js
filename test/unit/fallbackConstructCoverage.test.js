/**
 * Every construct that can force the fallback path must be covered somewhere.
 *
 * `RefusalReason` is the compiler's list of constructs the IR does not model.
 * Each one sends a component down the string renderer, and that path is the one
 * that rendered nothing without saying so. The three that were broken --
 * suspense, error boundaries and the deadlock boundary -- were also the three
 * the E2E suite listed as uncovered. The coverage gap and the defect were the
 * same fact.
 *
 * So the list is not allowed to grow quietly. Adding a refusal reason means
 * adding it below, with either the coverage that exercises it or an explicit
 * note saying why it has none. Either is fine; saying nothing is not.
 *
 * This test knows nothing about whether the coverage is good. It knows only
 * that a decision was recorded, which is the thing that was missing.
 */
import assert from 'assert';
import { RefusalReason } from '../../lib/compiler/ir/nodes.js';

console.log('🧪 Testing fallback construct coverage...');

/**
 * Where each refusal reason is exercised, or why it is not.
 *
 * `covered` names the tests that drive the construct through a real build.
 * `uncovered` records a reason instead -- a construct with no syntax a user can
 * write, or one whose behaviour is pinned elsewhere.
 * @type {Object<string, {covered?: string[], uncovered?: string}>}
 */
const COVERAGE = {
  SUSPENSE: {
    covered: [
      'test/e2e/specs/rendering/fallback-renderer.spec.js',
      'test/system/fallbackRendererBundle.test.js',
      'test/integration/renderer_selection.test.js',
    ],
  },
  ERROR_BOUNDARY: {
    covered: [
      'test/e2e/specs/rendering/fallback-renderer.spec.js',
      'test/system/fallbackRendererBundle.test.js',
      'test/integration/renderer_selection.test.js',
    ],
  },
  DEADLOCK: {
    covered: [
      'test/e2e/specs/rendering/fallback-renderer.spec.js',
      'test/system/fallbackRendererBundle.test.js',
      'test/integration/renderer_selection.test.js',
    ],
  },
  DEFER: {
    uncovered:
      '<@defer> is a compiled block and no longer refuses; the reason is kept for the shapes the block builder still declines. test/e2e/apps/defer covers the compiled path.',
  },
  TRANSITION: { uncovered: 'Covered on the string path by test/integration/transition.test.js; no browser coverage yet.' },
  RESOURCE: { uncovered: 'A <resource> in template position. test/unit/suspense.test.js covers declarations.' },
  DYNAMIC_COMPONENT: { uncovered: 'Covered by test/unit/dynamicComponent.test.js on the string path; no browser coverage yet.' },
  DYNAMIC_ATTR: { uncovered: 'No browser coverage yet.' },
  ROUTER_VIEW: { uncovered: 'Exercised indirectly by every routing fixture, which mounts pages through the router.' },
  VALIDATION: { uncovered: 'Declarative form validation; covered on the string path by test/unit tests only.' },
  REF: { uncovered: 'Template refs; no browser coverage yet.' },
  TEMPLATE: { covered: ['test/system/scopedSlotBuild.test.js'] },
  SCOPED_SLOT: { covered: ['test/system/scopedSlotBuild.test.js'] },
  VIRTUAL_LIST: { uncovered: 'Covered by test/unit/virtualList.test.js; the tag also pulls in its own built-in module.' },
  MALFORMED: { uncovered: 'Not a construct a user writes deliberately; AVX_C22 covers the reachable case.' },
  UNKNOWN_DIRECTIVE: { uncovered: 'Not a construct a user writes deliberately.' },
};

const declared = Object.keys(RefusalReason);
const recorded = Object.keys(COVERAGE);

const undeclared = recorded.filter((name) => !declared.includes(name));
assert.deepStrictEqual(
  undeclared,
  [],
  `COVERAGE names refusal reasons that no longer exist: ${undeclared.join(', ')}. Remove them.`,
);

const unrecorded = declared.filter((name) => !recorded.includes(name));
assert.deepStrictEqual(
  unrecorded,
  [],
  `RefusalReason gained ${unrecorded.join(', ')} with no entry in COVERAGE. ` +
    'Every construct that forces the fallback path needs either coverage that drives it through a real build, ' +
    'or a recorded reason it has none. The fallback path is the one that failed silently; a new construct ' +
    'joining it unnoticed is how that happens again.',
);
console.log(`  ✅ all ${declared.length} refusal reasons are accounted for`);

for (const [name, entry] of Object.entries(COVERAGE)) {
  const hasCovered = Array.isArray(entry.covered) && entry.covered.length > 0;
  const hasReason = typeof entry.uncovered === 'string' && entry.uncovered.length > 0;
  assert.ok(
    hasCovered !== hasReason,
    `${name} must declare exactly one of "covered" or "uncovered"`,
  );
}
console.log('  ✅ each one declares either its coverage or why it has none');

// The three that broke are the three that must stay covered in a browser.
for (const name of ['SUSPENSE', 'ERROR_BOUNDARY', 'DEADLOCK']) {
  assert.ok(
    (COVERAGE[name].covered || []).some((file) => file.includes('e2e')),
    `${name} must keep browser coverage: it rendered nothing in a real build once, and only a browser test saw it`,
  );
}
console.log('  ✅ the three constructs that broke keep their browser coverage');

console.log('✅ All fallback construct coverage tests passed!');

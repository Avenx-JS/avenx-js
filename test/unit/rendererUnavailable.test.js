/**
 * What a component says when the rendering engine it needs is not in the bundle.
 *
 * This condition should be unreachable: the compiler links the string renderer
 * when any template falls back, and AVX_C23 fails the build if the artifact
 * does not contain it. It was reachable once -- the same runtime file bundled
 * twice split the registry -- and the diagnostic it produced then was
 * AVX_R08, "Failed to render interpolation expression", which sent developers
 * to inspect an expression that was not the problem.
 *
 * The message is the last line of defence for a defect that should not recur,
 * so it is worth holding to: it names the component, it names the capability,
 * and it carries a code `avenx explain` can describe.
 *
 * #1617 split one case out of it: when the component fell back because this
 * environment could not prepare its compiled skeleton -- no usable DOM, or a
 * parser that reshaped the tree past the compiler's markers -- the bundle is
 * not mislinked and AVX_R34's text is simply wrong about the cause. That
 * case is AVX_R37, and both branches are pinned below.
 */
import assert from 'assert';
import { requireStringRenderer, hasStringRenderer, installStringRenderer } from '../../lib/core/renderer/stringRenderer.js';
import { AvenxErrorCodes } from '../../lib/core/runtime/AvenxError.js';
import { getDiagnostic } from '../../lib/core/diagnostics/catalogue.js';
import { CompiledTemplate, getCompiledTemplate } from '../../lib/core/renderer/program/CompiledTemplate.js';
import { TemplateInstance } from '../../lib/core/renderer/program/TemplateInstance.js';
import { PROGRAM_VERSION } from '../../lib/compiler/render/program.js';
import { buildTemplateIR } from '../../lib/compiler/ir/build.js';
import { lowerToProgram } from '../../lib/compiler/ir/lower.js';
import { AvenxComponent } from '../../lib/core/index.js';
import { nextTick } from '../../lib/core/reactive/scheduler.js';

console.log('🧪 Testing renderer availability diagnostics...');

// The test runner installs the string renderer into every test process, the
// way a development build does. Taking it away is the only way to observe the
// condition, so it is restored immediately afterwards.
const saved = hasStringRenderer() ? requireStringRenderer() : null;

try {
  installStringRenderer(null);

  assert.strictEqual(hasStringRenderer(), false, 'the registry should read as empty once cleared');

  assert.throws(
    () => requireStringRenderer('CartSummary'),
    (error) => {
      assert.strictEqual(
        error.code,
        AvenxErrorCodes.RENDERER_UNAVAILABLE,
        'the condition should have its own code, not the generic template-render error',
      );
      assert.notStrictEqual(
        error.code,
        AvenxErrorCodes.TEMPLATE_RENDER_ERROR,
        'reusing AVX_R08 made this read as a failed interpolation',
      );
      assert.ok(String(error.message).includes('CartSummary'), 'the message should name the component');
      assert.ok(String(error.message).includes('the string renderer'), 'the message should name the capability');
      assert.ok(String(error.message).includes('AVX_W47'), 'the message should point at the build warning that links it');
      return true;
    },
  );
  console.log('  ✅ an unavailable renderer raises AVX_R34 naming the component');

  // A code a developer can be shown has to be a code the CLI can describe.
  const entry = getDiagnostic(AvenxErrorCodes.RENDERER_UNAVAILABLE);
  assert.ok(entry, 'AVX_R34 should be in the diagnostic catalogue');
  assert.ok(entry.summary && entry.summary.length > 0, 'it should have a summary');
  assert.ok(Array.isArray(entry.causes) && entry.causes.length > 0, 'it should list causes');
  assert.ok(Array.isArray(entry.remedies) && entry.remedies.length > 0, 'it should list remedies');
  console.log('  ✅ AVX_R34 is explainable through the diagnostic catalogue');

  // ...and so does the one the runtime raises when nothing claims an error.
  const aborted = getDiagnostic(AvenxErrorCodes.COMPONENT_RENDER_ABORTED);
  assert.ok(aborted, 'AVX_R33 should be in the diagnostic catalogue');
  assert.ok(Array.isArray(aborted.remedies) && aborted.remedies.length > 0, 'AVX_R33 should list remedies');
  console.log('  ✅ AVX_R33 is explainable through the diagnostic catalogue');

  const missing = getDiagnostic(AvenxErrorCodes.COMPILER_MISSING_RUNTIME_CAPABILITY);
  assert.ok(missing, 'AVX_C23 should be in the diagnostic catalogue');
  console.log('  ✅ AVX_C23 is explainable through the diagnostic catalogue');

  // #1617: a skeleton that could not be prepared because there is no DOM at
  // all records why, and the registry turns that reason into AVX_R37 -- the
  // environment -- rather than AVX_R34's mislinked bundle.
  const savedDocument = globalThis.document;
  let noDomTemplate;
  try {
    delete globalThis.document;
    noDomTemplate = new CompiledTemplate({
      v: PROGRAM_VERSION,
      html: '<p><!--axt:0--></p>',
      ops: [],
      elements: 0,
      texts: 1,
    });
  } finally {
    globalThis.document = savedDocument;
  }
  assert.strictEqual(noDomTemplate.failed, true, 'a skeleton with no DOM to parse it should fail preparation');
  assert.strictEqual(noDomTemplate.failureReason, 'no-dom', 'the failure should be recorded as a missing DOM');

  assert.throws(
    () => requireStringRenderer('Tile', noDomTemplate.failureReason),
    (error) => {
      assert.strictEqual(
        error.code,
        AvenxErrorCodes.COMPILED_TEMPLATE_ENVIRONMENT_UNSUPPORTED,
        'an environment-forced fallback should have its own code, not AVX_R34',
      );
      assert.ok(String(error.message).includes('environment'), 'the message should name the environment as the cause');
      assert.ok(String(error.message).includes('happy-dom'), 'the message should say how to give a test runner a DOM');
      assert.ok(
        !String(error.message).includes('Rebuild from a clean dist'),
        'the message must not instruct a rebuild -- the bundle is not the problem',
      );
      assert.ok(
        !String(error.message).includes('compiler defect'),
        'the message must not invite a compiler-defect report',
      );
      return true;
    },
  );
  console.log('  \u2713 a fallback forced by a missing DOM raises AVX_R37 naming the environment');

  // The other preparation failure: a DOM parsed the skeleton but reshaped it
  // past the compiler's markers. Same code, different named cause.
  const mismatched = new CompiledTemplate({
    v: PROGRAM_VERSION,
    // Claims two element markers; the skeleton contains one.
    html: '<div data-axb="0"></div>',
    ops: [],
    elements: 2,
    texts: 0,
  });
  assert.strictEqual(mismatched.failed, true, 'a skeleton whose markers were not preserved should fail preparation');
  assert.strictEqual(mismatched.failureReason, 'marker-mismatch', 'the failure should be recorded as a marker mismatch');
  assert.throws(
    () => requireStringRenderer('Tile', mismatched.failureReason),
    (error) => {
      assert.strictEqual(error.code, AvenxErrorCodes.COMPILED_TEMPLATE_ENVIRONMENT_UNSUPPORTED);
      assert.ok(String(error.message).includes('reshaped'), 'the message should name the reshaped skeleton as the cause');
      return true;
    },
  );
  console.log('  \u2713 a fallback forced by a reshaped skeleton raises AVX_R37 naming the parser');

  // The new code has to be explainable too -- all five steps, per CONTRIBUTING.
  const environmentEntry = getDiagnostic(AvenxErrorCodes.COMPILED_TEMPLATE_ENVIRONMENT_UNSUPPORTED);
  assert.ok(environmentEntry, 'AVX_R37 should be in the diagnostic catalogue');
  assert.ok(environmentEntry.summary && environmentEntry.summary.length > 0, 'AVX_R37 should have a summary');
  assert.ok(Array.isArray(environmentEntry.causes) && environmentEntry.causes.length > 0, 'AVX_R37 should list causes');
  assert.ok(Array.isArray(environmentEntry.remedies) && environmentEntry.remedies.length > 0, 'AVX_R37 should list remedies');
  console.log('  \u2713 AVX_R37 is explainable through the diagnostic catalogue');

  // End to end through AvenxComponent: a compiled component whose skeleton
  // could not be prepared in this environment reports AVX_R37, while a
  // component with no program at all -- the genuine #1550 shape -- still
  // reports AVX_R34.
  const tileBuilt = buildTemplateIR('<div><h1>Tile</h1></div>', {});
  assert.strictEqual(tileBuilt.refusal, null, 'the fixture template should compile');
  const tileLowered = lowerToProgram(tileBuilt.ir, {});
  assert.ok(tileLowered.program, 'the fixture template should lower to a program');

  // Prepare the class's template with no DOM -- the state a component is in
  // when it runs under a test runner's default node environment. The DOM is
  // restored immediately; the prepared (failed) template is cached per
  // program, which is what the component will read.
  let prepared;
  try {
    delete globalThis.document;
    prepared = getCompiledTemplate(tileLowered.program);
  } finally {
    globalThis.document = savedDocument;
  }
  assert.strictEqual(prepared.failed, true, 'the fixture template should fail preparation without a DOM');

  const tileInstance = new TemplateInstance(tileLowered.program, {
    program: tileLowered.program,
    evaluate: () => undefined,
    jobId: 1,
  });
  assert.strictEqual(tileInstance.usable, false, 'the instance should read as unusable');
  assert.strictEqual(tileInstance.failureReason, 'no-dom', 'the instance should carry the failure reason');

  const captured = [];
  class Tile extends AvenxComponent {
    constructor() {
      super({}, {}, {}, '<div><h1>Tile</h1></div>', {
        onErrorCaptured(error) {
          captured.push(error);
          return false;
        },
      }, {}, {}, {}, { program: tileLowered.program });
    }
  }
  const tileHost = document.createElement('div');
  document.body.appendChild(tileHost);
  new Tile().mount(tileHost);
  await nextTick();

  assert.ok(captured.length > 0, 'the compiled component should report its render failure');
  assert.strictEqual(
    captured[0].code,
    AvenxErrorCodes.COMPILED_TEMPLATE_ENVIRONMENT_UNSUPPORTED,
    'a compiled component in an environment with no DOM should report AVX_R37',
  );
  console.log('  \u2713 a compiled component with no usable DOM reports AVX_R37 end to end');

  const capturedPlain = [];
  class Plain extends AvenxComponent {
    constructor() {
      super({}, {}, {}, '<div><h1>Plain</h1></div>', {
        onErrorCaptured(error) {
          capturedPlain.push(error);
          return false;
        },
      }, {}, {}, {}, {});
    }
  }
  const plainHost = document.createElement('div');
  document.body.appendChild(plainHost);
  new Plain().mount(plainHost);
  await nextTick();

  assert.ok(capturedPlain.length > 0, 'the uncompiled component should report its render failure');
  assert.strictEqual(
    capturedPlain[0].code,
    AvenxErrorCodes.RENDERER_UNAVAILABLE,
    'a component with no program still reports AVX_R34 -- the #1550 case',
  );
  console.log('  \u2713 a component with no program still reports AVX_R34');

  // Restoring it makes the condition go away again.
  if (saved) {
    installStringRenderer(saved);
    assert.ok(hasStringRenderer(), 'the registry should read as filled once restored');
    assert.strictEqual(requireStringRenderer('CartSummary'), saved);
    console.log('  ✅ a filled registry returns the renderer');
  }

  console.log('✅ All renderer availability tests passed!');
} finally {
  installStringRenderer(saved);
}

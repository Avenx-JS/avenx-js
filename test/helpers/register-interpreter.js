/**
 * @file register-interpreter.js
 * @description Installs the development-only runtime pieces for the test process.
 *
 * A test builds components directly rather than through `avenx build`, so
 * nothing compiled their expressions the way a build would. Installing the
 * interpreter is exactly what a development build does — the compiler adds the
 * same module to a development entry — and it is why a test can keep writing a
 * template inline and have it render.
 *
 * Injected by the runner into every test file rather than imported by each one,
 * because "tests run in a development-like environment" is a property of the
 * suite, not of any individual file.
 *
 * A production bundle installs nothing here, so the parser, the tree-walking
 * evaluator and the source-text sandbox are unreachable and the bundler drops
 * them. `test/system/productionBuild.test.js` asserts that, and it does so on a
 * bundle rather than in this process, so this import cannot mask it.
 *
 * The string renderer is installed on exactly the same terms. A build decides
 * whether to include it from whether any component fell back; a test process
 * builds components one at a time and has no such answer, so it installs it
 * unconditionally, the way a development build that had one fallback would.
 * `test/system/productionBuild.test.js` asserts its absence from a bundle where
 * every template compiled, again from outside this process.
 */
import '../../lib/core/expression/interpreter.js';
import '../../lib/core/renderer/installStringRenderer.js';

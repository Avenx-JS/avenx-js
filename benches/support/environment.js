/**
 * @file environment.js
 * @description What every benchmark process needs before it measures anything.
 *
 * A benchmark builds components directly rather than through `avenx build`, so
 * nothing compiled their expressions. Without the interpreter installed, every
 * binding throws, the renderer reports AVX_R08 and does no work, and the
 * benchmark records the resulting near-zero as an improvement — which is the
 * most dangerous kind of benchmark failure, because it looks like success.
 *
 * Installed the same way the test suite installs it, and for the same reason:
 * a benchmark runs in a development-like environment. It says nothing about
 * what a production bundle contains, which is asserted on a real bundle in
 * test/system/productionBuild.test.js.
 * @module benches/support/environment
 */
import '../../lib/core/expression/interpreter.js';

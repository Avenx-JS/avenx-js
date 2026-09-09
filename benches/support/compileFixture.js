/**
 * @file compileFixture.js
 * @description Compiles benchmark component source with the real compiler.
 *
 * The benchmarks measure Avenx, not an approximation of it, so a scenario is
 * written in Avenx's authoring format, written to a scratch file, and put
 * through `loadComponent` -- the same `ComponentParser` a build runs. If the
 * compiler stops emitting something the runtime needs, the benchmark fails to
 * build rather than quietly measuring a hand-written stand-in.
 * @module benches/support/compileFixture
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import { loadComponent } from '../../lib/core/tooling/loadComponent.js';

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'avenx-bench-'));
let seq = 0;

/**
 * Compiles component source and returns the class the compiler emitted.
 * @param {string} source - Component source in Avenx authoring format.
 * @param {string} [name] - Base name, which becomes the class name.
 * @returns {Function} The compiled component class.
 */
export function compileComponent(source, name = `Bench${seq++}`) {
  const dir = path.join(scratch, name);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${name}.component.js`);
  fs.writeFileSync(file, source);
  return loadComponent(file, { config: { logging: { silent: true } } });
}

/**
 * Removes the scratch directory. Safe to call more than once.
 */
export function cleanup() {
  fs.rmSync(scratch, { recursive: true, force: true });
}

/**
 * @file sourceMapTrace.js
 * @description Builds the source-location sidecar that `avenx trace view` uses.
 *
 * A trace records the *source text* of every action and computed it ran, which
 * is already more than a compiled framework can offer. What it cannot know at
 * runtime is where that text came from — the bundle is one concatenated script
 * with no file boundaries left in it.
 *
 * The compiler does know, so it writes the answer beside the bundle rather
 * than inside it. `bundle.trace.json` is emitted next to `bundle.js` and is not
 * referenced by it: an application that never records a trace downloads
 * nothing extra, and a deployment that does not want the file simply does not
 * upload it.
 * @module lib/compiler/sourceMapTrace
 */

import path from 'path';
import { TRACE_VERSION } from '../core/trace/schema.js';

/**
 * The file name the sidecar is written under, given a bundle name.
 * @param {string} outputName - The configured bundle name, e.g. `bundle`.
 * @returns {string} The sidecar file name.
 */
export function sidecarFileName(outputName) {
  return `${outputName}.trace.json`;
}

/**
 * Finds the 1-based line a pattern first occurs on.
 * @param {string} source - The file contents.
 * @param {RegExp} pattern - What to look for.
 * @returns {number|null} The line number, or null when absent.
 */
function lineOf(source, pattern) {
  const match = pattern.exec(source);
  if (!match) {
    return null;
  }
  return source.slice(0, match.index).split('\n').length;
}

/**
 * Escapes a name for use inside a regular expression.
 * @param {string} name - The declared name.
 * @returns {string} The escaped name.
 */
function escape(name) {
  return String(name).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Collects the source locations of one component's declarations.
 * @param {object} unit - What the parser extracted.
 * @param {string} unit.name - The component class name.
 * @param {string} unit.filePath - Absolute path to the source file.
 * @param {string} unit.rootDir - The project root, for relative paths.
 * @param {string} unit.content - The file contents.
 * @param {object} [unit.computed] - Computed definitions by name.
 * @param {object} [unit.methods] - Action bodies by name.
 * @param {object} [unit.resources] - Resource definitions by name.
 * @param {Set<string>} [unit.contracts] - Declared contracts.
 * @returns {object} The component's sidecar entry.
 */
export function collectLocations(unit) {
  const relative = path.relative(unit.rootDir, unit.filePath).split(path.sep).join('/');
  const entry = { file: relative, actions: {}, computed: {}, resources: {} };

  if (unit.contracts && unit.contracts.size > 0) {
    entry.contracts = Array.from(unit.contracts);
  }

  for (const name of Object.keys(unit.methods || {})) {
    const line = lineOf(unit.content, new RegExp(`<action\\s+[^>]*name\\s*=\\s*["']${escape(name)}["']`));
    if (line !== null) {
      entry.actions[name] = { line };
    }
  }

  for (const name of Object.keys(unit.computed || {})) {
    const line = lineOf(unit.content, new RegExp(`<computed\\s+[^>]*name\\s*=\\s*["']${escape(name)}["']`));
    if (line !== null) {
      entry.computed[name] = { line, expression: unit.computed[name] };
    }
  }

  for (const name of Object.keys(unit.resources || {})) {
    const line = lineOf(unit.content, new RegExp(`<resource\\s+[^>]*name\\s*=\\s*["']${escape(name)}["']`));
    if (line !== null) {
      entry.resources[name] = { line };
    }
  }

  return entry;
}

/**
 * Assembles the sidecar document.
 * @param {Map<string, object>} components - Entries keyed by class name.
 * @param {Map<string, object>} [bridges] - Bridge descriptors. The compiler keys
 *   these by absolute path, so the descriptor's own `name` is used for the
 *   sidecar rather than the map key — a trace records bridge names, not paths.
 * @param {string} [rootDir] - The project root, for relative bridge paths.
 * @returns {object} The sidecar, ready to serialize.
 */
export function buildSidecar(components, bridges = new Map(), rootDir = process.cwd()) {
  const sidecar = {
    traceVersion: TRACE_VERSION,
    generatedAt: new Date().toISOString(),
    components: {},
    bridges: {},
  };

  for (const [name, entry] of components) {
    sidecar.components[name] = entry;
  }

  for (const [key, descriptor] of bridges) {
    if (!descriptor || !descriptor.filePath) {
      continue;
    }
    const name = descriptor.name || key;
    sidecar.bridges[name] = {
      file: path.relative(rootDir, descriptor.filePath).split(path.sep).join('/'),
      actions: descriptor.actions || [],
      getters: descriptor.getters || [],
      state: descriptor.stateKeys || [],
    };
  }

  return sidecar;
}

/**
 * Annotates a trace's nodes with the source locations the sidecar holds.
 *
 * Applied when a trace is read, not when it is recorded: a trace stays a
 * record of what happened, and the mapping from that to a file and a line is a
 * property of the build it came from.
 * @param {object} trace - The trace to annotate. Mutated in place.
 * @param {object|null} sidecar - The sidecar, or null to leave the trace alone.
 * @returns {object} The same trace.
 */
export function annotateTrace(trace, sidecar) {
  if (!sidecar || !trace || !Array.isArray(trace.nodes)) {
    return trace;
  }

  for (const node of trace.nodes) {
    const owner = node.component || node.bridge;
    if (!owner) {
      continue;
    }

    const component = sidecar.components && sidecar.components[owner];
    if (component) {
      if (node.type === 'action' && component.actions[node.name]) {
        node.loc = { file: component.file, line: component.actions[node.name].line };
      } else if (node.type === 'computed' && component.computed[node.name]) {
        node.loc = { file: component.file, line: component.computed[node.name].line };
      } else if (node.type === 'resource' && component.resources[node.name]) {
        node.loc = { file: component.file, line: component.resources[node.name].line };
      } else if (!node.loc) {
        node.loc = { file: component.file };
      }
      continue;
    }

    const bridge = sidecar.bridges && sidecar.bridges[owner];
    if (bridge) {
      node.loc = { file: bridge.file };
    }
  }

  return trace;
}

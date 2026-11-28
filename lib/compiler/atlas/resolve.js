/**
 * @file resolve.js
 * @description Turns Avenx expression source text into resolved semantic
 * references.
 *
 * This is the part of Atlas that cannot be had for free. The compiler keeps
 * template expressions, computed expressions and action bodies as **source
 * text** all the way to evaluation, which is exactly what makes Atlas possible
 * — and it means Atlas has to read that text itself.
 *
 * Two passes, deliberately:
 *
 * 1. {@link collectLocals} finds every name the body binds itself — `const`,
 *    `let`, `var`, function and arrow parameters, `catch` bindings,
 *    destructuring patterns. It runs first so that a reference appearing
 *    ahead of the declaration that shadows it is still recognised as local.
 * 2. {@link scanReferences} walks the text and records every member chain,
 *    what was done to it (read, write, invoke) and where it sat in the source.
 *
 * {@link resolveReference} then maps a chain onto a declaration in scope.
 *
 * ## What this is not
 *
 * It is not a JavaScript parser, and an action body is arbitrary JavaScript.
 * The scanner is string- and comment-aware and understands member access,
 * optional chaining, computed members, calls, assignment and destructuring —
 * which covers the shapes Avenx components actually contain. Everything it
 * cannot follow is reported as an `UnresolvedReason`, never dropped and
 * never guessed. The house rule for this file is that a missing edge must be
 * visible somewhere; an uncertain answer beats a confidently wrong one.
 * @module lib/compiler/atlas/resolve
 */

import { skipLiteral } from './resolve/lex.js';
import { collectLocals, patternBindings } from './resolve/locals.js';
import { MUTATING_METHODS, scanReferences } from './resolve/scan.js';
import {
  AMBIENT_ROOTS,
  BRIDGE_BUILTINS,
  COLLECTION_METHODS,
  ELEMENT_METHODS,
  formatPath,
  resolveBridgeMember,
  resolveReference,
} from './resolve/references.js';

export {
  AMBIENT_ROOTS,
  BRIDGE_BUILTINS,
  COLLECTION_METHODS,
  ELEMENT_METHODS,
  MUTATING_METHODS,
  collectLocals,
  formatPath,
  patternBindings,
  resolveBridgeMember,
  resolveReference,
  scanReferences,
  skipLiteral,
};

export default { scanReferences, collectLocals, resolveReference, formatPath };

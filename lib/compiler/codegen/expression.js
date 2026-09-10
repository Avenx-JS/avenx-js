/**
 * @file expression.js
 * @description Turns a parsed template expression into JavaScript source.
 *
 * ## What moved, and why
 *
 * Avenx used to ship every template expression, computed value and handler to
 * the browser as **source text**, and evaluate it by walking an AST there. That
 * put a parser, an interpreter and a scope walker in every production bundle,
 * and made the cost of reading `count` a recursive dispatch rather than a
 * property access.
 *
 * The parse is a pure function of the source, and the compiler already has the
 * source. So the parse happens here, once, at build time, and what reaches the
 * browser is a closure the engine itself compiled:
 *
 * ```text
 * count * 2        →   ($s) => axGet($s, "count") * 2
 * item.qty         →   ($s) => axRead(axGet($s, "item"), "qty", false)
 * items.filter(i => !i.done)
 *                  →   ($s) => axCall(axRead(axGet($s,"items"), "filter", false),
 *                                     axGet($s,"items"), [(i) => !axRead(i,"done",false)],
 *                                     "items.filter")
 * ```
 *
 * ## The security boundary is unchanged
 *
 * Every gate the interpreter applied is still applied, in the same place and on
 * the same terms — it is simply called rather than interpreted. A member read
 * emits {@link module:lib/core/expression/ops.readMember} with the key already
 * resolved, so `x['const'+'ructor']` and `x.constructor` still arrive at one
 * check as one string. A call emits `callFunction`. A free identifier emits
 * `readIdentifier`, which resolves scope-first and routes an allowed global
 * through the tracer's substitution point.
 *
 * Two checks get *stronger* by moving: naming a restricted global and writing a
 * forbidden static key are now build errors with a source location, rather than
 * runtime refusals a developer only sees when the branch executes.
 *
 * ## No `eval`, by construction
 *
 * The emitted text is written into the component module the bundler links, so
 * the engine compiles it exactly as it compiles the rest of the bundle. Nothing
 * here or downstream calls `eval` or `new Function`, which is what makes "an
 * Avenx page needs no 'unsafe-eval'" a property of the pipeline rather than a
 * claim about it.
 *
 * ## Arrow parameters stop being a runtime concept
 *
 * The interpreter carried a `Frame` chain so a lambda parameter would not
 * resolve against component state. A compiled arrow's parameters are real
 * JavaScript parameters, so the engine's own scoping does that work: this
 * module only has to know which names are lexically bound so it emits the bare
 * name instead of a scope read.
 * @module lib/compiler/codegen/expression
 */

import { parseExpression, parseExpressionProgram, ExpressionParseError } from '../../core/expression/parser.js';
import { ALLOWED_GLOBALS, RESTRICTED_GLOBALS, FORBIDDEN_KEYS } from '../../core/expression/ops.js';

/**
 * The local names the emitted code uses for the runtime primitives.
 *
 * Short, prefixed, and declared in one place so the module emitter and the
 * generator cannot drift. `$s` is the scope; everything else is imported from
 * the runtime.
 * @type {Object<string, string>}
 */
export const RUNTIME_BINDINGS = {
  scope: '$s',
  read: 'axRead',
  write: 'axWrite',
  call: 'axCall',
  construct: 'axNew',
  get: 'axGet',
  set: 'axSet',
  typeofName: 'axTypeof',
  key: 'axKey',
  hasIn: 'axIn',
};

/**
 * The named runtime imports a module containing compiled expressions needs.
 * @type {string[]}
 */
export const RUNTIME_IMPORT_NAMES = [
  RUNTIME_BINDINGS.read,
  RUNTIME_BINDINGS.write,
  RUNTIME_BINDINGS.call,
  RUNTIME_BINDINGS.construct,
  RUNTIME_BINDINGS.get,
  RUNTIME_BINDINGS.set,
  RUNTIME_BINDINGS.typeofName,
  RUNTIME_BINDINGS.key,
  RUNTIME_BINDINGS.hasIn,
];

/**
 * Raised when an expression cannot be compiled.
 */
export class ExpressionCodegenError extends Error {
  /**
   * @param {string} message - What could not be compiled.
   * @param {string} source - The expression source.
   */
  constructor(message, source) {
    super(message);
    this.name = 'ExpressionCodegenError';
    /** @type {string} */
    this.source = source;
  }
}

/**
 * Binary operators that map straight onto JavaScript's own.
 *
 * `in` is absent deliberately: the interpreter coerced the right-hand side with
 * `Object(right)`, and emitting a bare `in` would throw where the interpreter
 * returned false.
 * @type {Set<string>}
 */
const DIRECT_BINARY = new Set([
  '+', '-', '*', '/', '%', '**',
  '==', '!=', '===', '!==',
  '<', '>', '<=', '>=',
  '&', '|', '^', '<<', '>>', '>>>',
  'instanceof',
]);

/**
 * Unary operators that map straight onto JavaScript's own.
 * @type {Set<string>}
 */
const DIRECT_UNARY = new Set(['!', '-', '+', '~', 'void']);

/**
 * A lexical scope of names bound by enclosing arrow parameters.
 */
class Bound {
  /**
   * @param {Bound|null} parent - The enclosing binding set.
   * @param {string[]} names - Names this level binds.
   */
  constructor(parent, names) {
    this.parent = parent;
    this.names = new Set(names);
  }

  /**
   * @param {string} name - The name to test.
   * @returns {boolean} Whether any enclosing level binds it.
   */
  has(name) {
    let level = this;
    while (level) {
      if (level.names.has(name)) return true;
      level = level.parent;
    }
    return false;
  }
}

/**
 * Quotes a string as a JavaScript literal.
 * @param {any} value - The value to quote.
 * @returns {string} The literal source.
 */
function quote(value) {
  return JSON.stringify(String(value));
}

/**
 * Emits a literal value.
 * @param {any} value - The literal's value.
 * @returns {string} The literal source.
 */
function emitLiteral(value) {
  if (value === undefined) return 'undefined';
  if (value === null) return 'null';
  if (typeof value === 'number') {
    // `Infinity` and `NaN` have no literal form that survives JSON.
    if (Number.isNaN(value)) return 'NaN';
    if (value === Infinity) return 'Infinity';
    if (value === -Infinity) return '-Infinity';
    return String(value);
  }
  if (typeof value === 'boolean') return String(value);
  return JSON.stringify(value);
}

/**
 * Describes a node for a runtime error message, matching the interpreter.
 * @param {object} node - The node.
 * @returns {string} A short human-readable description.
 */
function describe(node) {
  switch (node.type) {
    case 'Identifier': return node.name;
    case 'Literal': return JSON.stringify(node.value);
    case 'Member':
      return node.computed
        ? `${describe(node.object)}[…]`
        : `${describe(node.object)}.${node.property.value}`;
    case 'Call': return `${describe(node.callee)}(…)`;
    default: return 'expression';
  }
}

/**
 * Generates JavaScript for one AST node.
 * @param {object} node - The AST node.
 * @param {Bound|null} bound - Names bound by enclosing arrow parameters.
 * @param {string} source - The original expression, for error messages.
 * @returns {string} JavaScript source for the node's value.
 */
function emit(node, bound, source) {
  const B = RUNTIME_BINDINGS;

  switch (node.type) {
    case 'Literal':
      return emitLiteral(node.value);

    case 'Identifier': {
      if (bound && bound.has(node.name)) {
        return node.name;
      }
      // A restricted global can never resolve, so refusing here turns a runtime
      // sandbox violation into a build error that names the file and the line.
      if (RESTRICTED_GLOBALS.has(node.name)) {
        throw new ExpressionCodegenError(
          `"${node.name}" is a restricted global and cannot be used in a template expression. ` +
            'Move the browser API into a component action and call that instead.',
          source,
        );
      }
      return `${B.get}(${B.scope}, ${quote(node.name)})`;
    }

    case 'TemplateLiteral': {
      let out = '""';
      for (let i = 0; i < node.quasis.length; i++) {
        if (node.quasis[i] !== '') {
          out += ` + ${JSON.stringify(node.quasis[i])}`;
        }
        if (i < node.expressions.length) {
          out += ` + String(${emit(node.expressions[i], bound, source)})`;
        }
      }
      return `(${out})`;
    }

    case 'ArrayLiteral': {
      const items = node.elements.map((element) =>
        element.type === 'Spread'
          ? `...${emit(element.argument, bound, source)}`
          : emit(element, bound, source),
      );
      return `[${items.join(', ')}]`;
    }

    case 'ObjectLiteral': {
      const parts = [];
      for (const property of node.properties) {
        if (property.kind === 'spread') {
          parts.push(`...${emit(property.value, bound, source)}`);
          continue;
        }
        const value = emit(property.value, bound, source);
        if (property.key.computed) {
          // A computed key never sets the prototype, but the interpreter
          // refused a forbidden one outright and that behaviour is preserved.
          parts.push(`[${B.key}(${emit(property.key.node, bound, source)})]: ${value}`);
          continue;
        }
        const name = String(property.key.node.value);
        if (FORBIDDEN_KEYS.has(name)) {
          throw new ExpressionCodegenError(
            `Defining property "${name}" is blocked for security reasons.`,
            source,
          );
        }
        parts.push(`${quote(name)}: ${value}`);
      }
      return `({${parts.join(', ')}})`;
    }

    case 'Member': {
      const object = emit(node.object, bound, source);
      const key = node.computed
        ? emit(node.property, bound, source)
        : quote(node.property.value);
      if (!node.computed && FORBIDDEN_KEYS.has(String(node.property.value))) {
        throw new ExpressionCodegenError(
          `Access to property "${node.property.value}" is blocked for security reasons.`,
          source,
        );
      }
      return `${B.read}(${object}, ${key}, ${node.optional ? 'true' : 'false'})`;
    }

    case 'Call':
      return emitCall(node, bound, source);

    case 'New': {
      const args = emitArguments(node.args, bound, source);
      return `${B.construct}(${emit(node.callee, bound, source)}, ${args}, ${quote(describe(node.callee))})`;
    }

    case 'Unary': {
      if (node.operator === 'typeof' && node.argument.type === 'Identifier' && !(bound && bound.has(node.argument.name))) {
        return `${B.typeofName}(${B.scope}, ${quote(node.argument.name)})`;
      }
      const argument = emit(node.argument, bound, source);
      if (node.operator === 'typeof') {
        return `(typeof ${argument})`;
      }
      if (DIRECT_UNARY.has(node.operator)) {
        return `(${node.operator === 'void' ? 'void ' : node.operator}${argument})`;
      }
      throw new ExpressionCodegenError(`Unsupported operator "${node.operator}"`, source);
    }

    case 'Binary': {
      const left = emit(node.left, bound, source);
      const right = emit(node.right, bound, source);
      if (node.operator === 'in') {
        return `${B.hasIn}(${left}, ${right})`;
      }
      if (DIRECT_BINARY.has(node.operator)) {
        return `(${left} ${node.operator} ${right})`;
      }
      throw new ExpressionCodegenError(`Unsupported operator "${node.operator}"`, source);
    }

    case 'Logical':
      return `(${emit(node.left, bound, source)} ${node.operator} ${emit(node.right, bound, source)})`;

    case 'Conditional':
      return `(${emit(node.test, bound, source)} ? ${emit(node.consequent, bound, source)} : ${emit(node.alternate, bound, source)})`;

    case 'Assignment':
      return emitAssignment(node, bound, source);

    case 'Update':
      return emitUpdate(node, bound, source);

    case 'Arrow': {
      const inner = new Bound(bound, node.params);
      const body = emit(node.body, inner, source);
      return `((${node.params.join(', ')}) => ${body})`;
    }

    case 'Sequence':
      return `(${node.expressions.map((expression) => emit(expression, bound, source)).join(', ')})`;

    case 'Spread':
      throw new ExpressionCodegenError('A spread element is not valid here', source);

    default:
      throw new ExpressionCodegenError(`Unsupported expression node "${node.type}"`, source);
  }
}

/**
 * Emits an argument list, including spreads.
 * @param {object[]} args - Argument nodes.
 * @param {Bound|null} bound - Enclosing bindings.
 * @param {string} source - The original expression.
 * @returns {string} An array literal of the arguments.
 */
function emitArguments(args, bound, source) {
  const parts = args.map((arg) =>
    arg.type === 'Spread' ? `...${emit(arg.argument, bound, source)}` : emit(arg, bound, source),
  );
  return `[${parts.join(', ')}]`;
}

/**
 * Emits a call, preserving the receiver for a method call.
 *
 * The receiver has to be evaluated once and used twice — as the object of the
 * member read and as `this` — so a method call binds it to a temporary rather
 * than emitting the object expression twice, which would run its side effects
 * twice.
 * @param {object} node - The Call node.
 * @param {Bound|null} bound - Enclosing bindings.
 * @param {string} source - The original expression.
 * @returns {string} JavaScript source for the call.
 */
function emitCall(node, bound, source) {
  const B = RUNTIME_BINDINGS;
  const { callee } = node;
  const args = emitArguments(node.args, bound, source);

  if (callee.type === 'Member') {
    const object = emit(callee.object, bound, source);
    const key = callee.computed
      ? emit(callee.property, bound, source)
      : quote(callee.property.value);
    if (!callee.computed && FORBIDDEN_KEYS.has(String(callee.property.value))) {
      throw new ExpressionCodegenError(
        `Access to property "${callee.property.value}" is blocked for security reasons.`,
        source,
      );
    }
    const description = quote(
      callee.computed ? `${describe(callee.object)}[…]` : `${describe(callee.object)}.${callee.property.value}`,
    );

    // `(o => …)(object)` keeps the receiver in one evaluation. The optional
    // chain short-circuits before the read, exactly as `?.` does.
    const short = callee.optional ? '$o === null || $o === undefined ? undefined : ' : '';
    const inner = `${B.call}(${B.read}($o, ${key}, ${callee.optional ? 'true' : 'false'}), $o, ${args}, ${description})`;
    const called = node.optional
      ? `(($f) => $f === null || $f === undefined ? undefined : ${B.call}($f, $o, ${args}, ${description}))(${B.read}($o, ${key}, ${callee.optional ? 'true' : 'false'}))`
      : inner;
    return `(($o) => ${short}${called})(${object})`;
  }

  const fn = emit(callee, bound, source);
  const description = quote(describe(callee));
  if (node.optional) {
    return `(($f) => $f === null || $f === undefined ? undefined : ${B.call}($f, undefined, ${args}, ${description}))(${fn})`;
  }
  return `${B.call}(${fn}, undefined, ${args}, ${description})`;
}

/**
 * Emits an assignment, routing writes through the guarded primitives.
 * @param {object} node - The Assignment node.
 * @param {Bound|null} bound - Enclosing bindings.
 * @param {string} source - The original expression.
 * @returns {string} JavaScript source for the assignment.
 */
function emitAssignment(node, bound, source) {
  const B = RUNTIME_BINDINGS;
  const { target, operator } = node;
  const value = emit(node.value, bound, source);

  if (target.type === 'Identifier') {
    if (bound && bound.has(target.name)) {
      // A lambda parameter is an ordinary JavaScript binding.
      return `(${target.name} ${operator} ${value})`;
    }
    const name = quote(target.name);
    const current = `${B.get}(${B.scope}, ${name})`;
    if (operator === '=') {
      return `${B.set}(${B.scope}, ${name}, ${value})`;
    }
    if (operator === '&&=') {
      return `(($c) => $c ? ${B.set}(${B.scope}, ${name}, ${value}) : $c)(${current})`;
    }
    if (operator === '||=') {
      return `(($c) => $c ? $c : ${B.set}(${B.scope}, ${name}, ${value}))(${current})`;
    }
    if (operator === '??=') {
      return `(($c) => $c !== null && $c !== undefined ? $c : ${B.set}(${B.scope}, ${name}, ${value}))(${current})`;
    }
    return `${B.set}(${B.scope}, ${name}, (${current} ${operator.slice(0, -1)} ${value}))`;
  }

  const object = emit(target.object, bound, source);
  const key = target.computed ? emit(target.property, bound, source) : quote(target.property.value);
  if (!target.computed && FORBIDDEN_KEYS.has(String(target.property.value))) {
    throw new ExpressionCodegenError(
      `Writing to property "${target.property.value}" is blocked for security reasons.`,
      source,
    );
  }

  // Object and key are each evaluated once and reused, so `a[i++] += 1` does
  // not advance `i` twice.
  const current = `${B.read}($o, $k, false)`;
  if (operator === '=') {
    return `(($o, $k) => ${B.write}($o, $k, ${value}))(${object}, ${key})`;
  }
  if (operator === '&&=') {
    return `(($o, $k) => { const $c = ${current}; return $c ? ${B.write}($o, $k, ${value}) : $c; })(${object}, ${key})`;
  }
  if (operator === '||=') {
    return `(($o, $k) => { const $c = ${current}; return $c ? $c : ${B.write}($o, $k, ${value}); })(${object}, ${key})`;
  }
  if (operator === '??=') {
    return `(($o, $k) => { const $c = ${current}; return $c !== null && $c !== undefined ? $c : ${B.write}($o, $k, ${value}); })(${object}, ${key})`;
  }
  return `(($o, $k) => ${B.write}($o, $k, (${current} ${operator.slice(0, -1)} ${value})))(${object}, ${key})`;
}

/**
 * Emits `++` / `--`, preserving prefix and postfix value semantics.
 * @param {object} node - The Update node.
 * @param {Bound|null} bound - Enclosing bindings.
 * @param {string} source - The original expression.
 * @returns {string} JavaScript source for the update.
 */
function emitUpdate(node, bound, source) {
  const B = RUNTIME_BINDINGS;
  const { argument, operator, prefix } = node;
  const delta = operator === '++' ? '+ 1' : '- 1';

  if (argument.type === 'Identifier') {
    if (bound && bound.has(argument.name)) {
      return `(${prefix ? `${operator}${argument.name}` : `${argument.name}${operator}`})`;
    }
    const name = quote(argument.name);
    return (
      `(($c) => { const $n = $c ${delta}; ${B.set}(${B.scope}, ${name}, $n); return ${prefix ? '$n' : '$c'}; })` +
      `(Number(${B.get}(${B.scope}, ${name})))`
    );
  }

  const object = emit(argument.object, bound, source);
  const key = argument.computed ? emit(argument.property, bound, source) : quote(argument.property.value);
  if (!argument.computed && FORBIDDEN_KEYS.has(String(argument.property.value))) {
    throw new ExpressionCodegenError(
      `Writing to property "${argument.property.value}" is blocked for security reasons.`,
      source,
    );
  }
  return (
    `(($o, $k) => { const $c = Number(${B.read}($o, $k, false)); const $n = $c ${delta}; ` +
    `${B.write}($o, $k, $n); return ${prefix ? '$n' : '$c'}; })(${object}, ${key})`
  );
}

/**
 * Compiles one expression to a scope-taking arrow function.
 * @param {string} source - The expression source.
 * @returns {string} JavaScript source for `($s) => value`.
 * @throws {ExpressionCodegenError} When the expression cannot be compiled.
 */
export function compileExpressionToSource(source) {
  let ast;
  try {
    ast = parseExpression(source);
  } catch (error) {
    if (error instanceof ExpressionParseError) {
      throw new ExpressionCodegenError(error.message, source);
    }
    throw error;
  }
  return `(${RUNTIME_BINDINGS.scope}) => (${emit(ast, null, source)})`;
}

/**
 * Compiles a run of expression statements to a scope-taking arrow function.
 *
 * Used for inline event handlers and any action body that is a sequence of
 * expressions rather than real statement syntax. The value is discarded, which
 * is what the interpreter did for a `Program`.
 * @param {string} source - The statement source.
 * @returns {string} JavaScript source for `($s) => { … }`.
 * @throws {ExpressionCodegenError} When the source cannot be compiled.
 */
export function compileStatementsToSource(source) {
  let ast;
  try {
    ast = parseExpressionProgram(source);
  } catch (error) {
    if (error instanceof ExpressionParseError) {
      throw new ExpressionCodegenError(error.message, source);
    }
    throw error;
  }
  const body = ast.body.map((statement) => `${emit(statement, null, source)};`).join(' ');
  return `(${RUNTIME_BINDINGS.scope}) => { ${body} }`;
}

/**
 * Compiles an expression, returning null rather than throwing.
 * @param {string} source - The expression source.
 * @returns {{code: string}|{error: string}} The generated source, or the reason.
 */
export function tryCompileExpression(source) {
  try {
    return { code: compileExpressionToSource(source) };
  } catch (error) {
    return { error: error.message };
  }
}

/**
 * Compiles a statement run, returning null rather than throwing.
 * @param {string} source - The statement source.
 * @returns {{code: string}|{error: string}} The generated source, or the reason.
 */
export function tryCompileStatements(source) {
  try {
    return { code: compileStatementsToSource(source) };
  } catch (error) {
    return { error: error.message };
  }
}

/**
 * The import statement a module holding a compiled class body needs.
 *
 * One function rather than a literal repeated at each framing site. There are
 * three -- the CLI's module emitter, the Vite plugin's wrapper, and the tests
 * that frame a bare class body themselves -- and when the generator started
 * emitting calls to the expression primitives, every site that still wrote the
 * import by hand produced a module that threw `axGet is not defined` at its
 * first render. Deriving the line from the same list the generator emits
 * against makes that class of drift impossible.
 * @param {string} base - The base class name to import (`AvenxComponent` or `AvenxPage`).
 * @param {string} [specifier] - Where the base class comes from.
 * @param {string} [opsSpecifier] - Where the primitives come from, when that is
 *   somewhere else. A caller importing the base class straight from its own
 *   module -- a test does -- still has to reach the runtime index for these.
 * @returns {string} The import declaration, or two.
 */
export function runtimeImportStatement(base, specifier = 'avenx-core/runtime', opsSpecifier = specifier) {
  if (opsSpecifier === specifier) {
    return `import { ${[base, ...RUNTIME_IMPORT_NAMES].join(', ')} } from ${JSON.stringify(specifier)};`;
  }
  return [
    `import { ${base} } from ${JSON.stringify(specifier)};`,
    `import { ${RUNTIME_IMPORT_NAMES.join(', ')} } from ${JSON.stringify(opsSpecifier)};`,
  ].join('\n');
}

export { ALLOWED_GLOBALS };

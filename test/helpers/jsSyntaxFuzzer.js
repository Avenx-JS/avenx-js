/**
 * @file jsSyntaxFuzzer.js
 * @description Generates JavaScript sources for differential parser testing.
 *
 * Two generators, because they find different defects.
 *
 * {@link generateProgram} builds a syntactically valid program from a grammar,
 * which exercises the parser's agreement with acorn on its _shape_: node types,
 * ranges and the flags a node carries. A hand-written corpus can only contain
 * the combinations someone thought of; this one nests them.
 *
 * {@link mutate} takes real source and damages it — deletes a character,
 * swaps two, truncates, duplicates a token — which exercises agreement on
 * _refusal_. That is the half that matters most: a parser that quietly accepts
 * a source acorn rejects is a parser that will one day hand the code generator
 * something that is not JavaScript.
 *
 * The generator is seeded, so a failure reported by the test can be reproduced
 * from the seed in the message.
 * @module test/helpers/jsSyntaxFuzzer
 */

/**
 * A small deterministic pseudo-random generator.
 *
 * `Math.random()` would make a failure unreproducible, which is the one thing a
 * fuzz test must not be.
 */
export class Rng {
  /**
   * @param {number} seed - Any integer.
   */
  constructor(seed) {
    /** @type {number} */
    this.state = (seed >>> 0) || 1;
  }

  /**
   * @returns {number} The next value in [0, 1).
   */
  next() {
    // xorshift32
    let x = this.state;
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    this.state = x >>> 0;
    return this.state / 0x100000000;
  }

  /**
   * @param {number} limit - Exclusive upper bound.
   * @returns {number} An integer in [0, limit).
   */
  int(limit) {
    return Math.floor(this.next() * limit);
  }

  /**
   * @template T
   * @param {T[]} items - The choices.
   * @returns {T} One of them.
   */
  pick(items) {
    return items[this.int(items.length)];
  }

  /**
   * @param {number} probability - Chance of true, 0 to 1.
   * @returns {boolean} The outcome.
   */
  chance(probability) {
    return this.next() < probability;
  }
}

const NAMES = ['a', 'b', 'c', 'count', 'items', 'x', '_v', '$s', 'async', 'get', 'of', 'let', 'value'];
const LITERALS = ['0', '1', '1.5', '.5', '1e3', '0x1f', '0b11', '1_000', '2n', '"s"', "'t'", 'true', 'false', 'null', '`t${1}`', '/re/g'];
// `**` is deliberately absent: its left operand may not be an arrow function,
// and acorn is lenient about that while this parser and V8 are not, so a
// generated `arrow ** n` would report a divergence that is not a defect.
const BINARY = ['+', '-', '*', '/', '%', '==', '===', '!=', '<', '>', '<=', '>>', '>>>', '&', '|', '^', 'instanceof', 'in'];
const LOGICAL = ['&&', '||'];
const UNARY = ['-', '+', '!', '~', 'typeof ', 'void ', 'delete '];
const ASSIGN = ['=', '+=', '-=', '*=', '&&=', '||=', '??=', '**=', '>>>='];

/**
 * Generates a random expression.
 * @param {Rng} rng - The generator.
 * @param {number} depth - Remaining nesting budget.
 * @returns {string} Expression source.
 */
export function generateExpression(rng, depth = 3) {
  if (depth <= 0) return rng.chance(0.5) ? rng.pick(NAMES) : rng.pick(LITERALS);
  const sub = () => generateExpression(rng, depth - 1);
  const choices = [
    () => rng.pick(NAMES),
    () => rng.pick(LITERALS),
    () => `(${sub()} ${rng.pick(BINARY)} ${sub()})`,
    () => `(${sub()} ${rng.pick(LOGICAL)} ${sub()})`,
    () => `(${sub()} ?? ${sub()})`,
    () => `${rng.pick(UNARY)}(${sub()})`,
    () => `(${sub()} ? ${sub()} : ${sub()})`,
    () => `${rng.pick(NAMES)}${rng.pick(ASSIGN)} ${sub()}`,
    () => `${rng.pick(NAMES)}.${rng.pick(NAMES)}`,
    () => `${rng.pick(NAMES)}?.${rng.pick(NAMES)}`,
    () => `${rng.pick(NAMES)}?.[${sub()}]`,
    () => `${rng.pick(NAMES)}?.(${sub()})`,
    () => `${rng.pick(NAMES)}(${sub()}, ...${rng.pick(NAMES)})`,
    () => `new ${rng.pick(NAMES)}(${sub()})`,
    () => `[${sub()}, , ${sub()}, ...${rng.pick(NAMES)}]`,
    () => `({ ${rng.pick(NAMES)}: ${sub()}, ${rng.pick(NAMES)}, [${sub()}]: ${sub()}, m() { return ${sub()} }, get g() { return ${sub()} }, ...${rng.pick(NAMES)} })`,
    () => `(${rng.pick(NAMES)}) => ${sub()}`,
    () => `(${rng.pick(NAMES)}, ${rng.pick(NAMES)} = ${sub()}) => { return ${sub()}; }`,
    () => `async (${rng.pick(NAMES)}) => ${sub()}`,
    () => `function (${rng.pick(NAMES)}) { return ${sub()}; }`,
    () => `class { m() { return ${sub()} } static #p = ${sub()}; #q() {} }`,
    () => `\`a\${${sub()}}b\${${sub()}}\``,
    () => `${rng.pick(NAMES)}\`t\${${sub()}}\``,
    () => `(${sub()}, ${sub()})`,
    () => `(${sub()}) ** ${depth}`,
  ];
  return rng.pick(choices)();
}

/**
 * Generates a random statement.
 * @param {Rng} rng - The generator.
 * @param {number} depth - Remaining nesting budget.
 * @returns {string} Statement source.
 */
export function generateStatement(rng, depth = 3) {
  const expression = () => generateExpression(rng, 2);
  if (depth <= 0) return `${expression()};`;
  const sub = () => generateStatement(rng, depth - 1);
  const choices = [
    () => `${expression()};`,
    () => `${rng.pick(['var', 'let', 'const'])} ${rng.pick(NAMES)}${rng.int(1000)} = ${expression()};`,
    () => `var { ${rng.pick(NAMES)}: ${rng.pick(NAMES)}${rng.int(1000)} = ${expression()}, ...r${rng.int(1000)} } = ${expression()};`,
    () => `var [${rng.pick(NAMES)}${rng.int(1000)}, , ...t${rng.int(1000)}] = ${expression()};`,
    () => `if (${expression()}) ${sub()} else ${sub()}`,
    () => `{ ${sub()} ${sub()} }`,
    () => `for (let i${rng.int(1000)} = 0; i${rng.int(1000)} < 10; i${rng.int(1000)}++) ${sub()}`,
    () => `for (const k${rng.int(1000)} of ${expression()}) ${sub()}`,
    () => `for (var k${rng.int(1000)} in ${expression()}) ${sub()}`,
    () => `while (${expression()}) ${sub()}`,
    () => `do ${sub()} while (${expression()});`,
    () => `switch (${expression()}) { case ${expression()}: ${sub()} break; default: ${sub()} }`,
    () => `try { ${sub()} } catch (e${rng.int(1000)}) { ${sub()} } finally { ${sub()} }`,
    () => `try { ${sub()} } catch { ${sub()} }`,
    () => `function f${rng.int(100000)}(${rng.pick(NAMES)}, { ${rng.pick(NAMES)} } = {}) { ${sub()} return ${expression()}; }`,
    () => `async function g${rng.int(100000)}() { await ${expression()}; for await (const z${rng.int(1000)} of ${expression()}) ${sub()} }`,
    () => `function* h${rng.int(100000)}() { yield ${expression()}; yield* ${expression()}; }`,
    () => `class C${rng.int(100000)} extends ${rng.pick(NAMES)} { constructor() { super(); } static { this.x = ${expression()}; } }`,
    () => `l${rng.int(100000)}: for (;;) { break l${rng.int(100000)}; }`,
    () => `throw ${expression()};`,
    () => `;`,
    () => `debugger;`,
  ];
  return rng.pick(choices)();
}

/**
 * Generates a whole program.
 * @param {number} seed - The seed.
 * @param {object} [options] - `statements` and `depth` bound the size.
 * @returns {string} Program source.
 */
export function generateProgram(seed, options = {}) {
  const rng = new Rng(seed);
  const statements = options.statements || 1 + rng.int(5);
  const parts = [];
  for (let i = 0; i < statements; i += 1) {
    parts.push(generateStatement(rng, options.depth === undefined ? 2 : options.depth));
  }
  return parts.join('\n');
}

/**
 * Damages a source in one of a few ways, to test agreement on refusal.
 * @param {string} source - The source to damage.
 * @param {number} seed - The seed.
 * @returns {string} The mutated source.
 */
export function mutate(source, seed) {
  const rng = new Rng(seed);
  if (source.length < 4) return source;
  const at = rng.int(source.length);
  switch (rng.int(6)) {
    case 0:
      return source.slice(0, at) + source.slice(at + 1);
    case 1:
      return source.slice(0, at);
    case 2:
      return source.slice(0, at) + rng.pick(['{', '}', '(', ')', '[', ']', ';', ',', '=', '`', '"', "'", '/', '*', '.', '?', ':']) + source.slice(at);
    case 3: {
      const other = rng.int(source.length);
      const chars = [...source];
      const swap = chars[at];
      chars[at] = chars[other];
      chars[other] = swap;
      return chars.join('');
    }
    case 4:
      return source.slice(0, at) + source.slice(at, at + 1 + rng.int(8)) + source.slice(at);
    default:
      return source.slice(at) + source.slice(0, at);
  }
}

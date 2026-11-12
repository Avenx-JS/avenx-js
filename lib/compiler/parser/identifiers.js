/**
 * @file identifiers.js
 * @description Finds the root identifiers a template expression reads.
 *
 * Shared by template validation, which reports a root identifier the component
 * does not declare, and by dependency extraction, which records the state a
 * template's rendering depends on.
 */

/**
 * Names that are never reported as undeclared: literals, keywords, the
 * globals the expression language exposes, and the names every component's
 * scope provides.
 * @type {Set<string>}
 */
export const EXCLUDED_IDENTIFIERS = new Set([
  'true',
  'false',
  'null',
  'undefined',
  'NaN',
  'Infinity',
  'this',
  'let',
  'const',
  'var',
  'function',
  'return',
  'if',
  'else',
  'for',
  'in',
  'of',
  'new',
  'typeof',
  'instanceof',
  'class',
  'extends',
  'try',
  'catch',
  'finally',
  'throw',
  'await',
  'async',
  'import',
  'export',
  'default',
  'delete',
  'void',
  'do',
  'while',
  'switch',
  'case',
  'break',
  'continue',
  'debugger',
  'yield',
  'with',
  'arguments',
  'console',
  'Math',
  'JSON',
  'window',
  'document',
  'Array',
  'Object',
  'String',
  'Number',
  'Boolean',
  'Date',
  'Error',
  'Map',
  'Set',
  'Promise',
  'props',
  'state',
  'styles',
  'event',
  'args',
]);

/**
 * The parameter names bound by arrow functions in an expression.
 *
 * Covers `x => …` and `(x, y) => …`, which is the whole of what the template
 * expression language admits -- a destructuring parameter is not an expression
 * and is refused before it reaches here.
 * @param {string} code - The expression source.
 * @returns {Set<string>} The bound names.
 */
function arrowParameters(code) {
  const names = new Set();
  const arrow = /(?:\(([^)]*)\)|([A-Za-z_$][\w$]*))\s*=>/g;
  let match;

  while ((match = arrow.exec(code)) !== null) {
    const list = match[1] !== undefined ? match[1] : match[2];
    for (const part of list.split(',')) {
      const name = part.trim();
      if (/^[A-Za-z_$][\w$]*$/.test(name)) names.add(name);
    }
  }
  return names;
}

/**
 * Extracts root variable and method identifiers from a JS expression string.
 * @param {string} code - The Javascript expression/statement.
 * @returns {string[]} The list of root identifiers.
 */
export function extractRootIdentifiers(code) {
  const identifiers = new Set();
  let i = 0;
  let hasQuestionMark = false;

  while (i < code.length) {
    const char = code[i];

    if (char === '/' && code[i + 1] === '/') {
      i += 2;
      while (i < code.length && code[i] !== '\n') i++;
      continue;
    }

    if (char === '/' && code[i + 1] === '*') {
      i += 2;
      while (i < code.length && !(code[i] === '*' && code[i + 1] === '/')) i++;
      i += 2;
      continue;
    }

    if (char === "'") {
      i++;
      while (i < code.length && code[i] !== "'") {
        if (code[i] === '\\') i++;
        i++;
      }
      i++;
      continue;
    }

    if (char === '"') {
      i++;
      while (i < code.length && code[i] !== '"') {
        if (code[i] === '\\') i++;
        i++;
      }
      i++;
      continue;
    }

    if (char === '`') {
      i++;
      while (i < code.length && code[i] !== '`') {
        if (code[i] === '\\') i++;
        if (code[i] === '$' && code[i + 1] === '{') {
          let depth = 1;
          let j = i + 2;
          while (j < code.length && depth > 0) {
            if (code[j] === '{') depth++;
            else if (code[j] === '}') depth--;
            j++;
          }
          const subExpr = code.substring(i + 2, j - 1);
          extractRootIdentifiers(subExpr).forEach((id) => identifiers.add(id));
          i = j - 1;
        }
        i++;
      }
      i++;
      continue;
    }

    const idRegex = /^[A-Za-z_$][\w$]*/;
    const sub = code.substring(i);
    const match = sub.match(idRegex);
    if (match) {
      const name = match[0];

      let isProperty = false;
      let checkIdx = i - 1;
      while (checkIdx >= 0 && /\s/.test(code[checkIdx])) {
        checkIdx--;
      }
      if (checkIdx >= 0 && code[checkIdx] === '.') {
        isProperty = true;
      } else if (checkIdx >= 1 && code[checkIdx] === '.' && code[checkIdx - 1] === '?') {
        isProperty = true;
      }

      let nextIdx = i + name.length;
      while (nextIdx < code.length && /\s/.test(code[nextIdx])) {
        nextIdx++;
      }
      let isObjectKey = false;
      if (nextIdx < code.length && code[nextIdx] === ':') {
        if (!hasQuestionMark) {
          isObjectKey = true;
        } else {
          hasQuestionMark = false;
        }
      }

      if (!isProperty && !isObjectKey) {
        identifiers.add(name);
      }

      i += name.length;
      continue;
    }

    if (char === '?') {
      if (code[i + 1] === '.') {
        i += 2;
        continue;
      }
      hasQuestionMark = true;
    }

    if (char === ';' || char === ',' || char === '{' || char === '(' || char === '[') {
      hasQuestionMark = false;
    }

    i++;
  }

  // An arrow function's parameters are bound by the arrow, not by the
  // component. `rows.filter(r => r.done)` declares `r`, and reporting it as
  // undeclared is a warning on correct code -- which is worse than no
  // warning, because it teaches people to ignore the category.
  //
  // Previously invisible: a `<@for>` header containing an arrow never reached
  // this function intact, because the header was truncated at the arrow
  // before it got here.
  for (const name of arrowParameters(code)) {
    identifiers.delete(name);
  }

  return Array.from(identifiers);
}

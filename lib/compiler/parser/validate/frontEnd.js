/**
 * @file frontEnd.js
 * @description Front-end declaration tag checks, JS-module detection, and unterminated interpolation diagnostics.
 */
import path from 'path';
import { AvenxErrorCodes } from '../../../core/runtime/AvenxError.js';
import { interpolationEnd, tokenizeMarkup } from '../../../core/utils/markupLexer.js';
import { TemplateValidationError } from '../../errors/index.js';
import { readDeclarations } from '../../expressionParser.js';
import { reportWarning } from '../../utils/warningReporter.js';
import { parse as parseJs } from '../js/parser.js';
import { loadAvenxConfig } from '../projectConfig.js';
import { frontEndLocation } from './locations.js';

/**
 * Detects if a template string appears to be a JavaScript module rather than
 * markup.
 *
 * A .component.js file is expected to contain a single-file component template
 * (markup, declaration tags, etc.). When a file containing JavaScript code
 * (such as a class-based component or module helper) is saved as .component.js,
 * the compiler would otherwise treat the source code as template text and render
 * it verbatim to the DOM.
 * @param {string} template - The template string to check.
 * @returns {boolean} True if the template is detected to be a JavaScript module.
 */
export function isJavaScriptModule(template) {
  if (typeof template !== 'string') return false;

  let text = template;
  let changed = true;
  while (changed) {
    changed = false;
    const trimmed = text.trimStart();
    if (trimmed !== text) {
      text = trimmed;
      changed = true;
    }
    // HTML comment <!-- ... -->
    if (text.startsWith('<!--')) {
      const end = text.indexOf('-->');
      if (end !== -1) {
        text = text.slice(end + 3);
        changed = true;
        continue;
      }
    }
    // JS line comment // ...
    if (text.startsWith('//')) {
      const nextLine = text.indexOf('\n');
      text = nextLine !== -1 ? text.slice(nextLine + 1) : '';
      changed = true;
      continue;
    }
    // JS block comment /* ... */
    if (text.startsWith('/*')) {
      const end = text.indexOf('*/');
      if (end !== -1) {
        text = text.slice(end + 2);
        changed = true;
        continue;
      }
    }
  }

  if (!text || text.startsWith('<')) {
    return false;
  }

  // Fast check: the first non-comment, non-whitespace token must be a JS keyword
  if (!/^(?:export\b|import\b|class\b|const\b|let\b|var\b|function\b|async\s+function\b)/.test(text)) {
    return false;
  }

  try {
    const ast = parseJs(text, { ecmaVersion: 'latest', sourceType: 'module' });
    if (ast && ast.body && ast.body.length > 0) {
      return true;
    }
  } catch {
    // If the parser refuses it (invalid or unfinished JavaScript), check
    // whether the file unambiguously starts with a module export/import or a
    // class declaration
    if (/^(?:export\b|import\b|class\s+\w+\s+extends\b)/.test(text)) {
      return true;
    }
  }

  return false;
}

/**
 * Fails the build when an `<action>` or `<resource>` is never closed.
 *
 * Its body would otherwise be read as template markup: the JavaScript would
 * render as text, and the declaration would silently not exist.
 * @param {string} content - The component source.
 * @param {string} filePath - The component path.
 * @param {string} name - The component class name.
 * @throws {TemplateValidationError} AVX_C26 for the first unclosed declaration.
 */
export function assertDeclarationsTerminated(content, filePath, name) {
  const [first] = readDeclarations(content).unterminated;
  if (!first) return;
  const error = new TemplateValidationError(
    AvenxErrorCodes.COMPILER_MALFORMED_TEMPLATE,
    name,
    `the <${first.name}> declaration is never closed with </${first.name}>`,
    content.slice(first.offset).split('\n')[0],
  );
  error.setLocation({ source: content, index: first.offset, filename: filePath });
  throw error;
}

/**
 * Reports the diagnostics the style front-end recorded, with locations.
 * @param {Array<{severity: string, code: string, args: string[], offset: number, snippet: string}>} diagnostics
 *   What {@link StyleProcessor#process} recorded.
 * @param {string} template - The template those offsets refer to.
 * @param {string} content - The component source.
 * @param {string} filePath - The component path.
 * @param {object} [options] - Parser state the check reads.
 * @param {object|null} [options.config] - The parser's explicit project configuration. When
 *   absent, the configuration is resolved from `filePath`.
 * @throws {TemplateValidationError} For an error-severity diagnostic, or a
 *   warning escalated to an error in avenx.config.json.
 */
export function reportFrontEndDiagnostics(
  diagnostics,
  template,
  content,
  filePath,
  { config: parserConfig = null } = {},
) {
  if (!Array.isArray(diagnostics)) return;
  const config = parserConfig || (filePath ? loadAvenxConfig(path.dirname(filePath)) : null);
  for (const diagnostic of diagnostics) {
    const args = diagnostic.severity === 'error' ? [...diagnostic.args, diagnostic.snippet] : diagnostic.args;
    const error = new TemplateValidationError(diagnostic.code, ...args);
    // A negative offset means the finding is not at a point in the template:
    // an unused style block lives in the stylesheet, and a code frame cut
    // from line one of the template would point at the wrong file entirely.
    if (diagnostic.offset >= 0) {
      error.setLocation(frontEndLocation(content, template, diagnostic.offset, diagnostic.snippet, filePath));
    }
    if (diagnostic.severity === 'error') {
      throw error;
    }
    reportWarning(diagnostic.code, error, config);
  }
}

/**
 * Fails the build if a directive the front-end rewrites is still present.
 *
 * `@css`, `<@css />` and `data-ax-bind` have no meaning to either renderer:
 * the IR would read `@css` as an event handler named "css" and `data-ax-bind`
 * as an inert attribute, and the component would build and silently lose its
 * styling or its binding. After the front-end has run none of them may remain,
 * so finding one is a compiler defect and the build stops rather than emit it.
 * @param {string} template - The rewritten template.
 * @param {string} content - The component source.
 * @param {string} filePath - The component path.
 * @param {string} name - The component class name.
 * @throws {TemplateValidationError} AVX_C25 when a directive survived.
 */
export function assertFrontEndComplete(template, content, filePath, name) {
  if (typeof template !== 'string') return;
  for (const token of tokenizeMarkup(template)) {
    if (token.type !== 'open' || token.unterminated) continue;
    let leftover = null;
    if (token.name === '@css') {
      leftover = 'a <@css /> tag';
    } else if (token.attrs.some((attr) => attr.name === '@css')) {
      leftover = 'an @css attribute';
    } else if (
      !token.directive &&
      /^(input|textarea|select)$/i.test(token.name) &&
      token.attrs.some((attr) => attr.name.toLowerCase() === 'data-ax-bind')
    ) {
      leftover = 'a data-ax-bind attribute';
    }
    if (!leftover) continue;
    const snippet = template.slice(token.start, token.end);
    const error = new TemplateValidationError(
      AvenxErrorCodes.COMPILER_TEMPLATE_REWRITE_INCOMPLETE,
      name,
      leftover,
      snippet,
    );
    error.setLocation(frontEndLocation(content, template, token.start, snippet, filePath));
    throw error;
  }
}

/**
 * Reports an interpolation that is opened and never closed (AVX_W54).
 *
 * An unterminated `{{` is not a parse failure: the lexer treats the braces as
 * ordinary text, so the template compiles, the build exits 0, and the page
 * shows the braces and the expression source to a visitor. Forgetting one
 * `}}` therefore looked exactly like working code until someone loaded the
 * page, and the misread state was reported a second time -- as AVX_W40,
 * claiming the state the broken interpolation meant to read is read nowhere.
 *
 * A warning rather than an error, because a template may legitimately contain
 * literal `{{` in prose, and refusing to build such a template would be worse
 * than describing it.
 * @param {string} template - The template being validated.
 * @param {string} filePath - Absolute path of the file being compiled.
 * @param {string} name - The component or page name, for the diagnostic.
 * @param {object|null} config - Resolved project configuration.
 * @returns {void}
 */
export function reportUnterminatedInterpolations(template, filePath, name, config) {
  if (!template) return;
  const filename = filePath ? path.basename(filePath) : name || 'template';

  for (let index = template.indexOf('{{'); index !== -1; index = template.indexOf('{{', index + 2)) {
    const end = interpolationEnd(template, index);
    if (end !== -1) {
      // Terminated: skip past it, so a `{{` inside a closed interpolation's
      // body is not examined on its own.
      index = end - 2;
      continue;
    }

    const excerpt = template.slice(index, index + 40).split('\n')[0];
    // The file, not the component name: the phrasing "in template of <file>"
    // is what `avenx check --json` reads a location out of, and it is what
    // AVX_W03 already uses for the same kind of finding.
    const err = new TemplateValidationError(
      AvenxErrorCodes.COMPILER_UNTERMINATED_INTERPOLATION,
      filename,
      JSON.stringify(excerpt),
    );
    err.setLocation({ source: template, index, filename: filePath || filename });
    reportWarning(AvenxErrorCodes.COMPILER_UNTERMINATED_INTERPOLATION, err, config);
  }
}


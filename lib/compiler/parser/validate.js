/**
 * @file validate.js
 * @description Template validation and front-end diagnostics.
 *
 * Every check the parser runs over a component's template before code is
 * generated: well-formedness, leftover front-end directives, bound inline
 * handlers, interpolated dynamic attributes, undeclared references, unknown
 * event modifiers, duplicate ids, unterminated interpolations, unresolved
 * component tags and accessibility.
 *
 * The functions keep the parser method signatures they were extracted from.
 * Anything a check used to read from the parser instance -- its explicit
 * configuration, its void tags, the project's component names and route
 * parameters -- is passed in a trailing `options` object instead.
 */
import path from 'path';
import loadConfig, { getClosestKey } from '../../config.js';
import { AvenxErrorCodes } from '../../core/runtime/AvenxError.js';
import { EVENT_MODIFIERS } from '../../core/events/modifiers.js';
import { isEventHandlerAttribute } from '../../core/security/eventAttributes.js';
import { tokenizeMarkup, interpolationEnd } from '../../core/utils/markupLexer.js';
import { TemplateValidationError } from '../errors/index.js';
import { readDeclarations } from '../expressionParser.js';
import { parseForHeader } from '../ir/build.js';
import { BUILTIN_COMPONENTS } from '../builtinComponents.js';
import { validateAccessibility as runAccessibilityRules } from '../rules/accessibility.js';
import { collectTemplateEvents } from '../templateEvents.js';
import { reportWarning } from '../utils/warningReporter.js';
import { parseHTML, scanTagEnd } from './htmlTree.js';
import { parse as parseJs } from './js/parser.js';
import { loadAvenxConfig, getCustomVoidTags } from './projectConfig.js';
import { EXCLUDED_IDENTIFIERS, extractRootIdentifiers } from './identifiers.js';

/**
 * Framework tags the compiler understands directly. These are never real
 * components, so a reference to one must not be reported as an unresolved
 * component (see {@link validateComponentTags} / AVX_W46).
 *
 * The `@`-prefixed directives (`@for`, `@if`, `@suspense`, …) are handled
 * separately: any tag beginning with `@` is skipped unconditionally, so it is
 * enough to list the non-prefixed framework tags here.
 * @type {Set<string>}
 */
const BUILTIN_TAGS = new Set([
  'slot',
  'resource',
  'state',
  'action',
  'transition',
  'template',
  'component',
  'script',
  'style',
]);

/**
 * A conservative set of known HTML and SVG element names. Element names are
 * lowercase, so a PascalCase tag can practically never collide with one; this
 * set exists only as a defensive net for an element written with an unusual
 * case. It is deliberately not exhaustive — anything lowercase is treated as an
 * ordinary element regardless of membership (see {@link validateComponentTags}).
 * @type {Set<string>}
 */
const KNOWN_ELEMENTS = new Set([
  // Common HTML
  'a',
  'abbr',
  'address',
  'article',
  'aside',
  'audio',
  'b',
  'bdi',
  'bdo',
  'blockquote',
  'body',
  'button',
  'canvas',
  'caption',
  'cite',
  'code',
  'colgroup',
  'data',
  'datalist',
  'dd',
  'del',
  'details',
  'dfn',
  'dialog',
  'div',
  'dl',
  'dt',
  'em',
  'fieldset',
  'figcaption',
  'figure',
  'footer',
  'form',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'head',
  'header',
  'hgroup',
  'html',
  'i',
  'iframe',
  'ins',
  'kbd',
  'label',
  'legend',
  'li',
  'main',
  'map',
  'mark',
  'menu',
  'meter',
  'nav',
  'noscript',
  'object',
  'ol',
  'optgroup',
  'option',
  'output',
  'p',
  'picture',
  'pre',
  'progress',
  'q',
  'rp',
  'rt',
  'ruby',
  's',
  'samp',
  'section',
  'select',
  'small',
  'span',
  'strong',
  'sub',
  'summary',
  'sup',
  'table',
  'tbody',
  'td',
  'textarea',
  'tfoot',
  'th',
  'thead',
  'time',
  'tr',
  'u',
  'ul',
  'var',
  'video',
  // SVG
  'svg',
  'circle',
  'clippath',
  'defs',
  'ellipse',
  'foreignobject',
  'g',
  'image',
  'line',
  'lineargradient',
  'marker',
  'mask',
  'path',
  'pattern',
  'polygon',
  'polyline',
  'radialgradient',
  'rect',
  'stop',
  'symbol',
  'text',
  'tspan',
  'use',
]);

/**
 * Adds every name a `<@for>` header or a `data-ax-as` attribute binds to the
 * declared set.
 *
 * `index` is included for every loop, named or not, because that is how the
 * loop index has always been reached -- and reporting it as undeclared was a
 * warning on correct code, which is worse than no warning at all.
 *
 * `data-ax-as` is how a template names the per-item variable: the compiler
 * writes it itself when it lowers `<@for>`, and `<VirtualList>` documents it
 * for its row template. Either way the name is introduced by the attribute, not
 * read from the component, so it is declared here rather than reported as an
 * undeclared reference.
 * @param {object} node - A parsed template node.
 * @param {Set<string>} declared - The set to add to.
 */
function collectLoopBindings(node, declared) {
  if (!node || node.type !== 'element') return;

  if ((node.tagName || '').toLowerCase() === '@for') {
    declared.add('index');
    try {
      const parts = parseForHeader(node.rawAttrs);
      if (parts.item) declared.add(parts.item);
      for (const name of parts.destructure || []) declared.add(name);
    } catch {
      // A malformed header is reported by the IR builder, with a location and
      // a reason. Adding a second, vaguer complaint here would not help.
    }
  }

  const as = node.attrs && node.attrs['data-ax-as'];
  if (typeof as === 'string' && as.trim() !== '' && !as.includes('{{')) {
    declared.add('index');
    // `data-ax-as="row"` or a destructuring form such as `data-ax-as="[a, b]"`.
    for (const part of as.replace(/[[\]]/g, '').split(',')) {
      const name = part.trim();
      if (/^[A-Za-z_$][\w$]*$/.test(name)) declared.add(name);
    }
  }

  for (const child of node.children || []) {
    collectLoopBindings(child, declared);
  }
}

/**
 * Finds every `<@fallback>` body and the names it introduces for its own
 * subtree, as source ranges.
 *
 * `<@deadlock>` exposes the boundary's `name` and the `as` alias (default
 * `error`) to its fallback. `<@errorBoundary>` exposes the `as` alias (default
 * `error`). `<@suspense>` exposes nothing. Both are read by the runtime when it
 * renders the fallback, so they are in scope there and nowhere else.
 * @param {string} template - The authored template.
 * @returns {Array<{start: number, end: number, names: string[]}>} One entry per
 *   fallback body that introduces names.
 */
function collectFallbackScopes(template) {
  const scopes = [];
  if (typeof template !== 'string' || !template.includes('@fallback')) return scopes;

  const tagRegex = /<(\/\s*)?@(deadlock|errorBoundary|suspense|fallback)\b/gi;
  const stack = [];
  let match;

  while ((match = tagRegex.exec(template)) !== null) {
    const tag = match[2].toLowerCase();

    if (!match[1]) {
      const end = scanTagEnd(template, match.index);
      if (end === -1) continue;
      const attrs = template.slice(match.index + match[0].length, end);
      tagRegex.lastIndex = end + 1;
      if (/\/\s*$/.test(attrs)) continue;
      stack.push({ tag, attrs, bodyStart: end + 1 });
      continue;
    }

    const at = stack.map((entry) => entry.tag).lastIndexOf(tag);
    if (at === -1) continue;
    const entry = stack[at];
    stack.splice(at, 1);
    if (tag !== 'fallback') continue;

    const parent = [...stack].reverse().find((candidate) => candidate.tag !== 'fallback');
    if (!parent || parent.tag === 'suspense') continue;

    const aliasMatch = entry.attrs.match(/\bas\s*=\s*"([^"]*)"/);
    const alias = aliasMatch ? aliasMatch[1].trim() : 'error';
    const names = [];
    if (parent.tag === 'deadlock') names.push('name');
    if (/^[A-Za-z_$][\w$]*$/.test(alias)) names.push(alias);

    scopes.push({ start: entry.bodyStart, end: match.index, names });
  }

  return scopes;
}

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
function isJavaScriptModule(template) {
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
 * Refuses a bound inline event handler, and warns on a static one.
 *
 * An `on*` attribute on an HTML element runs its value as JavaScript. Bound to
 * an interpolation (`onclick="{{ handler }}"`), that executes application state
 * as code, so it is a build error (AVX_C28) with the `@event` form as the
 * fix. Written as a literal (`onclick="doThing()"`), it is the developer's own
 * code -- kept, but warned (AVX_W52), because it bypasses the event system and
 * a strict CSP.
 *
 * Only lowercase HTML element tags are checked. An `on*` attribute on a
 * PascalCase component tag is a prop passed to the child, never set as a DOM
 * handler, so it is left alone.
 * @param {string} template - The semantic template (component tags intact).
 * @param {string} content - The component source, for locations.
 * @param {string} filePath - The component path.
 * @param {string} name - The component class name.
 * @param {object} [options] - Parser state the check reads.
 * @param {object|null} [options.config] - The parser's explicit project configuration. When
 *   absent, the configuration is resolved from `filePath`.
 * @throws {TemplateValidationError} AVX_C28 for a bound handler.
 */
export function validateEventHandlerAttributes(
  template,
  content,
  filePath,
  name,
  { config: parserConfig = null } = {},
) {
  if (typeof template !== 'string' || !/\bon/i.test(template)) return;
  const config = parserConfig || (filePath ? loadAvenxConfig(path.dirname(filePath)) : null);
  for (const token of tokenizeMarkup(template)) {
    if (token.type !== 'open' || token.unterminated || token.directive) continue;
    // A component reference is PascalCase; its attributes are props.
    if (/^[A-Z]/.test(token.name)) continue;
    for (const attr of token.attrs) {
      if (!isEventHandlerAttribute(attr.name)) continue;
      const value = attr.value || '';
      const eventName = attr.name.toLowerCase().slice(2);
      const snippet = template.slice(token.start, Math.min(token.end, token.start + 100)).split('\n')[0];
      if (value.includes('{{') || value.includes('{%')) {
        const error = new TemplateValidationError(
          AvenxErrorCodes.COMPILER_BOUND_EVENT_ATTRIBUTE,
          name,
          attr.name,
          snippet,
          eventName,
        );
        error.setLocation(frontEndLocation(content, template, attr.start, `${attr.name}=`, filePath));
        throw error;
      }
      const warning = new TemplateValidationError(
        AvenxErrorCodes.COMPILER_INLINE_EVENT_ATTRIBUTE,
        name,
        attr.name,
        eventName,
        filePath ? path.basename(filePath) : 'this component',
      );
      warning.setLocation(frontEndLocation(content, template, attr.start, `${attr.name}=`, filePath));
      reportWarning(AvenxErrorCodes.COMPILER_INLINE_EVENT_ATTRIBUTE, warning, config);
    }
  }
}

/**
 * Refuses a dynamic attribute binding whose slots are written as
 * interpolations.
 *
 * Both slots of `:[name]="value"` are expressions -- that is what the API
 * reference documents, and it is how the string renderer resolves them. Write
 * either one as `{{ ... }}` and the braces become part of the expression:
 * `{{ v }}` is not valid JavaScript, so it resolves to nothing.
 *
 * The two halves failed differently and neither failed usefully. A braced
 * name surfaced only as a production expression error (AVX_C27, "Expected a
 * property name"), which names the symptom rather than the construct. A
 * braced value did not fail at all: the name still resolved, so the element
 * was tagged `data-ax-dyn-attrs` -- claiming the attribute was being managed
 * -- while the attribute itself was never set, in development and production
 * alike, with nothing reported.
 *
 * Refused here so both halves say the same thing, at build time, and name the
 * unbraced form as the fix. Nothing that worked before stops working: the
 * construct has never produced an attribute.
 * @param {string} template - The semantic template.
 * @param {string} content - The component source, for locations.
 * @param {string} filePath - The component path.
 * @param {string} name - The component class name.
 * @throws {TemplateValidationError} AVX_C29 for an interpolated slot.
 */
export function validateDynamicAttributeBindings(template, content, filePath, name) {
  if (typeof template !== 'string' || !template.includes(':[')) return;

  for (const token of tokenizeMarkup(template)) {
    if (token.type !== 'open' || token.unterminated || token.directive) continue;
    for (const attr of token.attrs) {
      if (!attr.name.startsWith(':[') || !attr.name.endsWith(']')) continue;

      const nameExpr = attr.name.slice(2, -1);
      const value = attr.value || '';
      const nameBraced = nameExpr.includes('{{') || nameExpr.includes('{%');
      const valueBraced = value.includes('{{') || value.includes('{%');
      if (!nameBraced && !valueBraced) continue;

      const snippet = template.slice(token.start, Math.min(token.end, token.start + 100)).split('\n')[0];
      const strip = (text) => text.replace(/\{\{\{?|\}\}\}?|\{%|%\}/g, '').trim();
      const error = new TemplateValidationError(
        AvenxErrorCodes.COMPILER_INTERPOLATED_DYNAMIC_ATTRIBUTE,
        name,
        nameBraced ? 'attribute name' : 'value',
        snippet,
        strip(nameExpr),
        strip(value),
      );
      error.setLocation(frontEndLocation(content, template, attr.start, attr.name, filePath));
      throw error;
    }
  }
}

/**
 * Fails the build when the template contains a tag or comment that never ends.
 *
 * Everything after an unterminated construct would be read as part of it:
 * an unclosed attribute quote swallows the rest of the template into one
 * attribute value. The tree parser has always read such input leniently, as
 * text, and emitted a program for it; the build now stops instead.
 * @param {string} template - The template, after preprocessing.
 * @param {string} content - The component source, for locations.
 * @param {string} filePath - The component path.
 * @param {string} name - The component class name.
 * @throws {TemplateValidationError} AVX_C26 when a construct is unterminated.
 */
export function assertWellFormedTemplate(template, content, filePath, name) {
  if (typeof template !== 'string' || template === '') return;
  for (const token of tokenizeMarkup(template)) {
    if (!token.unterminated || (token.type !== 'open' && token.type !== 'comment' && token.type !== 'close')) continue;
    const what =
      token.type === 'comment'
        ? 'a comment is opened with "<!--" and never closed with "-->"'
        : `the tag <${token.type === 'close' ? '/' : ''}${token.name}> is never closed with ">"`;
    const snippet = template.slice(token.start, Math.min(token.end, token.start + 80)).split('\n')[0];
    const error = new TemplateValidationError(AvenxErrorCodes.COMPILER_MALFORMED_TEMPLATE, name, what, snippet);
    error.setLocation(frontEndLocation(content, template, token.start, snippet, filePath));
    throw error;
  }
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
 * Maps a template offset back to the component file where possible.
 *
 * Declarations are removed from the source before the template is processed,
 * so a template offset is not a file offset. The tag's own text is searched
 * for in the file first; when a rewrite has already changed it, the location
 * falls back to the template itself.
 * @param {string} content - The component source.
 * @param {string} template - The template the offset refers to.
 * @param {number} offset - Offset into the template.
 * @param {string} snippet - The text at that offset.
 * @param {string} filePath - The component path.
 * @returns {{source: string, index: number, filename: string}} A location.
 */
export function frontEndLocation(content, template, offset, snippet, filePath) {
  const index = typeof content === 'string' && snippet ? content.indexOf(snippet) : -1;
  return index >= 0
    ? { source: content, index, filename: filePath }
    : { source: template, index: offset, filename: filePath };
}

/**
 * Performs compile-time validation on template expressions to ensure
 * all referenced variables and methods are declared.
 * @param {string} template - The template string, before data-ax-bind is expanded.
 * @param {object} state - The extracted state keys.
 * @param {object} computed - The extracted computed keys.
 * @param {object} methods - The extracted method keys.
 * @param {object} [resources] - The extracted resources.
 * @param {string} filePath - The component file path.
 * @param {string} [name] - The component name, used for warning messages.
 * @param {string[]} [bridgeLocals] - Local names of imported bridges, which are in template scope.
 * @param {object} [options] - Parser state the check reads.
 * @param {object|null} [options.config] - The parser's explicit project configuration. When
 *   absent, the configuration is resolved from `filePath`.
 * @param {string[]} [options.customVoidTags] - Void tags configured on the parser itself.
 * @param {Map<string, Set<string>>|null} [options.routeParams] - Route parameters by page name.
 * @param {Set<string>|null} [options.componentNames] - Every registered component and page
 *   name; empty or absent disables the unresolved-component check.
 */
export function validateTemplate(
  template,
  state,
  computed,
  methods,
  resources,
  filePath,
  name,
  bridgeLocals = [],
  { config: parserConfig = null, customVoidTags = [], routeParams = null, componentNames = null } = {},
) {
  const config = parserConfig || (filePath ? loadAvenxConfig(path.dirname(filePath)) : null);
  if (!template || template.trim() === '') {
    reportWarning(
      AvenxErrorCodes.COMPILER_EMPTY_TEMPLATE,
      new TemplateValidationError(AvenxErrorCodes.COMPILER_EMPTY_TEMPLATE, name),
      config,
    );
  } else if (isJavaScriptModule(template)) {
    const targetFile = filePath || (name ? `${name}.component.js` : 'Component');
    reportWarning(
      AvenxErrorCodes.COMPILER_JS_MODULE_AS_TEMPLATE,
      new TemplateValidationError(AvenxErrorCodes.COMPILER_JS_MODULE_AS_TEMPLATE, targetFile),
      config,
    );
    return;
  }

  const declared = new Set([
    ...Object.keys(state),
    ...Object.keys(computed),
    ...Object.keys(methods),
    ...Object.keys(resources || {}),
    ...bridgeLocals,
    // Names a plugin puts into every component's scope through app.mixin().
    // The compiler cannot see a runtime installation, so the project declares
    // them once in avenx.config.json — `@avenx/i18n`, for instance, publishes
    // t, tHtml, n, d, rel, locale and $i18n.
    ...((config && config.templateGlobals) || []),
    // Route parameters the router will assign into this page's state, and
    // `query` for any routed page. Empty for a component, and for a page no
    // route names.
    ...((routeParams && routeParams.get(name)) || []),
  ]);

  // Loop bindings. The header is read with the same parser the IR uses, so
  // the validator and the compiler agree about what a loop declares -- a
  // regex here disagreed with the IR about `[a, b] in pairs` and about any
  // list expression containing a `>`.
  for (const node of parseHTML(template, [...(customVoidTags || []), ...getCustomVoidTags(filePath)])) {
    collectLoopBindings(node, declared);
  }

  const slotPropsRegex = /data-slot-props="([^"]*)"/gi;
  let slotPropsMatch;
  while ((slotPropsMatch = slotPropsRegex.exec(template)) !== null) {
    declared.add(slotPropsMatch[1].trim());
  }

  reportUnterminatedInterpolations(template, filePath, name, config);

  const events = collectTemplateEvents(template);

  const currentLoopVars = [];
  const seenIds = new Set();
  let loopDepth = 0;
  const emptyBranchDepths = [];

  const filename = path.basename(filePath);
  const fallbackScopes = collectFallbackScopes(template);

  const fallbackNamesAt = (position) =>
    fallbackScopes.filter((scope) => position >= scope.start && position < scope.end).flatMap((scope) => scope.names);

  const checkIdentifiers = (expr, eventIndex = -1) => {
    const ids = extractRootIdentifiers(expr);
    const fallbackNames = fallbackNamesAt(eventIndex);

    for (const id of ids) {
      if (EXCLUDED_IDENTIFIERS.has(id)) {
        continue;
      }

      if (fallbackNames.includes(id)) {
        continue;
      }

      if (currentLoopVars.includes(id)) {
        continue;
      }

      if (!declared.has(id)) {
        const idx = eventIndex >= 0 ? eventIndex : template.indexOf(expr);
        const err = new TemplateValidationError(AvenxErrorCodes.COMPILER_UNDECLARED_REFERENCE, id, filename);

        if (idx >= 0) {
          err.setLocation({ source: template, index: idx, filename, length: id.length });
        }

        reportWarning(AvenxErrorCodes.COMPILER_UNDECLARED_REFERENCE, err, config);
      }
    }
  };

  for (const ev of events) {
    if (ev.type === 'event') {
      const modifiers = ev.name.split('.').slice(1);
      for (const modifier of modifiers) {
        if (EVENT_MODIFIERS.has(modifier)) continue;
        const closest = getClosestKey(modifier, [...EVENT_MODIFIERS]);
        const suggestion = closest ? ` Did you mean ".${closest}"?` : '';
        const err = new TemplateValidationError(
          AvenxErrorCodes.COMPILER_UNKNOWN_EVENT_MODIFIER,
          modifier,
          ev.name,
          filename,
          suggestion,
        );
        err.setLocation({ source: template, index: ev.index, filename, length: ev.name.length + 1 });
        reportWarning(AvenxErrorCodes.COMPILER_UNKNOWN_EVENT_MODIFIER, err, config);
      }
    }
    if (ev.type === 'loop_start') {
      checkIdentifiers(ev.list, ev.index);
      currentLoopVars.push(ev.item);
      loopDepth++;
    } else if (ev.type === 'loop_end') {
      currentLoopVars.pop();
      loopDepth = Math.max(0, loopDepth - 1);
    } else if (ev.type === 'empty_start') {
      emptyBranchDepths.push(loopDepth);
    } else if (ev.type === 'empty_end') {
      emptyBranchDepths.pop();
    } else if (ev.type === 'id_attribute') {
      // An id in a loop's <@empty> branch renders at most once, so it only
      // counts as repeated when it sits in the loop body itself.
      const inEmptyBranch =
        emptyBranchDepths.length > 0 && emptyBranchDepths[emptyBranchDepths.length - 1] === loopDepth;
      const inLoopBody = loopDepth > 0 && !inEmptyBranch;
      if (seenIds.has(ev.idValue) || inLoopBody) {
        const idx = ev.index >= 0 ? ev.index : template.indexOf(`id="${ev.idValue}"`);
        const err = new TemplateValidationError(
          AvenxErrorCodes.COMPILER_DUPLICATE_ID_ATTRIBUTE,
          ev.idValue,
          name || filename,
        );
        if (idx >= 0) {
          err.setLocation({ source: template, index: idx, filename });
        }
        reportWarning(AvenxErrorCodes.COMPILER_DUPLICATE_ID_ATTRIBUTE, err, config);
      }
      seenIds.add(ev.idValue);
    } else if (
      ev.type === 'interpolation' ||
      ev.type === 'event' ||
      ev.type === 'directive' ||
      ev.type === 'condition'
    ) {
      // 'condition' is the <@if>/<@elseif> header. It was never collected, so
      // a typo in a condition compiled silently and failed in the browser.
      checkIdentifiers(ev.expr, ev.index);
    }
  }

  validateComponentTags(template, filePath, name, config, { componentNames, customVoidTags });
  validateAccessibility(template, filePath, name, config);
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
    err.setLocation({ source: template, index, filename });
    reportWarning(AvenxErrorCodes.COMPILER_UNTERMINATED_INTERPOLATION, err, config);
  }
}

/**
 * Reports PascalCase template tags that resolve to no registered component,
 * built-in tag, or known HTML/SVG element (AVX_W46).
 *
 * A misspelled or unimported component name is the most common template
 * mistake and, unlike an undeclared identifier, it currently escapes every
 * compile-time check — it surfaces only at runtime as AVX_R03 (or AVX_W13
 * inside a page). This walks the parsed node tree the other passes use, so no
 * new parse is added, and reports each unresolved tag with the file, the
 * line, the tag and the closest registered name when one is near enough.
 *
 * It is a warning, not an error: a component may legitimately be registered
 * at runtime through `app.register()`, which the compiler cannot see. The
 * check is skipped entirely when the registry is empty (a component parsed
 * standalone), so it never fires on a project the compiler did not scan whole.
 * @param {string} template - The processed template HTML.
 * @param {string} filePath - Absolute path of the file being compiled.
 * @param {string} name - The component/page name, for the diagnostic.
 * @param {object|null} config - Resolved project configuration.
 * @param {object} [options] - Parser state the check reads.
 * @param {Set<string>|null} [options.componentNames] - Every registered component and page name.
 * @param {string[]} [options.customVoidTags] - Void tags configured on the parser itself.
 * @returns {void}
 */
export function validateComponentTags(
  template,
  filePath,
  name,
  config,
  { componentNames = null, customVoidTags: parserVoidTags = [] } = {},
) {
  if (!componentNames || componentNames.size === 0) {
    return;
  }
  if (!template || template.trim() === '') {
    return;
  }

  const filename = filePath ? path.basename(filePath) : name || 'template';

  // The project's void tags share the identifier check's escape hatch: a tag
  // the project has declared as its own element is never reported as an
  // unresolved component, whatever its casing.
  const customVoidTags = [...(parserVoidTags || []), ...getCustomVoidTags(filePath)];
  const voidTagSet = new Set(customVoidTags.map((t) => String(t).toLowerCase()));

  let nodes;
  try {
    nodes = parseHTML(template, customVoidTags);
  } catch {
    // A template that will not even parse is a different problem, reported by
    // the passes that transform it. This check simply steps aside.
    return;
  }

  const isPascalCase = (tag) => /^[A-Z][A-Za-z0-9]*$/.test(tag);

  const walk = (list) => {
    for (const node of list) {
      if (node && node.type === 'element' && typeof node.tagName === 'string') {
        const tag = node.tagName;

        // A dash marks a Web Component custom element; the framework never
        // owns it, so it is never flagged (matches the identifier check's
        // escape hatch).
        const isCustomElement = tag.includes('-');
        // `<Component is="...">` is the dynamic-component built-in.
        const isDynamic = tag === 'Component';

        if (
          isPascalCase(tag) &&
          !isCustomElement &&
          !isDynamic &&
          !tag.startsWith('@') &&
          !BUILTIN_TAGS.has(tag.toLowerCase()) &&
          !BUILTIN_COMPONENTS.has(tag) &&
          !KNOWN_ELEMENTS.has(tag.toLowerCase()) &&
          !voidTagSet.has(tag.toLowerCase()) &&
          !componentNames.has(tag)
        ) {
          const suggestion = getClosestKey(tag, [...componentNames]);
          const hint = suggestion ? `\n\nDid you mean "<${suggestion}>"?` : '';
          const err = new TemplateValidationError(
            AvenxErrorCodes.COMPILER_UNRESOLVED_COMPONENT_REFERENCE,
            tag,
            filename,
            hint,
          );
          if (node.line) {
            err.setLocation({
              source: template,
              line: node.line,
              column: node.column || 1,
              filename,
              length: tag.length,
            });
          }
          reportWarning(AvenxErrorCodes.COMPILER_UNRESOLVED_COMPONENT_REFERENCE, err, config);
        }
      }

      if (node && Array.isArray(node.children) && node.children.length > 0) {
        walk(node.children);
      }
    }
  };

  walk(nodes);
}

/**
 * Validates template against static accessibility rules (AVX_W65 - AVX_W70).
 * @param {string} template - Authored template string.
 * @param {string} filePath - Path to component file.
 * @param {string} name - Component name.
 * @param {object} [config] - Application configuration.
 */
export function validateAccessibility(template, filePath, name, config) {
  if (!template || template.trim() === '') {
    return;
  }
  const resolvedConfig = config || (filePath ? loadConfig(path.dirname(filePath)) : null);
  runAccessibilityRules(template, filePath, name, resolvedConfig, template);
}

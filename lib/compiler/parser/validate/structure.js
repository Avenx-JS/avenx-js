/**
 * @file structure.js
 * @description Template structure, reconciliation marker, and component tag validation.
 */
import path from 'path';
import { getClosestKey } from '../../../config.js';
import { AvenxErrorCodes } from '../../../core/runtime/AvenxError.js';
import { tokenizeMarkup } from '../../../core/utils/markupLexer.js';
import { TemplateValidationError } from '../../errors/index.js';
import { BUILTIN_COMPONENTS } from '../../builtinComponents.js';
import { reportWarning } from '../../utils/warningReporter.js';
import { loadAvenxConfig, getCustomVoidTags } from '../projectConfig.js';
import { parseHTML } from '../htmlTree.js';
import { frontEndLocation } from './locations.js';

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
  'provide',
  'inject',
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
 * Warns about compiler-owned reconciliation attributes in authored markup.
 * Runs before directive lowering and static subtree marking.
 * @param {string} template - Authored markup.
 * @param {string} content - Original component source.
 * @param {string} filePath - Source file path.
 * @param {string} name - Component name.
 * @param {object} [options] - Parser options.
 * @param {object|null} [options.config] - Warning configuration.
 */
export function validateReconciliationMarkers(template, content, filePath, name, { config = null } = {}) {
  const remedies = {
    'data-ax-static': 'Remove it; the compiler identifies and marks static subtrees automatically.',
    'data-ax-key': 'Use the key expression on <@for> instead; the compiler writes the reconciliation key.',
    'data-ax-skip': 'Remove it; update skipping is managed by the compiler and renderer.',
  };
  const settings = config || (filePath ? loadAvenxConfig(path.dirname(filePath)) : null);
  for (const token of tokenizeMarkup(template)) {
    if (token.type !== 'open' || token.unterminated || token.directive) continue;
    for (const attr of token.attrs) {
      const marker = attr.name.toLowerCase();
      if (!Object.hasOwn(remedies, marker)) continue;
      const warning = new TemplateValidationError(
        AvenxErrorCodes.COMPILER_RECONCILIATION_MARKER,
        name,
        attr.name,
        token.name,
        remedies[marker],
      );
      warning.setLocation(frontEndLocation(content, template, attr.start, attr.name, filePath));
      reportWarning(AvenxErrorCodes.COMPILER_RECONCILIATION_MARKER, warning, settings);
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
              filename: filePath || filename,
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


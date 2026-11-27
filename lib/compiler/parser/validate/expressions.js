/**
 * @file expressions.js
 * @description Template expression and identifier validation.
 */
import path from 'path';
import { getClosestKey } from '../../../config.js';
import { AvenxErrorCodes } from '../../../core/runtime/AvenxError.js';
import { EVENT_MODIFIERS } from '../../../core/events/modifiers.js';
import { getLineAndColumn } from '../../../core/utils/codeFrame.js';
import { TemplateValidationError } from '../../errors/index.js';
import { readDeclarations } from '../../expressionParser.js';
import { parseForHeader } from '../../ir/build.js';
import { collectTemplateEvents } from '../../templateEvents.js';
import { reportWarning } from '../../utils/warningReporter.js';
import { parseHTML, scanTagEnd } from '../htmlTree.js';
import { loadAvenxConfig, getCustomVoidTags } from '../projectConfig.js';
import { EXCLUDED_IDENTIFIERS, extractRootIdentifiers } from '../identifiers.js';
import { locateTemplateIdentifier } from './locations.js';
import { isJavaScriptModule, reportUnterminatedInterpolations } from './frontEnd.js';
import { validateComponentTags } from './structure.js';
import { formatDollarMemberSuggestion } from './dollarMembers.js';
import { validateAccessibility } from '../../rules/accessibility.js';

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
 * @param {string|null} [options.content] - Original component source for precise locations.
 * @param {string[]|Object<string, string>|null} [options.inject] - Injected declarations.
 * @param {string[]|null} [options.injectedKeys] - Explicit injected local key names.
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
  {
    config: parserConfig = null,
    customVoidTags = [],
    routeParams = null,
    componentNames = null,
    content = null,
    inject = null,
    injectedKeys = null,
  } = {},
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

  let resolvedInjected = [];
  if (Array.isArray(injectedKeys)) {
    resolvedInjected = injectedKeys;
  } else if (Array.isArray(inject)) {
    resolvedInjected = inject;
  } else if (inject && typeof inject === 'object') {
    resolvedInjected = Object.keys(inject);
  } else if (typeof content === 'string') {
    const decls = readDeclarations(content);
    if (Array.isArray(decls.inject)) {
      resolvedInjected = decls.inject;
    } else if (decls.inject && typeof decls.inject === 'object') {
      resolvedInjected = Object.keys(decls.inject);
    }
  }

  const declared = new Set([
    ...Object.keys(state),
    ...Object.keys(computed),
    ...Object.keys(methods),
    ...Object.keys(resources || {}),
    ...bridgeLocals,
    ...resolvedInjected,
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

  const filename = filePath ? path.basename(filePath) : name || 'Component';
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
        if (id.startsWith('$')) {
          const suggestion = formatDollarMemberSuggestion(id);
          const loc = locateTemplateIdentifier(content, template, eventIndex, expr, id, filePath);
          const pos = getLineAndColumn(loc.source, loc.index);
          const templateContext = filename ? `template of ${filename}` : 'template';
          const err = new TemplateValidationError(
            AvenxErrorCodes.COMPILER_BARE_DOLLAR_MEMBER,
            id,
            templateContext,
            pos.line,
            suggestion,
          );

          if (loc.index >= 0) {
            err.setLocation({ source: loc.source, index: loc.index, filename: loc.filename, length: id.length });
          }

          reportWarning(AvenxErrorCodes.COMPILER_BARE_DOLLAR_MEMBER, err, config);
          continue;
        }

        const idx = eventIndex >= 0 ? eventIndex : template.indexOf(expr);
        const err = new TemplateValidationError(AvenxErrorCodes.COMPILER_UNDECLARED_REFERENCE, id, filename);

        if (idx >= 0) {
          err.setLocation({ source: template, index: idx, filename: filePath || filename, length: id.length });
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
        err.setLocation({
          source: template,
          index: ev.index,
          filename: filePath || filename,
          length: ev.name.length + 1,
        });
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
          err.setLocation({ source: template, index: idx, filename: filePath || filename });
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


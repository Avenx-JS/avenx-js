/**
 * Retains media wrapper lines and their source mapping.
 * @param {string} selector - At-rule header.
 * @param {string} body - Nested CSS.
 * @param {number} originalLine - Header line.
 * @param {number} bodyStartLine - Body line.
 * @param {Function} scopeRulesFn - Nested-rule processor.
 * @returns {object[]} The result.
 */
export function processMediaQueries(selector, body, originalLine, bodyStartLine, scopeRulesFn) {
  const rules = [];
  rules.push({ cssLine: `${selector} {`, sourceLine: originalLine });
  const scopedBodyRules = scopeRulesFn(body, bodyStartLine);
  scopedBodyRules.forEach((r) => {
    rules.push({ cssLine: r.cssLine, sourceLine: r.sourceLine !== null ? r.sourceLine : originalLine });
  });
  rules.push({ cssLine: `}`, sourceLine: originalLine });
  return rules;
}

/**
 * Walks nested and passthrough at-rules while preserving emitted lines.
 * @param {string} content - CSS after variable and keyframe processing.
 * @param {number} startLine - First source line.
 * @param {string} hash - Scope class for base properties.
 * @param {Function} scopeSelector - Selector rewriting callback.
 * @param {Function} processMedia - Media processing callback.
 * @returns {object[]} The result.
 */
export function scopeAtRules(content, startLine, hash, scopeSelector, processMedia) {
  const scopeRules = (content, currentBaseLine) => {
    const rules = [];
    let current = '';
    let depth = 0;
    let inString = null;
    let currentLineOffset = 0;
    let ruleStartLineOffset = null;

    const processPart = (part, originalLineOffset) => {
      const rule = part.trim();
      if (!rule) return;

      const lineOffset = originalLineOffset !== null ? originalLineOffset : currentLineOffset;
      const originalLine = currentBaseLine + lineOffset;

      if (rule.includes('{')) {
        // It has a body block (nested rule or at-rule)
        const openBraceIdx = rule.indexOf('{');
        const closeBraceIdx = rule.lastIndexOf('}');
        if (openBraceIdx !== -1 && closeBraceIdx !== -1) {
          let selector = rule.substring(0, openBraceIdx).trim();
          const body = rule.substring(openBraceIdx + 1, closeBraceIdx).trim();

          if (selector.startsWith('@')) {
            // Check if it's a nesting at-rule (like @media, @supports, @container, or @document)
            if (selector.startsWith('@media')) {
              const openBraceIdxInPart = part.indexOf('{');
              const headerLines = part.substring(0, openBraceIdxInPart + 1).split('\n').length - 1;
              const bodyStartLine = originalLine + headerLines;

              const mediaRules = processMedia(selector, body, originalLine, bodyStartLine, scopeRules);
              mediaRules.forEach((r) => rules.push(r));
            } else if (
              selector.startsWith('@supports') ||
              selector.startsWith('@document') ||
              selector.startsWith('@container')
            ) {
              const openBraceIdxInPart = part.indexOf('{');
              const headerLines = part.substring(0, openBraceIdxInPart + 1).split('\n').length - 1;
              const bodyStartLine = originalLine + headerLines;

              // Recursively process the rules inside
              const scopedBodyRules = scopeRules(body, bodyStartLine);
              rules.push({ cssLine: `${selector} {`, sourceLine: originalLine });
              scopedBodyRules.forEach((r) => {
                rules.push({ cssLine: r.cssLine, sourceLine: r.sourceLine !== null ? r.sourceLine : originalLine });
              });
              rules.push({ cssLine: `}`, sourceLine: originalLine });
            } else {
              // Non-nesting at-rule (like @keyframes, @font-face) - keep body unchanged
              rules.push({ cssLine: `${selector} {`, sourceLine: originalLine });
              body.split('\n').forEach((line, idx) => {
                rules.push({ cssLine: line, sourceLine: originalLine + idx });
              });
              rules.push({ cssLine: `}`, sourceLine: originalLine });
            }
          } else {
            // Regular selector rule
            selector = scopeSelector(selector);
            rules.push({ cssLine: `${selector} { ${body} }`, sourceLine: originalLine });
          }
        }
      } else {
        // It's one or more base properties (e.g. "color: red; margin: 0;")
        const props = rule
          .split(';')
          .map((p) => p.trim())
          .filter((p) => p.length > 0);
        if (props.length > 0) {
          rules.push({ cssLine: `.${hash} { ${props.join('; ')}; }`, sourceLine: originalLine });
        }
      }
    };

    for (let i = 0; i < content.length; i++) {
      const char = content[i];
      if (char === '\n') {
        currentLineOffset++;
      }
      if (inString) {
        current += char;
        if (char === '\\') {
          if (i + 1 < content.length) {
            current += content[i + 1];
            if (content[i + 1] === '\n') currentLineOffset++;
            i++;
          }
        } else if (char === inString) {
          inString = null;
        }
      } else {
        current += char;
        if (ruleStartLineOffset === null && current.trim().length > 0) {
          ruleStartLineOffset = currentLineOffset;
        }

        if (char === '"' || char === "'") {
          inString = char;
        } else if (char === '{') {
          depth++;
        } else if (char === '}') {
          depth--;
        }

        if (depth === 0 && (char === ';' || char === '}')) {
          processPart(current, ruleStartLineOffset);
          current = '';
          ruleStartLineOffset = null;
        }
      }
    }

    if (current.trim()) {
      processPart(current, ruleStartLineOffset);
    }

    return rules;
  };

  return scopeRules(content, startLine);
}

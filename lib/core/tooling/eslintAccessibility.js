/**
 * @file eslintAccessibility.js
 * @description ESLint rule enforcing static accessibility lint rules in Avenx templates.
 * @module lib/core/tooling/eslintAccessibility
 */

import { findAccessibilityIssues } from '../../compiler/rules/accessibility.js';
import { extractLintableTemplate } from './componentTagNaming.js';

export const templateAccessibilityRule = {
  meta: {
    type: 'suggestion',

    docs: {
      description:
        'Enforce static accessibility lint rules in Avenx SFC templates.',
    },

    schema: [],

    messages: {
      a11yFinding: '[{{code}}] {{message}}',
      missingImgAlt: '[{{code}}] {{message}}',
      interactiveRole: '[{{code}}] {{message}}',
      missingAnchorHref: '[{{code}}] {{message}}',
      unlabelledFormControl: '[{{code}}] {{message}}',
      buttonNoAccessibleName: '[{{code}}] {{message}}',
      positiveTabindex: '[{{code}}] {{message}}',
    },
  },

  create(context) {
    const physicalFilename = context.physicalFilename || context.filename || 'Component.component.js';
    const sourceCode = context.sourceCode;

    const codeToMessageId = {
      AVX_W65: 'missingImgAlt',
      AVX_W66: 'interactiveRole',
      AVX_W67: 'missingAnchorHref',
      AVX_W68: 'unlabelledFormControl',
      AVX_W69: 'buttonNoAccessibleName',
      AVX_W70: 'positiveTabindex',
    };

    return {
      Program() {
        const source = sourceCode.getText();
        const template = extractLintableTemplate(source);
        const issues = findAccessibilityIssues(template, {
          filePath: physicalFilename,
        });

        for (const issue of issues) {
          const line = issue.line || 1;
          const column = Math.max(0, (issue.column || 1) - 1);
          const length = issue.length || 1;
          const messageId = codeToMessageId[issue.code] || 'a11yFinding';

          context.report({
            loc: {
              start: {
                line,
                column,
              },
              end: {
                line,
                column: column + length,
              },
            },
            messageId,
            data: {
              code: issue.code,
              message: issue.message,
            },
          });
        }
      },
    };
  },
};

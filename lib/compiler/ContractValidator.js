import { AvenxErrorCodes } from '../core/runtime/AvenxError.js';
import { TemplateValidationError } from './errors/TemplateValidationError.js';
import { reportWarning } from './utils/warningReporter.js';
import { IMPURE_PATTERNS, NON_DETERMINISTIC_PATTERNS } from './rewind/effects.js';

/**
 * Isolation violation patterns (accessing ambient global bridges or parent scope).
 */
const ISOLATION_VIOLATION_PATTERNS = [
  /\$bridges\b/,
  /\bthis\.\$bridges\b/,
  /\$parent\b/,
  /\bthis\.\$parent\b/,
];

/**
 * ContractValidator validates semantic guarantees declared via compiler contracts:
 * - 'static': output never changes; zero dynamic interpolations or reactive bindings.
 * - 'pure': zero observable side-effects during evaluation.
 * - 'deterministic': identical inputs yield identical output; no Math.random/Date.now.
 * - 'isolated': strict dependency boundary; depends only on props/local state, no $bridges/$parent.
 */
export class ContractValidator {
  /**
   * Validates all declared contracts on a component and its template AST.
   * @param {object[]} nodes - Root AST nodes of template.
   * @param {object} metadata - Component metadata.
   * @param {string} [metadata.name] - Component name.
   * @param {string} [metadata.filePath] - Absolute path to component file.
   * @param {Set<string>} [metadata.contracts] - Component-level contracts.
   * @param {object} [metadata.state] - State object.
   * @param {object} [metadata.computed] - Computed property expressions.
   * @param {object} [metadata.methods] - Action method bodies.
   * @param {object} [metadata.resources] - Resources.
   * @param {object} [metadata.config] - Compiler config.
   * @returns {object} Validation result { valid: boolean, errors: Error[], warnings: Error[] }
   */
  static validate(nodes, metadata = {}) {
    const errors = [];
    const warnings = [];
    const componentContracts = metadata.contracts || new Set();
    const config = metadata.config || null;
    const filePath = metadata.filePath || '';

    // 1. Component-level validation for script elements (<computed>, <action>)
    if (componentContracts.has('isolated')) {
      ContractValidator.checkIsolationInScript(metadata, errors, filePath);
    }
    if (componentContracts.has('pure')) {
      ContractValidator.checkPurityInScript(metadata, warnings, filePath, config);
    }
    if (componentContracts.has('deterministic')) {
      ContractValidator.checkDeterminismInScript(metadata, warnings, filePath, config);
    }

    // 2. Validate template AST
    const inheritedContracts = new Set(componentContracts);
    for (const node of nodes) {
      ContractValidator.validateNode(node, inheritedContracts, metadata, errors, warnings);
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
    };
  }

  /**
   * Validates script-level methods and computed properties for isolation leaks.
   * @param {object} metadata
   * @param {Error[]} errors
   * @param {string} filePath
   * @private
   */
  static checkIsolationInScript(metadata, errors, filePath) {
    const checkSource = (src, label) => {
      if (!src || typeof src !== 'string') return;
      for (const pattern of ISOLATION_VIOLATION_PATTERNS) {
        const match = src.match(pattern);
        if (match) {
          const err = new TemplateValidationError(
            AvenxErrorCodes.COMPILER_CONTRACT_ISOLATED_VIOLATION,
            metadata.name || 'Component',
            `${label} references "${match[0]}"`
          );
          if (filePath) err.filename = filePath;
          errors.push(err);
        }
      }
    };

    if (metadata.computed) {
      for (const [key, expr] of Object.entries(metadata.computed)) {
        checkSource(expr, `computed property "${key}"`);
      }
    }
    if (metadata.methods) {
      for (const [key, body] of Object.entries(metadata.methods)) {
        checkSource(body, `action method "${key}"`);
      }
    }
  }

  /**
   * Validates script-level methods and computed properties for purity violations.
   * @param {object} metadata
   * @param {Error[]} warnings
   * @param {string} filePath
   * @param {object} config
   * @private
   */
  static checkPurityInScript(metadata, warnings, filePath, config) {
    const checkSource = (src, label) => {
      if (!src || typeof src !== 'string') return;
      for (const pattern of IMPURE_PATTERNS) {
        const match = src.match(pattern);
        if (match) {
          const err = new TemplateValidationError(
            AvenxErrorCodes.COMPILER_CONTRACT_PURE_VIOLATION,
            metadata.name || 'Component',
            `${label} contains side-effect "${match[0]}"`
          );
          if (filePath) err.filename = filePath;
          warnings.push(err);
          reportWarning(AvenxErrorCodes.COMPILER_CONTRACT_PURE_VIOLATION, err, config);
        }
      }
    };

    if (metadata.computed) {
      for (const [key, expr] of Object.entries(metadata.computed)) {
        checkSource(expr, `computed property "${key}"`);
      }
    }
  }

  /**
   * Validates script-level methods and computed properties for determinism violations.
   * @param {object} metadata
   * @param {Error[]} warnings
   * @param {string} filePath
   * @param {object} config
   * @private
   */
  static checkDeterminismInScript(metadata, warnings, filePath, config) {
    const checkSource = (src, label) => {
      if (!src || typeof src !== 'string') return;
      for (const pattern of NON_DETERMINISTIC_PATTERNS) {
        const match = src.match(pattern);
        if (match) {
          const err = new TemplateValidationError(
            AvenxErrorCodes.COMPILER_CONTRACT_DETERMINISTIC_VIOLATION,
            metadata.name || 'Component',
            `${label} contains non-deterministic call "${match[0]}"`
          );
          if (filePath) err.filename = filePath;
          warnings.push(err);
          reportWarning(AvenxErrorCodes.COMPILER_CONTRACT_DETERMINISTIC_VIOLATION, err, config);
        }
      }
    };

    if (metadata.computed) {
      for (const [key, expr] of Object.entries(metadata.computed)) {
        checkSource(expr, `computed property "${key}"`);
      }
    }
  }

  /**
   * Recursively validates an AST node against active and inherited contracts.
   * @param {object} node
   * @param {Set<string>} inheritedContracts
   * @param {object} metadata
   * @param {Error[]} errors
   * @param {Error[]} warnings
   * @private
   */
  static validateNode(node, inheritedContracts, metadata, errors, warnings) {
    const activeContracts = new Set([...inheritedContracts, ...(node.contracts || [])]);
    const config = metadata.config || null;
    const filePath = metadata.filePath || '';

    // Check redundancy: if parent is static, child tagging static/pure/deterministic is redundant
    if (inheritedContracts.has('static') && node.contracts && node.contracts.size > 0) {
      for (const c of node.contracts) {
        const warn = new TemplateValidationError(
          AvenxErrorCodes.COMPILER_CONTRACT_REDUNDANT,
          c,
          `<${node.tagName}>`,
          'static'
        );
        if (filePath) warn.filename = filePath;
        warnings.push(warn);
        reportWarning(AvenxErrorCodes.COMPILER_CONTRACT_REDUNDANT, warn, config);
      }
    }

    // 1. Check 'static' contract violations
    if (activeContracts.has('static')) {
      if (node.type === 'text') {
        if (node.content.includes('{{') || node.content.includes('{%')) {
          const err = new TemplateValidationError(
            AvenxErrorCodes.COMPILER_CONTRACT_STATIC_VIOLATION,
            node.content.trim()
          );
          if (filePath) err.filename = filePath;
          errors.push(err);
        }
      } else if (node.type === 'element') {
        const lowerTag = node.tagName.toLowerCase();
        if (lowerTag === 'slot') {
          const err = new TemplateValidationError(
            AvenxErrorCodes.COMPILER_CONTRACT_STATIC_VIOLATION,
            '<slot> in static context'
          );
          if (filePath) err.filename = filePath;
          errors.push(err);
        }

        for (const [attrName, attrVal] of Object.entries(node.attrs || {})) {
          if (attrName.startsWith('@')) {
            const err = new TemplateValidationError(
              AvenxErrorCodes.COMPILER_CONTRACT_STATIC_VIOLATION,
              `event listener "${attrName}"`
            );
            if (filePath) err.filename = filePath;
            errors.push(err);
          } else if (attrName.startsWith('data-ax-bind')) {
            const err = new TemplateValidationError(
              AvenxErrorCodes.COMPILER_CONTRACT_STATIC_VIOLATION,
              `two-way binding "${attrName}"`
            );
            if (filePath) err.filename = filePath;
            errors.push(err);
          } else if (attrName.startsWith(':[')) {
            const err = new TemplateValidationError(
              AvenxErrorCodes.COMPILER_CONTRACT_STATIC_VIOLATION,
              `dynamic attribute name "${attrName}"`
            );
            if (filePath) err.filename = filePath;
            errors.push(err);
          } else if (attrVal && (attrVal.includes('{{') || attrVal.includes('{%'))) {
            const err = new TemplateValidationError(
              AvenxErrorCodes.COMPILER_CONTRACT_STATIC_VIOLATION,
              `${attrName}="${attrVal}"`
            );
            if (filePath) err.filename = filePath;
            errors.push(err);
          }
        }
      }
    }

    // 2. Check 'isolated' contract violations in template
    if (activeContracts.has('isolated')) {
      const checkTextForIsolation = (text) => {
        if (!text) return;
        for (const pattern of ISOLATION_VIOLATION_PATTERNS) {
          const match = text.match(pattern);
          if (match) {
            const err = new TemplateValidationError(
              AvenxErrorCodes.COMPILER_CONTRACT_ISOLATED_VIOLATION,
              metadata.name || 'Component',
              `template expression contains "${match[0]}"`
            );
            if (filePath) err.filename = filePath;
            errors.push(err);
          }
        }
      };

      if (node.type === 'text') {
        checkTextForIsolation(node.content);
      } else if (node.type === 'element') {
        for (const [name, val] of Object.entries(node.attrs || {})) {
          checkTextForIsolation(name);
          checkTextForIsolation(val);
        }
      }
    }

    // 3. Check 'deterministic' contract violations in template
    if (activeContracts.has('deterministic')) {
      const checkTextForDeterminism = (text) => {
        if (!text || (!text.includes('{{') && !text.includes('{%') && !text.includes('@'))) return;
        for (const pattern of NON_DETERMINISTIC_PATTERNS) {
          const match = text.match(pattern);
          if (match) {
            const warn = new TemplateValidationError(
              AvenxErrorCodes.COMPILER_CONTRACT_DETERMINISTIC_VIOLATION,
              metadata.name || 'Component',
              `template expression contains non-deterministic "${match[0]}"`
            );
            if (filePath) warn.filename = filePath;
            warnings.push(warn);
            reportWarning(AvenxErrorCodes.COMPILER_CONTRACT_DETERMINISTIC_VIOLATION, warn, config);
          }
        }
      };

      if (node.type === 'text') {
        checkTextForDeterminism(node.content);
      } else if (node.type === 'element') {
        for (const val of Object.values(node.attrs || {})) {
          checkTextForDeterminism(val);
        }
      }
    }

    // 4. Check 'pure' contract violations in template
    if (activeContracts.has('pure')) {
      const checkTextForPurity = (text) => {
        if (!text || (!text.includes('{{') && !text.includes('{%'))) return;
        for (const pattern of IMPURE_PATTERNS) {
          const match = text.match(pattern);
          if (match) {
            const warn = new TemplateValidationError(
              AvenxErrorCodes.COMPILER_CONTRACT_PURE_VIOLATION,
              metadata.name || 'Component',
              `template expression contains side-effect "${match[0]}"`
            );
            if (filePath) warn.filename = filePath;
            warnings.push(warn);
            reportWarning(AvenxErrorCodes.COMPILER_CONTRACT_PURE_VIOLATION, warn, config);
          }
        }
      };

      if (node.type === 'text') {
        checkTextForPurity(node.content);
      } else if (node.type === 'element') {
        for (const [name, val] of Object.entries(node.attrs || {})) {
          if (!name.startsWith('@')) {
            checkTextForPurity(val);
          }
        }
      }
    }

    // Recurse children
    if (node.children && node.children.length > 0) {
      for (const child of node.children) {
        ContractValidator.validateNode(child, activeContracts, metadata, errors, warnings);
      }
    }
  }
}

export default ContractValidator;

/**
 * Structured diagnostic catalogue mapping stable error and warning codes
 * to detailed descriptions, causes, remedies, and documentation links.
 */
export {
  DIAGNOSTIC_CATALOGUE,
  buildDiagnosticCatalogue,
  getDiagnostic,
  normalizeCode,
  suggestCodes,
} from './catalogue/index.js';

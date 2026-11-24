/**
 * Renders a static component prop as expression source on either render path.
 * @param {string} value - The attribute value as written.
 * @returns {string} A typed literal or a safely quoted string expression.
 */
export function literalPropExpression(value) {
  const trimmed = String(value).trim();
  if (
    trimmed === 'true' ||
    trimmed === 'false' ||
    trimmed === 'null' ||
    (trimmed !== '' && !Number.isNaN(Number(trimmed)))
  ) {
    return trimmed;
  }
  return JSON.stringify(trimmed);
}

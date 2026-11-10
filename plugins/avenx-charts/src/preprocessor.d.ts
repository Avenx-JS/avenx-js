// Type definitions for @avenx/charts/preprocessor
// Project: Avenx-JS
// Definitions by: Avenx Team

/**
 * Parses the raw attribute string of a chart tag into a key-value map.
 *
 * Boolean attributes (`grid`, `legend`, `tooltip`) map to `"true"`; expression
 * bindings (`data={sales}`, `data="{{ sales }}"`) and plain string attributes
 * (`x="month"`) keep their source text.
 */
export function parseChartAttributes(attrStr: string): Record<string, string>;

/**
 * Template preprocessor that expands `<chart.line ... />` (also `chart:line`
 * and `chart-line`) into the placeholder element the charts plugin mounts.
 *
 * A non-string input is returned unchanged.
 */
export function chartsPreprocessor(template: string): string;
export function chartsPreprocessor<T>(template: T): T;

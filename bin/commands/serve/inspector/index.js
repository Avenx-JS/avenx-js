import fs from 'node:fs';

// Templates used cooked JavaScript strings, whose line endings are always LF.
// Normalize checkout line endings and restore the enclosing document's indent.
const readAsset = (name) => fs.readFileSync(new URL(name, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const indentAsset = (name) => readAsset(name).replace(/^(?=.)/gm, '        ');
const html = readAsset('./dashboard.html');
const css = readAsset('./dashboard.css');
const client = '        \n' + indentAsset('./client.js');

/**
 * Serialises a value for embedding inside an inline `<script>` element.
 *
 * `JSON.stringify` does not escape `<`, so a `</script>` sequence anywhere in
 * the data would terminate the script element early. The `<`/`>` escapes are
 * still valid JSON and parse back to the same characters; U+2028/U+2029 are
 * legal in JSON strings but illegal raw in a JS string literal or regex.
 * @param {*} value
 * @returns {string} Escaped JSON safe for inline `<script>` embedding.
 */
export function escapeInlineJson(value) {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

/** Renders the dashboard from assets loaded once at server startup. */
export function getInspectorHtml(cli) {
  const values = { CSS: css, CLIENT: client, CONFIG: escapeInlineJson(cli.config) };
  // One pass and a callback: config can itself contain marker text or '$&'.
  return html.replace(/{{AVENX_(CSS|CLIENT|CONFIG)}}/g, (_, name) => values[name]);
}

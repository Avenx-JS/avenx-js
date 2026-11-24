import { CONFIG_ENUMS, CONFIG_SCHEMA } from './config.js';
import { LogLevels } from './core/runtime/AvenxLogger.js';

// Anchored: an enum or port may be a whole $VAR / ${VAR} reference, not text around one.
const ENV_REFERENCE = { type: 'string', pattern: '^\\$\\{?[A-Za-z_][A-Za-z0-9_]*\\}?$' };
const STRING_LIST = { type: 'array', items: { type: 'string', minLength: 1 } };

/**
 * Describe a string enumeration, allowing the loader's environment interpolation.
 * @param {string[]} values - Canonical values offered by the editor.
 * @returns {object} A JSON Schema property.
 */
function enumeration(values) {
  return { anyOf: [{ enum: values }, ENV_REFERENCE] };
}

// Types and help belong here; the loader's CONFIG_SCHEMA owns every key. The
// generator refuses missing or obsolete metadata rather than silently drifting.
const FIELDS = {
  $schema: { type: 'string', description: 'Editor schema reference; ignored by the compiler.' },
  srcDir: { type: 'string', minLength: 1, default: 'src', description: 'Relative application source directory.' },
  distDir: { type: 'string', minLength: 1, default: 'dist', description: 'Relative build output directory.' },
  templatesDir: { type: 'string', minLength: 1, default: '.avenxtemplates', description: 'Relative directory for scaffold overrides.' },
  'scaffold.test': { type: 'boolean', default: false, description: 'Generate colocated component tests unless --no-test is supplied.' },
  'scaffold.style': { type: 'boolean', default: true, description: 'Generate component and page stylesheets unless --no-style is supplied.' },
  'scaffold.template': { type: ['string', 'null'], default: null, description: 'Default custom scaffold template; --template takes precedence.' },
  mode: { ...enumeration(['production', 'development']), default: 'production', description: 'Build mode; command-line mode flags take precedence.' },
  outputName: { type: 'string', minLength: 1, default: 'bundle', description: 'Base filename for generated assets, without an extension.' },
  voidTags: { ...STRING_LIST, default: [], description: 'Additional self-closing element names.' },
  templateGlobals: { ...STRING_LIST, default: [], description: 'Names supplied to templates by plugins.' },
  warnings: { type: 'object', additionalProperties: enumeration(CONFIG_ENUMS.severity), description: 'Warning severity overrides, keyed by canonical diagnostic code.' },
  treeShakeComponents: { type: 'boolean', default: true, description: 'Omit unused components from the bundle.' },
  codeSplitting: { type: 'boolean', default: false, description: 'Emit separate page chunks.' },
  preprocessors: { type: 'object', description: 'Template preprocessors; functions can only be configured through the JavaScript API.' },
  alias: { type: 'object', additionalProperties: { type: 'string' }, description: 'Import prefix to target path mappings.' },
  expressionCacheCapacity: { type: 'integer', minimum: 1, default: 1000, description: 'Maximum compiled-expression cache entries.' },
  sourceMap: { type: 'boolean', description: 'Generate source maps.' },
  sourcesContent: { type: 'boolean', default: true, description: 'Include original sources in source maps.' },
  incremental: { type: 'boolean', default: false, description: 'Reuse unchanged compilation units.' },
  'server.port': { anyOf: [{ type: 'integer', minimum: 0, maximum: 65535 }, ENV_REFERENCE], default: 3000, description: 'Development server port; 0 lets the operating system choose.' },
  'server.host': { type: 'string', minLength: 1, default: 'localhost', description: 'Development server bind address.' },
  'server.https': { type: 'boolean', default: false, description: 'Serve HTTPS using server.cert and server.key.' },
  'server.cert': { type: 'string', pattern: '\\S', description: 'Development TLS certificate path, relative to the project root or absolute.' },
  'server.key': { type: 'string', pattern: '\\S', description: 'Development TLS private-key path, relative to the project root or absolute.' },
  'server.liveReload': { type: 'boolean', default: true, description: 'Watch files and reload the browser.' },
  'server.errorOverlay': { type: 'boolean', default: true, description: 'Display build diagnostics in the browser.' },
  'server.headers': { type: 'object', additionalProperties: { anyOf: [
    { type: 'string' }, { type: 'number' }, { type: 'array', items: { type: 'string' } },
  ] }, description: 'Custom development server response headers.' },
  'style.preprocessor': { ...enumeration(['none', 'sass', 'scss', 'less', 'postcss']), default: 'none', description: 'CSS preprocessor, installed separately when needed.' },
  'style.sourceMap': { type: 'boolean', description: 'Generate stylesheet source maps.' },
  'style.inlineSourceMap': { type: 'boolean', description: 'Embed stylesheet source maps.' },
  'style.dev': { type: 'boolean', description: 'Enable development stylesheet output.' },
  'debug.debugReactivity': { type: 'boolean', default: false, description: 'Log reactive dependency activity.' },
  'logging.level': { ...enumeration(Object.keys(LogLevels)), default: 'info', description: 'Minimum log severity.' },
  'logging.silent': { type: 'boolean', default: false, description: 'Suppress all logging.' },
  'hooks.prebuild': { type: 'string', description: 'Synchronous shell command run before a build.' },
  'hooks.postbuild': { type: 'string', description: 'Synchronous shell command run after a successful build.' },
  'trace.redact': { ...STRING_LIST, default: [], description: 'Property path patterns withheld from traces.' },
  'trace.maxNodes': { type: 'integer', minimum: 0, default: 0, description: 'Trace ring-buffer capacity; 0 uses the recorder default.' },
  'rewind.onConflict': { ...enumeration(CONFIG_ENUMS.onConflict), default: 'safe', description: 'Policy for conflicting state changes during rewind.' },
  'rewind.maxSnapshotItems': { type: 'integer', minimum: 1, default: 10000, description: 'Maximum snapshot collection items.' },
  'csp.strict': { type: 'boolean', default: false, description: 'Reject build output requiring unsafe-eval.' },
};

/**
 * Generate editor validation from the exact key set accepted by the loader.
 * @returns {object} A complete draft-07 JSON Schema.
 */
export function buildConfigSchema() {
  const used = new Set();
  const field = (name) => {
    if (!Object.hasOwn(FIELDS, name)) throw new Error(`Missing schema metadata for ${name}`);
    used.add(name);
    return FIELDS[name];
  };
  const properties = Object.fromEntries(CONFIG_SCHEMA.topLevel.map((name) => [name,
    CONFIG_SCHEMA[name] ? {
      type: 'object', additionalProperties: false,
      properties: Object.fromEntries(CONFIG_SCHEMA[name].map((key) => [key, field(`${name}.${key}`)])),
    } : field(name),
  ]));
  for (const name of Object.keys(FIELDS)) {
    if (!used.has(name)) throw new Error(`Obsolete schema metadata for ${name}`);
  }
  return {
    $schema: 'http://json-schema.org/draft-07/schema#',
    title: 'Avenx project configuration',
    description: 'Generated by npm run generate:config-schema from CONFIG_SCHEMA. Do not edit by hand.',
    type: 'object', additionalProperties: false, properties,
  };
}

import fs from 'fs';
import path from 'path';
import { logger } from './core/runtime/AvenxLogger.js';
import { setDebugReactivity } from './core/reactive/watcher.js';

/**
 * Find the project root directory by scanning upwards from startDir.
 * Looks for package.json or index.html.
 * @param {string} startDir
 * @returns {string}
 */
function findProjectRoot(startDir = process.cwd()) {
  let currentDir = startDir;

  while (true) {
    const packageJsonPath = path.join(currentDir, 'package.json');
    const indexHtmlPath = path.join(currentDir, 'index.html');

    if (fs.existsSync(packageJsonPath)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
        if (pkg && (pkg.name !== 'avenx-core' || process.env.NODE_ENV === 'test')) {
          return currentDir;
        }
      } catch {
        return currentDir;
      }
    } else if (fs.existsSync(indexHtmlPath)) {
      return currentDir;
    }

    const parentDir = path.dirname(currentDir);

    if (parentDir === currentDir) {
      break;
    }

    currentDir = parentDir;
  }

  return startDir;
}

/**
 * Computes the Levenshtein distance between two strings.
 * @param {string} a
 * @param {string} b
 * @returns {number}
 */
function levenshtein(a, b) {
  const tmp = [];
  let i, j;
  for (i = 0; i <= a.length; i++) {
    tmp.push([i]);
  }
  for (j = 0; j <= b.length; j++) {
    tmp[0][j] = j;
  }
  for (i = 1; i <= a.length; i++) {
    for (j = 1; j <= b.length; j++) {
      tmp[i][j] = Math.min(
        tmp[i - 1][j] + 1,
        tmp[i][j - 1] + 1,
        tmp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
    }
  }
  return tmp[a.length][b.length];
}

/**
 * Returns the closest match from allowedKeys based on Levenshtein distance,
 * if it is within a threshold.
 * @param {string} key
 * @param {string[]} allowedKeys
 * @returns {string|null}
 */
function getClosestKey(key, allowedKeys) {
  let closest = null;
  let minDistance = Infinity;
  for (const allowed of allowedKeys) {
    const dist = levenshtein(key.toLowerCase(), allowed.toLowerCase());
    if (dist < minDistance) {
      minDistance = dist;
      closest = allowed;
    }
  }
  if (minDistance <= 3) {
    return closest;
  }
  return null;
}

/**
 * The configuration keys avenx.config.json accepts.
 *
 * Exported so that every consumer validates against one list. `avenx doctor`
 * kept a second copy and drifted from this one, reporting valid options as
 * unrecognised.
 * @type {{topLevel: string[], server: string[], style: string[], debug: string[], logging: string[], hooks: string[]}}
 */
export const CONFIG_SCHEMA = {
  topLevel: [
    'srcDir',
    'distDir',
    'templatesDir',
    'mode',
    'server',
    'style',
    'debug',
    'outputName',
    'logging',
    'voidTags',
    'warnings',
    'treeShakeComponents',
    'preprocessors',
    'alias',
    'hooks',
    'trace',
    'expressionCacheCapacity',
    'sourceMap',
    'sourcesContent',
  ],
  server: ['port', 'host', 'liveReload', 'headers'],
  style: ['preprocessor', 'sourceMap', 'inlineSourceMap', 'dev'],
  debug: ['debugReactivity'],
  trace: ['redact', 'maxNodes'],
  logging: ['level', 'silent'],
  hooks: ['prebuild', 'postbuild'],
};

/**
 * Recursively traverses string values in an object/array/value and replaces
 * $VAR_NAME or ${VAR_NAME} placeholders with process.env.VAR_NAME values.
 * @param {*} val
 * @returns {*}
 */
export function interpolateEnv(val) {
  if (typeof val === 'string') {
    return val.replace(/\$\{?([A-Z0-9_]+)\}?/gi, (_, key) => (process.env[key] !== undefined ? process.env[key] : ''));
  }
  if (Array.isArray(val)) {
    return val.map(interpolateEnv);
  }
  if (val && typeof val === 'object') {
    const result = {};
    for (const [k, v] of Object.entries(val)) {
      result[k] = interpolateEnv(v);
    }
    return result;
  }
  return val;
}

/**
 * Load the Avenx configuration from avenx.config.json file.
 * @param {string} [baseDir] - The base directory of the project.
 */
function loadConfig(baseDir) {
  const defaults = {
    srcDir: 'src',
    distDir: 'dist',
    templatesDir: '.avenxtemplates',
    alias: {},
    hooks: {},
    expressionCacheCapacity: 1000,
    server: {
      port: 3000,
      host: 'localhost',
      liveReload: true,
      headers: {},
    },
    style: {
      preprocessor: 'none',
    },
    debug: {
      debugReactivity: false,
    },
    voidTags: [],
    warnings: {},
    preprocessors: {},
    trace: {
      redact: [],
      maxNodes: 0,
    },
  };

  const rootDir = baseDir || findProjectRoot(process.cwd());
  const configPath = path.join(rootDir, 'avenx.config.json');

  if (!fs.existsSync(configPath)) {
    setDebugReactivity(defaults.debug.debugReactivity);
    return defaults;
  }

  try {
    const userConfigRaw = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    const userConfig = interpolateEnv(userConfigRaw);

    if (userConfig && typeof userConfig === 'object' && !Array.isArray(userConfig)) {
      if (
        userConfig.server &&
        typeof userConfig.server.port === 'string' &&
        /^\d+$/.test(userConfig.server.port) &&
        typeof userConfigRaw.server?.port === 'string' &&
        userConfigRaw.server.port.includes('$')
      ) {
        userConfig.server.port = Number(userConfig.server.port);
      }
      const allowedTopLevel = CONFIG_SCHEMA.topLevel;
      for (const key of Object.keys(userConfig)) {
        if (!allowedTopLevel.includes(key)) {
          const closest = getClosestKey(key, allowedTopLevel);
          const suggestion = closest ? `. Did you mean "${closest}"?` : '.';
          logger.warn(`Unknown configuration option "${key}" in avenx.config.json${suggestion} Supported top-level options are: ${allowedTopLevel.join(', ')}.`);
        } else {
          if (key === 'server' && userConfig.server && typeof userConfig.server === 'object' && !Array.isArray(userConfig.server)) {
            const allowedServerKeys = CONFIG_SCHEMA.server;
            for (const subKey of Object.keys(userConfig.server)) {
              if (!allowedServerKeys.includes(subKey)) {
                const closest = getClosestKey(subKey, allowedServerKeys);
                const suggestion = closest ? `. Did you mean "server.${closest}"?` : '.';
                logger.warn(`Unknown configuration option "server.${subKey}" in avenx.config.json${suggestion} Supported options for "server" are: ${allowedServerKeys.join(', ')}.`);
              }
            }
          }
          if (key === 'style' && userConfig.style && typeof userConfig.style === 'object' && !Array.isArray(userConfig.style)) {
            const allowedStyleKeys = CONFIG_SCHEMA.style;
            for (const subKey of Object.keys(userConfig.style)) {
              if (!allowedStyleKeys.includes(subKey)) {
                const closest = getClosestKey(subKey, allowedStyleKeys);
                const suggestion = closest ? `. Did you mean "style.${closest}"?` : '.';
                logger.warn(`Unknown configuration option "style.${subKey}" in avenx.config.json${suggestion} Supported options for "style" are: ${allowedStyleKeys.join(', ')}.`);
              }
            }
          }
          if (key === 'trace' && userConfig.trace && typeof userConfig.trace === 'object' && !Array.isArray(userConfig.trace)) {
            const allowedTraceKeys = CONFIG_SCHEMA.trace;
            for (const subKey of Object.keys(userConfig.trace)) {
              if (!allowedTraceKeys.includes(subKey)) {
                const closest = getClosestKey(subKey, allowedTraceKeys);
                const suggestion = closest ? `. Did you mean "trace.${closest}"?` : '.';
                logger.warn(`Unknown configuration option "trace.${subKey}" in avenx.config.json${suggestion} Supported options for "trace" are: ${allowedTraceKeys.join(', ')}.`);
              }
            }
            if (userConfig.trace.redact !== undefined && !Array.isArray(userConfig.trace.redact)) {
              logger.warn('Configuration option "trace.redact" must be an array of property-path patterns. Ignoring it.');
              delete userConfig.trace.redact;
            }
          }
          if (key === 'debug' && userConfig.debug && typeof userConfig.debug === 'object' && !Array.isArray(userConfig.debug)) {
            const allowedDebugKeys = CONFIG_SCHEMA.debug;
            for (const subKey of Object.keys(userConfig.debug)) {
              if (!allowedDebugKeys.includes(subKey)) {
                const closest = getClosestKey(subKey, allowedDebugKeys);
                const suggestion = closest ? `. Did you mean "debug.${closest}"?` : '.';
                logger.warn(`Unknown configuration option "debug.${subKey}" in avenx.config.json${suggestion} Supported options for "debug" are: ${allowedDebugKeys.join(', ')}.`);
              }
            }
          }
          if (key === 'logging' && userConfig.logging && typeof userConfig.logging === 'object' && !Array.isArray(userConfig.logging)) {
            const allowedLoggingKeys = CONFIG_SCHEMA.logging;
            for (const subKey of Object.keys(userConfig.logging)) {
              if (!allowedLoggingKeys.includes(subKey)) {
                const closest = getClosestKey(subKey, allowedLoggingKeys);
                const suggestion = closest ? `. Did you mean "logging.${closest}"?` : '.';
                logger.warn(`Unknown configuration option "logging.${subKey}" in avenx.config.json${suggestion} Supported options for "logging" are: ${allowedLoggingKeys.join(', ')}.`);
              }
            }
          }
          if (key === 'hooks' && userConfig.hooks && typeof userConfig.hooks === 'object' && !Array.isArray(userConfig.hooks)) {
            const allowedHooksKeys = CONFIG_SCHEMA.hooks;
            for (const subKey of Object.keys(userConfig.hooks)) {
              if (!allowedHooksKeys.includes(subKey)) {
                const closest = getClosestKey(subKey, allowedHooksKeys);
                const suggestion = closest ? `. Did you mean "hooks.${closest}"?` : '.';
                logger.warn(`Unknown configuration option "hooks.${subKey}" in avenx.config.json${suggestion} Supported options for "hooks" are: ${allowedHooksKeys.join(', ')}.`);
              }
            }
          }
        }
      }
    }

    if (userConfig.warnings !== undefined) {
      if (typeof userConfig.warnings !== 'object' || userConfig.warnings === null || Array.isArray(userConfig.warnings)) {
        throw new Error('warnings must be an object');
      }
    }

    if (userConfig.alias !== undefined) {
      if (typeof userConfig.alias !== 'object' || userConfig.alias === null || Array.isArray(userConfig.alias)) {
        throw new Error('alias must be an object');
      }
    }

    if (userConfig.hooks !== undefined) {
      if (typeof userConfig.hooks !== 'object' || userConfig.hooks === null || Array.isArray(userConfig.hooks)) {
        throw new Error('hooks must be an object');
      }
      if (userConfig.hooks.prebuild !== undefined && typeof userConfig.hooks.prebuild !== 'string') {
        throw new Error('hooks.prebuild must be a string');
      }
      if (userConfig.hooks.postbuild !== undefined && typeof userConfig.hooks.postbuild !== 'string') {
        throw new Error('hooks.postbuild must be a string');
      }
    }

    if (userConfig.preprocessors !== undefined) {
      if (
        (typeof userConfig.preprocessors !== 'object' || userConfig.preprocessors === null || Array.isArray(userConfig.preprocessors)) &&
        typeof userConfig.preprocessors !== 'function'
      ) {
        throw new Error('preprocessors must be an object or function');
      }
    }

    let preprocessors = defaults.preprocessors;
    if (typeof userConfig.preprocessors === 'function') {
      preprocessors = userConfig.preprocessors;
    } else if (userConfig.preprocessors) {
      preprocessors = { ...defaults.preprocessors, ...userConfig.preprocessors };
    }

    const config = {
      ...defaults,
      ...userConfig,
      server: {
        ...defaults.server,
        ...(userConfig.server || {}),
      },
      style: {
        ...defaults.style,
        ...(userConfig.style || {}),
      },
      debug: {
        ...defaults.debug,
        ...(userConfig.debug || {}),
      },
      warnings: {
        ...defaults.warnings,
        ...(userConfig.warnings || {}),
      },
      hooks: {
        ...defaults.hooks,
        ...(userConfig.hooks || {}),
      },
      preprocessors,
    };

    if (typeof config.debug.debugReactivity !== 'boolean') {
      throw new Error('debug.debugReactivity must be a boolean');
    }

    setDebugReactivity(config.debug.debugReactivity);

    if (typeof config.srcDir !== 'string' || config.srcDir.trim() === '') {
      throw new Error('srcDir must be a non-empty string');
    }
    if (path.isAbsolute(config.srcDir)) {
      throw new Error('srcDir must be a relative path');
    }

    if (typeof config.distDir !== 'string' || config.distDir.trim() === '') {
      throw new Error('distDir must be a non-empty string');
    }
    if (path.isAbsolute(config.distDir)) {
      throw new Error('distDir must be a relative path');
    }

    if (typeof config.templatesDir !== 'string' || config.templatesDir.trim() === '') {
      throw new Error('templatesDir must be a non-empty string');
    }
    if (path.isAbsolute(config.templatesDir)) {
      throw new Error('templatesDir must be a relative path');
    }

    if (!Array.isArray(config.voidTags) || config.voidTags.some((tag) => typeof tag !== 'string' || tag.trim() === '')) {
      throw new Error('voidTags must be an array of non-empty strings');
    }

    const allowedSeverities = ['off', 'ignore', 'warn', 'warning', 'error'];
    for (const [code, severity] of Object.entries(config.warnings)) {
      if (typeof severity !== 'string') {
        throw new Error(`warnings.${code} must be a string severity ("off", "ignore", "warn", "warning", "error")`);
      }
      const normSeverity = severity.trim().toLowerCase();
      if (!allowedSeverities.includes(normSeverity)) {
        throw new Error(`Invalid severity "${severity}" for warning "${code}". Allowed values: "off", "ignore", "warn", "warning", "error"`);
      }
    }

    if (typeof config.server.port !== 'number' || config.server.port < 0 || config.server.port > 65535) {
      throw new Error('server.port must be a valid port number (0-65535)');
    }

    if (typeof config.server.host !== 'string' || config.server.host.trim() === '') {
      throw new Error('server.host must be a non-empty string');
    }

    if (typeof config.server.liveReload !== 'boolean') {
      throw new Error('server.liveReload must be a boolean');
    }

    if (
      typeof config.server.headers !== 'object' ||
      config.server.headers === null ||
      Array.isArray(config.server.headers)
    ) {
      throw new Error('server.headers must be an object');
    }
    if (
      config.expressionCacheCapacity !== undefined &&
      (typeof config.expressionCacheCapacity !== 'number' ||
        config.expressionCacheCapacity <= 0 ||
        !Number.isInteger(config.expressionCacheCapacity))
    ) {
      throw new Error('expressionCacheCapacity must be a positive integer');
    }

    return config;
  } catch (err) {
    logger.error(`Invalid avenx.config.json: ${err.message}`);
    if (process.env.NODE_ENV === 'test') {
      throw err;
    }
    process.exit(1);
  }
}

loadConfig.findProjectRoot = findProjectRoot;
loadConfig.interpolateEnv = interpolateEnv;

export default loadConfig;

/**
 * Resolves a path alias (e.g., "@/components/Header") to its absolute or root-relative path.
 * @param {string} importPath - The import string to resolve.
 * @param {object} [config] - The parsed Avenx config object.
 * @param {string} [rootDir] - The root project directory.
 * @returns {string} The resolved file path or original string if no alias matched.
 */
export function resolvePathAlias(importPath, config = {}, rootDir = process.cwd()) {
  if (!importPath || typeof importPath !== 'string') return importPath;
  const safeConfig = config || {};
  const aliases = safeConfig.alias || {};

  for (const [alias, target] of Object.entries(aliases)) {
    if (importPath === alias || importPath.startsWith(alias + '/')) {
      const relativePart = importPath.slice(alias.length);
      const targetPath = path.isAbsolute(target) ? target : path.join(rootDir, target);
      return path.normalize(path.join(targetPath, relativePart));
    }
  }

  return importPath;
}
import fs from 'fs';
import path from 'path';
import { logger } from './core/runtime/AvenxLogger.js';

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
        if (pkg && pkg.name !== 'avenx-core') {
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
 * Load the Avenx configuration from avenx.config.json file.
 * @param {string} [baseDir] - The base directory of the project.
 */
function loadConfig(baseDir) {
  const defaults = {
    srcDir: 'src',
    distDir: 'dist',
    templatesDir: '.avenxtemplates',
    server: {
      port: 3000,
      host: 'localhost',
      liveReload: true,
    },
    style: {
      preprocessor: 'none',
    },
    voidTags: [],
  };

  const rootDir = baseDir || findProjectRoot(process.cwd());
  const configPath = path.join(rootDir, 'avenx.config.json');

  if (!fs.existsSync(configPath)) {
    return defaults;
  }

  try {
    const userConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));

    if (userConfig && typeof userConfig === 'object' && !Array.isArray(userConfig)) {
      const allowedTopLevel = [
        'srcDir',
        'distDir',
        'templatesDir',
        'server',
        'style',
        'outputName',
        'logging',
        'voidTags',
      ];
      for (const key of Object.keys(userConfig)) {
        if (!allowedTopLevel.includes(key)) {
          const closest = getClosestKey(key, allowedTopLevel);
          const suggestion = closest ? `. Did you mean "${closest}"?` : '.';
          logger.warn(`Unknown configuration option "${key}" in avenx.config.json${suggestion} Supported top-level options are: ${allowedTopLevel.join(', ')}.`);
        } else {
          if (key === 'server' && userConfig.server && typeof userConfig.server === 'object' && !Array.isArray(userConfig.server)) {
            const allowedServerKeys = ['port', 'host', 'liveReload'];
            for (const subKey of Object.keys(userConfig.server)) {
              if (!allowedServerKeys.includes(subKey)) {
                const closest = getClosestKey(subKey, allowedServerKeys);
                const suggestion = closest ? `. Did you mean "server.${closest}"?` : '.';
                logger.warn(`Unknown configuration option "server.${subKey}" in avenx.config.json${suggestion} Supported options for "server" are: ${allowedServerKeys.join(', ')}.`);
              }
            }
          }
          if (key === 'style' && userConfig.style && typeof userConfig.style === 'object' && !Array.isArray(userConfig.style)) {
            const allowedStyleKeys = ['preprocessor'];
            for (const subKey of Object.keys(userConfig.style)) {
              if (!allowedStyleKeys.includes(subKey)) {
                const closest = getClosestKey(subKey, allowedStyleKeys);
                const suggestion = closest ? `. Did you mean "style.${closest}"?` : '.';
                logger.warn(`Unknown configuration option "style.${subKey}" in avenx.config.json${suggestion} Supported options for "style" are: ${allowedStyleKeys.join(', ')}.`);
              }
            }
          }
          if (key === 'logging' && userConfig.logging && typeof userConfig.logging === 'object' && !Array.isArray(userConfig.logging)) {
            const allowedLoggingKeys = ['level', 'silent'];
            for (const subKey of Object.keys(userConfig.logging)) {
              if (!allowedLoggingKeys.includes(subKey)) {
                const closest = getClosestKey(subKey, allowedLoggingKeys);
                const suggestion = closest ? `. Did you mean "logging.${closest}"?` : '.';
                logger.warn(`Unknown configuration option "logging.${subKey}" in avenx.config.json${suggestion} Supported options for "logging" are: ${allowedLoggingKeys.join(', ')}.`);
              }
            }
          }
        }
      }
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
    };

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

    if (typeof config.server.port !== 'number' || config.server.port < 0 || config.server.port > 65535) {
      throw new Error('server.port must be a valid port number (0-65535)');
    }

    if (typeof config.server.host !== 'string' || config.server.host.trim() === '') {
      throw new Error('server.host must be a non-empty string');
    }

    if (typeof config.server.liveReload !== 'boolean') {
      throw new Error('server.liveReload must be a boolean');
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

export default loadConfig;

import fs from 'fs';
import path from 'path';
import readline from 'node:readline';
import { execSync } from 'child_process';
import { red, yellow, gray } from './colors.js';

/**
 * Helper to parse input names into PascalCase and kebab-case.
 * Supports camelCase, kebab-case, snake_case, and PascalCase.
 * @param {string} inputName - The input name from CLI.
 * @returns {{capitalizedName: string, folderFileName: string}}
 */
export function parseName(inputName) {
  let processedName = inputName;
  if (inputName === inputName.toUpperCase() && inputName !== inputName.toLowerCase()) {
    processedName = inputName.toLowerCase();
  }
  const parts = processedName.split(/(?<=[a-z0-9])(?=[A-Z])|[-_]/).filter(Boolean);
  const capitalizedName = parts.map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join('');
  const folderFileName = parts.map((part) => part.toLowerCase()).join('-');
  return { capitalizedName, folderFileName };
}

/**
 * Checks if git status is clean or prompts user if there are unstaged changes.
 * @returns {boolean|Promise<boolean>}
 */
export function checkGitStatus() {
  try {
    const output = execSync('git status --porcelain', {
      encoding: 'utf8',
    });

    if (!output.trim()) {
      return true;
    }

    console.warn(yellow('⚠️ You have unstaged changes in your repository.'));

    if (!process.stdin.isTTY || !process.stdout.isTTY) {
      return true;
    }

    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    return new Promise((resolve) => {
      rl.question('Do you want to proceed? (y/N) ', (answer) => {
        rl.close();

        if (answer.trim().toLowerCase() === 'y') {
          resolve(true);
        } else {
          console.log(gray('Operation cancelled.'));
          resolve(false);
        }
      });
    });
  } catch {
    return true;
  }
}

/**
 * Prompts the user with a question on the command line.
 * @param {string} query - The question query.
 * @param {string} [defaultValue] - The default response.
 * @param {function(string): (boolean|string)} [validator] - Optional function validating input.
 * @returns {Promise<string>}
 */
export function promptQuestion(query, defaultValue, validator = null) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    const ask = () => {
      rl.question(query, (answer) => {
        let trimmed = answer.trim();
        if (trimmed === '' && defaultValue !== undefined) {
          trimmed = defaultValue;
        }
        if (validator) {
          const valid = validator(trimmed);
          if (valid === true) {
            rl.close();
            resolve(trimmed);
          } else {
            console.log(red(`❌ ${valid}`));
            ask();
          }
        } else {
          rl.close();
          resolve(trimmed);
        }
      });
    };
    ask();
  });
}

/**
 * Reads a template, checking custom template overrides in templatesDir and templates/ folder first.
 * @param {string} baseDir
 * @param {object} config
 * @param {string} frameworkDir
 * @param {string} subfolder
 * @param {string} filename
 * @param {string|null} [templateName]
 * @returns {string}
 */
export function readTemplate(baseDir, config, frameworkDir, subfolder, filename, templateName = null) {
  const dirs = [config?.templatesDir || '.avenxtemplates', 'templates'].filter(
    (dir, idx, self) => dir && self.indexOf(dir) === idx
  );

  if (templateName) {
    const ext = path.extname(filename);
    const basename = filename.replace(/\.template$/, '');

    for (const dir of dirs) {
      const candidatePaths = [
        path.join(baseDir, dir, subfolder, templateName, filename),
        path.join(baseDir, dir, subfolder, `${templateName}.${filename}`),
        path.join(baseDir, dir, subfolder, `${basename}.${templateName}.template`),
        path.join(baseDir, dir, templateName, filename),
        path.join(baseDir, dir, `${templateName}.${filename}`),
        path.join(baseDir, dir, `${templateName}.${subfolder}${ext}.template`),
        path.join(baseDir, dir, `${templateName}${ext}.template`),
      ];

      for (const candidatePath of candidatePaths) {
        if (fs.existsSync(candidatePath)) {
          return fs.readFileSync(candidatePath, 'utf-8');
        }
      }
    }
  }

  for (const dir of dirs) {
    const localStructuredPath = path.join(baseDir, dir, subfolder, filename);
    if (fs.existsSync(localStructuredPath)) {
      return fs.readFileSync(localStructuredPath, 'utf-8');
    }

    const localFlatPath = path.join(baseDir, dir, filename);
    if (fs.existsSync(localFlatPath)) {
      return fs.readFileSync(localFlatPath, 'utf-8');
    }
  }

  const globalPath = path.join(frameworkDir, 'templates', subfolder, filename);
  return fs.readFileSync(globalPath, 'utf-8');
}

/**
 * Reports a CLI error and marks the process as failed.
 * @param {string} message
 */
export function fail(message) {
  console.error(red(`❌ Error: ${message}`));
  process.exitCode = 1;
}

/**
 * Stops generation if any target path already exists.
 * @param {string} baseDir
 * @param {string} type
 * @param {string} name
 * @param {string[]} targetPaths
 * @returns {boolean}
 */
export function abortIfGeneratedPathExists(baseDir, type, name, targetPaths) {
  const existingPath = targetPaths.find((targetPath) => fs.existsSync(targetPath));
  if (!existingPath) {
    return false;
  }

  fail(
    `${type} '${name}' already exists at ${path.relative(baseDir, existingPath)}. ` +
      'Remove the existing file or choose a different name.',
  );
  return true;
}

/**
 * Cross-platform directory watcher with recursive support fallback.
 * Node 18 on Linux does not support fs.watch(dir, { recursive: true }).
 * @param {string} dirPath - Directory to watch.
 * @param {Function} callback - Event callback (eventType, filename).
 * @returns {{close: Function}|object} FSWatcher or compatible watcher object with close() method.
 */
export function watchDirectory(dirPath, callback) {
  try {
    return fs.watch(dirPath, { recursive: true }, callback);
  } catch (err) {
    if (err && err.code === 'ERR_FEATURE_UNAVAILABLE_ON_PLATFORM') {
      return createRecursiveWatcherFallback(dirPath, callback);
    }
    throw err;
  }
}

/**
 * Fallback recursive watcher for platforms/Node versions lacking native recursive watch.
 * Walks directory tree and registers individual fs.watch instances.
 * @param {string} rootPath - Root directory to watch.
 * @param {Function} callback - Event callback.
 * @returns {{close: Function}}
 */
function createRecursiveWatcherFallback(rootPath, callback) {
  const watchers = new Map();

  function scanAndWatch(currentDir) {
    if (!fs.existsSync(currentDir)) return;

    if (!watchers.has(currentDir)) {
      try {
        const watcher = fs.watch(currentDir, (eventType, filename) => {
          const relativeDir = path.relative(rootPath, currentDir);
          const relativeFile = filename
            ? (relativeDir ? path.join(relativeDir, filename) : filename).replace(/\\/g, '/')
            : (relativeDir ? relativeDir.replace(/\\/g, '/') : '');

          const fullPath = filename ? path.join(currentDir, filename) : currentDir;
          try {
            if (fs.existsSync(fullPath) && fs.statSync(fullPath).isDirectory()) {
              scanAndWatch(fullPath);
            }
          } catch {
            // Ignore stat errors on deleted / inaccessible entries
          }

          callback(eventType, relativeFile);
        });

        watchers.set(currentDir, watcher);
      } catch {
        // Ignore watch errors on transient dirs or permission errors
      }
    }

    try {
      const entries = fs.readdirSync(currentDir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory()) {
          scanAndWatch(path.join(currentDir, entry.name));
        }
      }
    } catch {
      // Ignore read errors on inaccessible dirs
    }
  }

  scanAndWatch(rootPath);

  return {
    close() {
      for (const watcher of watchers.values()) {
        try {
          watcher.close();
        } catch {
          // Ignore close errors
        }
      }
      watchers.clear();
    },
  };
}


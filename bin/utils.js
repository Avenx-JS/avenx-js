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
 * Validates that a scaffold name is a valid identifier / kebab / snake token
 * and does not attempt path traversal or corrupt JS files.
 */
export function validateComponentName(name) {
  if (!name || typeof name !== 'string') {
    return {
      valid: false,
      reason: 'Name must not be empty. Example: "my-component" or "MyComponent".'
    };
  }

  // Refuse whitespace
  if (/\s/.test(name)) {
    return {
      valid: false,
      reason: `Name "${name}" cannot contain whitespace. Example: "my-component" or "MyComponent".`
    };
  }

  // Refuse leading digits
  if (/^[0-9]/.test(name)) {
    return {
      valid: false,
      reason: `Name "${name}" cannot start with a number. Example: "my-component" or "MyComponent".`
    };
  }

  // Refuse path traversal, slashes, dots, or invalid identifier characters
  // Only allow letters, digits, dashes, and underscores, starting with an ASCII letter
  if (!/^[a-zA-Z][a-zA-Z0-9_-]*$/.test(name)) {
    return {
      valid: false,
      reason: `Name "${name}" contains invalid characters or path separators. Example: "my-component" or "MyComponent".`
    };
  }

  return { valid: true };
}

/**
 * Checks if git status is clean or prompts user if there are unstaged changes.
 *
 * Scoped to the project directory rather than to whatever the shell's working
 * directory happens to be: the guard exists to protect the files the command
 * is about to write, and those live under the project root. Reading
 * `process.cwd()` instead meant a command run from a subdirectory reported the
 * status of an unrelated enclosing repository.
 *
 * Git's own stderr is discarded. Outside a repository git writes
 * `fatal: not a git repository` to stderr, which `execSync` forwards to the
 * parent by default -- so every `avenx init` in a plain directory printed a
 * fatal-looking line above its own output while in fact succeeding.
 * @param {string} [cwd] - The project root to inspect. Defaults to the process's directory.
 * @returns {boolean|Promise<boolean>} True to proceed, false when the user declined.
 */
export function checkGitStatus(cwd = process.cwd()) {
  try {
    const output = execSync('git status --porcelain', {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
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
 * Creates a shared prompt session that buffers stdin lines between questions.
 *
 * `readline.question()` only listens for the next line while that particular
 * question is active. In a piped run, stdin can deliver several lines at once,
 * so answers after the first one can otherwise be emitted before the next
 * question starts and be lost. Keeping one interface for the whole wizard and
 * queueing its `line` events preserves every supplied answer.
 *
 * EOF also settles any pending question with `null`, so callers never wait on
 * a promise that can no longer receive input.
 * @param {NodeJS.ReadableStream} [input] - Input stream.
 * @param {NodeJS.WritableStream} [output] - Output stream.
 * @returns {{question: function(string): Promise<string|null>, close: function(): void}}
 */
export function createPromptSession(input = process.stdin, output = process.stdout) {
  const rl = readline.createInterface({ input, output });
  const queuedAnswers = [];
  const pendingQuestions = [];
  let closed = false;

  rl.on('line', (answer) => {
    const resolve = pendingQuestions.shift();
    if (resolve) {
      resolve(answer);
    } else {
      queuedAnswers.push(answer);
    }
  });

  rl.on('close', () => {
    closed = true;
    while (pendingQuestions.length > 0) {
      pendingQuestions.shift()(null);
    }
  });

  return {
    question(query) {
      output.write(query);

      if (queuedAnswers.length > 0) {
        return Promise.resolve(queuedAnswers.shift());
      }
      if (closed) {
        return Promise.resolve(null);
      }

      return new Promise((resolve) => {
        pendingQuestions.push(resolve);
      });
    },
    close() {
      if (!closed) {
        rl.close();
      }
    },
  };
}

/**
 * Prompts the user with a question on the command line.
 * @param {string} query - The question query.
 * @param {string} [defaultValue] - The default response.
 * @param {function(string): (boolean|string)} [validator] - Optional function validating input.
 * @param {{question: function(string): Promise<string|null>, close: function(): void}} [session]
 *   Shared prompt session. When omitted, this function owns a temporary session.
 * @returns {Promise<string>}
 */
export async function promptQuestion(query, defaultValue, validator = null, session = null) {
  const promptSession = session || createPromptSession();
  const ownsSession = !session;

  try {
    while (true) {
      const answer = await promptSession.question(query);
      let trimmed;

      if (answer === null) {
        if (defaultValue === undefined) {
          const promptName = query.split('\n')[0].trim();
          throw new Error(`Input ended before an answer was provided for: ${promptName}`);
        }
        trimmed = defaultValue;
      } else {
        trimmed = answer.trim();
        if (trimmed === '' && defaultValue !== undefined) {
          trimmed = defaultValue;
        }
      }

      if (!validator) {
        return trimmed;
      }

      const valid = validator(trimmed);
      if (valid === true) {
        return trimmed;
      }

      console.log(red(`❌ ${valid}`));

      // Once stdin has reached EOF there is no value a retry could consume.
      // A valid default has already returned above, so an invalid default must
      // fail instead of spinning forever.
      if (answer === null) {
        throw new Error(`Input ended while retrying: ${query.split('\n')[0].trim()}`);
      }
    }
  } finally {
    if (ownsSession) {
      promptSession.close();
    }
  }
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
    (dir, idx, self) => dir && self.indexOf(dir) === idx,
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
            : relativeDir
              ? relativeDir.replace(/\\/g, '/')
              : '';

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

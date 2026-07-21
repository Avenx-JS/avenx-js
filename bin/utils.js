import fs from 'fs';
import path from 'path';
import readline from 'node:readline';
import { execSync } from 'child_process';

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

    console.warn('⚠️ You have unstaged changes in your repository.');

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
          console.log('Operation cancelled.');
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
            console.log(`\x1b[31m❌ ${valid}\x1b[0m`);
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
 * Reads a template, checking the local .avenxtemplates/ folder first.
 * @param {string} baseDir
 * @param {object} config
 * @param {string} frameworkDir
 * @param {string} subfolder
 * @param {string} filename
 * @returns {string}
 */
export function readTemplate(baseDir, config, frameworkDir, subfolder, filename) {
  const localStructuredPath = path.join(baseDir, config.templatesDir, subfolder, filename);
  if (fs.existsSync(localStructuredPath)) {
    return fs.readFileSync(localStructuredPath, 'utf-8');
  }

  const localFlatPath = path.join(baseDir, config.templatesDir, filename);
  if (fs.existsSync(localFlatPath)) {
    return fs.readFileSync(localFlatPath, 'utf-8');
  }

  const globalPath = path.join(frameworkDir, 'templates', subfolder, filename);
  return fs.readFileSync(globalPath, 'utf-8');
}

/**
 * Reports a CLI error and marks the process as failed.
 * @param {string} message
 */
export function fail(message) {
  console.error(`\x1b[31m❌ Error: ${message}\x1b[0m`);
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

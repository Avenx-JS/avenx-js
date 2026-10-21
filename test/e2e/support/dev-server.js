/**
 * Playwright fixture for running the real `avenx serve` command.
 *
 * Each test gets a private copy of the components fixture in a temporary
 * directory. The checked-in fixture is therefore never modified by an E2E
 * test.
 * @module test/e2e/support/dev-server
 */

import { test as base, expect } from '@playwright/test';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import net from 'net';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../../..');
const sourceFixture = path.join(repoRoot, 'test/e2e/apps/components');
const avenxCli = path.join(repoRoot, 'bin/avenx.js');

/**
 * Finds an unused TCP port.
 * @returns {Promise<number>} A free port.
 */
async function findFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();

    server.once('error', reject);

    server.listen(0, '127.0.0.1', () => {
      const address = server.address();

      if (!address || typeof address === 'string') {
        server.close();
        reject(new Error('Could not determine a free TCP port.'));
        return;
      }

      const port = address.port;

      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve(port);
      });
    });
  });
}

/**
 * Waits for a spawned Avenx process to announce its listening URL.
 * @param {import('child_process').ChildProcess} child - Spawned process.
 * @returns {Promise<{port: number, output: () => string}>} Listening details.
 */
async function waitForServer(child) {
  return new Promise((resolve, reject) => {
    let output = '';
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;

      settled = true;
      reject(
        new Error(
          `Timed out waiting for avenx serve to start.\n\nOutput:\n${output}`,
        ),
      );
    }, 15_000);

    const consume = (chunk) => {
      output += chunk.toString();

      const match = output.match(
        /Dev-Server running at http:\/\/[^:]+:(\d+)/,
      );

      if (match && !settled) {
        settled = true;
        clearTimeout(timer);

        resolve({
          port: Number(match[1]),
          output: () => output,
        });
      }
    };

    child.stdout?.on('data', consume);
    child.stderr?.on('data', consume);

    child.once('error', (error) => {
      if (settled) return;

      settled = true;
      clearTimeout(timer);
      reject(error);
    });

    child.once('exit', (code, signal) => {
      if (settled) return;

      settled = true;
      clearTimeout(timer);

      reject(
        new Error(
          `avenx serve exited before becoming ready. ` +
            `code=${code}, signal=${signal}\n\nOutput:\n${output}`,
        ),
      );
    });
  });
}

/**
 * Terminates a child process and waits for it to exit.
 * @param {import('child_process').ChildProcess} child - Process to terminate.
 * @returns {Promise<void>}
 */
async function terminate(child) {
  if (child.exitCode !== null || child.signalCode !== null) {
    return;
  }

  await new Promise((resolve) => {
    let finished = false;

    const done = () => {
      if (finished) return;
      finished = true;
      resolve();
    };

    child.once('exit', done);

    try {
      child.kill('SIGTERM');
    } catch {
      done();
      return;
    }

    setTimeout(() => {
      if (finished) return;

      try {
        child.kill('SIGKILL');
      } catch {
        // The process may have exited between the checks.
      }

      done();
    }, 3_000);
  });
}

/**
 * Creates a private copy of the components fixture.
 * @returns {Promise<string>} Scratch project directory.
 */
async function createScratchProject() {
  const scratchRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), 'avenx-serve-e2e-'),
  );

  const projectDir = path.join(scratchRoot, 'components');

  await fs.cp(sourceFixture, projectDir, {
    recursive: true,
  });

  return projectDir;
}

/**
 * Updates the scratch project's configuration.
 * @param {string} projectDir - Scratch project directory.
 * @param {object} [server] - Optional server configuration.
 * @returns {Promise<void>}
 */
async function configureProject(projectDir, server = {}) {
  const configPath = path.join(projectDir, 'avenx.config.json');

  const config = JSON.parse(
    await fs.readFile(configPath, 'utf8'),
  );

  config.server = {
    ...(config.server || {}),
    ...server,
  };

  await fs.writeFile(
    configPath,
    `${JSON.stringify(config, null, 2)}\n`,
  );
}

/**
 * Starts the real Avenx development server.
 * @param {string} projectDir - Project working directory.
 * @param {number} port - Requested port.
 * @returns {Promise<{child: import('child_process').ChildProcess, port: number, output: () => string}>}
 */
async function startServer(projectDir, port) {
  const child = spawn(
    process.execPath,
    [avenxCli, 'serve', String(port)],
    {
      cwd: projectDir,
      env: {
        ...process.env,
        FORCE_COLOR: '0',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );

  const server = await waitForServer(child);

  return {
    child,
    port: server.port,
    output: server.output,
    // The address the tests connect to. `avenx serve` announces `localhost`,
    // which names both loopback families; the tests use the IPv4 one, and the
    // server listens on both.
    url: `http://127.0.0.1:${server.port}`,
  };
}

/**
 * Checks whether a TCP port is currently occupied.
 * @param {number} port - Port to occupy.
 * @returns {Promise<net.Server>} Listening server.
 */
async function occupyPort(port) {
  return new Promise((resolve, reject) => {
    const server = net.createServer();

    server.once('error', reject);

    server.listen(port, '127.0.0.1', () => {
      resolve(server);
    });
  });
}

export const test = base.extend({
  /**
   * A private project directory for the dev-server tests.
   */
  // Playwright requires the fixture destructuring form even when no other
  // fixture is used.
  // eslint-disable-next-line no-empty-pattern
  projectDir: async ({}, use) => {
    const projectDir = await createScratchProject();

    try {
      await use(projectDir);
    } finally {
      await fs.rm(path.dirname(projectDir), {
        recursive: true,
        force: true,
      });
    }
  },

  /**
   * A running `avenx serve` process.
   *
   * Every test gets its own process and the process is terminated even when
   * the test fails.
   */
  devServer: async ({ projectDir }, use) => {
    const port = await findFreePort();

    const server = await startServer(projectDir, port);

    try {
      await use({ ...server });
    } finally {
      await terminate(server.child);
    }
  },

  /**
   * A Playwright page connected to the real development server.
   */
  page: async ({ page, devServer }, use) => {
    await page.goto(`${devServer.url}/index.html`);
    await use(page);
  },
});

export { expect, configureProject, findFreePort, occupyPort, startServer, terminate };

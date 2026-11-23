/**
 * @file openBrowser.test.js
 * @description `avenx serve --open` picks the right opener on every platform,
 * and never routes the URL through a shell.
 *
 * Every branch is driven on every platform the CI matrix runs, through an
 * injected `spawn`, so no browser is launched. Before this, two of the three
 * branches had never run anywhere, and the Windows one spawned the cmd.exe
 * builtin `start` with `shell: true` -- where Node concatenates arguments into
 * a command line unescaped, so an `&` in the host started a second command.
 */
import assert from 'assert';
import { EventEmitter } from 'events';
import { browserOpener, openBrowser } from '../../bin/commands/serve.js';

/**
 * A stand-in for `child_process.spawn` that records its call.
 * @returns {{spawnImpl: Function, calls: Array<{command: string, args: string[], options: object}>, child: EventEmitter}}
 */
function fakeSpawn() {
  const calls = [];
  const child = new EventEmitter();
  child.unrefCalled = false;
  child.unref = () => {
    child.unrefCalled = true;
  };
  const spawnImpl = (command, args, options) => {
    calls.push({ command, args, options });
    return child;
  };
  return { spawnImpl, calls, child };
}

try {
  console.log('🧪 Testing avenx serve --open on each platform...');

  const url = 'http://localhost:3000/?a=1&b=2';
  const expected = { darwin: 'open', win32: 'explorer.exe', linux: 'xdg-open', freebsd: 'xdg-open' };

  for (const [platform, command] of Object.entries(expected)) {
    assert.strictEqual(browserOpener(platform), command, `${platform} opens with ${command}`);

    const { spawnImpl, calls, child } = fakeSpawn();
    openBrowser(url, { platform, spawnImpl });

    assert.strictEqual(calls.length, 1, `${platform}: one process is spawned`);
    assert.strictEqual(calls[0].command, command);
    assert.deepStrictEqual(calls[0].args, [url], `${platform}: the URL is passed as one argument, untouched`);
    assert.strictEqual(calls[0].options.shell, false, `${platform}: no shell sees the URL`);
    assert.strictEqual(calls[0].options.detached, true, `${platform}: the browser outlives the dev server`);
    assert.ok(child.unrefCalled, `${platform}: the server does not wait for the browser`);

    // No opener installed (a headless Linux box without xdg-open) emits
    // 'error' on the child. Unhandled, that would crash the dev server.
    assert.doesNotThrow(() => child.emit('error', new Error('spawn xdg-open ENOENT')));
    console.log(`  ✅ ${platform}: ${command}, no shell, a missing opener is not fatal`);
  }

  console.log('openBrowser tests passed!');
} catch (error) {
  console.error('openBrowser tests failed!');
  console.error(error);
  process.exit(1);
}

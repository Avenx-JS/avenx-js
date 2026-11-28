/**
 * @file conditionDiagnostics.test.js
 * @description What the build says about expressions in conditions and attributes.
 *
 * The unit test beside this one asserts that the shared template walk emits
 * these constructs. This one runs the real CLI over a real project and asserts
 * what a developer actually sees, because the defect was never in one pass --
 * it was in what two passes were both blind to.
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import assert from 'assert';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BIN_PATH = path.join(__dirname, '../../bin/avenx.js');

const root = fs.mkdtempSync(path.join(fs.realpathSync.native(os.tmpdir()), 'avenx-conditions-'));

/**
 * Builds the project with a given page template and returns the build output.
 * @param {string} template - The page template source.
 * @returns {{status: number, output: string, codes: Set<string>}} The result.
 */
function buildWith(template) {
  fs.writeFileSync(path.join(root, 'src/pages/probe.page.js'), template);
  const res = spawnSync(process.execPath, [BIN_PATH, 'build'], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, NO_COLOR: '1' },
  });
  const output = (res.stdout || '') + (res.stderr || '');
  return { status: res.status, output, codes: new Set(output.match(/AVX_[A-Z]\d+/g) || []) };
}

try {
  console.log('🧪 Testing diagnostics for conditions and attribute handlers...');

  const init = spawnSync(process.execPath, [BIN_PATH, 'init'], { cwd: root, encoding: 'utf8' });
  assert.strictEqual(init.status, 0, `init failed:\n${init.stdout}${init.stderr}`);
  fs.appendFileSync(path.join(root, 'src/main.app.js'), "\napp.initRouter({ '': 'Probe' });\n");

  // --- a typo in a condition is reported ---------------------------------
  {
    const { codes, output } = buildWith('<state count="0" />\n<@if (kount > 3)><p>a</p></@if>');
    assert.ok(
      codes.has('AVX_W03'),
      'a typo in an <@if> condition must be reported as an undeclared reference. ' + `Got:\n${output}`,
    );
    assert.ok(/kount/.test(output), 'the diagnostic should name the misspelled identifier');
    console.log('  ✅ a typo in an <@if> condition is reported (AVX_W03)');
  }

  // --- a typo in an <@elseif> condition is reported -----------------------
  {
    const { codes } = buildWith('<state count="0" />\n<@if (count > 3)><p>a</p><@elseif (kount > 1)><p>b</p></@if>');
    assert.ok(codes.has('AVX_W03'), 'a typo in an <@elseif> condition must be reported');
    console.log('  ✅ a typo in an <@elseif> condition is reported (AVX_W03)');
  }

  // --- state read only by a condition is not "read nowhere" ---------------
  {
    const { codes, output } = buildWith('<state count="0" />\n<@if (count > 3)><p>a</p></@if>');
    assert.ok(
      !codes.has('AVX_W40'),
      'state read by a condition is read. Reporting it as "read nowhere" would ' +
        `tell the developer to delete state the template depends on.\n${output}`,
    );
    console.log('  ✅ state read only by a condition is not reported as unread');
  }

  // --- a valid condition still builds clean ------------------------------
  {
    const { status, codes } = buildWith('<state count="0" />\n<@if (count > 3)><p>high</p><@else><p>low</p></@if>');
    assert.strictEqual(status, 0, 'a valid conditional must build');
    assert.ok(!codes.has('AVX_W03'), 'a correct condition must not be reported');
    assert.ok(!codes.has('AVX_W40'), 'a read state key must not be reported');
    console.log('  ✅ a valid conditional builds with no diagnostics');
  }

  // --- a handler after an attribute containing ">" is seen ----------------
  {
    const { codes, output } = buildWith(
      '<state count="0" />\n<action name="go">count++</action>\n' +
        '<div title="a > b" @click="go()">{{ count }}</div>',
    );
    assert.ok(
      !codes.has('AVX_W41'),
      'the @click handler invokes go(), so claiming go is never invoked is wrong. ' +
        `A ">" in an earlier attribute must not hide it.\n${output}`,
    );
    console.log('  ✅ a handler after an attribute containing ">" is seen');
  }

  // --- an unreachable action is still reported ---------------------------
  {
    const { codes } = buildWith('<state count="0" />\n<action name="unused">count++</action>\n<p>{{ count }}</p>');
    assert.ok(
      codes.has('AVX_W41'),
      'AVX_W41 must still fire for an action nothing calls -- the fix must not ' + 'have been to stop making the claim',
    );
    console.log('  ✅ a genuinely uninvoked action is still reported (AVX_W41)');
  }

  // --- unread state is still reported ------------------------------------
  {
    const { codes } = buildWith('<state unused="0" />\n<p>hello</p>');
    assert.ok(codes.has('AVX_W40'), 'AVX_W40 must still fire for genuinely unread state');
    console.log('  ✅ genuinely unread state is still reported (AVX_W40)');
  }
  // --- state read only by <@defer when="..."> is not reported as unread (issue #2042) ---
  {
    const template =
      '<state show="false" />\n' +
      '<action name="toggle">this.state.show = true;</action>\n' +
      '<div>\n' +
      '  <button id="t" @click="toggle()">show</button>\n' +
      '  <@defer when="state.show"><p id="expr">expression content</p></@defer>\n' +
      '</div>';
    const { status, codes, output } = buildWith(template);
    assert.strictEqual(status, 0, `defer expression reproduction must build:\n${output}`);
    assert.ok(!codes.has('AVX_W40'), `state read only by <@defer when="..."> must not trigger AVX_W40.\n${output}`);

    const impact = spawnSync(process.execPath, [BIN_PATH, 'impact', 'Probe.show'], {
      cwd: root,
      encoding: 'utf8',
      env: { ...process.env, NO_COLOR: '1' },
    });
    assert.strictEqual(impact.status, 0, `avenx impact failed:\n${impact.stdout}${impact.stderr}`);
    assert.ok(
      impact.stdout.includes('<@defer>') && impact.stdout.includes('state.show'),
      `Atlas must report <@defer> as a reader of Probe.show.\nGot:\n${impact.stdout}`,
    );
    console.log('  ✅ state read only by <@defer when="..."> clears AVX_W40 and is recorded in Atlas');
  }

  {
    const { codes, output } = buildWith(
      '<state unused="false" />\n' +
        '<action name="touch">this.state.unused = true;</action>\n' +
        '<button @click="touch()">go</button>',
    );
    assert.ok(
      codes.has('AVX_W40'),
      `a state key that is written and never read must still warn with AVX_W40.\n${output}`,
    );
    console.log('  ✅ written-but-unread state still reports AVX_W40');
  }
  console.log('✅ Condition and attribute diagnostics tests passed!');
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}

/**
 * @file topLevelAtRule.test.js
 * @description A top-level at-rule in `<@css>` is a real rule, not a style block name.
 *
 * The block scanner used the text before `{` as a block name. `@media (max-width: 600px)`
 * therefore became a block nobody can name, AVX_W55 reported it as unused, and the
 * emitter dropped it. The same at-rule nested inside a named block already scopes
 * correctly. A top-level `@media` or `@supports` has to reach that path, and a
 * top-level `@keyframes` has to be emitted unchanged.
 */

import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import ComponentParser from '../../lib/compiler/ComponentParser.js';
import StyleProcessor from '../../lib/compiler/StyleProcessor.js';
import { AvenxErrorCodes } from '../../lib/core/runtime/AvenxError.js';

const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'avenx-at-rule-'));

/**
 * Compiles one component and returns the stylesheet the build would emit.
 * @param {string} name - File stem, which also names the component.
 * @param {string} template - Component template.
 * @param {string} css - Component stylesheet.
 * @returns {{css: string, codes: string[], args: string[][]}} The result.
 */
function compile(name, template, css) {
  const dir = path.join(workDir, name);
  fs.mkdirSync(dir);
  fs.writeFileSync(path.join(dir, `${name}.component.js`), template);
  fs.writeFileSync(path.join(dir, `${name}.component.css`), css);
  const style = new StyleProcessor();
  const parser = new ComponentParser(style);
  parser.parse(path.join(dir, `${name}.component.js`));
  const diagnostics = style.lastDiagnostics || [];
  return {
    css: style.getGlobalStyles(),
    codes: diagnostics.map((item) => item.code),
    args: diagnostics.map((item) => item.args),
  };
}

console.log('Testing top-level at-rules inside <@css>...');

{
  const { css, codes, args } = compile(
    'outer',
    '<div @css box>x</div>',
    `<@css>
    box {
        width: 50px;
    }

    @media (max-width: 600px) {
        box { width: 10px; }
    }

    @supports (display: grid) {
        box { display: grid; }
    }

    @keyframes fade {
        from { opacity: 0; }
        to { opacity: 1; }
    }
</@css>
`,
  );

  const hash = css.match(/\.avenx-[0-9a-f]+/)[0];
  assert.ok(css.includes(`${hash} { width: 50px; }`), `base rule missing from:\n${css}`);
  assert.ok(css.includes('@media (max-width: 600px) {'), `media query missing from:\n${css}`);
  assert.ok(css.includes(`${hash} { width: 10px; }`), `media rule was not scoped:\n${css}`);
  assert.ok(css.includes('@supports (display: grid) {'), `supports query missing from:\n${css}`);
  assert.ok(css.includes(`${hash} { display: grid; }`), `supports rule was not scoped:\n${css}`);
  const keyframeAt = css.indexOf('@keyframes fade {');
  const scopedAt = css.indexOf('/* Scoped Styles */');
  assert.ok(keyframeAt !== -1, `keyframes missing from:\n${css}`);
  assert.ok(css.includes('from { opacity: 0; }'), `keyframe body was rewritten:\n${css}`);
  const keyframes = scopedAt > keyframeAt ? css.slice(keyframeAt, scopedAt) : css.slice(keyframeAt);
  assert.ok(!keyframes.includes('.avenx-'), `keyframes must stay unscoped:\n${keyframes}`);
  const unused = args.filter((_, index) => codes[index] === AvenxErrorCodes.COMPILER_UNUSED_STYLE_BLOCK);
  assert.deepStrictEqual(unused, [], `at-rules must not be reported as unused style blocks: ${JSON.stringify(args)}`);
  console.log('  ✅ top-level @media, @supports and @keyframes are emitted');
}

{
  const { css, codes, args } = compile(
    'nested',
    '<div @css box>x</div>',
    `<@css>
    box {
        width: 50px;

        @media (max-width: 600px) {
            width: 10px;
        }
    }
</@css>
`,
  );
  assert.ok(css.includes('@media (max-width: 600px) {'), `nested media query missing from:\n${css}`);
  assert.ok(css.includes('width: 10px;'), `nested media body missing from:\n${css}`);
  assert.deepStrictEqual(
    codes.filter((code) => code === AvenxErrorCodes.COMPILER_UNUSED_STYLE_BLOCK),
    [],
    `nested at-rules must stay silent: ${JSON.stringify(args)}`,
  );
  console.log('  ✅ a nested @media is unchanged');
}

{
  const { codes, args } = compile(
    'stale',
    '<div @css box>x</div>',
    `<@css>
    box { width: 1px; }
    stale { color: red; }
    @media (max-width: 1px) {
        box { width: 2px; }
    }
</@css>
`,
  );
  const unused = args.filter((_, index) => codes[index] === AvenxErrorCodes.COMPILER_UNUSED_STYLE_BLOCK);
  assert.strictEqual(unused.length, 1, `expected one unused-block warning, got ${JSON.stringify(args)}`);
  assert.ok(unused[0][1].includes('"stale"'), `the unused block should be named, got ${unused[0][1]}`);
  assert.ok(!unused[0][1].includes('@media'), `the media query must not be named as a block, got ${unused[0][1]}`);
  console.log('  ✅ AVX_W55 still names a real unused block and skips the at-rule');
}

{
  const { css } = compile(
    'nosemi',
    '<div @css box>x</div>',
    `<@css>
    box { width: 50px }
    @media (max-width: 600px) { box { width: 10px; } }
</@css>
`,
  );
  const hash = css.match(/\.avenx-[0-9a-f]+/)[0];
  assert.ok(css.includes(`${hash} { width: 50px;`), `missing semicolon glued the selector:\n${css}`);
  assert.ok(!css.includes(`${hash}width`), `selector ran into the declaration:\n${css}`);
  assert.ok(css.includes('@media (max-width: 600px) {'), `media query missing from:\n${css}`);
  assert.ok(css.includes('width: 10px;'), `media body missing from:\n${css}`);
  console.log('  ✅ a missing semicolon stays a separate declaration');
}

{
  const { css, codes } = compile(
    'imported',
    '<div @css box>x</div>',
    `<@css>
    @import "extra.css";
    box { width: 50px; }
</@css>
`,
  );
  const hash = css.match(/\.avenx-[0-9a-f]+/);
  assert.ok(hash, `box was not scoped:\n${css}`);
  assert.ok(css.includes('@import "extra.css";'), `import was dropped:\n${css}`);
  assert.ok(css.includes(`${hash[0]} { width: 50px; }`), `import swallowed the block:\n${css}`);
  assert.ok(!codes.includes(AvenxErrorCodes.COMPILER_UNUSED_STYLE_BLOCK), `import was reported as a style block:\n${css}`);
  console.log('  ✅ a braceless @import stays on its own line');
}

{
  const { css, codes } = compile(
    'passthrough',
    '<div @css box>x</div>',
    `<@css>
    box { width: 50px; }
    @container (min-width: 400px) { box { width: 10px; } }
    @font-face { font-family: Demo; src: url(demo.woff); }
    @layer utilities;
</@css>
`,
  );
  const hash = css.match(/\.avenx-[0-9a-f]+/)[0];
  assert.ok(css.includes('@container (min-width: 400px) {'), `container query missing from:\n${css}`);
  assert.ok(css.includes(`${hash} { width: 10px; }`), `container rule was not scoped:\n${css}`);
  const fontAt = css.indexOf('@font-face {');
  const fontEnd = css.indexOf('}', fontAt);
  const fontFace = css.slice(fontAt, fontEnd);
  assert.ok(fontAt !== -1, `font-face missing from:\n${css}`);
  assert.ok(fontFace.includes('font-family: Demo;'), `font-face body missing from:\n${css}`);
  assert.ok(!fontFace.includes('.avenx-'), `font-face was scoped:\n${fontFace}`);
  assert.ok(css.includes('@layer utilities;'), `trailing layer statement was dropped:\n${css}`);
  assert.ok(!codes.includes(AvenxErrorCodes.COMPILER_UNUSED_STYLE_BLOCK), `pass-through rules were named as blocks:\n${css}`);
  console.log('  ✅ @container is scoped, and @font-face and a trailing statement are copied');
}

console.log('✅ top-level at-rule tests passed');

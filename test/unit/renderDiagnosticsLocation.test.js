/**
 * @file renderDiagnosticsLocation.test.js
 * @description Issue #1178: DX: Include Component Name and Template Source Position in AVX_R08 Runtime Render Diagnostics.
 * Verifies that AVX_R08, AVX_W21-W23 report component name, original file, line:column, and code frames.
 */

import assert from 'assert';
import fs from 'fs';
import path from 'path';
import os from 'os';
import '../helpers/register-happy-dom.js';
import { AvenxError, AvenxErrorCodes, formatMessage } from '../../lib/core/runtime/AvenxError.js';
import { extractTemplateLocations } from '../../lib/compiler/templateLocations.js';
import { formatCodeFrame } from '../../lib/core/utils/codeFrame.js';
import { TemplateRenderer } from '../../lib/core/renderer/renderTemplate.js';
import { DomPatcher } from '../../lib/core/renderer/domPatch.js';
import { reportBindingError } from '../../lib/core/renderer/program/bindings.js';
import { buildTemplateIR } from '../../lib/compiler/ir/build.js';
import { lowerToProgram } from '../../lib/compiler/ir/lower.js';
import ComponentParser from '../../lib/compiler/ComponentParser.js';
import StyleProcessor from '../../lib/compiler/StyleProcessor.js';

console.log('🧪 Testing Issue #1178: Component Name & Source Position in Render Diagnostics...');



try {
  // 1. AvenxError and formatMessage format verification
  console.log('  1. Verifying AvenxError and formatMessage signatures...');
  {
    // Legacy 2-argument format falls back safely
    const legacyMsg = formatMessage(
      AvenxErrorCodes.TEMPLATE_RENDER_ERROR,
      'user.name',
      'TypeError: Cannot read properties of undefined',
    );
    assert.ok(legacyMsg.includes('user.name'));
    assert.ok(legacyMsg.includes('<AnonymousComponent>'));

    // New 4-argument format with component and location
    const enrichedMsg = formatMessage(
      AvenxErrorCodes.TEMPLATE_RENDER_ERROR,
      'user.name',
      'Cannot read properties of undefined',
      'UserProfile',
      ' at src/UserProfile.component.js:15:8',
    );
    assert.strictEqual(
      enrichedMsg,
      '[AVX_R08] Failed to render interpolation expression "user.name" in component <UserProfile> at src/UserProfile.component.js:15:8. Error: Cannot read properties of undefined',
    );

    // AvenxError instance with location metadata
    const err = new AvenxError(
      AvenxErrorCodes.TEMPLATE_RENDER_ERROR,
      'user.name',
      'Cannot read properties of undefined',
      {
        componentName: 'UserProfile',
        fileName: 'src/UserProfile.component.js',
        line: 15,
        column: 8,
      },
    );
    assert.strictEqual(err.componentName, 'UserProfile');
    assert.strictEqual(err.fileName, 'src/UserProfile.component.js');
    assert.strictEqual(err.line, 15);
    assert.strictEqual(err.column, 8);
    assert.strictEqual(err.sourceLine, 15);

    const json = err.toJSON();
    assert.strictEqual(json.code, 'AVX_R08');
    assert.strictEqual(json.componentName, 'UserProfile');
    assert.strictEqual(json.fileName, 'src/UserProfile.component.js');
    assert.strictEqual(json.line, 15);
    assert.strictEqual(json.column, 8);
    assert.strictEqual(json.sourceLine, 15);
  }

  // 2. extractTemplateLocations precise source offsets & duplicates
  console.log('  2. Verifying extractTemplateLocations for precise line/col mapping...');
  {
    const source = [
      '<state user="null" />', // line 1
      '<action load() {',      // line 2
      '  return true;',        // line 3
      '} />',                  // line 4
      '<div>',                 // line 5
      '  <h1>{{ user.title }}</h1>', // line 6, col 10
      '  <p>{{ user.name }}</p>',    // line 7, col 9
      '  <@for item in user.items>', // line 8, col 17
      '    <span>{{ item.label }}</span>', // line 9, col 14
      '  </@for>',             // line 10
      '  <footer>{{ user.name }}</footer>', // line 11, col 14 (duplicate of user.name!)
      '  <div data-ax-show="user.isActive">Active</div>', // line 12, col 21
      '  <div data-ax-class="user.theme">Theme</div>',    // line 13, col 22
      '  <div data-ax-html="user.bio">Bio</div>',         // line 14, col 21
      '</div>',                // line 15
    ].join('\n');

    const locs = extractTemplateLocations(source, 'src/UserProfile.component.js');
    assert.ok(locs.locations.length >= 7);

    // First user.name at line 7, col 9
    const firstUserName = locs.findLocation('user.name', 0);
    assert.ok(firstUserName);
    assert.strictEqual(firstUserName.line, 7);
    assert.strictEqual(firstUserName.column, 9);
    assert.strictEqual(firstUserName.file, 'src/UserProfile.component.js');

    // Duplicate user.name at line 11, col 14
    const secondUserName = locs.findLocation('user.name', 1);
    assert.ok(secondUserName);
    assert.strictEqual(secondUserName.line, 11);
    assert.strictEqual(secondUserName.column, 14);

    // Loop expression inside <@for>
    const forLoc = locs.findLocation('user.items', 0, 'for');
    assert.ok(forLoc);
    assert.strictEqual(forLoc.line, 8);
    assert.strictEqual(forLoc.column, 17);

    // Directives
    const showLoc = locs.findLocation('user.isActive', 0, 'show');
    assert.ok(showLoc);
    assert.strictEqual(showLoc.line, 12);
    assert.strictEqual(showLoc.column, 22);

    const classLoc = locs.findLocation('user.theme', 0, 'class');
    assert.ok(classLoc);
    assert.strictEqual(classLoc.line, 13);
    assert.strictEqual(classLoc.column, 23);

    const htmlLoc = locs.findLocation('user.bio', 0, 'html');
    assert.ok(htmlLoc);
    assert.strictEqual(htmlLoc.line, 14);
    assert.strictEqual(htmlLoc.column, 22);
  }

  // 3. formatCodeFrame formatting
  console.log('  3. Verifying code frame formatting...');
  {
    const source = 'line 1\nline 2: {{ user.profile.name }}\nline 3';
    const frame = formatCodeFrame(source, 2, 12, { length: 'user.profile.name'.length });
    assert.ok(frame.includes('line 2: {{ user.profile.name }}'));
    assert.ok(frame.includes('^'));
  }

  // 4. TemplateRenderer (String renderer path) error reporting
  console.log('  4. Verifying TemplateRenderer diagnostic output...');
  {
    const warnings = [];
    const origWarn = console.warn;
    console.warn = (msg) => warnings.push(String(msg));

    try {
      const source = '<div>{{ user.profile.name }}</div>\n<span>{{ user.profile.name }}</span>';
      const locs = extractTemplateLocations(source, 'src/Card.component.js');
      const renderer = new TemplateRenderer({
        logContext: {
          componentName: 'Card',
          fileName: 'src/Card.component.js',
          exprLocations: locs,
          template: source,
        },
      });

      let callCount = 0;
      try {
        renderer.render(source, () => {
          callCount++;
          if (callCount === 1) {
            throw new TypeError("Cannot read properties of undefined (reading 'name')");
          }
          return 'ok';
        });
      } catch {
        /* expected render error */
      }

      assert.ok(warnings.length > 0);
      const warnMsg = warnings[0];
      assert.ok(warnMsg.includes('[AVX_R08]'));
      assert.ok(warnMsg.includes('in component <Card>'));
      assert.ok(warnMsg.includes('at src/Card.component.js:1:9'));
      assert.ok(warnMsg.includes('TypeError: Cannot read properties of undefined'));
      // Code frame presence
      assert.ok(warnMsg.includes('user.profile.name'));
      assert.ok(warnMsg.includes('^'));
    } finally {
      console.warn = origWarn;
    }
  }

  // 5. Duplicate expression occurrences in TemplateRenderer
  console.log('  5. Verifying duplicate occurrences resolve distinctly in TemplateRenderer...');
  {
    const warnings = [];
    const origWarn = console.warn;
    console.warn = (msg) => warnings.push(String(msg));

    try {
      const source = 'Line 1: {{ val }}\nLine 2: {{ val }}';
      const locs = extractTemplateLocations(source, 'src/Dup.component.js');
      const renderer = new TemplateRenderer({
        logContext: {
          componentName: 'Dup',
          fileName: 'src/Dup.component.js',
          exprLocations: locs,
          template: source,
        },
      });

      let count = 0;
      try {
        renderer.render(source, () => {
          count++;
          if (count === 2) {
            throw new Error('second occurrence failed');
          }
          return 'first-ok';
        });
      } catch {
        /* expected render error */
      }

      assert.ok(warnings.length > 0);
      const warnMsg = warnings[0];
      assert.ok(warnMsg.includes('[AVX_R08]'));
      assert.ok(warnMsg.includes('at src/Dup.component.js:2:12'));
    } finally {
      console.warn = origWarn;
    }
  }

  // 6. Compiled Render Program path (IR lowering & reportBindingError)
  console.log('  6. Verifying compiled render program op.loc and reportBindingError...');
  {
    const source = '<state item="null" />\n<div>{{ item.missing.prop }}</div>';
    const locs = extractTemplateLocations(source, 'src/Compiled.component.js');
    const built = buildTemplateIR('<div>{{ item.missing.prop }}</div>', { exprLocations: locs });
    assert.ok(built.ir);

    // Development lowering attaches loc
    const devProgram = lowerToProgram(built.ir, { production: false });
    assert.ok(devProgram.program);
    const textOp = devProgram.program.ops.find((op) => op.k === 'text');
    assert.ok(textOp);
    assert.ok(textOp.loc);
    assert.strictEqual(textOp.loc.line, 2);
    assert.strictEqual(textOp.loc.column, 9);
    assert.strictEqual(textOp.loc.file, 'src/Compiled.component.js');

    // Production lowering omits loc
    const prodProgram = lowerToProgram(built.ir, { production: true });
    assert.ok(prodProgram.program);
    const prodTextOp = prodProgram.program.ops.find((op) => op.k === 'text');
    assert.ok(prodTextOp);
    assert.strictEqual(prodTextOp.loc, undefined);

    // reportBindingError format check
    const warnings = [];
    const origWarn = console.warn;
    console.warn = (msg) => warnings.push(String(msg));

    try {
      const mockHost = {
        component: {
          $logContext: {
            componentName: 'CompiledComp',
            fileName: 'src/Compiled.component.js',
            template: source,
          },
        },
        describeExpression: () => 'item.missing.prop',
      };
      reportBindingError(textOp, new TypeError("Cannot read properties of undefined (reading 'prop')"), mockHost);

      assert.ok(warnings.length > 0);
      const warnMsg = warnings[0];
      assert.ok(warnMsg.includes('[AVX_R08]'));
      assert.ok(warnMsg.includes('in component <CompiledComp>'));
      assert.ok(warnMsg.includes('at src/Compiled.component.js:2:9'));
      assert.ok(warnMsg.includes('item.missing.prop'));
      assert.ok(warnMsg.includes('^'));
    } finally {
      console.warn = origWarn;
    }
  }

  // 7. DomPatcher Directive Warning diagnostics (AVX_W21 - AVX_W23)
  console.log('  7. Verifying directive warning diagnostics (AVX_W21 - AVX_W23)...');
  {
    const warnings = [];
    const origWarn = console.warn;
    console.warn = (msg) => warnings.push(String(msg));

    try {
      const source = [
        '<div data-ax-html="bad.html"></div>',
        '<div data-ax-show="bad.show"></div>',
        '<div data-ax-class="bad.class"></div>',
      ].join('\n');
      const locs = extractTemplateLocations(source, 'src/Directives.component.js');

      const patcher = new DomPatcher({
        logContext: {
          componentName: 'DirectivesComp',
          fileName: 'src/Directives.component.js',
          exprLocations: locs,
          template: source,
        },
      });

      const container = document.createElement('div');
      container.innerHTML = source;

      patcher.patch(container, source, (expr) => {
        throw new Error(`Failed to evaluate ${expr}`);
      });

      // Assert AVX_W21
      const w21 = warnings.find((w) => w.includes('AVX_W21'));
      assert.ok(w21, 'AVX_W21 warning present');
      assert.ok(w21.includes('in component <DirectivesComp>'));
      assert.ok(w21.includes('at src/Directives.component.js:1:20'));

      // Assert AVX_W22
      const w22 = warnings.find((w) => w.includes('AVX_W22'));
      assert.ok(w22, 'AVX_W22 warning present');
      assert.ok(w22.includes('in component <DirectivesComp>'));
      assert.ok(w22.includes('at src/Directives.component.js:2:20'));

      // Assert AVX_W23
      const w23 = warnings.find((w) => w.includes('AVX_W23'));
      assert.ok(w23, 'AVX_W23 warning present');
      assert.ok(w23.includes('in component <DirectivesComp>'));
      assert.ok(w23.includes('at src/Directives.component.js:3:21'));
    } finally {
      console.warn = origWarn;
    }
  }

  // 8. ComponentParser full compilation in dev vs production
  console.log('  8. Verifying ComponentParser output in dev vs production mode...');
  {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'avenx-issue1178-'));
    const compFile = path.join(tempDir, 'ProductCard.component.js');
    const compCss = path.join(tempDir, 'ProductCard.component.css');
    const compContent = [
      '<state product="null" />',
      '<div>',
      '  <h2>{{ product.title }}</h2>',
      '</div>',
    ].join('\n');

    fs.writeFileSync(compFile, compContent);
    fs.writeFileSync(compCss, '');

    try {
      // Dev parser
      const devParser = new ComponentParser(new StyleProcessor());
      devParser.production = false;
      const devCode = devParser.parse(compFile);

      assert.ok(devCode.includes('ProductCard.__axExprLocations = '));
      assert.ok(devCode.includes('ProductCard.__source = '));
      assert.ok(devCode.includes('exprLocations:'));
      assert.ok(devCode.includes('"line":3'));
      assert.ok(devCode.includes('"column":10'));

      // Production parser
      const prodParser = new ComponentParser(new StyleProcessor());
      prodParser.production = true;
      const prodCode = prodParser.parse(compFile);

      assert.ok(!prodCode.includes('ProductCard.__axExprLocations'), 'production omits __axExprLocations');
      assert.ok(!prodCode.includes('ProductCard.__source'), 'production omits __source');
      assert.ok(!prodCode.includes('exprLocations:'), 'production omits exprLocations in options');
      assert.ok(!prodCode.includes('"line":3'), 'production omits line numbers');
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  }

  // 9. Scoped slots attribution to parent component
  console.log('  9. Verifying slot expressions report parent component context...');
  {
    const warnings = [];
    const origWarn = console.warn;
    console.warn = (msg) => warnings.push(String(msg));

    try {
      const parentLogContext = {
        componentName: 'ParentContainer',
        fileName: 'src/ParentContainer.component.js',
        template: '<Card><template data-slot-props="slotProps">{{ slotProps.missing.name }}</template></Card>',
        exprLocations: {
          locations: [
            {
              type: 'interpolation',
              expr: 'slotProps.missing.name',
              line: 1,
              column: 57,
              file: 'src/ParentContainer.component.js',
            },
          ],
          byExpr: {
            'slotProps.missing.name': [
              {
                type: 'interpolation',
                expr: 'slotProps.missing.name',
                line: 1,
                column: 57,
                file: 'src/ParentContainer.component.js',
              },
            ],
          },
        },
      };

      const renderer = new TemplateRenderer();
      try {
        renderer.render(
          '{{ slotProps.missing.name }}',
          () => {
            throw new TypeError("Cannot read properties of undefined (reading 'name')");
          },
          parentLogContext,
        );
      } catch {
        /* expected render error */
      }

      assert.ok(warnings.length > 0);
      const warn = warnings[0];
      assert.ok(warn.includes('[AVX_R08]'));
      assert.ok(warn.includes('in component <ParentContainer>'));
      assert.ok(warn.includes('at src/ParentContainer.component.js:1:57'));
    } finally {
      console.warn = origWarn;
    }
  }

  console.log('✅ All Issue #1178 render diagnostic location tests passed!');
} catch (err) {
  console.error('❌ Tests failed with error:', err);
  process.exitCode = 1;
}

import assert from 'assert';
import Module from 'module';
import StyleProcessor from '../../lib/compiler/StyleProcessor.js';
import ComponentParser from '../../lib/compiler/ComponentParser.js';
import { logger } from '../../lib/core/runtime/AvenxLogger.js';

// Setup Mock for 'sass' and 'postcss'
const originalRequire = Module.prototype.require;
let mockSassAvailable = false;
let mockPostcssAvailable = false;

Module.prototype.require = function(name) {
  if (name === 'sass') {
    if (!mockSassAvailable) {
      throw new Error("Cannot find module 'sass'");
    }
    return {
      compileString: (cssContent, options) => {
        let css = cssContent;
        // Mock compile: replace variables and nesting
        css = css.replace(/\$primary/g, '#ff0000');
        css = css.replace(/\$secondary/g, '#00ff00');
        if (css.includes('__avenx_temp_class__')) {
          // Mock SCSS nested compilation output
          css = `
.__avenx_temp_class__ {
  color: #ff0000;
}
.__avenx_temp_class__ span {
  font-weight: bold;
}
`;
        } else {
          // Mock global SCSS output
          css = `
body {
  background: #ff0000;
}
`;
        }
        return { css };
      }
    };
  }

  if (name === 'postcss') {
    if (!mockPostcssAvailable) {
      throw new Error("Cannot find module 'postcss'");
    }
    return function() {
      return {
        process: (cssContent) => {
          // Mock PostCSS: add a header comment or format
          return { css: '/* processed by postcss */\n' + cssContent };
        }
      };
    };
  }

  return originalRequire.apply(this, arguments);
};

try {
  console.log('🧪 Testing Style Preprocessors (Sass/SCSS, PostCSS)...');

  // Test 1: Graceful fallback when preprocessor is enabled but not installed
  mockSassAvailable = false;
  let warnLogged = false;
  const originalLoggerWarn = logger.warn;
  logger.warn = (msg) => {
    if (msg.includes('AVX_W24') && msg.includes('sass')) {
      warnLogged = true;
    }
  };

  const spFallback = new StyleProcessor({ preprocessor: 'sass' });
  const rawGlobal = '$primary: #ff0000;\nbody { background: $primary; }';
  
  // Running preprocessCss should trigger warning and return original
  const resultFallback = spFallback.preprocessCss(rawGlobal, 'sass');
  assert.strictEqual(resultFallback, rawGlobal);
  assert.ok(warnLogged, 'Should log a warning AVX_W24 when preprocessor module is missing');

  // Restore logger
  logger.warn = originalLoggerWarn;

  // Test 2: Successful compilation with mock Sass preprocessor
  mockSassAvailable = true;
  const spSass = new StyleProcessor({ preprocessor: 'sass' });
  const cpSass = new ComponentParser(spSass);

  const desContentSass = `
    <@global>
      $primary: #ff0000;
      $secondary: #00ff00;
      body {
        background: $primary;
      }
    </@global>
    <@css>
      container {
        color: $primary;
        span {
          font-weight: bold;
        }
      }
    </@css>
  `;

  const desBlocksSass = {};
  cpSass.extractStylesAndVars(desContentSass, desBlocksSass);

  // Verify global CSS was compiled and added
  assert.ok(spSass.rawGlobalCSS.has('\nbody {\n  background: #ff0000;\n}\n'), 'Global CSS should compile with Sass');

  // Verify scoped blocks were compiled, nested rules flattened, and mapped back to parent reference &
  const expectedBlockBody = '& {\n  color: #ff0000;\n}\n& span {\n  font-weight: bold;\n}';
  assert.strictEqual(desBlocksSass['container'], expectedBlockBody, 'Block CSS should compile and scope nested rules with Sass');

  // Test 3: StyleProcessor.process output with Sass
  const html = '<div @css container><span>Hello</span></div>';
  const processedHtml = spSass.process(html, desBlocksSass, 'MyComponent');
  const hash = spSass.getHash(expectedBlockBody, 'MyComponent');

  assert.ok(processedHtml.includes(`class="${hash}"`), 'Should apply hash to HTML tag');
  
  const generatedStyles = spSass.getGlobalStyles();
  assert.ok(generatedStyles.includes(`.${hash} { color: #ff0000; }`), 'Generated styles should contain scoped parent rule');
  assert.ok(generatedStyles.includes(`.${hash} span { font-weight: bold; }`), 'Generated styles should contain scoped nested child rule');

  // Test 4: PostCSS preprocessor support
  mockPostcssAvailable = true;
  const spPostcss = new StyleProcessor({ preprocessor: 'postcss' });
  const cpPostcss = new ComponentParser(spPostcss);

  const desContentPostcss = `
    <@global>
      body { color: red; }
    </@global>
    <@css>
      button {
        color: blue;
      }
    </@css>
  `;

  const desBlocksPostcss = {};
  cpPostcss.extractStylesAndVars(desContentPostcss, desBlocksPostcss);

  assert.ok(spPostcss.rawGlobalCSS.has('/* processed by postcss */\nbody { color: red; }'), 'Global CSS should run through PostCSS');

  console.log('  ✅ Style preprocessor tests passed!');
} catch (error) {
  console.error('❌ Style preprocessor tests failed!');
  console.error(error);
  process.exit(1);
} finally {
  // Restore original require
  Module.prototype.require = originalRequire;
}

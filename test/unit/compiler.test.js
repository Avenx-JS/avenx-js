import { fileURLToPath } from 'url';
import { dirname } from 'path';
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

import assert from 'assert';
import path from 'path';
import fs from 'fs';
import AvenxCompiler from '../../lib/compiler.js';

try {
  console.log('🧪 Testing AvenxCompiler processMain...');

  // Create a temporary test directory
  const tempDir = path.join(__dirname, 'temp_compiler_test_src');
  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
  }

  const compiler = new AvenxCompiler();
  compiler.srcDir = tempDir; // override srcDir for testing

  const testCases = [
    {
      name: 'Standard "const app = new AvenxApp()"',
      mainContent: `
                import { AvenxApp } from 'avenx-core/runtime';
                const app = new AvenxApp({ target: '#app' });
            `,
      registrations: "app.registerPage('Home', Home);\napp.registerBridge('Auth', Auth);",
      expectedContains: [
        "const app = new AvenxApp({ target: '#app' });",
        "app.registerPage('Home', Home);",
        "app.registerBridge('Auth', Auth);",
      ],
    },
    {
      name: 'Alternative name "const myApp = new AvenxApp()"',
      mainContent: `
                const myApp = new AvenxApp({ target: '#app' });
            `,
      registrations: "app.registerPage('Home', Home);\napp.registerBridge('Auth', Auth);",
      expectedContains: [
        "const myApp = new AvenxApp({ target: '#app' });",
        "myApp.registerPage('Home', Home);",
        "myApp.registerBridge('Auth', Auth);",
      ],
    },
    {
      name: 'Variable type "let window.app = new AvenxApp()"',
      mainContent: `
                window.app = new AvenxApp({ target: '#app' });
            `,
      registrations: "app.registerPage('Home', Home);",
      expectedContains: ["window.app = new AvenxApp({ target: '#app' });", "window.app.registerPage('Home', Home);"],
    },
    {
      name: 'With injection token // @avenx-inject',
      mainContent: `
                const myApp = new AvenxApp({ target: '#app' });
                // some other setup
                // @avenx-inject
                myApp.mount();
            `,
      registrations: "app.registerPage('Home', Home);",
      expectedContains: [
        "const myApp = new AvenxApp({ target: '#app' });",
        "myApp.registerPage('Home', Home);",
        'myApp.mount();',
      ],
      expectedNotContains: ['// @avenx-inject'],
    },
    {
      name: 'Multiline instantiation',
      mainContent: `
                const myApp = 
                  new AvenxApp({
                    target: '#app'
                  });
            `,
      registrations: "app.registerPage('Home', Home);",
      expectedContains: ["myApp.registerPage('Home', Home);"],
    },
    {
      name: 'Multiline import statement',
      mainContent: `
                import {
                  AvenxApp,
                  AvenxComponent
                } from 'avenx-core/runtime';
                const app = new AvenxApp({ target: '#app' });
            `,
      registrations: "app.registerPage('Home', Home);",
      expectedContains: ["const app = new AvenxApp({ target: '#app' });", "app.registerPage('Home', Home);"],
      expectedNotContains: ['import {', 'AvenxComponent', '} from'],
    },
    {
      name: 'CSS-only / side-effect import',
      mainContent: `
                import './global.css';
                import "theme.css";
                const app = new AvenxApp({ target: '#app' });
            `,
      registrations: "app.registerPage('Home', Home);",
      expectedContains: ["const app = new AvenxApp({ target: '#app' });", "app.registerPage('Home', Home);"],
      expectedNotContains: ['./global.css', 'theme.css'],
    },
    {
      name: 'Dynamic import expression (should not be stripped)',
      mainContent: `
                const module = import('./dynamic-module.js');
                const app = new AvenxApp({ target: '#app' });
            `,
      registrations: "app.registerPage('Home', Home);",
      expectedContains: [
        "import('./dynamic-module.js')",
        "const app = new AvenxApp({ target: '#app' });",
        "app.registerPage('Home', Home);",
      ],
    },
  ];

  for (const tc of testCases) {
    console.log(`  Testing: ${tc.name}`);
    const mainFilePath = path.join(tempDir, 'main.app.js');
    fs.writeFileSync(mainFilePath, tc.mainContent);

    const result = compiler.processMain(tc.registrations);

    for (const exp of tc.expectedContains) {
      assert.ok(result.includes(exp), `Result should contain "${exp}"`);
    }
    if (tc.expectedNotContains) {
      for (const nexp of tc.expectedNotContains) {
        assert.ok(!result.includes(nexp), `Result should not contain "${nexp}"`);
      }
    }
  }

  // Clean up
  fs.unlinkSync(path.join(tempDir, 'main.app.js'));
  fs.rmdirSync(tempDir);

  console.log('🧪 Testing AvenxCompiler processGuards...');

  // Create temporary guard directories
  const tempGuardsDir = path.join(__dirname, 'temp_compiler_guards_test_src');
  const tempGuardsSubDir = path.join(tempGuardsDir, 'guards');
  if (!fs.existsSync(tempGuardsSubDir)) {
    fs.mkdirSync(tempGuardsSubDir, { recursive: true });
  }

  const guardsCompiler = new AvenxCompiler();
  guardsCompiler.srcDir = tempGuardsDir;

  const guardContent = `
    import { AvenxGuard } from 'avenx-core/runtime';
    import {
      someHelper,
      anotherHelper
    } from '../helpers/some-helper.js';
    import './style.css';
    import "another-theme.css";

    export default class CustomGuard extends AvenxGuard {
      async check() {
        const dynamic = await import('./dynamic-check.js');
        return dynamic.check();
      }
    }
  `;

  fs.writeFileSync(path.join(tempGuardsSubDir, 'custom.guard.js'), guardContent);

  const guardsResult = guardsCompiler.processGuards();

  assert.ok(guardsResult.includes('class CustomGuard extends AvenxGuard'), 'Result should contain CustomGuard class');
  assert.ok(guardsResult.includes("import('./dynamic-check.js')"), 'Result should preserve dynamic import expression');
  assert.ok(!guardsResult.includes('avenx-core/runtime'), 'Result should strip runtime import');
  assert.ok(!guardsResult.includes('some-helper.js'), 'Result should strip multiline helper import');
  assert.ok(!guardsResult.includes('style.css'), 'Result should strip side-effect style.css import');
  assert.ok(!guardsResult.includes('another-theme.css'), 'Result should strip side-effect another-theme.css import');
  assert.ok(!guardsResult.includes('export default'), 'Result should strip export default');

  // Clean up guards
  fs.unlinkSync(path.join(tempGuardsSubDir, 'custom.guard.js'));
  fs.rmdirSync(tempGuardsSubDir);
  fs.rmdirSync(tempGuardsDir);

  console.log('  ✅ processGuards tests passed!');

  console.log('🧪 Testing AvenxCompiler processPages...');

  const tempPagesDir = path.join(__dirname, 'temp_compiler_pages_test');
  const pagesDir = path.join(tempPagesDir, 'pages');

  if (!fs.existsSync(pagesDir)) {
    fs.mkdirSync(pagesDir, { recursive: true });
  }
  const pageContent = `<MyCard />`;

  const pagePath = path.join(pagesDir, 'home.page.js');

  fs.writeFileSync(pagePath, pageContent);
  const pagesCompiler = new AvenxCompiler();
  pagesCompiler.srcDir = tempPagesDir;

  const pagesResult = pagesCompiler.processPages();
  assert.ok(
  pagesResult.pagesJs.includes('<div data-avenx-comp="MyCard"></div>'),
  'Self-closing component tag should be converted to a standard component element'
);

assert.ok(
  pagesResult.registrations.includes("app.registerPage('Home', Home);"),
  'Home page should be registered'
);
fs.unlinkSync(pagePath);
fs.rmdirSync(pagesDir);
fs.rmdirSync(tempPagesDir);
console.log('  ✅ processPages tests passed!');
  console.log('  ✅ AvenxCompiler tests passed!');
} catch (error) {
  console.error('❌ AvenxCompiler tests failed!');
  console.error(error);
  process.exit(1);
}

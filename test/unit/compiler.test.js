/**
 * Module generation is the compiler's half of the bundling boundary: it turns
 * what the parser produced into ES modules, and the bundler links them.
 *
 * This file used to test `processMain` and `processGuards`, which rewrote the
 * runtime import into destructuring and **deleted every other import**. Those
 * assertions are inverted here rather than removed, because the inversion is
 * the fix: an import is now carried through untouched, and one that names
 * nothing fails the build instead of disappearing.
 *
 * What is unchanged, and still tested exactly as before: where registrations
 * are injected, how the application variable is discovered whatever it is
 * called, that `// @avenx-inject` wins when present, and that a dynamic import
 * is an expression rather than a declaration.
 */
import { fileURLToPath, pathToFileURL } from 'url';
import { dirname } from 'path';
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

import assert from 'assert';
import path from 'path';
import fs from 'fs';
import AvenxCompiler from '../../lib/compiler.js';
import {
  entryModule,
  componentModule,
  bridgeModule,
  pageChunkModule,
  collectImportStatements,
  PAGE_CHUNK_RUNTIME_NAMES,
} from '../../lib/compiler/modules.js';
import { PUBLIC_GLOBALS, NAMESPACE_MEMBERS } from '../../lib/core/globals.js';

try {
  console.log('🧪 Testing entry module generation...');

  /**
   * Registrations in the shape the compiler collects them.
   * @type {Array<object>}
   */
  const registrations = [
    { name: 'Home', file: '/project/src/pages/home.page.js', kind: 'page' },
    { name: 'Auth', file: '/project/src/bridges/auth.bridge.js', kind: 'bridge' },
  ];

  const testCases = [
    {
      name: 'Standard "const app = new AvenxApp()"',
      mainContent: `
                import { AvenxApp } from 'avenx-core/runtime';
                const app = new AvenxApp({ target: '#app' });
            `,
      expectedContains: [
        "const app = new AvenxApp({ target: '#app' });",
        'app.registerPage("Home", __avx_page_0);',
        'app.registerBridge("Auth", __avx_bridge_1);',
        // The imports the registrations name are generated, so the bundler can
        // see the pages and bridges the developer never imported themselves.
        'import __avx_page_0 from "/project/src/pages/home.page.js";',
      ],
    },
    {
      name: 'Alternative name "const myApp = new AvenxApp()"',
      mainContent: `
                const myApp = new AvenxApp({ target: '#app' });
            `,
      expectedContains: [
        "const myApp = new AvenxApp({ target: '#app' });",
        'myApp.registerPage("Home", __avx_page_0);',
        'myApp.registerBridge("Auth", __avx_bridge_1);',
      ],
    },
    {
      name: 'Member expression "window.app = new AvenxApp()"',
      mainContent: `
                window.app = new AvenxApp({ target: '#app' });
            `,
      expectedContains: [
        "window.app = new AvenxApp({ target: '#app' });",
        'window.app.registerPage("Home", __avx_page_0);',
      ],
    },
    {
      name: 'With injection token // @avenx-inject',
      mainContent: `
                const myApp = new AvenxApp({ target: '#app' });
                // some other setup
                // @avenx-inject
                myApp.mount();
            `,
      expectedContains: [
        "const myApp = new AvenxApp({ target: '#app' });",
        'myApp.registerPage("Home", __avx_page_0);',
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
      expectedContains: ['myApp.registerPage("Home", __avx_page_0);'],
    },
    {
      name: 'Multiline import statement is preserved, not rewritten',
      mainContent: `
                import {
                  AvenxApp,
                  AvenxComponent
                } from 'avenx-core/runtime';
                const app = new AvenxApp({ target: '#app' });
            `,
      // The whole point of the migration: an import stays an import. The
      // bundler resolves it, so it no longer has to be turned into a lookup on
      // a global namespace object.
      expectedContains: ["from 'avenx-core/runtime';", 'app.registerPage("Home", __avx_page_0);'],
      expectedNotContains: ['} = Avenx;'],
    },
    {
      name: "The developer's own imports survive",
      mainContent: `
                import { AvenxApp } from 'avenx-core/runtime';
                import Counter from './components/counter/counter.component.js';
                import { format } from 'date-fns';
                const app = new AvenxApp({ target: '#app' });
                app.register('Counter', Counter);
                void format;
            `,
      expectedContains: [
        "import Counter from './components/counter/counter.component.js';",
        "import { format } from 'date-fns';",
      ],
    },
    {
      name: 'Dynamic import expression is untouched',
      mainContent: `
                const mod = import('./dynamic-module.js');
                const app = new AvenxApp({ target: '#app' });
                void mod;
            `,
      expectedContains: ["import('./dynamic-module.js')", 'app.registerPage("Home", __avx_page_0);'],
    },
  ];

  for (const testCase of testCases) {
    console.log(`  Testing: ${testCase.name}`);
    const result = entryModule({ source: testCase.mainContent, registrations });

    for (const expected of testCase.expectedContains) {
      assert.ok(result.includes(expected), `Result should contain "${expected}"\n---\n${result}`);
    }
    for (const unexpected of testCase.expectedNotContains || []) {
      assert.ok(!result.includes(unexpected), `Result should not contain "${unexpected}"\n---\n${result}`);
    }
  }

  {
    // A function inside the options object has parentheses of its own. The
    // registrations must follow the whole constructor call, not its first `)`.
    const shapes = [
      {
        name: 'method shorthand',
        option: '  errorHandler(error, instance, info) {\n    console.error(error, info);\n  },',
        after: '});',
      },
      {
        name: 'expression arrow',
        option: '  errorHandler: (err) => console.warn(err),',
        after: '});',
      },
      {
        name: 'block-bodied arrow',
        option: '  errorHandler: (err) => { console.warn(err); },',
        after: '});',
      },
      {
        name: 'function expression',
        option: '  errorHandler: function (err) { console.warn(err); },',
        after: '});',
      },
      {
        name: 'a closing parenthesis inside a string literal',
        option: "  title: 'Done ) yet',\n  errorHandler(err) { console.warn(err); },",
        after: '});',
      },
    ];
    for (const shape of shapes) {
      const source = ['const app = new AvenxApp({', "  target: '#app',", shape.option, '});', ''].join('\n');
      const result = entryModule({ source, registrations: [registrations[0]] });
      assert.ok(
        result.includes(`${shape.after}\napp.registerPage("Home", __avx_page_0);`),
        `registrations must follow the whole constructor call (${shape.name}), got:\n${result}`,
      );
    }
  }

  {
    // A project with no pages and no bridges gets its own file back, plus the
    // prelude, and nothing injected into it.
    const bare = entryModule({ source: 'const app = new AvenxApp({});\n', registrations: [] });
    assert.ok(!bare.includes('register'), 'nothing is injected when there is nothing to register');

    const withPrelude = entryModule({
      source: 'const app = new AvenxApp({});\n',
      registrations: [],
      prelude: ['/project/src/__avenx_globals__.js'],
    });
    assert.ok(
      withPrelude.startsWith('import "/project/src/__avenx_globals__.js";'),
      'the prelude is imported before anything else',
    );
  }

  {
    // Two apps (host plus embedded widget, #1813): each page is registered on
    // the app whose route table names it, after that app's constructor call.
    // Before the fix both pages landed on the first app and the widget's
    // routes failed with AVX_R02.
    const twoAppSource = [
      "import { AvenxApp } from 'avenx-core/runtime';",
      '',
      "const hostApp = new AvenxApp({ target: '#app' });",
      "hostApp.initRouter({ '/': 'Home', '*': 'Home' });",
      '',
      "const widgetApp = new AvenxApp({ target: '#widget' });",
      "widgetApp.initRouter({ '/home': 'Widgethome', '*': 'Widgethome' }, { prefix: '/widget' });",
      '',
    ].join('\n');
    const twoAppRegistrations = [
      { name: 'Home', file: '/project/src/pages/home.page.js', kind: 'page' },
      { name: 'Widgethome', file: '/project/src/pages/widgethome.page.js', kind: 'page' },
    ];
    const twoApp = entryModule({ source: twoAppSource, registrations: twoAppRegistrations });
    assert.ok(
      twoApp.includes('hostApp.registerPage("Home", __avx_page_0);'),
      `Home must register on hostApp:\n${twoApp}`,
    );
    assert.ok(
      twoApp.includes('widgetApp.registerPage("Widgethome", __avx_page_1);'),
      `Widgethome must register on widgetApp:\n${twoApp}`,
    );
    assert.ok(
      !twoApp.includes('hostApp.registerPage("Widgethome"'),
      `Widgethome must not register on hostApp:\n${twoApp}`,
    );
    assert.ok(
      twoApp.indexOf('hostApp.registerPage("Home"') > twoApp.indexOf('const hostApp = new AvenxApp'),
      'the host registration must follow the host constructor',
    );
    assert.ok(
      twoApp.indexOf('widgetApp.registerPage("Widgethome"') > twoApp.indexOf('const widgetApp = new AvenxApp'),
      'the widget registration must follow the widget constructor',
    );

    // A page named by two routers registers on both apps.
    const sharedSource = [
      "const firstApp = new AvenxApp({ target: '#one' });",
      "firstApp.initRouter({ '/': 'Shared' });",
      "const secondApp = new AvenxApp({ target: '#two' });",
      "secondApp.initRouter({ '/': 'Shared' });",
      '',
    ].join('\n');
    const shared = entryModule({
      source: sharedSource,
      registrations: [{ name: 'Shared', file: '/project/src/pages/shared.page.js', kind: 'page' }],
    });
    assert.ok(shared.includes('firstApp.registerPage("Shared", __avx_page_0);'), `Shared must register on firstApp:\n${shared}`);
    assert.ok(shared.includes('secondApp.registerPage("Shared", __avx_page_0);'), `Shared must register on secondApp:\n${shared}`);
    assert.ok(
      (shared.match(/import __avx_page_0 from/g) || []).length === 1,
      'a page shared by two apps is imported once',
    );

    // A page no router names stays on the first app, as before, so the
    // unreachable-page reasoning still sees it. Bridges have no route table
    // and stay on the first app too.
    const unowned = entryModule({
      source: sharedSource,
      registrations: [
        { name: 'Orphan', file: '/project/src/pages/orphan.page.js', kind: 'page' },
        { name: 'Auth', file: '/project/src/bridges/auth.bridge.js', kind: 'bridge' },
      ],
    });
    assert.ok(unowned.includes('firstApp.registerPage("Orphan", __avx_page_0);'), `Orphan must stay on firstApp:\n${unowned}`);
    assert.ok(!unowned.includes('secondApp.registerPage("Orphan"'), `Orphan must not land on secondApp:\n${unowned}`);
    assert.ok(unowned.includes('firstApp.registerBridge("Auth", __avx_bridge_1);'), `bridges stay on firstApp:\n${unowned}`);

    // Object-form route values ({ page, guards }) name their page too, and a
    // lazy page owned by the second app gets its lazy call there.
    const objectForm = entryModule({
      source: [
        "const hostApp = new AvenxApp({ target: '#app' });",
        "hostApp.initRouter({ '#/secret': { page: 'Secret', guards: [] } });",
        "const widgetApp = new AvenxApp({ target: '#widget' });",
        "widgetApp.initRouter({ '/home': 'Widgethome' });",
        '',
      ].join('\n'),
      registrations: [
        { name: 'Secret', file: '/project/src/pages/secret.page.js', kind: 'page' },
        { name: 'Widgethome', file: '/project/src/pages/widgethome.page.js', kind: 'page', lazy: true },
      ],
    });
    assert.ok(objectForm.includes('hostApp.registerPage("Secret", __avx_page_0);'), `object-form page must register on hostApp:\n${objectForm}`);
    assert.ok(
      objectForm.includes('widgetApp.registerPage("Widgethome", () => import("./pages/widgethome.page.js"));'),
      `lazy page must register on widgetApp:\n${objectForm}`,
    );

    // With // @avenx-inject, both receivers' calls land at the marker, and
    // the marker is gone.
    const withMarker = entryModule({
      source: [
        "const hostApp = new AvenxApp({ target: '#app' });",
        "hostApp.initRouter({ '/': 'Home' });",
        "const widgetApp = new AvenxApp({ target: '#widget' });",
        "widgetApp.initRouter({ '/home': 'Widgethome' });",
        '// @avenx-inject',
        'hostApp.mount();',
        '',
      ].join('\n'),
      registrations: twoAppRegistrations,
    });
    assert.ok(!withMarker.includes('// @avenx-inject'), 'the marker must be replaced');
    assert.ok(withMarker.includes('hostApp.registerPage("Home", __avx_page_0);'), `marker build must keep Home on hostApp:\n${withMarker}`);
    assert.ok(withMarker.includes('widgetApp.registerPage("Widgethome", __avx_page_1);'), `marker build must keep Widgethome on widgetApp:\n${withMarker}`);
    assert.ok(
      withMarker.indexOf('widgetApp.registerPage("Widgethome"') < withMarker.indexOf('hostApp.mount();'),
      'the injected block must sit at the marker, before mount',
    );
  }
  console.log('  ✅ Entry module generation tests passed!');

  console.log('🧪 Testing component and bridge module generation...');
  {
    const module = componentModule({
      className: 'Counter',
      body: 'class Counter extends AvenxComponent {}',
      isPage: false,
      imports: ["import cart from '../bridges/cart.bridge.js';"],
      bridgeBindings: [{ local: 'cart', binding: '__avenx_bridge_cart', bridge: 'cart' }],
    });

    assert.ok(
      /^import \{ AvenxComponent, [^}]*\} from "avenx-core\/runtime";$/m.test(module),
      'the base class is imported',
    );
    assert.ok(
      module.includes('axGet') && module.includes('axRead'),
      'the expression primitives the compiled closures call are imported alongside it',
    );
    assert.ok(module.includes("import cart from '../bridges/cart.bridge.js';"), 'the bridge import is preserved');
    assert.ok(
      module.includes('const __avenx_bridge_cart = cart;'),
      'the stable binding the class body uses is aliased to the local name',
    );
    assert.ok(module.includes('export default Counter;'), 'the class is exported');

    const page = componentModule({
      className: 'Home',
      body: 'class Home extends AvenxPage {}',
      isPage: true,
      imports: [],
      bridgeBindings: [],
    });
    assert.ok(
      /^import \{ AvenxPage, [^}]*\} from "avenx-core\/runtime";$/m.test(page),
      'a page extends AvenxPage',
    );
  }

  {
    const module = bridgeModule({
      name: 'cart',
      binding: '__avenx_bridge_cart',
      source: "import { bridge } from 'avenx-core/runtime';\n\nexport default bridge({ state: { items: [] } });\n",
    });

    assert.ok(module.includes("import { bridge } from 'avenx-core/runtime';"), "the bridge's own imports survive");
    assert.ok(module.includes('const __avenx_bridge_cart = bridge({'), 'the default export is given a name');
    assert.ok(module.includes('__avx_defineBridgeName("cart", __avenx_bridge_cart);'), 'the runtime is told its name');
    assert.ok(module.includes('export default __avenx_bridge_cart;'), 'and it is exported for importers');
  }

  {
    const source = [
      "import a from './a.js';",
      'const notAnImport = "import b from \'./b.js\';";',
      "import { c, d } from './cd.js';",
      'void notAnImport;',
    ].join('\n');
    assert.deepEqual(collectImportStatements(source), ["import a from './a.js';", "import { c, d } from './cd.js';"]);
  }
  console.log('  ✅ Component and bridge module generation tests passed!');

  console.log('🧪 Testing page chunk module generation...');
  {
    // A chunk cannot import the runtime -- it is loaded outside the bundle --
    // so the class body below reports what the prelude resolved. `axGet` is
    // what a compiled interpolation calls first, and what used to be
    // `undefined` in a browser (AVX_R08 "axGet is not a function").
    const chunk = pageChunkModule({
      className: 'Home',
      body: [
        'class Home extends AvenxPage {',
        '  static resolved() {',
        `    return { ${PAGE_CHUNK_RUNTIME_NAMES.join(', ')} };`,
        '  }',
        '}',
      ].join('\n'),
    });

    assert.ok(!chunk.includes("from 'avenx-core/runtime'"), 'a chunk carries no static import of the runtime');
    assert.ok(!/if \(!AvenxPage\)/.test(chunk), 'the fallback is no longer gated on the base class alone');
    for (const name of PAGE_CHUNK_RUNTIME_NAMES) {
      assert.ok(chunk.includes(`let ${name} = _Avenx.${name};`), `${name} is read from the namespace first`);
      assert.ok(
        chunk.includes(`${name} = ${name} === undefined ? _rt.${name} : ${name};`),
        `${name} falls back to the import only when it is missing`,
      );
    }

    const tempChunkDir = path.join(__dirname, 'temp_compiler_chunk_test');
    fs.mkdirSync(tempChunkDir, { recursive: true });
    const chunkPath = path.join(tempChunkDir, 'home.page.js');
    fs.writeFileSync(chunkPath, chunk);

    const hadNamespace = Object.prototype.hasOwnProperty.call(globalThis, 'Avenx');
    const previousNamespace = globalThis.Avenx;
    try {
      // The namespace an unsplit bundle publishes: the public globals and the
      // plugin members, so `AvenxPage` is present and every helper is not.
      // This is the shape the browser saw, and the chunk must not take the
      // base class as proof that the helpers are there too.
      const narrowNamespace = {};
      for (const name of [...PUBLIC_GLOBALS, ...NAMESPACE_MEMBERS]) {
        narrowNamespace[name] = class Stub {};
      }
      globalThis.Avenx = narrowNamespace;

      const fromNarrow = await import(`${pathToFileURL(chunkPath).href}?narrow`);
      const resolved = fromNarrow.default.resolved();
      assert.strictEqual(resolved.AvenxPage, narrowNamespace.AvenxPage, 'the base class comes from the namespace');
      for (const name of PAGE_CHUNK_RUNTIME_NAMES) {
        assert.strictEqual(
          typeof resolved[name],
          'function',
          `${name} is resolved even though the namespace does not carry it`,
        );
      }

      // The namespace a split bundle publishes: everything the chunk needs.
      // Each name is taken from there, and nothing is imported in its place.
      const fullNamespace = {};
      for (const name of PAGE_CHUNK_RUNTIME_NAMES) {
        fullNamespace[name] = function published() {};
      }
      globalThis.Avenx = fullNamespace;

      const fromFull = await import(`${pathToFileURL(chunkPath).href}?full`);
      const published = fromFull.default.resolved();
      for (const name of PAGE_CHUNK_RUNTIME_NAMES) {
        assert.strictEqual(published[name], fullNamespace[name], `${name} is the one the bundle published`);
      }
    } finally {
      if (hadNamespace) {
        globalThis.Avenx = previousNamespace;
      } else {
        delete globalThis.Avenx;
      }
      fs.rmSync(tempChunkDir, { recursive: true, force: true });
    }
  }
  console.log('  ✅ Page chunk module generation tests passed!');

  console.log('🧪 Testing guard and page compilation...');
  {
    const tempGuardsDir = path.join(__dirname, 'temp_compiler_guards_test_src');
    const tempGuardsSubDir = path.join(tempGuardsDir, 'guards');
    fs.mkdirSync(tempGuardsSubDir, { recursive: true });

    const guardPath = path.join(tempGuardsSubDir, 'custom.guard.js');
    fs.writeFileSync(
      guardPath,
      `import { AvenxGuard } from 'avenx-core/runtime';
import { someHelper } from '../helpers/some-helper.js';

export default class CustomGuard extends AvenxGuard {
  async check() {
    const dynamic = await import('./dynamic-check.js');
    return dynamic.check() && someHelper();
  }
}
`,
    );

    const guardsCompiler = new AvenxCompiler();
    guardsCompiler.srcDir = tempGuardsDir;
    const modules = new Map();
    guardsCompiler.processGuards(modules);

    const guard = modules.get(path.resolve(guardPath));
    assert.ok(guard, 'the guard is registered as a module');
    assert.ok(guard.includes('class CustomGuard extends AvenxGuard'), 'the class survives');
    assert.ok(guard.includes("import('./dynamic-check.js')"), 'the dynamic import survives');
    // Inverted deliberately: these used to be stripped, which is what left a
    // guard's bridge import resolving to `undefined` at runtime.
    assert.ok(guard.includes("from 'avenx-core/runtime'"), 'the runtime import survives');
    assert.ok(guard.includes('some-helper.js'), 'the helper import survives, to be resolved by the bundler');
    assert.ok(guard.includes('export default'), 'the export survives, because a module has exports');

    fs.rmSync(tempGuardsDir, { recursive: true, force: true });
  }

  {
    const tempPagesDir = path.join(__dirname, 'temp_compiler_pages_test');
    const pagesDir = path.join(tempPagesDir, 'pages');
    fs.mkdirSync(pagesDir, { recursive: true });

    const pagePath = path.join(pagesDir, 'home.page.js');
    fs.writeFileSync(pagePath, '<MyCard />');

    const pagesCompiler = new AvenxCompiler();
    pagesCompiler.srcDir = tempPagesDir;

    const modules = new Map();
    const registered = [];
    pagesCompiler.processPages(modules, registered);

    const page = modules.get(path.resolve(pagePath));
    assert.ok(page, 'the page is registered as a module');
    // The template is emitted as a JSON string literal, so its inner quotes are
    // backslash-escaped in the generated source. Match either encoding so this
    // asserts the tag transformation rather than the literal's quoting style.
    assert.ok(
      /<div data-avenx-comp=\\?"MyCard\\?"><\/div>/.test(page),
      'Self-closing component tag should be converted to a standard component element',
    );
    assert.deepEqual(
      registered,
      [{ name: 'Home', file: path.resolve(pagePath), kind: 'page' }],
      'the page is queued for registration in the entry module',
    );

    fs.rmSync(tempPagesDir, { recursive: true, force: true });
  }
  console.log('  ✅ Guard and page compilation tests passed!');
  console.log('  ✅ AvenxCompiler tests passed!');
} catch (error) {
  console.error('❌ AvenxCompiler tests failed!');
  console.error(error);
  process.exit(1);
}

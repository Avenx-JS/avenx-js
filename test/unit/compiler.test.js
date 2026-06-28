const assert = require('assert');
const path = require('path');
const fs = require('fs');
const AvenxCompiler = require('../../lib/compiler');

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
                "app.registerBridge('Auth', Auth);"
            ]
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
                "myApp.registerBridge('Auth', Auth);"
            ]
        },
        {
            name: 'Variable type "let window.app = new AvenxApp()"',
            mainContent: `
                window.app = new AvenxApp({ target: '#app' });
            `,
            registrations: "app.registerPage('Home', Home);",
            expectedContains: [
                "window.app = new AvenxApp({ target: '#app' });",
                "window.app.registerPage('Home', Home);"
            ]
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
                "myApp.mount();"
            ],
            expectedNotContains: [
                "// @avenx-inject"
            ]
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
            expectedContains: [
                "myApp.registerPage('Home', Home);"
            ]
        }
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
    
    console.log('  ✅ AvenxCompiler tests passed!');
} catch (error) {
    console.error('❌ AvenxCompiler tests failed!');
    console.error(error);
    process.exit(1);
}

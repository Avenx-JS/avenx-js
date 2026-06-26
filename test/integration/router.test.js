const assert = require('assert');
const { AvenxApp } = require('../../lib/core/runtime/AvenxApp');
const { AvenxRouter } = require('../../lib/core/runtime/AvenxRouter');
const { AvenxGuard } = require('../../lib/core/runtime/AvenxGuard');
const { AvenxPage } = require('../../lib/core/runtime/AvenxPage');

(async () => {
    try {
        console.log('🧪 Testing Router and Guards...');

        // Setup mock elements and global object mocks
        const mockElement = {
            innerHTML: '',
            querySelector: () => null,
            querySelectorAll: () => [],
            attributes: [],
            hasAttribute: () => false,
            setAttribute: () => { },
            removeAttribute: () => { },
            appendChild: () => { },
            removeChild: () => { },
            replaceWith: () => { },
            childNodes: []
        };

        global.document = {
            querySelector: () => mockElement,
            querySelectorAll: () => []
        };

        global.DOMParser = class {
            parseFromString() {
                return { body: mockElement };
            }
        };
        global.Node = { ELEMENT_NODE: 1, TEXT_NODE: 3 };

        let hashListeners = [];
        global.window = {
            addEventListener: (event, cb) => {
                if (event === 'hashchange') hashListeners.push(cb);
            },
            removeEventListener: (event, cb) => {
                if (event === 'hashchange') hashListeners = hashListeners.filter(l => l !== cb);
            },
            location: {
                _hash: '',
                get hash() { return this._hash; },
                set hash(val) {
                    this._hash = val;
                    hashListeners.forEach(listener => listener());
                }
            }
        };

        // Create a mock page component
        let mountedPageName = null;
        let mountedParams = null;

        class TestPage extends AvenxPage {
            constructor(bridges, componentRegistry) {
                super(
                    {}, // initialState
                    {}, // computed
                    bridges,
                    '<div>Test Page</div>',
                    {
                        onUpdate: () => {
                            mountedPageName = this.constructor.name;
                            mountedParams = this.params;
                        }
                    },
                    componentRegistry
                );
            }
            mount(target) {
                super.mount(target);
                mountedPageName = this.constructor.name;
                mountedParams = this.params;
            }
        }

        const app = new AvenxApp({ target: '#app' });
        app.registerPage('TestPage', TestPage);

        // Guard definitions
        let allowTransition = true;
        let guardCalled = false;
        let redirectTarget = null;

        class MockGuard extends AvenxGuard {
            canActivate(to, from) {
                guardCalled = true;
                if (redirectTarget) return redirectTarget;
                return allowTransition;
            }
        }

        app.initRouter({
            '#/': 'TestPage',
            '#/items*': 'TestPage',
            '#/user/:userId': {
                page: 'TestPage',
                guards: [MockGuard]
            },
            '#/redirect': {
                page: 'TestPage',
                guards: [MockGuard]
            }
        });
        await new Promise(resolve => setTimeout(resolve, 0));

        // 1. Static Route Match
        window.location.hash = '#/';
        await new Promise(resolve => setTimeout(resolve, 0));
        assert.strictEqual(mountedPageName, 'TestPage');
        assert.deepStrictEqual(mountedParams, {});

        // Reset tracking
        mountedPageName = null;
        mountedParams = null;
        guardCalled = false;

        // 2. Dynamic Route Match with Parameters & Guards (Allow)
        allowTransition = true;
        redirectTarget = null;
        window.location.hash = '#/user/42?ref=test';
        await new Promise(resolve => setTimeout(resolve, 0));

        assert.strictEqual(guardCalled, true, 'Guard should have been called');
        assert.strictEqual(mountedPageName, 'TestPage');
        assert.strictEqual(mountedParams.userId, '42', 'Should parse userId parameter');
        assert.deepStrictEqual(mountedParams.query, { ref: 'test' }, 'Should parse query parameter');

        // Reset tracking
        mountedPageName = null;
        mountedParams = null;
        guardCalled = false;

        // 3. Guards (Deny)
        allowTransition = false;
        const prevHash = window.location.hash; // '#/user/42?ref=test'
        window.location.hash = '#/user/99';
        await new Promise(resolve => setTimeout(resolve, 0));

        assert.strictEqual(guardCalled, true, 'Guard should have been called');
        assert.strictEqual(mountedPageName, null, 'Page should not be mounted when transition is denied');
        assert.strictEqual(window.location.hash, prevHash, 'Hash should revert to previous value');

        // Reset tracking
        mountedPageName = null;
        mountedParams = null;
        guardCalled = false;

        // 4. Guards (Redirect)
        allowTransition = true;
        redirectTarget = '#/';
        window.location.hash = '#/redirect';
        await new Promise(resolve => setTimeout(resolve, 0));

        assert.strictEqual(guardCalled, true, 'Guard should have been called');
        assert.strictEqual(window.location.hash, '#/', 'Hash should be redirected to redirect target');
        assert.strictEqual(mountedPageName, 'TestPage');

        // Reset tracking
        mountedPageName = null;
        mountedParams = null;
        guardCalled = false;

        // 5. Secondary anchor should be ignored
        allowTransition = true;
        redirectTarget = null;

        window.location.hash = '#/user/42#details';
        await new Promise(resolve => setTimeout(resolve, 0));

        assert.strictEqual(
            mountedPageName,
            'TestPage',
            'Route should match even with secondary anchor'
        );
        assert.strictEqual(
            mountedParams.userId,
            '42',
            'Should parse params while ignoring secondary anchor'
        );

        // Reset tracking
        mountedPageName = null;
        mountedParams = null;

        // 6. Secondary anchor after query should be ignored
        window.location.hash = '#/user/42?ref=test#specs';
        await new Promise(resolve => setTimeout(resolve, 0));

        assert.strictEqual(
            mountedPageName,
            'TestPage',
            'Route with query and secondary anchor should match'
        );
        assert.strictEqual(
            mountedParams.userId,
            '42'
        );
        assert.deepStrictEqual(
            mountedParams.query,
            { ref: 'test' }
        );

        // 7. Literal asterisk route should match correctly
        mountedPageName = null;
        mountedParams = null;

        window.location.hash = '#/items*';
        await new Promise(resolve => setTimeout(resolve, 0));

        assert.strictEqual(
            mountedPageName,
            'TestPage',
            'Route containing a literal * should match correctly'
        );

        // Reset tracking
        mountedPageName = null;
        mountedParams = null;

        // 8. Malformed URI parameters should not crash routing
        window.location.hash = '#/user/%E0%A4%A';
        await new Promise(resolve => setTimeout(resolve, 0));

        assert.strictEqual(
            mountedPageName,
            'TestPage',
            'Router should still mount the page when URI decoding fails'
        );

        assert.strictEqual(
            mountedParams.userId,
            '%E0%A4%A',
            'Router should fall back to the raw parameter value'
        );

        // 9. Duplicate page registration should warn
        const originalWarn = console.warn;
        let warningMessage = '';

        console.warn = msg => {
            warningMessage = msg;
        };

        app.registerPage('TestPage', TestPage);

        assert.ok(
            warningMessage.includes('already registered'),
            'Expected duplicate page registration warning'
        );

        console.warn = originalWarn;

        console.log('  ✅ Router and Guards tests passed!');
    } catch (error) {
        console.error('❌ Router and Guards tests failed!');
        console.error(error);
        process.exit(1);
    }
})();

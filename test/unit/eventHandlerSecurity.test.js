/**
 * @file event_handler_security.test.js
 * @description The security boundary around inline event handlers, end to end.
 *
 * `lib/core/expression/evaluator.js` documents what it guarantees: an
 * expression cannot reach the `Function` constructor, cannot read
 * `constructor` / `__proto__` / `prototype` however the key is spelled, and
 * cannot name a global outside its allowlist. Those guarantees are properties
 * of the AST evaluator, and until recently **no inline event handler reached
 * it**: `EventExecutor` compiled every handler with `new Function` and handed
 * the closure to the legacy proxy sandbox, which the evaluator's own docblock
 * describes as escapable.
 *
 * The consequence was not theoretical. A handler body of
 *
 *   ({})['const'+'ructor']['const'+'ructor']('this.__x = 1')()
 *
 * ran with `this` bound to the global object, because the object literal is
 * created inside the expression and never passes through the sandbox proxy, and
 * the property name is assembled at runtime so no source-text check finds it.
 *
 * These tests mount a real component with a real `data-ax-event` binding and
 * dispatch a real event, because that is the path an application takes and the
 * path that was not covered. Everything else about the sandbox is tested
 * against the evaluator directly, where it always held.
 *
 * Lives under `test/unit/` because that is the tier the runner gives a real
 * DOM; the integration tier hand-rolls minimal mocks that cannot dispatch an
 * event through delegation.
 */
import assert from 'assert';
import { AvenxComponent } from '../../lib/core/index.js';
import { getFallbackReport, clearExpressionCache } from '../../lib/core/expression/compile.js';

/**
 * Builds a component whose only button carries the given handler source.
 * @param {string} handler - The handler body, as written in a template.
 * @param {object} [state] - Initial state.
 * @returns {{host: Element, component: AvenxComponent, click: Function}} The mount.
 */
function mountWithHandler(handler, state = { n: 0 }) {
  const attribute = JSON.stringify({ click: handler })
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;');

  /** A component with one bound button. */
  class Probe extends AvenxComponent {
    /**
     * @param {object} bridges - Bridges.
     * @param {object} props - Props.
     */
    constructor(bridges, props) {
      super(
        { ...state },
        {},
        bridges,
        `<div><span data-testid="out">{{ n }}</span><button id="b" data-ax-event="${attribute}">go</button></div>`,
        {},
        props,
        {},
        {},
      );
    }
  }

  const host = document.createElement('div');
  document.body.appendChild(host);
  const component = new Probe({}, {});
  component.mount(host);

  return {
    host,
    component,
    click: () => {
      const button = host.querySelector('#b');
      button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    },
  };
}

/**
 * Counts `new Function` constructions while a body runs.
 * @param {Function} body - The code to observe.
 * @returns {string[]} The sources compiled, if any.
 */
function compiledSourcesDuring(body) {
  const RealFunction = globalThis.Function;
  const sources = [];
  globalThis.Function = new Proxy(RealFunction, {
    /**
     * @param {Function} target - The real Function constructor.
     * @param {any[]} args - Constructor arguments.
     * @returns {Function} The compiled function.
     */
    construct(target, args) {
      sources.push(String(args[args.length - 1]));
      return Reflect.construct(target, args);
    },
  });
  try {
    body();
  } finally {
    globalThis.Function = RealFunction;
  }
  return sources;
}

/**
 * The escape that used to work through an inline handler must be refused.
 */
function testConstructorEscapeIsRefused() {
  console.log('🧪 Testing the constructor escape is refused in an event handler...');

  delete globalThis.__avenx_escape_probe;

  const payloads = [
    "({})['const'+'ructor']['const'+'ructor']('this.__avenx_escape_probe = 1')()",
    "[]['fil'+'ter']['const'+'ructor']('this.__avenx_escape_probe = 1')()",
    "(function(){}).constructor('this.__avenx_escape_probe = 1')()",
    '({}).__proto__',
  ];

  for (const payload of payloads) {
    const { click, component } = mountWithHandler(payload);
    // The handler is expected to fail. What must not happen is that it works.
    try {
      click();
    } catch {
      // Refusal may surface as a throw; either way the probe must be untouched.
    }
    component.unmount();

    assert.strictEqual(
      globalThis.__avenx_escape_probe,
      undefined,
      `an inline handler must not reach the Function constructor: ${payload}`,
    );
  }
}

/**
 * A restricted global is refused from an inline handler.
 */
function testRestrictedGlobalsAreRefused() {
  console.log('🧪 Testing restricted globals are refused in an event handler...');

  delete globalThis.__avenx_global_probe;

  for (const payload of ['globalThis.__avenx_global_probe = 1', 'window.__avenx_global_probe = 1']) {
    const { click, component } = mountWithHandler(payload);
    try {
      click();
    } catch {
      // Expected.
    }
    component.unmount();
    assert.strictEqual(
      globalThis.__avenx_global_probe,
      undefined,
      `an inline handler must not name a restricted global: ${payload}`,
    );
  }
}

/**
 * An ordinary handler runs, and compiles nothing.
 *
 * The security fix would be worthless if it worked by breaking handlers, and
 * the performance claim in the deployment guide -- "an application whose action
 * bodies are expression-only needs no 'unsafe-eval'" -- is only true if the
 * ordinary case takes the parsed path.
 */
function testOrdinaryHandlerRunsWithoutEval() {
  console.log('🧪 Testing an ordinary handler runs and compiles nothing...');

  clearExpressionCache();
  const { host, click, component } = mountWithHandler('n = n + 1');

  const sources = compiledSourcesDuring(() => {
    click();
  });

  assert.deepStrictEqual(
    sources,
    [],
    `@click="n = n + 1" must not construct a Function, but compiled: ${JSON.stringify(sources)}`,
  );
  assert.strictEqual(component.state.n, 1, 'and the handler must actually have run');

  // The fallback report is the documented way to answer "does this application
  // still need 'unsafe-eval'?". It was blind to event handlers, because the
  // event path never consulted the expression compiler at all.
  assert.deepStrictEqual(
    getFallbackReport(),
    [],
    'an expression-only handler must not appear in the fallback report',
  );

  component.unmount();
  host.remove();
}

testConstructorEscapeIsRefused();
testRestrictedGlobalsAreRefused();
testOrdinaryHandlerRunsWithoutEval();

console.log('✅ Event handler security tests passed.');

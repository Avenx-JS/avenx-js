/**
 * @file eventExecutor.test.js
 * @description What an EventExecutor hands to the component, and what it does not.
 *
 * The contract changed with the compiled renderer, and the change is the point
 * of these tests rather than incidental to them.
 *
 * The executor used to compile every handler with
 * `new Function("with(state){with(methods){ ... }}")` and pass the resulting
 * closure down. Because `DynamicEvaluator.executeStatement` takes the legacy
 * proxy-sandbox path whenever it is given a function, that meant **no inline
 * event handler ever reached the AST evaluator** -- so an application needed
 * `'unsafe-eval'` as soon as it contained one `@click`, and the evaluator's
 * guarantees did not hold on the busiest path in the framework.
 *
 * It now hands over the source. `executeStatement` parses first and falls back
 * to `new Function` only for bodies that are real statements, which is what the
 * deployment guide has always described.
 */
import assert from 'assert';
import { EventExecutor } from '../../lib/core/events/eventExecutor.js';
import { logger } from '../../lib/core/runtime/AvenxLogger.js';
import { DynamicEvaluator } from '../../lib/core/security/evaluator.js';

/**
 * Builds a minimal event with the shape the executor reads for diagnostics.
 * @param {string} tagName - The target's tag name.
 * @param {string} eventType - The event type.
 * @param {string} componentName - The owning component, for log context.
 * @returns {object} A mock event.
 */
function createMockEvent(tagName, eventType, componentName) {
  return {
    type: eventType,
    target: {
      tagName,
      __avenx_comp_instance: { $logContext: { componentName } },
    },
  };
}

/**
 * Counts `new Function` constructions while a body runs.
 * @param {Function} body - The code to observe.
 * @returns {{result: any, sources: string[]}} What it returned and what it compiled.
 */
function observeFunctionConstruction(body) {
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
    return { result: body(), sources };
  } finally {
    globalThis.Function = RealFunction;
  }
}

/**
 * The executor passes the handler source through, not a compiled closure.
 */
function testPassesSourceThrough() {
  console.log('🧪 Testing the executor hands over handler source...');

  let received = null;
  const executor = new EventExecutor((source, event) => {
    received = { source, event };
    return 'ran';
  });

  const event = createMockEvent('BUTTON', 'click', 'TestComp');
  const returned = executor.execute('count++', event);

  assert.strictEqual(returned, 'ran', 'the handler result reaches the caller');
  assert.strictEqual(typeof received.source, 'string', 'the handler must arrive as source, not as a function');
  assert.strictEqual(received.source, 'count++');
  assert.strictEqual(received.event, event);
}

/**
 * An expression-only handler compiles nothing.
 *
 * This is the regression that mattered: `@click="count++"` is the most common
 * line in any Avenx application, and it used to construct a `Function`.
 */
function testExpressionHandlerNeedsNoEval() {
  console.log('🧪 Testing an expression-only handler constructs no Function...');

  const evaluator = new DynamicEvaluator();
  const state = { count: 0 };
  const executor = new EventExecutor((source, event) =>
    evaluator.executeStatement(source, { count: state.count, event }, state),
  );

  const { sources } = observeFunctionConstruction(() => {
    executor.execute('count + 1', createMockEvent('BUTTON', 'click', 'C'));
    executor.execute('event.type', createMockEvent('BUTTON', 'click', 'C'));
  });

  assert.deepStrictEqual(
    sources,
    [],
    `an expression-only handler must take the AST evaluator, but compiled: ${JSON.stringify(sources)}`,
  );
}

/**
 * A handler that is genuinely a statement still falls back, and says so.
 *
 * The fallback is not a bug -- the expression parser covers the expression
 * language, and `if` / `return` / a declaration are not expressions. What was
 * a bug was taking it for handlers that did not need it.
 */
function testStatementHandlerStillFallsBack() {
  console.log('🧪 Testing a statement-syntax handler still falls back...');

  const evaluator = new DynamicEvaluator();
  const executor = new EventExecutor((source) =>
    evaluator.executeStatement(source, { count: 0 }, { count: 0 }),
  );

  const { sources } = observeFunctionConstruction(() => {
    executor.execute('if (count > 0) { count = 0; }', createMockEvent('BUTTON', 'click', 'C'));
  });

  assert.strictEqual(sources.length, 1, 'a real statement body is compiled');
  assert.ok(sources[0].includes('if (count > 0)'), 'and it is the handler that was compiled');
}

/**
 * A handler that throws is logged with the element and event that produced it,
 * and the error is re-thrown for the caller to handle.
 */
function testRuntimeErrorIsReportedWithContext() {
  console.log('🧪 Testing a throwing handler is reported with context...');

  const originalError = logger.error;
  const logged = [];
  logger.error = (msg, ctx) => logged.push({ msg, ctx });

  try {
    const executor = new EventExecutor(() => {
      throw new Error('boom');
    });

    let caught = null;
    try {
      executor.execute("throw new Error('boom')", createMockEvent('DIV', 'mouseover', 'TestComp'));
    } catch (error) {
      caught = error;
    }

    assert.ok(caught, 'the error reaches the caller');
    assert.strictEqual(caught.message, 'boom');

    const entry = logged[0];
    assert.ok(entry, 'the failure is logged');
    assert.strictEqual(entry.ctx.componentName, 'TestComp');
    assert.ok(entry.msg.includes('<DIV>'), 'the element is named');
    assert.ok(entry.msg.includes("'mouseover'"), 'the event is named');
    assert.ok(entry.msg.includes("throw new Error('boom')"), 'the handler source is named');
    assert.ok(entry.msg.includes('[AVX_R09]'), 'the diagnostic code is present');
  } finally {
    logger.error = originalError;
  }
}

/**
 * A handler that cannot be parsed at all is reported the same way.
 */
function testUnparseableHandlerIsReported() {
  console.log('🧪 Testing an unparseable handler is reported...');

  const originalError = logger.error;
  const logged = [];
  logger.error = (msg, ctx) => logged.push({ msg, ctx });

  try {
    const evaluator = new DynamicEvaluator();
    const executor = new EventExecutor((source) => evaluator.executeStatement(source, {}, {}));

    let thrown = null;
    try {
      executor.execute('class { foo() {', createMockEvent('SPAN', 'click', 'ErrorComp'));
    } catch (error) {
      thrown = error;
    }

    assert.ok(thrown, 'an unparseable handler fails rather than silently doing nothing');

    const entry = logged[0];
    assert.ok(entry, 'and it is logged');
    assert.strictEqual(entry.ctx.componentName, 'ErrorComp');
    assert.ok(entry.msg.includes('<SPAN>'));
    assert.ok(entry.msg.includes("'click'"));
    assert.ok(entry.msg.includes('class { foo() {'));
    assert.ok(entry.msg.includes('[AVX_R09]'));
  } finally {
    logger.error = originalError;
  }
}

/**
 * A torn-down executor refuses rather than silently doing nothing.
 */
function testTornDownExecutorRefuses() {
  console.log('🧪 Testing a torn-down executor refuses...');

  const executor = new EventExecutor(null);
  assert.throws(() => executor.execute('state.x = 1'), TypeError);

  const live = new EventExecutor(() => 'ok');
  assert.strictEqual(live.execute('x'), 'ok');
  live.teardown();
  assert.throws(() => live.execute('x'), TypeError, 'teardown must release the handler');
}

testPassesSourceThrough();
testExpressionHandlerNeedsNoEval();
testStatementHandlerStillFallsBack();
testRuntimeErrorIsReportedWithContext();
testUnparseableHandlerIsReported();
testTornDownExecutorRefuses();

console.log('✅ EventExecutor tests passed.');

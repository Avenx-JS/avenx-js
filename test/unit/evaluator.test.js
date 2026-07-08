const assert = require('assert');
const { DynamicEvaluator } = require('../../lib/core/security/evaluator');

try {
  console.log('Testing DynamicEvaluator expression evaluation, statement execution, and method map creation...');

  const evaluator = new DynamicEvaluator();

  // =========================================================================
  //  1. Expression Evaluation
  // =========================================================================
  console.log('  Testing evaluateExpression...');

  // 1a. Simple expression with scope variables
  let result = evaluator.evaluateExpression('count * 2', { count: 5 });
  assert.strictEqual(result, 10, 'Expression "count * 2" with count=5 should return 10');

  // 1b. Expression with multiple scope variables
  result = evaluator.evaluateExpression('a + b * c', { a: 1, b: 2, c: 3 });
  assert.strictEqual(result, 7, 'Expression "a + b * c" with a=1, b=2, c=3 should return 7');

  // 1c. Expression using string values
  result = evaluator.evaluateExpression('`Hello, ${name}!`', { name: 'Avenx' });
  assert.strictEqual(result, 'Hello, Avenx!', 'Template literal expression should evaluate correctly');

  // 1d. Expression with boolean logic
  result = evaluator.evaluateExpression('isActive && count > 0', { isActive: true, count: 3 });
  assert.strictEqual(result, true, 'Boolean expression should return true');
  result = evaluator.evaluateExpression('isActive && count > 0', { isActive: false, count: 3 });
  assert.strictEqual(result, false, 'Boolean expression with false flag should return false');

  // 1e. Expression with ternary operator
  result = evaluator.evaluateExpression('age >= 18 ? "adult" : "minor"', { age: 20 });
  assert.strictEqual(result, 'adult', 'Ternary expression should return "adult"');
  result = evaluator.evaluateExpression('age >= 18 ? "adult" : "minor"', { age: 15 });
  assert.strictEqual(result, 'minor', 'Ternary expression should return "minor"');

  // 1f. Expression with array access
  result = evaluator.evaluateExpression('items[0]', { items: ['first', 'second'] });
  assert.strictEqual(result, 'first', 'Array access expression should return "first"');

  // 1g. Expression with object property access
  result = evaluator.evaluateExpression('user.name', { user: { name: 'John' } });
  assert.strictEqual(result, 'John', 'Object property access expression should return "John"');

  // 1h. Expression with thisArg override
  const customThis = { multiplier: 3 };
  result = evaluator.evaluateExpression('this.multiplier * value', { value: 4 }, customThis);
  assert.strictEqual(result, 12, 'Expression with custom thisArg should use the provided context');

  // 1i. Expression with empty scope (only literal)
  result = evaluator.evaluateExpression('42', {});
  assert.strictEqual(result, 42, 'Literal expression with empty scope should return the literal');

  // 1j. Expression with nullish coalescing
  result = evaluator.evaluateExpression('value ?? "default"', { value: null });
  assert.strictEqual(result, 'default', 'Nullish coalescing with null should return fallback');

  // 1k. Expression evaluating to falsey values
  result = evaluator.evaluateExpression('count', { count: 0 });
  assert.strictEqual(result, 0, 'Expression evaluating to 0 should work correctly');
  result = evaluator.evaluateExpression('flag', { flag: false });
  assert.strictEqual(result, false, 'Expression evaluating to false should work correctly');

  // 1l. Invalid variable name silently skipped in scope bindings
  result = evaluator.evaluateExpression('"ok"', { 'invalid-name': 'should-not-appear' });
  assert.strictEqual(result, 'ok', 'Scope entries with invalid identifiers should not break evaluation');

  console.log('  evaluateExpression tests passed');

  // =========================================================================
  //  2. Statement Execution
  // =========================================================================
  console.log('  Testing executeStatement...');

  // 2a. Simple assignment statement (mutates scope via with(this))
  const scope1 = { count: 0 };
  evaluator.executeStatement('count = 10', scope1);
  assert.strictEqual(scope1.count, 10, 'Statement "count = 10" should mutate the scope variable');

  // 2b. Multiple statements
  const scope2 = { x: 1, y: 2 };
  evaluator.executeStatement('x = x + 1; y = y * 2;', scope2);
  assert.strictEqual(scope2.x, 2, 'After "x = x + 1", x should be 2');
  assert.strictEqual(scope2.y, 4, 'After "y = y * 2", y should be 4');

  // 2c. Statement that invokes a method on scope value
  const scope3 = { items: [] };
  evaluator.executeStatement('items.push("a"); items.push("b");', scope3);
  assert.deepStrictEqual(scope3.items, ['a', 'b'], 'Statements should mutate array in scope');

  // 2d. Statement using if-else
  const scope4 = { status: 'active', label: '' };
  evaluator.executeStatement('if (status === "active") { label = "ON"; } else { label = "OFF"; }', scope4);
  assert.strictEqual(scope4.label, 'ON', 'If-statement should assign "ON" when status is "active"');

  // 2e. Statement with custom thisArg
  // `with(this)` wraps thisArg, so bare identifiers resolve against thisArg
  // properties first, then function params.
  const scope5a = { val: 5 };
  const customThis2a = { val: 5, factor: 3 };
  const statementResultA = evaluator.executeStatement('val * this.factor', scope5a, customThis2a);
  assert.strictEqual(
    statementResultA,
    undefined,
    'executeStatement returns undefined for expression statements (no return)',
  );

  // 2f. Statement using loop
  const scope6 = { sum: 0, i: 0 };
  evaluator.executeStatement('for (let j = 0; j < 3; j++) { sum = sum + j; }', scope6);
  assert.strictEqual(scope6.sum, 3, 'Loop statement should accumulate sum (0+1+2 = 3)');

  // 2g. Statement with chained function calls
  const scope7 = { message: '' };
  evaluator.executeStatement('message = String(42).padStart(4, "0")', scope7);
  assert.strictEqual(scope7.message, '0042', 'Statement with chained function calls should work');

  // 2h. Statement with custom thisArg using explicit return
  const scope8 = { name: 'world' };
  const thisCtx = { prefix: 'Hello, ', name: 'world' };
  const statementResult8 = evaluator.executeStatement('return this.prefix + name', scope8, thisCtx);
  assert.strictEqual(
    statementResult8,
    'Hello, world',
    'Statement with return should use thisArg for "this" and name from with(thisArg)',
  );

  // 2i. Statement with only whitespace or empty
  evaluator.executeStatement('', {});
  console.log('  Empty/whitespace statement executed without error');

  console.log('  executeStatement tests passed');

  // =========================================================================
  //  3. Method Map Creation
  // =========================================================================
  console.log('  Testing createMethodMap...');

  // 3a. Method source strings with scope access
  const methods1 = {
    increment: 'state.count++',
    reset: 'state.count = 0',
  };
  const methodScope1 = { state: { count: 5 } };
  const methodMap1 = evaluator.createMethodMap(
    methods1,
    () => methodScope1,
    () => methodScope1,
  );
  assert.strictEqual(typeof methodMap1.increment, 'function', 'increment should be a function');
  assert.strictEqual(typeof methodMap1.reset, 'function', 'reset should be a function');
  methodMap1.increment();
  assert.strictEqual(methodScope1.state.count, 6, 'After increment(), count should be 6');
  methodMap1.reset();
  assert.strictEqual(methodScope1.state.count, 0, 'After reset(), count should be 0');

  // 3b. Methods that receive arguments via scope args binding
  const methods2 = {
    add: 'state.total = state.total + args[0]',
    multiply: 'state.total = state.total * args[0]',
  };
  const methodScope2 = { state: { total: 10 } };
  const methodMap2 = evaluator.createMethodMap(
    methods2,
    () => methodScope2,
    () => methodScope2,
  );
  methodMap2.add(5);
  assert.strictEqual(methodScope2.state.total, 15, 'After add(5), total should be 15');
  methodMap2.multiply(3);
  assert.strictEqual(methodScope2.state.total, 45, 'After multiply(3), total should be 45');

  // 3c. Methods defined as actual functions (not strings)
  const methods3 = {
    getDouble: function () {
      return this.state.value * 2;
    },
    getTriple: function () {
      return this.state.value * 3;
    },
  };
  const methodScope3 = { state: { value: 7 } };
  const methodMap3 = evaluator.createMethodMap(
    methods3,
    () => ({ state: { value: 7 } }),
    () => methodScope3,
  );
  assert.strictEqual(methodMap3.getDouble(), 14, 'getDouble should return 14 (7 * 2)');
  assert.strictEqual(methodMap3.getTriple(), 21, 'getTriple should return 21 (7 * 3)');

  // 3d. Methods map with empty input
  const methodMap4 = evaluator.createMethodMap(
    {},
    () => ({}),
    () => ({}),
  );
  assert.deepStrictEqual(methodMap4, {}, 'Empty methods object should produce empty method map');

  // 3e. getScope is called on each invocation
  let callCount = 0;
  const methodScope5 = { counter: 0 };
  const methods5 = { inc: 'counter++' };
  const methodMap5 = evaluator.createMethodMap(
    methods5,
    () => {
      callCount++;
      return { ...methodScope5 };
    },
    () => methodScope5,
  );
  methodMap5.inc();
  assert.strictEqual(callCount >= 1, true, 'getScope should be called at least once');

  // 3f. Method that accesses both scope and args
  const methods6 = {
    update: 'state.name = args[0]; state.age = args[1]',
  };
  const methodScope6 = { state: { name: '', age: 0 } };
  const methodMap6 = evaluator.createMethodMap(
    methods6,
    () => methodScope6,
    () => methodScope6,
  );
  methodMap6.update('Alice', 30);
  assert.strictEqual(methodScope6.state.name, 'Alice', 'After update("Alice", 30), name should be "Alice"');
  assert.strictEqual(methodScope6.state.age, 30, 'After update("Alice", 30), age should be 30');

  // 3g. Method that returns a value via return statement
  const methods7 = {
    calculate: 'return state.base * state.multiplier',
  };
  const methodScope7 = { state: { base: 4, multiplier: 5 } };
  const methodMap7 = evaluator.createMethodMap(
    methods7,
    () => methodScope7,
    () => methodScope7,
  );
  const calculated = methodMap7.calculate();
  assert.strictEqual(calculated, 20, 'calculate() should return 20 (4 * 5)');

  console.log('  createMethodMap tests passed');

  console.log('All DynamicEvaluator tests passed!');
} catch (error) {
  console.error('DynamicEvaluator tests failed!');
  console.error(error);
  process.exit(1);
}

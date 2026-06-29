const assert = require('assert');
const ExpressionParser = require('../../lib/compiler/expressionParser');

try {
    console.log('🧪 Testing ExpressionParser upgrades...');
    const ep = new ExpressionParser();

    // 1. Test state parsing and type coercion (booleans, null, numbers, JSON structures, strings)
    const contentState = `
    <state
        str="hello"
        numInt="42"
        numFloat="-3.14"
        boolTrue="true"
        boolFalse="false"
        nil="null"
        arr="[1, 2, 3]"
        obj='{"key": "value", "active": true}'
        empty=""
        spaces="   "
    />
    `;

    const state = ep.parseState(contentState);
    assert.strictEqual(state.str, 'hello');
    assert.strictEqual(state.numInt, 42);
    assert.strictEqual(state.numFloat, -3.14);
    assert.strictEqual(state.boolTrue, true);
    assert.strictEqual(state.boolFalse, false);
    assert.strictEqual(state.nil, null);
    assert.deepStrictEqual(state.arr, [1, 2, 3]);
    assert.deepStrictEqual(state.obj, { key: "value", active: true });
    assert.strictEqual(state.empty, '');
    assert.strictEqual(state.spaces, '   ');

    // 2. Test state parsing with single quotes
    const contentSingleQuoteState = `
    <state count='0' flag='true' />
    `;
    const singleQuoteState = ep.parseState(contentSingleQuoteState);
    assert.strictEqual(singleQuoteState.count, 0);
    assert.strictEqual(singleQuoteState.flag, true);

    // 3. Test computed parsing (single quotes, double quotes, and arbitrary attribute ordering)
    const contentComputed = `
    <computed name="double" value="count * 2" />
    <computed name='triple' value='count * 3' />
    <computed value='count * 4' name='quadruple' />
    <computed
        name="quintuple"
        value="count * 5"
    />
    `;

    const computed = ep.parseComputed(contentComputed);
    assert.strictEqual(computed.double, 'count * 2');
    assert.strictEqual(computed.triple, 'count * 3');
    assert.strictEqual(computed.quadruple, 'count * 4');
    assert.strictEqual(computed.quintuple, 'count * 5');

    // 4. Test method parsing (single quotes, double quotes, and whitespace preservation)
    const contentMethods = `
    <action name="inc">
        count++;
    </action>
    <action name='dec'>
        // decrement count
        count--;
    </action>
    <action name="format">
        const x = \`hello
        world\`;
        return x;
    </action>
    `;

    const methods = ep.parseMethods(contentMethods);
    assert.strictEqual(methods.inc, 'count++;');
    assert.strictEqual(methods.dec, '// decrement count\n        count--;');
    assert.strictEqual(methods.format, 'const x = `hello\n        world`;\n        return x;');

    // 5. Test action/method parsing with additional attributes, boolean flags, and alternate ordering
    const contentMethodsComplex = `
    <action async name="fetchData" defer>
        const res = await fetch('/api');
        state.data = await res.json();
    </action>
    <action data-custom="value" name='postData' async>
        console.log('posting');
    </action>
    <action
        name="multiLineAttrs"
        async
        custom-attr="hello"
    >
        return 42;
    </action>
    `;

    const complexMethods = ep.parseMethods(contentMethodsComplex);
    assert.strictEqual(complexMethods.fetchData, "const res = await fetch('/api');\n        state.data = await res.json();");
    assert.strictEqual(complexMethods.postData, "console.log('posting');");
    assert.strictEqual(complexMethods.multiLineAttrs, "return 42;");

    console.log('  ✅ ExpressionParser upgrades tests passed!');
} catch (error) {
    console.error('❌ ExpressionParser upgrades tests failed!');
    console.error(error);
    process.exit(1);
}

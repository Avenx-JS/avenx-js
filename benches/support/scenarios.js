/**
 * @file scenarios.js
 * @description The component shapes the renderer benchmarks measure.
 *
 * These are defined once and shared so that the "before" and "after" numbers of
 * an architecture change describe the same workloads. Each factory returns
 * component source in Avenx's own authoring format, which the benchmark then
 * compiles with the real `ComponentParser` -- a benchmark that hand-writes the
 * runtime's input measures the runtime and calls it the framework.
 * @module benches/support/scenarios
 */

/**
 * A component with `n` independent text interpolations over `n` state keys.
 *
 * The shape the architecture is judged on: changing one of the `n` values
 * should cost the same whether `n` is 10 or 4000.
 * @param {number} n - How many bindings.
 * @returns {{source: string, state: object}} Source and its initial state.
 */
export function manyTextBindings(n) {
  const state = {};
  const cells = [];
  for (let i = 0; i < n; i++) {
    state[`v${i}`] = i;
    cells.push(`<span class="cell">{{ v${i} }}</span>`);
  }
  state.unrelated = 0;
  const decls = Object.keys(state)
    .map((k) => `${k}="${state[k]}"`)
    .join(' ');
  return {
    source: `<state ${decls} />\n<div class="grid">${cells.join('')}</div>`,
    state,
  };
}

/**
 * A component that is mostly static markup with a handful of bindings.
 *
 * Measures whether a large static subtree costs anything on update. Under a
 * render-to-string architecture it does: the static half is serialised and
 * reparsed on every change.
 * @param {number} staticNodes - How many static elements to emit.
 * @returns {{source: string, state: object}} Source and its initial state.
 */
export function largeStaticSubtree(staticNodes) {
  const statics = [];
  for (let i = 0; i < staticNodes; i++) {
    statics.push(`<li class="static-row"><b>Row ${i}</b><i>fixed content</i></li>`);
  }
  return {
    source:
      '<state counter="0" />\n' +
      `<section><p class="live">{{ counter }}</p><ul>${statics.join('')}</ul></section>`,
    state: { counter: 0 },
  };
}

/**
 * A component with `n` attribute bindings on distinct elements.
 * @param {number} n - How many bindings.
 * @returns {{source: string, state: object}} Source and its initial state.
 */
export function manyAttributeBindings(n) {
  const state = {};
  const cells = [];
  for (let i = 0; i < n; i++) {
    state[`t${i}`] = `title ${i}`;
    cells.push(`<div title="{{ t${i} }}" data-idx="${i}">x</div>`);
  }
  const decls = Object.keys(state)
    .map((k) => `${k}="${state[k]}"`)
    .join(' ');
  return { source: `<state ${decls} />\n<div>${cells.join('')}</div>`, state };
}

/**
 * A component whose bindings all read one computed value.
 * @param {number} n - How many bindings read the computed.
 * @returns {{source: string, state: object}} Source and its initial state.
 */
export function computedFanOut(n) {
  const cells = [];
  for (let i = 0; i < n; i++) {
    cells.push(`<span>{{ doubled }}</span>`);
  }
  return {
    source:
      '<state base="1" spare="0" />\n' +
      '<computed name="doubled" value="base * 2" />\n' +
      `<div>${cells.join('')}</div>`,
    state: { base: 1, spare: 0 },
  };
}

/**
 * A component rendering a keyed list.
 * @param {number} n - How many rows.
 * @returns {{source: string, rows: Array<object>}} Source and the row data.
 */
export function keyedList(n) {
  const rows = Array.from({ length: n }, (_, i) => ({ id: i, label: `row ${i}` }));
  return {
    source:
      '<state rows="[]" spare="0" />\n' +
      '<ul><@for row in rows key="row.id"><li class="row">{{ row.label }}</li></@for></ul>',
    rows,
  };
}

/**
 * A component with a conditional branch over a large subtree.
 * @param {number} n - How many nodes inside the branch.
 * @returns {{source: string}} Source.
 */
export function conditionalBranch(n) {
  const inner = Array.from({ length: n }, (_, i) => `<p>item ${i}</p>`).join('');
  return {
    source:
      '<state open="true" spare="0" />\n' +
      `<div><section data-ax-show="open">${inner}</section></div>`,
  };
}

/**
 * A component with `n` event handlers bound.
 * @param {number} n - How many handlers.
 * @returns {{source: string}} Source.
 */
export function manyEventHandlers(n) {
  const cells = Array.from(
    { length: n },
    (_, i) => `<button @click="bump()">b${i}</button>`,
  ).join('');
  return {
    source:
      '<state clicks="0" />\n' +
      '<action name="bump"> clicks = clicks + 1; </action>\n' +
      `<div><span id="out">{{ clicks }}</span>${cells}</div>`,
  };
}

/**
 * A component mixing static markup, text bindings and attribute bindings.
 *
 * The "realistic medium component" case: nothing pathological, just a normal
 * screen's worth of markup.
 * @param {number} n - How many blocks.
 * @returns {{source: string, state: object}} Source and its initial state.
 */
export function mixedComponent(n) {
  const state = { title: 'Dashboard', spare: 0 };
  const blocks = [];
  for (let i = 0; i < n; i++) {
    state[`m${i}`] = i;
    blocks.push(
      `<article class="card"><header><h3>Card ${i}</h3></header>` +
        `<p class="value" title="{{ m${i} }}">{{ m${i} }}</p>` +
        '<footer><small>static footer text</small></footer></article>',
    );
  }
  const decls = Object.keys(state)
    .map((k) => `${k}="${typeof state[k] === 'string' ? state[k] : state[k]}"`)
    .join(' ');
  return {
    source: `<state ${decls} />\n<main><h1>{{ title }}</h1>${blocks.join('')}</main>`,
    state,
  };
}

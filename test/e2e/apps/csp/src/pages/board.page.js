<!--
  Every expression kind the CSP-strict mode has to precompile, in one page:
  interpolations, a computed value reading another binding, a bound attribute,
  a data-ax-* directive, a <@for> list with a key expression and a loop
  variable that shadows a state key, an inline event handler, and an <action>
  body written with real statement syntax -- which is the one the interpreter
  could only ever run through the Function constructor.

  The app is built with "csp": { "strict": true }, and the E2E server serves it
  under script-src 'self'. Nothing here may need 'unsafe-eval'.
-->

<state
  count="0"
  label="'board'"
  rows="[{ id: 1, name: 'one' }, { id: 2, name: 'two' }, { id: 3, name: 'three' }]"
/>

<computed name="doubled" value="count * 2" />
<computed name="caption" value="label.toUpperCase() + '/' + doubled" />

<action name="bump">
  count = count + 1;
</action>

<action name="sumIds">
  let running = 0;
  for (const row of rows) {
    running += row.id;
  }
  count = running;
</action>

<main>
  <h1 data-testid="heading" :title="label">{{ label }}</h1>
  <p data-testid="count">{{ count }}</p>
  <p data-testid="doubled">{{ doubled }}</p>
  <p data-testid="caption">{{ caption }}</p>

  <button data-testid="bump" @click="bump()">+1</button>
  <button data-testid="sum" @click="sumIds()">sum</button>

  <p data-testid="many" data-ax-show="count > 2">many</p>

  <ul>
    <@for label in rows key="label.id">
      <li data-testid="row" :data-id="label.id">{{ index }}:{{ label.name }}</li>
    </@for>
  </ul>

  <p data-testid="after-loop">{{ label }}</p>
</main>

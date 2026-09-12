<!--
  <@if> in a browser. The construct is new, so there is no string-renderer
  implementation of it to compare against -- these tests are the only place it
  is exercised against a real DOM rather than happy-dom.

  The `(count > 3)` brackets are required: a top-level `>` in a bare header
  cannot be told apart from the end of the tag. The compiler refuses the
  ambiguous form rather than guessing, which is asserted in the unit suite.
-->
<state count="0" name="world" />

<action name="inc"> count = count + 1; </action>
<action name="reset"> count = 0; </action>
<action name="rename"> name = 'everyone'; </action>

<main>
  <h1 data-testid="heading">Conditional</h1>

  <p data-testid="count">{{ count }}</p>

  <@if (count > 3)>
    <strong data-testid="branch">many</strong>
  <@elseif (count > 0)>
    <em data-testid="branch">some</em>
    <input data-testid="typed" />
  <@else>
    <span data-testid="branch">none</span>
  </@if>

  <p data-testid="after">after the chain</p>

  <!-- A branch that reads state the chain does not test, so an update inside
       an arm can be told apart from a switch between arms. -->
  <@if (count > 0)>
    <p data-testid="greeting">hello {{ name }}</p>
  </@if>

  <button data-testid="inc" @click="inc()">+1</button>
  <button data-testid="reset" @click="reset()">reset</button>
  <button data-testid="rename" @click="rename()">rename</button>
</main>

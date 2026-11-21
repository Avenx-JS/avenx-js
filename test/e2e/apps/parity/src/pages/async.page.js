<!--
  <@defer> with each documented trigger -- idle, timer, interaction, an
  expression, and visible -- <AsyncPanel>, which holds <resource>,
  <@suspense> and <@deadlock>, and <ErrorPanel> for <@errorBoundary>.
-->
<state ready="false" />

<action name="makeReady">ready = true;</action>

<main>
  <h1 data-testid="heading">Async</h1>

  <section data-construct="defer-idle">
    <@defer when="idle">
      <@placeholder><p data-testid="placeholder">idle placeholder</p></@placeholder>
      <p data-testid="content">loaded when idle</p>
    </@defer>
  </section>

  <section data-construct="defer-timer">
    <@defer when="timer(300)">
      <@placeholder><p data-testid="placeholder">timer placeholder</p></@placeholder>
      <p data-testid="content">loaded after the timer</p>
    </@defer>
  </section>

  <section data-construct="defer-interaction">
    <@defer when="interaction">
      <@placeholder><button data-testid="placeholder">interaction placeholder</button></@placeholder>
      <p data-testid="content">loaded on interaction</p>
    </@defer>
  </section>

  <section data-construct="defer-expression">
    <button data-testid="make-ready" @click="makeReady()">ready</button>
    <@defer when="ready">
      <@placeholder><p data-testid="placeholder">expression placeholder</p></@placeholder>
      <p data-testid="content">loaded when ready</p>
    </@defer>
  </section>

  <AsyncPanel />
  <section data-construct="error-boundary"><ErrorPanel /></section>

  <div data-testid="spacer" style="height: 150vh">spacer</div>

  <section data-construct="defer-visible">
    <@defer when="visible">
      <@placeholder><p data-testid="placeholder">visible placeholder</p></@placeholder>
      <p data-testid="content">loaded once visible</p>
    </@defer>
  </section>
</main>

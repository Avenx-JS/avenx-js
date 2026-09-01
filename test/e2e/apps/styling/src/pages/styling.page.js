<state emphasised="true" />

<main @css page>
  <h1 data-testid="heading">Styling</h1>

  <AlphaBox />
  <BetaBox />

  <p @css note data-testid="page-note">Styled by the page's own stylesheet</p>

  <!-- data-ax-style is documented public API but applies nothing today;
       see the documented gap in specs/styling/scoped-css.spec.js. -->
  <p data-testid="emphasis" data-ax-style="{{ { fontWeight: emphasised ? '700' : '400' } }}">Emphasis target</p>
</main>

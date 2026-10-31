<!-- Injection takes precedence over this declared fallback in the template scope. -->
<state theme="unprovided" />

<section data-testid="injecting-child">
  <p data-testid="child-theme">{{ theme }}</p>
  <div data-avenx-comp="InjectingGrandchild"></div>
</section>

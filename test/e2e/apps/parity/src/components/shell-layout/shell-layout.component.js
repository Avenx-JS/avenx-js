<!-- A layout with a router view: the routed page mounts into the outlet. -->
<state heading="'Shell layout'" />

<div data-testid="shell-layout">
  <h2 data-testid="shell-heading">{{ heading }}</h2>
  <div data-testid="shell-outlet" data-ax-router-view></div>
</div>

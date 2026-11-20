<!--
  Static nesting, props, and three of the four slot forms: the default slot,
  a named slot, and the fallback content each renders when nothing is
  projected. <BadgeLabel> is a component inside a component, so a grandchild
  that fails to mount shows up here as a missing badge.
-->
<article data-testid="frame-card">
  <h3 data-testid="frame-title">{{ props.title }}</h3>
  <BadgeLabel text="{{ props.title }}" />
  <div data-testid="frame-body"><slot>default fallback</slot></div>
  <footer data-testid="frame-footer"><slot name="footer">footer fallback</slot></footer>
</article>

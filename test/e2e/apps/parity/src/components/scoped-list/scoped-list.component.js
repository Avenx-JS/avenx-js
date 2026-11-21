<!--
  A scoped slot: the child owns the values and the caller decides how to
  render them. The update action proves the slot props stay reactive.
-->
<state label="'first'" count="2" />
<action name="bump">label = 'second'; count = count + 1;</action>

<div data-testid="scoped-list">
  <button data-testid="scoped-bump" @click="bump()">bump</button>
  <slot :label="label" :count="count"><p data-testid="scoped-fallback">no template for {{ label }}</p></slot>
</div>

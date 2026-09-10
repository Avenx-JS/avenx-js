<state submits="0" parentClicks="0" childClicks="0" onceClicks="0" backdropClicks="0" enterPresses="0"
       picked="'none'" pickedIndex="-1" cell="'none'"
       rows='[{ "id": "alpha" }, { "id": "beta" }, { "id": "gamma" }]'
       groups='[{ "id": "g1", "cells": [{ "id": "c1" }, { "id": "c2" }] }, { "id": "g2", "cells": [{ "id": "c3" }] }]' />

<action name="recordSubmit"> state.submits = state.submits + 1; </action>

<action name="recordParentClick"> state.parentClicks = state.parentClicks + 1; </action>

<action name="recordChildClick"> state.childClicks = state.childClicks + 1; </action>

<action name="recordOnceClick"> state.onceClicks = state.onceClicks + 1; </action>

<action name="recordBackdropClick"> state.backdropClicks = state.backdropClicks + 1; </action>

<action name="recordEnter"> state.enterPresses = state.enterPresses + 1; </action>

<action name="pick"> state.picked = args[0]; </action>

<main>
  <h1 data-testid="heading">Events</h1>

  <!-- A handler inside a loop has to resolve the row it is attached to, not
       whatever the component scope holds. Written the way the events guide
       documents it: an inline write, and a call passing the loop variable. -->
  <ul data-testid="rows">
    <@for row in rows key="row.id">
      <li>
        <button class="row-inline" data-testid="row-inline-{{ row.id }}" @click="picked = row.id">{{ row.id }}</button>
        <button class="row-call" data-testid="row-call-{{ row.id }}" @click="pick(row.id)">call {{ row.id }}</button>
        <button class="row-index" data-testid="row-index-{{ row.id }}" @click="pickedIndex = index">index {{ row.id }}</button>
      </li>
    </@for>
  </ul>
  <p data-testid="picked">{{ picked }}</p>
  <p data-testid="picked-index">{{ pickedIndex }}</p>

  <!-- A handler in a nested loop has to see both loop variables. -->
  <div data-testid="grid">
    <@for group in groups key="group.id">
      <section>
        <@for gcell in group.cells key="gcell.id">
          <button class="cell" data-testid="cell-{{ gcell.id }}" @click="cell = group.id + '/' + gcell.id">{{ gcell.id }}</button>
        </@for>
      </section>
    </@for>
  </div>
  <p data-testid="cell">{{ cell }}</p>

  <!-- .prevent: the browser must not navigate on submit. -->
  <form data-testid="form" @submit.prevent="recordSubmit()">
    <input type="text" name="term" value="search term" data-testid="form-input" />
    <button type="submit" data-testid="submit">Submit</button>
  </form>
  <p data-testid="submit-count">{{ submits }}</p>

  <!-- .stop on one child, plain binding on the other. -->
  <div data-testid="parent" @click="recordParentClick()">
    <button data-testid="child-stop" @click.stop="recordChildClick()">Stop propagation</button>
    <button data-testid="child-bubbles" @click="recordChildClick()">Let it bubble</button>
  </div>
  <p data-testid="parent-count">{{ parentClicks }}</p>
  <p data-testid="child-count">{{ childClicks }}</p>

  <!-- .once: the handler must detach after the first call. -->
  <button data-testid="once" @click.once="recordOnceClick()">Claim once</button>
  <p data-testid="once-count">{{ onceClicks }}</p>

  <!-- .self: only a click on the backdrop itself counts. -->
  <!-- The padding gives the backdrop an area of its own to click, so the
       .self test can hit the element rather than its child. -->
  <div data-testid="backdrop" style="padding: 24px" @click.self="recordBackdropClick()">
    <div data-testid="backdrop-inner">Inner content</div>
  </div>
  <p data-testid="backdrop-count">{{ backdropClicks }}</p>

  <!-- Key modifier: only Enter counts. -->
  <input type="text" data-testid="enter-input" @keydown.enter="recordEnter()" />
  <p data-testid="enter-count">{{ enterPresses }}</p>
</main>

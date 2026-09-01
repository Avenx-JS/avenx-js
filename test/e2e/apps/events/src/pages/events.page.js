<state submits="0" parentClicks="0" childClicks="0" onceClicks="0" backdropClicks="0" enterPresses="0" />

<action name="recordSubmit"> state.submits = state.submits + 1; </action>

<action name="recordParentClick"> state.parentClicks = state.parentClicks + 1; </action>

<action name="recordChildClick"> state.childClicks = state.childClicks + 1; </action>

<action name="recordOnceClick"> state.onceClicks = state.onceClicks + 1; </action>

<action name="recordBackdropClick"> state.backdropClicks = state.backdropClicks + 1; </action>

<action name="recordEnter"> state.enterPresses = state.enterPresses + 1; </action>

<main>
  <h1 data-testid="heading">Events</h1>

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

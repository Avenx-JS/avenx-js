<state showFade="false" showSlide="false" showRapid="false" transitionName="fade" slideTransition="slide" />

<action name="toggleFade">
  state.showFade = !state.showFade;
</action>

<action name="toggleSlide">
  state.showSlide = !state.showSlide;
</action>

<action name="toggleRapid">
  state.showRapid = !state.showRapid;
</action>

<action name="rapidToggleTwice">
  state.showRapid = !state.showRapid;
  state.showRapid = !state.showRapid;
</action>

<main>
  <h1 data-testid="heading">Transitions</h1>

  <section data-testid="fade-section">
    <button data-testid="toggle-fade" @click="toggleFade()">Toggle Fade</button>
    <transition name="{{ state.transitionName }}">
      <div data-testid="fade-box" data-ax-show="showFade">Fade Box Content</div>
    </transition>
  </section>

  <section data-testid="slide-section">
    <button data-testid="toggle-slide" @click="toggleSlide()">Toggle Slide</button>
    <transition name="{{ state.slideTransition }}">
      <div data-testid="slide-box" data-ax-show="showSlide">
        Slide Box Content
      </div>
    </transition>
  </section>

  <section data-testid="rapid-section">
    <button data-testid="toggle-rapid" @click="toggleRapid()">Toggle Rapid</button>
    <button data-testid="rapid-toggle-twice" @click="rapidToggleTwice()">Rapid Toggle Twice</button>
    <transition name="{{ state.transitionName }}">
      <div data-testid="rapid-box" data-ax-show="showRapid">Rapid Box Content</div>
    </transition>
  </section>
</main>

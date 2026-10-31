<state theme="dark" />

<action name="updateTheme">
  state.theme = state.theme === 'dark' ? 'light' : 'dark';
</action>

<section data-testid="provider">
  <p data-testid="provider-theme">{{ theme }}</p>
  <button data-testid="update-theme" @click="updateTheme()">Toggle theme</button>
  <div data-avenx-comp="InjectingChild"></div>
</section>

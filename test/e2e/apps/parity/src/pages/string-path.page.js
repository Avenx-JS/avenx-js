<!--
  Constructs that only exist on the string renderer, and the string
  renderer's known gaps.

  Every construct here is one the IR refuses (AVX_W47): a template ref,
  declarative validation, a scoped slot outlet's <template>, a dynamic
  component, a dynamic attribute name. Any one of them sends the whole page
  through the string path, so the other pages compile and this one is the
  string renderer's half of the comparison.

  The sections ending in `-on-string-path`, and `dynamic-attribute-update`, pin
  defects rather than demonstrate practice. Each construct works on a compiled
  page and not here, in either build. specs/build/construct-parity.spec.js
  drives them under test.fail(), so a fix turns the run red until the pin is
  removed.
-->
<state attrName="'data-tone'" attrValue="'warm'" color="'rgb(255, 0, 0)'" refReport="'unread'" username="''" currentView="ProfileCard" owner="'Ada'" note="'typed before mount'" />

<action name="change">attrValue = 'cool'; color = 'rgb(0, 0, 255)';</action>
<action name="readRef">refReport = this.$refs.probe.dataset.mark + '/' + this.$refs.probe.tagName.toLowerCase();</action>
<action name="showSettings">currentView = 'SettingsCard';</action>
<action name="rename">owner = 'Grace';</action>

<main>
  <h1 data-testid="heading">String renderer</h1>
  <button data-testid="change" @click="change()">change</button>
  <button data-testid="show-settings" @click="showSettings()">settings</button>
  <button data-testid="rename" @click="rename()">rename</button>

  <section data-construct="dynamic-attribute-names">
    <span data-testid="dynamic-attr" :[attrName]="attrValue">dynamic</span>
  </section>

  <section data-construct="ref">
    <span data-testid="probe" data-ax-ref="probe" data-mark="marked">probe</span>
    <button data-testid="read-ref" @click="readRef()">read</button>
    <p data-testid="ref-report">{{ refReport }}</p>
  </section>

  <section data-construct="validate">
    <input name="username" data-ax-bind="username" data-ax-validate="required|min:4" data-testid="username" aria-label="username" />
    <p data-testid="username-error">{{ state.$validation?.errors?.username?.[0] || 'no error' }}</p>
    <p data-testid="form-valid">{{ state.$validation?.isValid ? 'valid' : 'invalid' }}</p>
  </section>

  <section data-construct="scoped-slot">
    <ScopedList>
      <template data-slot-props="row">
        <p data-testid="scoped-row">{{ row.label }} x{{ row.count }}</p>
      </template>
    </ScopedList>
    <div data-testid="scoped-empty"><ScopedList /></div>
  </section>

  <section data-construct="dynamic-component">
    <Component :is="{{ currentView }}" owner="{{ owner }}" />
  </section>

  <section data-construct="quoted-component-attributes">
    <Component :is='currentView === "ProfileCard" ? "ProfileCard" : "SettingsCard"' :owner='owner + " & team"' />
  </section>

  <section data-construct="literal-component-props-on-string-path">
    <FrameCard title="H:\notes\report.txt" />
  </section>

  <!-- Known gaps. -->

  <section data-construct="dynamic-attribute-update">
    <span data-testid="dynamic-attr" :[attrName]="attrValue">dynamic</span>
  </section>

  <section data-construct="style-on-string-path">
    <p data-testid="styled" data-ax-style="{{ { color: color } }}">styled</p>
  </section>

  <section data-construct="textarea-on-string-path">
    <textarea data-testid="note" data-ax-bind="note" aria-label="note"></textarea>
  </section>

  <section data-construct="template-slot-on-string-path">
    <FrameCard data-props-title="'wrapped'">
      <template slot="footer"><b data-testid="wrapped-first">first wrapped</b></template>
    </FrameCard>
  </section>
</main>

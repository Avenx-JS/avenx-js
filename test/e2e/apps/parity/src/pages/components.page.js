<!--
  Component constructs on a page that compiles to a render program: static
  nesting to a grandchild, props, and the default, named, fallback and
  <template slot> forms of slot projection. Scoped slots and <Component :is>
  cannot be lowered and live on the string-path page.
-->
<state title="'Quarterly'" />
<action name="rename">title = 'Annual';</action>

<main>
  <h1 data-testid="heading">Components</h1>
  <button data-testid="rename" @click="rename()">rename</button>

  <section data-construct="nesting-and-props">
    <FrameCard title="{{ title }}" />
  </section>

  <section data-construct="slots">
    <FrameCard title="slotted">
      <p data-testid="projected-body">projected into the default slot</p>
      <p slot="footer" data-testid="projected-footer">projected into the footer</p>
    </FrameCard>
    <!-- The <template slot> wrapper: both elements land in the named slot. -->
    <FrameCard data-props-title="'wrapped'">
      <template slot="footer">
        <b data-testid="wrapped-first">first wrapped</b>
        <i data-testid="wrapped-second">second wrapped</i>
      </template>
    </FrameCard>
  </section>
</main>

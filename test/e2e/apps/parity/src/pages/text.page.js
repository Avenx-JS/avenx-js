<!--
  Text and attribute constructs. Every value starts in one state and the
  "change" button moves all of them at once, so each construct is checked on
  its first render and on an update.
-->
<state name="'Ada'" markup="'<em>raw</em>'" locked="true" expanded="false" visible="false" theme="'theme-a'" active="false" color="'rgb(255, 0, 0)'" html="'<b>bold</b><script>window.__parityXss = true</script>'" radius="10" />

<action name="change">
  name = 'Grace';
  markup = '<strong>raw again</strong>';
  locked = false;
  expanded = true;
  visible = true;
  theme = 'theme-b';
  active = true;
  color = 'rgb(0, 0, 255)';
  html = '<i>italic</i>';
  radius = 30;
</action>

<main>
  <h1 data-testid="heading">Text and attributes</h1>
  <button data-testid="change" @click="change()">change</button>

  <section data-construct="interpolation">
    <p data-testid="value">Hello {{ name }}</p>
    <p data-testid="expression">{{ name.length * 2 }} / {{ name === 'Ada' ? 'first' : 'second' }}</p>
    <p data-testid="escaped">{{ markup }}</p>
  </section>

  <section data-construct="raw-interpolation">
    <div data-testid="raw">{{{ markup }}}</div>
  </section>

  <section data-construct="boolean-attributes">
    <button data-testid="locked" disabled="{{ locked }}">locked</button>
    <details data-testid="details" open="{{ expanded }}"><summary>more</summary><p>inside</p></details>
    <input data-testid="readonly" aria-label="readonly" readonly="{{ locked }}" value="fixed" />
  </section>


  <section data-construct="show">
    <p data-testid="shown" data-ax-show="visible">now you see it</p>
    <p data-testid="flex" style="display: flex" data-ax-show="!visible">flex until change</p>
  </section>

  <section data-construct="class">
    <p data-testid="class-string" class="base" data-ax-class="theme">string form</p>
    <p data-testid="class-object" class="base" data-ax-class="{ active: active, idle: !active }">object form</p>
  </section>

  <section data-construct="style">
    <p data-testid="styled" data-ax-style="{{ { color: color, fontWeight: active ? 'bold' : 'normal' } }}">styled</p>
  </section>

  <section data-construct="html">
    <div data-testid="html" data-ax-html="html"></div>
  </section>
  <section data-construct="svg">
    <svg data-testid="svg" width="80" height="80" viewBox="0 0 80 80">
      <circle data-testid="circle" cx="40" cy="40" r="{{ radius }}" fill="rgb(0, 128, 0)" />
    </svg>
  </section>
</main>

<!--
  `data-ax-html` with plain strings: allowed markup is injected, anything
  dangerous is stripped by the sanitizer and reported (#1721). The values are
  assigned in an action so attribute parsing plays no part.
-->
<state bold="''" mixed="''" clobber="''" />

<action name="onMount">
  window.__axHtmlXss = false;
  this.state.bold = '<b>bold</b>';
  this.state.clobber = '<b id="__avenx_routers" name="__avenx_routers">x</b><b id="__avenx_routers">y</b>';
  this.state.mixed = '<b>ok</b><script>window.__axHtmlXss = true</script><i onclick="window.__axHtmlXss = true">tap</i>';
</action>

<main>
  <h1 data-testid="ax-html-heading">data-ax-html</h1>
  <p data-testid="bold" data-ax-html="bold"></p>
  <p data-testid="mixed" data-ax-html="mixed"></p>
  <p data-testid="clobber" data-ax-html="clobber"></p>
</main>

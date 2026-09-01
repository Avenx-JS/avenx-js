<!--
  The <state> tag must stay on one line. The compiler strips it from the
  template with /<state.*? \/>/g (ComponentParser.js), and `.` does not match
  newlines -- so a <state> tag broken across lines compiles the right values
  but leaks the tag into the template and reactivity stops working. See the
  documented gap in specs/rendering/lists-and-conditionals.spec.js.
-->
<state items="[{'id':'a','label':'Alpha'},{'id':'b','label':'Beta'},{'id':'c','label':'Gamma'}]" nextId="4" detailsVisible="false" untrusted="plain text" />

<computed name="itemLabels" value="state.items.map(function (item) { return item.label; }).join(',')" />
<computed name="itemTotal" value="state.items.length" />

<action name="appendItem">
  const id = 'id-' + state.nextId;
  state.items = state.items.concat([{ id: id, label: 'Item ' + state.nextId }]);
  state.nextId = state.nextId + 1;
</action>

<action name="removeFirst"> state.items = state.items.slice(1); </action>

<action name="reverseItems"> state.items = state.items.slice().reverse(); </action>

<action name="clearItems"> state.items = []; </action>

<action name="toggleDetails"> state.detailsVisible = !state.detailsVisible; </action>

<action name="injectMarkup"> state.untrusted = '<b data-testid="injected">not markup</b>'; </action>

<main>
  <h1 data-testid="heading">Rendering</h1>

  <p data-testid="labels">{{ itemLabels }}</p>
  <p data-testid="item-count">{{ itemTotal }}</p>

  <ul data-testid="list">
    <@for item in items key="item.id">
      <li data-testid="item" data-item-id="{{ item.id }}">{{ item.label }}</li>
    <@empty>
      <li data-testid="empty-state">Nothing to show</li>
    </@for>
  </ul>

  <button data-testid="append" @click="appendItem()">Append</button>
  <button data-testid="remove-first" @click="removeFirst()">Remove first</button>
  <button data-testid="reverse" @click="reverseItems()">Reverse</button>
  <button data-testid="clear" @click="clearItems()">Clear</button>

  <button data-testid="toggle-details" @click="toggleDetails()">Toggle details</button>
  <p data-testid="details" data-ax-show="detailsVisible">Extra detail</p>

  <p data-testid="untrusted">{{ untrusted }}</p>
  <button data-testid="inject" @click="injectMarkup()">Inject markup</button>
</main>

<state visible="true" rows="[{id: 1}, {id: 2}]" childName="child" />
<action name="focusBox"> this.$refs.box.focus(); </action>
<action name="toggle"> visible = !visible; </action>
<action name="reverse"> rows = rows.slice().reverse(); </action>
<action name="focusLast"> this.$refs.last.focus(); </action>
<action name="focusChild"> this.$refs[childName].focusInput(); </action>
<action name="renameChild"> childName = 'renamed'; </action>
<main>
  <p data-testid="compiled">{{ this.$compiled }}</p>
  <button data-testid="focus-box" @click="focusBox()">Focus box</button>
  <button data-testid="toggle" @click="toggle()">Toggle box</button>
  <button data-testid="reverse" @click="reverse()">Reverse rows</button>
  <button data-testid="focus-last" @click="focusLast()">Focus last row</button>
  <button data-testid="focus-child" @click="focusChild()">Focus child</button>
  <button data-testid="rename-child" @click="renameChild()">Rename child ref</button>
  <@if visible><input aria-label="Box" data-testid="box" data-ax-ref="box" /></@if>
  <@for row in rows key="row.id">
    <input aria-label="Row {{row.id}}" data-testid="row-{{row.id}}" data-ax-ref="last" />
  </@for>
  <Child data-ax-ref="{{childName}}" />
</main>

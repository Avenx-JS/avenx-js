<state showChild="true" />

<action name="unmountChild">
  showChild = false;
</action>

<div data-testid="unmount-page">
  <h1>Unmount</h1>
  <@if showChild>
    <AsyncChild />
  </@if>
  <button data-testid="unmount-btn" @click="unmountChild()">Unmount Child</button>
</div>

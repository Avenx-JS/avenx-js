<state items="[{'id':'item-1','name':'Alpha Item'},{'id':'item-2','name':'Beta Item'},{'id':'item-3','name':'Gamma Item'}]" nextId="4" fade="fade" />

<action name="addItem">
  const id = 'item-' + state.nextId;
  state.items = state.items.concat([{ id: id, name: 'Item ' + state.nextId }]);
  state.nextId = state.nextId + 1;
</action>

<action name="removeMiddle">
  state.items = state.items.filter(function (it) { return it.id !== 'item-2'; });
</action>

<action name="removeItem">
  const targetId = args[0];
  state.items = state.items.filter(function (it) { return it.id !== targetId; });
</action>

<action name="toggleRapidItem">
  const exists = state.items.some(function (it) { return it.id === 'rapid-item'; });
  state.items = exists
    ? state.items.filter(function (it) { return it.id !== 'rapid-item'; })
    : state.items.concat([{ id: 'rapid-item', name: 'Rapid Item' }]);
</action>

<action name="resetList">
  state.items = [
    { id: 'item-1', name: 'Alpha Item' },
    { id: 'item-2', name: 'Beta Item' },
    { id: 'item-3', name: 'Gamma Item' }
  ];
  state.nextId = 4;
</action>

<main>
  <h1 data-testid="heading">List Transitions</h1>

  <button data-testid="add-item" @click="addItem()">Add Item</button>
  <button data-testid="remove-middle" @click="removeMiddle()">Remove Middle</button>
  <button data-testid="reset-list" @click="resetList()">Reset List</button>
  <button data-testid="toggle-rapid-item" @click="toggleRapidItem()">Toggle Rapid Item</button>

  <ul data-testid="transition-list">
    <@for item in items key="item.id">
      <li data-testid="{{ item.id }}" data-ax-transition="fade">
        <span data-testid="name-{{ item.id }}">{{ item.name }}</span>
        <button data-testid="remove-{{ item.id }}" @click="removeItem(item.id)">Remove</button>
      </li>
    </@for>
  </ul>
</main>

<state activeTab="'dashboard'" />

<action name="selectUsers"> activeTab = 'users'; </action>

<div data-testid="admin-layout">
  <button data-testid="layout-select-users" @click="selectUsers()">Select users</button>
  <span data-testid="layout-active-tab">{{ activeTab }}</span>
  <slot></slot>
</div>

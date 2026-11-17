<state userId="'1'" />

<resource name="user">
  return fetch('/api/user?id=' + userId).then(res => res.json());
</resource>

<action name="selectUserTwo">
  userId = '2';
</action>

<action name="selectUserThree">
  userId = '3';
</action>

<div data-testid="user-card">
  <@suspense>
    <@fallback><span data-testid="user-loading">Loading user...</span></@fallback>
    <div data-testid="user-name">{{ user.name }}</div>
  </@suspense>
  <button data-testid="select-user-2" @click="selectUserTwo()">User 2</button>
  <button data-testid="select-user-3" @click="selectUserThree()">User 3</button>
</div>


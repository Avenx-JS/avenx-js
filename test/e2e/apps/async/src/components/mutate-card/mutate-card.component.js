<resource name="profile">
  return fetch('/api/profile').then(res => res.json());
</resource>

<action name="mutateLocal">
  this.$resources.profile.mutate({ name: 'Mutated Alice', role: 'Architect' });
</action>

<div data-testid="mutate-card">
  <@suspense>
    <@fallback><span data-testid="mutate-loading">Loading profile...</span></@fallback>
    <div>
      <span data-testid="profile-name">{{ profile.name }}</span>
      <span data-testid="profile-role">{{ profile.role }}</span>
    </div>
  </@suspense>
  <button data-testid="mutate-btn" @click="mutateLocal()">Mutate Profile</button>
</div>

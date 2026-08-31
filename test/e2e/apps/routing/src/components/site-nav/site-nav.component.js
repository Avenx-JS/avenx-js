import session from '../../bridges/session.bridge.js';

<action name="signIn"> session.signIn(); </action>

<action name="signOut"> session.signOut(); </action>

<nav data-testid="nav">
  <a href="#/" data-testid="nav-home">Home</a>
  <a href="#/profile/42" data-testid="nav-profile-42">Profile 42</a>
  <a href="#/profile/99" data-testid="nav-profile-99">Profile 99</a>
  <a href="#/dashboard?tab=analytics&amp;page=2" data-testid="nav-dashboard">Dashboard</a>
  <a href="#/admin" data-testid="nav-admin">Admin</a>
  <a href="#/admin?token=valid" data-testid="nav-admin-with-token">Admin (with token)</a>

  <span data-testid="session-status">{{ session.signedIn }}</span>
  <button data-testid="sign-in" @click="signIn()">Sign in</button>
  <button data-testid="sign-out" @click="signOut()">Sign out</button>
</nav>

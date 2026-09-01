import { AvenxApp } from 'avenx-core/runtime';
import SiteNav from './components/site-nav/site-nav.component.js';
import AuthGuard from './guards/auth.guard.js';

const app = new AvenxApp({ target: '#app' });

app.register('SiteNav', SiteNav);

app.initRouter({
  '': 'Home',
  '#/': 'Home',
  '#/profile/:id': 'Profile',
  '#/dashboard': 'Dashboard',
  '#/admin': { page: 'Admin', guards: [AuthGuard] },
  '*': 'NotFound',
});

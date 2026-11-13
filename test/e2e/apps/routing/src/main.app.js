import { AvenxApp } from 'avenx-core/runtime';
import SiteNav from './components/site-nav/site-nav.component.js';
import AdminLayout from './components/admin-layout/admin-layout.component.js';
import AuthGuard from './guards/auth.guard.js';

const app = new AvenxApp({ target: '#app' });

app.register('SiteNav', SiteNav);

// The root is declared once, in the plain '/' spelling. Every fixture used to
// declare it twice -- `'': 'Home'` beside `'#/': 'Home'` -- and that habit is
// what hid a router defect for so long: only the `#/` spelling ever matched, so
// an application that declared the root the way the scaffold and the README
// suggest rendered nothing at all. One spelling here means the suite exercises
// the normalization rather than routing around it.
app.initRouter({
  '/': 'Home',
  '#/profile/:id': 'Profile',
  '#/dashboard': 'Dashboard',
  '#/admin': { page: 'Admin', guards: [AuthGuard] },
  '/admin-layout': {
    layout: AdminLayout,
    children: [
      { path: '/dashboard', page: 'Dashboard' },
      { path: '/users', page: 'Admin' },
    ],
  },
  '*': 'NotFound',
});

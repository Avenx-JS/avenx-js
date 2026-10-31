import { AvenxApp } from 'avenx-core/runtime';
import SiteNav from './components/site-nav/site-nav.component.js';
import InjectingChild from './components/InjectingChild.js';
import InjectingGrandchild from './components/InjectingGrandchild.js';
import Provider from './components/Provider.js';
import CachedPage from './pages/cached.page.js';
import UncachedPage from './pages/uncached.page.js';

const app = new AvenxApp({ target: '#app' });

app.register('SiteNav', SiteNav);
app.register('Provider', Provider);
app.register('InjectingChild', InjectingChild);
app.register('InjectingGrandchild', InjectingGrandchild);
app.registerPage('Cached', CachedPage);
app.registerPage('Uncached', UncachedPage);

app.initRouter({
  '/': 'Provider',
  '#/cached': { page: 'Cached', keepAlive: true },
  '#/uncached': { page: 'Uncached', keepAlive: false },
});

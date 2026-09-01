import { AvenxApp } from 'avenx-core/runtime';
import FirstGuard from './guards/first.guard.js';
import SecondGuard from './guards/second.guard.js';

const app = new AvenxApp({ target: '#app' });

app.initRouter({
  '': 'Home',
  '#/': 'Home',
  '#/first': { page: 'Home', guards: [FirstGuard] },
  '#/second': { page: 'Home', guards: [SecondGuard] },
});

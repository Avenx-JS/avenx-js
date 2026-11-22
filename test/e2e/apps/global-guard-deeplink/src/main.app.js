import { AvenxApp } from 'avenx-core/runtime';

window.__log ??= [];

const app = new AvenxApp({ target: '#app' });

const router = app.initRouter({
  '': 'Home',
  '#/login': 'Login',
  '#/secret': 'Secret',
});

router.beforeEach((to) => {
  window.__log.push(`before:${to.hash}`);
  if (to.hash.startsWith('#/secret') && !window.isAdmin) {
    return '#/login';
  }
  return true;
});

router.afterEach((to) => {
  window.__log.push(`after:${to.hash}`);
});

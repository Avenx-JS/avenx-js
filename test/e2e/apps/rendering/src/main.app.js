import { AvenxApp } from 'avenx-core/runtime';

const app = new AvenxApp({ target: '#app' });

app.initRouter({
  '': 'Rendering',
  '#/': 'Rendering',
  // Drives a documented compiler bug; see multiline-state.page.js.
  '#/multiline-state': 'MultilineState',
});

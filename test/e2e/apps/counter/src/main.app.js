import { AvenxApp } from 'avenx-core/runtime';

const app = new AvenxApp({ target: '#app' });

app.initRouter({
  '': 'Counter',
  '#/': 'Counter',
  // Drives a documented framework gap; see bare-computed.page.js.
  '#/bare-computed': 'BareComputed',
});
